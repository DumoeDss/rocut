import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pinBubbleWasmHelper, watchBubbleLoading } from "./probe-bubble-loading.mjs";
import { BUBBLE_WASM_HELPER_ID, bubbleHash, bubbleSourceGuard, bubbleRequiredFixtures, bubblePackageNames, bubbleRunnerNames } from "./probe-bubble-evidence.mjs";
import { runBubbleSession } from "./probe-bubble-session.mjs";

const frozen = { snapshot: "C:/tmps/snapshot", packageDirectory: "C:/tmps/package", inputs: [], packageFiles: [] };
const emptyReport = () => ({ console: [], pageErrors: [], httpErrors: [], requestFailures: [] });
const origin = "http://127.0.0.1:8765";

test("Bubble permits only exact helper ID and code from the actual installed WASM plugin instance", async () => {
	const require = createRequire(new URL("../apps/vite-example/package.json", import.meta.url));
	const module = require("vite-plugin-wasm"), plugin = (module.default ?? module)();
	const provider = await pinBubbleWasmHelper(plugin), code = await plugin.load(BUBBLE_WASM_HELPER_ID);
	const guard = bubbleSourceGuard(frozen, "E:/rocut", [provider]);
	assert.equal(await guard.plugin.transform(code, BUBBLE_WASM_HELPER_ID), null);
	assert.deepEqual(guard.loadedVirtual.get(BUBBLE_WASM_HELPER_ID), provider);
	assert.equal(provider.codeSha256, bubbleHash(code));
	await assert.rejects(guard.plugin.transform(code + "\nmalicious()", BUBBLE_WASM_HELPER_ID), /content differs/);
	for (const id of [BUBBLE_WASM_HELPER_ID + "?source=unverified", BUBBLE_WASM_HELPER_ID + "-other", "/__unrelated-helper", "C:/other/module.mjs"])
		await assert.rejects(guard.plugin.transform(code, id), /escaped frozen/);
	await assert.rejects(bubbleSourceGuard(frozen, "E:/rocut").plugin.transform(code, BUBBLE_WASM_HELPER_ID), /escaped frozen/);
});
test("Bubble rejects an unknown virtual provider or malformed provider output", async () => {
	await assert.rejects(pinBubbleWasmHelper({ name: "arbitrary-provider" }), /Unexpected WASM plugin/);
	await assert.rejects(pinBubbleWasmHelper({ name: "vite-plugin-wasm", resolveId: () => "/other", load: () => "export default 1" }));
	await assert.rejects(pinBubbleWasmHelper({ name: "vite-plugin-wasm", resolveId: (id) => id, load: () => "unverified plain text" }), /Unexpected WASM virtual/);
	assert.throws(() => bubbleSourceGuard(frozen, "E:/rocut", [{ id: "/anything", provider: "vite-plugin-wasm", codeSha256: "a".repeat(64) }]), /Unexpected virtual/);
});
test("Bubble HTTP 500 rejects the wait immediately and preserves response diagnostics", async () => {
	const page = new EventEmitter(), report = emptyReport(), loading = watchBubbleLoading(page, origin, report);
	page.emit("response", { status: () => 500, url: () => origin + BUBBLE_WASM_HELPER_ID });
	await assert.rejects(loading.failed, /Bubble local HTTP 500/);
	assert.equal(report.httpErrors[0].status, 500);
	assert.equal(report.loadFailure.kind, "http");
	loading.stop();
});
test("Bubble module request failure and import console failure each reject without a render timeout", async () => {
	for (const event of ["requestfailed", "console"]) {
		const page = new EventEmitter(), report = emptyReport(), loading = watchBubbleLoading(page, origin, report);
		if (event === "requestfailed") page.emit(event, { url: () => origin + "/module.mjs", resourceType: () => "script", failure: () => ({ errorText: "net::ERR_FAILED" }) });
		else page.emit(event, { type: () => "error", text: () => "Failed to fetch dynamically imported module" });
		await assert.rejects(loading.failed, /request failed|module loading failed/);
		assert.equal(report.loadFailure.kind, event === "requestfailed" ? "request" : "module-console");
		loading.stop();
	}
});
test("Bubble loading watcher preserves first failure and detaches before owned cleanup", async () => {
	const page = new EventEmitter(), report = emptyReport(), loading = watchBubbleLoading(page, origin, report);
	page.emit("response", { status: () => 200, url: () => origin + "/ok.mjs" });
	assert.equal(report.loadFailure, undefined);
	page.emit("pageerror", Error("first failure"));
	page.emit("crash");
	await assert.rejects(loading.failed, /first failure/);
	assert.equal(report.loadFailure.kind, "pageerror");
	loading.stop();
	page.emit("requestfailed", { url: () => origin + "/closing.mjs", resourceType: () => "script", failure: () => ({ errorText: "closed" }) });
	assert.equal(report.requestFailures.length, 0);
	assert.equal(page.listenerCount("response"), 0);
});

