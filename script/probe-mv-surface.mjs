import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { variableFontFixture } from "./fixtures/programmatic-font-axes-fixture.ts";

if (process.argv.length !== 2 || !/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("Use no arguments and private TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(join(tmpdir(), "rocut-surface-"));
const font = await variableFontFixture("TEST");
console.log(JSON.stringify({ artifacts }));
const server = await createServer({
	root,
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
		if (url.pathname === "/surface-font.ttf")
			return route.fulfill({
				status: 200,
				contentType: "font/ttf",
				body: font,
			});
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-surface-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__mvSurface, undefined, {
		timeout: 60000,
	});
	const result = await page.evaluate(() => globalThis.__mvSurface);
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
		throw Error("Native surface raster verification failed");
} finally {
	await browser?.close();
	await server.close();
}
