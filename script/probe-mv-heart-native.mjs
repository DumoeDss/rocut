import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildHeartOwner } from "./fixtures/mv-heart-owner-build.mjs";
import {
	tunnelRustIdentity,
	tunnelFileIdentity,
} from "./fixtures/mv-tunnel-native-identities.mjs";
import {
	fallWasmIdentity,
	fallServedIdentity,
} from "./fixtures/mv-fall-evidence.mjs";

assert.deepEqual(process.argv.slice(2), ["--browser-only"]);
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
const browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
assert.ok(
	[isolated, rustSource, browserExecutable].every(
		(path) => path && isAbsolute(path),
	),
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = await mkdtemp(join(tmpdir(), "rocut-heart-native-"));
const web = join(artifact, "web");
const wasmIdentity = await fallWasmIdentity(isolated);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
	currentScope: "compiled-snapshot",
};
const rustIdentity = await tunnelRustIdentity(rustOptions);
const browserIdentity = await tunnelFileIdentity(browserExecutable);
const sourceInputs = new Map();
for (const path of [
	"script/probe-mv-heart-native.mjs",
	"script/fixtures/mv-heart-owner-build.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/mv-tunnel-native-identities.mjs",
	"script/fixtures/mv-fall-evidence.mjs",
	"script/fixtures/mv-ink-export-identities.mjs",
])
	sourceInputs.set(path, (await tunnelFileIdentity(join(root, path))).sha256);
const glue = await readFile(join(isolated, "opencut_wasm.js"), "utf8");
assert.match(glue, /export class MvHeartOwner\b/);
console.log(
	JSON.stringify({
		artifact,
		scope:
			"Public five-mode Recipe/native resource decode/actual owner/fixed realm; exact1024 fixture, no original parity/export/installed Electron",
	}),
);
let browser, server, timer;
try {
	for (const input of await buildHeartOwner({
		root,
		isolated,
		output: web,
		fixture: "script/fixtures/mv-heart-native-browser.html",
	})) {
		if (sourceInputs.has(input.path))
			assert.equal(sourceInputs.get(input.path), input.sha256);
		sourceInputs.set(input.path, input.sha256);
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
	const page = await browser.newPage();
	const errors = [],
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
	await page.goto(`${origin}/script/fixtures/mv-heart-native-browser.html`, {
		waitUntil: "commit",
	});
	let reading = false;
	timer = setInterval(async () => {
		if (reading) return;
		reading = true;
		try {
			console.log(
				JSON.stringify({
					event: "heart-native-progress",
					current: await page.evaluate(() => globalThis.__heartNativeProgress),
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
		await page.waitForFunction(
			() => globalThis.__heartNativeResult,
			undefined,
			{ timeout: 180000 },
		);
		result = await page.evaluate(() => globalThis.__heartNativeResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: await page
				.evaluate(() => globalThis.__heartNativeProgress)
				.catch(() => null),
		};
	} finally {
		clearInterval(timer);
	}
	for (const [index, row] of (result.observations ?? []).entries()) {
		assert.match(row.png, /^data:image\/png;base64,/);
		const name = `frame-${index}-${row.kind}-${row.frame}.png`;
		await writeFile(
			join(artifact, name),
			Buffer.from(row.png.split(",")[1], "base64"),
			{ flag: "wx" },
		);
		delete row.png;
		row.image = name;
	}
	const report = {
		artifact,
		result,
		errors,
		externalRequests,
		browser: browser.version(),
		browserIdentity,
		wasmIdentity,
		rustIdentity,
		servedIdentity,
		sourceInputs: [...sourceInputs].map(([path, sha256]) => ({ path, sha256 })),
	};
	try {
		for (const [path, sha256] of sourceInputs)
			assert.equal((await tunnelFileIdentity(join(root, path))).sha256, sha256);
		assert.deepEqual(await fallWasmIdentity(isolated), wasmIdentity);
		assert.deepEqual(await tunnelRustIdentity(rustOptions), rustIdentity);
		assert.deepEqual(
			await tunnelFileIdentity(browserExecutable),
			browserIdentity,
		);
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
	assert.equal(result.observations.length, 15);
	assert.deepEqual(result.inputDimensions, [1024, 1024]);
	assert.equal(result.exportTested, false);
	assert.equal(result.originalPixelParityTested, false);
	assert.equal(result.installedElectronTested, false);
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
