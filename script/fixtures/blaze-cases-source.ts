export type BlazeSourceKind = "opaque" | "holes" | "transparent";
export type BlazeSourcePattern = "gradient" | "stress";

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Asymmetric gradients and feathered holes avoid a periodic displacement alias. */
export function blazeSource({
	width = 192,
	height = 128,
	kind = "holes",
	pattern = "gradient",
}: {
	width?: number;
	height?: number;
	kind?: BlazeSourceKind;
	pattern?: BlazeSourcePattern;
} = {}) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1
	)
		throw Error("Invalid Blaze source dimensions");
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width;
			const v = (y + 0.5) / height;
			const edge = Math.min(
				x + 0.5,
				y + 0.5,
				width - x - 0.5,
				height - y - 0.5,
			);
			let coverage = clamp(edge / 4);
			for (const [cx, cy, rx, ry] of [
				[0.23, 0.68, 0.13, 0.2],
				[0.72, 0.26, 0.19, 0.11],
				[0.63, 0.78, 0.075, 0.1],
			]) {
				const distance = Math.hypot((u - cx) / rx, (v - cy) / ry);
				coverage = Math.min(coverage, clamp((distance - 1) * 8));
			}
			const alpha =
				kind === "transparent"
					? 0
					: kind === "opaque"
						? 255
						: Math.round(255 * coverage);
			const gradient = [
				0.11 + 0.63 * u + 0.13 * v * v + 0.09 * u * v,
				0.08 + 0.14 * u * u + 0.73 * v,
				0.07 + 0.59 * u * v + 0.28 * (1 - u) ** 2,
			];
			const rgb =
				pattern === "gradient"
					? gradient.map((value) => Math.round(255 * clamp(value)))
					: [(x % 2) * 231 + 12, (y % 2) * 219 + 18, ((x + 3 * y) % 5) * 51];
			pixels.set(
				alpha ? [...rgb, alpha] : [255, 0, 255, 0],
				(y * width + x) * 4,
			);
		}
	}
	return pixels;
}
