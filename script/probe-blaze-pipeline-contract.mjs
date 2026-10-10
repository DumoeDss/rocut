import assert from "node:assert/strict";

export const blazePipelineCodecThresholds = Object.freeze({
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});
export const blazePipelineContract = Object.freeze({
	version: 1,
	width: 192,
	height: 128,
	frames: 6,
	frameRate: { numerator: 30000, denominator: 1001 },
	frameTicks: 4004,
	clipOffset: 12012,
	localTicks: [48048, 52052, 56056, 60060, 64064, 68068],
	timelineTicks: [60060, 64064, 68068, 72072, 76076, 80080],
	exportStart: 60060,
	exportEnd: 84084,
	durationTicks: 24024,
	durationSeconds: 0.2002,
	keyframeLocalTicks: [48048, 68068],
	trimStart: 16016,
	trimEnd: 8008,
	quality: "very_high",
	codec: "vp9",
	mimeType: "video/webm",
	staticParams: { scale: 0.11, speed: 0.5, seed: 31415 },
	animated: {
		amount: [0.8, 1],
		flameOpacity: [0.75, 1],
		sparkOpacity: [1, 0.35],
		smokeOpacity: [0.5, 0.8],
		refraction: [0.065, 0.025],
		height: [0.85, 1.25],
		wind: [0.37, -0.5],
	},
	reference:
		"Independent blazeExpected on canonical blazeSource holes-gradient RGBA, then source-over black ColorNode; never production-rendered expected pixels",
	thresholds: blazePipelineCodecThresholds,
});

export function validateBlazePipelineMedia(value) {
	const spec = blazePipelineContract;
	for (const key of [
		"version",
		"width",
		"height",
		"frames",
		"frameTicks",
		"clipOffset",
		"trimStart",
		"trimEnd",
		"quality",
		"codec",
		"mimeType",
		"reference",
	])
		assert.equal(value?.[key], spec[key], `Blaze pipeline ${key} changed`);
	for (const key of [
		"frameRate",
		"localTicks",
		"timelineTicks",
		"keyframeLocalTicks",
		"thresholds",
	])
		assert.deepEqual(value[key], spec[key], `Blaze pipeline ${key} changed`);
	assert.equal(value.fps, 30000 / 1001);
	assert(
		["default", "444"].includes(value.requestedVideoChroma),
		"No automatic profile upgrade or unspecified alternate request",
	);
	assert(
		Array.isArray(value.paramsPerFrame) && value.paramsPerFrame.length === 6,
	);
	for (const [index, params] of value.paramsPerFrame.entries()) {
		assert.deepEqual(
			Object.keys(params).sort(),
			[...Object.keys(spec.staticParams), ...Object.keys(spec.animated)].sort(),
		);
		for (const [key, expected] of Object.entries(spec.staticParams))
			assert.equal(params[key], expected);
		for (const [key, [start, end]] of Object.entries(spec.animated)) {
			assert(Number.isFinite(params[key]));
			assert(
				Math.abs(params[key] - (start + ((end - start) * index) / 5)) <= 1e-12,
				`Blaze ${key} frame ${index} changed`,
			);
		}
	}
	return value;
}
