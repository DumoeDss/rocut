import { expect, test } from "bun:test";
import { createImagePreprocessYield } from "./image-preprocess-yield";

test("yield is a real task hop and repeated hops preserve work", async () => {
	const cooperative = createImagePreprocessYield(new AbortController().signal);
	try {
		let completed = false;
		const first = cooperative.wait().then(() => { completed = true; });
		await Promise.resolve();
		expect(completed).toBe(false);
		await first;
		let visits = 0;
		for (let step = 0; step < 12; step++) {
			visits += 16384;
			await cooperative.wait();
		}
		expect(visits).toBe(12 * 16384);
	} finally {
		cooperative.close();
	}
});

test("abort rejects pending yield and closes both ports without timers", async () => {
	const original = globalThis.MessageChannel;
	const originalTimer = globalThis.setTimeout;
	let closes = 0, posts = 0, timers = 0;
	class ControlledChannel {
		port1 = { onmessage: null, close() { closes++; } };
		port2 = { postMessage() { posts++; }, close() { closes++; } };
	}
	Reflect.set(globalThis, "MessageChannel", ControlledChannel);
	Reflect.set(globalThis, "setTimeout", () => { timers++; throw Error("Unexpected timer yield"); });
	try {
		const controller = new AbortController();
		const cooperative = createImagePreprocessYield(controller.signal);
		const pending = cooperative.wait();
		const reason = Error("cancelled");
		controller.abort(reason);
		await expect(pending).rejects.toBe(reason);
		cooperative.close();
		expect(closes).toBe(2);
		expect(posts).toBe(1);
		expect(timers).toBe(0);
		expect(() => cooperative.wait()).toThrow("cancelled");
	} finally {
		globalThis.MessageChannel = original;
		globalThis.setTimeout = originalTimer;
	}
});
