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
	verifyVideo,
	writeJson,
} from "./particle-c4-export-support.mjs";

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
const optionalKeys = ["electron-connection-file"];
for (let index = 0; index < args.length; index += 2) {
	const key = args[index]?.slice(2),
		value = args[index + 1];
	if (
		!args[index]?.startsWith("--") ||
		(!keys.includes(key) && !optionalKeys.includes(key)) ||
		options[key] ||
		!value ||
		(key !== "clip-id" && !isAbsolute(value))
	)
		throw Error(
			"Supply each explicit --" +
				keys.join(" <value> --") +
				" <value>; all paths must be absolute",
		);
	options[key] = key === "clip-id" ? value : resolve(value);
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
const sourceBackend = electronConnectionFile
	? "elftia-electron-particle-session-v2"
	: "private-chromium";
const root = await mkdtemp(
	join(options["artifacts-root"], "particle-c4-export-"),
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
async function remember(path) {
	const bytes = await readFile(path),
		entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
	const previous = sources.get(entry.path);
	if (previous)
		assert.deepEqual(entry, previous, "Source changed while building probe");
	sources.set(entry.path, entry);
	return bytes;
}
let host, browser, copiedManifest, source, result, decoded, hostLifecycle;
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
		dimensions: "exact persisted source width/height",
		meanRgbErrorMaximum: 12,
		referenceActiveMeanRgbErrorMaximum: 18,
		referenceActiveMask: "any RGB channel > 8",
		background: "opaque black",
		thresholdRelaxationAllowed: false,
		scope:
			"Actual persisted programmatic source only, not project timeline, attached editor, or clip opacity semantics",
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
		entryPoints: [join(repo, "script/fixtures/particle-c4-export-host.ts")],
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
				input: join(repo, "script/fixtures/particle-c4-export.html"),
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
		],
		cwd: repo,
		env: environment,
		root,
	});
	const ready = await host.ready();
	secrets.add(ready.token);
	secrets.add(ready.editorUrl);
	source = await readJson(join(root, "persisted-source.json"));
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
			globalThis.__particleC4Boot = boot;
		},
		{ source, baseUrl: new URL("api", ready.editorUrl).href },
	);
	await page.goto(
		new URL("script/fixtures/particle-c4-export.html", ready.editorUrl).href,
		{ timeout: 60000, waitUntil: "load" },
	);
	await page.waitForFunction(() => globalThis.__particleC4Result, undefined, {
		timeout: 300000,
	});
	result = await page.evaluate(() => {
		const output = globalThis.__particleC4Result;
		if (output.error) return output;
		const encode = (bytes) => {
			let binary = "";
			for (let i = 0; i < bytes.length; i += 32768)
				binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
			return btoa(binary);
		};
		return {
			...output,
			video: encode(output.video),
			references: output.references.map((reference) => ({
				...reference,
				rgba: encode(reference.rgba),
			})),
		};
	});
	if (result.error) throw Error(redact(result.error + "\n" + result.stack));
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(result.frameCount, 6);
	assert.equal(result.mimeType, "video/webm");
	assert.equal(result.width, source.width);
	assert.equal(result.height, source.height);
	assert.deepEqual(result.frameRate, { numerator: 30, denominator: 1 });
	assert.deepEqual(result.limits, {
		meanRgbError: 12,
		activeMeanRgbError: 18,
		activeChannelThreshold: 8,
	});
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
	const { video: _video, references: _references, ...summary } = result;
	await writeJson(join(root, "browser-export-evidence.json"), {
		...summary,
		browser: browser.version(),
		references: references.map(({ rgba, ...reference }) => ({
			...reference,
			bytes: rgba.length,
			sha256: hash(rgba),
		})),
	});
	decoded = await verifyVideo({
		root,
		ffmpeg: options.ffmpeg,
		ffprobe: options.ffprobe,
		width: source.width,
		height: source.height,
		references,
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
				copiedManifest,
				"Private project changed during read-only export",
			);
			await writeJson(join(root, "project-stability.json"), {
				sourceUnchanged: true,
				copyUnchanged: true,
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
	throw Error(redact(failure));
}
const artifacts = [];
for (const name of [
	"particle.webm",
	"decoded.rgba",
	"persisted-source.json",
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
	scope: `Exact copy of retained FileProjectStore -> actual persisted particle source -> real Host ${sourceBackend} frames -> CanvasRenderer/SceneExporter -> six-frame WebM -> independent FFmpeg decode. Not attached-editor or full-project/clip-opacity export.`,
	sourceBackend,
	clipId: options["clip-id"],
	sourceProject: options["source-project"],
	copiedProjectSha256: copiedManifest.files.find(
		(file) => file.path === "project.json",
	).sha256,
	frameCount: 6,
	frameRate: source.frameRate,
	width: source.width,
	height: source.height,
	independentDecode: decoded,
	browserClosed,
	hostLifecycle,
	hostChildren: await readJson(join(root, "host-children.json")),
	externalRequests,
	artifacts,
	originalProjectUnmodified: true,
	privateCopyUnmodified: true,
	artifactsRetained: true,
	processBoundary:
		"Host direct-child observations plus awaited Playwright browser.close; no arbitrary descendant-tree shutdown inference",
});
console.log(
	JSON.stringify({
		status: "passed",
		root,
		evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
	}),
);
