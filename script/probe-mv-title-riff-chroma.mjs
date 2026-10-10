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

const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE,
	wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (process.argv.length !== 2)
	throw Error("Supplemental title444 probe accepts no arguments");
if (
	[referenceRoot, wasm, ffmpeg, ffprobe].some(
		(path) => !path || !isAbsolute(path),
	)
)
	throw Error(
		"Provide absolute ROCUT_TEST_MV_REFERENCE/WASM_DIRECTORY/FFMPEG/FFPROBE",
	);
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("TitleRiff artifacts require private TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const inventory = await loadTitleRiffFontInventory(
	root,
	process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500,
);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-title-chroma-")),
	output = join(artifacts, "web");
console.log(
	JSON.stringify({
		artifacts,
		scope:
			"Supplemental explicit444 production export; default420 baseline unchanged",
	}),
);
await buildNativeAudioExportProbe(
	root,
	wasm,
	output,
	"mv-title-riff-chroma-browser",
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
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const frames = await attachTitleRiffOracleArtifacts(page, artifacts);
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
		({ reference, fonts }) => {
			globalThis.__titleRiffReference = reference;
			globalThis.__titleRiffFonts = fonts;
		},
		{ reference, fonts: inventory.fonts },
	);
	await page.goto(
		`${origin}/script/fixtures/mv-title-riff-chroma-browser.html`,
		{ waitUntil: "commit" },
	);
	let result;
	try {
		await page.waitForFunction(
			() => globalThis.__titleRiffChromaResult,
			undefined,
			{ timeout: 300000 },
		);
		result = await page.evaluate(() => globalThis.__titleRiffChromaResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: await page
				.evaluate(() => globalThis.__titleRiffChromaProgress)
				.catch(() => null),
		};
	}
	const { bytes, ...summary } = result;
	const report = {
		...summary,
		passed: result.passed && !errors.length,
		errors,
		artifacts,
		wasm,
		browser: await browser.version(),
		fontInventory: inventory.provenance,
	};
	if (report.passed) {
		try {
			if (frames.size !== 12 || !bytes?.length)
				throw Error("Missing supplemental video or original PNGs");
			const file = join(artifacts, "title-riff-444.webm");
			await writeFile(file, Buffer.from(bytes), { flag: "wx" });
			report.exportedBytes = bytes.length;
			report.decoded = decodeTitleRiff({
				file,
				ffmpeg,
				ffprobe,
				oracleDirectory: artifacts,
			});
			report.independentDecodeTested = true;
			report.chromaVerified = report.decoded.pixelFormat === "yuv444p";
			report.passed = report.decoded.passed && report.chromaVerified;
		} catch (error) {
			report.passed = false;
			report.decodeError = String(error);
		}
	}
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			passed: report.passed,
			error: report.error,
			decodeError: report.decodeError,
			chromaVerified: report.chromaVerified,
			decoded: report.decoded,
			exportedBytes: report.exportedBytes,
			artifacts,
		}),
	);
	if (!report.passed) process.exitCode = 1;
} finally {
	if (browser) await browser.close();
	await server.close();
}
