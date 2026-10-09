import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadFallReference } from "./fixtures/mv-fall-reference.ts";
import { startFallProgress } from "./fixtures/mv-fall-progress.mjs";
import {
	attachFallOracleArtifacts,
	decodeFall,
} from "./fixtures/mv-fall-artifacts.mjs";
import {
	fallWasmIdentity,
	fallServedIdentity,
	assertFallEvidenceStable,
} from "./fixtures/mv-fall-evidence.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--browser-only"))
	throw Error("Use no arguments for full Fall parity/export or --browser-only");
const exportEnabled = args.length === 0;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	exportEnabled &&
	(!ffmpeg || !isAbsolute(ffmpeg) || !ffprobe || !isAbsolute(ffprobe))
)
	throw Error("Full Fall export requires absolute ROCUT_TEST_FFMPEG/FFPROBE");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const original = process.env.ROCUT_TEST_MV_REFERENCE,
	wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!original || !isAbsolute(original) || !wasm || !isAbsolute(wasm))
	throw Error("Supply absolute reference checkout and private WASM directory");
const reference = await loadFallReference(original);
const artifactIdentity = await fallWasmIdentity(wasm);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-fall-native-"));
const output = join(artifacts, "web");
console.log(
	JSON.stringify({
		artifacts,
		scope: exportEnabled
			? "complete unchanged dark.js Fall native pixel parity and real GPU/encoder/decode"
			: "complete unchanged dark.js Fall native pixel parity only",
	}),
);
await buildNativeAudioExportProbe(root, wasm, output, "mv-fall-native-browser");
const servedIdentity = await fallServedIdentity(output);
const server = await createServer({
	root: output,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", hmr: false, port: 0 },
});
let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage({
			viewport: { width: 1940, height: 850 },
		}),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const frames = exportEnabled
		? await attachFallOracleArtifacts(page, artifacts)
		: new Set();
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		return /^https?:$/.test(url.protocol) && url.origin !== origin
			? route.abort()
			: route.continue();
	});
	await page.addInitScript(
		({ reference, exportEnabled }) => {
			globalThis.__fallReference = reference;
			globalThis.__fallExportEnabled = exportEnabled;
		},
		{ reference, exportEnabled },
	);
	await page.goto(`${origin}/script/fixtures/mv-fall-native-browser.html`, {
		waitUntil: "commit",
	});
	let result;
	const stopProgress = startFallProgress(page);
	try {
		await page.waitForFunction(() => globalThis.__fallResult, undefined, {
			timeout: 900000,
		});
		result = await page.evaluate(() => globalThis.__fallResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: await page
				.evaluate(() => globalThis.__fallProgress)
				.catch(() => null),
		};
	} finally {
		stopProgress();
	}
	await page.screenshot({
		path: join(artifacts, "comparison.png"),
		fullPage: true,
	});
	const report = {
		...result,
		passed: result.passed && !errors.length,
		errors,
		artifacts,
		wasm,
		artifactIdentity,
		servedIdentity,
		referenceIdentity: {
			root: original,
			scripts: reference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
		},
		browser: await browser.version(),
	};
	const bytes = report.bytes;
	delete report.bytes;
	if (exportEnabled && report.passed) {
		try {
			if (frames.size !== 12 || !Array.isArray(bytes) || !bytes.length)
				throw Error("Missing Fall oracle PNGs or encoded bytes");
			const file = join(artifacts, "fall.webm");
			await writeFile(file, Buffer.from(bytes), { flag: "wx" });
			report.decoded = decodeFall({
				file,
				ffmpeg,
				ffprobe,
				oracleDirectory: artifacts,
			});
			report.passed = report.decoded.passed;
			report.independentDecodeTested = true;
			report.exportedBytes = bytes.length;
		} catch (error) {
			report.passed = false;
			report.decodeError = String(error);
		}
	}
	try {
		assertFallEvidenceStable(
			artifactIdentity,
			await fallWasmIdentity(wasm),
			"Private WASM/glue",
		);
		assertFallEvidenceStable(
			servedIdentity,
			await fallServedIdentity(output),
			"Served bundle",
		);
		const currentReference = await loadFallReference(original);
		assertFallEvidenceStable(
			reference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
			currentReference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
			"Full original reference files",
		);
		report.inputIdentityStable = true;
	} catch (error) {
		report.passed = false;
		report.inputIdentityStable = false;
		report.identityError = String(error);
	}
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(
		JSON.stringify({
			passed: report.passed,
			violations: report.violations,
			error: report.error,
			decodeError: report.decodeError,
			identityError: report.identityError,
			exportTested: report.exportTested,
			exportedBytes: report.exportedBytes,
			progress: report.progress?.current,
			observations: Object.keys(report.observations ?? {}).length,
			artifacts,
			errors,
		}),
	);
	if (!report.passed)
		throw Error("Fall parity failed; inspect retained evidence");
} finally {
	await browser?.close();
	await server.close();
}
