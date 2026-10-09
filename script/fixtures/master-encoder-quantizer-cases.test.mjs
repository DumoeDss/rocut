import assert from "node:assert/strict";
import test from "node:test";
import {
	createQuantizerCases,
	withQuantizerFrames,
	assertSameFrameContent,
	assertActualQuantizerOptions,
	quantizerContrasts,
} from "./master-encoder-quantizer-cases.mjs";

const config = {
	codec: "vp09.00.10.08",
	bitrate: 56000,
	width: 96,
	height: 64,
};
const frames = [
	{
		timestamp: 0,
		duration: 33333,
		bytes: [1, 2, 3, 255],
		options: { keyFrame: true },
	},
];
test("all nine cases preserve source bytes/timing and original keyframe options", () => {
	const snapshot = structuredClone({ config, frames });
	const cases = createQuantizerCases(config, frames);
	assert.equal(cases.length, 9);
	assert.deepEqual(cases[0].config, config);
	assert.equal(cases[0].frames, frames);
	for (const entry of cases) assertSameFrameContent(entry.frames, frames);
	assert.deepEqual({ config, frames }, snapshot);
	assert.deepEqual(
		cases
			.filter((entry) => entry.profile === 1 && entry.quantizer !== undefined)
			.map((entry) => entry.quantizer),
		[0, 32, 63],
	);
});
test("case construction refuses values outside the common documented range", () => {
	for (const q of [-1, 64, 255, 1.5, NaN])
		assert.throws(() => withQuantizerFrames(frames, q));
});
test("content/timing changes cannot be disguised as a quality-option experiment", () => {
	const mutated = withQuantizerFrames(frames, 0);
	mutated[0].timestamp++;
	assert.throws(
		() => assertSameFrameContent(mutated, frames),
		/source frame or timestamp/,
	);
});
test("actual mode and every submitted per-frame option must match the requested experiment", () => {
	const entry = createQuantizerCases(config, frames).find(
		(row) => row.name === "profile1-q0",
	);
	const evidence = {
		actualConfigure: entry.config,
		actualEncodeOptions: entry.frames.map((frame) => ({
			timestamp: frame.timestamp,
			options: frame.options,
		})),
		support: { config: { bitrateMode: "quantizer" } },
	};
	assertActualQuantizerOptions(evidence, entry);
	evidence.support.config.bitrateMode = "variable";
	assert.throws(
		() => assertActualQuantizerOptions(evidence, entry),
		/dropped the quantizer mode/,
	);
});
test("capability success alone cannot claim a working quantizer if q0/q63 output is identical", () => {
	const results = [0, 32, 63].map((quantizer) => ({
		name: `profile1-q${quantizer}`,
		supported: true,
		quantizer,
		packetHashes: ["same"],
		ffmpegRgbSha256: "same",
		observations: [],
		encodedPayloadBytes: 100,
	}));
	assert.equal(quantizerContrasts(results)[1].controlEstablished, false);
	results[2].packetHashes = ["different"];
	results[2].ffmpegRgbSha256 = "different";
	assert.equal(quantizerContrasts(results)[1].controlEstablished, true);
	assert.equal(quantizerContrasts(results)[0].controlEstablished, false);
});
