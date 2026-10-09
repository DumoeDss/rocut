import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";

// Diagnostic only: saved original HTMLCanvas pixels remain the baseline.
// No WASM build, runtime install, application connection or source rewriting.
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const savedDirectory = process.env.ROCUT_TEST_EMBER_DIAGNOSTICS;
if (
	!referenceRoot ||
	!isAbsolute(referenceRoot) ||
	!savedDirectory ||
	!isAbsolute(savedDirectory)
)
	throw Error(
		"Provide absolute ROCUT_TEST_MV_REFERENCE and ROCUT_TEST_EMBER_DIAGNOSTICS (directory containing collapse-75/119-plan.json and actual/expected PNGs)",
	);
if (process.argv.length !== 2)
	throw Error("This diagnostic takes no arguments");
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("Diagnostic artifacts require TEMP/TMP on C:");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadConvergeReference(referenceRoot);
const records = await Promise.all(
	[75, 119].map(async (frame) => {
		const bytes = await readFile(
			join(savedDirectory, `collapse-${frame}-plan.json`),
		);
		if (bytes.length > 2_000_000) throw Error("Oversized saved plan");
		const data = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		if (
			data.source?.width !== 1920 ||
			data.source?.height !== 1080 ||
			data.provenance?.frame?.args?.mode !== "collapse" ||
			!Array.isArray(data.plan?.commands)
		)
			throw Error(`Invalid saved collapse-${frame} diagnostic`);
		return { frame, ...data };
	}),
);
const pngs = new Map();
for (const frame of [75, 119])
	for (const kind of ["actual", "expected"])
		pngs.set(
			`/saved/collapse-${frame}-${kind}.png`,
			await readFile(join(savedDirectory, `collapse-${frame}-${kind}.png`)),
		);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-ember-clip-"));
console.log(
	JSON.stringify({ artifacts, savedDirectory, diagnosticOnly: true }),
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
const errors = [];
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage();
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(
		(input) => {
			globalThis.__emberClipInput = input;
		},
		{ reference, records },
	);
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		const png = pngs.get(url.pathname);
		return png
			? route.fulfill({ status: 200, contentType: "image/png", body: png })
			: route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-ember-clip-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__emberClipResult, undefined, {
		timeout: 120000,
	});
	const result = await page.evaluate(() => globalThis.__emberClipResult);
	const report = {
		...result,
		errors,
		artifacts,
		savedDirectory,
		browser: await browser.version(),
	};
	await writeFile(
		join(artifacts, "diagnostic.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
	if (!result.completed || errors.length)
		throw Error("Clip diagnostic failed to complete");
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify({ error: String(error), errors, artifacts }, null, 2),
	);
	throw error;
} finally {
	await browser?.close();
	await server.close();
}
