import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { isRenderCancelledError } from "../../packages/editor-classic/src/services/renderer/compositor/render-request";
import { checkPipelineExport } from "./liquid-cancellation-pipeline-export";
import { targetPixelDiagnostics } from "./liquid-cancellation-pipeline-diagnostics";
import {
	browserTask,
	check,
	createPipeline,
	fingerprint,
	observationResult,
	pipelineScenes,
	pipelineSize,
	pipelineStart,
	pixels,
	same,
	timerSnapshot,
	visible,
} from "./liquid-cancellation-pipeline-support";

async function expectCancelled(operation: Promise<unknown>) {
	try {
		await operation;
	} catch (error) {
		check(
			isRenderCancelledError(error),
			`Expected typed cancellation; got ${String(error)}`,
		);
		return { name: "AbortError", code: "RENDER_CANCELLED" };
	}
	throw new Error("Cancelled production request unexpectedly succeeded");
}

/** Real production renderer/exporter + real WASM/GPU/codec; not a session UI test. */
export async function runLiquidCancellationPipeline() {
	Reflect.deleteProperty(globalThis, "__liquidPipelineMedia");
	Reflect.deleteProperty(globalThis, "__liquidPipelineDiagnostics");
	const checks: Record<string, unknown>[] = [];
	const cleanupErrors: string[] = [];
	const pipeline = createPipeline();
	const scenes = pipelineScenes();
	let failure: string | null = null;
	let backend = "uninitialized";
	let readbackAvailable = false;
	let graphics: WasmRuntimeGraphicsQuery | null = null;
	let gpu: WasmRuntimeGpuResourceQuery | null = null;
	try {
		// Real sessions call this through ensureEditorProcessBootstrap; standalone
		// renderer probes must perform the same idempotent default registration.
		registerDefaultEffects();
		await initializeGpu();
		graphics = new WasmRuntimeGraphicsQuery();
		gpu = new WasmRuntimeGpuResourceQuery();
		backend = graphics.selectedBackend() ?? "unavailable";
		check(
			backend === "webgl" || backend === "webgpu",
			"No real GPU backend selected",
		);
		const resetBaseline = () =>
			pipeline.renderer.renderAndCapture({
				node: scenes.baseline,
				time: pipelineStart,
				capture: pixels,
			});
		const baseline = await resetBaseline();
		const canvas = pipeline.compositor.getCanvas();
		check(
			visible(baseline),
			"Baseline readback is empty; no publication verdict is available",
		);
		await browserTask();
		check(
			same(baseline, pixels(canvas)),
			"No-mutation backbuffer changed across a browser task; readback unavailable, not evidence of partial publication",
		);
		readbackAvailable = true;
		checks.push({
			name: "nonempty task-stable readback control",
			baseline: fingerprint(baseline),
			pixels: baseline.length / 4,
		});

		const captureAbort = new AbortController();
		let captures = 0;
		const captureObservation = pipeline.compositor.arm("renderAndCapture", () =>
			captureAbort.abort(),
		);
		const captureError = await expectCancelled(
			pipeline.renderer.renderAndCapture({
				node: scenes.liquid,
				time: pipelineStart,
				signal: captureAbort.signal,
				capture: () => {
					captures++;
					return pixels(canvas);
				},
			}),
		);
		const captureTimer = await observationResult(captureObservation);
		const captureCancelledTimers = timerSnapshot(pipeline);
		check(
			captureAbort.signal.aborted && captures === 0,
			"Cancelled render invoked capture",
		);
		check(
			same(baseline, pixels(canvas)),
			"Cancelled renderAndCapture changed the compositor baseline",
		);
		const recovered = await pipeline.renderer.renderAndCapture({
			node: scenes.liquid,
			time: pipelineStart,
			capture: pixels,
		});
		check(
			visible(recovered) && !same(baseline, recovered),
			"Fresh renderAndCapture did not replace the baseline",
		);
		checks.push({
			name: "renderAndCapture cancellation and recovery",
			...captureTimer,
			error: captureError,
			captures,
			cancelledTimers: captureCancelledTimers,
			baselineRetained: true,
			recovered: fingerprint(recovered),
			timers: timerSnapshot(pipeline),
		});

		check(
			same(baseline, await resetBaseline()),
			"Baseline reset failed before target cancellation",
		);
		const target = document.createElement("canvas");
		Object.assign(target, pipelineSize);
		const targetContext = target.getContext("2d");
		check(targetContext, "Missing target canvas context");
		targetContext.fillStyle = "#ec2ba4";
		targetContext.fillRect(0, 0, target.width, target.height);
		const sentinel = pixels(target);
		const targetAbort = new AbortController();
		const targetObservation = pipeline.compositor.arm("renderToCanvas", () =>
			targetAbort.abort(),
		);
		const targetError = await expectCancelled(
			pipeline.renderer.renderToCanvas({
				node: scenes.liquid,
				time: pipelineStart,
				targetCanvas: target,
				signal: targetAbort.signal,
			}),
		);
		const targetTimer = await observationResult(targetObservation);
		const targetCancelledTimers = timerSnapshot(pipeline);
		check(
			targetAbort.signal.aborted && same(sentinel, pixels(target)),
			"Cancelled renderToCanvas changed the target sentinel",
		);
		check(
			same(baseline, pixels(canvas)),
			"Cancelled renderToCanvas changed the compositor baseline",
		);
		await pipeline.renderer.renderToCanvas({
			node: scenes.liquid,
			time: pipelineStart,
			targetCanvas: target,
		});
		checks.push(targetPixelDiagnostics(recovered, canvas, target));
		check(
			same(recovered, pixels(target)) && !same(sentinel, pixels(target)),
			"Fresh target rendering did not publish the expected recovered frame",
		);
		checks.push({
			name: "renderToCanvas cancellation and recovery",
			...targetTimer,
			error: targetError,
			cancelledTimers: targetCancelledTimers,
			sentinelRetained: true,
			baselineRetained: true,
			recovered: fingerprint(pixels(target)),
			timers: timerSnapshot(pipeline),
		});

		check(
			same(baseline, await resetBaseline()),
			"Baseline reset failed before exporter cancellation",
		);
		checks.push(
			await checkPipelineExport(
				pipeline,
				scenes.liquid,
				baseline,
				scenes.baseline,
			),
		);

		const handle = pipeline.compositor.handle;
		check(
			handle !== null && gpu.liveHandles().includes(handle),
			"Real compositor handle was not live before close",
		);
		const closeObservation = pipeline.compositor.arm(
			"close during replay",
			() => pipeline.compositor.close(),
		);
		const closeError = await expectCancelled(
			pipeline.renderer.render({ node: scenes.liquid, time: pipelineStart }),
		);
		const closeTimer = await observationResult(closeObservation);
		check(
			pipeline.compositor.handle === null,
			"Close retained the compositor handle",
		);
		check(
			pipeline.tracking.released.length === 1 &&
				pipeline.tracking.releaseCalls === 1 &&
				!gpu.liveHandles().includes(handle),
			"Close did not release the real GPU resource exactly once",
		);
		const rejectedAfterClose = await expectCancelled(
			pipeline.renderer.render({ node: scenes.liquid, time: pipelineStart }),
		);
		checks.push({
			name: "close cancels, truly drains and releases",
			...closeTimer,
			error: closeError,
			oldHandle: handle,
			handleAfter: pipeline.compositor.handle,
			releasedExactlyOnce: true,
			nativeHandleGone: true,
			rejectedAfterClose,
			timers: timerSnapshot(pipeline),
		});
	} catch (error) {
		failure =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
	} finally {
		pipeline.compositor.clearObservation();
		for (const cleanup of [
			() => pipeline.compositor.close(),
			() => pipeline.videoCache.dispose(),
		]) {
			try {
				await cleanup();
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
		try {
			gpu?.free();
		} catch (error) {
			cleanupErrors.push(String(error));
		}
		try {
			graphics?.free();
		} catch (error) {
			cleanupErrors.push(String(error));
		}
		try {
			disposeGpu();
		} catch (error) {
			cleanupErrors.push(String(error));
		}
	}
	return {
		ok: failure === null && cleanupErrors.length === 0,
		backend,
		...pipelineSize,
		fps: 30,
		readbackAvailable,
		checks,
		failure,
		cleanupErrors,
		resources: pipeline.tracking,
		evidenceScope:
			"Actual CanvasRenderer, WasmCompositor, SceneExporter, native Liquid requests and VP9 codec; fixture resource registry only; not full session UI or independent solver oracle",
	};
}
