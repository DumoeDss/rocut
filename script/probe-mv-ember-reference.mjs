import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";

const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
if (!referenceRoot || !isAbsolute(referenceRoot))
	throw Error("Provide absolute ROCUT_TEST_MV_REFERENCE");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-ember-oracle-"));
console.log(
	JSON.stringify({
		artifacts,
		scope: "original oracle only; no Rocut parity claim",
	}),
);
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
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage({
		viewport: { width: 1000, height: 1100 },
	});
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		return /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1"
			? route.abort()
			: route.continue();
	});
	await page.addInitScript((reference) => {
		globalThis.__emberReference = reference;
	}, reference);
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-ember-reference-smoke.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(
			() => globalThis.__emberOracleResult,
			undefined,
			{
				timeout: 120000,
			},
		);
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__emberOracleProgress)
			.catch(() => null);
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify(
				{ passed: false, error: String(error), errors, progress },
				null,
				2,
			),
		);
		throw error;
	}
	const result = await page.evaluate(() => globalThis.__emberOracleResult);
	await page.screenshot({
		path: join(artifacts, "original-ember.png"),
		fullPage: true,
	});
	const report = {
		...result,
		passed: result.passed && !errors.length,
		errors,
		artifacts,
		browser: await browser.version(),
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(
		JSON.stringify(
			{ ...report, hashes: undefined, provenance: undefined },
			null,
			2,
		),
	);
	if (!report.passed)
		throw Error("Original Ember oracle failed; inspect retained evidence");
} finally {
	await browser?.close();
	await server.close();
}
