import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, chromium } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { variableFontFixture } from "./fixtures/programmatic-font-axes-fixture.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!isolated || !isAbsolute(isolated))
	throw Error(
		"Provide absolute private ROCUT_TEST_WASM_DIRECTORY for image/font resource admission",
	);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-font-metrics-"));
const output = join(artifacts, "web"),
	font = await variableFontFixture("TEST");
console.log(JSON.stringify({ artifacts }));
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"programmatic-font-metrics-browser",
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
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		if (url.pathname === "/metrics-font.ttf")
			return route.fulfill({
				status: 200,
				contentType: "font/ttf",
				body: font,
			});
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/programmatic-font-metrics-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__fontMetrics, undefined, {
		timeout: 60000,
	});
	const result = await page.evaluate(() => globalThis.__fontMetrics);
	const report = {
		...result,
		errors,
		browser: await browser.version(),
		artifacts,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
	if (!result.passed || errors.length)
		throw Error("Font metric bridge browser verification failed");
} finally {
	await browser?.close();
	await server.close();
}
