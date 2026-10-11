import {
	createCompositor,
	disposeCompositor,
	getCompositorCanvasForHandle,
	getLastFrameProfile,
	releaseTextureForHandle,
	renderFrameForHandle,
	resizeCompositorForHandle,
	uploadTextureForHandle,
} from "opencut-wasm";
import * as wasmRequestApi from "opencut-wasm";
import { getBoundRenderResidencyDomain } from "../render-residency-domain";
import {
	assertRenderNotAborted,
	assertRenderFrameRequestApi,
	CompositorBusyError,
	RenderCancelledError,
	renderFrameRequest,
} from "./render-request";
import type {
	GpuResourceHandle,
	SessionResources,
} from "../../../editor/session/resources";
import {
	incrementCounter,
	isRenderPerfEnabled,
	recordWasmFrameProfile,
} from "../../../diagnostics/render-perf";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
} from "./types";

/**
 * One slot in the derived-texture cache. The OffscreenCanvas is persistent —
 * we reuse and redraw into it across frames, which is the change that takes
 * the WebGL upload path off the per-frame critical path for static content.
 */
type RenderedCacheEntry = {
	kind: "rendered";
	canvas: OffscreenCanvas;
	contentHash: string;
	willReadFrequently: boolean;
	width: number;
	height: number;
};

type ExternalCacheEntry = {
	kind: "external";
	source: CanvasImageSource;
	sourceVersion?: string;
	width: number;
	height: number;
};

export class WasmCompositor {
	private canvas: HTMLCanvasElement | null = null;
	private initializedSize: { width: number; height: number } | null = null;
	private cache = new Map<string, RenderedCacheEntry | ExternalCacheEntry>();
	private resource: GpuResourceHandle | null = null;
	private disposed = false;
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private renderTail: Promise<void> = Promise.resolve();
	private readonly transactions = new Set<AbortController>();
	private readonly requests = new Map<AbortController, Promise<void>>();

	constructor(private readonly resources: SessionResources) {}

	get handle(): number | null {
		return this.resource?.handle ?? null;
	}

	/**
	 * Every renderer owned by one session shares this compositor. Keep the whole
	 * resolve/build/upload/render transaction ordered so two preview, snapshot,
	 * thumbnail, or export callers cannot interleave texture state and publish a
	 * frame assembled from each other's work.
	 */
	// eslint-disable-next-line opencut/prefer-object-params -- preserves the existing callback API while adding optional request cancellation.
	async runExclusive<T>(
		task: (signal: AbortSignal) => Promise<T>,
		{ signal }: { signal?: AbortSignal } = {},
	): Promise<T> {
		this.assertOpen();
		assertRenderNotAborted(signal);
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		this.transactions.add(controller);
		let started = false;
		let rejectQueued!: (error: unknown) => void;
		const abortQueued = () => {
			if (!started) rejectQueued(new RenderCancelledError());
		};
		const operation = this.renderTail
			.then(async () => {
				started = true;
				this.assertOpen();
				assertRenderNotAborted(controller.signal);
				return task(controller.signal);
			})
			.finally(() => {
				signal?.removeEventListener("abort", abort);
				controller.signal.removeEventListener("abort", abortQueued);
				this.transactions.delete(controller);
			});
		// The real queue tail, unlike the queued caller's prompt abort result,
		// always waits for its predecessor. Cancellation never unlocks live work.
		this.renderTail = operation.then(
			() => {},
			() => {},
		);
		return new Promise<T>((resolve, reject) => {
			rejectQueued = reject;
			operation.then(resolve, reject);
			controller.signal.addEventListener("abort", abortQueued, { once: true });
			if (controller.signal.aborted) abortQueued();
		});
	}

