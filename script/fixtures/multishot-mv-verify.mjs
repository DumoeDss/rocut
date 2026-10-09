import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMultishotPixels } from "./multishot-mv-pixels.mjs";
import { verifyMultishotAudio } from "./multishot-mv-audio-verify.mjs";

export function verifyMultishotMv({
	artifact,
	ffmpeg,
	ffprobe,
	snapshots,
	wrongOrder,
}) {
	const native = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 12 * 1024 * 1024,
	};
	const file = join(artifact, "multishot-mv.webm");
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-count_frames", "-show_streams", "-of", "json", file],
			native,
		),
	);
	const video = metadata.streams.find((s) => s.codec_type === "video"),
		audio = metadata.streams.find((s) => s.codec_type === "audio");
	assert.equal(video?.nb_read_frames, "150");
	assert.equal(video?.width, 160);
	assert.equal(video?.height, 90);
	assert.equal(video?.r_frame_rate, "25/1");
	assert.equal(audio?.codec_name, "opus");
	assert.equal(audio?.sample_rate, "48000");
	assert.equal(audio?.channels, 2);
	const timestamps = JSON.parse(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_frames",
				"-show_entries",
				"frame=best_effort_timestamp_time",
				"-of",
				"json",
				file,
			],
			native,
		),
	);
	assert.equal(timestamps.frames.length, 150);
	timestamps.frames.forEach((frame, i) =>
		assert.ok(
			Math.abs(Number(frame.best_effort_timestamp_time) - i / 25) < 1e-6,
			`Frame ${i} timestamp changed`,
		),
	);
	writeFileSync(
		join(artifact, "ffprobe.json"),
		JSON.stringify({ metadata, timestamps }, null, 2),
	);
	const pixels = execFileSync(
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
		native,
	);
	const decoded = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-map",
			"0:a:0",
			"-f",
			"f32le",
			"-ac",
			"2",
			"-ar",
			"48000",
			"pipe:1",
		],
		native,
	);
	writeFileSync(join(artifact, "decoded.rgb24"), pixels);
	writeFileSync(join(artifact, "decoded.f32"), decoded);
	const visual = verifyMultishotPixels(pixels, snapshots, wrongOrder);
	const sound = verifyMultishotAudio(
		decoded,
		readFileSync(join(artifact, "mixed.f32")),
		readFileSync(join(artifact, "host/expected.f32")),
	);
	execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			"select='eq(n,0)+eq(n,25)+eq(n,45)+eq(n,50)+eq(n,75)+eq(n,95)+eq(n,100)+eq(n,125)+eq(n,149)',tile=3x3",
			"-frames:v",
			"1",
			"-y",
			join(artifact, "contact-sheet.png"),
		],
		native,
	);
	return {
		decodedFrames: 150,
		canvas: [160, 90],
		fps: 25,
		durationSeconds: 6,
		visual,
		sound,
	};
}

// Recheck retained evidence without recompiling or rerunning native browsers.
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const artifact = resolve(process.argv[2] ?? ""),
		ffmpeg = process.env.ROCUT_TEST_FFMPEG,
		ffprobe = process.env.ROCUT_TEST_FFPROBE;
	if (!process.argv[2] || !ffmpeg || !ffprobe)
		throw Error("Provide retained artifact directory and native decoder paths");
	const rgba = (name) => [
		...execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				join(artifact, name),
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			{ windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
		),
	];
	const result = verifyMultishotMv({
		artifact,
		ffmpeg,
		ffprobe,
		snapshots: [25, 75, 125].map((frame) => ({
			frame,
			rgba: rgba(`native-lyrics-${frame}.png`),
		})),
		wrongOrder: { rgba: rgba("wrong-layer-order.png") },
	});
	writeFileSync(
		join(artifact, "reverification.json"),
		JSON.stringify({ passed: true, ...result }, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				passed: true,
				frames: result.decodedFrames,
				oneFrameOffsetRejectedFrames:
					result.visual.oneFrameOffsetRejectedFrames,
				wrongOrderRejected: result.visual.wrongOrderRejected,
				sound: result.sound,
			},
			null,
			2,
		),
	);
}
