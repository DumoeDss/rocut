import { disposeCompositor } from "opencut-wasm";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { pipelineFps, pipelineSize } from "./droplets-pipeline-cases";

export function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

export function pixels(source: CanvasImageSource) {
	const copy = new OffscreenCanvas(pipelineSize.width, pipelineSize.height);
	const context = copy.getContext("2d", { willReadFrequently: true });
	check(context, "Missing Droplets readback context");
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}

export function same(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function fingerprint(data: Uint8ClampedArray) {
	let hash = 2166136261;
	for (const value of data) hash = Math.imul(hash ^ value, 16777619);
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function base64(chunks: Iterable<Uint8Array | Uint8ClampedArray>) {
	let binary = "";
	for (const chunk of chunks)
		for (let offset = 0; offset < chunk.length; offset += 8192)
			binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
	return btoa(binary);
}

export function createDropletsPipeline() {
	const tracking = {
		created: [] as number[],
		released: [] as number[],
		timers: { created: 0, released: 0, live: 0 },
		releaseCalls: 0,
	};
	const cancelTimers = new Set<() => void>();
	// Only the registry is fixture-owned. Allocation, rendering and disposal are real.
	const resources = {
		setTimeout: ({ handler, ms }: { handler: () => void; ms: number }) => {
			const resourceId = `droplets-pipeline:timer:${++tracking.timers.created}`;
			tracking.timers.live++;
			let active = true;
			const release = () => {
				if (!active) return;
				active = false;
				tracking.timers.live--;
				tracking.timers.released++;
				cancelTimers.delete(cancel);
			};
			const id = window.setTimeout(() => {
				release();
				handler();
			}, ms);
			const cancel = () => {
				window.clearTimeout(id);
				release();
			};
			cancelTimers.add(cancel);
			return { resourceId, kind: "timeout" as const, cancel };
		},
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => {
			tracking.created.push(handle);
			return {
				handle,
				label,
				resourceId: `droplets-pipeline:${handle}`,
				release: () => {
					tracking.releaseCalls++;
					check(
						!tracking.released.includes(handle),
						"GPU resource released twice",
					);
					disposeCompositor(handle);
					tracking.released.push(handle);
				},
			};
		},
	} as SessionResources;
	const compositor = new WasmCompositor(resources);
	const videoCache = new VideoCache();
	const params = { ...pipelineSize, fps: pipelineFps, compositor, videoCache };
	return {
		...params,
		renderer: new CanvasRenderer(params),
		tracking,
		cancelTimers: () => {
			for (const cancel of [...cancelTimers]) cancel();
		},
	};
}

export type DropletsPipeline = ReturnType<typeof createDropletsPipeline>;
