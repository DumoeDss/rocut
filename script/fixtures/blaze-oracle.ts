import type { BlazeParams, BlazeRate } from "./blaze-cases";
import { blazeContext, blazePixelField } from "./blaze-oracle-field";
import {
	blazeSample,
	blazeStraightBytes,
	type BlazePremultipliedPixel,
} from "./blaze-oracle-sampling";
export { blazeContext, blazePixelField } from "./blaze-oracle-field";
export { blazeSample } from "./blaze-oracle-sampling";
export {
	blazePhase,
	blazePhaseFraction,
	blazeHash,
	blazeSampleTicks,
	blazeSparks,
} from "./blaze-oracle-time";

export function blazeOver({
	base,
	color,
	alpha,
}: {
	base: BlazePremultipliedPixel;
	color: readonly number[];
	alpha: number;
}): BlazePremultipliedPixel {
	return [
		color[0] * alpha + base[0] * (1 - alpha),
		color[1] * alpha + base[1] * (1 - alpha),
		color[2] * alpha + base[2] * (1 - alpha),
		alpha + base[3] * (1 - alpha),
	];
}

/** Independent offline contract reference; all spatial and color math is double. */
export function blazeExpected({
	source,
	width,
	height,
	params,
	ticks,
	rate,
	enabled = true,
}: {
	source: Uint8ClampedArray;
	width: number;
	height: number;
	params: BlazeParams;
	ticks: number;
	rate: BlazeRate;
	enabled?: boolean;
}) {
	if (
		!Number.isSafeInteger(width) ||
		width < 1 ||
		!Number.isSafeInteger(height) ||
		height < 1 ||
		source.length !== width * height * 4
	)
		throw Error("Invalid Blaze image");
	const context = blazeContext({ params, ticks, rate, width, height });
	const pixels = new Uint8ClampedArray(source);
	const premultiplied = new Float64Array(source.length);
	const identity = new Uint8Array(width * height);
	const modes = {
		flame: new Uint8Array(width * height),
		sparks: new Uint8Array(width * height),
		smoke: new Uint8Array(width * height),
		heat: new Uint8Array(width * height),
	};
	const bypass =
		!enabled ||
		params.amount === 0 ||
		[
			params.flameOpacity,
			params.sparkOpacity,
			params.smokeOpacity,
			params.refraction,
		].every((value) => value === 0);
	let activePixels = 0,
		exteriorPixels = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pixel = y * width + x;
			const offset = pixel * 4;
			const base = blazeSample({ pixels: source, width, height, x, y });
			premultiplied.set(base, offset);
			if (bypass) {
				identity[pixel] = 1;
				continue;
			}
			const field = blazePixelField({ context, x, y });
			modes.flame[pixel] = Number(field.flameAlpha > 0);
			modes.sparks[pixel] = Number(field.sparkAlpha > 0);
			modes.smoke[pixel] = Number(field.smokeAlpha > 0);
			modes.heat[pixel] = Number(field.dx !== 0 || field.dy !== 0);
			if (
				!modes.flame[pixel] &&
				!modes.sparks[pixel] &&
				!modes.smoke[pixel] &&
				!modes.heat[pixel]
			) {
				identity[pixel] = 1;
				continue;
			}
			activePixels++;
			let result: BlazePremultipliedPixel = base;
			if (modes.heat[pixel]) {
				const sx = x + field.dx,
					sy = y + field.dy;
				if (sx < 0 || sy < 0 || sx > width - 1 || sy > height - 1)
					exteriorPixels++;
				const shifted = blazeSample({
					pixels: source,
					width,
					height,
					x: sx,
					y: sy,
				});
				result = [0, 0, 0, 0];
				for (let channel = 0; channel < 4; channel++)
					result[channel] =
						base[channel] * (1 - context.params.amount) +
						shifted[channel] * context.params.amount;
			}
			result = blazeOver({
				base: result,
				color: [0.16, 0.18, 0.2],
				alpha: field.smokeAlpha,
			});
			result = blazeOver({
				base: result,
				color: field.flameColor,
				alpha: field.flameAlpha,
			});
			result = blazeOver({
				base: result,
				color: [1, 0.75, 0.25],
				alpha: field.sparkAlpha,
			});
			premultiplied.set(result, offset);
			pixels.set(blazeStraightBytes(result), offset);
		}
	}
	return {
		pixels,
		premultiplied,
		identity,
		modes,
		activePixels,
		exteriorPixels,
		phase: context.phase,
	};
}

/** Descriptive CPU/GPU comparison only; acceptance tolerances are not set here. */
export function blazeDifference({
	actual,
	expected,
	minimum = 0,
}: {
	actual: Uint8ClampedArray;
	expected: Uint8ClampedArray;
	minimum?: number;
}) {
	if (actual.length !== expected.length || actual.length % 4 !== 0)
		throw Error("Blaze pixel length mismatch");
	let changedPixels = 0,
		maximumPremultipliedRgb = 0,
		maximumAlpha = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		const alpha = Math.abs(actual[offset + 3] - expected[offset + 3]);
		maximumAlpha = Math.max(maximumAlpha, alpha);
		let changed = alpha > minimum;
		for (let channel = 0; channel < 3; channel++) {
			const delta =
				Math.abs(
					actual[offset + channel] * actual[offset + 3] -
						expected[offset + channel] * expected[offset + 3],
				) / 255;
			maximumPremultipliedRgb = Math.max(maximumPremultipliedRgb, delta);
			changed ||= delta > minimum;
		}
		changedPixels += Number(changed);
	}
	return { changedPixels, maximumPremultipliedRgb, maximumAlpha };
}
