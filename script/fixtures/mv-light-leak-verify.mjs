import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function verifyLightLeakExport({ file, ffmpeg, ffprobe, expectations }) {
	const options = {
		windowsHide: true,
		timeout: 20000,
		maxBuffer: 4 * 1024 * 1024,
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
	assert.equal(track.width, 160);
	assert.equal(track.height, 96);
	assert.equal(Number(track.nb_read_frames), 6);
	const frameTimes = metadata.frames
		.filter((frame) => frame.media_type === "video")
		.map((frame) => Number(frame.best_effort_timestamp_time));
	assert.equal(frameTimes.length, 6);
	for (const [index, seconds] of frameTimes.entries())
		assert.ok(
			Math.abs(seconds - (index * 1001) / 30000) <= 0.0011,
			`Rational frame timestamp drift at ${index}: ${seconds}`,
		);
	const decoded = execFileSync(
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
	assert.equal(decoded.length, 6 * 160 * 96 * 3);
	assert.equal(expectations.length, 6);
	const observations = [];
	for (let frame = 0; frame < 6; frame++) {
		let total = 0,
			marker = 0;
		for (let y = 0; y < 96; y++)
			for (let x = 0; x < 160; x++)
				for (let c = 0; c < 3; c++) {
					const d = Math.abs(
						decoded[((frame * 96 + y) * 160 + x) * 3 + c] -
							expectations[frame][(y * 160 + x) * 4 + c],
					);
					total += d;
					if (x >= 4 && x < 12 && y >= 4 && y < 12) marker += d;
				}
		const mae = total / (160 * 96 * 3),
			markerMae = marker / (8 * 8 * 3);
		assert.ok(mae < 4, `Native decoded frame ${frame} MAE ${mae}`);
		assert.ok(markerMae < 4, `External marker frame ${frame} MAE ${markerMae}`);
		observations.push({ frame, mae, markerMae });
	}
	return {
		frames: 6,
		codec: track.codec_name,
		frameRate: track.avg_frame_rate,
		frameTimes,
		observations,
		oracle:
			"original extracted reference geometry/color screen pixels plus authored timeline placement/trim/amount curve; not rendered-output self-reference",
	};
}
