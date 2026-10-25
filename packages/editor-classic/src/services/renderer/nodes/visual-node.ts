import { BaseNode } from "./base-node";
import type { Effect, EffectPass } from "../../../effects/types";
import type { Mask } from "../../../masks/types";
import type { BlendMode, Transform } from "../../../rendering";
import type { RetimeConfig, VisualElement } from "../../../timeline";
import type { MotionTextFontRuntime } from "../motion-text/font-runtime";
import { pinnedTextFont } from "./text-font-resource";
import type {
	MediaCropBounds,
	MediaCropGeometry,
} from "../../../wasm/media-crop";

export interface VisualNodeParams {
	/** Scene identity for transition branch grouping; absent for standalone nodes. */
	clipId?: string;
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	freezeFrame?: number;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	fontRuntime?: MotionTextFontRuntime;
	projectId?: string;
	crop?: MediaCropBounds;
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
}

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	/** Decoded frame identity: pooled canvases can change without changing reference. */
	sourceVersion?: string;
	sourceWidth: number;
	sourceHeight: number;
	sourceCrop?: MediaCropGeometry;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {
	/** Render-only aliases; persisted descriptors and author-selected families stay intact. */
	resolvedMasks: Mask[] | undefined;

	async prepareMasks(signal?: AbortSignal): Promise<void> {
		this.resolvedMasks = undefined;
		if (!this.resolved) return;
		// The compositor's mask producer currently consumes the first ordered mask.
		const mask = this.params.masks?.[0];
		if (mask?.type !== "text" || !mask.params.content.trim()) return;
		const source = mask.params["mv.fontResource"];
		const text = mask.params.content;
		const family = mask.params.fontFamily;
		try {
			const font = pinnedTextFont(source, undefined, family);
			if (!font) return;
			const { fontRuntime, projectId } = this.params;
			if (!fontRuntime || !projectId)
				throw Error("Pinned text mask font runtime is unavailable");
			signal?.throwIfAborted();
			const generation = fontRuntime.inspect().generation;
			const prepared = await fontRuntime.prepareFont({
				projectId,
				font,
				text,
			});
			signal?.throwIfAborted();
			if (generation !== fontRuntime.inspect().generation)
				throw Error("Text mask font preparation became stale");
			if (
				!this.resolved ||
				this.params.fontRuntime !== fontRuntime ||
				this.params.projectId !== projectId ||
				this.params.masks?.[0] !== mask ||
				mask.params["mv.fontResource"] !== source ||
				mask.params.content !== text ||
				mask.params.fontFamily !== family
			)
				throw Error("Text mask font selection changed during preparation");
			this.resolvedMasks = [
				{ ...mask, params: { ...mask.params, fontFamily: prepared.family } },
			];
		} catch (error) {
			throw Error(
				`Text mask ${mask.id} font resource: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
