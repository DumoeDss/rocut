import { afterEach, expect, test } from "bun:test";
import {
	incrementCounter,
	onRenderPerfFrameComplete,
	recordSpan,
} from "./render-perf";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
	if (originalWindow)
		Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
});

test("opt-in stage reports are bounded, flush preview frames and preserve independent counters", () => {
	const observer: NonNullable<Window["__rocutRenderPerf"]> = { reports: [] };
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { __rocutRenderPerf: observer },
	});
	for (let frame = 0; frame < 330; frame++) {
		recordSpan({ name: "resolve", durationMs: 5 });
		incrementCounter({ name: "textureUpload", by: 2 });
		onRenderPerfFrameComplete();
	}
	expect(observer.reports).toHaveLength(32);
	expect(observer.reports[0]).toEqual({
		frames: 10,
		spans: [
			{ span: "resolve", count: 10, meanMs: 5, p50Ms: 5, p95Ms: 5, maxMs: 5 },
		],
		counters: [
			{ counter: "textureUpload", perFrame: 2, total: 20, frames: 10 },
		],
	});
	for (let i = 0; i < 600; i++)
		recordSpan({ name: "longRequest", durationMs: 3 });
	for (let i = 0; i < 10; i++) onRenderPerfFrameComplete();
	expect(observer.reports.at(-1)?.spans[0]).toMatchObject({
		count: 512,
		meanMs: 3,
	});
	Reflect.deleteProperty(window, "__rocutRenderPerf");
	recordSpan({ name: "disabled", durationMs: 100 });
	onRenderPerfFrameComplete();
	expect(observer.reports).toHaveLength(32);
});
