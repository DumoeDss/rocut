import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { createCanvasSurface } from "./canvas-utils";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import type { WasmCompositor } from "./compositor/wasm-compositor";
import { resolveRenderTree } from "./resolve";
import {
	measureSpanAsync,
	measureSpanSync,
	onRenderPerfFrameComplete,
} from "@/diagnostics/render-perf";

export type CanvasRendererParams = {
	width: number;
	height: number;
	fps: FrameRate;
	compositor: WasmCompositor;
};

export class CanvasRenderer {
	canvas: OffscreenCanvas;
	context: OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	fps: FrameRate;
	private readonly compositor: WasmCompositor;

	constructor({ width, height, fps, compositor }: CanvasRendererParams) {
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.compositor = compositor;

		const surface = createCanvasSurface({ width, height });
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	async getOutputCanvas(): Promise<HTMLCanvasElement> {
		return this.compositor.runExclusive(async () => {
			this.compositor.ensureInitialized({
				width: this.width,
				height: this.height,
			});
			return this.compositor.getCanvas();
		});
	}

	setSize({ width, height }: { width: number; height: number }) {
		this.width = width;
		this.height = height;

		const surface = createCanvasSurface({ width, height });
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	async render({ node, time }: { node: AnyBaseNode; time: number }) {
		await this.compositor.runExclusive(() => this.renderLocked({ node, time }));
	}

	async renderAndCapture<T>({
		node,
		time,
		capture,
	}: {
		node: AnyBaseNode;
		time: number;
		capture: (canvas: HTMLCanvasElement) => T | Promise<T>;
	}): Promise<T> {
		return this.compositor.runExclusive(async () => {
			await this.renderLocked({ node, time });
			return capture(this.compositor.getCanvas());
		});
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
	}) {
		await this.compositor.runExclusive(async () => {
			await this.renderLocked({ node, time });

			const ctx = targetCanvas.getContext("2d");
			if (!ctx) {
				throw new Error("Failed to get target canvas context");
			}

			measureSpanSync({
				name: "drawImage",
				fn: () =>
					ctx.drawImage(
						this.compositor.getCanvas(),
						0,
						0,
						targetCanvas.width,
						targetCanvas.height,
					),
			});
		});
		onRenderPerfFrameComplete();
	}

	private async renderLocked({
		node,
		time,
	}: {
		node: AnyBaseNode;
		time: number;
	}): Promise<void> {
		await measureSpanAsync({
			name: "resolve",
			fn: () => resolveRenderTree({ node, renderer: this, time }),
		});
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		this.compositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		measureSpanSync({
			name: "syncTextures",
			fn: () => this.compositor.syncTextures(textures),
		});
		measureSpanSync({
			name: "renderFrame",
			fn: () => this.compositor.render(frame),
		});
	}
}
