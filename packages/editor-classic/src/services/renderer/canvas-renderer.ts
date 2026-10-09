import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { createCanvasSurface } from "./canvas-utils";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import type { WasmCompositor } from "./compositor/wasm-compositor";
import { assertRenderNotAborted } from "./compositor/render-request";
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

	async getOutputCanvas({
		signal,
	}: { signal?: AbortSignal } = {}): Promise<HTMLCanvasElement> {
		return this.runPublication({
			signal,
			operation: async ({ token }) => {
				return this.compositor.runExclusive(
					async (signal) => {
						this.assertPublicationCurrent({ token, signal });
						this.compositor.ensureInitialized({
							width: this.width,
							height: this.height,
						});
						this.assertPublicationCurrent({ token, signal });
						return this.compositor.getCanvas();
					},
					{ signal },
				);
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

	async render({
		node,
		time,
		signal,
	}: {
		node: AnyBaseNode;
		time: number;
		signal?: AbortSignal;
	}) {
		await this.runPublication({
			signal,
			operation: async ({ token }) => {
				await this.compositor.runExclusive(
					(signal) => this.renderLocked({ node, time, token, signal }),
					{ signal },
				);
			},
		});
	}

	async renderAndCapture<T>({
		node,
		time,
		capture,
		signal,
	}: {
		node: AnyBaseNode;
		time: number;
		capture: (canvas: HTMLCanvasElement) => T | Promise<T>;
		signal?: AbortSignal;
	}): Promise<T> {
		return this.runPublication({
			signal,
			operation: async ({ token }) => {
				return this.compositor.runExclusive(
					async (signal) => {
						await this.renderLocked({ node, time, token, signal });
						this.assertPublicationCurrent({ token, signal });
						const result = await capture(this.compositor.getCanvas());
						this.assertPublicationCurrent({ token, signal });
						return result;
					},
					{ signal },
				);
			},
		});
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
		signal,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
		signal?: AbortSignal;
	}) {
		await this.runPublication({
			signal,
			operation: async ({ token }) => {
				await this.compositor.runExclusive(
					async (signal) => {
						await this.renderLocked({ node, time, token, signal });
						this.assertPublicationCurrent({ token, signal });

						const ctx = targetCanvas.getContext("2d");
						if (!ctx) {
							throw new Error("Failed to get target canvas context");
						}

						measureSpanSync({
							name: "drawImage",
							fn: () => {
								const previousCompositeOperation = ctx.globalCompositeOperation;
								try {
									// Publish a complete frame, including transparent pixels.
									ctx.globalCompositeOperation = "copy";
									ctx.drawImage(
										this.compositor.getCanvas(),
										0,
										0,
										targetCanvas.width,
										targetCanvas.height,
									);
								} finally {
									ctx.globalCompositeOperation = previousCompositeOperation;
								}
							},
						});
					},
					{ signal },
				);
			},
		});
		onRenderPerfFrameComplete();
	}

	private async renderLocked({
		node,
		time,
		token,
		signal,
	}: {
		node: AnyBaseNode;
		time: number;
		token: RendererPublicationToken | null;
		signal: AbortSignal;
	}): Promise<void> {
		this.assertPublicationCurrent({ token, signal });
		await measureSpanAsync({
			name: "resolve",
			fn: () =>
				resolveRenderTree({
					node,
					renderer: this,
					time,
					frameRate: this.fps,
					videoCache: this.videoCache,
				}),
		});
		this.assertPublicationCurrent({ token, signal });
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		this.assertPublicationCurrent({ token, signal });
		this.compositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		measureSpanSync({
			name: "syncTextures",
			fn: () => this.compositor.syncTextures(textures),
		});
		await measureSpanAsync({
			name: "renderFrame",
			fn: () =>
				this.compositor.renderAsync(frame, {
					signal,
					assertCurrent: () => this.assertPublicationCurrent({ token, signal }),
				}),
		});
		this.assertPublicationCurrent({ token, signal });
	}

	private assertPublicationCurrent({
		token,
		signal,
	}: {
		token: RendererPublicationToken | null;
		signal?: AbortSignal;
	}): void {
		if (token) this.publicationGuard?.assertCurrent({ token });
		assertRenderNotAborted(signal);
	}

	private runPublication<T>({
		operation,
		signal,
	}: {
		operation: (args: { token: RendererPublicationToken | null }) => Promise<T>;
		signal?: AbortSignal;
	}): Promise<T> {
		const token = this.publicationGuard?.capture() ?? null;
		const publication = Promise.resolve().then(async () => {
			this.assertPublicationCurrent({ token, signal });
			return operation({ token });
		});
		return publication;
	}
}
