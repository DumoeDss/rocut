import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function normalizeLiquidPreview(file, bounds, directory, output) {
	const png = await readFile(file);
	assert.equal(
		png.readUInt32BE(16),
		Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x),
	);
	assert.equal(
		png.readUInt32BE(20),
		Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y),
	);
	// Remove only integer screenshot rounding outside the measured full canvas.
	// The complete visible canvas, including every edge, maps to the native raster.
	const rectangle = [
		bounds.width,
		bounds.height,
		bounds.x - Math.floor(bounds.x),
		bounds.y - Math.floor(bounds.y),
	]
		.map((value) => Math.round(value * 8))
		.join(":");
	const filter = `scale=iw*8:ih*8:flags=bilinear,crop=${rectangle},scale=640:360:flags=bicubic`;
	execFileSync(
		join(directory, "ffmpeg.exe"),
		["-v", "error", "-n", "-i", file, "-vf", filter, "-frames:v", "1", output],
		{ windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
	);
	const rgba = execFileSync(
		join(directory, "ffmpeg.exe"),
		[
			"-v",
			"error",
			"-i",
			output,
			"-frames:v",
			"1",
			"-pix_fmt",
			"rgba",
			"-f",
			"rawvideo",
			"pipe:1",
		],
		{ windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
	);
	return { rgba, filter };
}

export async function decodeLiquidEditorExport(
	video,
	artifacts,
	directory,
	references,
) {
	const run = (name, args, encoding) =>
		execFileSync(join(directory, name), args, {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 8 * 1024 * 1024,
			...(encoding ? { encoding } : {}),
		});
	const metadata = JSON.parse(
		run(
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
			"utf8",
		),
	);
	assert.equal(metadata.streams.length, 1);
	const track = metadata.streams[0];
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.width, 640);
	assert.equal(track.height, 360);
	assert.equal(track.nb_read_frames, "6");
	assert.equal(track.r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - 0.2) < 0.01);
	assert.equal(metadata.frames.length, 6);
	metadata.frames.forEach((frame, index) =>
		assert(
			Math.abs(Number(frame.best_effort_timestamp_time) - index / 30) < 0.0011,
		),
	);
	const pixels = (file, frame = 0) =>
		run("ffmpeg.exe", [
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
	const metrics = [],
		decoded = [];
	const thresholds = {
		meanRgb: 10,
		activeRgb: 15,
		activePixels: 2000,
		progression: 0.25,
	};
	for (const sample of references) {
		const expected = pixels(join(artifacts, sample.name));
		const actual = pixels(video, sample.frame);
		assert.equal(expected.length, 640 * 360 * 3);
		assert.equal(actual.length, expected.length);
		decoded.push(actual);
		let absolute = 0,
			activeAbsolute = 0,
			activePixels = 0;
		for (let index = 0; index < actual.length; index += 3) {
			const active = [32, 48, 64].some(
				(background, channel) =>
					Math.abs(expected[index + channel] - background) > 15,
			);
			if (active) activePixels++;
			for (let channel = 0; channel < 3; channel++) {
				const error = Math.abs(
					actual[index + channel] - expected[index + channel],
				);
				absolute += error;
				if (active) activeAbsolute += error;
			}
		}
		const metric = {
			frame: sample.frame,
			ticks: sample.ticks,
			meanRgbError: absolute / actual.length,
			activeRgbError: activeAbsolute / (activePixels * 3),
			activePixels,
		};
		metrics.push(metric);
		assert(
			metric.meanRgbError < thresholds.meanRgb &&
				metric.activeRgbError < thresholds.activeRgb &&
				activePixels > thresholds.activePixels,
			JSON.stringify(metric),
		);
	}
	let difference = 0;
	for (let index = 0; index < decoded[0].length; index++)
		difference += Math.abs(decoded[0][index] - decoded[5][index]);
	const progression = difference / decoded[0].length;
	assert(
		progression > thresholds.progression,
		"Export must not collapse into a frozen frame",
	);
	run("ffmpeg.exe", [
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
		thresholds,
		metrics,
		progression,
		videoSha256: createHash("sha256")
			.update(await readFile(video))
			.digest("hex"),
	};
}
