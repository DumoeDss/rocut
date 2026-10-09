import {
	cloudsRate,
	cloudsThresholds,
	type CloudsParams,
} from "./clouds-cases";
import { cloudsExpected } from "./clouds-oracle";

export const pipelineSize = Object.freeze({ width: 192, height: 128 });
export const pipelineFps = cloudsRate;
export const pipelineOffset = 12000;
export const pipelineDuration = 120000;
export const pipelineTrim = Object.freeze({ trimStart: 16000, trimEnd: 8000 });
export const pipelineLocalTicks = Object.freeze([
	48000, 52000, 56000, 60000, 64000, 68000,
]);
export const pipelineParams: CloudsParams = Object.freeze({
	amount: 0.85,
	density: 0.75,
	scale: 0.23,
	speed: 1.25,
	windX: 0.15,
	windY: -0.2,
	refraction: 0.06,
	fogOpacity: 0.3,
	colorR: 0.2,
	colorG: 0.75,
	colorB: 0.9,
	seed: 31415,
});
export const pipelineAnimated = {
	amount: [0.7, 1],
	density: [0.55, 0.9],
	windX: [-0.5, 0.5],
	windY: [0.3, -0.3],
	refraction: [0.025, 0.07],
	fogOpacity: [0.15, 0.65],
	colorR: [0.1, 0.9],
	colorG: [0.75, 0.25],
	colorB: [0.85, 0.15],
} as const;
export type PipelineChannel = keyof typeof pipelineAnimated;
export type Placement = "attached" | "effect-layer";
export const pipelineThresholds = Object.freeze({
	...cloudsThresholds,
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});

// Native time is frame-floored separately; authored curves use exact local ticks.
export function pipelineParamsAt(
	local: number,
	animated: boolean,
	onlyChannel?: PipelineChannel,
): CloudsParams {
	const params = { ...pipelineParams };
	if (!animated) return params;
	const progress = Math.max(
		0,
		Math.min(1, (Math.max(0, local) - 48000) / 20000),
	);
	for (const key of Object.keys(pipelineAnimated) as PipelineChannel[]) {
		if (onlyChannel && key !== onlyChannel) continue;
		const [start, end] = pipelineAnimated[key];
		params[key] = start + (end - start) * progress;
	}
	return params;
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
	placement: Placement,
	local: number,
	animated: boolean,
	onlyChannel?: PipelineChannel,
) {
	if (animated && placement === "effect-layer")
		throw Error("Effect layers do not support animation");
	const active = local >= 0 && local < pipelineDuration;
	const attached = placement === "attached";
	const image =
		!active && attached ? new Uint8ClampedArray(source.length) : source;
	const baseline = blackComposite(image);
	const params = pipelineParamsAt(local, animated, onlyChannel);
	// Attached effect -> opaque frame clear; scene effect <- already-composed image.
	const expected = cloudsExpected(
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
