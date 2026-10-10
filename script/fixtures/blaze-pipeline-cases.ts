import { blazeParameters, type BlazeParams } from "./blaze-cases";
import { blazeExpected } from "./blaze-oracle";
import { blazeRawThresholds } from "./blaze-browser-metrics";

export const pipelineSize = Object.freeze({ width: 192, height: 128 });
export const pipelineFps = Object.freeze({
	numerator: 30000,
	denominator: 1001,
});
export const pipelineFrameTicks = 4004;
export const pipelineOffset = 12012;
export const pipelineDuration = 120120;
export const pipelineTrim = Object.freeze({ trimStart: 16016, trimEnd: 8008 });
export const pipelineLocalTicks = Object.freeze([
	48048, 52052, 56056, 60060, 64064, 68068,
]);
export const pipelineParams: BlazeParams = Object.freeze({
	...blazeParameters,
});
export const pipelineAnimated = Object.freeze({
	amount: [0.8, 1],
	flameOpacity: [0.75, 1],
	sparkOpacity: [1, 0.35],
	smokeOpacity: [0.5, 0.8],
	refraction: [0.065, 0.025],
	height: [0.85, 1.25],
	wind: [0.37, -0.5],
} as const);
export type PipelineChannel = keyof typeof pipelineAnimated;
export type Placement = "attached" | "effect-layer";
export const pipelineThresholds = Object.freeze({
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});
export const pipelineRawThresholds = blazeRawThresholds;
export const pipelineReference =
	"Independent blazeExpected on canonical blazeSource holes-gradient RGBA, then source-over black ColorNode; never production-rendered expected pixels";

/** Independent expected-side linear + hold formula; never used to author each rendered frame. */
export function pipelineParamsAt(
	local: number,
	animated: boolean,
	onlyChannel?: PipelineChannel,
): BlazeParams {
	const params = { ...pipelineParams };
	if (!animated) return params;
	const progress = Math.max(0, Math.min(1, (local - 48048) / 20020));
	for (const key of Object.keys(pipelineAnimated) as PipelineChannel[]) {
		if (onlyChannel && key !== onlyChannel) continue;
		const [start, end] = pipelineAnimated[key];
		params[key] = start + (end - start) * progress;
	}
	return params;
}

export function blackComposite(pixels: Uint8ClampedArray) {
	const result = new Uint8ClampedArray(pixels.length);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		for (let channel = 0; channel < 3; channel++)
			result[offset + channel] = Math.round(
				(pixels[offset + channel] * pixels[offset + 3]) / 255,
			);
		result[offset + 3] = 255;
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
	if (placement !== "attached")
		throw Error("Blaze video fixture covers attached effects only");
	const active = local >= 0 && local < pipelineDuration;
	const image = active ? source : new Uint8ClampedArray(source.length);
	const params = pipelineParamsAt(local, animated, onlyChannel);
	const expected = blazeExpected({
		source: image,
		...pipelineSize,
		params: active ? params : { ...params, amount: 0 },
		ticks: active ? local : 0,
		rate: pipelineFps,
	});
	return {
		...expected,
		pixels: blackComposite(expected.pixels),
		baseline: blackComposite(image),
		params,
		local,
		active,
	};
}
