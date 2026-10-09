import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function decodeSpatialEditor(video, artifacts, ffmpegDirectory, edits) {
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
	assert.equal(track.nb_read_frames, "240");
	assert.equal(track.r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - 8) < 0.1);
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
	const baseline = pixels(join(artifacts, "unavailable-input/pattern.png"));
	const metrics = [];
	for (let index = 0; index < 4; index++) {
		const frame = index * 60 + 30;
		const screenshotPath = join(artifacts, `spatial-edited-${index}.png`);
		const bounds = edits[index].edited.bounds;
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
		// Browser screenshots round the CSS rectangle outwards to device pixels.
		// Map its measured content rectangle, not the surrounding fractional border,
		// to the comparison grid. Coordinates come only from the captured DOM bounds.
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
		assert.equal(baseline.length, actual.length);
		let sum = 0,
			sum2 = 0,
			referenceSum = 0,
			referenceSum2 = 0;
		let absolute = 0,
			activeAbsolute = 0,
			activePixels = 0;
		for (let p = 0; p < actual.length; p += 3) {
			const active = [0, 1, 2].some(
				(c) => Math.abs(expected[p + c] - baseline[p + c]) > 15,
			);
			if (active) activePixels++;
			for (let c = 0; c < 3; c++) {
				const a = actual[p + c],
					b = expected[p + c];
				absolute += Math.abs(a - b);
				if (active) activeAbsolute += Math.abs(a - b);
				sum += a;
				sum2 += a * a;
				referenceSum += b;
				referenceSum2 += b * b;
			}
		}
		const count = actual.length;
		const contrast = Math.sqrt(sum2 / count - (sum / count) ** 2);
		const referenceContrast = Math.sqrt(
			referenceSum2 / count - (referenceSum / count) ** 2,
		);
		const metric = {
			index,
			frame,
			screenshotBounds: bounds,
			meanRgbError: absolute / count,
			activeError: activeAbsolute / (activePixels * 3),
			activePixels,
			contrastRatio: contrast / referenceContrast,
		};
		metrics.push(metric);
		assert(
			metric.meanRgbError < 15 && metric.activeError < 15 && activePixels > 500,
			`Edited preview/export detail mismatch: ${JSON.stringify(metric)}`,
		);
		assert(
			metric.contrastRatio > 0.8 && metric.contrastRatio < 1.2,
			`Edited preview/export contrast mismatch: ${JSON.stringify(metric)}`,
		);
	}
	run("ffmpeg.exe", [
		"-v",
		"error",
		"-n",
		"-i",
		video,
		"-vf",
		"select='eq(n,30)+eq(n,90)+eq(n,150)+eq(n,210)',scale=640:360,tile=2x2",
		"-frames:v",
		"1",
		join(artifacts, "contact-sheet.png"),
	]);
	return { decoder: "independent FFmpeg/FFprobe", metadata, metrics };
}
