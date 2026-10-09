import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadKanjiSlamReference } from "./fixtures/mv-kanji-slam-reference.ts";
import { loadKanjiFontInventory } from "./fixtures/mv-kanji-slam-reference-inventory.mjs";

const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
if (!referenceRoot || !isAbsolute(referenceRoot))
	throw Error("Provide absolute ROCUT_TEST_MV_REFERENCE");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadKanjiSlamReference(referenceRoot);
const inventory = await loadKanjiFontInventory(
	root,
	process.env.ROCUT_TEST_KANJI_SLAM_MINCHO700,
);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-kanji-slam-oracle-"));
console.log(
	JSON.stringify({
		artifacts,
		scope: "Complete original oracle only; no Rocut parity/export claim",
	}),
);
const server = await createServer({
	root,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", hmr: false, port: 0 },
	plugins: [
		{
			name: "private-kanji-font-fixtures",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					const bytes = inventory.files.get(req.url);
					if (!bytes || !["GET", "HEAD"].includes(req.method)) return next();
					res.setHeader("Content-Type", "font/ttf");
					res.setHeader("Content-Length", bytes.length);
					res.setHeader("Cache-Control", "no-store");
					res.end(req.method === "HEAD" ? undefined : bytes);
				});
			},
		},
	],
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
			viewport: { width: 1000, height: 850 },
		}),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		return /^https?:$/.test(url.protocol) && url.origin !== origin
			? route.abort()
			: route.continue();
	});
	await page.addInitScript(
		({ reference, fonts }) => {
			globalThis.__kanjiReference = reference;
			globalThis.__kanjiFonts = fonts;
		},
		{ reference, fonts: inventory.fonts },
	);
	await page.goto(
		`${origin}/script/fixtures/mv-kanji-slam-reference-smoke.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(
			() => globalThis.__kanjiOracleResult,
			undefined,
			{ timeout: 180000 },
		);
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__kanjiOracleProgress)
			.catch(() => null);
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify(
				{
					passed: false,
					error: String(error),
					errors,
					progress,
					fontInventory: inventory.provenance,
				},
				null,
				2,
			),
		);
		throw error;
	}
	const result = await page.evaluate(() => globalThis.__kanjiOracleResult);
	await page.screenshot({
		path: join(artifacts, "original-kanji-slam.png"),
		fullPage: true,
	});
	const report = {
		...result,
		passed: result.passed && !errors.length,
		errors,
		artifacts,
		browser: await browser.version(),
		fontInventory: inventory.provenance,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				...report,
				hashes: undefined,
				provenance: undefined,
				fontInventory: undefined,
			},
			null,
			2,
		),
	);
	if (!report.passed)
		throw Error("Original kanjiSlam oracle failed; inspect retained evidence");
} finally {
	await browser?.close();
	await server.close();
}
