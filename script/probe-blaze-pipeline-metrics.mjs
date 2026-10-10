import assert from "node:assert/strict";
import { blazePipelineCodecThresholds as thresholds } from "./probe-blaze-pipeline-contract.mjs";

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
function near(actual, expected, label) {
	assert(
		Math.abs(actual - expected) <= thresholds.exportTimestampSeconds,
		`Incorrect ${label}`,
	);
}
function timingSequence(items, metadata, kind, timestampKey, durationKey) {
	assert.equal(items.length, metadata.frames, `Wrong ${kind} count`);
	const result = items.map((item, index) => {
		const timestamp = seconds(item[timestampKey], `${kind} ${index} timestamp`);
		const duration = seconds(
			item[durationKey],
			`${kind} ${index} duration`,
			true,
		);
		near(timestamp, index / metadata.fps, `${kind} ${index} timestamp`);
		near(duration, 1 / metadata.fps, `${kind} ${index} duration`);
		if (index)
			assert(
				timestamp >
					seconds(items[index - 1][timestampKey], `previous ${kind} timestamp`),
				`Non-increasing ${kind} timestamps`,
			);
		return {
			index,
			timestamp,
			duration,
			expectedTimestamp: index / metadata.fps,
			expectedDuration: 1 / metadata.fps,
			timelineTicks: metadata.timelineTicks[index],
			localTicks: metadata.localTicks[index],
		};
	});
	const last = result.at(-1),
		end = last.timestamp + last.duration;
	near(end, metadata.frames / metadata.fps, `${kind} final end`);
	return { samples: result, end };
}
export function validateBlazePipelineProbeTiming(probe, metadata) {
	const frameInput = Array.isArray(probe.packets_and_frames)
		? probe.packets_and_frames.filter((entry) => entry.type === "frame")
		: probe.frames;
	const packetInput = Array.isArray(probe.packets_and_frames)
		? probe.packets_and_frames.filter((entry) => entry.type === "packet")
		: probe.packets;
	assert(
		Array.isArray(frameInput) && Array.isArray(packetInput),
		"Missing independently decoded frames or encoded packets",
	);
	const frames = timingSequence(
		frameInput.filter((frame) => frame.media_type === "video"),
		metadata,
		"frame",
		"best_effort_timestamp_time",
		"pkt_duration_time",
	);
	const packets = timingSequence(
		packetInput.filter((packet) => packet.codec_type === "video"),
		metadata,
		"packet",
		"pts_time",
		"duration_time",
	);
	const duration = seconds(probe.format?.duration, "format duration", true),
		expectedDuration = metadata.frames / metadata.fps;
	near(duration, expectedDuration, "format duration");
	near(frames.end, duration, "decoded frame end versus format duration");
	near(packets.end, duration, "encoded packet end versus format duration");
	return {
		frameTiming: frames.samples,
		packetTiming: packets.samples,
		frameEnd: frames.end,
		packetEnd: packets.end,
		formatDuration: duration,
		expectedDuration,
	};
}
export function compareBlazePipelineFrame(actual, expected, baseline) {
	assert(
		actual.length > 0 &&
			actual.length === expected.length &&
			baseline.length === expected.length &&
			expected.length % 4 === 0,
		"Wrong BlazePipeline pixel comparison lengths",
	);
	let sum = 0,
		activeSum = 0,
		activePixels = 0;
	for (let offset = 0; offset < expected.length; offset += 4) {
		for (let channel = 0; channel < 4; channel++)
			sum += Math.abs(actual[offset + channel] - expected[offset + channel]);
		if (
			[0, 1, 2].some(
				(channel) =>
					Math.abs(expected[offset + channel] - baseline[offset + channel]) >
					15,
			)
		) {
			activePixels++;
			for (let channel = 0; channel < 3; channel++)
				activeSum += Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
		}
	}
	const meanRgba = sum / expected.length,
		activeRgb = activePixels ? activeSum / (activePixels * 3) : null;
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
export function compareBlazePipelineSequence(
	decoded,
	expected,
	baseline,
	stride,
	frames,
) {
	assert(
		Number.isSafeInteger(stride) && stride > 0 && stride % 4 === 0,
		"Invalid BlazePipeline frame stride",
	);
	assert(
		Number.isSafeInteger(frames) && frames > 0,
		"Invalid BlazePipeline frame count",
	);
	assert.equal(decoded.length, stride * frames);
	assert.equal(expected.length, stride * frames);
	assert.equal(baseline.length, stride);
	const first = expected.subarray(0, stride);
	const metrics = Array.from({ length: frames }, (_, frame) => {
		const reference = expected.subarray(frame * stride, (frame + 1) * stride);
		return {
			frame,
			actual: compareBlazePipelineFrame(
				decoded.subarray(frame * stride, (frame + 1) * stride),
				reference,
				baseline,
			),
			baseline: compareBlazePipelineFrame(baseline, reference, baseline),
			repeatedFirst: compareBlazePipelineFrame(first, reference, baseline),
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
