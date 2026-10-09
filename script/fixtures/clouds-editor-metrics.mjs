import assert from "node:assert/strict";

export const editorExportThresholds = Object.freeze({
	meanRgb: 10,
	effectRgb: 15,
	effectPixels: 64,
	timestamp: 0.0011,
});

export function rgbMetric(actual, expected, baseline) {
	assert(actual.length > 0 && actual.length % 3 === 0, "Invalid RGB buffer");
	assert.equal(actual.length, expected.length);
	assert.equal(actual.length, baseline.length);
	let total = 0,
		effectTotal = 0,
		effectPixels = 0;
	for (let index = 0; index < actual.length; index += 3) {
		const active = [0, 1, 2].some(
			(channel) =>
				Math.abs(expected[index + channel] - baseline[index + channel]) > 15,
		);
		if (active) effectPixels++;
		for (let channel = 0; channel < 3; channel++) {
			const error = Math.abs(
				actual[index + channel] - expected[index + channel],
			);
			total += error;
			if (active) effectTotal += error;
		}
	}
	return {
		meanRgb: total / actual.length,
		effectRgb: effectPixels
			? effectTotal / (effectPixels * 3)
			: Number.MAX_VALUE,
		effectPixels,
	};
}

export function acceptsMetric(metric) {
	return (
		[metric.meanRgb, metric.effectRgb, metric.effectPixels].every(
			Number.isFinite,
		) &&
		metric.meanRgb >= 0 &&
		metric.effectRgb >= 0 &&
		Number.isInteger(metric.effectPixels) &&
		metric.meanRgb <= editorExportThresholds.meanRgb &&
		metric.effectRgb <= editorExportThresholds.effectRgb &&
		metric.effectPixels >= editorExportThresholds.effectPixels
	);
}

export function validateVideoMetadata(metadata) {
	assert.equal(metadata.streams.length, 1);
	const stream = metadata.streams[0];
	assert.equal(stream.codec_name, "vp9");
	assert.equal(stream.width, 640);
	assert.equal(stream.height, 360);
	assert.equal(stream.nb_read_frames, "6");
	assert.equal(stream.r_frame_rate, "30/1");
	assert.equal(metadata.frames.length, 6);
	const duration = Number(metadata.format.duration);
	assert(
		Number.isFinite(duration) &&
			Math.abs(duration - 0.2) <= editorExportThresholds.timestamp,
	);
	const frames = metadata.frames.map((frame, index) => {
		const timestamp = Number(frame.best_effort_timestamp_time);
		const duration = Number(frame.pkt_duration_time ?? frame.duration_time);
		assert(
			Number.isFinite(timestamp) &&
				Math.abs(timestamp - index / 30) <= editorExportThresholds.timestamp,
			`Frame ${index} timestamp`,
		);
		assert(
			Number.isFinite(duration) &&
				Math.abs(duration - 1 / 30) <= editorExportThresholds.timestamp,
			`Frame ${index} duration`,
		);
		return { index, timestamp, duration };
	});
	const lastEnd = frames[5].timestamp + frames[5].duration;
	assert(Math.abs(lastEnd - 0.2) <= editorExportThresholds.timestamp);
	return { frames, duration, lastEnd };
}
