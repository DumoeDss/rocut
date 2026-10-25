import type { MediaCropGeometry } from "../../../wasm/media-crop";
import type { RenderedTextureDescriptor } from "./types";

/** The shared compositor caches the cropped source, including pooled video frame identity. */
export function croppedMediaTexture({
	id,
	source,
	sourceIdentity,
	crop,
}: {
	id: string;
	source: CanvasImageSource;
	sourceIdentity: string;
	crop: MediaCropGeometry;
}): RenderedTextureDescriptor {
	return {
		kind: "rendered",
		id,
		width: crop.width,
		height: crop.height,
		contentHash: `source-crop:${sourceIdentity}:${JSON.stringify(crop)}`,
		draw: (ctx) =>
			ctx.drawImage(
				source,
				crop.sourceX,
				crop.sourceY,
				crop.sourceWidth,
				crop.sourceHeight,
				0,
				0,
				crop.width,
				crop.height,
			),
	};
}
