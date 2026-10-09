import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function decodeAfterimage({ file, ffmpeg, ffprobe, expectations }) {
	const options = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 16 * 1024 * 1024,
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
	assert.equal(track.width, 384);
	assert.equal(track.height, 216);
	assert.equal(Number(track.nb_read_frames), 6);
	assert.equal(track.codec_name, "vp9");
	const times = metadata.frames
		.filter((f) => f.media_type === "video")
		.map((f) => Number(f.best_effort_timestamp_time));
	for (const [index, time] of times.entries())
		assert(
			Math.abs(time - index / 30) < 0.0011,
			"Encoded frame timestamp mismatch",
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
	assert.equal(raw.length, 384 * 216 * 3 * 6);
	const frames = expectations.map((expected, frame) => {
		let total = 0,
			foregroundError = 0,
			foreground = 0;
		for (let i = 0; i < 384 * 216; i++) {
			const lit =
				expected[i * 4] + expected[i * 4 + 1] + expected[i * 4 + 2] > 60;
			if (lit) foreground++;
			for (let c = 0; c < 3; c++) {
				const d = Math.abs(
					raw[(frame * 384 * 216 + i) * 3 + c] - expected[i * 4 + c],
				);
				total += d;
				if (lit) foregroundError += d;
			}
		}
		const mae = total / (384 * 216 * 3),
			foregroundMae = foreground ? foregroundError / (foreground * 3) : 0;
		assert(
			mae < 4 && foregroundMae < 8,
			`Decoded afterimage frame ${frame}: ${mae}/${foregroundMae}`,
		);
		if (frame >= 1 && frame < 5)
			assert(
				foreground > 1500,
				"Encoded oracle has no significant afterimage foreground",
			);
		return { frame, mae, foreground, foregroundMae };
	});
	return {
		codec: track.codec_name,
		times,
		frames,
		oracle:
			"complete original afterimage draw downscaled to final canvas; not production renderer self-reference",
	};
}
