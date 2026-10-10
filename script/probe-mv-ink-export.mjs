import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadInkReference } from "./fixtures/mv-ink-reference.ts";
import {
	fallWasmIdentity,
	fallServedIdentity,
} from "./fixtures/mv-fall-evidence.mjs";
import { buildInkExport } from "./fixtures/mv-ink-export-build.mjs";
import {
	inkFileIdentity,
	inkRustIdentity,
} from "./fixtures/mv-ink-export-identities.mjs";
import {
	attachInkExportOracleArtifacts,
	attachInkExportVideoDownload,
	decodeInkExport,
} from "./fixtures/mv-ink-export-artifacts.mjs";

assert.equal(
	process.argv.length,
	2,
	"Ink real export has no browser-only shortcut",
);
const original = process.env.ROCUT_TEST_MV_REFERENCE;
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
const browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
assert.ok(
	[original, isolated, rustSource, ffmpeg, ffprobe, browserExecutable].every(
		(path) => path && isAbsolute(path),
	),
	"Supply absolute reference/private WASM/private Rust source/FFmpeg/FFprobe/browser paths",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = await mkdtemp(join(tmpdir(), "rocut-ink-export-"));
const web = join(artifact, "web");
const reference = await loadInkReference({ root: original });
const wasmIdentity = await fallWasmIdentity(isolated);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
};
const rustIdentity = await inkRustIdentity(rustOptions);
const tools = [ffmpeg, ffprobe, browserExecutable];
const binaries = await Promise.all(
	tools.map(async (path) => ({ path, ...(await inkFileIdentity(path)) })),
);
const driverPaths = [
	"script/probe-mv-ink-export.mjs",
	"script/fixtures/mv-ink-export-build.mjs",
	"script/fixtures/mv-ink-export-identities.mjs",
	"script/fixtures/mv-ink-export-artifacts.mjs",
	"script/fixtures/mv-ink-export-video-download.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/mv-ink-reference.ts",
	"script/fixtures/mv-ink-contract.ts",
	"script/fixtures/mv-fall-evidence.mjs",
];
const sources = new Map(
	await Promise.all(
		driverPaths.map(async (path) => [
			path,
			(await inkFileIdentity(join(root, path))).sha256,
		]),
	),
);
console.log(
	JSON.stringify({
		artifact,
		scope:
			"Real 421-frame 1080p Ink preview/export and independent full-frame video decode; not installed Electron or a whole MV",
	}),
);
let browser, server, videoTransport;
try {
	for (const input of await buildInkExport({ root, isolated, output: web })) {
		if (sources.has(input.path))
			assert.equal(
				sources.get(input.path),
				input.sha256,
				"Driver/loaded-source disagreement",
			);
		sources.set(input.path, input.sha256);
	}
	const servedIdentity = await fallServedIdentity(web);
	server = await createServer({
		root: web,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifact, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: browserExecutable,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage({ acceptDownloads: true }),
		errors = [],
		externalRequests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const crashed = new Promise((_, reject) => {
		page.once("crash", () => reject(Error("Ink export renderer crashed")));
		page.once("close", () => reject(Error("Ink export page closed")));
		browser.once("disconnected", () =>
			reject(Error("Ink export browser disconnected")),
		);
	});
	void crashed.catch(() => {});
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			externalRequests.push(route.request().url());
			return route.abort();
		}
		return route.continue();
	});
	const oracleFrames = await attachInkExportOracleArtifacts(page, artifact);
	videoTransport = await attachInkExportVideoDownload({
		page,
		directory: artifact,
	});
	await page.addInitScript((value) => {
		globalThis.__inkExportReference = value;
	}, reference);
	await page.goto(`${origin}/script/fixtures/mv-ink-export-browser.html`, {
		waitUntil: "commit",
	});
	let reading = false;
	let lastProgress;
	const timer = setInterval(async () => {
		if (reading) return;
		reading = true;
		try {
			lastProgress = await page.evaluate(() => globalThis.__inkExportProgress);
			console.log(
				JSON.stringify({
					event: "ink-export-progress",
					progress: lastProgress,
				}),
			);
		} catch {
			/* Completion and identity gates below remain authoritative. */
		} finally {
			reading = false;
		}
	}, 30000);
	timer.unref();
	let result;
	let deadlineTimer;
	try {
		const ready = (async () => {
			await page.waitForFunction(
				() => globalThis.__inkExportResult,
				undefined,
				{ timeout: 1200000 },
			);
			return page.evaluate(() => globalThis.__inkExportResult);
		})();
		const deadline = new Promise((_, reject) => {
			deadlineTimer = setTimeout(
				() => reject(Error("Ink export result/transport exceeded 1200000ms")),
				1200000,
			);
		});
		result = await Promise.race([
			ready,
			crashed,
			deadline,
			videoTransport.done.then(() => ready),
		]);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: lastProgress,
		};
	} finally {
		clearInterval(timer);
		clearTimeout(deadlineTimer);
	}
	const report = {
		artifact,
		scope:
			"Ink real preview/SceneExporter/WebM/independent FFmpeg full-frame decode, synthetic declared markers; no installed Electron or full MV",
		browser: browser.version(),
		browserExecutable,
		result,
		errors,
		externalRequests,
		wasmIdentity,
		rustIdentity,
		servedIdentity,
		binaries,
		sourceInputs: [...sources].map(([path, sha256]) => ({ path, sha256 })),
		referenceSources: reference.scripts.map(({ id, sha256 }) => ({
			id,
			sha256,
		})),
	};
	try {
		assert.equal(
			result.passed,
			true,
			result.error ?? "Ink export browser failed",
		);
		assert.deepEqual(errors, []);
		assert.deepEqual(externalRequests, []);
		assert.deepEqual(result.exportSize, { width: 1920, height: 1080 });
		assert.equal(result.fps, 60);
		assert.equal(result.frameCount, 421);
		assert.equal(result.sourceFrames, 408);
		assert.equal(result.repeats, 48);
		assert.equal(result.videoQuantizer, 0);
		assert.equal(result.videoChroma, "444");
		assert.deepEqual(
			result.blankFrames,
			Array.from({ length: 13 }, (_, index) => index * 35),
		);
		assert.equal(result.exportTested, true);
		assert.equal(result.independentDecodeTested, false);
		assert.equal(result.thresholds.maxChannelAtMost, 2);
		assert.equal(result.thresholds.maeLessThan, 0.025);
		assert.equal(result.thresholds.repeatMax, 0);
		assert.equal(result.gpuObservations.length, 421);
		assert.equal(result.oracleFrames.length, 421);
		assert.equal(oracleFrames.size, 421);
		assert.equal(Object.hasOwn(result, "bytes"), false);
		const downloaded = await Promise.race([videoTransport.done, crashed]);
		assert.deepEqual(downloaded.metadata, result.encodedVideo);
		const file = join(artifact, "ink.webm");
		assert.equal(downloaded.file, file);
		report.videoIdentity = await inkFileIdentity(file);
		assert.equal(
			report.videoIdentity.byteLength,
			result.encodedVideo.byteLength,
		);
		assert.equal(report.videoIdentity.sha256, result.encodedVideo.sha256);
		report.decoded = await decodeInkExport({
			file,
			ffmpeg,
			ffprobe,
			oracleDirectory: artifact,
		});
		assert.equal(
			report.decoded.passed,
			true,
			JSON.stringify(report.decoded.violations),
		);
		for (const [path, sha256] of sources)
			assert.equal(
				(await inkFileIdentity(join(root, path))).sha256,
				sha256,
				"Source changed during Ink export acceptance",
			);
		assert.deepEqual(
			await loadInkReference({ root: original }),
			reference,
			"Original scripts changed",
		);
		assert.deepEqual(
			await fallWasmIdentity(isolated),
			wasmIdentity,
			"Private WASM changed",
		);
		assert.deepEqual(
			await inkRustIdentity(rustOptions),
			rustIdentity,
			"Private Rust/current producer changed",
		);
		assert.deepEqual(
			await fallServedIdentity(web),
			servedIdentity,
			"Served export bundle changed",
		);
		assert.deepEqual(
			await Promise.all(
				tools.map(async (path) => ({
					path,
					...(await inkFileIdentity(path)),
				})),
			),
			binaries,
			"Decoder/browser binary changed",
		);
		assert.deepEqual(
			await inkFileIdentity(file),
			report.videoIdentity,
			"Exported video changed during acceptance",
		);
		assert.equal(videoTransport.state.error, null);
		assert.equal(videoTransport.state.downloadCount, 1);
		assert.equal(videoTransport.state.acknowledged, true);
		assert.equal(videoTransport.state.completed, true);
		report.binaryTransport = { ...videoTransport.state };
		report.sourceIdentityStable = true;
		report.productionAcceptancePassed = true;
	} catch (error) {
		report.productionAcceptancePassed = false;
		report.failure = String(error?.stack ?? error);
	}
	report.binaryTransport = { ...videoTransport.state };
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			artifact,
			passed: report.productionAcceptancePassed,
			decoded: report.decoded?.passed,
			failure: report.failure?.split("\n")[0],
			errors,
			externalRequests,
		}),
	);
	assert.equal(
		report.productionAcceptancePassed,
		true,
		report.failure?.slice(0, 1200),
	);
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		String(error?.stack ?? error),
		{ flag: "wx" },
	);
	throw error;
} finally {
	videoTransport?.dispose();
	await browser?.close();
	await server?.close();
}
