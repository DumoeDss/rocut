import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "../browser-probe-toolchain.mjs";
import {
	hash,
	inside,
	plain,
	readJson,
	startPrivateHost,
	treeManifest,
	writeJson,
} from "../particle-c4-export-support.mjs";
import {
	assertParticleSnapshot,
	frozenParticleFiles,
	opacitySnapshot,
} from "./particle-editor-contract.mjs";
import {
	captureParticleEditorFrame,
	observeParticleFrames,
} from "./particle-editor-checks.mjs";
import { finalParticleReferences } from "./particle-editor-references.mjs";
import {
	prepareIntegerCanvasGeometry,
	assertFrozenIntegerCanvas,
	integerGeometryPlan,
} from "./particle-editor-integer-geometry.mjs";
import { scanParticleCredentials } from "./particle-editor-credentials.mjs";
import { poll, seek } from "./stylized-fusion-checks.mjs";

const [coreRoot, bun, wasmSync, toolchain, chrome, mode = "build-only"] =
	process.argv.slice(2);
assert.ok(["build-only", "run"].includes(mode));
assert.ok(
	[coreRoot, bun, wasmSync, toolchain, chrome].every(
		(value) => value && isAbsolute(value),
	),
);
const parent = "C:/tmps/rocut-stylized-f6XU4z";
assert.ok(inside(parent, coreRoot));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await plain(coreRoot, true);
const core = await readJson(join(coreRoot, "evidence.json"));
assert.equal(core.status, "passed");
assert.equal(core.finalRevision, 7);
assert.equal(core.finalOpacity, 0.55);
assert.equal(core.previewReferences.selectionCleared, true);
assert.deepEqual(core.errors, []);
assert.deepEqual(core.httpFailures, []);
assert.equal(core.browserClosed, true);
assert.equal(core.hostLifecycle.code, 0);
assert.deepEqual(
	core.history.map((entry) => entry.phase),
	[
		"initial",
		"edited",
		"history.undo",
		"history.redo",
		"history.undo",
		"history.redo",
		"reloaded",
	],
);
assert.equal(core.samples.length, 22);
assert.equal(core.history.at(-1).result.revision, 7);
assert.equal(core.history.at(-1).result.count, 0);
const expected = await readJson(join(coreRoot, "expected-final-state.json"));
const initial = await readJson(join(coreRoot, "initial-state.json"));
assertParticleSnapshot(
	expected,
	opacitySnapshot(initial, "particle-model", 0.55),
	{ revision: 7 },
);
const project = join(coreRoot, "project"),
	editor = join(coreRoot, "editor");
const projectBefore = await treeManifest(project);
assert.equal(
	hash(await readFile(join(project, "project.json"))),
	hash(await readFile(join(coreRoot, "ui-saved-project.json"))),
);
const priorHandoff = await readJson(join(coreRoot, "export-handoff.json"));
assert.deepEqual(projectBefore, {
	directories: priorHandoff.directories,
	files: priorHandoff.files,
});
assert.equal(
	priorHandoff.project.replaceAll("\\", "/").toLowerCase(),
	project.replaceAll("\\", "/").toLowerCase(),
);
assert.equal(priorHandoff.revision, 7);
assert.equal(priorHandoff.opacity, 0.55);
assert.deepEqual(
	await treeManifest(editor),
	await readJson(join(coreRoot, "browser-build-manifest.json")),
);
const root = await mkdtemp(join(parent, "particle-editor-integer-handoff-"));
await mkdir(join(root, "temp"));
const sources = new Map(),
	secrets = new Set();
