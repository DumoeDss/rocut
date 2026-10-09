import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join } from "node:path";

export function decodeTypeCard({
	file,
	ffmpeg,
	ffprobe,
	expectations,
	oracleDirectory,
	width = 384,
	height = 216,
}) {
	const frames = 12,
		violations = [];
	assert(
		(width === 384 && height === 216) || (width === 1920 && height === 1080),
		"Unexpected acceptance dimensions",
	);
	assert(
		!!expectations !== !!oracleDirectory,
		"Supply exactly one independent oracle storage format",
	);
	if (oracleDirectory)
		assert(
			isAbsolute(oracleDirectory),
			"Oracle PNG directory must be absolute",
		);
	const options = {
		windowsHide: true,
		timeout: 30000,
		// Native RGB is 74,649,600 bytes for twelve frames. Binary buffers stay
		// bounded; no full-resolution numeric arrays cross the browser boundary.
		maxBuffer: Math.max(
			16 * 1024 * 1024,
			width * height * 3 * frames + 1024 * 1024,
		),
	};
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
			options,
		),
	);
	const track = metadata.streams.find((s) => s.codec_type === "video");
	assert.equal(track.width, width);
	assert.equal(track.height, height);
	assert.equal(Number(track.nb_read_frames), frames);
	assert.equal(track.codec_name, "vp9");
	const times = metadata.frames
		.filter((f) => f.media_type === "video")
		.map((f) => Number(f.best_effort_timestamp_time));
	assert.equal(times.length, frames);
	if (expectations) assert.equal(expectations.length, frames);
	for (const [index, time] of times.entries())
		if (Math.abs(time - index / 30) >= 0.0011)
			violations.push(
				`TypeCard encoded timestamp mismatch at ${index}: ${time}`,
			);
	const raw = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		options,
	);
	assert.equal(raw.length, width * height * 3 * frames);
	const measurements = Array.from({ length: frames }, (_, frame) => {
		const expected = expectations
			? expectations[frame]
			: execFileSync(
					ffmpeg,
					[
						"-v",
						"error",
						"-i",
						join(
							oracleDirectory,
							`oracle-${String(frame).padStart(2, "0")}.png`,
						),
						"-frames:v",
						"1",
						"-f",
						"rawvideo",
						"-pix_fmt",
						"rgb24",
						"pipe:1",
					],
					{ ...options, maxBuffer: width * height * 3 + 1024 * 1024 },
				);
		const stride = expectations ? 4 : 3;
		assert.equal(expected.length, width * height * stride);
		let total = 0,
			foregroundError = 0,
			foreground = 0,
			max = 0;
		for (let i = 0; i < width * height; i++) {
			const lit =
				expected[i * stride] +
					expected[i * stride + 1] +
					expected[i * stride + 2] >
				60;
			if (lit) foreground++;
			for (let c = 0; c < 3; c++) {
				const delta = Math.abs(
					raw[(frame * width * height + i) * 3 + c] - expected[i * stride + c],
				);
				total += delta;
				max = Math.max(max, delta);
				if (lit) foregroundError += delta;
			}
		}
		const mae = total / (width * height * 3),
			foregroundMae = foreground ? foregroundError / (foreground * 3) : 0;
		const qualityPassed = mae < 4 && foregroundMae < 8;
		if (!qualityPassed)
			violations.push(
				`Decoded typeCard frame ${frame}: ${mae}/${foregroundMae}`,
			);
		if ((frame >= 1 && frame < 5) || (frame >= 6 && frame < 10))
			if (foreground <= 100)
				violations.push(
					`Encoded typeCard oracle has no significant foreground at ${frame}`,
				);
		return { frame, mae, foreground, foregroundMae, max, qualityPassed };
	});
	return {
		passed: violations.length === 0,
		violations,
		thresholds: { rgbMaeLessThan: 4, foregroundMaeLessThan: 8 },
		width,
		height,
		codec: track.codec_name,
		pixelFormat: track.pix_fmt,
		colorSpace: track.color_space,
		colorRange: track.color_range,
		times,
		frames: measurements,
		oracle: `Complete original quiet/flicker draw ${width === 1920 ? "at native size" : "downscaled to final canvas"}; not production renderer self-reference`,
	};
}
