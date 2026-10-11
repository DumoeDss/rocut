import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	normalizeRenderCancellation,
	RenderCancelledError,
} from "../compositor/render-request";
import type { ResolveContext } from "../resolve-context";

test("native default abort reason is normalized only by exact identity", () => {
	const controller = new AbortController();
	controller.abort();
	expect(
		normalizeRenderCancellation({
			error: controller.signal.reason,
			signal: controller.signal,
		}),
	).toBeInstanceOf(RenderCancelledError);
	const independent = new DOMException(
		"Independent cancellation",
		"AbortError",
	);
	expect(
		normalizeRenderCancellation({
			error: independent,
			signal: controller.signal,
		}),
	).toBe(independent);
	expect(normalizeRenderCancellation({ error: independent })).toBe(independent);
	expect(
		normalizeRenderCancellation({
			error: independent,
			signal: new AbortController().signal,
		}),
	).toBe(independent);
});
test("typed cancellation, unrelated failure, custom Error reason and timeout retain exact objects", () => {
	const controller = new AbortController();
	controller.abort();
	for (const error of [
		new RenderCancelledError(),
		new Error("Resource decode failed"),
		{ name: "AbortError" },
	])
		expect(
			normalizeRenderCancellation({ error, signal: controller.signal }),
		).toBe(error);
	for (const error of [
		new Error("Custom failed operation"),
		new DOMException("Deadline", "TimeoutError"),
	]) {
		const aborted = new AbortController();
		aborted.abort(error);
		expect(normalizeRenderCancellation({ error, signal: aborted.signal })).toBe(
			error,
		);
	}
});

if (process.env.ROCUT_NODE_CANCELLATION_ISOLATED !== "1") {
	test("production node cancellation and finally checks run in isolation", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_NODE_CANCELLATION_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	mock.module("../programmatic/frame", () => ({
		resolveProgrammaticFrame: () => ({ index: 0 }),
	}));
	mock.module("../resolve-visual-state", () => ({
		resolveVisualState: () => ({ opacity: 1 }),
	}));
	mock.module("../programmatic/canvas-runtime", () => ({
		renderProgrammaticCanvas: async () => {
			throw Error("Unexpected rasterization");
		},
	}));
	const { ProgrammaticNode } = await import("./programmatic-node");
	for (const unrelated of [false, true])
		test(`real resource provider rejection preserves finally release (${unrelated ? "unrelated" : "signal reason"})`, async () => {
			const controller = new AbortController(),
				failure = new Error("Concurrent resource failure");
			let used = 0,
				released = 0,
				begin!: () => void;
			const started = new Promise<void>((resolve) => {
				begin = resolve;
			});
			const preprocessor = {
				reserve: (bytes: number) => {
					used += bytes;
					return () => {
						used -= bytes;
						released++;
					};
				},
			};
			const residency = {
				assertOpen() {},
				client: () => ({
					signal: new AbortController().signal,
					preprocessor,
					belongsTo: () => true,
				}),
			};
			const node = new ProgrammaticNode({
				source: {
					version: 1,
					runtime: "canvas-worker",
					code: "",
					width: 2,
					height: 2,
					frameRate: { numerator: 60, denominator: 1 },
					durationFrames: 60,
					seed: 0,
					resources: [
						{
							id: "image",
							kind: "image",
							mimeType: "image/png",
							byteLength: 24,
							sha256: "a".repeat(64),
							attachmentKey: "test",
						},
					],
				},
				duration: 1,
				timeOffset: 0,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					scaleX: 1,
					scaleY: 1,
					position: { x: 0, y: 0 },
					rotate: 0,
				},
				opacity: 1,
				programmaticFrames: {
					renderPng: async () => {
						throw Error("Unexpected PNG");
					},
					loadResource: async ({ signal }) => {
						begin();
						return new Promise((_resolve, reject) =>
							signal.addEventListener(
								"abort",
								() => reject(unrelated ? failure : signal.reason),
								{ once: true },
							),
						);
					},
				},
			});
			const context = {
				rasterResidency: residency,
				time: 0,
				renderer: { width: 2, height: 2 },
				videoCache: { getFrameAt: async () => null },
				signal: controller.signal,
			} as unknown as ResolveContext;
			const pending = node.resolve(context);
			await started;
			expect(used).toBe(24);
			controller.abort();
			const rejection = await pending.then(
				() => {
					throw Error("Expected rejection");
				},
				(error) => error,
			);
			if (unrelated) expect(rejection).toBe(failure);
			else expect(rejection).toBeInstanceOf(RenderCancelledError);
			await Promise.resolve();
			expect(used).toBe(0);
			expect(released).toBe(1);
			expect(Reflect.get(node, "pending")).toBeNull();
			expect(Reflect.get(node, "cached")).toBeNull();
		});
}
