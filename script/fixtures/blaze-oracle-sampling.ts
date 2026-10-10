export type BlazePremultipliedPixel = [number, number, number, number];

/** Pixel-index coordinates. Bilinear filtering occurs after premultiplication. */
export function blazeSample({
	pixels,
	width,
	height,
	x,
	y,
}: {
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
	x: number;
	y: number;
}): BlazePremultipliedPixel {
	const result: BlazePremultipliedPixel = [0, 0, 0, 0];
	const left = Math.floor(x);
	const top = Math.floor(y);
	for (const py of [top, top + 1]) {
		for (const px of [left, left + 1]) {
			if (px < 0 || py < 0 || px >= width || py >= height) continue;
			const weight = (1 - Math.abs(x - px)) * (1 - Math.abs(y - py));
			const offset = (py * width + px) * 4;
			const alpha = pixels[offset + 3] / 255;
			for (let channel = 0; channel < 3; channel++) {
				result[channel] += (pixels[offset + channel] / 255) * alpha * weight;
			}
			result[3] += alpha * weight;
		}
	}
	return result;
}

export function blazeStraightBytes(pixel: BlazePremultipliedPixel) {
	const alpha = Math.min(1, Math.max(0, pixel[3]));
	const output = new Uint8ClampedArray(4);
	output[3] = Math.round(alpha * 255);
	if (alpha > 0) {
		for (let channel = 0; channel < 3; channel++) {
			output[channel] = Math.round(
				(Math.min(alpha, Math.max(0, pixel[channel])) / alpha) * 255,
			);
		}
	}
	return output;
}
