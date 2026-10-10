import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunningHost } from "../../apps/cli/src/host";
import { blazeHostClips } from "./blaze-host-cases";
import {
	assertBlazeHostAuthored,
	assertBlazeHostCatalog,
	blazeHostClient,
} from "./blaze-host-checks";
import {
	blazeHostSettings,
	type BlazeHostResource,
} from "./blaze-host-contract";
import {
	assertBlazeHostAbsentChild,
	assertBlazeHostRealPath,
	assertBlazeHostSnapshot,
} from "./blaze-host-paths.mjs";
import {
	blazeHostDigest,
	blazeHostImage,
	loadBlazeHostAuthor,
} from "./blaze-host-source";
import { assertBlazeEditorBytes } from "./blaze-editor-persistence.mjs";
import { validateBlazeEditorInputs } from "./blaze-editor-provenance.mjs";

const [root, configPath] = process.argv.slice(2);
await assertBlazeHostRealPath(root);
await assertBlazeHostAbsentChild(join(root, "project"), root);
const sourceRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const { config, provenance } = await validateBlazeEditorInputs(
	configPath,
	sourceRoot,
);
await assertBlazeHostSnapshot({
	snapshot: config.snapshot,
	manifestSha256: config.manifestSha256,
	wasmSha256: config.wasmSha256,
	wasmUrl: import.meta.resolve("opencut-wasm"),
});
const { startHost } = await import("../../apps/cli/src/host");
const { TargetRegistry } = await import("../../apps/cli/src/target-registry");
const options = {
	projectRoot: join(root, "project"),
	staticDir: config.editorDist,
	port: 0,
	registry: new TargetRegistry(join(root, "registry")),
	htmlBrowserExecutable: "",
	htmlFrameConnectionFile: "",
};
let host: RunningHost | undefined;
const client = blazeHostClient({
	projectRoot: options.projectRoot,
	editorUrl: () => {
		assert(host);
		return host.editorUrl;
	},
});
const save = (name: string, value: unknown) =>
	writeFile(
		join(root, name),
		Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n",
		{ flag: "wx" },
	);
const close = async () => {
	if (host) {
		await host.close();
		host = undefined;
	}
};
const lifecycle = {
	hostClosed: false,
	reopenedAfterEdits: false,
	error: undefined as string | undefined,
};
try {
	host = await startHost(options);
	assertBlazeHostCatalog(await client.request("editing/catalog"));
	const helper = await loadBlazeHostAuthor(config.creatorModule),
		author = join(root, "author");
	await assertBlazeHostAbsentChild(author, root);
	await mkdir(author);
	const png = blazeHostImage(),
		filePath = join(author, "blaze.png");
	await writeFile(filePath, png, { flag: "wx" });
	const { resource } = await client.request<{ resource: BlazeHostResource }>(
		"programmatic/resources/import",
		{
			id: "blaze.png",
			filePath,
			kind: "image",
			mimeType: "image/png",
		},
	);
	assert.equal(resource.sha256, blazeHostDigest(png));
	const staticShot = helper.author(resource, false),
		animatedShot = helper.author(resource, true);
	const clips = blazeHostClips({ staticShot, animatedShot }),
		context = await client.context();
	await client.accept([
		{
			kind: "update-project",
			projectId: context.project.id,
			patch: {
				name: "Blaze private editor UI acceptance",
				canvasWidth: blazeHostSettings.width,
				canvasHeight: blazeHostSettings.height,
				frameRate: blazeHostSettings.frameRate,
			},
		},
		...(
			[
				["blaze-shots", false],
				["blaze-sentinel", true],
			] as const
		).map(([id, hidden]) => ({
			kind: "create-track",
			track: { id, name: id, hidden, kind: "graphic" },
		})),
		...clips.map((clip) => ({ kind: "create-clip", clip })),
	]);
	const verifyResource = async () => {
		const response = await client.raw("programmatic/resources/load", resource);
		assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
	};
	const original = await client.snapshot(),
		seed = await client.disk();
	assertBlazeHostAuthored({ snapshot: original, clips });
	const unavailable = join(root, "unavailable-author");
	await assertBlazeHostRealPath(author);
	await assertBlazeHostAbsentChild(unavailable, root);
	await rename(author, unavailable);
	await assert.rejects(readFile(filePath), { code: "ENOENT" });
	await close();
	host = await startHost(options);
	assert.deepEqual(await client.snapshot(), original);
	assert.deepEqual(await client.disk(), seed);
	await verifyResource();
	await save("project-before-ui.json", seed);
	await save("prepared.json", {
		ok: true,
		hostReopened: true,
		authorUnavailable: true,
		snapshot: original,
		resource,
		source: staticShot.source,
		creator: helper.files,
		provenance,
	});
	console.log(JSON.stringify({ editorUrl: host.editorUrl }));
	const command = await new Promise<string>((done) => {
		process.stdin.once("data", (data) => done(data.toString().trim()));
		process.stdin.once("end", () => done("stop"));
	});
	if (command === "verify") {
		const expected = JSON.parse(
			await readFile(join(root, "expected-edited.json"), "utf8"),
		);
		const baseline = await readFile(join(root, "project-final-ui.json"));
		assert.deepEqual(await client.snapshot(), expected);
		assertBlazeEditorBytes(baseline, await client.disk(), "before-host-close");
		await close();
		host = await startHost(options);
		assert.deepEqual(await client.snapshot(), expected);
		const bytes = await client.disk();
		assertBlazeEditorBytes(baseline, bytes, "after-host-reopen");
		await verifyResource();
		await save("project-after-host-reopen.json", bytes);
		await save("reopened-after-edit.json", {
			ok: true,
			hostReopenedAfterEdits: true,
			resourceStillAvailable: true,
			byteIdentical: true,
			projectSha256: blazeHostDigest(bytes),
			snapshot: expected,
		});
		lifecycle.reopenedAfterEdits = true;
	}
	for (const file of helper.files)
		assert.equal(blazeHostDigest(await readFile(file.path)), file.sha256);
} catch (error) {
	lifecycle.error = error instanceof Error ? error.message : String(error);
	throw error;
} finally {
	try {
		await close();
		lifecycle.hostClosed = true;
	} finally {
		await save("host-lifecycle.json", lifecycle);
	}
}
