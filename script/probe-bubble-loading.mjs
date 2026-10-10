import assert from "node:assert/strict";
import { BUBBLE_WASM_HELPER_ID, bubbleHash } from "./probe-bubble-evidence.mjs";

/** Pin output from the very plugin instance installed in this Vite server. */
export async function pinBubbleWasmHelper(plugin) {
	assert.equal(plugin?.name, "vite-plugin-wasm", "Unexpected WASM plugin provider");
	const resolve = typeof plugin.resolveId === "function" ? plugin.resolveId : plugin.resolveId?.handler;
	const load = typeof plugin.load === "function" ? plugin.load : plugin.load?.handler;
	assert(typeof resolve === "function" && typeof load === "function", "Missing WASM virtual provider hooks");
	assert.equal(await resolve.call(plugin, BUBBLE_WASM_HELPER_ID), BUBBLE_WASM_HELPER_ID);
	const code = await load.call(plugin, BUBBLE_WASM_HELPER_ID);
	assert(typeof code === "string" && code.startsWith("export default ") && code.length < 65536, "Unexpected WASM virtual helper output");
	return Object.freeze({ id: BUBBLE_WASM_HELPER_ID, provider: plugin.name,
		bytes: Buffer.byteLength(code), codeSha256: bubbleHash(code) });
}

/** Reject promptly for a failed local module load, not after the render timeout. */
export function watchBubbleLoading(page, origin, report) {
	let reject, stopped = false, settled = false;
	const failed = new Promise((_, fail) => { reject = fail; });
	void failed.catch(() => {});
	report.requestFailures ??= [];
	const fail = (kind, details, message) => {
		if (stopped || settled) return;
		settled = true;
		report.loadFailure = { kind, ...details, message, at: new Date().toISOString() };
		reject(Error(message));
	};
	const local = (url) => { try { return new URL(url).origin === origin; } catch { return false; } };
	const listeners = {
		response(response) {
			if (response.status() < 400) return;
			const entry = { url: response.url(), status: response.status() };
			report.httpErrors.push(entry);
			if (local(entry.url)) fail("http", entry, `Bubble local HTTP ${entry.status}: ${entry.url}`);
		},
		requestfailed(request) {
			const entry = { url: request.url(), resourceType: request.resourceType(), error: request.failure()?.errorText ?? "Unknown request failure" };
			report.requestFailures.push(entry);
			if (local(entry.url)) fail("request", entry, `Bubble local ${entry.resourceType} request failed: ${entry.error}: ${entry.url}`);
		},
		console(message) {
			const type = message.type(), text = message.text();
			if (["warning", "error"].includes(type) && report.console.length < 100) report.console.push({ type, text });
			if (type === "error" && /Failed to (fetch dynamically imported module|load module script|load resource)|Importing a module script failed|error loading dynamically imported module/i.test(text))
				fail("module-console", { text }, `Bubble module loading failed: ${text}`);
		},
		pageerror(error) { report.pageErrors.push(error.message); fail("pageerror", {}, error.message); },
		crash() { fail("crash", {}, "Bubble browser page crashed"); },
	};
	for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
	return { failed, stop() {
		stopped = true;
		for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
	} };
}
