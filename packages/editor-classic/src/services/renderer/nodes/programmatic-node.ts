import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import {
	VisualNode,
	type VisualNodeParams,
	type ResolvedVisualSourceNodeState,
} from "./visual-node";
import type { ResolveContext } from "../resolve-context";
import { resolveVisualState } from "../resolve-visual-state";
import { resolveProgrammaticFrame } from "../programmatic/frame";
import { resolveCanvasResources } from "../programmatic/resources";
import {
	renderProgrammaticCanvas,
	type ProgrammaticRenderRequest,
} from "../programmatic/canvas-runtime";
import type {
	RasterCanvasLease,
	RenderRasterClient,
} from "../render-residency-domain";
import { RenderCancelledError } from "../compositor/render-request";

interface ProgrammaticNodeParams extends VisualNodeParams {
	source: ProgrammaticSource;
	programmaticFrames?: ProgrammaticFrameProvider;
	/** Injectable rasterizer for host-specific adapters and isolated tests. */
	renderFrame?: (request: ProgrammaticRenderRequest) => Promise<ImageBitmap>;
}

export class ProgrammaticNode extends VisualNode<
	ProgrammaticNodeParams,
	ResolvedVisualSourceNodeState
> {
	private pending: AbortController | null = null;
	private cached: {
		key: string;
		source: OffscreenCanvas;
		version: string;
		residency: RasterCanvasLease;
	} | null = null;
	private version = 0;
	private rasterClient: RenderRasterClient | undefined;

	/** Cancels pending work but keeps the node usable after session resume. */
	cancelPendingFrames(): void {
		this.pending?.abort(new RenderCancelledError());
		this.pending = null;
		this.cached?.residency.release();
		this.cached = null;
		this.resolved = null;
		this.rasterClient?.close();
		this.rasterClient = undefined;
	}

	async resolve(
		context: ResolveContext,
	): Promise<ResolvedVisualSourceNodeState | null> {
		// Replacing one frame releases its consumer, retaining the node-owned cache.
		this.pending?.abort(new RenderCancelledError());
		this.pending = null;
		this.resolved = null;
		const { source } = this.params;
		const request = {
			source,
			clipStart: this.params.timeOffset,
			clipDuration: this.params.duration,
			trimStart: this.params.trimStart,
			timelineTime: context.time,
		};
		const frame = resolveProgrammaticFrame(request);
		if (!frame) {
			this.cancelPendingFrames();
			return null;
		}
		const visual = resolveVisualState({
			params: this.params,
			context,
			sourceWidth: source.width,
			sourceHeight: source.height,
		});
		if (!visual) {
			this.cancelPendingFrames();
			return null;
		}
		const key = JSON.stringify({ source, frame });
		const rasterResidency = context.rasterResidency;
		if (!rasterResidency)
			throw Error(
				"Programmatic render requires a shared raster residency scope",
			);
		if (
			this.rasterClient &&
			(this.rasterClient.signal.aborted ||
				!this.rasterClient.belongsTo(rasterResidency))
		)
			this.cancelPendingFrames();
		rasterResidency.assertOpen();
		this.rasterClient ??= rasterResidency.client(this);
		if (this.cached?.key !== key) {
			const pending = new AbortController();
			this.pending = pending;
			const signal = AbortSignal.any([
				pending.signal,
				this.rasterClient.signal,
				...(context.signal ? [context.signal] : []),
			]);
			let releaseResources: (() => void) | undefined;
			let resourceWork: Promise<unknown> | undefined;
			try {
				signal.throwIfAborted();
				let bitmap: ImageBitmap;
				if (source.runtime === "html-document") {
					const provider = this.params.programmaticFrames;
					if (!provider)
						throw new Error(
							"HTML frame source requires an isolated DOM rasterizer on this host",
						);
					const png = await provider.renderPng({
						request,
						signal,
					});
					signal.throwIfAborted();
					bitmap = await createImageBitmap(png);
				} else {
					// Admit the declared caller-owned byte snapshots before loading them.
					// Realm/admission copies retain their existing separate reservations.
					const encodedBytes = (source.resources ?? []).reduce(
						(sum, resource) => sum + resource.byteLength,
						0,
					);
					if (encodedBytes)
						releaseResources =
							this.rasterClient.preprocessor.reserve(encodedBytes);
					const loading = resolveCanvasResources({
						resources: source.resources ?? [],
						provider: this.params.programmaticFrames,
						signal,
					});
					resourceWork = loading;
					const resources = await loading;
					signal.throwIfAborted();
					bitmap = await (this.params.renderFrame ?? renderProgrammaticCanvas)({
						source,
						frame,
						resources,
						provider: this.params.programmaticFrames,
						signal,
						imagePreprocessOwner: this.rasterClient.preprocessor,
					});
				}
				try {
					signal.throwIfAborted();
					if (bitmap.width !== source.width || bitmap.height !== source.height)
						throw new Error("Invalid programmatic frame dimensions");
					const residency = this.rasterClient.reserveCanvas({
						width: source.width,
						height: source.height,
					});
					let retained = false;
					try {
						const canvas = new OffscreenCanvas(source.width, source.height);
						residency.attach(canvas);
						const ctx = canvas.getContext("2d");
						if (!ctx) throw new Error("Programmatic frame copy failed");
						ctx.drawImage(bitmap, 0, 0);
						this.cached?.residency.release();
						this.cached = {
							key,
							source: canvas,
							version: String(++this.version),
							residency,
						};
						retained = true;
					} finally {
						if (!retained) residency.release();
					}
				} finally {
					bitmap.close();
				}
			} finally {
				if (releaseResources && resourceWork) {
					const release = releaseResources;
					void resourceWork.then(release, release);
				} else releaseResources?.();
				if (this.pending === pending) this.pending = null;
			}
		}
		return {
			...visual,
			source: this.cached.source,
			sourceVersion: this.cached.version,
			sourceWidth: source.width,
			sourceHeight: source.height,
		};
	}
}