const evidence = {
	version: 1,
	status: "running",
	root,
	scope:
		"Read-only geometry-correction continuation of cTW0gv UI pass; old outward-rounded screenshots, handoff and failed export remain unchanged",
	coreRoot,
	project,
	electronTested: false,
	opacityEditsReplayed: false,
	errors: [],
	httpFailures: [],
	externalRequests: [],
	geometryPlan: integerGeometryPlan,
};
evidence.mode = mode;
const redact = (value) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
};
const remember = async (path) => {
	const bytes = await readFile(path),
		entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
	if (sources.has(entry.path)) assert.deepEqual(sources.get(entry.path), entry);
	sources.set(entry.path, entry);
	return bytes;
};
const env = {
	...process.env,
	TEMP: join(root, "temp"),
	TMP: join(root, "temp"),
	TMPDIR: join(root, "temp"),
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
	ROCUT_HTML_BROWSER_PATH: chrome,
};
let host, browser, failure, previewReferences;
console.log(
	JSON.stringify({
		phase: "particle-editor-integer-handoff-continuation",
		root,
		project,
	}),
);
try {
	await writeJson(join(root, "expected-final-state.json"), expected);
	await writeJson(join(root, "core-evidence-link.json"), {
		originalStatus: core.status,
		completedCore: [
			"actual opacity .85 -> .55",
			"revision 2->3->4->5->6->7 with undo/redo",
			"five reverse and five random exact captures",
			"reload full state/revision7/history-reset and edited pixels",
		],
		correction:
			"Previous locator screenshot outward-rounded fractional canvas bounds and admitted the production parent border; replace only the reference capture geometry",
		previousHandoff: {
			path: join(coreRoot, "export-handoff.json"),
			sha256: hash(await remember(join(coreRoot, "export-handoff.json"))),
		},
		coreEvidence: join(coreRoot, "evidence.json"),
		coreEvidenceSha256: hash(await remember(join(coreRoot, "evidence.json"))),
		expectedStateSha256: hash(
			await remember(join(coreRoot, "expected-final-state.json")),
		),
		projectBefore,
	});
	// The editor is consumed from immutable built files, not rebuilt from today's
	// workspace. Keep its original source provenance without treating unconsumed
	// current browser sources as this run's inputs. Host inputs are frozen below.
	const oldSources = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await remember(join(coreRoot, "source-manifest.json")),
		),
	);
	const frozenEditorManifest = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await remember(join(coreRoot, "browser-build-manifest.json")),
		),
	);
	assert.deepEqual(await treeManifest(editor), frozenEditorManifest);
	const oldSourceByPath = new Map(
		oldSources.sources.map((entry) => [entry.path.toLowerCase(), entry]),
	);
	for (const path of [
		fileURLToPath(import.meta.url),
		...[
			"references",
			"checks",
			"contract",
			"credentials",
			"integer-geometry",
		].map((name) => join(repo, `script/fixtures/particle-editor-${name}.mjs`)),
	])
		await remember(path);
	for (const [name, digest] of Object.entries(frozenParticleFiles)) {
		assert.equal(hash(await remember(join(coreRoot, name))), digest);
		await copyFile(
			join(coreRoot, name),
			join(root, name),
			constants.COPYFILE_EXCL,
		);
	}
	const bundle = await build({
		absWorkingDir: repo,
		entryPoints: [
			join(repo, "script/fixtures/particle-editor-handoff-host.ts"),
		],
		outfile: join(root, "host.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "es2022",
		write: false,
		define: {
			"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
				"./particle-sampler-wasm.mjs",
			),
		},
		plugins: [
			{
				name: "handoff-private-host",
				setup(api) {
					api.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
						path: pathToFileURL(wasmSync).href,
						external: true,
					}));
					api.onResolve({ filter: /^node:child_process$/ }, ({ importer }) =>
						importer.endsWith("particle-c2-process-observer.mjs")
							? { path: "node:child_process", external: true }
							: {
									path: join(
										repo,
										"script/fixtures/particle-c2-process-observer.mjs",
									),
								},
					);
					api.onLoad(
						{ filter: /\.(?:ts|tsx|js|mjs|json)$/ },
						async ({ path }) => ({
							contents: new TextDecoder("utf-8", { fatal: true }).decode(
								await remember(path),
							),
							loader:
								{ ".ts": "ts", ".tsx": "tsx", ".json": "json" }[
									extname(path)
								] ?? "js",
							resolveDir: dirname(path),
						}),
					);
				},
			},
		],
	});
	await writeFile(join(root, "host.mjs"), bundle.outputFiles[0].contents, {
		flag: "wx",
	});
	await remember(join(root, "host.mjs"));
	const changedConsumedHostInputs = [...sources.values()].flatMap((entry) => {
		const original = oldSourceByPath.get(entry.path.toLowerCase());
		return original && original.sha256 !== entry.sha256
			? [
					{
						path: entry.path,
						priorSha256: original.sha256,
						currentSha256: entry.sha256,
					},
				]
			: [];
	});
	const concurrentSource = oldSources.sources.find((entry) =>
		entry.path
			.replaceAll("\\", "/")
			.endsWith("/services/renderer/programmatic/font-metrics-worker.ts"),
	);
	assert.ok(concurrentSource);
	evidence.inputIdentity = {
		editor: "Exact cTW0gv compiled artifact manifest; no browser rebuild",
		priorSourceProvenanceSha256: hash(
			await readFile(join(coreRoot, "source-manifest.json")),
		),
		priorBuildOnlyFailure:
			"particle-editor-integer-handoff-bMXrLM remains failed: incorrectly required unconsumed current browser source to match historical source",
		knownConcurrentSourceChange: {
			path: concurrentSource.path,
			priorSha256: concurrentSource.sha256,
			currentSha256: hash(await readFile(concurrentSource.path)),
			consumedByNewHost: [...sources.keys()].some(
				(path) => path.toLowerCase() === concurrentSource.path.toLowerCase(),
			),
		},
		changedConsumedHostInputs,
	};
	await writeJson(
		join(root, "build-input-identity.json"),
		evidence.inputIdentity,
	);
	await writeJson(join(root, "source-manifest.json"), {
		sources: [...sources.values()],
	});
	if (mode === "run") {
		host = startPrivateHost({
			executable: bun,
			args: [join(root, "host.mjs"), root, project, editor, toolchain, chrome],
			cwd: repo,
			env,
			root,
		});
		const ready = await host.ready();
		secrets.add(ready.token);
		secrets.add(ready.editorUrl);
		const origin = new URL(ready.editorUrl).origin;
		const request = async (route) => {
			const response = await fetch(new URL(`api/${route}`, ready.editorUrl), {
				signal: AbortSignal.timeout(15000),
			});
			assert.ok(response.ok, `Host ${route} status ${response.status}`);
			return response.json();
		};
		const snapshot = async () => ({
			clips: await request("clips"),
			tracks: await request("tracks"),
			revision: (await request("context")).revision,
		});
		browser = await chromium.launch({
			headless: true,
			executablePath: chrome,
			env,
			timeout: 60000,
			args: [
				"--no-proxy-server",
				"--enable-unsafe-webgpu",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
			],
		});
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
			deviceScaleFactor: 1,
		});
		page.on("pageerror", (error) =>
			evidence.errors.push(redact(error.message)),
		);
		page.on("response", (response) => {
			if (
				response.status() >= 400 &&
				!(
					response.status() === 404 &&
					new URL(response.url()).pathname.endsWith(
						"/api/library/graph-editor-presets/user-presets",
					)
				)
			)
				evidence.httpFailures.push({
					status: response.status(),
					url: redact(response.url()),
				});
		});
		await page.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
				evidence.externalRequests.push(url.origin);
				await route.abort();
			} else await route.continue();
		});
		const frames = observeParticleFrames(page);
		await page.goto(ready.editorUrl, { timeout: 60000, waitUntil: "load" });
		await page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="particle-model"]',
			)
			.waitFor({ timeout: 60000 });
		await poll(async () => (await request("export")).surfaces === 1);
		assertParticleSnapshot(await snapshot(), expected);
		const disk = await readJson(join(project, "project.json")),
			dimensions = disk.record.data.settings.canvasSize;
		assert.deepEqual((await request("record")).record, disk.record);
		// Select normally first so the no-hit clear action is actually observed.
		await page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="particle-model"]',
			)
			.click();
		const integerGeometry = await prepareIntegerCanvasGeometry({
			page,
			root,
			dimensions,
		});
		evidence.integerGeometry = integerGeometry.frozen;
		previewReferences = await finalParticleReferences({
			page,
			root,
			dimensions,
			revision: 7,
			at: (frame) => seek(page, Math.floor(frame / 30), frame % 30),
			shot: async (name, frame) => {
				await assertFrozenIntegerCanvas({ page, ...integerGeometry });
				const sample = await captureParticleEditorFrame(
					page,
					root,
					name,
					dimensions,
					frames,
					frame * 4000,
				);
				await assertFrozenIntegerCanvas({ page, ...integerGeometry });
				const bytes = await readFile(join(root, `${name}.png`));
				assert.equal(
					bytes.readUInt32BE(16),
					integerGeometry.frozen.bounds.width,
				);
				assert.equal(
					bytes.readUInt32BE(20),
					integerGeometry.frozen.bounds.height,
				);
				return sample;
			},
		});
		assertParticleSnapshot(await snapshot(), expected);
		assert.deepEqual((await request("record")).record, disk.record);
		assert.deepEqual(evidence.errors, []);
		assert.deepEqual(evidence.httpFailures, []);
		assert.deepEqual(evidence.externalRequests, []);
		evidence.frameRequests = frames.requests;
	}
} catch (error) {
	failure = error;
	evidence.primaryFailure = {
		error: redact(error),
		stack: redact(error?.stack),
	};
} finally {
	const cleanup = [];
	try {
		if (browser) {
			await browser.close();
			evidence.browserClosed = !browser.isConnected();
			assert.ok(evidence.browserClosed);
		}
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (host) evidence.hostLifecycle = await host.stop();
	} catch (error) {
		cleanup.push(error);
	}
	try {
		assert.deepEqual(await treeManifest(project), projectBefore);
		evidence.sameSavedProjectUnchanged = true;
		assert.deepEqual(
			await treeManifest(editor),
			await readJson(join(coreRoot, "browser-build-manifest.json")),
		);
		evidence.sameFrozenEditorUnchanged = true;
		const changed = [];
		for (const entry of sources.values())
			if (hash(await readFile(entry.path)) !== entry.sha256)
				changed.push(entry.path);
		await writeJson(join(root, "source-stability.json"), {
			stable: !changed.length,
			changed,
		});
		assert.deepEqual(changed, []);
	} catch (error) {
		cleanup.push(error);
	}
	try {
		const descriptors = [];
		for (const name of [
			"host-ready.private.json",
			"host-ready.pending-private.json",
			"host-reopened.private.json",
		]) {
			try {
				await plain(join(root, name), false);
				descriptors.push(name);
				const value = await readJson(join(root, name));
				if (value.token) secrets.add(value.token);
				if (value.editorUrl) secrets.add(value.editorUrl);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		try {
			evidence.credentialAudit = await scanParticleCredentials(
				root,
				secrets,
				descriptors,
			);
			assert.deepEqual(evidence.credentialAudit.leaks, []);
		} finally {
			for (const name of descriptors) await unlink(join(root, name));
			evidence.privateReadinessRemoved = true;
		}
	} catch (error) {
		cleanup.push(error);
	}
	if (cleanup.length)
		failure = new AggregateError(
			[failure, ...cleanup].filter(Boolean),
			"Handoff continuation or cleanup failed",
		);
}
if (!failure && mode === "run") {
	const disk = await readJson(join(project, "project.json"));
	const originalDisk = await readJson(join(coreRoot, "ui-saved-project.json"));
	assert.deepEqual(disk, originalDisk);
	assert.deepEqual(
		await readJson(join(root, "host-reopened-state.json")),
		expected,
	);
	evidence.hostChildren = await readJson(join(root, "host-children.json"));
	assert.ok(evidence.hostChildren.allObservedDirectChildrenClosed);
	await writeJson(join(root, "export-handoff.json"), {
		project,
		revision: 7,
		opacity: 0.55,
		exactUiSavedProject: true,
		hostReopened: true,
		coreEvidence: {
			root: coreRoot,
			status: core.status,
			sha256: hash(await readFile(join(coreRoot, "evidence.json"))),
		},
		baseline: {
			revision: initial.revision,
			fullStateFile: join(coreRoot, "initial-state.json"),
			fullStateSha256: hash(
				await readFile(join(coreRoot, "initial-state.json")),
			),
		},
		final: {
			revision: 7,
			metadata: disk.record.data.metadata,
			settings: disk.record.data.settings,
			fullStateFile: "expected-final-state.json",
			fullStateSha256: hash(
				await readFile(join(root, "expected-final-state.json")),
			),
			sourceSha256: hash(
				JSON.stringify(
					expected.clips.find((clip) => clip.id === "particle-model").editing
						.programmatic,
				),
			),
		},
		previewReferences,
		geometryCorrection: {
			planFile: "integer-geometry-plan.json",
			frozenFile: "integer-geometry-frozen.json",
			priorHandoff: join(coreRoot, "export-handoff.json"),
			priorHandoffSha256: hash(
				await readFile(join(coreRoot, "export-handoff.json")),
			),
			contentCrop: false,
			pixelDrivenSelection: false,
		},
		instruction:
			"Consume this exact same saved UI project unchanged. Do not recompile source or replay UI edits.",
		...projectBefore,
	});
	evidence.status = "passed";
	evidence.previewReferences = previewReferences;
} else if (!failure) {
	evidence.status = "build-only-passed";
} else {
	evidence.status = "failed";
	evidence.error = redact(failure);
	evidence.causes =
		failure instanceof AggregateError
			? [...failure.errors].map((error) => redact(error))
			: [redact(failure)];
}
await writeJson(join(root, "evidence.json"), evidence);
console.log(
	JSON.stringify({
		status: evidence.status,
		root,
		project,
		evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
	}),
);
if (failure) process.exitCode = 1;
