import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGpuResourceQuery,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { checkHighChromaExport } from "./high-chroma-export";
import {
	highChromaContract,
	type HighChromaCaseId,
} from "./high-chroma-contract";
import { createHighChromaPipeline } from "./high-chroma-scenes";
import { check } from "./droplets-pipeline-support";

/** Production pipeline with real native rendering and codec; not an installed UI test. */
export async function runHighChromaPipeline({
	caseId,
	videoChroma,
}: {
	caseId: HighChromaCaseId;
	videoChroma?: "420" | "444";
}) {
	Reflect.deleteProperty(globalThis, "__highChromaMedia");
	Reflect.deleteProperty(globalThis, "__highChromaDecode");
	const pipeline = createHighChromaPipeline(caseId);
	const results: Record<string, unknown>[] = [],
		cleanupErrors: string[] = [];
	let graphics: WasmRuntimeGraphicsQuery | null = null;
	let gpu: WasmRuntimeGpuResourceQuery | null = null;
	let failure: string | null = null;
	let backend = "uninitialized";
	let nativeHandlesGone = false;
	try {
		registerDefaultEffects();
		await initializeGpu();
		graphics = new WasmRuntimeGraphicsQuery();
		gpu = new WasmRuntimeGpuResourceQuery();
		backend = graphics.selectedBackend() ?? "unavailable";
		const requested =
			new URL(location.href).searchParams.get("backend") ?? "webgl";
		check(backend === requested, "Requested real GPU backend was not selected");
		const exported = await checkHighChromaExport({
			caseId,
			pipeline,
			videoChroma,
		});
		results.push(exported);
		check(
			exported.decoded.accepted,
			"Actual media exceeded the unchanged pixel/timing gates",
		);
		check(
			pipeline.tracking.created.length > 0,
			"Production compositor never allocated a GPU handle",
		);
		check(
			pipeline.tracking.created.every((handle) =>
				gpu!.liveHandles().includes(handle),
			),
			"Production compositor handle disappeared before cleanup",
		);
	} catch (error) {
		failure =
			error instanceof Error ? (error.stack ?? error.message) : String(error);
	} finally {
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
			check(
				pipeline.tracking.timers.live === 0 &&
					pipeline.tracking.timers.created ===
						pipeline.tracking.timers.released,
				"Production pipeline leaked a session-owned timer",
			);
			check(
				pipeline.tracking.releaseCalls === pipeline.tracking.created.length &&
					pipeline.tracking.released.length ===
						pipeline.tracking.created.length,
				"Production GPU resources were not released exactly once",
			);
			nativeHandlesGone = Boolean(
				gpu &&
				pipeline.tracking.created.every(
					(handle) => !gpu!.liveHandles().includes(handle),
				),
			);
			if (gpu)
				check(
					nativeHandlesGone,
					"Native GPU registry retained a fixture handle",
				);
		} catch (error) {
			cleanupErrors.push(String(error));
		}
		pipeline.cancelTimers();
		for (const cleanup of [
			() => gpu?.free(),
			() => graphics?.free(),
			() => disposeGpu(),
		]) {
			try {
				cleanup();
			} catch (error) {
				cleanupErrors.push(String(error));
			}
		}
	}
	return {
		ok: failure === null && cleanupErrors.length === 0,
		backend,
		caseId,
		requestedVideoChroma: videoChroma ?? "default",
		width: pipeline.width,
		height: pipeline.height,
		fps: pipeline.fps.numerator / pipeline.fps.denominator,
		thresholds: highChromaContract.thresholds,
		results,
		failure,
		cleanupErrors,
		resources: pipeline.tracking,
		nativeHandlesGone,
		scope:
			"Real unmodified SceneExporter explicit-chroma export; independent frozen references; no encoding interception, installed UI or hardware performance acceptance",
	};
}
