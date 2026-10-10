export const alphaRows = [
	0, 1, 2, 4, 8, 15, 16, 17, 31, 32, 63, 64, 127, 128, 254, 255,
] as const;
export const alphaContrasts = [-32, -36, -40] as const;
export type AlphaImage = {
	width: number;
	height: number;
	pixels: Uint8ClampedArray;
};

export function alphaSource(black = false): AlphaImage {
	const width = black ? 16 : 256,
		height = alphaRows.length;
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			pixels.set(
				black
					? [0, 0, 0, alphaRows[y]]
					: [x, (73 * x + 41) % 256, (151 * x + 51) % 256, alphaRows[y]],
				offset,
			);
		}
	return { width, height, pixels };
}

export function alphaAdjustment(contrast: number) {
	if (!alphaContrasts.some((value) => value === contrast))
		throw Error("Unknown alpha calibration contrast");
	return {
		shader: "color-adjustment",
		uniforms: [
			{ name: "exposure", value: [0] },
			{ name: "contrast", value: [contrast] },
			{ name: "saturation", value: [0] },
			{ name: "temperature", value: [0] },
			{ name: "tint", value: [0] },
		],
	};
}

/** Raw pass executes VHS's amount=0 early return; no empty-stack elision. */
export function alphaIdentityPass() {
	return {
		shader: "vhs",
		uniforms: [
			{ name: "amount", value: [0] },
			{ name: "noise", value: [0] },
			{ name: "scanlines", value: [0] },
			{ name: "bleed", value: [0] },
			{ name: "seed", value: [1] },
			{ name: "frame", value: [0] },
		],
	};
}

/** Black contrast transform is -contrast/200; this has no effect-oracle dependency. */
export function alphaAnalytic(contrast: number): AlphaImage {
	alphaAdjustment(contrast);
	const source = alphaSource(true),
		gray = Math.round((-contrast / 200) * 255);
	for (let offset = 0; offset < source.pixels.length; offset += 4)
		if (source.pixels[offset + 3]) source.pixels.fill(gray, offset, offset + 3);
	return source;
}

export const alphaStagePlan = [
	{ id: "A0-authored", width: 256, height: 16 },
	{ id: "A1-put-get", width: 256, height: 16 },
	{ id: "A2-copy-get", width: 256, height: 16 },
	{ id: "A3-copy-again-get", width: 256, height: 16 },
	{ id: "B0-identity-returned", width: 256, height: 16 },
	{ id: "B1-identity-copy", width: 256, height: 16 },
	{ id: "C0-black-authored", width: 16, height: 16 },
	{ id: "C1-black-put-get", width: 16, height: 16 },
	...alphaContrasts.flatMap((contrast) => [
		{ id: `C-${contrast}-analytic`, width: 16, height: 16 },
		{ id: `C-${contrast}-returned`, width: 16, height: 16 },
		{ id: `C-${contrast}-copy`, width: 16, height: 16 },
	]),
];

export const alphaNativeStages = [
	{ id: "B0-identity-native-texture", width: 256, height: 16 },
	...alphaContrasts.map((contrast) => ({
		id: `C-${contrast}-native-texture`,
		width: 16,
		height: 16,
	})),
];
