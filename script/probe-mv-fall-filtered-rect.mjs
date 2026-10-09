import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { fallFilterReference } from "./fixtures/mv-fall-filtered-rect-reference.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
if (process.argv.length !== 2 || !referenceRoot || !isAbsolute(referenceRoot))
	throw Error("Use no arguments and an absolute ROCUT_TEST_MV_REFERENCE");
const reference = await fallFilterReference(referenceRoot);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-fall-filtered-rect-"));
const inputs = [
	"packages/editor-classic/src/services/renderer/programmatic/mv-ember-raster.ts",
	"packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer.ts",
	"script/fixtures/mv-fall-filtered-rect.ts",
	"script/fixtures/mv-fall-filtered-rect-browser.ts",
];
const identity = async () =>
	Object.fromEntries(
		await Promise.all(
			inputs.map(async (path) => [
				path,
				createHash("sha256")
					.update(await readFile(join(root, path)))
					.digest("hex"),
			]),
		),
	);
const before = await identity();
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
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) =>
		new URL(route.request().url()).origin === origin
			? route.continue()
			: route.abort(),
	);
	await page.addInitScript((definition) => {
		globalThis.__fallFilterReference = definition;
	}, reference.definition);
	await page.goto(
		`${origin}/script/fixtures/mv-fall-filtered-rect-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__fallFilterResult, undefined, {
		timeout: 60000,
	});
	const result = await page.evaluate(() => globalThis.__fallFilterResult);
	const after = await identity(),
		current = await fallFilterReference(referenceRoot);
	const stable =
		JSON.stringify(before) === JSON.stringify(after) &&
		current.sha256 === reference.sha256;
	const report = {
		...result,
		passed: result.passed && !errors.length && stable,
		errors,
		inputIdentityStable: stable,
		sources: before,
		reference: {
			path: reference.path,
			sha256: reference.sha256,
			definitionSha256: reference.definitionSha256,
		},
		browser: await browser.version(),
		artifacts,
		fallSceneTested: false,
		installedElectronTested: false,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report));
	if (!report.passed) throw Error("Fall filtered rectangle acceptance failed");
} finally {
	await browser?.close();
	await server.close();
}
