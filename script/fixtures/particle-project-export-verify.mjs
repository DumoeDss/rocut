import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeCommand, writeJson } from "../particle-c4-export-support.mjs";
import {
	PROJECT_EXPORT_LIMITS,
	projectPixelMetrics,
	acceptsProjectPixels,
} from "./particle-project-export-pixels.mjs";

export async function verifyProjectVideo({
	root,
	ffmpeg,
	ffprobe,
	width,
	height,
	references,
	negativeControls,
}) {
	const video = join(root, "particle.webm");
	const probe = await nativeCommand(
		ffprobe,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames:format=duration:frame=best_effort_timestamp_time",
			"-of",
			"json",
			video,
		],
		root,
		"ffprobe",
	);
	const metadata = JSON.parse(probe.output),
		stream = metadata.streams?.[0];
	assert.equal(metadata.streams?.length, 1);
	assert.equal(stream.width, width);
	assert.equal(stream.height, height);
	assert.equal(Number(stream.nb_read_frames), 6);
	for (const key of ["r_frame_rate", "avg_frame_rate"]) {
		const [n, d] = String(stream[key]).split("/").map(Number);
		assert.ok(d > 0 && n / d === 30);
	}
	assert.ok(
		Math.abs(Number(metadata.format.duration) - 0.2) <= 0.001 + Number.EPSILON,
	);
	assert.equal(metadata.frames?.length, 6);
	for (const [index, frame] of metadata.frames.entries())
		assert.ok(
			Math.abs(Number(frame.best_effort_timestamp_time) - index / 30) <=
				PROJECT_EXPORT_LIMITS.timestampToleranceSeconds + Number.EPSILON,
			`FFprobe timestamp mismatch ${index}`,
		);
	const decodedFile = join(root, "decoded.rgba");
	const decode = await nativeCommand(
		ffmpeg,
		[
			"-v",
			"error",
			"-nostdin",
			"-n",
			"-i",
			video,
			"-map",
			"0:v:0",
			"-fps_mode",
			"passthrough",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			decodedFile,
		],
		root,
		"ffmpeg-decode",
	);
	const rgba = await readFile(decodedFile),
		frameBytes = width * height * 4;
	assert.equal(rgba.length, frameBytes * 6);
	assert.equal(references.length, 6);
	const frames = references.map((reference, index) => {
		assert.equal(reference.index, index);
		assert.equal(reference.rgba.length, frameBytes);
		const metrics = projectPixelMetrics(
			rgba.subarray(index * frameBytes, (index + 1) * frameBytes),
			reference.rgba,
		);
		return {
			index,
			timeTicks: reference.timeTicks,
			expectedActive: reference.expectedActive,
			...metrics,
			accepted: acceptsProjectPixels(metrics, reference.expectedActive),
		};
	});
	const negatives = negativeControls.map((control) => {
		const actual = rgba.subarray(
			control.index * frameBytes,
			(control.index + 1) * frameBytes,
		);
		const decodedAgainstWrongReference = projectPixelMetrics(
			actual,
			control.rgba,
			references[control.index].rgba,
		);
		// Placement-ignored reference is black; compare against the active real frame
		// with the active mask still defined by the authoritative saved-project reference.
		const wrongAgainstDecoded = projectPixelMetrics(
			control.rgba,
			actual,
			references[control.index].rgba,
		);
		return {
			kind: control.kind,
			index: control.index,
			decodedAgainstWrongReference,
			wrongAgainstDecoded,
			rejected:
				!acceptsProjectPixels(decodedAgainstWrongReference, true) &&
				!acceptsProjectPixels(wrongAgainstDecoded, true),
		};
	});
	const result = {
		metadata,
		width,
		height,
		frameCount: 6,
		durationSeconds: Number(metadata.format.duration),
		limits: PROJECT_EXPORT_LIMITS,
		frames,
		negativeControls: negatives,
		ffprobeLifecycle: probe.lifecycle,
		ffmpegLifecycle: decode.lifecycle,
		scope:
			"Independent FFmpeg decode, exact saved-timeline timestamps relative to export start, same fixed pixel predicate; wrong opacity/placement/trim references must be rejected",
	};
	await writeJson(join(root, "decode-verification.json"), result);
	assert.ok(
		frames.every((frame) => frame.accepted),
		"Decoded saved-project pixels exceeded immutable thresholds",
	);
	assert.ok(
		negatives.length > 0 && negatives.every((control) => control.rejected),
		"A semantic negative control was not rejected after independent decode",
	);
	return result;
}
