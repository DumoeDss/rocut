import assert from "node:assert/strict";

export const QUANTIZER_SPECIFICATIONS = {
	webcodecs:
		"https://www.w3.org/TR/webcodecs/#dom-videoencoderbitratemode-quantizer",
	registration:
		"https://www.w3.org/TR/2025/DNOTE-webcodecs-vp9-codec-registration-20250514/#vp9-encode-options",
	editorDraft:
		"https://w3c.github.io/webcodecs/vp9_codec_registration.html#vp9-encode-options",
	rangeCaution:
		"The 2025 published Group Draft Note describes 0..63; the current Editor Draft describes 0..255. This diagnostic only uses their shared q0/q32/q63 values. A declaration is not runtime support or whole-pipeline losslessness evidence.",
};
export const PROFILE_CODECS = [
	"vp09.00.30.08.01.01.01.01.00",
	"vp09.01.30.08.03.01.01.01.00",
];

export function withQuantizerFrames(frames, quantizer) {
	assert.ok(
		Number.isInteger(quantizer) && quantizer >= 0 && quantizer <= 63,
		"Only the common documented quantizer range is admitted",
	);
	return frames.map((frame) => ({
		...frame,
		options: { ...frame.options, vp9: { quantizer } },
	}));
}

export function createQuantizerCases(baselineConfig, frames) {
	const cases = [
		{
			name: "baseline",
			config: { ...baselineConfig },
			frames,
			expectedPixelFormat: "yuv420p",
		},
	];
	for (const profile of [0, 1]) {
		const config = { ...baselineConfig, codec: PROFILE_CODECS[profile] };
		const expectedPixelFormat = profile === 0 ? "yuv420p" : "yuv444p";
		cases.push({
			name: `profile${profile}-variable-control`,
			profile,
			config,
			frames,
			expectedPixelFormat,
		});
		for (const quantizer of [0, 32, 63])
			cases.push({
				name: `profile${profile}-q${quantizer}`,
				profile,
				quantizer,
				config: { ...config, bitrateMode: "quantizer" },
				frames: withQuantizerFrames(frames, quantizer),
				expectedPixelFormat,
			});
	}
	return cases;
}

export function assertSameFrameContent(actual, baseline) {
	assert.equal(actual.length, baseline.length);
	for (let index = 0; index < actual.length; index++) {
		const { options: actualOptions, ...actualFrame } = actual[index];
		const { options: expectedOptions, ...expectedFrame } = baseline[index];
		assert.deepEqual(
			actualFrame,
			expectedFrame,
			"Quantizer experiment changed a source frame or timestamp",
		);
		const { vp9, ...rest } = actualOptions;
		assert.deepEqual(
			rest,
			expectedOptions,
			"Quantizer experiment changed original non-VP9 encode options",
		);
	}
}

export function assertActualQuantizerOptions(evidence, testCase) {
	assert.deepEqual(evidence.actualConfigure, testCase.config);
	assert.equal(evidence.actualEncodeOptions.length, testCase.frames.length);
	for (const [index, record] of evidence.actualEncodeOptions.entries()) {
		assert.equal(record.timestamp, testCase.frames[index].timestamp);
		assert.deepEqual(record.options, testCase.frames[index].options);
	}
	if (testCase.quantizer !== undefined)
		assert.equal(
			evidence.support.config.bitrateMode,
			"quantizer",
			"Capability query dropped the quantizer mode",
		);
}

export function quantizerContrasts(results) {
	return [0, 1].map((profile) => {
		const cases = [0, 32, 63].map((q) =>
			results.find((entry) => entry.name === `profile${profile}-q${q}`),
		);
		if (cases.some((entry) => !entry?.supported || entry.error))
			return {
				profile,
				controlEstablished: false,
				reason:
					"At least one requested quantizer value is unsupported or failed; no fallback",
			};
		const [low, middle, high] = cases;
		const bitstreamChanged =
			JSON.stringify(low.packetHashes) !== JSON.stringify(high.packetHashes);
		const decodedPixelsChanged = low.ffmpegRgbSha256 !== high.ffmpegRgbSha256;
		return {
			profile,
			controlEstablished: bitstreamChanged && decodedPixelsChanged,
			bitstreamChanged,
			decodedPixelsChanged,
			q0PassesOriginalFfmpegGate: low.ffmpegAllFramesUnderOriginalGate,
			q0PassesOriginalChromiumGate: low.chromiumAllFramesUnderOriginalGate,
			quantizers: [low, middle, high].map((entry) => ({
				quantizer: entry.quantizer,
				encodedPayloadBytes: entry.encodedPayloadBytes,
				ffmpegMae: entry.observations.map(
					(row) => row.ffmpegToOracle.interiorRgbMae,
				),
				chromiumMae: entry.observations.map(
					(row) => row.chromiumToOracle.interiorRgbMae,
				),
			})),
		};
	});
}
