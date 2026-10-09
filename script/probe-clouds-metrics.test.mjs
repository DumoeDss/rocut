import assert from "node:assert/strict";
import test from "node:test";
import {
	compareCloudsFrame,
	compareCloudsSequence,
	validateCloudsProbeTiming,
} from "./probe-clouds-metrics.mjs";
import {
	cloudsTestMetadata,
	cloudsTestPixels,
	cloudsTestProbe,
} from "./probe-clouds-test-support.mjs";

test("Clouds fixed codec gates reject baseline and repeated-first sequences", () => {
	const baseline = cloudsTestPixels(128),
		frames = Array.from({ length: 6 }, (_, index) =>
			cloudsTestPixels(128, 32 * (index + 1)),
		),
		expected = Buffer.concat(frames);
	const good = compareCloudsSequence(
		expected,
		expected,
		baseline,
		baseline.length,
		6,
	);
	assert.equal(good.actualPassed, true);
	assert.deepEqual(good.baselineRejectedFrames, [0, 1, 2, 3, 4, 5]);
	assert.deepEqual(good.repeatedFirstRejectedFrames, [1, 2, 3, 4, 5]);
	assert.equal(
		compareCloudsSequence(
			Buffer.concat(Array(6).fill(baseline)),
			expected,
			baseline,
			baseline.length,
			6,
		).actualPassed,
		false,
	);
	assert.equal(
		compareCloudsSequence(
			Buffer.concat(Array(6).fill(frames[0])),
			expected,
			baseline,
			baseline.length,
			6,
		).actualPassed,
		false,
	);
	assert.throws(() =>
		compareCloudsSequence(
			expected.subarray(4),
			expected,
			baseline,
			baseline.length,
			6,
		),
	);
});
test("Clouds 10/15/64 gates and source-derived active mask are fixed", () => {
	const baseline = cloudsTestPixels(512),
		expected = Buffer.from(baseline);
	expected.set(cloudsTestPixels(64, 128), 0);
	const actual = Buffer.from(expected);
	actual.set(cloudsTestPixels(64, 143), 0);
	assert.equal(compareCloudsFrame(actual, expected, baseline).pass, true);
	actual.set(cloudsTestPixels(64, 144), 0);
	const error = compareCloudsFrame(actual, expected, baseline);
	assert.equal(error.activeRgb, 16);
	assert.equal(error.activePixels, 64);
	assert(error.meanRgba < 10);
	assert.equal(error.pass, false);
	const few = Buffer.from(baseline);
	few.set(cloudsTestPixels(63, 128), 0);
	assert.equal(compareCloudsFrame(few, few, baseline).pass, false);
	assert.equal(
		compareCloudsFrame(baseline, baseline, baseline).activeRgb,
		null,
	);
	const full = cloudsTestPixels(128, 128),
		black = cloudsTestPixels(128);
	assert.equal(
		compareCloudsFrame(cloudsTestPixels(128, 141), full, black).pass,
		true,
	);
	assert.equal(
		compareCloudsFrame(cloudsTestPixels(128, 142), full, black).pass,
		false,
	);
	assert.throws(() =>
		compareCloudsFrame(Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)),
	);
});
test("Clouds accepts separately listed and FFprobe combined packet/frame timing", () => {
	const metadata = cloudsTestMetadata(),
		probe = cloudsTestProbe();
	const separated = validateCloudsProbeTiming(probe, metadata);
	assert.equal(separated.frameEnd, 0.2);
	assert.equal(separated.packetEnd, 0.2);
	assert.equal(separated.formatDuration, 0.2);
	const combined = {
		format: probe.format,
		packets_and_frames: probe.frames.flatMap((frame, index) => [
			probe.packets[index],
			frame,
		]),
	};
	assert.deepEqual(validateCloudsProbeTiming(combined, metadata), separated);
});
for (const name of [
	"missingFrameDuration",
	"zeroPacketDuration",
	"wrongPacketDuration",
	"duplicatePts",
	"missingPacket",
	"wrongFormatDuration",
	"nanTimestamp",
	"missingFrames",
])
	test(`Clouds independent timing rejects ${name}`, () => {
		const probe = cloudsTestProbe();
		if (name === "missingFrameDuration")
			delete probe.frames[0].pkt_duration_time;
		if (name === "zeroPacketDuration") probe.packets[0].duration_time = "0";
		if (name === "wrongPacketDuration")
			probe.packets[0].duration_time = "0.020";
		if (name === "duplicatePts")
			probe.packets[1].pts_time = probe.packets[0].pts_time;
		if (name === "missingPacket") probe.packets.pop();
		if (name === "wrongFormatDuration") probe.format.duration = "0.167";
		if (name === "nanTimestamp")
			probe.frames[0].best_effort_timestamp_time = "NaN";
		if (name === "missingFrames") delete probe.frames;
		assert.throws(() => validateCloudsProbeTiming(probe, cloudsTestMetadata()));
	});
