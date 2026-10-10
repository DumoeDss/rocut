import type {
	MvLutAtlasPlan,
	MvLutAtlasRowSample,
} from "../../../../../editor-contracts/src/mv-lut-atlas";
interface ImageBinding {
	readonly resourceId: string;
	readonly sha256: string;
	readonly image: CanvasImageSource;
	readonly width: number;
	readonly height: number;
}
export interface NativeLutAtlas {
	readonly canvas: HTMLCanvasElement;
	readonly atlasSha256: string;
}
/** Rendering transport only: no JSON palette parsing, row assignment, aliases,
 * colour math, resampling helpers, named-parameter resolution or grading. */
export function renderLutAtlas({
	plan,
	images,
}: {
	readonly plan: MvLutAtlasPlan;
	readonly images: readonly ImageBinding[];
}): NativeLutAtlas {
	if (
		plan.version !== 1 ||
		plan.profile !== "original-lut-atlas-v1" ||
		plan.size[0] !== 256 ||
		plan.size[1] !== 16
	)
		throw Error("Unsupported native LUT atlas plan");
	const canvas = document.createElement("canvas");
	canvas.width = plan.size[0];
	canvas.height = plan.size[1];
	try {
		const ctx = canvas.getContext("2d");
		if (!ctx) throw Error("Native LUT atlas Canvas2D unavailable");
		for (const row of plan.rows) {
			if (row.kind === "image") {
				const binding = images.find(
					(image) => image.resourceId === row.resource.id,
				);
				if (
					!binding ||
					binding.sha256 !== row.resource.sha256 ||
					binding.width !== row.sourceRect[2] ||
					binding.height !== row.sourceRect[3]
				)
					throw Error(
						"Native LUT atlas admitted decoded image binding mismatch",
					);
				ctx.drawImage(binding.image, ...row.sourceRect, ...row.destinationRect);
			} else {
				const gradient = ctx.createLinearGradient(...row.gradientPoints);
				for (const [offset, color] of row.stops)
					gradient.addColorStop(offset, color);
				ctx.fillStyle = gradient;
				ctx.fillRect(...row.destinationRect);
			}
		}
		return { canvas, atlasSha256: plan.atlasSha256 };
	} catch (error) {
		canvas.width = canvas.height = 1;
		throw error;
	}
}
/** Only actual native Canvas readback. The returned RGBA must be admitted by
 * Rust prepare_row_pixels before any native per-pixel consumer uses it. */
export function readLutAtlasRow({
	atlas,
	sample,
}: {
	readonly atlas: NativeLutAtlas;
	readonly sample: MvLutAtlasRowSample;
}): Uint8ClampedArray {
	if (
		atlas.atlasSha256 !== sample.atlasSha256 ||
		atlas.canvas.width !== 256 ||
		atlas.canvas.height !== 16
	)
		throw Error("Native LUT row readback identity mismatch");
	const ctx = atlas.canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw Error("Native LUT row readback unavailable");
	return ctx.getImageData(...sample.rect).data;
}
export function releaseLutAtlas({
	atlas,
}: {
	readonly atlas: NativeLutAtlas;
}): void {
	atlas.canvas.width = atlas.canvas.height = 1;
}
