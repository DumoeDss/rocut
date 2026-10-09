import assert from "node:assert/strict";
import { build as buildHost } from "esbuild";
import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	build as buildBrowser,
	chromium,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";
import {
	copyProject,
	hash,
	inside,
	nativeCommand,
	plain,
	readJson,
	startPrivateHost,
	treeManifest,
	writeJson,
} from "./particle-c4-export-support.mjs";

import { verifyProjectVideo } from "./fixtures/particle-project-export-verify.mjs";
import { PROJECT_EXPORT_LIMITS } from "./fixtures/particle-project-export-pixels.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keys = [
	"artifacts-root",
	"source-project",
	"clip-id",
	"bun",
	"wasm-sync",
	"sampler-dir",
	"toolchain",
	"chromium",
	"ffmpeg",
	"ffprobe",
];
const options = {},
	args = process.argv.slice(2);
const optionalKeys = ["electron-connection-file", "variant"];
for (let index = 0; index < args.length; index += 2) {
	const key = args[index]?.slice(2),
		value = args[index + 1];
	if (
		!args[index]?.startsWith("--") ||
		(!keys.includes(key) && !optionalKeys.includes(key)) ||
		options[key] ||
		!value ||
		(!["clip-id", "variant"].includes(key) && !isAbsolute(value))
	)
		throw Error(
			"Supply each explicit --" +
				keys.join(" <value> --") +
				" <value>; all paths must be absolute",
		);
	options[key] = ["clip-id", "variant"].includes(key) ? value : resolve(value);
}
assert.ok(
	keys.every((key) => options[key]),
	"Missing required export probe option",
);
assert.ok(
	inside("C:/tmps", options["artifacts-root"]),
	"Artifacts must remain below C:/tmps",
);
assert.ok(
	inside("C:/tmps", options["source-project"]),
	"Only an explicit private C:/tmps source project is accepted",
);
await plain(options["artifacts-root"], true);
await plain(options["source-project"], true);
for (const key of ["sampler-dir", "toolchain"]) await plain(options[key], true);
for (const key of ["bun", "wasm-sync", "chromium", "ffmpeg", "ffprobe"])
	await plain(options[key], false);
const electronConnectionFile = options["electron-connection-file"];
if (electronConnectionFile) {
	assert.ok(inside("C:/tmps", electronConnectionFile));
	await plain(electronConnectionFile, false);
}
const variant = options.variant ?? "original";
assert.ok(["original", "timing"].includes(variant));
const sourceBackend = electronConnectionFile
	? "elftia-electron-particle-session-v2"
	: "private-chromium";
const root = await mkdtemp(
	join(options["artifacts-root"], "particle-project-export-"),
);
assert.ok(!inside(options["source-project"], root));
await mkdir(join(root, "temp"));
const environment = {
	...process.env,
	TEMP: join(root, "temp"),
	TMP: join(root, "temp"),
	TMPDIR: join(root, "temp"),
	ELFTIA_HTML_FRAME_CONNECTION_FILE: electronConnectionFile ?? "",
	ROCUT_HTML_BROWSER_PATH: electronConnectionFile ? "" : options.chromium,
};
const sources = new Map(),
	generatedModules = new Map(),
	secrets = new Set();
const redact = (value) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-host-capability]");
	return text;
};
const formatError = (error) => ({
	error: redact(error),
	stack: redact(error?.stack),
	...(error instanceof AggregateError
		? { errors: [...error.errors].map(formatError) }
		: {}),
});
async function scanPublicArtifacts() {
	const manifest = await treeManifest(root),
		excluded = [],
		leaked = [];
	let scanned = 0;
	for (const file of manifest.files) {
		if (/(?:\.private|\.pending-private)\.json$/.test(file.path)) {
			excluded.push(file.path);
			continue;
		}
		const bytes = await readFile(join(root, file.path));
		scanned++;
		if (
			[...secrets].some(
				(secret) => secret && bytes.includes(Buffer.from(secret)),
			)
		)
			leaked.push(file.path);
	}
	await writeJson(join(root, "public-credential-scan.json"), {
		scanned,
		excludedPrivateArtifacts: excluded,
		exactInMemoryPatterns: secrets.size,
		leakedPaths: leaked,
		passed: leaked.length === 0,
		scope:
			"All retained files under this project-export root except explicit private readiness records; token values never logged",
	});
	assert.deepEqual(
		leaked,
		[],
		"Public artifact contains private capability data",
	);
}
async function remember(path) {
	const bytes = await readFile(path),
		entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
	const previous = sources.get(entry.path);
	if (previous)
		assert.deepEqual(entry, previous, "Source changed while building probe");
	sources.set(entry.path, entry);
	return bytes;
}
let host,
	browser,
	copiedManifest,
	exportManifest,
	project,
	result,
	decoded,
	hostLifecycle;
