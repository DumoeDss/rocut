import type { BlendMode } from "../../../rendering";
import type { NativeTransitionStyle } from "@opencut/editor-contracts";
import type { EffectPass } from "../../../effects/types";

/** Legacy cross-dissolve stays an absent wire style. */
export type FrameTransitionStyle = Exclude<
	NativeTransitionStyle,
	{ kind: "cross-dissolve" }
>;

export type FrameDescriptor = {
	width: number;
	height: number;
	clear: {
		color: [number, number, number, number];
	};
	items: FrameItemDescriptor[];
};

export type FrameLayerDescriptor = {
	type: "layer";
	textureId: string;
	transform: QuadTransformDescriptor;
	opacity: number;
	blendMode: BlendMode;
	effectPassGroups: EffectPass[][];
	mask: LayerMaskDescriptor | null;
};

export type FrameGroupDescriptor = {
	items: FrameItemDescriptor[];
	effectPassGroups: EffectPass[][];
	opacity: number;
	blendMode: BlendMode;
};

export type FrameItemDescriptor =
	| FrameLayerDescriptor
	| ({ type: "group" } & FrameGroupDescriptor)
	| {
			type: "sceneTransition";
			style?: FrameTransitionStyle;
			outgoing: FrameGroupDescriptor;
			incoming: FrameGroupDescriptor;
			progress: number;
	  }
	| {
			type: "transition";
			style?: FrameTransitionStyle;
			outgoing: Omit<FrameLayerDescriptor, "type">[];
			incoming: Omit<FrameLayerDescriptor, "type">[];
			progress: number;
	  }
	| {
			type: "sceneEffect";
			effectPassGroups: EffectPass[][];
	  };

export type QuadTransformDescriptor = {
	centerX: number;
	centerY: number;
	width: number;
	height: number;
	rotationDegrees: number;
	flipX: boolean;
	flipY: boolean;
};

export type LayerMaskDescriptor = {
	textureId: string;
	feather: number;
	inverted: boolean;
};

export type TextureCanvasDrawFn = (
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
) => void;

/**
 * A layer texture whose pixels come from somewhere outside the renderer —
 * typically a decoded video/image frame or a sticker. Cached by reference
 * identity plus sourceVersion for mutable sources such as pooled canvases.
 */
export type ExternalTextureDescriptor = {
	kind: "external";
	id: string;
	source: CanvasImageSource;
	/** Required for mutable/pooled sources such as decoded video canvases. */
	sourceVersion?: string;
	width: number;
	height: number;
};

/**
 * A layer texture that the renderer rasterizes from scene state (color fill,
 * text layout, mask shape, blur backdrop). Cached by `contentHash`: when it
 * matches the previous frame's hash for this id, the upload is skipped
 * entirely and the persistent canvas is not even cleared.
 */
export type RenderedTextureDescriptor = {
	kind: "rendered";
	id: string;
	contentHash: string;
	/** Canvas backing preference; changing it requires a new backing surface. */
	willReadFrequently?: boolean;
	width: number;
	height: number;
	draw: TextureCanvasDrawFn;
};

export type TextureUploadDescriptor =
	| ExternalTextureDescriptor
	| RenderedTextureDescriptor;
