import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	decodeReviewedHyperframesWorklet,
	HYPERFRAMES_FX_MODULE_URL,
	HYPERFRAMES_FX_WORKLET_GATE,
	HYPERFRAMES_FX_WORKLET_BINDING,
	HYPERFRAMES_FX_WORKLET_REPLY,
} from "../programmatic/hyperframes-fx-worklet-gate";

function gateHarness() {
	const requests: { version: number; id: number; url: string }[] = [];
	const nativeCalls: { target: unknown; url: string; options: unknown }[] = [];
	// This fake native method tests adapter routing only, never claims CSP or DSP.
	class Worklet {
		async addModule(url: string, options?: unknown) {
			nativeCalls.push({ target: this, url, options });
		}
	}
	class OfflineAudioContext {
		audioWorklet = new Worklet();
	}
	const window: Record<string, any> = {
		[HYPERFRAMES_FX_WORKLET_BINDING]: (raw: string) =>
			requests.push(JSON.parse(raw)),
	};
	runInNewContext(HYPERFRAMES_FX_WORKLET_GATE, { window, OfflineAudioContext });
	return {
		window,
		requests,
		nativeCalls,
		worklet: new Worklet(),
		prototype: Worklet.prototype,
	};
}

test("reviewed decoder rejects unknown, oversized, alternate-scheme and same-length bytes", () => {
	for (const url of [
		null,
		{},
		"https://example.com/worklet.js",
		"blob:evil",
		"data:text/javascript;base64,YXV0aG9yLWNvZGU=",
		`data:text/javascript;base64,${Buffer.alloc(12884).toString("base64")}`,
		`data:text/javascript;base64,${"A".repeat(18000)}`,
	])
		expect(decodeReviewedHyperframesWorklet(url)).toBeUndefined();
});

test("worklet wrapper waits for admission, preserves receiver/options and only invokes fixed URL", async () => {
	const h = gateHarness(),
		options = { credentials: "omit" };
	// Admission is explicitly simulated here; this string is NOT a reviewed fixture.
	const result = h.worklet.addModule("adapter-routing-fixture", options);
	expect(h.nativeCalls).toEqual([]);
	expect(h.requests).toEqual([
		{ version: 1, id: 1, url: "adapter-routing-fixture" },
	]);
	h.window[HYPERFRAMES_FX_WORKLET_REPLY]({ id: 1, ok: true });
	await result;
	expect(h.nativeCalls).toEqual([
		{ target: h.worklet, url: HYPERFRAMES_FX_MODULE_URL, options },
	]);
	expect(
		Object.getOwnPropertyDescriptor(h.prototype, "addModule"),
	).toMatchObject({ writable: false, configurable: false });
	expect(
		Object.getOwnPropertyDescriptor(h.window, HYPERFRAMES_FX_WORKLET_REPLY),
	).toMatchObject({ writable: false, configurable: false });
});

test("worklet wrapper rejects unreviewed data and oversized URLs before native loading", async () => {
	const h = gateHarness();
	const result = h.worklet.addModule(
		"data:text/javascript;base64,YXV0aG9yLWNvZGU=",
	);
	h.window[HYPERFRAMES_FX_WORKLET_REPLY]({ id: h.requests[0].id, ok: false });
	await expect(result).rejects.toThrow("not reviewed");
	await expect(h.worklet.addModule("x".repeat(18001))).rejects.toThrow(
		"not reviewed",
	);
	expect(h.requests).toHaveLength(1);
	expect(h.nativeCalls).toEqual([]);
});

test("worklet wrapper bounds pending admissions and ignores unrelated replies", async () => {
	const h = gateHarness();
	const first = h.worklet.addModule("first"),
		second = h.worklet.addModule("second");
	await expect(h.worklet.addModule("third")).rejects.toThrow("not reviewed");
	h.window[HYPERFRAMES_FX_WORKLET_REPLY]({ id: 99, ok: true });
	expect(h.nativeCalls).toEqual([]);
	h.window[HYPERFRAMES_FX_WORKLET_REPLY]({ id: 1, ok: true });
	h.window[HYPERFRAMES_FX_WORKLET_REPLY]({ id: 2, ok: true });
	await Promise.all([first, second]);
	expect(h.nativeCalls.map((call) => call.url)).toEqual([
		HYPERFRAMES_FX_MODULE_URL,
		HYPERFRAMES_FX_MODULE_URL,
	]);
});
