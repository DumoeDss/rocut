import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function decodeSweepScrollEditor(
	video,
	artifacts,
	ffmpegDirectory,
	edits,
	{ count = 2, finalBackground = true } = {},
) {
	assert(ffmpegDirectory && isAbsolute(ffmpegDirectory));
	const run = (binary, args, extra = {}) =>
		execFileSync(join(ffmpegDirectory, binary), args, {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 8 * 1024 * 1024,
			...extra,
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
				"-of",
				"json",
				video,
			],
			{ encoding: "utf8" },
		),
	);
	assert.equal(metadata.streams.length, 1);
	const track = metadata.streams[0];
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.width, 640);
	assert.equal(track.height, 360);
	assert.equal(track.nb_read_frames, String(count * 60));
	assert.equal(track.r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - count * 2) < 0.1);
	const pixels = (file, filter = "") =>
		run("ffmpeg.exe", [
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			`${filter}scale=320:180`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		]);
	const background = [16, 32, 48];
	const metrics = [];
	const progression = [];
	assert.equal(edits.length, count);
	for (const edit of edits) {
		assert.deepEqual(
			edit.samples.map((sample) => sample.localTicks),
			[60000, 120000],
		);
		const decodedSamples = [];
		for (const sample of edit.samples) {
			const { frame, bounds } = sample;
			assert.equal(
				sample.timelineTicks,
				edit.index * 240000 + sample.localTicks,
			);
			assert.equal(frame, sample.timelineTicks / 4000);
			const screenshotPath = join(artifacts, `${sample.name}.png`);
			assert(
				Object.values(bounds).every(Number.isFinite) &&
					bounds.width > 0 &&
					bounds.height > 0,
			);
			const png = readFileSync(screenshotPath);
			assert.equal(
				png.readUInt32BE(16),
				Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x),
			);
			assert.equal(
				png.readUInt32BE(20),
				Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y),
			);
			// Normalize measured CSS bounds, including fractional screenshot rounding,
			// before comparing pixels decoded by a process independent of the editor.
			const crop = [
				bounds.width,
				bounds.height,
				bounds.x - Math.floor(bounds.x),
				bounds.y - Math.floor(bounds.y),
			]
				.map((value) => Math.round(value * 8))
				.join(":");
			const expected = pixels(
				screenshotPath,
				`scale=iw*8:ih*8:flags=bilinear,crop=${crop},`,
			);
			const actual = pixels(video, `select=eq(n\\,${frame}),`);
			assert.equal(actual.length, 320 * 180 * 3);
			assert.equal(expected.length, actual.length);
			decodedSamples.push(actual);
			let absolute = 0,
				activeAbsolute = 0,
				inactiveAbsolute = 0,
				activePixels = 0,
				actualEnergy = 0,
				expectedEnergy = 0;
			for (let p = 0; p < actual.length; p += 3) {
				const active = background.some(
					(b, channel) => Math.abs(expected[p + channel] - b) > 20,
				);
				if (active) activePixels++;
				for (let c = 0; c < 3; c++) {
					const error = Math.abs(actual[p + c] - expected[p + c]);
					absolute += error;
					if (active) activeAbsolute += error;
					else inactiveAbsolute += error;
					actualEnergy += (actual[p + c] - background[c]) ** 2;
					expectedEnergy += (expected[p + c] - background[c]) ** 2;
				}
			}
			const metric = {
				index: edit.index,
				frame,
				localTicks: sample.localTicks,
				timelineTicks: sample.timelineTicks,
				screenshotBounds: bounds,
				meanRgbError: absolute / actual.length,
				activeError: activeAbsolute / (activePixels * 3),
				activePixels,
				inactiveError: inactiveAbsolute / (actual.length - activePixels * 3),
				detailEnergyRatio: Math.sqrt(actualEnergy / expectedEnergy),
			};
			metrics.push(metric);
			assert(
				metric.meanRgbError < 12 &&
					metric.activeError < 18 &&
					activePixels > 200,
				`Generator preview/export active-detail mismatch: ${JSON.stringify(metric)}`,
			);
			assert(
				metric.inactiveError < 5 &&
					metric.detailEnergyRatio > 0.8 &&
					metric.detailEnergyRatio < 1.2,
				`Generator background/detail-energy mismatch: ${JSON.stringify(metric)}`,
			);
		}
		let difference = 0;
		for (let i = 0; i < decodedSamples[0].length; i++)
			difference += Math.abs(decodedSamples[0][i] - decodedSamples[1][i]);
		const meanRgbDifference = difference / decodedSamples[0].length;
		assert(
			meanRgbDifference > 0.25,
			"Decoded generator samples must not collapse to a frozen frame",
		);
		progression.push({ index: edit.index, meanRgbDifference });
	}
	const endpoint = pixels(video, `select=eq(n\\,${count * 60 - 1}),`);
	assert.equal(endpoint.length, 320 * 180 * 3);
	let endpointError = 0;
	for (let i = 0; i < endpoint.length; i++)
		endpointError += Math.abs(endpoint[i] - background[i % 3]);
	const finalBackgroundError = endpointError / endpoint.length;
	if (finalBackground)
		assert(
			finalBackgroundError < 4,
			`Particle Scroll endpoint must expose the project background: ${finalBackgroundError}`,
		);
	run("ffmpeg.exe", [
		"-v",
		"error",
		"-n",
		"-i",
		video,
		"-vf",
		`select='${edits.flatMap((edit) => edit.samples.map((sample) => `eq(n,${sample.frame})`)).join("+")}',scale=640:360,tile=2x${count}`,
		"-frames:v",
		"1",
		join(artifacts, "contact-sheet.png"),
	]);
	return {
		decoder: "independent FFmpeg/FFprobe",
		metadata,
		metrics,
		progression,
		...(finalBackground ? { finalBackgroundError } : {}),
		sources: edits.map((edit) => ({
			index: edit.index,
			preserved: edit.preserved,
		})),
	};
}
