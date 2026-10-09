import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { hyperframesFrameDriver } from "../programmatic/engines/hyperframes-driver";

function fixture(faces: { load(): Promise<unknown> }[]) {
	let domReady = () => {};
	let timeout = () => {};
	let cleared = false;
	let timeoutMs = 0;
	const window: { rocut?: { ready: Promise<unknown> } } = {};
	runInNewContext(hyperframesFrameDriver({ numerator: 30, denominator: 1 }).slice(8, -9), {
		window,
		document: {
			fonts: faces, body: { offsetHeight: 64 },
			addEventListener(event: string, callback: () => void, options: unknown) {
				expect(event).toBe("DOMContentLoaded");
				expect(options).toEqual({ once: true, capture: true });
				domReady = callback;
			},
		},
		setTimeout(callback: () => void, ms: number) { timeout = callback; timeoutMs = ms; return 1; },
		clearTimeout() { cleared = true; },
	});
	return { domReady, ready: window.rocut!.ready, expire: () => timeout(), timeoutMs: () => timeoutMs, cleared: () => cleared };
}

test("native driver starts unused font loads before upstream's DOM callback and awaits every face", async () => {
	const loads: string[] = [];
	let complete = () => {};
	const pending = new Promise<void>(resolve => { complete = resolve; });
	const state = fixture([
		{ load() { loads.push("one"); return pending; } },
		{ load() { loads.push("two"); return Promise.resolve(); } },
	]);
	state.domReady();
	expect(loads).toEqual(["one", "two"]);
	let ready = false;
	state.ready.then(() => { ready = true; });
	await Promise.resolve();
	expect(ready).toBe(false);
	complete();
	await state.ready;
	expect(ready).toBe(true);
	expect(state.cleared()).toBe(true);
});

test("corrupt fonts fail capture readiness rather than accepting fallback", async () => {
	const state = fixture([{ load: () => Promise.reject(Error("font decode failed")) }]);
	state.domReady();
	await expect(state.ready).rejects.toThrow("font decode failed");
	expect(state.cleared()).toBe(true);
});

test("stalled fonts fail before upstream's soft font fallback and clear watchdog", async () => {
	const state = fixture([{ load: () => new Promise(() => {}) }]);
	state.domReady();
	expect(state.timeoutMs()).toBeGreaterThan(0);
	expect(state.timeoutMs()).toBeLessThan(5000);
	state.expire();
	await expect(state.ready).rejects.toThrow("font readiness timed out");
	expect(state.cleared()).toBe(true);
});
