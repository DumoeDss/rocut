import { strict as assert } from "node:assert";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { openImageSequenceRoot } from "../../apps/cli/src/programmatic/image-sequence-files";
import { writeBuildEditorSources } from "./programmatic-build-editor-source-fixture";

const [artifactArgument, staticArgument, ...extra] = process.argv.slice(2);
const toolchainDirectory = process.env.ROCUT_TEST_ENGINE_TOOLCHAIN;
const browserExecutable = process.env.ROCUT_PROBE_BROWSER_PATH ?? "";
if (
	!artifactArgument ||
	!staticArgument ||
	extra.length ||
	!isAbsolute(artifactArgument) ||
	!isAbsolute(staticArgument)
)
	throw Error(
		"Provide positional absolute artifactRoot and staticDir arguments",
	);
if (!toolchainDirectory || !isAbsolute(toolchainDirectory))
	throw Error("Configure a pinned local ROCUT_TEST_ENGINE_TOOLCHAIN");
if (
	browserExecutable &&
	(!isAbsolute(browserExecutable) || !(await lstat(browserExecutable)).isFile())
)
	throw Error(
		"ROCUT_PROBE_BROWSER_PATH must be an existing absolute browser file",
	);
const artifact = resolve(artifactArgument),
	staticDir = resolve(staticArgument);
const relativeToTemp = relative(
	resolve("C:/Users/Sayo/AppData/Local/Temp"),
	artifact,
);
const staticRelative = relative(artifact, staticDir);
const isChild = (path: string) =>
	!!path && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
if (!isChild(relativeToTemp) || !isChild(staticRelative))
	throw Error(
		"Use a controlled C: temporary artifact directory and a static directory beneath it",
	);
await openImageSequenceRoot(artifact);
await openImageSequenceRoot(staticDir);
const hostRoot = join(artifact, "author-host"),
	authorDirectory = join(artifact, "author"),
	movedAuthorDirectory = join(artifact, "author-moved");
const absent = async (path: string) =>
	lstat(path).then(
		() => false,
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return true;
			throw error;
		},
	);
assert.equal(
	await absent(movedAuthorDirectory),
	true,
	"Do not overwrite prior authored evidence",
);
await mkdir(hostRoot);
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
	const fixtures = await writeBuildEditorSources(
		authorDirectory,
		toolchainDirectory,
	);
	const projectRoot = join(hostRoot, "project");
	host = await startHost({
		projectRoot,
		registry: new TargetRegistry(join(hostRoot, "registry")),
		staticDir,
		engineToolchainDirectory: toolchainDirectory,
		htmlBrowserExecutable: browserExecutable,
		htmlFrameConnectionFile: "",
	});
	const revisionBefore = Number(await host.automation.revision());
	const sources: { name: string; source: ProgrammaticSource }[] = [];
	for (const fixture of fixtures) {
		const response = await fetch(
			new URL("api/programmatic/build/compile", host.editorUrl),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(fixture.spec),
			},
		);
		const value: { source?: ProgrammaticSource; error?: string } =
			await response.json();
		if (!response.ok || !value.source)
			throw Error(
				`${fixture.name} initial compile failed: ${value.error ?? response.status}`,
			);
		assert.equal(value.source.build?.inputs.length, 2);
		sources.push({ name: fixture.name, source: value.source });
	}
	assert.equal(Number(await host.automation.revision()), revisionBefore);
	assert.equal(dirname(resolve(authorDirectory)), artifact);
	assert.equal(dirname(resolve(movedAuthorDirectory)), artifact);
	await openImageSequenceRoot(authorDirectory);
	await rename(authorDirectory, movedAuthorDirectory);
	assert.equal(await absent(authorDirectory), true);
	const context = {
		store: new FileProjectStore({
			root: projectRoot,
			schemaVersion: CURRENT_PROJECT_VERSION,
		}),
		projectId: host.automation.projectId,
	};
	for (const { source } of sources) {
		if (!source.build) throw Error("Compiled source lost its archived build");
		await loadProgrammaticResources(
			context,
			[
				...source.build.inputs,
				source.build.toolchainLock,
				...(source.resources ?? []),
			],
			new AbortController().signal,
		);
	}
	const metadata = {
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		authenticatedProductionCompile: true,
		authorDirectoryMoved: true,
		archiveInputsVerified: true,
		revisionBefore,
		revisionAfter: Number(await host.automation.revision()),
		edits: {
			HyperFrames: { fileId: "index.html", from: "#ff0000", to: "#00ff00" },
			Remotion: {
				fileId: "index.tsx",
				inputProps: { color: "#0000ff" },
				revisedInputProps: { color: "#00ff00" },
			},
		},
	};
	const payload = JSON.stringify({ version: 1, sources, metadata }, null, 2);
	assert.equal(payload.includes(host.editorUrl), false);
	assert.equal(payload.includes(host.token), false);
	assert.equal(payload.includes(toolchainDirectory), false);
	await writeFile(join(staticDir, "author-fixture.json"), payload, {
		encoding: "utf8",
		flag: "wx",
	});
	const readyPath = join(artifact, "author-host-ready.json"),
		pendingPath = join(artifact, "author-host-ready.pending.json");
	assert.equal(
		await absent(readyPath),
		true,
		"Do not replace an earlier Host readiness file",
	);
	await writeFile(
		pendingPath,
		JSON.stringify(
			{
				version: 1,
				editorUrl: host.editorUrl,
				apiBaseUrl: new URL("api/", host.editorUrl).href,
				fixturePath: "author-fixture.json",
				metadata,
				evidencePaths: {
					artifact,
					staticDir,
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
	await rename(pendingPath, readyPath);
	console.log(
		JSON.stringify({
			ready: true,
			engines: ["hyperframes", "remotion"],
			authorDirectoryMoved: true,
		}),
	);
	await stopped;
} catch (error) {
	await writeFile(
		join(hostRoot, "failure.json"),
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
		"Private build-editor fixture failed; inspect author-host/failure.json",
	);
	process.exitCode = 1;
} finally {
	stdin.close();
	process.stdin.pause();
	await host?.close();
	// Retain only this run's private evidence; no shared cleanup or dependency writes.
}
