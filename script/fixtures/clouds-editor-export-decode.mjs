import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	acceptsMetric,
	editorExportThresholds,
	rgbMetric,
	validateVideoMetadata,
} from "./clouds-editor-metrics.mjs";

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
		"Chosen thresholds cannot reject an export that drops Clouds",
	);
	assert(
		sensitivity.repeatedFirstRejected,
		"Chosen thresholds cannot reject repeated first frame",
	);
	return sensitivity;
}

export async function decodeCloudsEditorExport(
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
	const timing = validateVideoMetadata(metadata);
	const baseline = pixels(directory, join(artifacts, baselineName));
	const expected = references.map((sample) =>
		pixels(directory, join(artifacts, sample.name)),
	);
	const decoded = references.map((sample) =>
		pixels(directory, video, sample.frame),
	);
	const metrics = references.map((sample, index) => ({
		frame: sample.frame,
		ticks: sample.ticks,
		...rgbMetric(decoded[index], expected[index], baseline),
	}));
	const repeatedDecoded = expected.map((frame) =>
		rgbMetric(decoded[0], frame, baseline),
	);
	const report = {
		decoder: "independent default FFmpeg/FFprobe",
		metadata,
		timing,
		thresholds: editorExportThresholds,
		metrics,
		repeatedDecoded,
		repeatedDecodedRejected: repeatedDecoded
			.slice(1)
			.some((metric) => !acceptsMetric(metric)),
		reference:
			"Complete neutral UI preview; effect mask is measured against the same unfiltered imported image",
		videoSha256: createHash("sha256")
			.update(await readFile(video))
			.digest("hex"),
	};
	await writeFile(
		join(artifacts, "export-decode.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	assert(metrics.every(acceptsMetric), JSON.stringify(metrics));
	assert(
		report.repeatedDecodedRejected,
		"Decoded first-frame repetition evades sequence validation",
	);
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
	return report;
}
