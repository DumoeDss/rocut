import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadAfterimageReference } from "./fixtures/mv-afterimage-reference.ts";
import { decodeAfterimage } from "./fixtures/mv-afterimage-decode.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!isolated || !isAbsolute(isolated) || !referenceRoot || !ffmpeg || !ffprobe)
	throw Error(
		"Provide isolated ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_MV_REFERENCE and native ROCUT_TEST_FFMPEG/FFPROBE",
	);
const reference = await loadAfterimageReference(referenceRoot),
	artifacts = await mkdtemp(join(tmpdir(), "rocut-afterimage-")),
	output = join(artifacts, "web");
console.log(JSON.stringify({ artifacts }));
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-afterimage-browser",
);
const font = await readFile(
	join(root, "apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"),
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
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage({
			viewport: { width: 1940, height: 480 },
		}),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript((data) => {
		window.__afterimageReference = data;
	}, reference);
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		if (url.pathname === "/afterimage-font.ttf")
			return route.fulfill({
				status: 200,
				contentType: "font/ttf",
				body: font,
			});
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-afterimage-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__mvAfterimage, undefined, {
		timeout: 180000,
	});
	const { bytes, expectations, ...result } = await page.evaluate(
		() => globalThis.__mvAfterimage,
	);
	await page.screenshot({
		path: join(artifacts, "comparison.png"),
		fullPage: true,
	});
	await writeFile(
		join(artifacts, "browser-evidence.json"),
		JSON.stringify(
			{ ...result, errors, browser: await browser.version() },
			null,
			2,
		),
	);
	if (!result.passed || errors.length)
		throw Error(JSON.stringify({ ...result, errors, artifacts }));
	const file = join(artifacts, "afterimage.webm");
	await writeFile(file, Buffer.from(bytes));
	await writeFile(
		join(artifacts, "expected.json"),
		JSON.stringify(expectations),
	);
	const decoded = decodeAfterimage({ file, ffmpeg, ffprobe, expectations });
	const report = {
		...result,
		decoded,
		exportedBytes: bytes.length,
		artifacts,
		wasm: isolated,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser?.close();
	await server.close();
}
