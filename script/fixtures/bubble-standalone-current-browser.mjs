import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "../browser-probe-toolchain.mjs";
import { startCurrentBubbleHost, surface, runtime, coreHash, hash, save } from "./bubble-standalone-current.mjs";
import { blazeEditorSnapshot, blazeEditorPoll as poll } from "./blaze-editor-control.mjs";
import { bubbleEditorSelect as select, bubbleEditorSet as set, bubbleEditorClip as clip,
	bubbleEditorUndoRedo as undoRedo, seek } from "./bubble-editor-control.mjs";
import { blazeEditorSaved } from "./blaze-editor-persistence.mjs";
import { observeBubbleEditorPage } from "./bubble-editor-observe.mjs";
import { assertBlazeEditorExportBrowserErrors } from "./blaze-editor-export-browser.mjs";

const root = resolve(process.argv[2]);
assert(root.startsWith("C:\\tmps\\rocut-bubble-standalone-"));
const evidence = { runtime, surface, coreHash, errors: [], consoleErrors: [], warnings: [], httpFailures: [],
	externalRequests: [], requestFailures: [], applyRequests: [], applyRejections: [], localPointErrors: [],
	domOperations: [], validatedRejections: [], loadedCore: [] };
const pinPaths = [join(runtime, "rocut.mjs"), join(runtime, "opencut_wasm_bg.wasm"),
	join(surface, "surface-wasm-package.json"),
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/packages/editor-classic/src/editor/transactions/opencut/editing-state.ts",
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/native-effect-layer.mjs"];
const pins = async () => Object.fromEntries(await Promise.all(pinPaths.map(async path => [path, hash(await readFile(path))])));
evidence.pinsBefore = await pins();
let host, browser;
const omitted = value => assert.equal(Object.hasOwn(value.editing, "name"), false, "Do not repair an omitted name");
const open = async () => {
	host = await startCurrentBubbleHost(root);
	const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
	const network = await page.context().newCDPSession(page);
	await network.send("Network.enable", { maxTotalBufferSize: 128 * 1024 * 1024, maxResourceBufferSize: 64 * 1024 * 1024 });
	await observeBubbleEditorPage(page, host.editorUrl, evidence);
	const receipt = JSON.parse(await readFile(join(surface, "surface-wasm-package.json"), "utf8"));
	await page.route(url => url.pathname.endsWith("/" + receipt.coreWasm.path), async route => {
		const response = await route.fetch(), body = await response.body();
		evidence.loadedCore.push({ sha256: hash(body), status: response.status(), observation: "Actual Host response bytes passed unchanged to browser" });
		await route.fulfill({ response, body });
	});
	await page.goto(host.editorUrl, { waitUntil: "commit" });
	await page.locator('[data-testid="timeline-clip"][data-element-id="bubble-independent-unnamed"]').waitFor({ timeout: 90000 });
	await poll(async () => (await host.request("export")).surfaces === 1, 90000);
	await poll(() => evidence.loadedCore.length > 0);
	return page;
};
try {
	browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
		args: ["--no-proxy-server", "--disable-webgpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
	let page = await open();
	let request = host.request;
	await select(page, "bubble-independent-named", true); await seek(page, 0);
	const namedBefore = await clip(request, "bubble-independent-named");
	await set(page, "Optical plane distance (short-side fraction)", .07);
	await poll(async () => (await clip(request, "bubble-independent-named")).editing.animations["params.refraction"].keys[0].value === .07);
	const namedAfter = await clip(request, "bubble-independent-named");
	await undoRedo({ page, request, before: namedBefore, after: namedAfter, evidence, label: "Named independent optical key edit" });
	await select(page, "bubble-independent-unnamed", true);
	omitted(await clip(request, "bubble-independent-unnamed"));
	await seek(page, 480000);
	const beforeStatic = await clip(request, "bubble-independent-unnamed");
	await set(page, "point1Time", 160000);
	await poll(async () => (await clip(request, "bubble-independent-unnamed")).editing.params.point1Time === 160000);
	const afterStatic = await clip(request, "bubble-independent-unnamed");
	omitted(afterStatic);
	await undoRedo({ page, request, before: beforeStatic, after: afterStatic, evidence, label: "Unnamed nativeEffectLayer trajectory field edit" });
	const beforeKey = await clip(request, "bubble-independent-unnamed");
	await set(page, "Optical plane distance (short-side fraction)", .09);
	await poll(async () => (await clip(request, "bubble-independent-unnamed")).editing.animations["params.refraction"].keys[0].value === .09);
	const afterKey = await clip(request, "bubble-independent-unnamed");
	omitted(afterKey);
	assert.equal(afterKey.editing.params.refraction, beforeKey.editing.params.refraction);
	await undoRedo({ page, request, before: beforeKey, after: afterKey, evidence, label: "Unnamed nativeEffectLayer existing optical key edit" });
	evidence.unnamedEdits = { beforeStatic, afterStatic, beforeKey, afterKey };
	omitted(await clip(request, "bubble-independent-unnamed"));
	const expected = await blazeEditorSnapshot(request);
	await save(root, "saved-after-edits.json", await blazeEditorSaved(root, request, record =>
		JSON.stringify(record).includes('"point1Time":160000') && JSON.stringify(record).includes('"value":0.09')));
	await page.reload({ waitUntil: "commit" });
	await page.locator('[data-testid="timeline-clip"][data-element-id="bubble-independent-unnamed"]').waitFor({ timeout: 90000 });
	await poll(async () => (await request("export")).surfaces === 1);
	assert.deepEqual(await blazeEditorSnapshot(request), expected);
	omitted(await clip(request, "bubble-independent-unnamed"));
	await page.close(); await host.close(); host = undefined;
	page = await open(); request = host.request;
	assert.deepEqual(await blazeEditorSnapshot(request), expected);
	omitted(await clip(request, "bubble-independent-unnamed"));
	evidence.historyReloadReopen = { completeSnapshotRetained: true, omittedNameRetained: true };
	await select(page, "bubble-independent-unnamed", true);
	await seek(page, 480000);
	await page.screenshot({ path: join(root, "unnamed-reopened-editor.png") });
	evidence.scope = "Real production editor field and key edits, exact clip keyboard undo/redo, save/reload/Host reopen; no encoding/export matrix or source injection";
	assert(evidence.loadedCore.every(item => item.sha256 === coreHash && item.status === 200));
	assertBlazeEditorExportBrowserErrors(evidence);
	evidence.ok = true;
} catch(error) {
	evidence.ok = false; evidence.failure = error.stack ?? String(error);
} finally {
	await browser?.close(); await host?.close();
	evidence.cleanup = { browserClosed: !browser || !browser.isConnected(), ownedHostClosed: true };
	evidence.pinsAfter = await pins();
	evidence.pinDrift = pinPaths.filter(path => evidence.pinsBefore[path] !== evidence.pinsAfter[path]);
	if (evidence.pinDrift.length) { evidence.ok = false; evidence.failure = "Selected producer/runtime pins changed during acceptance"; }
	await save(root, `current-browser-receipt-${Date.now()}.json`, evidence);
}
console.log(JSON.stringify({ root, ok: evidence.ok, failure: evidence.failure?.split("\n")[0] }));
if (!evidence.ok) process.exitCode = 1;
