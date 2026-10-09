export type DropletsRate = { numerator: number; denominator: number };
export type DropletsParams = {
	amount: number;
	count: number;
	radius: number;
	speed: number;
	elongation: number;
	refraction: number;
	highlight: number;
	seed: number;
};

export const dropletsRate: DropletsRate = { numerator: 30, denominator: 1 };
export const dropletsDefaults: DropletsParams = {
	amount: 1,
	count: 24,
	radius: 0.035,
	speed: 0.35,
	elongation: 1.8,
	refraction: 0.018,
	highlight: 0.15,
	seed: 1,
};
export const dropletsParameters: DropletsParams = {
	...dropletsDefaults,
	count: 12,
	radius: 0.1,
	refraction: 0.08,
	highlight: 0.6,
	speed: 0.5,
	seed: 31415,
};

// Fixed before GPU execution. Alpha comparisons use premultiplied RGB to
// avoid amplifying one byte of readback quantization at nearly-zero alpha.
export const dropletsThresholds = Object.freeze({
	premultipliedRgb: 2,
	alpha: 1,
	outsideIdentity: 0,
	boundarySquaredRadius: 0.0001,
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});

export const dropletsCodecCase = Object.freeze({
	width: 192,
	height: 128,
	rate: dropletsRate,
	ticks: [48000, 52000, 56000, 60000, 64000, 68000],
	params: dropletsParameters,
});

export type DropletsSourceKind = "opaque" | "holes" | "transparent";
export function dropletsSource(
	width: number,
	height: number,
	kind: DropletsSourceKind,
) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const offset = 4 * (y * width + x);
			const cell = (Math.floor(x / 9) + Math.floor(y / 7)) % 4;
			const alpha =
				kind === "transparent"
					? 0
					: kind === "holes"
						? [0, 64, 160, 255][cell]
						: 255;
			pixels.set(
				[
					Math.round((255 * x) / (width - 1)),
					Math.round((255 * y) / (height - 1)),
					cell % 2 ? 224 : 24,
					alpha,
				],
				offset,
			);
			if (!alpha) pixels.set([255, 0, 255], offset);
		}
	return pixels;
}

export function dropletsVariants(): Record<string, Partial<DropletsParams>> {
	return {
		halfAmount: { amount: 0.5 },
		singleDrop: { count: 1 },
		fullBudget: { count: 64 },
		smaller: { radius: 0.06 },
		faster: { speed: 1 },
		round: { elongation: 1 },
		noRefraction: { refraction: 0 },
		noHighlight: { highlight: 0 },
		otherSeed: { seed: 27182 },
	};
}

export function dropletsInvalidParameters(): Partial<DropletsParams>[] {
	return [
		{ amount: -0.01 },
		{ amount: 1.01 },
		{ count: -1 },
		{ count: 65 },
		{ count: 1.5 },
		{ radius: 0.002 },
		{ radius: 0.151 },
		{ speed: -0.01 },
		{ speed: 4.01 },
		{ elongation: 0.9 },
		{ elongation: 4.1 },
		{ refraction: -0.001 },
		{ refraction: 0.101 },
		{ highlight: -0.01 },
		{ highlight: 1.01 },
		{ seed: -1 },
		{ seed: 65536 },
		{ seed: 0.5 },
	];
}
