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
	} | null = null;
	private version = 0;

	/** Cancels pending work but keeps the node usable after session resume. */
	cancelPendingFrames(): void {
		this.pending?.abort(
			new DOMException("Programmatic frame cancelled", "AbortError"),
		);
		this.pending = null;
	}

	async resolve(
		context: ResolveContext,
	): Promise<ResolvedVisualSourceNodeState | null> {
		this.cancelPendingFrames();
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
		if (!frame) return null;
		const visual = resolveVisualState({
			params: this.params,
			context,
			sourceWidth: source.width,
			sourceHeight: source.height,
		});
		if (!visual) return null;
		const key = JSON.stringify({ source, frame });
		if (this.cached?.key !== key) {
			const pending = new AbortController();
			this.pending = pending;
			try {
				let bitmap: ImageBitmap;
				if (source.runtime === "html-document") {
					const provider = this.params.programmaticFrames;
					if (!provider)
						throw new Error(
							"HTML frame source requires an isolated DOM rasterizer on this host",
						);
					const png = await provider.renderPng({
						request,
						signal: pending.signal,
					});
					pending.signal.throwIfAborted();
					bitmap = await createImageBitmap(png);
				} else {
					const resources = await resolveCanvasResources({
						resources: source.resources ?? [],
						provider: this.params.programmaticFrames,
						signal: pending.signal,
					});
					bitmap = await (this.params.renderFrame ?? renderProgrammaticCanvas)({
						source,
						frame,
						resources,
						provider: this.params.programmaticFrames,
						signal: pending.signal,
					});
				}
				try {
					pending.signal.throwIfAborted();
					if (bitmap.width !== source.width || bitmap.height !== source.height)
						throw new Error("Invalid programmatic frame dimensions");
					const canvas = new OffscreenCanvas(source.width, source.height);
					const ctx = canvas.getContext("2d");
					if (!ctx) throw new Error("Programmatic frame copy failed");
					ctx.drawImage(bitmap, 0, 0);
					this.cached = {
						key,
						source: canvas,
						version: String(++this.version),
					};
				} finally {
					bitmap.close();
				}
			} finally {
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
