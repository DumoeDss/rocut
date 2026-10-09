import {
	dropletsThresholds,
	type DropletsParams,
	type DropletsRate,
} from "./droplets-cases";

import { dropletsGeometry } from "./droplets-oracle-time";
export {
	dropletsGeometry,
	dropletsHash,
	dropletsSampleTicks,
	dropletsTimePhase,
} from "./droplets-oracle-time";

/** Pixel-index coordinates; an out-of-bounds tap is transparent, not clamped. */
export function dropletsSample(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	x: number,
	y: number,
) {
	const result = [0, 0, 0, 0];
	const left = Math.floor(x),
		top = Math.floor(y);
	for (const py of [top, top + 1])
		for (const px of [left, left + 1]) {
			if (px < 0 || py < 0 || px >= width || py >= height) continue;
			const weight = (1 - Math.abs(x - px)) * (1 - Math.abs(y - py));
			const offset = (py * width + px) * 4,
				alpha = pixels[offset + 3] / 255;
			for (let channel = 0; channel < 3; channel++)
				result[channel] += pixels[offset + channel] * alpha * weight;
			result[3] += pixels[offset + 3] * weight;
		}
	return result;
}

export function dropletsExpected(
	source: Uint8ClampedArray,
	width: number,
	height: number,
	params: DropletsParams,
	local: number,
	rate: DropletsRate,
) {
	const geometry = dropletsGeometry(params, local, rate);
	const pixels = new Uint8ClampedArray(source),
		outside = new Uint8Array(width * height);
	const boundary = new Uint8Array(width * height);
	const shortSide = Math.min(width, height),
		amount = Math.fround(params.amount);
	let activePixels = 0,
		overlapPixels = 0,
		exteriorTaps = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const pixel = y * width + x,
				offset = pixel * 4;
			let envelope = 0,
				qx = 0,
				qy = 0,
				overlaps = 0;
			for (const drop of geometry) {
				const rx = drop.radius * shortSide,
					ry = rx * drop.elongation;
				const dx = (x + 0.5 - drop.x * width) / rx;
				const dy = (y + 0.5 + ry - drop.phase * (height + 2 * ry)) / ry;
				const r2 = dx * dx + dy * dy;
				if (Math.abs(r2 - 1) < dropletsThresholds.boundarySquaredRadius)
					boundary[pixel] = 1;
				if (r2 >= 1) continue;
				overlaps++;
				const strength = (1 - r2) ** 2;
				if (strength > envelope) {
					envelope = strength;
					qx = dx;
					qy = dy;
				}
			}
			if (overlaps > 1) overlapPixels++;
			if (!envelope || !amount) {
				outside[pixel] = 1;
				continue;
			}
			activePixels++;
			const displacement =
				envelope * Math.fround(params.refraction) * shortSide;
			const sx = x - qx * displacement,
				sy = y - qy * displacement;
			if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1) exteriorTaps++;
			const refracted = dropletsSample(source, width, height, sx, sy);
			const alpha = source[offset + 3] * (1 - amount) + refracted[3] * amount;
			const spot = Math.max(0, 1 - Math.hypot(qx + 0.35, qy + 0.35) / 0.3) ** 2;
			const shine = amount * Math.fround(params.highlight) * envelope * spot;
			pixels[offset + 3] = alpha <= 0.5 ? 0 : Math.round(alpha);
			for (let channel = 0; channel < 3; channel++) {
				const base = (source[offset + channel] * source[offset + 3]) / 255;
				const mixed = base * (1 - amount) + refracted[channel] * amount;
				pixels[offset + channel] =
					alpha <= 0.5
						? 0
						: Math.round(((mixed * (1 - shine) + alpha * shine) * 255) / alpha);
			}
		}
	return {
		pixels,
		outside,
		boundary,
		activePixels,
		overlapPixels,
		exteriorTaps,
	};
}

export function dropletsDifference(
	actual: Uint8ClampedArray,
	expected: ReturnType<typeof dropletsExpected>,
	baseline?: Uint8ClampedArray,
) {
	if (actual.length !== expected.pixels.length)
		throw Error("Pixel length mismatch");
	let failed = 0,
		outsideFailed = 0,
		excluded = 0,
		maximumRgb = 0,
		maximumAlpha = 0;
	let firstFailure:
		| { pixel: number; actual: number[]; expected: number[] }
		| undefined;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const pixel = offset / 4;
		if (expected.boundary[pixel]) {
			excluded++;
			continue;
		}
		let bad = false;
		const alpha = Math.abs(actual[offset + 3] - expected.pixels[offset + 3]);
		maximumAlpha = Math.max(maximumAlpha, alpha);
		if (alpha > dropletsThresholds.alpha) bad = true;
		for (let channel = 0; channel < 3; channel++) {
			const delta = Math.abs(
				(actual[offset + channel] * actual[offset + 3]) / 255 -
					(expected.pixels[offset + channel] * expected.pixels[offset + 3]) /
						255,
			);
			maximumRgb = Math.max(maximumRgb, delta);
			if (delta > dropletsThresholds.premultipliedRgb) bad = true;
		}
		if (bad) {
			failed++;
			firstFailure ??= {
				pixel,
				actual: Array.from(actual.subarray(offset, offset + 4)),
				expected: Array.from(expected.pixels.subarray(offset, offset + 4)),
			};
		}
		if (
			baseline &&
			expected.outside[pixel] &&
			[0, 1, 2, 3].some((c) => actual[offset + c] !== baseline[offset + c])
		)
			outsideFailed++;
	}
	return {
		failed,
		outsideFailed,
		excluded,
		maximumRgb,
		maximumAlpha,
		firstFailure,
	};
}
