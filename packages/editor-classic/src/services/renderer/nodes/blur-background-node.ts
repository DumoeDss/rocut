import type { EffectPass } from "../../../effects/types";
import type { RetimeConfig } from "../../../timeline";
import { BaseNode } from "./base-node";
import type {
	MediaCropBounds,
	MediaCropGeometry,
} from "../../../wasm/media-crop";

export type BlurBackgroundNodeParams = {
	clipId?: string;
	mediaId: string;
	url: string;
	file: File;
	mediaType: "video" | "image";
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	freezeFrame?: number;
	blurIntensity: number;
	crop?: MediaCropBounds;
};

export type BackdropSource = {
	source: CanvasImageSource;
	sourceVersion?: string;
	width: number;
	height: number;
	sourceCrop?: MediaCropGeometry;
};

export interface ResolvedBlurBackgroundNodeState {
	backdropSource: BackdropSource;
	passes: EffectPass[];
}

export class BlurBackgroundNode extends BaseNode<
	BlurBackgroundNodeParams,
	ResolvedBlurBackgroundNodeState
> {}
