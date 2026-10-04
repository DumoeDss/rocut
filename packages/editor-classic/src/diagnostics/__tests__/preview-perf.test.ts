import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import {
	measurePreviewSubmission,
	type PreviewPerfObserver,
} from "../preview-perf";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const now = spyOn(performance, "now");
afterAll(() => now.mockRestore());
let clock = 100;
const setup = () => {
	clock = 100;
	now.mockImplementation(() => clock);
	const observer: PreviewPerfObserver = { samples: [], droppedSamples: 0 };
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { __rocutPreviewPerf: observer },
	});
	return observer;
};
const measure = (render: () => Promise<void>) =>
	measurePreviewSubmission({
		render,
		time: 120000,
		width: 1280,
		height: 720,
	});
afterEach(() => {
	if (originalWindow)
		Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
	now.mockClear();
});

test("disabled measurement returns the original promise without reading the clock", () => {
	setup();
	delete window.__rocutPreviewPerf;
	const operation = Promise.resolve();
	expect(measure(() => operation)).toBe(operation);
	expect(now).not.toHaveBeenCalled();
});

test("records full asynchronous submission and preserves rejection identity", async () => {
	const observer = setup();
	await measure(async () => {
		await Promise.resolve();
		clock += 19;
	});
	expect(observer.samples[0]).toEqual({
		time: 120000,
		width: 1280,
		height: 720,
		startedAt: 100,
		durationMs: 19,
		completed: true,
	});
	const error = new Error("stale publication");
	await expect(
		measure(async () => {
			clock += 7;
			throw error;
		}),
	).rejects.toBe(error);
	expect(observer.samples[1]).toMatchObject({
		durationMs: 7,
		completed: false,
	});
});

test("counts discarded samples when a diagnostic client stops draining", async () => {
	const observer = setup();
	for (let i = 0; i < 520; i++)
		await measure(async () => {
			clock++;
		});
	expect(observer.samples.length).toBe(512);
	expect(observer.droppedSamples).toBe(8);
	expect(observer.samples[0].startedAt).toBe(108);
	expect(observer.samples.at(-1)?.startedAt).toBe(619);
});

test("disabled or replaced observers do not retain in-flight completions", async () => {
	const old = setup();
	let release!: () => void;
	const operation = measure(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	window.__rocutPreviewPerf = { samples: [], droppedSamples: 0 };
	release();
	await operation;
	expect(old.samples).toEqual([]);
	expect(window.__rocutPreviewPerf.samples).toEqual([]);
});
