import {
	disposeGpu,
	initializeGpu,
	WasmRuntimeGraphicsQuery,
} from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { checkLiquidRaster } from "./liquid-browser-raster";
import { checkLiquidReadback } from "./liquid-browser-readback";
import { checkLiquidReadbackLifecycle } from "./liquid-browser-readback-lifecycle";
import { checkLiquidTimeline } from "./liquid-browser-timeline";
import {
	spatialParams,
	spatialPixels,
	type LiquidCapture,
} from "./liquid-browser-scene";
import { exportLiquid } from "./liquid-export-probe";

export async function runLiquidProbe() {
	const readbackMode =
		new URL(location.href).searchParams.get("readback") === "1";
	const requestedBackend =
		new URL(location.href).searchParams.get("backend") ?? "webgpu";
	const graphics = new WasmRuntimeGraphicsQuery();
	const gpu = Reflect.get(navigator, "gpu");
	const adapterDiagnostics: Record<string, unknown> = {
		gpuPresent: Boolean(gpu),
	};
	if (gpu) {
		try {
			const adapter = await gpu.requestAdapter({
				powerPreference: "high-performance",
			});
			adapterDiagnostics.adapterPresent = Boolean(adapter);
			if (adapter) {
				adapterDiagnostics.info = Object.fromEntries(
					[
						"vendor",
						"architecture",
						"device",
						"description",
						"isFallbackAdapter",
					].map((key) => [key, adapter.info && Reflect.get(adapter.info, key)]),
				);
				try {
					const device = await adapter.requestDevice();
					adapterDiagnostics.device = true;
					device.destroy();
				} catch (error) {
					adapterDiagnostics.deviceError = String(error);
				}
			}
		} catch (error) {
			adapterDiagnostics.error = String(error);
		}
	}
	try {
		await initializeGpu();
	} catch (error) {
		return {
			ok: false,
			requestedBackend,
			backend: graphics.selectedBackend(),
			phase: "initialize",
			error: String(error),
			unavailableReason: graphics.unavailableReason(),
			adapterDiagnostics,
		};
	}
	const backend = graphics.selectedBackend();
	if (backend !== requestedBackend) {
		disposeGpu();
		return {
			ok: false,
			requestedBackend,
			backend,
			adapterDiagnostics,
			error: "Requested backend was not selected",
		};
	}
	let readbackLifecycle;
	if (readbackMode) {
		try {
			readbackLifecycle = await checkLiquidReadbackLifecycle(backend);
		} catch (error) {
			readbackLifecycle = { ok: false, error: String(error) };
		}
		if (!readbackLifecycle.ok) {
			disposeGpu();
			return {
				ok: false,
				requestedBackend,
				backend,
				adapterDiagnostics,
				readbackLifecycle,
				failures: ["readback-lifecycle"],
			};
		}
	}
	registerDefaultEffects();
	const params = spatialParams(),
		renderer = new CanvasRenderer(params);
	const capture: LiquidCapture = (node, local) =>
		renderer.renderAndCapture({
			node,
			time: local + 12000,
			capture: spatialPixels,
		});
	const sheet = document.createElement("canvas");
	sheet.width = 1280;
	sheet.height = 1080;
	const paint = (pixels: Uint8ClampedArray, slot: number) =>
		sheet
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), 640, 360),
				(slot % 2) * 640,
				Math.floor(slot / 2) * 360,
			);
	const results: Record<string, unknown> = {
			mode: readbackMode ? "browser-readback-tests" : "production-surface",
			requestedBackend,
			backend,
			adapterDiagnostics,
			readbackLifecycle,
		},
		failures: string[] = [];
	try {
		try {
			if (readbackMode) {
				const readback = await checkLiquidReadback(backend);
				results.readback = readback;
				if (!readback.ok) failures.push("raw-or-surface-readback");
			} else {
				const raster = await checkLiquidRaster();
				results.raster = raster;
				if (!raster.ok) failures.push("direct-raster");
			}
		} catch (error) {
			results[readbackMode ? "readback" : "raster"] = { error: String(error) };
			failures.push(
				readbackMode ? "readback exception" : "direct-raster exception",
			);
		}
		try {
			const timeline = await checkLiquidTimeline(capture, paint);
			const { baseline, source, parameters: _, ...report } = timeline;
			results.timeline = report;
			if (!timeline.ok) failures.push("scene-timeline");
			try {
				const video = await exportLiquid(params, source, baseline);
				results.video = video;
				if (!video.ok) failures.push("browser-decode");
			} catch (error) {
				results.video = { error: String(error) };
				failures.push("export exception");
			}
		} catch (error) {
			results.timeline = { error: String(error) };
			failures.push("scene-timeline exception");
		}
		Reflect.set(globalThis, "__liquidSheet", sheet.toDataURL("image/png"));
		return { ok: failures.length === 0, ...results, failures };
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