let browserClosed = false,
	failure,
	failed = false;
const errors = [],
	externalRequests = [];
console.log(JSON.stringify({ root, phase: "private-export-preparation" }));

try {
	if (electronConnectionFile) {
		const bytes = await readFile(electronConnectionFile);
		assert.ok(bytes.length <= 4096);
		const descriptor = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		assert.match(descriptor.token, /^[a-f0-9]{64}$/);
		secrets.add(descriptor.token);
		assert.equal(descriptor.capabilities?.particleCaptureSession?.version, 2);
		assert.equal(
			descriptor.capabilities?.particleCaptureSession?.protocol,
			"particleSurface-v1",
		);
		assert.equal(
			descriptor.capabilities?.particleCaptureSession?.path,
			"/v2/particle-capture",
		);
	}
	await writeJson(join(root, "acceptance-contract.json"), {
		sourceBackend,
		frameCount: 6,
		frameRate: { numerator: 30, denominator: 1 },
		durationSeconds: 0.2,
		durationToleranceSeconds: 0.001,
		variant,
		dimensions:
			"actual persisted project canvas 1920x1080, never source 320x240",
		limits: PROJECT_EXPORT_LIMITS,
		semanticOracle: {
			activityMask:
				"Fixed positive saved-project reference only: any RGB > 32, at least 64 pixels",
			negativeSeparation:
				"Uncompressed wrong render active MAE >= 3 AND rejection by the unchanged pixel predicate; MAE >= 3 alone does not mean rejection",
			energy:
				"Positive decode actual/reference RGB energy ratio in [0.94,1.06] on the fixed activity mask; wrong-reference checks use exactly the same mask",
			opacityRule:
				"Saved0.85 RGB equals 0.85*opacity1 RGB on the fixed activity mask; uncompressed mean error<=2 and maximum<=4",
			colorSpaceEvidence:
				"Frozen C3 layer.wgsl scales straight alpha; blend.wgsl normal blending over opaque black; Rgba8Unorm/Bgra8Unorm intermediates. Explicit sRGB browser readback.",
		},
		range:
			variant === "original"
				? { startTime: 0, endTime: 24000, duration: 24000 }
				: { startTime: 236000, endTime: 260000, duration: 24000 },
		entire121FrameSourceExported: false,
		negativeControls:
			variant === "original"
				? ["opacity-ignored"]
				: ["placement-ignored", "trim-ignored"],
		background: "opaque black",
		thresholdRelaxationAllowed: false,
		scope:
			"Actual saved project active SceneTracks/clip opacity/timing/canvas; six-frame timeline window. Timing is an explicitly saved/reopened fixture variant; no attached-editor UI or audio claim.",
	});
	copiedManifest = await copyProject(
		options["source-project"],
		join(root, "project"),
	);
	await writeJson(join(root, "project-copy-manifest.json"), {
		sourceProject: options["source-project"],
		destination: join(root, "project"),
		exactByteCopy: true,
		...copiedManifest,
	});
	if (variant === "timing")
		await copyProject(
			options["source-project"],
			join(root, "original-readonly-copy"),
		);
	const version = await nativeCommand(
		options.bun,
		["--version"],
		root,
		"bun-version",
	);
	assert.equal(version.output.trim(), "1.2.18", "Pinned Bun 1.2.18 required");
	const wasmDirectory = dirname(options["wasm-sync"]);
	const pinned = {
		"particle-sampler-wasm.mjs":
			"205eb2eff08f10677294d38a90aedceb6b65ce52c7e4ea87760b0cbac8a86c3a",
		"opencut_wasm_bg.wasm":
			"328a2a4313812c356f28d74f27cfeaa10cad3a933e2c4f3de5ded20d8d98c221",
		"particle-sampler-worker-entry.mjs":
			"e9afc00344177d72276eb6c8ba269749e8cf27644758d9c6037a59e5f7e7dd30",
	};
	assert.equal(
		hash(await remember(join(wasmDirectory, "opencut_wasm_bg.wasm"))),
		pinned["opencut_wasm_bg.wasm"],
		"Only the frozen C3 WASM is accepted",
	);
	for (const [name, expected] of Object.entries(pinned)) {
		assert.equal(
			hash(await remember(join(options["sampler-dir"], name))),
			expected,
			`Wrong frozen C3 sampler ${name}`,
		);
		await copyFile(
			join(options["sampler-dir"], name),
			join(root, name),
			constants.COPYFILE_EXCL,
		);
		assert.equal(hash(await remember(join(root, name))), expected);
	}
	for (const path of [
		fileURLToPath(import.meta.url),
		join(repo, "script/fixtures/particle-project-export-verify.mjs"),
		join(repo, "script/fixtures/particle-project-export-pixels.mjs"),
		join(repo, "script/particle-c4-export-support.mjs"),
		join(repo, "script/probe-child-lifecycle.mjs"),
		join(repo, "script/browser-probe-toolchain.mjs"),
		options["wasm-sync"],
		join(wasmDirectory, "opencut_wasm.js"),
		join(wasmDirectory, "opencut_wasm_bg.js"),
		join(options.toolchain, "package-lock.json"),
	])
		await remember(path);
	const hostBundle = await buildHost({
		absWorkingDir: repo,
		entryPoints: [
			join(repo, "script/fixtures/particle-project-export-host.ts"),
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
				name: "isolated-c4-export-host",
				setup(api) {
					api.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
						path: pathToFileURL(options["wasm-sync"]).href,
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
	assert.equal(hostBundle.outputFiles.length, 1);
	await writeFile(join(root, "host.mjs"), hostBundle.outputFiles[0].contents, {
		flag: "wx",
	});
	await remember(join(root, "host.mjs"));
	const classicRequire = createRequire(
		new URL("../packages/editor-classic/package.json", import.meta.url),
	);
	const mediabunnyEntry = join(
		dirname(classicRequire.resolve("mediabunny")),
		"../modules/src/index.js",
	);
	await buildBrowser({
		root: repo,
		configFile: false,
		envDir: root,
		envPrefix: "ROCUT_C4_EXPORT_PUBLIC_",
		cacheDir: join(root, "vite-cache"),
		base: "./",
		logLevel: "error",
		plugins: [
			wasm(),
			topLevelAwait(),
			{
				name: "c4-export-source-manifest",
				async transform(code, id) {
					if (id === "/__vite-plugin-wasm-helper") {
						generatedModules.set(id, {
							id,
							bytes: Buffer.byteLength(code),
							sha256: hash(code),
						});
						return null;
					}
					const path = id.split("?")[0];
					if (isAbsolute(path) && !path.includes("\0")) await remember(path);
					return null;
				},
			},
		],
		resolve: {
			alias: [
				{
					find: /^opencut-wasm$/,
					replacement: join(wasmDirectory, "opencut_wasm.js"),
				},
				{ find: /^mediabunny$/, replacement: mediabunnyEntry },
			],
		},
		build: {
			outDir: join(root, "editor"),
			emptyOutDir: false,
			rollupOptions: {
				input: join(repo, "script/fixtures/particle-project-export.html"),
			},
		},
	});
	await writeJson(
		join(root, "browser-build-manifest.json"),
		await treeManifest(join(root, "editor")),
	);
	await writeJson(join(root, "source-manifest.json"), {
		sources: [...sources.values()],
		generatedModules: [...generatedModules.values()],
	});
	host = startPrivateHost({
		executable: options.bun,
		args: [
			join(root, "host.mjs"),
			root,
			options.toolchain,
			options.chromium,
			options.ffmpeg,
			options.ffprobe,
			options["clip-id"],
			electronConnectionFile ?? "",
			variant,
		],
		cwd: repo,
		env: environment,
		root,
	});
	const ready = await host.ready();
	secrets.add(ready.token);
	secrets.add(ready.editorUrl);
	project = await readJson(join(root, "persisted-project.json"));
	exportManifest = await treeManifest(join(root, "project"));
	await writeJson(join(root, "export-project-manifest.json"), {
		variant,
		...exportManifest,
	});
	const origin = new URL(ready.editorUrl).origin;
	browser = await chromium.launch({
		headless: true,
		executablePath: options.chromium,
		env: environment,
		timeout: 60000,
		args: [
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	const page = await browser.newPage();
	page.on("pageerror", (error) => errors.push(redact(error.message)));
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	await page.addInitScript(
		(boot) => {
			globalThis.__particleProjectBoot = boot;
		},
		{
			project,
			clipId: options["clip-id"],
			variant,
			baseUrl: new URL("api", ready.editorUrl).href,
		},
	);
	await page.goto(
		new URL("script/fixtures/particle-project-export.html", ready.editorUrl)
			.href,
		{ timeout: 60000, waitUntil: "load" },
	);
	await page.waitForFunction(
		() => globalThis.__particleProjectResult,
		undefined,
		{
			timeout: 840000,
		},
	);
	result = await page.evaluate(() => {
		const output = globalThis.__particleProjectResult;
		const encode = (bytes) => {
			let binary = "";
			for (let i = 0; i < bytes.length; i += 32768)
				binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
			return btoa(binary);
		};
		if (output.error)
			return {
				...output,
				partial: output.partial
					? {
							...output.partial,
							references: output.partial.references.map((reference) => ({
								...reference,
								rgba: encode(reference.rgba),
							})),
							negativeControls: output.partial.negativeControls.map(
								(control) => ({ ...control, rgba: encode(control.rgba) }),
							),
						}
					: undefined,
			};
		return {
			...output,
			video: encode(output.video),
			negativeControls: output.negativeControls.map((control) => ({
				...control,
				rgba: encode(control.rgba),
			})),
			references: output.references.map((reference) => ({
				...reference,
				rgba: encode(reference.rgba),
			})),
		};
	});
	if (result.error) {
		if (result.partial) {
			const summary = {
				phase: result.partial.phase,
				references: [],
				negativeControls: [],
			};
			for (const kind of ["references", "negativeControls"])
				for (const [index, entry] of result.partial[kind].entries()) {
					const { rgba, ...rest } = entry,
						bytes = Buffer.from(rgba, "base64"),
						path = `partial-${kind}-${index}.rgba`;
					await writeFile(join(root, path), bytes, { flag: "wx" });
					summary[kind].push({
						...rest,
						path,
						bytes: bytes.length,
						sha256: hash(bytes),
					});
				}
			await writeJson(join(root, "partial-browser-evidence.json"), summary);
		}
		throw Error(redact(result.error + "\n" + result.stack));
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(result.frameCount, 6);
	assert.equal(result.mimeType, "video/webm");
	assert.equal(result.width, project.record.data.settings.canvasSize.width);
	assert.equal(result.height, project.record.data.settings.canvasSize.height);
	assert.deepEqual(result.frameRate, { numerator: 30, denominator: 1 });
	assert.deepEqual(result.limits, PROJECT_EXPORT_LIMITS);
	assert.equal(result.references.length, 6);
	await writeFile(
		join(root, "particle.webm"),
		Buffer.from(result.video, "base64"),
		{ flag: "wx" },
	);
	const references = result.references.map((reference) => ({
		...reference,
		rgba: Buffer.from(reference.rgba, "base64"),
	}));
	for (const reference of references) {
		assert.ok(
			Number.isSafeInteger(reference.index) &&
				reference.index >= 0 &&
				reference.index < 6,
		);
		await writeFile(
			join(root, `reference-${reference.index}.rgba`),
			reference.rgba,
			{ flag: "wx" },
		);
	}
	const negativeControls = result.negativeControls.map((control) => ({
		...control,
		rgba: Buffer.from(control.rgba, "base64"),
	}));
	assert.deepEqual(
		negativeControls.map((control) => control.kind),
		variant === "original"
			? ["opacity-ignored"]
			: ["placement-ignored", "trim-ignored"],
	);
	for (const control of negativeControls)
		await writeFile(join(root, `negative-${control.kind}.rgba`), control.rgba, {
			flag: "wx",
		});
	const {
		video: _video,
		references: _references,
		negativeControls: _negatives,
		...summary
	} = result;
	await writeJson(join(root, "browser-export-evidence.json"), {
		...summary,
		browser: browser.version(),
		negativeControls: negativeControls.map(({ rgba, ...control }) => ({
			...control,
			bytes: rgba.length,
			sha256: hash(rgba),
		})),
		references: references.map(({ rgba, ...reference }) => ({
			...reference,
			bytes: rgba.length,
			sha256: hash(rgba),
		})),
	});
	decoded = await verifyProjectVideo({
		root,
		ffmpeg: options.ffmpeg,
		ffprobe: options.ffprobe,
		width: project.record.data.settings.canvasSize.width,
		height: project.record.data.settings.canvasSize.height,
		references,
		negativeControls,
	});
} catch (error) {
	failed = true;
	failure = error;
} finally {
	const cleanup = [];
	try {
		if (browser) {
			await browser.close();
			browserClosed = !browser.isConnected();
			assert.ok(browserClosed);
		}
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (host) hostLifecycle = await host.stop();
	} catch (error) {
		cleanup.push(error);
	}
	if (copiedManifest) {
		try {
			assert.deepEqual(
				await treeManifest(options["source-project"]),
				copiedManifest,
				"Original project changed after export",
			);
			assert.deepEqual(
				await treeManifest(join(root, "project")),
				exportManifest ?? copiedManifest,
				"Saved export project changed during read-only render",
			);
			if (variant === "timing")
				assert.deepEqual(
					await treeManifest(join(root, "original-readonly-copy")),
					copiedManifest,
					"Original read-only copy changed",
				);
			await writeJson(join(root, "project-stability.json"), {
				sourceUnchanged: true,
				copyUnchangedDuringExport: true,
				variant,
			});
		} catch (error) {
			cleanup.push(error);
		}
	}
	const changed = [];
	for (const entry of sources.values()) {
		try {
			if (hash(await readFile(entry.path)) !== entry.sha256)
				changed.push(entry.path);
		} catch {
			changed.push(entry.path);
		}
	}
	await writeJson(join(root, "source-stability.json"), {
		stable: changed.length === 0,
		changed,
	});
	if (changed.length)
		cleanup.push(Error("Probe input source changed during execution"));
	if (cleanup.length) {
		failure = new AggregateError(
			failed ? [failure, ...cleanup] : cleanup,
			"Particle export or cleanup failed",
		);
		failed = true;
	}
}
if (failed) {
	await writeJson(join(root, "failure.json"), {
		...formatError(failure),
		errors,
		externalRequests,
		browserClosed,
		artifactsRetained: true,
	});
	await scanPublicArtifacts();
	throw Error(redact(failure));
}
const artifacts = [];
for (const name of [
	"particle.webm",
	"decoded.rgba",
	"persisted-source.json",
	"persisted-project.json",
	...(variant === "original"
		? ["negative-opacity-ignored.rgba"]
		: ["negative-placement-ignored.rgba", "negative-trim-ignored.rgba"]),
	"persisted-clip.json",
	...Array.from({ length: 6 }, (_, index) => `reference-${index}.rgba`),
]) {
	const bytes = await readFile(join(root, name));
	artifacts.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
await writeJson(join(root, "evidence.json"), {
	version: 1,
	status: "passed",
	root,
	scope: `Retained saved FileProjectStore project (${variant}) -> production decodeProject active SceneTracks/clip params and project canvas -> buildScene/CanvasRenderer/SceneExporter -> six-frame timeline-window WebM -> independent FFmpeg decode with rejected opacity/timing negative controls. No attached-editor UI, audio or complete-duration claim.`,
	variant,
	exportProjectSha256: exportManifest.files.find(
		(file) => file.path === "project.json",
	).sha256,
	sourceBackend,
	clipId: options["clip-id"],
	sourceProject: options["source-project"],
	copiedProjectSha256: copiedManifest.files.find(
		(file) => file.path === "project.json",
	).sha256,
	frameCount: 6,
	frameRate: project.record.data.settings.fps,
	exportedTimelineRange: result.range,
	savedProjectDurationTicks: project.record.data.metadata.duration,
	entire121FrameSourceExported: false,
	unexportedTimelineIntervals: [
		...(result.range.startTime > 0
			? [{ startTime: 0, endTime: result.range.startTime }]
			: []),
		...(result.range.endTime < project.record.data.metadata.duration
			? [
					{
						startTime: result.range.endTime,
						endTime: project.record.data.metadata.duration,
					},
				]
			: []),
	],
	width: project.record.data.settings.canvasSize.width,
	height: project.record.data.settings.canvasSize.height,
	independentDecode: decoded,
	browserClosed,
	hostLifecycle,
	hostChildren: await readJson(join(root, "host-children.json")),
	externalRequests,
	artifacts,
	originalProjectUnmodified: true,
	privateExportCopyUnmodifiedDuringRender: true,
	originalReadonlyCopyUnmodified: true,
	artifactsRetained: true,
	processBoundary:
		"Host direct-child observations plus awaited Playwright browser.close; no arbitrary descendant-tree shutdown inference",
});
await scanPublicArtifacts();
console.log(
	JSON.stringify({
		status: "passed",
		root,
		evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
	}),
);
