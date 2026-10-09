import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";
import { loadTitleRiffFontInventory } from "./fixtures/mv-title-riff-reference-inventory.mjs";

const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
if (!referenceRoot || !isAbsolute(referenceRoot)) throw Error("Provide absolute ROCUT_TEST_MV_REFERENCE");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const inventory = await loadTitleRiffFontInventory(root, process.env.ROCUT_TEST_TITLE_RIFF_GOTHIC500);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-title-riff-oracle-"));
console.log(JSON.stringify({ artifacts, scope: "Complete unmodified original oracle only; no Rocut parity or export claim" }));
const server = await createServer({ root, configFile: false, logLevel: "error", cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] }, server: { host: "127.0.0.1", hmr: false, port: 0 },
	plugins: [{ name: "private-title-riff-font-fixtures", configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const bytes = inventory.files.get(req.url);
			if (!bytes || !["GET", "HEAD"].includes(req.method)) return next();
			res.setHeader("Content-Type", "font/ttf"); res.setHeader("Content-Length", bytes.length); res.setHeader("Cache-Control", "no-store");
			res.end(req.method === "HEAD" ? undefined : bytes);
		});
	} }],
});
let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({ headless: true, args: ["--disable-gpu-rasterization"] });
	const page = await browser.newPage({ viewport: { width: 1000, height: 850 } }), errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => { const url = new URL(route.request().url()); return /^https?:$/.test(url.protocol) && url.origin !== origin ? route.abort() : route.continue(); });
	await page.addInitScript(({ reference, fonts }) => { globalThis.__titleRiffReference = reference; globalThis.__titleRiffFonts = fonts; }, { reference, fonts: inventory.fonts });
	await page.goto(`${origin}/script/fixtures/mv-title-riff-reference-smoke.html`, { waitUntil: "commit" });
	try { await page.waitForFunction(() => globalThis.__titleRiffOracleResult, undefined, { timeout: 180000 }); }
	catch (error) {
		const progress = await page.evaluate(() => globalThis.__titleRiffOracleProgress).catch(() => null);
		await writeFile(join(artifacts, "verification.json"), JSON.stringify({ passed: false, error: String(error), errors, progress, fontInventory: inventory.provenance }, null, 2));
		throw error;
	}
	const result = await page.evaluate(() => globalThis.__titleRiffOracleResult);
	await page.screenshot({ path: join(artifacts, "original-title-riff.png"), fullPage: true });
	const report = { ...result, passed: result.passed && !errors.length, errors, artifacts, browser: await browser.version(), fontInventory: inventory.provenance };
	await writeFile(join(artifacts, "verification.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ ...report, hashes: undefined, provenance: undefined, fontInventory: undefined }, null, 2));
	if (!report.passed) throw Error("Original titleRiff oracle failed; inspect retained evidence");
} finally { await browser?.close(); await server.close(); }
