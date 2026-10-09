import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { loadImageSequenceClosure } from "../../apps/cli/src/programmatic/image-sequence-closure";
import { openImageSequenceRoot } from "../../apps/cli/src/programmatic/image-sequence-files";
import {
	hostSequenceSource,
	writeHostSequenceAssets,
} from "./image-sequence-host-assets";

const [artifactArgument, staticArgument] = process.argv.slice(2);
const staticDir = staticArgument ?? process.env.ROCUT_PROBE_STATIC_DIR;
if (!artifactArgument || !isAbsolute(artifactArgument))
	throw Error("Provide an absolute private artifact directory on C:");
const artifact = resolve(artifactArgument);
const allowedParent = resolve("C:/Users/Sayo/AppData/Local/Temp");
const artifactRelative = relative(allowedParent, artifact);
if (
	!artifactRelative ||
	isAbsolute(artifactRelative) ||
	artifactRelative === ".." ||
	artifactRelative.startsWith(`..${sep}`)
)
	throw Error(
		"Fixture output must be below the controlled C: temporary directory",
	);
if (staticDir && !isAbsolute(staticDir))
	throw Error("Static directory must be absolute");
await openImageSequenceRoot(artifact);
const root = join(artifact, "image-sequence-host");
// Exclusive setup avoids overwriting evidence from another or earlier run.
await mkdir(root);
await openImageSequenceRoot(root);
const projectRoot = join(root, "project"),
	authorDirectory = join(root, "author"),
	movedAuthorDirectory = join(root, "author-moved"),
	readyPath = join(root, "ready.json");
let host: Awaited<ReturnType<typeof startHost>> | undefined;
const stdin = createInterface({ input: process.stdin, terminal: false });
const stopped = new Promise<void>((done) => {
	stdin.on("line", (line) => {
		if (line.trim() === "stop") done();
	});
	stdin.once("close", done);
	process.once("SIGTERM", done);
	process.once("SIGINT", done);
});

try {
	await mkdir(authorDirectory);
	const assets = await writeHostSequenceAssets(authorDirectory);
	const options = {
		projectRoot,
		registry: new TargetRegistry(join(root, "registry")),
		...(staticDir ? { staticDir } : {}),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
		engineToolchainDirectory: "",
	};
	host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host!.editorUrl);
	const getContext = async (): Promise<{ revision: number }> => {
		const response = await fetch(api("context"));
		assert.equal(response.status, 200, "Host context request failed");
		const value: { revision: number } = await response.json();
		assert.equal(typeof value.revision, "number");
		return value;
	};
	const before = await getContext();
	const request = {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(assets.input),
	};
	const unauthorized = await fetch(
		new URL(
			"/wrong/api/programmatic/resources/import-image-sequence",
			host.editorUrl,
		),
		request,
	);
	assert.equal(unauthorized.status, 401);
	await unauthorized.arrayBuffer();
	const response = await fetch(
		api("programmatic/resources/import-image-sequence"),
		request,
	);
	const imported: {
		resource: ProgrammaticResource;
		dependencies: number;
		reused: boolean;
	} = await response.json();
	assert.equal(
		response.status,
		200,
		"Production HTTP image sequence import failed",
	);
	assert.equal(imported.resource.kind, "imageSequence");
	assert.equal(imported.dependencies, 224);
	assert.equal(imported.reused, false);
	const afterImport = await getContext();
	assert.equal(afterImport.revision, before.revision);
	await host.close();
	host = undefined;
	// Validate exact move endpoints; never move/delete a broad or shared directory.
	assert.equal(dirname(resolve(authorDirectory)), root);
	assert.equal(dirname(resolve(movedAuthorDirectory)), root);
	await openImageSequenceRoot(authorDirectory);
	await rename(authorDirectory, movedAuthorDirectory);
	assert.equal(
		await lstat(authorDirectory).then(
			() => true,
			(error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return false;
				throw error;
			},
		),
		false,
	);
	host = await startHost(options);
	const store = new FileProjectStore({
		root: projectRoot,
		schemaVersion: CURRENT_PROJECT_VERSION,
	});
	const projects = await store.list();
	assert.equal(projects.length, 1);
	const closure = await loadImageSequenceClosure({
		store,
		projectId: projects[0].id,
		resource: imported.resource,
	});
	assert.deepEqual(closure.manifest, assets.manifest);
	const headers = await store.listAttachmentHeaders({
		projectId: projects[0].id,
	});
	assert.equal(headers.length, 225);
	const afterRestart = await getContext();
	assert.equal(afterRestart.revision, before.revision);
	// Exercise the exact authenticated binary route the browser provider uses.
	const rootResponse = await fetch(api("programmatic/resources/load"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(imported.resource),
	});
	assert.equal(rootResponse.status, 200);
	const rootBytes = await rootResponse.arrayBuffer();
	assert.equal(rootBytes.byteLength, imported.resource.byteLength);
	assert.equal(
		createHash("sha256").update(new Uint8Array(rootBytes)).digest("hex"),
		imported.resource.sha256,
	);
	assert.deepEqual(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rootBytes)),
		closure.manifest,
	);
	const proof = {
		authenticatedHttpImport: true,
		wrongTokenStatus: unauthorized.status,
		revisionBefore: before.revision,
		revisionAfterImport: afterImport.revision,
		revisionAfterRestart: afterRestart.revision,
		originalDirectoryMoved: true,
		durableClosureVerified: true,
		authenticatedRootReadVerified: true,
		frameCount: closure.manifest.frames.length,
		dependencyCount: closure.dependencies.length,
		attachmentCount: headers.length,
		syntheticNotBlender: true,
	};
	await writeFile(join(root, "proof.json"), JSON.stringify(proof, null, 2), {
		encoding: "utf8",
		flag: "wx",
	});
	const pendingReadyPath = join(root, "ready.pending.json");
	await writeFile(
		pendingReadyPath,
		JSON.stringify(
			{
				version: 1,
				editorUrl: host.editorUrl,
				apiBaseUrl: new URL("api/", host.editorUrl).href,
				resource: imported.resource,
				source: hostSequenceSource(imported.resource),
				manifest: closure.manifest,
				proof,
				evidencePaths: {
					root,
					projectRoot,
					authorDirectory,
					movedAuthorDirectory,
				},
			},
			null,
			2,
		),
		{ encoding: "utf8", flag: "wx" },
	);
	await rename(pendingReadyPath, readyPath);
	console.log(
		JSON.stringify({
			ready: true,
			readyPath,
			frames: 222,
			archiveReopened: true,
		}),
	);
	await stopped;
} catch (error) {
	await writeFile(
		join(root, "failure.json"),
		JSON.stringify(
			{
				error: String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
			null,
			2,
		),
		{ encoding: "utf8", flag: "wx" },
	);
	console.error(
		"Image sequence fixture failed; inspect its private failure.json",
	);
	process.exitCode = 1;
} finally {
	stdin.close();
	process.stdin.pause();
	await host?.close();
	// Keep the private evidence, authored inputs and project archive for inspection.
}
