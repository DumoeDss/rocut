import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { samplePreviewPng } from "./probe-multilingual-media.mjs";

export async function verifyLinkedRangeMedia({
	page,
	output,
	ranged,
	startSeconds,
}) {
	const duration = ranged ? 2 : 8;
	const metadata = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-show_packets",
				"-show_entries",
				"packet=stream_index,pts_time,duration_time",
				"-of",
				"json",
				output.path,
			],
			{ encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
		),
	);
	const video = metadata.streams.filter((s) => s.codec_type === "video"),
		audio = metadata.streams.filter((s) => s.codec_type === "audio");
	assert.equal(video.length, 1);
	assert.equal(audio.length, 1);
	assert.equal(video[0].codec_name, "h264");
	assert.equal(audio[0].codec_name, "aac");
	assert.equal(video[0].width, 1920);
	assert.equal(video[0].height, 1080);
	assert.equal(Number(video[0].nb_read_frames), duration * 30);
	assert(Math.abs(Number(metadata.format.duration) - duration) < 0.05);
	const pts = metadata.packets
		.filter((p) => p.stream_index === video[0].index)
		.map((p) => Number(p.pts_time))
		.sort((a, b) => a - b);
	assert.equal(pts.length, duration * 30);
	pts.forEach((time, frame) => assert(Math.abs(time - frame / 30) < 0.002));
	const audioPackets = metadata.packets.filter(
		(p) => p.stream_index === audio[0].index,
	);
	const audioStart = Math.min(...audioPackets.map((p) => Number(p.pts_time)));
	const audioEnd = Math.max(
		...audioPackets.map((p) => Number(p.pts_time) + Number(p.duration_time)),
	);
	assert(Math.abs(audioStart) < 0.05);
	assert(Math.abs(audioEnd - duration) < 0.05);
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			output.path,
			"-vn",
			"-af",
			"pan=mono|c0=c0",
			"-ar",
			"48000",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
	);
	const tones = [];
	for (const seconds of ranged ? [0.2, 0.8, 1.5] : [0.5, 3.5, 4.5, 6.5]) {
		const expected =
			(ranged ? startSeconds + seconds : seconds) < 4 ? 440 : 880;
		const { frequency, rms } = verifyLinkedTone(pcm, seconds, expected);
		tones.push({ seconds, frequency, rms });
	}
	const samples = [];
	let greenMask;
	// 3.8s shows both Chinese and English. 5.5s shows the approved green third
	// cue; sampling that same timeline time in a ranged file proves video offset.
	for (const timelineSeconds of ranged ? [5.5] : [3.8, 5.5]) {
		const frame = Math.round(
			(timelineSeconds - (ranged ? startSeconds : 0)) * 30,
		);
		assert(frame >= 0 && frame < duration * 30);
		const png = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-i",
				output.path,
				"-vf",
				"select=eq(n\\," + frame + ")",
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-vcodec",
				"png",
				"pipe:1",
			],
			{ windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
		);
		const sample = await samplePreviewPng(page, png, (pixels) => {
			const mask = [];
			let cyan = 0,
				magenta = 0,
				green = 0,
				red = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				const [r, g, b] = pixels.slice(i, i + 3);
				if (r < 70 && g > 180 && b > 180) cyan++;
				if (r > 180 && g < 70 && b > 180) magenta++;
				if (r < 100 && g > 150 && b < 100) {
					green++;
					mask.push(i / 4);
				}
				if (r > 180 && g < 70 && b < 70) red++;
			}
			return { cyan, magenta, green, red, mask };
		});
		assert(sample.red > 1000, "video underlay must survive final export");
		if (timelineSeconds === 3.8) {
			assert(sample.cyan > 25);
			assert(sample.magenta > 25);
		} else {
			assert(
				sample.green > 25,
				"approved third-cue glyphs must appear at correct range offset",
			);
			assert.equal(
				sample.magenta,
				0,
				"English ends before the sampled green third cue",
			);
		}
		const { mask, ...counts } = sample;
		if (timelineSeconds === 5.5) greenMask = mask;
		samples.push({ timelineSeconds, outputFrame: frame, ...counts });
	}
	return {
		file: output.path,
		ranged,
		duration,
		frames: pts.length,
		audioStart,
		audioEnd,
		tones,
		samples,
		greenMask,
	};
}

export function verifyLinkedTone(pcm, seconds, expected) {
	const start = Math.floor(seconds * 48000),
		count = 4800;
	assert((start + count) * 4 <= pcm.length);
	let previous = pcm.readFloatLE(start * 4),
		crossings = 0,
		energy = 0;
	for (let i = start; i < start + count; i++) {
		const value = pcm.readFloatLE(i * 4);
		if (previous <= 0 && value > 0) crossings++;
		previous = value;
		energy += value * value;
	}
	const frequency = crossings * 10,
		rms = Math.sqrt(energy / count);
	assert(
		Math.abs(frequency - expected) < 25,
		"selected audio source offset must match the two-tone fixture",
	);
	assert(
		rms > 0.07 && rms < 0.11,
		"export preserves per-channel source amplitude",
	);
	return { frequency, rms };
}
