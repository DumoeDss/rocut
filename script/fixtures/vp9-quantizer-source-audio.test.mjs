import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIO, audioSamples } from "./vp9-quantizer-source-cases.mjs";
import {
	analyseCompanionAudio,
	pcmFloat32,
} from "./vp9-quantizer-source-audio.mjs";

test("unshifted fixed input plus retained zero padding passes without changing the oracle", () => {
	const decoded = new Float32Array(AUDIO.frames + 648);
	decoded.set(audioSamples());
	const result = analyseCompanionAudio(decoded);
	assert.equal(result.passed, true);
	assert.equal(result.bestLagSamples, 0);
	assert.equal(result.tailPaddingSamples, 648);
	assert.equal(result.tailRms, 0);
	assert.equal(result.decodedActivity.trailingInactiveSamples, 648);
});
test("10ms displaced content fails even when a searched lag matches exactly", () => {
	const decoded = new Float32Array(AUDIO.frames + 648);
	decoded.set(audioSamples(), 480);
	const result = analyseCompanionAudio(decoded);
	assert.equal(result.passed, false);
	assert.equal(result.bestLagSamples, 480);
	assert.ok(result.bestLagCorrelation > 0.999999);
	assert.equal(result.decodedActivity.leadingInactiveSamples, 480);
});
test("unknown non-silent tail remains measurable instead of being cropped", () => {
	const decoded = new Float32Array(AUDIO.frames + 648);
	decoded.set(audioSamples());
	decoded.fill(0.5, AUDIO.frames);
	const result = analyseCompanionAudio(decoded);
	assert.equal(result.passed, false);
	assert.equal(result.tailRms, 0.5);
	assert.equal(result.decodedSamples, AUDIO.frames + 648);
	assert.equal(result.decodedActivity.trailingInactiveSamples, 0);
});
test("PCM conversion preserves exact little-endian floats from a sliced Buffer", () => {
	const bytes = Buffer.alloc(12);
	bytes.writeFloatLE(0.25, 4);
	bytes.writeFloatLE(-0.5, 8);
	assert.deepEqual([...pcmFloat32(bytes.subarray(4))], [0.25, -0.5]);
});
