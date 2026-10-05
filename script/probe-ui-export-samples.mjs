import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function verifyUiExportAudio({ path, expectedDuration }) {
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			path,
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

	return audioSamples;
}

export function verifyUiExportPicture({ path, expectedFrames }) {
	const decoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			path,
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
	return samples;
}
