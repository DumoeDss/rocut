import {
	cloudsRanges,
	cloudsThresholds,
	type CloudsParams,
	type CloudsRate,
} from "./clouds-cases";
import { cloudsLattice, cloudsNoiseAt } from "./clouds-oracle-noise";
import { cloudsTimePhase } from "./clouds-oracle-time";
export {
	cloudsHash,
	cloudsLattice,
	cloudsLatticeAt,
	cloudsNoiseAt,
} from "./clouds-oracle-noise";
export { cloudsSampleTicks, cloudsTimePhase } from "./clouds-oracle-time";

export function cloudsValidate(params: CloudsParams) {
	if (
		!params ||
		typeof params !== "object" ||
		Array.isArray(params) ||
		Object.keys(params).some((key) => !Object.hasOwn(cloudsRanges, key))
	)
		throw Error("Invalid Clouds parameter object");
	for (const [key, [minimum, maximum]] of Object.entries(cloudsRanges)) {
		const value = params[key as keyof CloudsParams];
		if (
			!Number.isFinite(value) ||
			value < minimum ||
			value > maximum ||
			(key === "seed" && !Number.isInteger(value))
		)
			throw Error(`Invalid Clouds ${key}`);
	}
}

/** Pixel-index coordinates, normalized premultiplied RGBA, transparent exterior. */
export function cloudsSample(
	source: Uint8ClampedArray,
	width: number,
	height: number,
	x: number,
	y: number,
) {
	const result = [0, 0, 0, 0],
		left = Math.floor(x),
		top = Math.floor(y);
	for (const py of [top, top + 1])
		for (const px of [left, left + 1]) {
			if (px < 0 || py < 0 || px >= width || py >= height) continue;
			const weight = (1 - Math.abs(x - px)) * (1 - Math.abs(y - py));
			const offset = (py * width + px) * 4,
				alpha = source[offset + 3] / 255;
			for (let channel = 0; channel < 3; channel++)
				result[channel] += (source[offset + channel] / 255) * alpha * weight;
			result[3] += alpha * weight;
		}
	return result;
}

export function cloudsExpected(
	source: Uint8ClampedArray,
	width: number,
	height: number,
	params: CloudsParams,
	local: number,
	rate: CloudsRate,
) {
	cloudsValidate(params);
	const phase = cloudsTimePhase(local, params.speed, rate);
	if (
		![width, height].every(
			(axis) => Number.isInteger(axis) && axis >= 1 && axis <= 8192,
		) ||
		width * height > 16777216 ||
		source.length !== width * height * 4
	)
		throw Error("Invalid Clouds source dimensions");
	const pixels = new Uint8ClampedArray(source),
		identity = new Uint8Array(width * height).fill(1);
	let activePixels = 0,
		exteriorSamples = 0,
		alphaFilledPixels = 0;
	if (
		params.amount === 0 ||
		params.density === 0 ||
		(params.refraction === 0 && params.fogOpacity === 0)
	)
		return {
			pixels,
			identity,
			phase,
			activePixels,
			exteriorSamples,
			alphaFilledPixels,
		};
	const uniform = Object.fromEntries(
		Object.entries(params).map(([key, value]) => [key, Math.fround(value)]),
	) as CloudsParams;
	const lattice = cloudsLattice(params.seed),
		shortSide = Math.min(width, height);
	const color = [uniform.colorR, uniform.colorG, uniform.colorB];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const noise = cloudsNoiseAt(
				lattice,
				((x + 0.5 - width / 2) / shortSide - uniform.windX) / uniform.scale,
				((y + 0.5 - height / 2) / shortSide - uniform.windY) / uniform.scale,
				phase,
			);
			const t = Math.max(
				0,
				Math.min(1, (noise.value - (1 - uniform.density)) / 0.2),
			);
			const weight = uniform.amount * t * t * (3 - 2 * t);
			if (weight === 0) {
				const offset = (y * width + x) * 4;
				if (source[offset + 3] === 0) {
					if (source[offset] || source[offset + 1] || source[offset + 2])
						identity[y * width + x] = 0;
					pixels.fill(0, offset, offset + 4);
				}
				continue;
			}
			const index = y * width + x,
				offset = index * 4,
				baseAlpha = source[offset + 3] / 255;
			identity[index] = 0;
			activePixels++;
			const base = [
				(source[offset] / 255) * baseAlpha,
				(source[offset + 1] / 255) * baseAlpha,
				(source[offset + 2] / 255) * baseAlpha,
				baseAlpha,
			];
			let refracted = base;
			if (uniform.refraction !== 0) {
				const divisor = Math.max(1, Math.hypot(noise.dx, noise.dy));
				const sx = x - (uniform.refraction * shortSide * noise.dx) / divisor;
				const sy = y - (uniform.refraction * shortSide * noise.dy) / divisor;
				if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1)
					exteriorSamples++;
				refracted = cloudsSample(source, width, height, sx, sy);
			}
			const fogAlpha = weight * uniform.fogOpacity;
			const alpha =
				(baseAlpha + (refracted[3] - baseAlpha) * weight) * (1 - fogAlpha) +
				fogAlpha;
			pixels[offset + 3] = Math.round(alpha * 255);
			if (baseAlpha === 0 && alpha > 0) alphaFilledPixels++;
			for (let channel = 0; channel < 3; channel++) {
				const optical =
					base[channel] + (refracted[channel] - base[channel]) * weight;
				pixels[offset + channel] =
					alpha <= 0
						? 0
						: Math.round(
								((optical * (1 - fogAlpha) + color[channel] * fogAlpha) /
									alpha) *
									255,
							);
			}
		}
	return {
		pixels,
		identity,
		phase,
		activePixels,
		exteriorSamples,
		alphaFilledPixels,
	};
}

export function cloudsDifference(
	actual: Uint8ClampedArray,
	expected: ReturnType<typeof cloudsExpected>,
	baseline?: Uint8ClampedArray,
) {
	if (
		actual.length !== expected.pixels.length ||
		(baseline && baseline.length !== actual.length)
	)
		throw Error("Clouds pixel length mismatch");
	let failed = 0,
		identityFailed = 0,
		maximumRgb = 0,
		maximumAlpha = 0;
	let firstFailure:
		| { pixel: number; actual: number[]; expected: number[] }
		| undefined;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const alphaDelta = Math.abs(
			actual[offset + 3] - expected.pixels[offset + 3],
		);
		maximumAlpha = Math.max(maximumAlpha, alphaDelta);
		let bad = alphaDelta > cloudsThresholds.alpha;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(
				(actual[offset + channel] * actual[offset + 3]) / 255 -
					(expected.pixels[offset + channel] * expected.pixels[offset + 3]) /
						255,
			);
			maximumRgb = Math.max(maximumRgb, delta);
			bad ||= delta > cloudsThresholds.premultipliedRgb;
		}
		if (bad) {
			failed++;
			firstFailure ??= {
				pixel: offset / 4,
				actual: Array.from(actual.subarray(offset, offset + 4)),
				expected: Array.from(expected.pixels.subarray(offset, offset + 4)),
			};
		}
		if (
			baseline &&
			expected.identity[offset / 4] &&
			[0, 1, 2, 3].some(
				(channel) =>
					Math.abs(actual[offset + channel] - baseline[offset + channel]) >
					cloudsThresholds.identity,
			)
		)
			identityFailed++;
	}
	return {
		failed,
		identityFailed,
		excluded: 0,
		maximumRgb,
		maximumAlpha,
		firstFailure,
	};
}
