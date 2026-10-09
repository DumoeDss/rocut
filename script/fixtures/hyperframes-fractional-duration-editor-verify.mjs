import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { durationEditorAudioMeasurements } from "./hyperframes-fractional-duration-editor-audio-verify.mjs";

/** Decodes the actual SceneExporter artifact with an independent FFmpeg binary.
 * The expected timeline was built before production rendering from original
 * native preparation/FX; no alignment repair, filtering or production PCM oracle. */
export function verifyDurationEditorExport({
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
		),
		audio = metadata.streams.find((stream) => stream.codec_type === "audio");
	assert.equal(video?.nb_read_frames, "21");
	assert.equal(video?.width, 64);
	assert.equal(video?.height, 64);
	assert.equal(audio?.codec_name, "opus");
	assert.equal(audio?.channels, 2);
	assert.equal(audio?.sample_rate, "48000");
	const rgb = execFileSync(
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
	assert.equal(rgb.length, 21 * 64 * 64 * 3);
	writeFileSync(join(artifact, "decoded.rgb24"), rgb);
	const picture = [];
	for (let frame = 0; frame < 21; frame++) {
		const points =
			frame >= 2 && frame < 18
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
					`Fractional duration editor picture ${frame} at ${x},${y}: ${actual} instead of ${expected}`,
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
			"0.24",
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
	const expected = readFileSync(join(artifact, "host/expected-timeline.f32le"));
	assert.equal(expected.length, 37044 * 8);
	assert.equal(mixedPcm.length, expected.length);
	assert.ok(
		decoded.length >= expected.length &&
			decoded.length < expected.length + 882 * 8,
		`Unexpected encoded duration ${decoded.length / 8}`,
	);
	const channels = durationEditorAudioMeasurements(decoded, expected, mixedPcm);
	const result = {
		picture,
		decodedFrames: decoded.length / 8,
		timelineFrames: 37044,
		codecPaddingFrames: decoded.length / 8 - 37044,
		channels,
	};
	writeFileSync(
		join(artifact, "decode-measurements.json"),
		JSON.stringify(result, null, 2),
	);
	for (const channel of channels) {
		assert.ok(
			channel.mixedMaximum < 3e-6,
			`Pre-encode independent PCM mismatch ${JSON.stringify(channel)}`,
		);
		assert.ok(
			channel.sectionRms.every((value) => value < 0.01),
			`Decoded independent RMS ${JSON.stringify(channel)}`,
		);
		assert.ok(
			Math.abs(channel.bestLagSamples) <= 1 && channel.bestCorrelation > 0.96,
			`Encoded source alignment ${JSON.stringify(channel)}`,
		);
		assert.ok(
			channel.earlySilencePeak < 0.001 && channel.lateSilencePeak < 0.001,
			`Encoded silent boundaries ${JSON.stringify(channel)}`,
		);
	}
	return result;
}
