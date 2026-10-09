import {
	advanceRenderFrameForHandle,
	beginRenderFrameForHandle,
	cancelRenderFrameForHandle,
	commitRenderFrameForHandle,
	createCompositor,
	disposeCompositor,
	disposeGpu,
	getCompositorCanvasForHandle,
	initializeGpu,
	renderFrameForHandle,
	resizeCompositorForHandle,
	uploadTextureForHandle,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import {
	cancellationFrame,
	cancellationPixels,
	cancellationPlacements,
	cancellationSize,
	cancellationTexture,
	samePixels,
} from "./liquid-cancellation-cases";
import { checkLiquidCancellationDriver } from "./liquid-cancellation-driver";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function cancelled(action: () => unknown) {
	try {
		action();
	} catch (error) {
		check(
			error instanceof Error &&
				error.name === "AbortError" &&
				Reflect.get(error, "code") === "RENDER_CANCELLED",
			`Expected typed cancellation; got ${String(error)}`,
		);
		return;
	}
	throw new Error("Cancelled request unexpectedly succeeded");
}

function complete(handle: number, request: number, chunk: number) {
	let calls = 0;
	while (true) {
		check(++calls <= 128, "Unexpected replay count");
		if (advanceRenderFrameForHandle(handle, request, chunk)) break;
	}
	commitRenderFrameForHandle(handle, request);
	return calls;
}

export async function runLiquidCancellation() {
	const checks: Record<string, unknown>[] = [];
	let handle: number | undefined;
	const graphics = new WasmRuntimeGraphicsQuery();
	try {
		await initializeGpu();
		check(graphics.selectedBackend() === "webgl", "Expected WebGL backend");
		handle = createCompositor(cancellationSize.width, cancellationSize.height);
		uploadTextureForHandle(handle, cancellationTexture());
		const canvas = getCompositorCanvasForHandle(handle);
		renderFrameForHandle(handle, cancellationFrame("layer", false));
		const readbackControl = cancellationPixels(canvas);
		check(
			readbackControl.some((value, index) => index % 4 !== 3 && value > 32),
			"Readback control is empty; no pixel-publication verdict is available",
		);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		check(
			samePixels(readbackControl, cancellationPixels(canvas)),
			"No-mutation backbuffer changed across a task; readback is unavailable, not evidence of partial publication",
		);
		checks.push({
			taskReadbackControl: true,
			pixels: readbackControl.length / 4,
		});
		for (const placement of cancellationPlacements) {
			const baseline = cancellationFrame(placement, false);
			const frame = cancellationFrame(placement);
			renderFrameForHandle(handle, baseline);
			const before = cancellationPixels(canvas);
			const request = beginRenderFrameForHandle(handle, frame);
			check(
				!advanceRenderFrameForHandle(handle, request, 1),
				`${placement}: must have unfinished physical steps`,
			);
			const started = performance.now();
			let timerObserved = false;
			await new Promise<void>((resolve) => {
				setTimeout(() => {
					timerObserved = true;
					cancelRenderFrameForHandle(handle!, request);
					resolve();
				}, 0);
			});
			const cancelTaskDelayMs = performance.now() - started;
			check(timerObserved, "Abort did not run in a browser task");
			cancelled(() => advanceRenderFrameForHandle(handle!, request, 1));
			cancelled(() => commitRenderFrameForHandle(handle!, request));
			check(
				samePixels(before, cancellationPixels(canvas)),
				"Partial frame published",
			);
			renderFrameForHandle(handle, frame);
			const synchronous = cancellationPixels(canvas);
			check(!samePixels(before, synchronous), "Fixture effect was not visible");
			const chunkCalls: number[] = [];
			for (const chunk of [1, 5, 64]) {
				renderFrameForHandle(handle, baseline);
				check(
					samePixels(before, cancellationPixels(canvas)),
					"Baseline reset failed",
				);
				const recovery = beginRenderFrameForHandle(handle, frame);
				chunkCalls.push(complete(handle, recovery, chunk));
				check(
					samePixels(synchronous, cancellationPixels(canvas)),
					`${placement}: sync/chunked pixels differ for chunk ${chunk}`,
				);
			}
			checks.push({ placement, timerObserved, cancelTaskDelayMs, chunkCalls });
		}
		checks.push({ driver: await checkLiquidCancellationDriver(handle) });
		const frame = cancellationFrame("multiple");
		renderFrameForHandle(handle, frame);
		const multipleReference = cancellationPixels(canvas);
		for (const mutation of [
			"resize",
			"upload",
			"sync-render",
			"new-request",
		] as const) {
			renderFrameForHandle(handle, cancellationFrame("layer", false));
			const old = beginRenderFrameForHandle(handle, frame);
			check(
				!advanceRenderFrameForHandle(handle, old, 1),
				"Expected pending request",
			);
			let replacement: number | undefined;
			if (mutation === "resize") resizeCompositorForHandle(handle, 96, 64);
			else if (mutation === "upload")
				uploadTextureForHandle(handle, cancellationTexture());
			else if (mutation === "sync-render")
				renderFrameForHandle(handle, cancellationFrame("layer", false));
			else replacement = beginRenderFrameForHandle(handle, frame);
			cancelled(() => advanceRenderFrameForHandle(handle!, old, 1));
			cancelled(() => commitRenderFrameForHandle(handle!, old));
			cancelRenderFrameForHandle(handle, old);
			replacement ??= beginRenderFrameForHandle(handle, frame);
			complete(handle, replacement, 5);
			check(
				samePixels(multipleReference, cancellationPixels(canvas)),
				`${mutation}: recovery did not replace the sentinel with the expected frame`,
			);
			checks.push({ mutation, oldRejected: true, recovery: true });
		}
		const fast = beginRenderFrameForHandle(
			handle,
			cancellationFrame("layer", false),
		);
		check(
			advanceRenderFrameForHandle(handle, fast, 1),
			"No-Liquid request should be immediately ready",
		);
		commitRenderFrameForHandle(handle, fast);
		check(
			samePixels(readbackControl, cancellationPixels(canvas)),
			"No-Liquid commit did not replace the previous effect frame",
		);
		const disposed = beginRenderFrameForHandle(handle, frame);
		check(
			!advanceRenderFrameForHandle(handle, disposed, 1),
			"Expected live request at dispose",
		);
		disposeCompositor(handle);
		cancelled(() => advanceRenderFrameForHandle(handle!, disposed, 1));
		cancelRenderFrameForHandle(handle, disposed);
		handle = undefined;
		checks.push({ noLiquidReady: true, disposedRequestRejected: true });
		return { ok: true, backend: graphics.selectedBackend(), checks };
	} catch (error) {
		return {
			ok: false,
			checks,
			failure: error instanceof Error ? error.stack : String(error),
		};
	} finally {
		if (handle !== undefined) disposeCompositor(handle);
		disposeGpu();
		graphics.free();
	}
}
