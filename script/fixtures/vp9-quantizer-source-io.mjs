import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	FPS,
	FRAME_COUNT,
	WIDTH,
	HEIGHT,
	compareDecoderFrames,
	rgbaToRgb,
	sha256,
} from "./master-encoder-analysis.mjs";
import {
	packetHashesFromProbe,
	probeQuantizerVideo,
} from "./master-encoder-quantizer-io.mjs";
import { assertAdapterInputs, AUDIO } from "./vp9-quantizer-source-cases.mjs";
import {
	analyseCompanionAudio,
	pcmFloat32,
} from "./vp9-quantizer-source-audio.mjs";

import {
	vp9Header,
	assertContainerTiming,
} from "./vp9-quantizer-source-assertions.mjs";
const subprocessOptions = {
	windowsHide: true,
	timeout: 30000,
	maxBuffer: 8 * 1024 * 1024,
};
export async function persistAdapterCase({
	evidence,
	testCase,
	source,
	originalPacketHashes,
	directory,
	ffmpeg,
	ffprobe,
}) {
	await writeFile(
		join(directory, "browser-evidence.json"),
		JSON.stringify(evidence),
		{ flag: "wx" },
	);
	assertAdapterInputs(evidence, testCase);
	const webm = Buffer.from(evidence.webm);
	const path = join(directory, "encoded.webm");
	await writeFile(path, webm, { flag: "wx" });
	const metadata = probeQuantizerVideo(ffprobe, path);
	const packetHashes = evidence.packetWrites.map((packet) =>
		sha256(Buffer.from(packet.bytes)),
	);
	assert.deepEqual(
		packetHashesFromProbe(metadata),
		packetHashes,
		"FFprobe container payloads must equal the public packet-source writes",
	);
	assert.deepEqual(
		evidence.demuxed.map((packet) => sha256(Buffer.from(packet.bytes))),
		packetHashes,
	);
	assertContainerTiming(metadata.packets);
	assertContainerTiming(evidence.demuxed);
	const stream = metadata.streams[0];
	assert.equal(stream.width, WIDTH);
	assert.equal(stream.height, HEIGHT);
	assert.equal(Number(stream.nb_read_frames), FRAME_COUNT);
	assert.equal(stream.pix_fmt, testCase.expectedPixelFormat);
	const headers = evidence.packetWrites.map((packet) =>
		vp9Header(packet.bytes),
	);
	assert.ok(
		headers.every((header) => header.profile === (testCase.profile ?? 0)),
	);
	assert.equal(headers[0].keyframe, true);
	const allStreams = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_streams", "-of", "json", path],
			subprocessOptions,
		),
	);
	const audio = allStreams.streams.find(
		(entry) => entry.codec_type === "audio",
	);
	assert.equal(audio.codec_name, "opus");
	assert.equal(Number(audio.sample_rate), AUDIO.sampleRate);
	assert.equal(audio.channels, AUDIO.channels);
	const audioPcm = execFileSync(
		ffmpeg,
		["-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le", "pipe:1"],
		subprocessOptions,
	);
	const audioDecodedFrames = audioPcm.length / 4;
	const audioTiming = analyseCompanionAudio(pcmFloat32(audioPcm));
	await writeFile(
		join(directory, "audio-timing.json"),
		JSON.stringify(audioTiming, null, 2),
		{ flag: "wx" },
	);
	assert.equal(
		audioTiming.passed,
		true,
		"Companion audio failed its independent unshifted timing/content gates",
	);
	// This companion track exercises mux scheduling. Opus's last 20ms packet
	// can include native flush padding; it is recorded, not called exact duration.
	assert.ok(
		audioDecodedFrames >= AUDIO.frames &&
			audioDecodedFrames < AUDIO.frames + AUDIO.sampleRate / 50,
		"Companion audio is truncated or exceeds one Opus packet of tail padding",
	);
	const ffmpegRgb = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			path,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		subprocessOptions,
	);
	assert.equal(evidence.decoded.length, FRAME_COUNT);
	const decodedForMetric = evidence.decoded.map((frame, index) => {
		assert.ok(Math.abs(frame.containerTimestamp - index / FPS) <= 0.001);
		return { ...frame, timestamp: Math.trunc((index / FPS) * 1e6) };
	});
	// Only the metric's frame association uses the original clock. Actual demux
	// timestamps remain separately recorded and checked at container resolution.
	const observations = compareDecoderFrames(ffmpegRgb, decodedForMetric);
	const chromiumRgb = Buffer.concat(
		evidence.decoded.map((frame) => rgbaToRgb(frame.rgba)),
	);
	const ffmpegPassed = observations.every((row) => row.ffmpegPassed);
	const chromiumPassed = observations.every((row) => row.chromiumPassed);
	if (testCase.expectOriginalGate) {
		assert.equal(ffmpegPassed, true);
		assert.equal(chromiumPassed, true);
	} else {
		assert.equal(
			ffmpegPassed,
			false,
			"Original failing control must remain detectable",
		);
		assert.equal(chromiumPassed, false);
	}
	if (!testCase.adapter) {
		assert.deepEqual(
			packetHashes,
			originalPacketHashes,
			"Unchanged CanvasSource baseline must reproduce original native payloads",
		);
		assert.deepEqual(ffmpegRgb, source.originalDecoded);
	}
	const result = {
		name: testCase.name,
		adapter: testCase.adapter,
		profile: testCase.profile,
		quantizer: testCase.quantizer,
		packetHashes,
		packetHeaders: headers,
		video: stream,
		audio,
		audioDecodedFrames,
		audioTailPaddingFrames: audioDecodedFrames - AUDIO.frames,
		audioTiming,
		audioDecodedSha256: sha256(audioPcm),
		ffmpegRgbSha256: sha256(ffmpegRgb),
		chromiumRgbSha256: sha256(chromiumRgb),
		containerSha256: sha256(webm),
		ffmpegPassed,
		chromiumPassed,
		observations,
		lifecycle: evidence.lifecycle,
		flushCount: evidence.flushCount,
		nativeEncodeQueuePeak: evidence.nativeEncodeQueuePeak,
		pendingMuxWritePeak: evidence.pendingMuxWritePeak,
		sourceSecondsTimingPreserved: testCase.adapter,
		containerTimingResolutionSeconds: 0.001,
	};
	await Promise.all([
		writeFile(join(directory, "audio-decoded.f32le"), audioPcm, { flag: "wx" }),
		writeFile(join(directory, "ffmpeg.rgb"), ffmpegRgb, { flag: "wx" }),
		writeFile(join(directory, "chromium.rgb"), chromiumRgb, { flag: "wx" }),
		writeFile(
			join(directory, "ffprobe.json"),
			JSON.stringify(allStreams, null, 2),
			{ flag: "wx" },
		),
		writeFile(
			join(directory, "verification.json"),
			JSON.stringify(result, null, 2),
			{ flag: "wx" },
		),
	]);
	return result;
}
