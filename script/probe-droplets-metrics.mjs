import assert from "node:assert/strict";
import { dropletsCodecThresholds as thresholds } from "./probe-droplets-pipeline-artifacts.mjs";

function seconds(value, label, positive = false) {
	assert(
		(typeof value === "string" && value.trim() !== "") ||
			typeof value === "number",
		`Missing ${label}`,
	);
	const result = Number(value);
	assert(
		Number.isFinite(result) && (!positive || result > 0),
		`Invalid ${label}`,
	);
	return result;
}
export function validateDropletsProbeTiming(probe, metadata) {
	const frameInfo = probe.frames.filter(
		(frame) => frame.media_type === "video",
	);
	assert.equal(frameInfo.length, metadata.frames);
	const expectedDuration = metadata.frames / metadata.fps;
	const formatDuration = seconds(
		probe.format?.duration,
		"format duration",
		true,
	);
	assert(
		Math.abs(formatDuration - expectedDuration) <=
			thresholds.exportTimestampSeconds,
		"Incorrect total format duration",
	);
	const timestamps = frameInfo.map((frame, index) => {
		const actual = seconds(
			frame.best_effort_timestamp_time,
			`timestamp at frame ${index}`,
		);
		const expected = index / metadata.fps;
		assert(
			Math.abs(actual - expected) <= thresholds.exportTimestampSeconds,
			`Incorrect timestamp at frame ${index}`,
		);
		if (index)
			assert(
				actual >
					seconds(
						frameInfo[index - 1].best_effort_timestamp_time,
						"previous timestamp",
					),
				"Non-increasing timestamps",
			);
		const packetDuration = seconds(
			frame.pkt_duration_time,
			`packet duration at frame ${index}`,
			true,
		);
		assert(
			Math.abs(packetDuration - 1 / metadata.fps) <=
				thresholds.exportTimestampSeconds,
			`Incorrect packet duration at frame ${index}`,
		);
		return {
			frame: index,
			actual,
			expected,
			packetDuration,
			expectedPacketDuration: 1 / metadata.fps,
			timelineTicks: metadata.timelineTicks[index],
			localTicks: metadata.localTicks[index],
		};
	});
	const last = timestamps.at(-1),
		packetEndDuration = last.actual + last.packetDuration;
	assert(
		Math.abs(packetEndDuration - expectedDuration) <=
			thresholds.exportTimestampSeconds,
		"Incorrect final packet end time",
	);
	assert(
		Math.abs(packetEndDuration - formatDuration) <=
			thresholds.exportTimestampSeconds,
		"Packet end disagrees with format duration",
	);
	return { timestamps, formatDuration, expectedDuration, packetEndDuration };
}

export function compareDropletsFrame(actual, expected, baseline) {
	assert(
		actual.length === expected.length &&
			baseline.length === expected.length &&
			expected.length % 4 === 0,
		"Wrong pixel comparison lengths",
	);
	let total = 0,
		activeTotal = 0,
		activePixels = 0;
	for (let offset = 0; offset < expected.length; offset += 4) {
		for (let channel = 0; channel < 4; channel++)
			total += Math.abs(actual[offset + channel] - expected[offset + channel]);
		// This mask is reference/source-derived, never based on decoded error.
		if (
			[0, 1, 2].some(
				(channel) =>
					Math.abs(expected[offset + channel] - baseline[offset + channel]) >
					15,
			)
		) {
			activePixels++;
			for (let channel = 0; channel < 3; channel++)
				activeTotal += Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
		}
	}
	const meanRgba = total / expected.length;
	const activeRgb = activePixels ? activeTotal / (activePixels * 3) : null;
	return {
		meanRgba,
		activeRgb,
		activePixels,
		pass:
			meanRgba <= thresholds.exportMeanRgba &&
			activeRgb !== null &&
			activeRgb <= thresholds.exportActiveRgb &&
			activePixels >= thresholds.exportMinimumActivePixels,
	};
}

export function compareDropletsSequence(
	decoded,
	expected,
	baseline,
	stride,
	frames,
) {
	assert.equal(decoded.length, frames * stride);
	assert.equal(expected.length, frames * stride);
	assert.equal(baseline.length, stride);
	const first = expected.subarray(0, stride);
	const metrics = Array.from({ length: frames }, (_, frame) => {
		const reference = expected.subarray(frame * stride, (frame + 1) * stride);
		return {
			frame,
			actual: compareDropletsFrame(
				decoded.subarray(frame * stride, (frame + 1) * stride),
				reference,
				baseline,
			),
			baseline: compareDropletsFrame(baseline, reference, baseline),
			repeatedFirst: compareDropletsFrame(first, reference, baseline),
		};
	});
	return {
		metrics,
		actualPassed: metrics.every((metric) => metric.actual.pass),
		baselineRejectedFrames: metrics
			.filter((metric) => !metric.baseline.pass)
			.map((metric) => metric.frame),
		repeatedFirstRejectedFrames: metrics
			.filter((metric) => !metric.repeatedFirst.pass)
			.map((metric) => metric.frame),
	};
}
