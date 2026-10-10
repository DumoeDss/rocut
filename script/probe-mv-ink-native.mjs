import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadInkReference } from "./fixtures/mv-ink-reference.ts";
import { buildInkNative } from "./fixtures/mv-ink-native-build.mjs";
import { inkRustIdentity } from "./fixtures/mv-ink-export-identities.mjs";
import {
	fallWasmIdentity,
	fallServedIdentity,
} from "./fixtures/mv-fall-evidence.mjs";

// Export is a separate subsequent gate, never silently replaced by browser-only.
assert.deepEqual(
	process.argv.slice(2),
	["--browser-only"],
	"Use --browser-only for native full-scene/negative parity",
);
const original = process.env.ROCUT_TEST_MV_REFERENCE,
	isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
assert.ok(
	[original, isolated, browserExecutable, rustSource].every(
		(path) => path && isAbsolute(path),
	),
	"Supply absolute reference/private WASM directories and browser executable",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = await mkdtemp(join(tmpdir(), "rocut-ink-native-")),
	web = join(artifact, "web");
const reference = await loadInkReference({ root: original }),
	wasmIdentity = await fallWasmIdentity(isolated);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
};
const rustIdentity = await inkRustIdentity(rustOptions);
const digest = async (path) =>
	createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
const browserBinarySha256 = await digest(browserExecutable);
const driverPaths = [
	"script/probe-mv-ink-native.mjs",
	"script/fixtures/mv-ink-native-build.mjs",
	"script/fixtures/mv-ink-export-identities.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/mv-ink-reference.ts",
	"script/fixtures/mv-ink-contract.ts",
	"script/fixtures/mv-fall-evidence.mjs",
];
const sources = new Map(
	await Promise.all(
		driverPaths.map(async (path) => [path, await digest(join(root, path))]),
	),
);
console.log(
	JSON.stringify({
		artifact,
		scope:
			"Complete original Ink versus all408 native full-scene observations and negatives; no export or installed Electron gate",
	}),
);
let browser, server;
try {
	for (const input of await buildInkNative({ root, isolated, output: web })) {
		if (sources.has(input.path))
			assert.equal(
				sources.get(input.path),
				input.sha256,
				"Driver/loaded-source disagreement",
			);
		sources.set(input.path, input.sha256);
	}
	const servedIdentity = await fallServedIdentity(web);
	server = await createServer({
		root: web,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifact, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: browserExecutable,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage(),
		errors = [],
		externalRequests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			externalRequests.push(route.request().url());
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript((value) => {
		globalThis.__inkNativeReference = value;
	}, reference);
	await page.goto(`${origin}/script/fixtures/mv-ink-native-browser.html`, {
		waitUntil: "commit",
	});
	let reading = false;
	const progressTimer = setInterval(async () => {
		if (reading) return;
		reading = true;
		try {
			const progress = await page.evaluate(() => ({
				current: globalThis.__inkNativeProgress?.current,
				observations: Object.keys(
					globalThis.__inkNativeProgress?.observations ?? {},
				).length,
				violations: globalThis.__inkNativeProgress?.violations?.length,
			}));
			console.log(JSON.stringify({ event: "ink-progress", ...progress }));
		} catch {
			/* Bounded progress is not a second runtime completion gate. */
		} finally {
			reading = false;
		}
	}, 30000);
	progressTimer.unref();
	let result;
	try {
		await page.waitForFunction(() => globalThis.__inkNativeResult, undefined, {
			timeout: 900000,
		});
		result = await page.evaluate(() => globalThis.__inkNativeResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: await page
				.evaluate(() => globalThis.__inkNativeProgress)
				.catch(() => null),
		};
	} finally {
		clearInterval(progressTimer);
	}
	const report = {
		artifact,
		scope:
			"Native Ink full-scene and negative parity only; no real export acceptance",
		browser: browser.version(),
		browserExecutable,
		browserBinarySha256,
		result,
		errors,
		externalRequests,
		wasmIdentity,
		rustIdentity,
		servedIdentity,
		sourceInputs: [...sources].map(([path, sha256]) => ({ path, sha256 })),
		referenceSources: reference.scripts.map(({ id, sha256 }) => ({
			id,
			sha256,
		})),
	};
	try {
		assert.equal(
			await digest(browserExecutable),
			browserBinarySha256,
			"Actual browser executable changed",
		);
		for (const [path, sha256] of sources)
			assert.equal(
				await digest(join(root, path)),
				sha256,
				"Loaded source changed during native acceptance",
			);
		assert.deepEqual(
			await loadInkReference({ root: original }),
			reference,
			"Original Ink scripts changed during acceptance",
		);
		assert.deepEqual(
			await fallWasmIdentity(isolated),
			wasmIdentity,
			"Private WASM changed during acceptance",
		);
		assert.deepEqual(
			await fallServedIdentity(web),
			servedIdentity,
			"Served native bundle changed during acceptance",
		);
		assert.deepEqual(
			await inkRustIdentity(rustOptions),
			rustIdentity,
			"Compiled/current Ink Rust source changed",
		);
		report.sourceIdentityStable = true;
	} catch (error) {
		report.sourceIdentityStable = false;
		report.identityError = String(error);
	}
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			artifact,
			passed: result.passed,
			observations: Object.keys(
				result.observations ?? result.progress?.observations ?? {},
			).length,
			violations: result.violations ?? result.progress?.violations,
			error: result.error,
			sourceIdentityStable: report.sourceIdentityStable,
			errors,
			externalRequests,
		}),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(report.sourceIdentityStable, true, report.identityError);
	assert.equal(result.passed, true, result.error ?? "Native Ink pixels differ");
	assert.equal(result.observations.length, 408);
	assert.ok(result.negatives);
	assert.equal(result.repeats, 48);
	assert.equal(result.thresholds.maxChannelAtMost, 2);
	assert.equal(result.thresholds.maeLessThan, 0.025);
	assert.equal(result.exportTested, false);
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
