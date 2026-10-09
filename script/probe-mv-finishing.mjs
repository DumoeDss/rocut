import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyFinishingExport } from "./fixtures/mv-finishing-verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!isolated || !isAbsolute(isolated) || !ffmpeg || !ffprobe)
	throw Error(
		"Provide isolated ROCUT_TEST_WASM_DIRECTORY and native ROCUT_TEST_FFMPEG/FFPROBE",
	);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-mv-finishing-")),
	output = join(artifacts, "web");
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-finishing-browser",
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
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text().slice(0, 1000));
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			await route.abort();
		else await route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-finishing-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__mvFinishing, undefined, {
		timeout: 180000,
	});
	const { bytes, ...result } = await page.evaluate(
		() => globalThis.__mvFinishing,
	);
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
	const file = join(artifacts, "finishing.webm");
	await writeFile(file, Buffer.from(bytes));
	const decoded = verifyFinishingExport({ file, ffmpeg, ffprobe });
	const report = { ...result, decoded, exportedBytes: bytes.length, artifacts };
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser?.close();
	await server.close();
}
