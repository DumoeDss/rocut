import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectedTimelineSample } from "./hyperframes-graph-editor-oracle.mjs";

/** Independent FFmpeg AV decode and scalar source oracle; does not consume
 * production graph output to calculate expected samples. No alignment correction.
 */
export function verifyGraphEditorExport({
	file,
	ffmpeg,
	ffprobe,
	artifact,
	mixedPcm,
}) {
	const native = {
		windowsHide: true,
		timeout: 20000,
		maxBuffer: 4 * 1024 * 1024,
	};
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-count_frames", "-show_streams", "-of", "json", file],
			native,
		),
	);
	writeFileSync(
		join(artifact, "ffprobe.json"),
		JSON.stringify(metadata, null, 2),
	);
	const video = metadata.streams.find(
		(stream) => stream.codec_type === "video",
	);
	const audio = metadata.streams.find(
		(stream) => stream.codec_type === "audio",
	);
	assert.equal(video?.nb_read_frames, "9");
	assert.equal(video?.width, 64);
	assert.equal(video?.height, 64);
	assert.equal(audio?.codec_name, "opus");
	assert.equal(audio?.channels, 2);
	assert.equal(audio?.sample_rate, "48000");
	const frames = execFileSync(
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
	writeFileSync(join(artifact, "decoded.rgb24"), frames);
	const picture = [];
	for (let frame = 0; frame < 9; frame++) {
		const points =
			frame >= 1 && frame <= 6
				? [
						[frame * 4 + 8, 32, [233, 69, 96]],
						[60, 60, [22, 33, 62]],
						[2, 32, [22, 33, 62]],
					]
				: [
						[32, 32, [0, 0, 0]],
						[60, 60, [0, 0, 0]],
					];
		for (const [x, y, expected] of points) {
			const offset = (frame * 64 * 64 + y * 64 + x) * 3;
			const actual = [...frames.subarray(offset, offset + 3)];
			for (let c = 0; c < 3; c++)
				assert.ok(
					Math.abs(actual[c] - expected[c]) <= 8,
					`Graph editor picture ${frame} at ${x},${y}: ${actual} instead of ${expected}`,
				);
			picture.push({ frame, x, y, actual, expected });
		}
	}
	execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-ss",
			"0.12",
			"-i",
			file,
			"-frames:v",
			"1",
			join(artifact, "preview.png"),
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
			"44100",
			"pipe:1",
		],
		native,
	);
	writeFileSync(join(artifact, "decoded.f32le"), decoded);
	const samples = 15876;
	assert.equal(mixedPcm.length, samples * 8);
	assert.ok(
		decoded.length >= samples * 8 && decoded.length < (samples + 882) * 8,
		`Unexpected graph editor audio length ${decoded.length / 8}`,
	);
	const expectedPcm = Buffer.alloc(samples * 8);
	for (let i = 0; i < samples; i++)
		for (let c = 0; c < 2; c++)
			expectedPcm.writeFloatLE(expectedTimelineSample(i, c), i * 8 + c * 4);
	writeFileSync(join(artifact, "independent-oracle.f32le"), expectedPcm);
	const channels = [];
	for (let channel = 0; channel < 2; channel++) {
		const sections = [
			[0, 1764],
			[1764, 3528],
			[3528, 12348],
			[12348, samples],
		];
		const sectionRms = sections.map(([start, end]) => {
			let error = 0;
			for (let i = start; i < end; i++)
				error +=
					(decoded.readFloatLE(i * 8 + channel * 4) -
						expectedTimelineSample(i, channel)) **
					2;
			return Math.sqrt(error / (end - start));
		});
		let bestLag = 0,
			bestCorrelation = -1;
		for (let lag = -64; lag <= 64; lag++) {
			let cross = 0,
				actualEnergy = 0,
				expectedEnergy = 0;
			for (let i = 2100; i < 11900; i++) {
				const x = expectedTimelineSample(i, channel),
					y = decoded.readFloatLE((i + lag) * 8 + channel * 4);
				cross += x * y;
				actualEnergy += y * y;
				expectedEnergy += x * x;
			}
			const correlation = cross / Math.sqrt(actualEnergy * expectedEnergy);
			if (correlation > bestCorrelation) {
				bestCorrelation = correlation;
				bestLag = lag;
			}
		}
		let earlySilencePeak = 0,
			lateSilencePeak = 0,
			mixedMaxError = 0;
		for (let i = 0; i < decoded.length / 8; i++) {
			const value = Math.abs(decoded.readFloatLE(i * 8 + channel * 4));
			if (i < 1200) earlySilencePeak = Math.max(earlySilencePeak, value);
			if (i >= 12800) lateSilencePeak = Math.max(lateSilencePeak, value);
			if (i < samples)
				mixedMaxError = Math.max(
					mixedMaxError,
					Math.abs(
						mixedPcm.readFloatLE(i * 8 + channel * 4) -
							expectedTimelineSample(i, channel),
					),
				);
		}
		channels.push({
			sectionRms,
			bestLagSamples: bestLag,
			bestCorrelation,
			earlySilencePeak,
			lateSilencePeak,
			mixedMaxError,
		});
	}
	const result = {
		picture,
		decodedSamples: decoded.length / 8,
		sourceSamples: samples,
		codecPaddingSamples: decoded.length / 8 - samples,
		channels,
	};
	writeFileSync(
		join(artifact, "decode-measurements.json"),
		JSON.stringify(result, null, 2),
	);
	for (const channel of channels) {
		assert.ok(
			channel.sectionRms.every((value) => value < 0.008),
			`Independent decoded graph RMS ${JSON.stringify(channel)}`,
		);
		assert.ok(
			Math.abs(channel.bestLagSamples) <= 1 && channel.bestCorrelation > 0.99,
			`Graph export source alignment ${JSON.stringify(channel)}`,
		);
		assert.ok(
			channel.earlySilencePeak < 0.001 && channel.lateSilencePeak < 0.001,
			`Graph export silent boundaries ${JSON.stringify(channel)}`,
		);
		assert.ok(
			channel.mixedMaxError < 3e-6,
			`Graph mixed PCM differs from independent oracle ${JSON.stringify(channel)}`,
		);
	}
	return result;
}
