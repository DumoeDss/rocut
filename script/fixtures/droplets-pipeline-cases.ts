import {
	dropletsParameters,
	dropletsRate,
	dropletsThresholds,
} from "./droplets-cases";
import { dropletsExpected } from "./droplets-oracle";

export const pipelineSize = { width: 192, height: 128 };
export const pipelineFps = dropletsRate;
export const pipelineOffset = 12000;
export const pipelineDuration = 120000;
export const pipelineTrim = { trimStart: 16000, trimEnd: 8000 };
export const pipelineLocalTicks = [48000, 52000, 56000, 60000, 64000, 68000];
export const pipelineParams = {
	...dropletsParameters,
	speed: 4,
	radius: 0.12,
	refraction: 0.1,
};
export const pipelineOptical = {
	amount: [0.55, 1],
	refraction: [0.04, 0.1],
	highlight: [0.1, 0.6],
};
export const pipelineThresholds = dropletsThresholds;

// The fixture's linear authoring contract is independent of Rocut's evaluator.
export function pipelineParamsAt(localTicks: number, animated: boolean) {
	if (!animated) return { ...pipelineParams };
	const progress = Math.max(0, Math.min(1, (localTicks - 48000) / 20000));
	return {
		...pipelineParams,
		...Object.fromEntries(
			Object.entries(pipelineOptical).map(([key, [start, end]]) => [
				key,
				start + (end - start) * progress,
			]),
		),
	};
}

export function blackComposite(pixels: Uint8ClampedArray) {
	const result = new Uint8ClampedArray(pixels.length);
	for (let index = 0; index < pixels.length; index += 4) {
		for (let channel = 0; channel < 3; channel++)
			result[index + channel] = Math.round(
				(pixels[index + channel] * pixels[index + 3]) / 255,
			);
		result[index + 3] = 255;
	}
	return result;
}

export function pipelineExpected(
	source: Uint8ClampedArray,
	placement: "attached" | "effect-layer",
	local: number,
	animated: boolean,
) {
	const active = local >= 0 && local < pipelineDuration;
	const attached = placement === "attached";
	const image =
		!active && attached ? new Uint8ClampedArray(source.length) : source;
	const baseline = blackComposite(image);
	const params = pipelineParamsAt(local, animated);
	// FrameDescriptor clears to opaque black. Attached effects run before the
	// layer is blended onto that scene; scene effects run after image blending.
	const expected = dropletsExpected(
		attached ? image : baseline,
		pipelineSize.width,
		pipelineSize.height,
		active ? params : { ...params, amount: 0 },
		active ? local : 0,
		pipelineFps,
	);
	return {
		...expected,
		pixels: attached ? blackComposite(expected.pixels) : expected.pixels,
		baseline,
		params,
		local,
		active,
	};
}

export function codecDifference(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	baseline: Uint8ClampedArray,
) {
	if (actual.length !== expected.length || baseline.length !== expected.length)
		throw Error("Droplets codec pixel length mismatch");
	let total = 0,
		activeError = 0,
		activePixels = 0;
	for (let offset = 0; offset < actual.length; offset += 4) {
		for (let channel = 0; channel < 4; channel++)
			total += Math.abs(actual[offset + channel] - expected[offset + channel]);
		if (
			[0, 1, 2].some(
				(channel) =>
					Math.abs(expected[offset + channel] - baseline[offset + channel]) >
					15,
			)
		) {
			activePixels++;
			for (let channel = 0; channel < 3; channel++)
				activeError += Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
		}
	}
	const meanRgba = total / actual.length;
	const activeRgb = activePixels
		? activeError / (activePixels * 3)
		: Number.MAX_VALUE;
	return {
		meanRgba,
		activeRgb,
		activePixels,
		accepted:
			meanRgba <= pipelineThresholds.exportMeanRgba &&
			activeRgb <= pipelineThresholds.exportActiveRgb &&
			activePixels >= pipelineThresholds.exportMinimumActivePixels,
	};
}