	ensureInitialized({ width, height }: { width: number; height: number }) {
		this.assertOpen();
		this.assertGpuIdle();
		if (!this.canvas) {
			const handle = createCompositor(width, height);
			if (handle === 0) {
				throw new Error(
					"The explicit session compositor returned reserved handle 0.",
				);
			}
			let resource: GpuResourceHandle | null = null;
			try {
				resource = this.resources.trackGpuResource({
					handle,
					label: "session-compositor",
				});
				const canvas = getCompositorCanvasForHandle(handle);
				this.resource = resource;
				this.canvas = canvas;
				this.initializedSize = { width, height };
			} catch (error) {
				if (resource) resource.release();
				else disposeCompositor(handle);
				throw error;
			}
			return;
		}

		if (
			!this.initializedSize ||
			this.initializedSize.width !== width ||
			this.initializedSize.height !== height
		) {
			resizeCompositorForHandle(this.requireHandle(), width, height);
			this.initializedSize = { width, height };
		}
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.canvas) {
			throw new Error("Compositor is not initialized");
		}
		return this.canvas;
	}

	syncTextures(textures: TextureUploadDescriptor[]) {
		this.assertOpen();
		this.assertGpuIdle();
		const nextIds = new Set(textures.map((texture) => texture.id));
		for (const previousId of this.cache.keys()) {
			if (!nextIds.has(previousId)) {
				releaseTextureForHandle(this.requireHandle(), previousId);
				this.cache.delete(previousId);
			}
		}

		for (const texture of textures) {
			if (texture.kind === "external") {
				this.syncExternalTexture(texture);
			} else {
				this.syncRenderedTexture(texture);
			}
		}
	}

	render(frame: FrameDescriptor) {
		this.assertOpen();
		this.assertGpuIdle();
		renderFrameForHandle(this.requireHandle(), frame);
		this.recordFrameProfile();
	}

	// eslint-disable-next-line opencut/prefer-object-params -- mirrors render(frame) with optional request lifecycle controls.
	async renderAsync(
		frame: FrameDescriptor,
		{
			signal,
			assertCurrent,
		}: { signal?: AbortSignal; assertCurrent?: () => void } = {},
	): Promise<void> {
		this.assertOpen();
		this.assertGpuIdle();
		assertRenderNotAborted(signal);
		assertRenderFrameRequestApi(wasmRequestApi);
		const handle = this.requireHandle();
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		// Reserve ownership before entering WASM: begin/advance can invoke Host
		// callbacks synchronously, including close(). Its drain must already see
		// the request and retain the handle until capture/replay cleanup settles.
		let releaseRequest!: () => void;
		const drained = new Promise<void>((resolve) => {
			releaseRequest = resolve;
		});
		this.requests.set(controller, drained);
		try {
			await renderFrameRequest({
				api: wasmRequestApi,
				resources: this.resources,
				handle,
				frame,
				signal: controller.signal,
				assertCurrent,
			});
			this.recordFrameProfile();
		} finally {
			signal?.removeEventListener("abort", abort);
			this.requests.delete(controller);
			releaseRequest();
		}
	}

	private recordFrameProfile(): void {
		if (isRenderPerfEnabled()) {
			const profile: unknown = getLastFrameProfile();
			if (Array.isArray(profile) && profile.every(isFrameProfileEntry)) {
				recordWasmFrameProfile(profile);
			}
		}
	}

	private syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.sourceVersion === texture.sourceVersion &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		uploadTextureForHandle(this.requireHandle(), {
			id: texture.id,
			source: ensureOffscreenCanvas({
				source: texture.source,
				width: texture.width,
				height: texture.height,
				label: `texture upload ${texture.id}`,
			}),
			width: texture.width,
			height: texture.height,
		});
		this.cache.set(texture.id, {
			kind: "external",
			source: texture.source,
			sourceVersion: texture.sourceVersion,
			width: texture.width,
			height: texture.height,
		});
	}

	private syncRenderedTexture(texture: RenderedTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		const willReadFrequently = texture.willReadFrequently ?? false;
		if (
			previous?.kind === "rendered" &&
			previous.willReadFrequently === willReadFrequently &&
			previous.contentHash === texture.contentHash &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas =
			previous?.kind === "rendered" &&
			previous.willReadFrequently === willReadFrequently &&
			previous.width === texture.width &&
			previous.height === texture.height
				? previous.canvas
				: createBackingCanvas({
						width: texture.width,
						height: texture.height,
					});

		const ctx = canvas.getContext("2d", { willReadFrequently });
		if (!ctx) {
			throw new Error(`Failed to get 2d context for texture ${texture.id}`);
		}
		ctx.clearRect(0, 0, texture.width, texture.height);
		texture.draw(ctx);

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		uploadTextureForHandle(this.requireHandle(), {
			id: texture.id,
			source: canvas,
			width: texture.width,
			height: texture.height,
		});
		this.cache.set(texture.id, {
			kind: "rendered",
			canvas,
			contentHash: texture.contentHash,
			willReadFrequently,
			width: texture.width,
			height: texture.height,
		});
	}

	private rasterResidencyDrain: Promise<void> | undefined;
	dispose(): void {
		if (this.disposed) return;
		if (this.transactions.size || this.requests.size) {
			throw new CompositorBusyError();
		}
		this.disposed = true;
		this.resource?.release();
		this.resource = null;
		this.canvas = null;
		this.initializedSize = null;
		this.cache.clear();
		const domain = getBoundRenderResidencyDomain(this);
		if (domain) {
			domain.releasePublishedAfterClear();
			this.rasterResidencyDrain = domain.disposeAndDrain();
			// Observe synchronous dispose's async cleanup; close awaits this same
			// original promise and still propagates its actual failure.
			void this.rasterResidencyDrain.catch(() => {});
		}
	}

	/** Abort callbacks run now, not as another queued compositor transaction. */
	cancelAndDrain(): Promise<void> {
		for (const controller of this.transactions) controller.abort();
		for (const controller of this.requests.keys()) controller.abort();
		const pending = [this.renderTail, ...this.requests.values()];
		// Callers retain their typed failure. Lifecycle waits for actual cleanup,
		// not an abort-vs-work race that could release live GPU resources early.
		return Promise.allSettled(pending).then(() => {});
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closing = true;
		this.closePromise = this.cancelAndDrain().then(() => {
			this.dispose();
			return this.rasterResidencyDrain;
		});
		return this.closePromise;
	}

	private assertOpen(): void {
		if (this.disposed || this.closing) throw new RenderCancelledError();
	}

	private assertGpuIdle(): void {
		// Async Canvas capture temporarily releases the native compositor borrow,
		// but still owns its uploaded sources, dimensions and presentation target.
		if (this.requests.size) throw new CompositorBusyError();
	}

	private requireHandle(): number {
		const handle = this.resource?.handle;
		if (!handle) {
			throw new Error("Session compositor is not initialized.");
		}
		return handle;
	}
}

function isFrameProfileEntry(
	value: unknown,
): value is { name: string; durationMs: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"durationMs" in value &&
		typeof value.durationMs === "number"
	);
}

function createBackingCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas {
	if (typeof OffscreenCanvas === "undefined") {
		throw new Error("OffscreenCanvas is not supported in this environment");
	}
	return new OffscreenCanvas(width, height);
}

function ensureOffscreenCanvas({
	source,
	width,
	height,
	label,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	label: string;
}): OffscreenCanvas {
	if (source instanceof OffscreenCanvas) {
		return source;
	}

	if (typeof OffscreenCanvas === "undefined") {
		throw new Error(`OffscreenCanvas is required for ${label}`);
	}

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error(`Failed to get 2d context for ${label}`);
	}
	context.clearRect(0, 0, width, height);
	context.drawImage(source, 0, 0, width, height);
	return canvas;
}
