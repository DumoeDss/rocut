import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** No sample alignment repair: lossless checks use the independent oracle;
 * lossy decode gets an independent lag measurement, never an adjusted oracle. */
export function verifyExportTimingEditor({
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
	const run = (args) => execFileSync(ffmpeg, ["-v", "error", ...args], native);
	const save = (name, body) =>
		writeFileSync(join(artifact, name), body, { flag: "wx" });
	const metadata = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-count_frames", "-show_streams", "-of", "json", file],
			native,
		),
	);
	save("ffprobe.json", JSON.stringify(metadata, null, 2));
	const video = metadata.streams.find((s) => s.codec_type === "video"),
		audio = metadata.streams.find((s) => s.codec_type === "audio");
	assert.equal(video?.nb_read_frames, "30");
	assert.equal(video?.width, 64);
	assert.equal(video?.height, 64);
	assert.equal(audio?.codec_name, "opus");
	assert.equal(audio?.channels, 2);
	assert.equal(audio?.sample_rate, "48000");
	const rgb = run([
		"-i",
		file,
		"-map",
		"0:v:0",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgb24",
		"pipe:1",
	]);
	assert.equal(rgb.length, 30 * 64 * 64 * 3);
	save("decoded.rgb24", rgb);
	const picture = [];
	for (let frame = 0; frame < 30; frame++) {
		const points =
			frame >= 2 && frame < 27
				? [
						[8 + Math.min((frame - 1) * 4, 32), 32, [233, 69, 96]],
						[60, 60, [22, 33, 62]],
						[2, 32, [22, 33, 62]],
					]
				: [
						[32, 32, [0, 0, 0]],
						[60, 60, [0, 0, 0]],
					];
		for (const [x, y, expected] of points) {
			const offset = (frame * 64 * 64 + y * 64 + x) * 3,
				actual = [...rgb.subarray(offset, offset + 3)];
			for (let c = 0; c < 3; c++)
				assert.ok(
					Math.abs(actual[c] - expected[c]) <= 8,
					`Explicit timing picture ${frame}@${x},${y}: ${actual} != ${expected}`,
				);
			picture.push({ frame, x, y, actual, expected });
		}
	}
	run([
		"-ss",
		"0.24",
		"-i",
		file,
		"-frames:v",
		"1",
		join(artifact, "preview.png"),
	]);
	const decoded = run([
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
	]);
	save("decoded.f32le", decoded);
	const expected = readFileSync(join(artifact, "host/expected-timeline.f32le"));
	assert.equal(expected.length, 52920 * 8);
	assert.equal(mixedPcm.length, expected.length);
	assert.ok(
		decoded.length >= expected.length &&
			decoded.length < expected.length + 882 * 8,
		"Unexpected encoded duration",
	);
	const channels = measure(decoded, expected, mixedPcm);
	const result = {
		picture,
		decodedFrames: decoded.length / 8,
		timelineFrames: 52920,
		codecPaddingFrames: decoded.length / 8 - 52920,
		channels,
	};
	save("decode-measurements.json", JSON.stringify(result, null, 2));
	for (const c of channels) {
		assert.ok(
			c.mixedMaximum < 3e-6,
			`Pre-encode oracle mismatch: ${JSON.stringify(c)}`,
		);
		assert.ok(
			c.sectionRms.every((v) => v < 0.01),
			`Decoded RMS: ${JSON.stringify(c)}`,
		);
		assert.ok(
			Math.abs(c.bestLagSamples) <= 1 && c.bestCorrelation > 0.96,
			`Encoded alignment: ${JSON.stringify(c)}`,
		);
		assert.ok(
			c.earlySilencePeak < 0.001 && c.lateSilencePeak < 0.001,
			`Encoded boundaries: ${JSON.stringify(c)}`,
		);
	}
	return result;
}
function measure(decoded, expected, mixed) {
	const channels = [];
	for (let c = 0; c < 2; c++) {
		const sections = [
			[0, 5292],
			[5292, 7056],
			[7056, 29988],
			[29988, 41454],
			[41454, 43659],
			[43659, 52920],
		];
		const sectionRms = sections.map(([start, end]) => {
			let square = 0;
			for (let i = start; i < end; i++)
				square +=
					(decoded.readFloatLE(i * 8 + c * 4) -
						expected.readFloatLE(i * 8 + c * 4)) **
					2;
			return Math.sqrt(square / (end - start));
		});
		let bestLagSamples = 0,
			bestCorrelation = -1,
			mixedMaximum = 0,
			earlySilencePeak = 0,
			lateSilencePeak = 0;
		for (let lag = -64; lag <= 64; lag++) {
			let cross = 0,
				energyActual = 0,
				energyExpected = 0;
			for (let i = 5600; i < 41000; i++) {
				const x = expected.readFloatLE(i * 8 + c * 4),
					y = decoded.readFloatLE((i + lag) * 8 + c * 4);
				cross += x * y;
				energyActual += y * y;
				energyExpected += x * x;
			}
			const correlation = cross / Math.sqrt(energyActual * energyExpected);
			if (correlation > bestCorrelation) {
				bestCorrelation = correlation;
				bestLagSamples = lag;
			}
		}
		for (let i = 0; i < decoded.length / 8; i++) {
			const value = Math.abs(decoded.readFloatLE(i * 8 + c * 4));
			if (i < 4700) earlySilencePeak = Math.max(earlySilencePeak, value);
			if (i >= 43659) lateSilencePeak = Math.max(lateSilencePeak, value);
			if (i < 52920)
				mixedMaximum = Math.max(
					mixedMaximum,
					Math.abs(
						mixed.readFloatLE(i * 8 + c * 4) -
							expected.readFloatLE(i * 8 + c * 4),
					),
				);
		}
		channels.push({
			sectionRms,
			bestLagSamples,
			bestCorrelation,
			mixedMaximum,
			earlySilencePeak,
			lateSilencePeak,
		});
	}
	return channels;
}
