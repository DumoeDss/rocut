import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function createRangeSource(
	path,
	{ segmentSeconds = 1, secondColor = "blue" } = {},
) {
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-n",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=640x360:r=30:d=" + segmentSeconds,
			"-f",
			"lavfi",
			"-i",
			"color=c=" + secondColor + ":s=640x360:r=30:d=" + segmentSeconds,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=" + segmentSeconds,
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:duration=" + segmentSeconds,
			"-filter_complex",
			"[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]",
			"-map",
			"[v]",
			"-map",
			"[a]",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			path,
		],
		{ windowsHide: true },
	);
}

// Independent of the editor clock/range planner: the source has two distinct
// colors AND tones, so exporting the wrong second cannot pass duration alone.
export function verifyRangeMedia(output, { format, ranged }) {
	const duration = ranged ? 1 : 2;
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
			{ windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
		),
	);
	const videos = metadata.streams.filter((s) => s.codec_type === "video");
	const audios = metadata.streams.filter((s) => s.codec_type === "audio");
	assert.equal(videos.length, 1);
	assert.equal(audios.length, 1);
	assert.equal(videos[0].codec_name, format === "webm" ? "vp9" : "h264");
	assert.equal(audios[0].codec_name, format === "webm" ? "opus" : "aac");
	assert.equal(videos[0].width, 1920);
	assert.equal(videos[0].height, 1080);
	assert.equal(Number(videos[0].nb_read_frames), duration * 30);
	assert(output.suggestedFilename.endsWith("." + format));
	assert(metadata.format.format_name.includes(format));
	assert(Math.abs(Number(metadata.format.duration) - duration) < 0.05);
	const videoPackets = metadata.packets
		.filter((p) => p.stream_index === videos[0].index)
		.map((p) => Number(p.pts_time))
		.sort((a, b) => a - b);
	assert.equal(videoPackets.length, duration * 30);
	for (let frame = 0; frame < videoPackets.length; frame++)
		assert(
			Math.abs(videoPackets[frame] - frame / 30) < 0.002,
			"range video must start at zero and retain cadence",
		);
	const audioPackets = metadata.packets.filter(
		(p) => p.stream_index === audios[0].index,
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
	const samples = [];
	// The fixed fixture has 0.4s cuts followed by 0.1s cuts: 0.4/1.4 are
	// intentional fade boundaries, while 0.2/1.2 are cut interiors.
	for (const seconds of ranged ? [0.1, 0.2, 0.8] : [0.1, 0.2, 1.1, 1.2, 1.8]) {
		const blue = ranged || seconds >= 1;
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(seconds),
				"-i",
				output.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=160:90",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true, maxBuffer: 1024 * 1024 },
		);
		assert.equal(pixels.length, 160 * 90 * 3);
		let colored = 0,
			light = 0;
		for (let offset = 0; offset < pixels.length; offset += 3) {
			const [r, g, b] = pixels.subarray(offset, offset + 3);
			if (blue ? b > 120 && r < 90 && g < 90 : r > 120 && g < 90 && b < 90)
				colored++;
			if (r > 180 && g > 180 && b > 180) light++;
		}
		assert(colored > 1000, "selected source interval must retain its color");
		if (seconds === 0.2 || seconds === 1.2)
			assert(light > 8, "selected cue must retain interior glyphs");
		const start = Math.floor(seconds * 48000),
			count = 4800;
		assert((start + count) * 4 <= pcm.length);
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
		assert(rms > 0.04 && rms < 0.13);
		assert(
			Math.abs(frequency - (blue ? 880 : 440)) < 25,
			"range audio must sample the selected source interval",
		);
		samples.push({
			seconds,
			color: blue ? "blue" : "red",
			colored,
			light,
			rms,
			frequency,
		});
	}
	return {
		file: output.path,
		format,
		ranged,
		duration,
		frames: videoPackets.length,
		audioStart,
		audioEnd,
		samples,
	};
}
