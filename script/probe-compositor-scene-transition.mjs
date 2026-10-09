import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";

const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (process.argv.length !== 2 || !wasm || !isAbsolute(wasm))
	throw Error(
		"Use no arguments and an absolute private ROCUT_TEST_WASM_DIRECTORY",
	);
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("Scene transition artifacts require private TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(join(tmpdir(), "rocut-scene-transition-")),
	output = join(artifacts, "web");
console.log(
	JSON.stringify({
		artifacts,
		wasm,
		scope: "Actual public WASM scene-transition admission and pixels",
	}),
);
await buildNativeAudioExportProbe(
	root,
	wasm,
	output,
	"compositor-scene-transition-browser",
);
const server = await createServer({
	root: output,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", port: 0, hmr: false },
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
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		return /^https?:$/.test(url.protocol) && url.origin !== origin
			? route.abort()
			: route.continue();
	});
	await page.goto(
		`${origin}/script/fixtures/compositor-scene-transition-browser.html`,
		{ waitUntil: "commit" },
	);
	let result;
	try {
		await page.waitForFunction(
			() => globalThis.__sceneTransitionResult,
			undefined,
			{ timeout: 60000 },
		);
		result = await page.evaluate(() => globalThis.__sceneTransitionResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			checks: await page
				.evaluate(() => globalThis.__sceneTransitionProgress)
				.catch(() => null),
		};
	}
	const report = {
		...result,
		passed: result.passed && !errors.length,
		errors,
		wasm,
		artifacts,
		browser: await browser.version(),
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(JSON.stringify(report));
	if (!report.passed) process.exitCode = 1;
} finally {
	if (browser) await browser.close();
	await server.close();
}
