import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer, build } from "./browser-probe-toolchain.mjs";
import { loadThreadReference } from "./fixtures/mv-thread-reference.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reference = await loadThreadReference(process.argv[2]);
const artifact = await mkdtemp(join(tmpdir(), "rocut-flame-original-"));
const paths = [
	"script/probe-mv-flame-oracle.mjs",
	"script/browser-probe-toolchain.mjs",
	...[
		"mv-flame-oracle.ts",
		"mv-flame-oracle-contract.ts",
		"mv-flame-oracle-assets.ts",
		"mv-flame-oracle-browser.ts",
		"mv-flame-oracle-browser.html",
		"mv-flame-oracle.tsconfig.json",
		"mv-thread-reference.ts",
		"mv-thread-contract.ts",
		"mv-kanji-slam-reference-realm.ts",
		"mv-kanji-slam-reference-contract.ts",
	].map((name) => `script/fixtures/${name}`),
];
const hash = async (path) =>
	createHash("sha256")
		.update(await readFile(join(root, path)))
		.digest("hex");
const inputs = await Promise.all(
	paths.map(async (path) => ({ path, sha256: await hash(path) })),
);
console.log(
	JSON.stringify({ artifact, state: "starting-whole-original-flame" }),
);
let browser, server;
try {
	const web = join(artifact, "web");
	await build({
		root,
		configFile: false,
		logLevel: "error",
		build: {
			outDir: web,
			emptyOutDir: false,
			target: "esnext",
			reportCompressedSize: false,
			rollupOptions: {
				input: join(root, "script/fixtures/mv-flame-oracle-browser.html"),
			},
		},
	});
	server = await createServer({
		root: web,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifact, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage(),
		errors = [],
		externalRequests = [];
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (!request.url().startsWith(`${origin}/`))
			externalRequests.push(request.url());
	});
	await page.addInitScript((value) => {
		globalThis.__flameOriginalReference = value;
	}, reference);
	await page.goto(`${origin}/script/fixtures/mv-flame-oracle-browser.html`, {
		waitUntil: "commit",
	});
	await page.waitForFunction(
		() => globalThis.__flameOriginalResult,
		undefined,
		{ timeout: 120000 },
	);
	const result = await page.evaluate(() => globalThis.__flameOriginalResult);
	for (const input of inputs)
		assert.equal(
			await hash(input.path),
			input.sha256,
			"Oracle fixture changed during execution",
		);
	assert.deepEqual(
		await loadThreadReference(process.argv[2]),
		reference,
		"Original source changed during execution",
	);
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(
			{
				artifact,
				inputs,
				browser: browser.version(),
				errors,
				externalRequests,
				result,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(result.passed, true, result.error);
	assert.equal(result.observations.length, 15);
	console.log(
		JSON.stringify({
			passed: true,
			artifact,
			observations: result.observations.length,
			preparedHash: result.preparedHash,
		}),
	);
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		String(error?.stack ?? error),
		{ flag: "wx" },
	);
	throw error;
} finally {
	await browser?.close();
	await server?.close();
}
