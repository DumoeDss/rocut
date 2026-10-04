import { BaseNode } from "./base-node";
import type { Effect, EffectPass } from "../../../effects/types";
import type { Mask } from "../../../masks/types";
import type { BlendMode, Transform } from "../../../rendering";
import type { RetimeConfig, VisualElement } from "../../../timeline";

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
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
