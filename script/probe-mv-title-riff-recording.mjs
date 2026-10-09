import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";
import { loadTitleRiffFontInventory } from "./fixtures/mv-title-riff-reference-inventory.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--check-inputs"))
	throw Error(
		"Use no arguments for the recording matrix or --check-inputs for read-only preflight",
	);
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!referenceRoot || !isAbsolute(referenceRoot) || !wasm || !isAbsolute(wasm))
	throw Error(
		"Provide absolute ROCUT_TEST_MV_REFERENCE and private ROCUT_TEST_WASM_DIRECTORY",
	);
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("TitleRiff artifacts require private TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const inventory = await loadTitleRiffFontInventory(
	root,
	process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500,
);
if (args[0] === "--check-inputs") {
	console.log(
		JSON.stringify({
			passed: true,
			fonts: inventory.fonts.length,
			referenceLoaded: true,
			wasm,
			note: "Read-only preflight; no build/browser/export and no WASM freshness claim",
		}),
	);
} else {
	const artifacts = await mkdtemp(join(tmpdir(), "rocut-title-recording-"));
	const output = join(artifacts, "web");
	console.log(
		JSON.stringify({
			artifacts,
			scope: "Additional titleRiff recording boundary oracle matrix",
		}),
	);
	await buildNativeAudioExportProbe(
		root,
		wasm,
		output,
		"mv-title-riff-recording-browser",
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
		// Identical raster flag to the established baseline; never alter pin limits.
		browser = await chromium.launch({
			headless: true,
			args: ["--disable-gpu-rasterization"],
		});
		const page = await browser.newPage(),
			errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
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
			`${origin}/script/fixtures/mv-title-riff-recording-browser.html`,
			{ waitUntil: "commit" },
		);
		let result;
		try {
			await page.waitForFunction(
				() => globalThis.__titleRiffRecordingResult,
				undefined,
				{ timeout: 600000 },
			);
			result = await page.evaluate(() => globalThis.__titleRiffRecordingResult);
		} catch (error) {
			result = {
				passed: false,
				error: String(error),
				progress: await page
					.evaluate(() => globalThis.__titleRiffRecordingProgress)
					.catch(() => null),
			};
		}
		const report = {
			...result,
			passed: result.passed && !errors.length,
			errors,
			artifacts,
			wasm,
			browser: await browser.version(),
			fontInventory: inventory.provenance,
		};
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify(report, null, 2),
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				passed: report.passed,
				error: report.error,
				violations: report.violations,
				observations: report.observations,
				artifacts,
			}),
		);
		if (!report.passed) process.exitCode = 1;
	} finally {
		if (browser) await browser.close();
		await server.close();
	}
}
