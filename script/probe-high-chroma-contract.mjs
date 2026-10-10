import assert from "node:assert/strict";
import { dropletsCodecThresholds } from "./probe-droplets-pipeline-artifacts.mjs";

export const highChromaSpecs = Object.freeze({
	"droplets-192x128-30": {
		width: 192,
		height: 128,
		fps: 30,
		frames: 6,
		timelineTicks: [60000, 64000, 68000, 72000, 76000, 80000],
		localTicks: [48000, 52000, 56000, 60000, 64000, 68000],
		expectedSha256:
			"8e9e463233f562e733925f7996df9aa2eebc8de160a4d0a626d1d3c9190828ed",
		baselineSha256:
			"14a910ec5e99dbc64b718bfb10abd6e8ba86a610767f569a74360b49d4fded53",
	},
	"solid-sequence-640x360-24": {
		width: 640,
		height: 360,
		fps: 24,
		frames: 6,
		timelineTicks: [0, 5000, 10000, 15000, 20000, 25000],
		expectedSha256:
			"39bfc020d93fb536b6e3bb5ea0ca59ca6e9be1b82419878bff8bb948b110c8a6",
		baselineSha256:
			"b2eab2e96e1c94751425a42d1e435e41f8c48a5f1cd41ff4defb3931323ddc07",
	},
});
export const historical420 = Object.freeze({
	videoSha256:
		"ebbbac31d0cc3433118190c9ceadb592a49506cfaf2ce9c3806344202f04c740",
	browserFailedFrames: [5],
	defaultFfmpegFailedFrames: [0, 2, 4, 5],
});
export const highChromaThresholds = dropletsCodecThresholds;

export function validateHighChromaMedia(value) {
	assert(value && typeof value === "object", "Missing high-chroma media");
	assert(Object.hasOwn(highChromaSpecs, value.caseId), "Unknown fixture case");
	const spec = highChromaSpecs[value.caseId];
	for (const key of ["width", "height", "fps", "frames"])
		assert.equal(value[key], spec[key], `Fixture ${key} changed`);
	assert.deepEqual(
		value.timelineTicks,
		spec.timelineTicks,
		"Timeline ticks changed",
	);
	assert.deepEqual(
		value.thresholds,
		highChromaThresholds,
		"Codec gates changed",
	);
	assert.equal(value.codec, "vp9");
	assert.equal(value.mimeType, "video/webm");
	assert.equal(value.quality, "very_high");
	assert(["default", "420", "444"].includes(value.requestedVideoChroma));
	assert(typeof value.reference === "string" && value.reference.length > 0);
	if (spec.localTicks) {
		assert.deepEqual(
			value.localTicks,
			spec.localTicks,
			"Original local ticks changed",
		);
		const params = spec.localTicks.map((tick) => {
			const t = (tick - 48000) / 20000;
			return {
				amount: 0.55 + (1 - 0.55) * t,
				count: 12,
				radius: 0.12,
				speed: 4,
				elongation: 1.8,
				refraction: 0.04 + (0.1 - 0.04) * t,
				highlight: 0.1 + (0.6 - 0.1) * t,
				seed: 31415,
			};
		});
		assert.deepEqual(
			value.paramsPerFrame,
			params,
			"Original optical parameters changed",
		);
	} else
		assert.equal(
			value.requestedVideoChroma,
			"444",
			"Larger timing case is explicit 444 only",
		);
	return spec;
}