async function makeSessionFixture() {
	const parent = await mkdtemp("C:/tmps/bubble-fail-fast-test-"), root = join(parent, "snapshot"), pkg = join(parent, "pkg"), runner = join(parent, "runner");
	for (const path of [root, pkg, runner]) await mkdir(path);
	const files = [];
	for (const name of [...bubbleRequiredFixtures, "rust/crates/effects/src/bubble.rs", "rust/crates/effects/src/shaders/bubble.wgsl"]) {
		const path = join(root, name), content = Buffer.from(`// ${name}\n`);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, { flag: "wx" });
		files.push({ path: name, sha256: bubbleHash(content) });
	}
	await writeFile(join(root, "fixture-source.json"), JSON.stringify({ files }), { flag: "wx" });
	for (const name of bubblePackageNames) await writeFile(join(pkg, name), name, { flag: "wx" });
	for (const name of bubbleRunnerNames) await writeFile(join(runner, name), name, { flag: "wx" });
	return { parent, root, packageDirectory: pkg, runnerDirectory: runner };
}
test("Bubble real session control flow records a synthetic HTTP 500 and closes only its owned server/context", { timeout: 10000 }, async () => {
	const paths = await makeSessionFixture(), closed = { browser: 0, server: 0 }, page = new EventEmitter();
	let pageClosed = false;
	Object.assign(page, {
		isClosed: () => pageClosed, evaluate: async () => null,
		goto: async () => { page.emit("response", { status: () => 500, url: () => origin + BUBBLE_WASM_HELPER_ID }); },
		waitForFunction: () => new Promise(() => {}),
	});
	const context = {
		addInitScript: async () => {}, setDefaultTimeout: () => {}, route: async () => {}, newPage: async () => page,
		browser: () => ({ version: () => "synthetic-no-browser-started" }),
		close: async () => { closed.browser++; pageClosed = true; },
	};
	const server = { listen: async () => {}, httpServer: { address: () => ({ port: 8765 }) }, close: async () => { closed.server++; } };
	const started = Date.now();
	const report = await runBubbleSession({ ...paths, executablePath: "unused-synthetic", diagnostic: false, plan: [], loadToolchain: async () => ({
		chromium: { launchPersistentContext: async () => context }, createServer: async () => server, topLevelAwait: () => ({}),
		wasm: () => ({ name: "vite-plugin-wasm", resolveId: (id) => id === BUBBLE_WASM_HELPER_ID ? id : undefined, load: async () => "export default async function() {}" }),
	}) });
	assert(Date.now() - started < 3000, "Synthetic load failure should not wait the 840-second renderer timeout");
	assert.equal(report.ok, false);
	assert.equal(report.loadFailure.kind, "http");
	assert.match(report.failure, /HTTP 500/);
	assert.deepEqual(closed, { browser: 1, server: 1 });
	assert.equal(report.postRunVerification.ok, true);
	const saved = JSON.parse(await readFile(join(report.artifacts, "evidence.json"), "utf8"));
	assert.equal(saved.browserClosed, true);
	assert.equal(saved.serverClosed, true);
	assert.equal(saved.httpErrors[0].status, 500);
});
