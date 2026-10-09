export type PipelineSourceKind = "opaque" | "holes" | "transparent";

/** Fixed broad color edges, gradient background and cut-out holes; no codec-derived input. */
export function pipelineSource(
	width: number,
	height: number,
	kind: PipelineSourceKind,
) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const u = (x + 0.5) / width,
				v = (y + 0.5) / height;
			let color = [
				Math.round(24 + 100 * u),
				Math.round(38 + 80 * v),
				Math.round(72 + 48 * u),
			];
			if (u > 0.12 && u < 0.45 && v > 0.18 && v < 0.79) color = [30, 190, 210];
			if (u > 0.57 && u < 0.88 && v > 0.25 && v < 0.84) color = [224, 90, 36];
			if (Math.abs(v - 0.35 - 0.3 * u) < 0.025) color = [234, 220, 72];
			if (u > 0.08 && u < 0.92 && v > 0.88 && v < 0.92) color = [170, 70, 190];
			const hole =
				Math.hypot((u - 0.32) * width, (v - 0.47) * height) < height * 0.105 ||
				(u > 0.64 && u < 0.77 && v > 0.38 && v < 0.64) ||
				u < 0.025 ||
				v < 0.025;
			const alpha =
				kind === "transparent" || (kind === "holes" && hole) ? 0 : 255;
			pixels.set(alpha ? [...color, alpha] : [0, 0, 0, 0], (y * width + x) * 4);
		}
	return pixels;
}
