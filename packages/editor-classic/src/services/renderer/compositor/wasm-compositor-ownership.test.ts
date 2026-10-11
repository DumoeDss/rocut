import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { SessionResources } from "../../../editor/session/resources";
import type { FrameDescriptor } from "./types";

if (process.env.ROCUT_CAPTURE_OWNERSHIP_ISOLATED !== "1") {
	test("capture ownership runs with isolated WASM boundary doubles", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_CAPTURE_OWNERSHIP_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15_000);
} else {
	let advance: () => boolean | Promise<boolean> = () => true;
	let onBegin: () => void = () => {};
	let released = 0;
	let committed = 0;
	let cancelled = 0;
	mock.module("opencut-wasm", () => ({
		createCompositor: () => 1,
		disposeCompositor: () => {},
		getCompositorCanvasForHandle: () => ({}),
		getLastFrameProfile: () => [],
		releaseTextureForHandle: () => {},
		uploadTextureForHandle: () => {},
		resizeCompositorForHandle: () => {},
		renderFrameForHandle: () => {},
		beginRenderFrameForHandle: () => {
			onBegin();
			return 1;
		},
		advanceRenderFrameForHandle: () => advance(),
		commitRenderFrameForHandle: () => {
			committed++;
		},
		cancelRenderFrameForHandle: () => {
			cancelled++;
		},
	}));
	const { WasmCompositor } = await import("./wasm-compositor");
	const { RenderCancelledError } = await import("./render-request");
	const frame: FrameDescriptor = {
		width: 8,
		height: 8,
		clear: { color: [0, 0, 0, 0] },
		items: [],
	};
	const resources: Pick<SessionResources, "trackGpuResource"> = {
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: "capture-test",
			release: () => {
				released++;
			},
		}),
	};
	function create() {
		// No timer is used: advance only returns ready or a pending capture.
		const compositor = new WasmCompositor(resources as SessionResources);
		compositor.ensureInitialized({ width: 8, height: 8 });
		return compositor;
	}
	test("pending capture retains exclusive GPU ownership until its Promise settles", async () => {
		const compositor = create();
		let finish!: (ready: boolean) => void;
		advance = () =>
			new Promise<boolean>((resolve) => {
				finish = resolve;
			});
		const pending = compositor.renderAsync(frame);
		expect(() => compositor.syncTextures([])).toThrow("Active compositor work");
		expect(() =>
			compositor.ensureInitialized({ width: 16, height: 16 }),
		).toThrow("Active compositor work");
		expect(() => compositor.render(frame)).toThrow("Active compositor work");
		await expect(compositor.renderAsync(frame)).rejects.toMatchObject({
			code: "COMPOSITOR_BUSY",
		});
		const before = released;
		const closing = compositor.close();
		expect(released).toBe(before);
		expect(cancelled).toBe(1);
		finish(true);
		await expect(pending).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
		await closing;
		expect(released).toBe(before + 1);
		expect(committed).toBe(0);
	});
	test("completed capture releases the barrier for the next upload and synchronous render", async () => {
		advance = () => true;
		const compositor = create();
		await compositor.renderAsync(frame);
		compositor.syncTextures([]);
		compositor.ensureInitialized({ width: 16, height: 16 });
		compositor.render(frame);
		await compositor.close();
	});
	test("Host close during begin sees reserved ownership before entering WASM", async () => {
		const compositor = create();
		const before = released;
		let closing: Promise<void> | undefined;
		onBegin = () => {
			closing = compositor.close();
			expect(() => compositor.dispose()).toThrow("Active compositor work");
			expect(released).toBe(before);
		};
		try {
			await expect(compositor.renderAsync(frame)).rejects.toMatchObject({
				code: "RENDER_CANCELLED",
			});
			await closing;
			expect(released).toBe(before + 1);
		} finally {
			onBegin = () => {};
		}
	});
	for (const cancellation of ["caller", "cancelAndDrain"] as const)
		test(`real transaction ${cancellation} normalizes native reason only after operation drain`, async () => {
			const compositor = create();
			const caller = new AbortController();
			let begin!: () => void;
			const started = new Promise<void>((resolve) => {
				begin = resolve;
			});
			let finish!: () => void;
			const cleanup = new Promise<void>((resolve) => {
				finish = resolve;
			});
			let nativeReason: unknown;
			const pending = compositor.runExclusive(
				async (signal) => {
					begin();
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
					nativeReason = signal.reason;
					await cleanup;
					throw nativeReason;
				},
				{ signal: caller.signal },
			);
			let settled = false;
			const rejection = pending.then(
				() => {
					throw Error("Expected cancellation");
				},
				(error: unknown) => {
					settled = true;
					return error;
				},
			);
			await started;
			let drained = false;
			const drain =
				cancellation === "cancelAndDrain"
					? compositor.cancelAndDrain().then(() => {
							drained = true;
						})
					: undefined;
			if (cancellation === "caller") caller.abort();
			let nextStarted = false;
			const next = compositor.runExclusive(async () => {
				nextStarted = true;
				return "next frame";
			});
			await Promise.resolve();
			expect(nativeReason).toBeInstanceOf(DOMException);
			expect(settled).toBe(false);
			expect(drained).toBe(false);
			expect(nextStarted).toBe(false);
			finish();
			expect(await rejection).toBeInstanceOf(RenderCancelledError);
			await drain;
			if (drain) expect(drained).toBe(true);
			expect(await next).toBe("next frame");
			await compositor.close();
		});
	for (const { failure, customReason } of [
		{ failure: new Error("Independent decode failed"), customReason: false },
		{
			failure: new DOMException("Independent abort", "AbortError"),
			customReason: false,
		},
		{ failure: new Error("Custom caller reason"), customReason: true },
		{
			failure: new DOMException("Deadline exceeded", "TimeoutError"),
			customReason: true,
		},
	])
		test(`aborted transaction preserves independent ${failure.name}: ${failure.message}`, async () => {
			const compositor = create();
			const caller = new AbortController();
			let begin!: () => void;
			const started = new Promise<void>((resolve) => {
				begin = resolve;
			});
			const pending = compositor.runExclusive(
				async (signal) => {
					begin();
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
					expect(signal.aborted).toBe(true);
					expect(signal.reason).not.toBe(failure);
					throw failure;
				},
				{ signal: caller.signal },
			);
			const rejection = pending.catch((error: unknown) => error);
			await started;
			caller.abort(customReason ? failure : undefined);
			expect(await rejection).toBe(failure);
			expect(await compositor.runExclusive(async () => "recovered")).toBe(
				"recovered",
			);
			await compositor.close();
		});
}
