import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
const run = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function exportAndDecode(context, name, expectedDialogue) {
	const { cli, mark, evidence, ffmpeg, ffprobe } = context;
	const native = await cli("read");
	const output = join(evidence, `${name}.webm`);
	const receipt = await cli(
		"export",
		"--revision",
		String(native.revision),
		"--idempotency-key",
		name,
		"--format",
		"webm",
		"--quality",
		"high",
		"--out",
		output,
	);
	await mark(`${name}-receipt`, { nativeRevision: native.revision, receipt });
	assert.equal(
		(await cli("read")).revision,
		native.revision,
		"Export mutated Native revision",
	);
	const metadata = JSON.parse(
		(
			await run(
				ffprobe,
				[
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					output,
				],
				{ windowsHide: true, timeout: 120000 },
			)
		).stdout,
	);
	assert.equal(
		metadata.streams.filter((s) => s.codec_type === "video").length,
		1,
	);
	assert.equal(
		metadata.streams.filter((s) => s.codec_type === "audio").length,
		1,
	);
	assert(
		Math.abs(Number(metadata.format.duration) - 4) < 0.15,
		"Export length must be four seconds",
	);
	await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			output,
			"-map",
			"0:v:0",
			"-map",
			"0:a:0",
			"-f",
			"null",
			"-",
		],
		{ windowsHide: true, timeout: 120000 },
	);
	const pcm = (
		await run(
			ffmpeg,
			[
				"-v",
				"error",
				"-i",
				output,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"8000",
				"-f",
				"f32le",
				"-",
			],
			{
				encoding: "buffer",
				windowsHide: true,
				timeout: 120000,
				maxBuffer: 2e6,
			},
		)
	).stdout;
	const samples = Array.from({ length: pcm.length / 4 }, (_, n) =>
		pcm.readFloatLE(n * 4),
	);
	assert(Math.abs(samples.length / 8000 - 4) < 0.15);
	function amplitude(frequency, second) {
		const start = Math.round((second + 0.2) * 8000),
			size = 4000;
		let cosine = 0,
			sine = 0;
		for (let n = 0; n < size; n++) {
			cosine +=
				samples[start + n] * Math.cos((2 * Math.PI * frequency * n) / 8000);
			sine +=
				samples[start + n] * Math.sin((2 * Math.PI * frequency * n) / 8000);
		}
		return (2 * Math.hypot(cosine, sine)) / size;
	}
	const spectrum = [220, 330, 440, 550].map((frequency, second) => ({
		second,
		expectedFrequency: frequency,
		amplitudes: Object.fromEntries(
			[220, 330, 440, 550, 880, 1320].map((f) => [f, amplitude(f, second)]),
		),
	}));
	for (const window of spectrum) {
		assert(
			window.amplitudes[window.expectedFrequency] > 0.1 &&
				window.amplitudes[window.expectedFrequency] < 0.2,
			`Original song missing or doubled at second ${window.second}`,
		);
		for (const f of [220, 330, 440, 550].filter(
			(f) => f !== window.expectedFrequency,
		))
			assert(
				window.amplitudes[f] < 0.015,
				"Song unexpectedly repeated or overlaid",
			);
	}
	assert(
		spectrum[0].amplitudes[880] < 0.015,
		"Embedded video source audio must be muted",
	);
	assert(
		spectrum[1].amplitudes[880] < 0.015,
		"Embedded video source audio must be muted",
	);
	if (expectedDialogue) {
		assert(
			spectrum[0].amplitudes[1320] > 0.07 &&
				spectrum[1].amplitudes[1320] > 0.07,
			"Independent short-drama dialogue was globally muted",
		);
	} else
		assert(
			spectrum.every((w) => w.amplitudes[1320] < 0.015),
			"Explicitly muted dialogue leaked",
		);
	const frames = [];
	for (const second of [0.5, 1.5, 2.5, 3.5]) {
		const pixels = (
			await run(
				ffmpeg,
				[
					"-v",
					"error",
					"-ss",
					String(second),
					"-i",
					output,
					"-frames:v",
					"1",
					"-vf",
					"scale=32:18",
					"-pix_fmt",
					"rgb24",
					"-f",
					"rawvideo",
					"-",
				],
				{ encoding: "buffer", windowsHide: true, timeout: 120000 },
			)
		).stdout;
		assert.equal(pixels.length, 32 * 18 * 3);
		const mean = [0, 1, 2].map((channel) => {
			let sum = 0;
			for (let n = channel; n < pixels.length; n += 3) sum += pixels[n];
			return sum / (pixels.length / 3);
		});
		frames.push({ second, mean, sha256: hash(pixels) });
	}
	assert(frames[0].mean[0] > 100, "Video pixels missing");
	const result = {
		metadata,
		spectrum,
		frames,
		audioSeconds: samples.length / 8000,
		sha256: hash(await readFile(output)),
		file: output,
	};
	await mark(`${name}-decoded`, result);
	return result;
}
