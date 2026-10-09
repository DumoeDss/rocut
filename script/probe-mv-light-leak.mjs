import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { lightLeakReference } from "./fixtures/mv-light-leak-reference.ts";
import { verifyLightLeakExport } from "./fixtures/mv-light-leak-verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE,
	ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!isolated || !isAbsolute(isolated) || !referenceRoot || !ffmpeg || !ffprobe)
	throw Error(
		"Provide isolated ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_MV_REFERENCE and native ROCUT_TEST_FFMPEG/FFPROBE",
	);
const oracle = await lightLeakReference(referenceRoot),
	artifacts = await mkdtemp(join(tmpdir(), "rocut-mv-light-leak-")),
	output = join(artifacts, "web");
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-light-leak-browser",
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
		executablePath: chromium.executablePath(),
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(`window.__lightLeakReference=${oracle.code};`);
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			await route.abort();
		else await route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-light-leak-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__mvLightLeak, undefined, {
		timeout: 180000,
	});
	const { bytes, expectations, ...result } = await page.evaluate(
		() => globalThis.__mvLightLeak,
	);
	await writeFile(
		join(artifacts, "browser-evidence.json"),
		JSON.stringify(
			{
				...result,
				errors,
				browser: await browser.version(),
				oracle: oracle.provenance,
			},
			null,
			2,
		),
	);
	if (!result.passed || errors.length)
		throw Error(JSON.stringify({ ...result, errors, artifacts }));
	const file = join(artifacts, "light-leak.webm");
	await writeFile(file, Buffer.from(bytes));
	const decoded = verifyLightLeakExport({
		file,
		ffmpeg,
		ffprobe,
		expectations,
	});
	const report = {
		...result,
		decoded,
		exportedBytes: bytes.length,
		oracle: oracle.provenance,
		artifacts,
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
