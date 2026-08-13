import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { createCanvasSurface } from "./canvas-utils";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import type { WasmCompositor } from "./compositor/wasm-compositor";
import type { VideoCache } from "../video-cache/service";
import { resolveRenderTree } from "./resolve";
import {
	measureSpanAsync,
	measureSpanSync,
	onRenderPerfFrameComplete,
} from "../../diagnostics/render-perf";

export type CanvasRendererParams = {
	width: number;
	height: number;
	fps: FrameRate;
	compositor: WasmCompositor;
	videoCache: VideoCache;
	publicationGuard?: RendererPublicationGuard;
};

export interface RendererPublicationToken {
	activityGeneration: number;
	ownerGeneration: number;
}

export interface RendererPublicationGuard {
	capture(): RendererPublicationToken;
	assertCurrent(args: { token: RendererPublicationToken }): void;
}

export class CanvasRenderer {
	canvas: OffscreenCanvas;
	context: OffscreenCanvasRenderingContext2D;
	width: number;
	height: number;
	fps: FrameRate;
	private readonly compositor: WasmCompositor;
	private readonly videoCache: VideoCache;
	private readonly publicationGuard?: RendererPublicationGuard;

	constructor({
		width,
		height,
		fps,
		compositor,
		videoCache,
		publicationGuard,
	}: CanvasRendererParams) {
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.compositor = compositor;
		this.videoCache = videoCache;
		this.publicationGuard = publicationGuard;

		const surface = createCanvasSurface({ width, height });
		this.canvas = surface.canvas;
		this.context = surface.context;
	}

	async getOutputCanvas(): Promise<HTMLCanvasElement> {
		return this.runPublication({
			operation: async ({ token }) => {
				return this.compositor.runExclusive(async () => {
					this.assertPublicationCurrent({ token });
					this.compositor.ensureInitialized({
						width: this.width,
						height: this.height,
					});
					this.assertPublicationCurrent({ token });
					return this.compositor.getCanvas();
				});
			},
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
		await this.runPublication({
			operation: async ({ token }) => {
				await this.compositor.runExclusive(() =>
					this.renderLocked({ node, time, token }),
				);
			},
		});
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
		return this.runPublication({
			operation: async ({ token }) => {
				return this.compositor.runExclusive(async () => {
					await this.renderLocked({ node, time, token });
					this.assertPublicationCurrent({ token });
					const result = await capture(this.compositor.getCanvas());
					this.assertPublicationCurrent({ token });
					return result;
				});
			},
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
		await this.runPublication({
			operation: async ({ token }) => {
				await this.compositor.runExclusive(async () => {
					await this.renderLocked({ node, time, token });
					this.assertPublicationCurrent({ token });

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
			},
		});
		onRenderPerfFrameComplete();
	}

	private async renderLocked({
		node,
		time,
		token,
	}: {
		node: AnyBaseNode;
		time: number;
		token: RendererPublicationToken | null;
	}): Promise<void> {
		this.assertPublicationCurrent({ token });
		await measureSpanAsync({
			name: "resolve",
			fn: () =>
				resolveRenderTree({
					node,
					renderer: this,
					time,
					videoCache: this.videoCache,
				}),
		});
		this.assertPublicationCurrent({ token });
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		this.assertPublicationCurrent({ token });
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

	private assertPublicationCurrent({
		token,
	}: {
		token: RendererPublicationToken | null;
	}): void {
		if (token) this.publicationGuard?.assertCurrent({ token });
	}

	private runPublication<T>({
		operation,
	}: {
		operation: (args: { token: RendererPublicationToken | null }) => Promise<T>;
	}): Promise<T> {
		const token = this.publicationGuard?.capture() ?? null;
		const publication = Promise.resolve().then(async () => {
			this.assertPublicationCurrent({ token });
			return operation({ token });
		});
		return publication;
	}
}
