import assert from "node:assert/strict";

export const cloudsCodecThresholds = Object.freeze({
	premultipliedRgb: 2,
	alpha: 1,
	identity: 0,
	exportMeanRgba: 10,
	exportActiveRgb: 15,
	exportMinimumActivePixels: 64,
	exportTimestampSeconds: 0.0011,
});
export const cloudsLocalTicks = Object.freeze([
	48000, 52000, 56000, 60000, 64000, 68000,
]);
const ranges = {
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
export function validateCloudsMedia(value) {
	assert(
		value && typeof value === "object",
		"Missing Clouds pipeline metadata",
	);
	assert.equal(value.width, 192, "Clouds frozen width changed");
	assert.equal(value.height, 128, "Clouds frozen height changed");
	assert.equal(value.frames, 6, "Expected six Clouds frames");
	assert.equal(value.fps, 30, "Expected 30 fps");
	assert.equal(value.codec, "vp9", "Expected VP9");
	assert.equal(value.mimeType, "video/webm", "Expected WebM");
	assert.equal(
		value.reference,
		"Independent cloudsExpected on fixed cut-out source RGBA, composited over black ColorNode; not production capture pixels",
		"Clouds reference provenance changed",
	);
	assert.deepEqual(
		value.thresholds,
		cloudsCodecThresholds,
		"Clouds thresholds changed",
	);
	assert.deepEqual(
		value.localTicks,
		cloudsLocalTicks,
		"Clouds local ticks changed",
	);
	assert.deepEqual(
		value.timelineTicks,
		cloudsLocalTicks.map((tick) => tick + 12000),
		"Clouds timeline ticks changed",
	);
	assert(
		Array.isArray(value.paramsPerFrame) && value.paramsPerFrame.length === 6,
		"Wrong Clouds parameter frame count",
	);
	for (const params of value.paramsPerFrame) {
		assert(
			params && typeof params === "object" && !Array.isArray(params),
			"Missing Clouds parameters",
		);
		assert.deepEqual(
			Object.keys(params).sort(),
			Object.keys(ranges).sort(),
			"Clouds parameter keys changed",
		);
		for (const [key, [minimum, maximum]] of Object.entries(ranges))
			assert(
				Number.isFinite(params[key]) &&
					params[key] >= minimum &&
					params[key] <= maximum &&
					(key !== "seed" || Number.isInteger(params[key])),
				`Invalid Clouds ${key}`,
			);
	}
	return value;
}
export function requireCloudsPipelineSuccess(evidence) {
	assert(
		evidence?.ok === true &&
			evidence.mode === "pipeline" &&
			evidence.kind === "clouds-production-pipeline",
		"Requires successful Clouds pipeline evidence",
	);
	assert(
		evidence.checks?.ok === true &&
			evidence.checks.backend === "webgl" &&
			evidence.checks.nativeHandlesGone === true,
		"Clouds browser checks or native cleanup were not successful",
	);
	assert(
		Array.isArray(evidence.checks.cleanupErrors) &&
			evidence.checks.cleanupErrors.length === 0,
		"Clouds pipeline cleanup failed",
	);
	assert(
		evidence.browserClosed === true &&
			evidence.serverClosed === true &&
			evidence.postRunVerification?.ok === true,
		"Clouds input or host cleanup verification failed",
	);
	for (const key of [
		"captureErrors",
		"pageErrors",
		"httpErrors",
		"externalRequests",
	])
		assert(
			Array.isArray(evidence[key]) && evidence[key].length === 0,
			`Clouds ${key} not empty`,
		);
	assert(
		Array.isArray(evidence.console) &&
			!evidence.console.some((message) => message.type === "error"),
		"Clouds console contains errors",
	);
}
