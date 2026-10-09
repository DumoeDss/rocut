import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const editorExportThresholds = Object.freeze({
	meanRgb: 10,
	effectRgb: 15,
	effectPixels: 64,
	timestamp: 0.0011,
});

export function rgbMetric(actual, expected, baseline) {
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
		metric.meanRgb <= editorExportThresholds.meanRgb &&
		metric.effectRgb <= editorExportThresholds.effectRgb &&
		metric.effectPixels >= editorExportThresholds.effectPixels
	);
}

function ffmpeg(directory, name, args, text = false) {
	return execFileSync(join(directory, name), args, {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024,
		...(text ? { encoding: "utf8" } : {}),
	});
}
function pixels(directory, file, frame = 0) {
	const result = ffmpeg(directory, "ffmpeg.exe", [
		"-v",
		"error",
		"-i",
		file,
		"-vf",
		`select=eq(n\\,${frame})`,
		"-frames:v",
		"1",
		"-pix_fmt",
		"rgb24",
		"-f",
		"rawvideo",
		"pipe:1",
	]);
	assert.equal(result.length, 640 * 360 * 3);
	return result;
}

export async function checkEditorReferences(
	artifacts,
	directory,
	references,
	baselineName,
) {
	assert.equal(references.length, 6);
	const baseline = pixels(directory, join(artifacts, baselineName));
	const expected = references.map((frame) =>
		pixels(directory, join(artifacts, frame.name)),
	);
	const noEffect = expected.map((frame) =>
		rgbMetric(baseline, frame, baseline),
	);
	const repeatedFirst = expected.map((frame) =>
		rgbMetric(expected[0], frame, baseline),
	);
	const sensitivity = {
		thresholds: editorExportThresholds,
		noEffect,
		repeatedFirst,
		noEffectRejected: noEffect.some((metric) => !acceptsMetric(metric)),
		repeatedFirstRejected: repeatedFirst
			.slice(1)
			.some((metric) => !acceptsMetric(metric)),
	};
	await writeFile(
		join(artifacts, "export-counterfactuals.json"),
		JSON.stringify(sensitivity, null, 2),
		{ flag: "wx" },
	);
	assert(
		expected.every(
			(frame) =>
				rgbMetric(frame, frame, baseline).effectPixels >=
				editorExportThresholds.effectPixels,
		),
		"Every export reference needs effect-specific active pixels",
	);
	assert(
		sensitivity.noEffectRejected,
		"Chosen thresholds cannot reject an export that drops Droplets",
	);
	assert(
		sensitivity.repeatedFirstRejected,
		"Chosen thresholds cannot reject repeated first frame",
	);
	return sensitivity;
}

export async function decodeDropletsEditorExport(
	video,
	artifacts,
	directory,
	references,
	baselineName,
) {
	const metadata = JSON.parse(
		ffmpeg(
			directory,
			"ffprobe.exe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-show_frames",
				"-of",
				"json",
				video,
			],
			true,
		),
	);
	assert.equal(metadata.streams.length, 1);
	const stream = metadata.streams[0];
	assert.equal(stream.codec_name, "vp9");
	assert.equal(stream.width, 640);
	assert.equal(stream.height, 360);
	assert.equal(stream.nb_read_frames, "6");
	assert.equal(stream.r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - 0.2) < 0.01);
	assert.equal(metadata.frames.length, 6);
	metadata.frames.forEach((frame, index) =>
		assert(
			Math.abs(Number(frame.best_effort_timestamp_time) - index / 30) <=
				editorExportThresholds.timestamp,
		),
	);
	const baseline = pixels(directory, join(artifacts, baselineName));
	const metrics = references.map((sample) => {
		const expected = pixels(directory, join(artifacts, sample.name));
		const actual = pixels(directory, video, sample.frame);
		const metric = {
			frame: sample.frame,
			ticks: sample.ticks,
			...rgbMetric(actual, expected, baseline),
		};
		assert(acceptsMetric(metric), JSON.stringify(metric));
		return metric;
	});
	ffmpeg(directory, "ffmpeg.exe", [
		"-v",
		"error",
		"-n",
		"-i",
		video,
		"-vf",
		"scale=320:180,tile=3x2",
		"-frames:v",
		"1",
		join(artifacts, "export-contact-sheet.png"),
	]);
	return {
		decoder: "independent FFmpeg/FFprobe",
		metadata,
		thresholds: editorExportThresholds,
		metrics,
		reference:
			"Complete neutral UI preview; effect mask is measured against same unfiltered imported image, not non-background source detail",
		videoSha256: createHash("sha256")
			.update(await readFile(video))
			.digest("hex"),
	};
}
