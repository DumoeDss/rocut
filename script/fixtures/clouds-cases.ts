export type CloudsRate = { numerator: number; denominator: number };
export type CloudsParams = {
	amount: number;
	density: number;
	scale: number;
	speed: number;
	windX: number;
	windY: number;
	refraction: number;
	fogOpacity: number;
	colorR: number;
	colorG: number;
	colorB: number;
	seed: number;
};

export const cloudsRate: CloudsRate = { numerator: 30, denominator: 1 };
export const cloudsDefaults: CloudsParams = {
	amount: 1,
	density: 0.5,
	scale: 0.3,
	speed: 0.05,
	windX: 0,
	windY: 0,
	refraction: 0.015,
	fogOpacity: 0.45,
	colorR: 1,
	colorG: 1,
	colorB: 1,
	seed: 1,
};
export const cloudsParameters: CloudsParams = {
	amount: 0.8,
	density: 0.7,
	scale: 0.17,
	speed: 0.5,
	windX: 0.23,
	windY: -0.19,
	refraction: 0.075,
	fogOpacity: 0.35,
	colorR: 0.3,
	colorG: 0.75,
	colorB: 1,
	seed: 31415,
};

// Frozen before GPU execution; every pixel participates, with no exclusion band.
export const cloudsThresholds = Object.freeze({
	premultipliedRgb: 2,
	alpha: 1,
	identity: 0,
});
export const cloudsRanges: Record<
	keyof CloudsParams,
	readonly [number, number]
> = {
	amount: [0, 1],
	density: [0, 1],
	scale: [0.05, 2],
	speed: [0, 4],
	windX: [-16, 16],
	windY: [-16, 16],
	refraction: [0, 0.08],
	fogOpacity: [0, 1],
	colorR: [0, 1],
	colorG: [0, 1],
	colorB: [0, 1],
	seed: [0, 65535],
};
export const cloudsAnimatedFields = [
	"amount",
	"density",
	"windX",
	"windY",
	"refraction",
	"fogOpacity",
	"colorR",
	"colorG",
	"colorB",
] as const;

export type CloudsSourceKind = "opaque" | "holes" | "transparent";
export function cloudsSource(
	width: number,
	height: number,
	kind: CloudsSourceKind,
) {
	const pixels = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const cell = (Math.floor(x / 7) + Math.floor(y / 5)) % 4;
			const alpha =
				kind === "transparent"
					? 0
					: kind === "holes"
						? [0, 64, 160, 255][cell]
						: 255;
			pixels.set(
				[
					alpha ? Math.round((255 * x) / Math.max(1, width - 1)) : 255,
					alpha ? Math.round((255 * y) / Math.max(1, height - 1)) : 0,
					alpha ? (cell % 2 ? 224 : 24) : 255,
					alpha,
				],
				(y * width + x) * 4,
			);
		}
	return pixels;
}

export function cloudsVariants(): Record<string, Partial<CloudsParams>> {
	return {
		amount: { amount: 0.4 },
		density: { density: 0.35 },
		scale: { scale: 0.09 },
		speed: { speed: 1 },
		windX: { windX: -0.37 },
		windY: { windY: 0.31 },
		refraction: { refraction: 0 },
		fogOpacity: { fogOpacity: 0 },
		colorR: { colorR: 1 },
		colorG: { colorG: 0.1 },
		colorB: { colorB: 0.2 },
		seed: { seed: 27182 },
	};
}

export function cloudsInvalidParameters(): Record<string, number>[] {
	const cases: Record<string, number>[] = [];
	for (const [key, [minimum, maximum]] of Object.entries(cloudsRanges))
		for (const value of [
			minimum - 0.001,
			maximum + 0.001,
			NaN,
			Infinity,
			-Infinity,
		])
			cases.push({ [key]: value });
	return [...cases, { seed: 0.5 }, { unknown: 1 }];
}
