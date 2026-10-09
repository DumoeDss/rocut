import { assertGenerator as assert } from "./generator-browser-assets";

/** Final scenes are opaque. Recover source alpha with two independent
 * backgrounds before testing the native foreground's one-bit contract. */
export function assertDitherAlpha(
	black: Uint8ClampedArray,
	white: Uint8ClampedArray,
	colored: Uint8ClampedArray,
) {
	let transparent = 0,
		partial = 0,
		opaqueBlack = 0,
		opaqueWhite = 0,
		blendError = 0;
	for (let p = 0; p < black.length; p += 4) {
		const transmission = white[p] - black[p],
			alpha = 255 - transmission;
		if (alpha === 0) transparent++;
		if (alpha >= 25 && alpha <= 235) partial++;
		for (let c = 0; c < 3; c++) {
			blendError = Math.max(
				blendError,
				Math.abs(white[p + c] - black[p + c] - transmission),
				Math.abs(
					colored[p + c] -
						(black[p + c] + ([16, 32, 48][c] * transmission) / 255),
				),
			);
			assert(
				Math.abs(black[p + c] - black[p]) <= 1,
				"Dither foreground has color",
			);
			if (alpha >= 25) {
				const recovered = (black[p + c] * 255) / alpha;
				assert(
					Math.min(Math.abs(recovered), Math.abs(255 - recovered)) <= 11,
					`Nonbinary foreground at ${p / 4}: ${recovered}`,
				);
			}
		}
		if (alpha === 255 && black[p] === 0) opaqueBlack++;
		if (alpha === 255 && black[p] === 255) opaqueWhite++;
	}
	assert(
		transparent > (black.length / 4) * 0.1 &&
			partial > 100 &&
			opaqueBlack > 500 &&
			opaqueWhite > 500 &&
			blendError <= 3,
		`Dither alpha/coverage ${JSON.stringify({ transparent, partial, opaqueBlack, opaqueWhite, blendError })}`,
	);
	return { transparent, partial, opaqueBlack, opaqueWhite, blendError };
}

export function ditherContactSheet(
	frames: Uint8ClampedArray[],
	width: number,
	height: number,
) {
	const sheet = document.createElement("canvas");
	sheet.width = 1280;
	sheet.height = 360;
	document.body.append(sheet);
	const context = sheet.getContext("2d")!;
	for (const [index, data] of frames.entries()) {
		const tile = new OffscreenCanvas(width, height);
		tile
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(data), width, height),
				0,
				0,
			);
		context.drawImage(
			tile,
			(index % 4) * 320,
			Math.floor(index / 4) * 180,
			320,
			180,
		);
	}
	return sheet.toDataURL("image/png").split(",")[1];
}
