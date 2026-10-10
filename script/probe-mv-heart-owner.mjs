import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadHeartOwnerReference } from "./fixtures/mv-heart-owner-reference.ts";
import { buildHeartOwner } from "./fixtures/mv-heart-owner-build.mjs";
import {
	tunnelRustIdentity,
	tunnelFileIdentity,
} from "./fixtures/mv-tunnel-native-identities.mjs";
import {
	fallWasmIdentity,
	fallServedIdentity,
} from "./fixtures/mv-fall-evidence.mjs";
assert.deepEqual(
	process.argv.slice(2),
	["--prototype-raster-only"],
	"This is not public source dispatch, whole-film, export or installed Electron acceptance",
);
const original = process.env.ROCUT_TEST_MV_REFERENCE,
	isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE,
	rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
assert.ok(
	[original, isolated, browserExecutable, rustSource].every(
		(path) => path && isAbsolute(path),
	),
	"Require absolute full original/private fresh WASM/source manifest/existing Chromium paths",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = await mkdtemp(join(tmpdir(), "rocut-heart-owner-")),
	web = join(artifact, "web");
const reference = await loadHeartOwnerReference(original),
	wasmIdentity = await fallWasmIdentity(isolated);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
	currentScope: process.env.ROCUT_TEST_CURRENT_SOURCE_SCOPE ?? "native-scene",
};
const rustIdentity = await tunnelRustIdentity(rustOptions),
	browserIdentity = await tunnelFileIdentity(browserExecutable);
for (const required of [
	"rust/crates/editor-api/src/mv_heart_owner.rs",
	"rust/crates/editor-api/src/mv_recipe/heart.rs",
	"rust/wasm/src/mv_heart_owner.rs",
])
	assert.ok(
		[
			...rustIdentity.currentMatchingSources,
			...rustIdentity.snapshotOnlySources,
		].some((entry) => entry.path === required),
		`Missing actual compiled Heart owner source: ${required}`,
	);
const glue = await readFile(join(isolated, "opencut_wasm.js"), "utf8");
assert.match(glue, /export class MvHeartOwner\b/);
const tail = glue.slice(glue.indexOf("export class MvHeartOwner")),
	end = tail.indexOf("\nexport ", 1),
	ownerClass = end < 0 ? tail : tail.slice(0, end);
assert.ok(
	ownerClass.includes("prepare(") &&
		!/passArray8ToWasm\w*\(encoded/.test(ownerClass) &&
		!/passArray8ToWasm\w*\(rgba/.test(ownerClass),
	"Owner binary copies must follow Rust reservation, not generated wrapper copying",
);
const sources = new Map();
for (const path of [
	"script/probe-mv-heart-owner.mjs",
	"script/fixtures/mv-heart-owner-build.mjs",
	"script/fixtures/mv-heart-owner-reference.ts",
	"script/fixtures/mv-tunnel-native-identities.mjs",
	"script/fixtures/mv-ink-export-identities.mjs",
	"script/fixtures/mv-fall-evidence.mjs",
	"script/browser-probe-toolchain.mjs",
])
	sources.set(path, (await tunnelFileIdentity(join(root, path))).sha256);
console.log(
	JSON.stringify({
		artifact,
		scope:
			"Actual Heart WASM owner + native primitives versus full original glass.js; exclusive exact1024 native capacity and separate aggregate rejection;20px pixel boundary; no public source/export gate",
	}),
);
let browser, server, timer;
try {
	for (const input of await buildHeartOwner({ root, isolated, output: web })) {
		if (sources.has(input.path))
			assert.equal(sources.get(input.path), input.sha256);
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
			externalRequests.push(url.origin);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript((value) => {
		globalThis.__heartOwnerReference = value;
	}, reference);
	await page.goto(`${origin}/script/fixtures/mv-heart-owner-browser.html`, {
		waitUntil: "commit",
	});
	let reading = false;
	timer = setInterval(async () => {
		if (reading) return;
		reading = true;
		try {
			console.log(
				JSON.stringify({
					event: "heart-owner-progress",
					current: await page.evaluate(() => globalThis.__heartOwnerProgress),
				}),
			);
		} catch {
		} finally {
			reading = false;
		}
	}, 30000);
	timer.unref();
	let result;
	try {
		await page.waitForFunction(() => globalThis.__heartOwnerResult, undefined, {
			timeout: 900000,
		});
		result = await page.evaluate(() => globalThis.__heartOwnerResult);
	} catch (error) {
		result = { passed: false, error: String(error) };
	} finally {
		clearInterval(timer);
	}
	const report = {
		artifact,
		result,
		browser: browser.version(),
		browserIdentity,
		wasmIdentity,
		rustIdentity,
		servedIdentity,
		errors,
		externalRequests,
		referenceSources: reference.scripts.map(({ id, sha256 }) => ({
			id,
			sha256,
		})),
		sourceInputs: [...sources].map(([path, sha256]) => ({ path, sha256 })),
	};
	try {
		assert.deepEqual(
			await tunnelFileIdentity(browserExecutable),
			browserIdentity,
		);
		for (const [path, sha256] of sources)
			assert.equal((await tunnelFileIdentity(join(root, path))).sha256, sha256);
		assert.deepEqual(await loadHeartOwnerReference(original), reference);
		assert.deepEqual(await fallWasmIdentity(isolated), wasmIdentity);
		assert.deepEqual(await tunnelRustIdentity(rustOptions), rustIdentity);
		assert.deepEqual(await fallServedIdentity(web), servedIdentity);
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
			observations: result.observations?.length,
			error: result.error,
			sourceIdentityStable: report.sourceIdentityStable,
		}),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(report.sourceIdentityStable, true, report.identityError);
	assert.equal(result.passed, true, result.error);
	assert.equal(result.observations.length, 48);
	assert.equal(result.repeats, 12);
	assert.ok(Object.values(result.checks).every((value) => value === true));
	assert.equal(result.thresholds.maxChannelAtMost, 2);
	assert.equal(result.thresholds.maeLessThan, 0.025);
	assert.equal(result.publicSourceDispatchTested, false);
	assert.equal(result.wholeFilmTested, false);
	assert.equal(result.exportTested, false);
	assert.equal(result.ordinary1024CapacityAccepted, false);
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		String(error?.stack ?? error),
		{ flag: "wx" },
	);
	throw error;
} finally {
	clearInterval(timer);
	await browser?.close();
	await server?.close();
}
