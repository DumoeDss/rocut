import assert from "node:assert/strict";
import test from "node:test";
import {
	compareDropletsFrame,
	compareDropletsSequence,
	validateDropletsProbeTiming,
} from "./probe-droplets-metrics.mjs";
import {
	dropletsCodecThresholds,
	validateDropletsMedia,
} from "./probe-droplets-pipeline-artifacts.mjs";
import { decodeFrame } from "./probe-droplets-artifacts.mjs";

function metadata() {
	return {
		width: 8,
		height: 8,
		frames: 6,
		fps: 30,
		codec: "vp9",
		mimeType: "video/webm",
		timelineTicks: [60000, 64000, 68000, 72000, 76000, 80000],
		localTicks: [48000, 52000, 56000, 60000, 64000, 68000],
		paramsPerFrame: Array.from({ length: 6 }, () => ({ amount: 1 })),
		thresholds: { ...dropletsCodecThresholds },
		reference: "Synthetic independent CPU test",
	};
}
function constant(red) {
	return Buffer.from(Array.from({ length: 64 }, () => [red, 0, 0, 255]).flat());
}
test("schema keeps exact thresholds and timeline/local ordering", () => {
	assert.equal(validateDropletsMedia(metadata()).frames, 6);
	const relaxed = metadata();
	relaxed.thresholds.exportActiveRgb = 16;
	assert.throws(() => validateDropletsMedia(relaxed), /Threshold changed/);
	const shuffled = metadata();
	[shuffled.localTicks[1], shuffled.localTicks[2]] = [
		shuffled.localTicks[2],
		shuffled.localTicks[1],
	];
	assert.throws(() => validateDropletsMedia(shuffled), /codec order/);
	const offset = metadata();
	offset.timelineTicks = offset.timelineTicks.map(
		(value, index) => value + (index ? 1 : 0),
	);
	assert.throws(() => validateDropletsMedia(offset), /codec order/);
});
test("canonical base64 and frame sizes reject corruption", () => {
	const pixel = Buffer.from([1, 2, 3, 255]);
	assert.deepEqual(decodeFrame(pixel.toString("base64"), 4), pixel);
	assert.throws(
		() => decodeFrame(pixel.toString("base64"), 8),
		/length mismatch/,
	);
	assert.throws(() => decodeFrame("AQID/w", 4), /Non-canonical/);
});
test("independent sequence gates reject baseline and repeated-first outputs", () => {
	const baseline = constant(0);
	const expected = Buffer.concat([60, 92, 124, 156, 188, 220].map(constant));
	const result = compareDropletsSequence(
		expected,
		expected,
		baseline,
		baseline.length,
		6,
	);
	assert(result.actualPassed);
	assert.equal(result.baselineRejectedFrames.length, 6);
	assert.deepEqual(result.repeatedFirstRejectedFrames, [2, 3, 4, 5]);
	const stale = Buffer.concat(Array(6).fill(baseline));
	assert.equal(
		compareDropletsSequence(stale, expected, baseline, baseline.length, 6)
			.actualPassed,
		false,
	);
	const repeated = Buffer.concat(
		Array(6).fill(expected.subarray(0, baseline.length)),
	);
	assert.equal(
		compareDropletsSequence(repeated, expected, baseline, baseline.length, 6)
			.actualPassed,
		false,
	);
});
test("empty or undersized active masks cannot make video pass", () => {
	const baseline = constant(0);
	assert.equal(compareDropletsFrame(baseline, baseline, baseline).pass, false);
	const sparse = Buffer.from(baseline);
	sparse[0] = 255;
	assert.equal(compareDropletsFrame(sparse, sparse, baseline).activePixels, 1);
	assert.equal(compareDropletsFrame(sparse, sparse, baseline).pass, false);
});

function probeMetadata() {
	return {
		format: { duration: "0.200000" },
		frames: Array.from({ length: 6 }, (_, index) => ({
			media_type: "video",
			best_effort_timestamp_time: (index / 30).toFixed(3),
			pkt_duration_time: "0.033000",
		})),
	};
}
test("codec timing accepts quantized 30 fps and records all packet durations", () => {
	const timing = validateDropletsProbeTiming(probeMetadata(), metadata());
	assert.equal(timing.formatDuration, 0.2);
	assert.equal(timing.packetEndDuration, 0.2);
	assert.equal(timing.timestamps.length, 6);
});
test("codec timing rejects prolonged final packet even with normal PTS and format duration", () => {
	const probe = probeMetadata();
	probe.frames[5].pkt_duration_time = "1.033";
	assert.throws(
		() => validateDropletsProbeTiming(probe, metadata()),
		/Incorrect packet duration at frame 5/,
	);
});
test("codec timing rejects wrong or unknown total duration and missing packet duration", () => {
	for (const duration of ["0.250", "N/A", "", undefined, null]) {
		const probe = probeMetadata();
		probe.format.duration = duration;
		assert.throws(
			() => validateDropletsProbeTiming(probe, metadata()),
			/format duration/,
		);
	}
	for (const duration of ["N/A", "", undefined, null]) {
		const probe = probeMetadata();
		probe.frames[5].pkt_duration_time = duration;
		assert.throws(
			() => validateDropletsProbeTiming(probe, metadata()),
			/packet duration at frame 5/,
		);
	}
});
