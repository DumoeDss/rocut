import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function verifyUiFormatMedia(
	output,
	{ width, height, numerator, denominator },
) {
	const streams = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-of",
				"json",
				output.path,
			],
			{ windowsHide: true, encoding: "utf8" },
		),
	).streams;
	const stream = streams.find((item) => item.codec_type === "video");
	assert(stream, "download must contain a video stream");
	assert.equal(streams.filter((item) => item.codec_type === "video").length, 1);
	const audioStreams = streams.filter((item) => item.codec_type === "audio");
	assert.equal(
		audioStreams.length,
		1,
		"real UI export must preserve the source audio",
	);
	const audio = audioStreams[0];
	assert.equal(audio.codec_name, "aac");
	assert.equal(stream.codec_name, "h264");
	assert.equal(stream.width, width);
	assert.equal(stream.height, height);
	// Each case starts from the original two-second timeline via actual Undo.
	// Earlier-frame endpoint alignment yields 59 frames at 30000/1001.
	const expectedFrames = Math.floor((2 * numerator) / denominator);
	const expectedDuration = (expectedFrames * denominator) / numerator;
	assert.equal(Number(stream.nb_read_frames), expectedFrames);
	const [rateNum, rateDen] = stream.avg_frame_rate.split("/").map(Number);
	assert(
		Math.abs(rateNum / rateDen - numerator / denominator) < 0.01,
		"encoded FPS must match selected rational rate",
	);
	assert(
		Math.abs(
			Number(stream.duration) - (expectedFrames * denominator) / numerator,
		) < 0.003,
		"video duration must match its frame count",
	);
	assert(
		Math.abs(Number(audio.start_time ?? 0) - Number(stream.start_time ?? 0)) <
			0.05,
		"audio/video start offset must stay bounded",
	);
	assert(
		Math.abs(Number(audio.duration) - expectedDuration) < 0.05,
		"AAC duration must follow the retimed project endpoint",
	);
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			output.path,
			"-map",
			"0:a:0",
			"-ac",
			"1",
			"-ar",
			"48000",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ windowsHide: true, maxBuffer: 1024 * 1024 },
	);
	const audioSamples = [0.1, 0.8, expectedDuration - 0.2].map((seconds) => {
		const start = Math.floor(seconds * 48000),
			count = 4800;
		assert((start + count) * 4 <= pcm.length, "tail audio must exist");
		let energy = 0,
			crossings = 0,
			previous = pcm.readFloatLE(start * 4);
		for (let index = start; index < start + count; index++) {
			const value = pcm.readFloatLE(index * 4);
			energy += value * value;
			if (previous <= 0 && value > 0) crossings++;
			previous = value;
		}
		const rms = Math.sqrt(energy / count),
			frequency = (crossings * 48000) / count;
		assert(
			rms > 0.04 && rms < 0.13,
			"decoded source tone must be audible without duplication",
		);
		assert(
			Math.abs(frequency - 880) < 25,
			"decoded source tone must retain its pitch",
		);
		return { seconds, rms, frequency };
	});
	const decoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			output.path,
			"-vf",
			"select='eq(n,0)+eq(n," +
				Math.floor(expectedFrames * 0.4) +
				")+eq(n," +
				(expectedFrames - 1) +
				")',scale=160:160",
			"-vsync",
			"0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		{ windowsHide: true, maxBuffer: 1024 * 1024 },
	);
	assert.equal(
		decoded.length,
		3 * 160 * 160 * 3,
		"first/middle/final frames must decode",
	);
	const samples = [];
	for (let frame = 0; frame < 3; frame++) {
		let red = 0,
			light = 0;
		const start = frame * 160 * 160 * 3;
		for (let offset = start; offset < start + 160 * 160 * 3; offset += 3) {
			const [r, g, b] = decoded.subarray(offset, offset + 3);
			if (r > 120 && g < 90 && b < 90) red++;
			if (r > 180 && g > 180 && b > 180) light++;
		}
		assert(red > 1000, "video underlay must remain visible");
		// Entry/exit animations may intentionally hide glyphs at the endpoints.
		if (frame === 1)
			assert(light > 8, "interior motion text must remain visible");
		samples.push({ red, light });
	}
	return {
		file: output.path,
		suggestedFilename: output.suggestedFilename,
		width,
		height,
		fps: { numerator, denominator },
		frames: expectedFrames,
		duration: Number(stream.duration),
		samples,
		audio: {
			codec: audio.codec_name,
			duration: Number(audio.duration),
			samples: audioSamples,
		},
	};
}
