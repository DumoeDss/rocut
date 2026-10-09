import { disposeCompositor } from "opencut-wasm";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import type { FrameDescriptor } from "../../packages/editor-classic/src/services/renderer/compositor/types";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { EffectLayerNode } from "../../packages/editor-classic/src/services/renderer/nodes/effect-layer-node";
import { ImageNode } from "../../packages/editor-classic/src/services/renderer/nodes/image-node";
import { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { liquidParameters, liquidSource } from "./liquid-browser-cases";

export const pipelineSize = { width: 96, height: 64 };
export const pipelineFps = { numerator: 30, denominator: 1 };
export const pipelineStart = 24000;
export const pipelineFrameTicks = 4000;

export function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

export function browserTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export function pixels(source: CanvasImageSource): Uint8ClampedArray {
	const copy = new OffscreenCanvas(pipelineSize.width, pipelineSize.height);
	const context = copy.getContext("2d", { willReadFrequently: true });
	check(context, "Missing 2D readback context");
	context.drawImage(source, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}

export function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function visible(data: Uint8ClampedArray): boolean {
	return data.some((value, index) => index % 4 !== 3 && value > 32);
}

export function fingerprint(data: Uint8ClampedArray): string {
	let hash = 2166136261;
	for (const value of data) hash = Math.imul(hash ^ value, 16777619);
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function pipelineScenes() {
	const source = document.createElement("canvas");
	Object.assign(source, pipelineSize);
	const context = source.getContext("2d");
	check(context, "Missing source canvas context");
	context.putImageData(
		new ImageData(
			liquidSource(source.width, source.height),
			source.width,
			source.height,
		),
		0,
		0,
	);
	const url = source.toDataURL("image/png");
	const build = (active: boolean) => {
		const root = new RootNode({ duration: 120000 });
		root.add(
			new ImageNode({
				url,
				duration: 120000,
				timeOffset: 0,
				trimStart: 0,
				trimEnd: 0,
				transform: {
					position: { x: 0, y: 0 },
					scaleX: 1,
					scaleY: 1,
					rotate: 0,
				},
				opacity: 1,
				blendMode: "normal",
			}),
		);
		if (active)
			root.add(
				new EffectLayerNode({
					effectType: "liquid",
					effectParams: liquidParameters({
						startTicks: 0,
						durationTicks: 60000,
					}),
					timeOffset: 0,
					duration: 120000,
				}),
			);
		return root;
	};
	return { baseline: build(false), liquid: build(true) };
}

function liquidPassCount(frame: FrameDescriptor): number {
	return frame.items.reduce((count, item) => {
		const groups =
			item.type === "transition"
				? [...item.outgoing, ...item.incoming].flatMap(
						(layer) => layer.effectPassGroups,
					)
				: item.effectPassGroups;
		return (
			count + groups.flat().filter((pass) => pass.shader === "liquid").length
		);
	}, 0);
}

export interface ReplayObservation {
	label: string;
	liquidPasses: number;
	timerObserved: boolean;
	pendingAtTimer: boolean;
	delayMs: number | null;
	action: Promise<void> | null;
}

/** Instrumentation only: every native request and rendered pixel comes from super. */
export class ObservedCompositor extends WasmCompositor {
	private armed: {
		observation: ReplayObservation;
		action: () => unknown;
	} | null = null;
	private readonly timers = new Set<ReturnType<typeof setTimeout>>();

	arm(label: string, action: () => unknown): ReplayObservation {
		check(!this.armed, "Previous replay observation was not consumed");
		const observation: ReplayObservation = {
			label,
			liquidPasses: 0,
			timerObserved: false,
			pendingAtTimer: false,
			delayMs: null,
			action: null,
		};
		this.armed = { observation, action };
		return observation;
	}

	override renderAsync(
		frame: FrameDescriptor,
		options: Parameters<WasmCompositor["renderAsync"]>[1] = {},
	): Promise<void> {
		const armed = this.armed;
		this.armed = null;
		if (armed) {
			armed.observation.liquidPasses = liquidPassCount(frame);
			check(
				armed.observation.liquidPasses > 0,
				"Armed request contains no Liquid pass",
			);
		}
		// super synchronously executes begin + the first bounded advance before
		// returning its Promise. Never pre-abort or replace its return value.
		const operation = super.renderAsync(frame, options);
		if (!armed) return operation;
		let settled = false;
		const started = performance.now();
		const timer = setTimeout(() => {
			this.timers.delete(timer);
			armed.observation.timerObserved = true;
			armed.observation.pendingAtTimer = !settled;
			armed.observation.delayMs = performance.now() - started;
			try {
				armed.observation.action = Promise.resolve(armed.action()).then(
					() => {},
				);
			} catch (error) {
				armed.observation.action = Promise.reject(error);
			}
			// The owning check awaits this promise; attach a handler immediately.
			void armed.observation.action.catch(() => {});
		}, 0);
		this.timers.add(timer);
		const settle = () => {
			settled = true;
			clearTimeout(timer);
			this.timers.delete(timer);
		};
		void operation.then(settle, settle);
		return operation;
	}

	clearObservation(): void {
		this.armed = null;
		for (const timer of this.timers) clearTimeout(timer);
		this.timers.clear();
	}
}

export async function observationResult(observation: ReplayObservation) {
	check(
		observation.timerObserved,
		`${observation.label}: cancellation timer never executed`,
	);
	check(
		observation.pendingAtTimer,
		`${observation.label}: replay completed before the cancellation task`,
	);
	await observation.action;
	return {
		label: observation.label,
		liquidPasses: observation.liquidPasses,
		timerObserved: true,
		pendingAtTimer: true,
		delayMs: observation.delayMs,
	};
}

export function createPipeline() {
	const tracking = {
		created: [] as number[],
		released: [] as number[],
		releaseCalls: 0,
		timers: { created: 0, released: 0, live: 0, peak: 0 },
	};
	// Only the resource registry is fixture-owned, not allocation/render/disposal.
	const resources = {
		setTimeout: ({ handler, ms }: { handler: () => void; ms: number }) => {
			const resourceId = `liquid-pipeline:timer:${++tracking.timers.created}`;
			tracking.timers.live++;
			tracking.timers.peak = Math.max(
				tracking.timers.peak,
				tracking.timers.live,
			);
			let active = true;
			const release = () => {
				if (!active) return;
				active = false;
				tracking.timers.live--;
				tracking.timers.released++;
			};
			const id = window.setTimeout(() => {
				release();
				handler();
			}, ms);
			return {
				resourceId,
				kind: "timeout" as const,
				cancel: () => {
					window.clearTimeout(id);
					release();
				},
			};
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
				resourceId: `liquid-pipeline:${handle}`,
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
	const compositor = new ObservedCompositor(resources);
	const videoCache = new VideoCache();
	const params = { ...pipelineSize, fps: pipelineFps, compositor, videoCache };
	return { ...params, renderer: new CanvasRenderer(params), tracking };
}

export type Pipeline = ReturnType<typeof createPipeline>;

export function timerSnapshot(pipeline: Pipeline) {
	check(
		pipeline.tracking.timers.created > 0,
		"Production replay did not use the tracked timer boundary",
	);
	check(
		pipeline.tracking.timers.live === 0 &&
			pipeline.tracking.timers.created === pipeline.tracking.timers.released,
		"Production replay left a tracked timer live",
	);
	return { ...pipeline.tracking.timers };
}
