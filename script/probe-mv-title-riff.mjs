import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";
import { loadTitleRiffFontInventory } from "./fixtures/mv-title-riff-reference-inventory.mjs";
import { attachTitleRiffOracleArtifacts } from "./fixtures/mv-title-riff-native-artifacts.mjs";
import { decodeTitleRiff } from "./fixtures/mv-title-riff-native-decode.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--browser-only"))
	throw Error(
		"Use no arguments for full titleRiff parity/export or --browser-only",
	);
const exportEnabled = args.length === 0;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	exportEnabled &&
	(!ffmpeg || !isAbsolute(ffmpeg) || !ffprobe || !isAbsolute(ffprobe))
)
	throw Error(
		"Full titleRiff export requires absolute ROCUT_TEST_FFMPEG/FFPROBE",
	);
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!referenceRoot || !isAbsolute(referenceRoot) || !wasm || !isAbsolute(wasm))
	throw Error(
		"Provide absolute ROCUT_TEST_MV_REFERENCE and private ROCUT_TEST_WASM_DIRECTORY",
	);
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("Native titleRiff artifacts require private TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const inventory = await loadTitleRiffFontInventory(
	root,
	process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500,
);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-title-riff-native-")),
	output = join(artifacts, "web");
console.log(
	JSON.stringify({
		artifacts,
		scope: exportEnabled
			? "Native complete intro/outro pixel parity and real export"
			: "Native complete intro/outro pixel parity only",
	}),
);
await buildNativeAudioExportProbe(
	root,
	wasm,
	output,
	"mv-title-riff-native-browser",
);
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
		? await attachTitleRiffOracleArtifacts(page, artifacts)
		: new Set();
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin)
			return route.abort();
		const bytes = inventory.files.get(url.pathname);
		return bytes
			? route.fulfill({ status: 200, contentType: "font/ttf", body: bytes })
			: route.continue();
	});
	await page.addInitScript(
		({ reference, fonts, exportEnabled, diagnosticEnabled }) => {
			globalThis.__titleRiffReference = reference;
			globalThis.__titleRiffFonts = fonts;
			globalThis.__titleRiffExportEnabled = exportEnabled;
			globalThis.__titleRiffDiagnosticEnabled = diagnosticEnabled;
		},
		{
			reference,
			fonts: inventory.fonts,
			exportEnabled,
			diagnosticEnabled: process.env.ROCUT_TEST_TITLE_RIFF_DIAGNOSTIC === "1",
		},
	);
	await page.goto(
		`${origin}/script/fixtures/mv-title-riff-native-browser.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(
			() => globalThis.__titleRiffNativeResult,
			undefined,
			{ timeout: 300000 },
		);
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__titleRiffNativeProgress)
			.catch(() => null);
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify(
				{
					passed: false,
					error: String(error),
					errors,
					progress,
					wasm,
					fontInventory: inventory.provenance,
				},
				null,
				2,
			),
		);
		throw error;
	}
	const { bytes, ...result } = await page.evaluate(
		() => globalThis.__titleRiffNativeResult,
	);
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
		browser: await browser.version(),
		fontInventory: inventory.provenance,
	};
	if (exportEnabled && report.passed) {
		const file = join(artifacts, "title-riff.webm");
		try {
			if (frames.size !== 12 || !bytes?.length)
				throw Error("Missing titleRiff oracle PNGs or encoded output");
			await writeFile(file, Buffer.from(bytes), { flag: "wx" });
			report.decoded = decodeTitleRiff({
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
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				passed: report.passed,
				violations: report.violations,
				error: report.error,
				decodeError: report.decodeError,
				exportTested: report.exportTested,
				exportedBytes: report.exportedBytes,
				decodePassed: report.decoded?.passed,
				progress: report.progress?.current,
				samples: Object.keys(report.observations ?? {}).length,
				negatives: Object.keys(report.negatives ?? {}).length,
				artifacts,
				errors,
			},
			null,
			2,
		),
	);
	if (!report.passed)
		throw Error("Native titleRiff parity failed; inspect retained evidence");
} finally {
	await browser?.close();
	await server.close();
}
