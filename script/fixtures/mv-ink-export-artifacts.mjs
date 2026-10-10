import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
export { attachInkExportVideoDownload } from "./mv-ink-export-video-download.mjs";

import {
	inkExportRawFrames,
	closeInkExportReaders,
} from "./mv-ink-export-raw-frames.mjs";

const WIDTH = 1920,
	HEIGHT = 1080,
	FRAMES = 421,
	FPS = 60;
const BLANKS = Array.from({ length: 13 }, (_, index) => index * 35);
export async function attachInkExportOracleArtifacts(page, directory) {
	assert(isAbsolute(directory));
	const frames = new Set();
	await page.exposeFunction(
		"__writeInkExportOraclePng",
		async (frame, payload) => {
			assert(
				Number.isSafeInteger(frame) &&
					frame >= 0 &&
					frame < FRAMES &&
					!frames.has(frame),
				"Invalid/duplicate Ink oracle frame",
			);
			assert(
				typeof payload === "string" &&
					payload.length <= 32 * 1024 * 1024 &&
					/^[A-Za-z0-9+/]+={0,2}$/.test(payload),
				"Invalid bounded Ink PNG",
			);
			const bytes = Buffer.from(payload, "base64");
			assert(
				bytes.length >= 33 &&
					bytes
						.subarray(0, 8)
						.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
					bytes.toString("ascii", 12, 16) === "IHDR",
			);
			assert.equal(bytes.readUInt32BE(16), WIDTH);
			assert.equal(bytes.readUInt32BE(20), HEIGHT);
			frames.add(frame);
			await writeFile(
				join(directory, `oracle-${String(frame).padStart(3, "0")}.png`),
				bytes,
				{ flag: "wx" },
			);
		},
	);
	return frames;
}

export async function decodeInkExport({
	file,
	ffmpeg,
	ffprobe,
	oracleDirectory,
	signal,
}) {
	for (const path of [file, ffmpeg, ffprobe, oracleDirectory])
		assert(isAbsolute(path), "Ink decoder paths must be absolute");
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_frames",
				"-of",
				"json",
				file,
			],
			{ windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
		).toString("utf8"),
	);
	const videos = metadata.streams.filter((s) => s.codec_type === "video");
	assert.equal(videos.length, 1);
	const track = videos[0];
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.profile, "Profile 1");
	assert.equal(track.pix_fmt, "yuv444p");
	assert.equal(track.width, WIDTH);
	assert.equal(track.height, HEIGHT);
	assert.equal(Number(track.nb_read_frames), FRAMES);
	assert.equal(track.r_frame_rate, "60/1");
	const times = metadata.frames
		.filter((f) => f.media_type === "video")
		.map((f) => Number(f.best_effort_timestamp_time));
	assert.equal(times.length, FRAMES);
	const violations = [],
		measurements = [];
	for (const [index, time] of times.entries())
		if (Math.abs(time - index / FPS) >= 0.0011)
			violations.push(`Ink timestamp mismatch ${index}: ${time}`);
	let actual, oracle;
	try {
		actual = inkExportRawFrames({
			ffmpeg,
			signal,
			args: ["-i", file, "-map", "0:v:0"],
		});
		oracle = inkExportRawFrames({
			signal,
			ffmpeg,
			args: [
				"-framerate",
				String(FPS),
				"-start_number",
				"0",
				"-i",
				join(oracleDirectory, "oracle-%03d.png"),
				"-frames:v",
				String(FRAMES),
			],
		});
		for (let frame = 0; frame < FRAMES; frame++) {
			const [a, b] = await Promise.all([actual.next(), oracle.next()]);
			assert(!a.done && !b.done, `Missing Ink RGB frame ${frame}`);
			let total = 0,
				foregroundError = 0,
				foreground = 0,
				max = 0,
				blankMax = 0;
			for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
				const offset = pixel * 3,
					lit =
						b.value[offset] + b.value[offset + 1] + b.value[offset + 2] > 60;
				if (lit) foreground++;
				for (let channel = 0; channel < 3; channel++) {
					const delta = Math.abs(
						a.value[offset + channel] - b.value[offset + channel],
					);
					total += delta;
					max = Math.max(max, delta);
					if (lit) foregroundError += delta;
					if (BLANKS.includes(frame)) {
						assert.equal(
							b.value[offset + channel],
							0,
							"Blank oracle must be fullRGBblack",
						);
						blankMax = Math.max(blankMax, a.value[offset + channel]);
					}
				}
			}
			const mae = total / (WIDTH * HEIGHT * 3),
				foregroundMae = foreground ? foregroundError / (foreground * 3) : 0;
			const qualityPassed = mae < 4 && foregroundMae < 8;
			if (!qualityPassed)
				violations.push(`Ink decoded frame ${frame}: ${mae}/${foregroundMae}`);
			if (BLANKS.includes(frame) && blankMax !== 0)
				violations.push(
					`Ink decoded blank has nonblack RGB ${frame}: ${blankMax}`,
				);
			measurements.push({
				frame,
				mae,
				foregroundMae,
				foreground,
				max,
				qualityPassed,
				...(BLANKS.includes(frame) ? { blankMax } : {}),
			});
		}
		const [a, b] = await Promise.all([actual.next(), oracle.next()]);
		assert(a.done && b.done, "Unexpected excess Ink frames");
	} finally {
		await closeInkExportReaders([actual, oracle]);
	}
	return {
		passed: violations.length === 0,
		violations,
		thresholds: { rgbMaeLessThan: 4, foregroundMaeLessThan: 8, blankRgbMax: 0 },
		width: WIDTH,
		height: HEIGHT,
		frameCount: FRAMES,
		fps: FPS,
		times,
		frames: measurements,
		codec: track.codec_name,
		profile: track.profile,
		pixelFormat: track.pix_fmt,
		colorSpace: track.color_space,
		colorRange: track.color_range,
		colorTransfer: track.color_transfer,
		colorPrimaries: track.color_primaries,
		oracle:
			"Whole unchanged original Ink; every408source sample; full1920x1080; independentFFmpegRGB decode",
	};
}
