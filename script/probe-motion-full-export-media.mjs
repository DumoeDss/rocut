import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

export async function inspectFullMotionExport({
	output,
	project,
	work,
	sequence,
	evidence,
}) {
	const exported = await realpath(output);
	const inside = relative(await realpath(join(project, "exports")), exported);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				exported,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 120000 },
		),
	);
	const video = metadata.streams.filter((s) => s.codec_type === "video");
	const audio = metadata.streams.filter((s) => s.codec_type === "audio");
	assert.equal(video.length, 1);
	assert.equal(audio.length, 1);
	assert.equal(video[0].width, 1920);
	assert.equal(video[0].height, 1080);
	assert.equal(video[0].nb_read_frames, "14400");
	assert.equal(video[0].avg_frame_rate, "30/1");
	const offset = Math.abs(
		Number(video[0].start_time) - Number(audio[0].start_time),
	);
	assert(offset <= 1 / 30, "Audio/video stream-start offset exceeds one frame");
	assert(Math.abs(Number(video[0].duration) - 480) <= 1 / 30);
	assert(Math.abs(Number(audio[0].duration) - 480) <= 1 / 30);
	const cuts = sequence.resolvedPlan.cuts.filter((c) => c.text);
	const samples = [];
	for (const [label, index] of [
		["first", 0],
		["middle", Math.floor(cuts.length / 2)],
		["last", cuts.length - 1],
	]) {
		const cut = cuts[index];
		const frame = Math.round((cut.startTime + cut.duration / 2) / 4000);
		const seconds = frame / 30;
		assert(
			frame * 4000 >= cut.startTime &&
				frame * 4000 < cut.startTime + cut.duration,
		);
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(seconds),
				"-i",
				exported,
				"-frames:v",
				"1",
				"-vf",
				"scale=320:180",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true, timeout: 30000 },
		);
		let light = 0;
		for (let i = 0; i < pixels.length; i += 3)
			if (pixels[i] > 160 && pixels[i + 1] > 160 && pixels[i + 2] > 160)
				light++;
		assert(light > 20, "Missing glyphs in " + label + " frame");
		const png = join(work, "f05-full-" + label + ".png");
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-ss",
				String(seconds),
				"-i",
				exported,
				"-frames:v",
				"1",
				png,
			],
			{ windowsHide: true, timeout: 30000 },
		);
		const pcm = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(Math.min(seconds, 479)),
				"-i",
				exported,
				"-t",
				"0.5",
				"-vn",
				"-ac",
				"1",
				"-ar",
				"48000",
				"-f",
				"f32le",
				"pipe:1",
			],
			{ windowsHide: true, timeout: 30000 },
		);
		let sum = 0;
		for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
		const rms = Math.sqrt(sum / (pcm.length / 4));
		assert(rms > 0.01 && rms < 0.5, "Missing or clipped audio in " + label);
		samples.push({ label, frame, seconds, text: cut.text, light, rms, png });
	}
	Object.assign(evidence.f05FullExport, {
		output: exported,
		bytes: (await stat(exported)).size,
		videoFrames: 14400,
		streamStartOffsetSeconds: offset,
		samples,
	});
	evidence.checks.push({
		name: "F05 full eight-minute 1080p MP4 decodes 14400 frames with audio and visible first/middle/last glyphs",
		pass: true,
	});
}
