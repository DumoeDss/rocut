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
import { AUDIO } from "./vp9-quantizer-source-cases.mjs";
import {
	analyseCompanionAudio,
	pcmFloat32,
} from "./vp9-quantizer-source-audio.mjs";
import {
	assertContainerTiming,
	vp9Header,
} from "./vp9-quantizer-source-assertions.mjs";
import { assertEditorInputs } from "./vp9-quantizer-editor-assertions.mjs";

export async function persistEditorCase({
	evidence,
	testCase,
	source,
	originalPacketHashes,
	directory,
	ffmpeg,
	ffprobe,
}) {
	const save = (name, value) =>
		writeFile(join(directory, name), value, { flag: "wx" });
	await save("browser-evidence.json", JSON.stringify(evidence));
	assertEditorInputs(evidence, testCase, source);
	const webm = Buffer.from(evidence.webm),
		path = join(directory, "encoded.webm");
	await save("encoded.webm", webm);
	const metadata = probeQuantizerVideo(ffprobe, path);
	const writtenPackets = testCase.adapter
		? evidence.packetWrites
		: evidence.nativePackets;
	const packetHashes = writtenPackets.map((packet) =>
		sha256(Buffer.from(packet.bytes)),
	);
	assert.deepEqual(packetHashesFromProbe(metadata), packetHashes);
	assert.deepEqual(
		evidence.demuxed.map((packet) => sha256(Buffer.from(packet.bytes))),
		packetHashes,
	);
	assertContainerTiming(metadata.packets);
	assertContainerTiming(evidence.demuxed);
	const video = metadata.streams[0];
	assert.equal(video.width, WIDTH);
	assert.equal(video.height, HEIGHT);
	assert.equal(Number(video.nb_read_frames), FRAME_COUNT);
	assert.equal(video.pix_fmt, testCase.expectedPixelFormat);
	const headers = writtenPackets.map((packet) => vp9Header(packet.bytes));
	assert.ok(
		headers.every((header) => header.profile === (testCase.profile ?? 0)),
	);
	assert.equal(headers[0].keyframe, true);
	const options = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 8 * 1024 * 1024,
	};
	const streams = JSON.parse(
		execFileSync(
			ffprobe,
			["-v", "error", "-show_streams", "-of", "json", path],
			options,
		),
	);
	const audio = streams.streams.find((stream) => stream.codec_type === "audio");
	assert.equal(audio.codec_name, "opus");
	assert.equal(Number(audio.sample_rate), AUDIO.sampleRate);
	assert.equal(audio.channels, AUDIO.channels);
	const audioPcm = execFileSync(
		ffmpeg,
		["-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le", "pipe:1"],
		options,
	);
	const audioTiming = analyseCompanionAudio(pcmFloat32(audioPcm));
	await save("audio-timing.json", JSON.stringify(audioTiming, null, 2));
	assert.equal(
		audioTiming.passed,
		true,
		"Real exporter companion audio failed original unshifted/tail gates",
	);
	const audioDecodedFrames = audioPcm.length / 4;
	assert.ok(
		audioDecodedFrames >= AUDIO.frames &&
			audioDecodedFrames < AUDIO.frames + AUDIO.sampleRate / 50,
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
		options,
	);
	assert.equal(evidence.decoded.length, FRAME_COUNT);
	const metricFrames = evidence.decoded.map((frame, index) => {
		assert.ok(Math.abs(frame.containerTimestamp - index / FPS) <= 0.001);
		return { ...frame, timestamp: Math.trunc((index / FPS) * 1e6) };
	});
	const observations = compareDecoderFrames(ffmpegRgb, metricFrames);
	const chromiumRgb = Buffer.concat(
		evidence.decoded.map((frame) => rgbaToRgb(frame.rgba)),
	);
	const ffmpegPassed = observations.every((row) => row.ffmpegPassed),
		chromiumPassed = observations.every((row) => row.chromiumPassed);
	assert.equal(
		ffmpegPassed,
		testCase.expectOriginalGate,
		"Real exporter FFmpeg original gate changed",
	);
	assert.equal(
		chromiumPassed,
		testCase.expectOriginalGate,
		"Real exporter Chromium original gate changed",
	);
	if (!testCase.adapter) {
		assert.deepEqual(
			packetHashes,
			originalPacketHashes,
			"Default real exporter must reproduce original Canvas native payloads",
		);
		assert.deepEqual(ffmpegRgb, source.originalDecoded);
	}
	const result = {
		name: testCase.name,
		quantizer: testCase.quantizer,
		profile: testCase.profile,
		rustRequest: evidence.rustRequest,
		rustResponse: evidence.rustResponse,
		actualConfigure: evidence.actualConfigure,
		packetHashes,
		packetHeaders: headers,
		video,
		audio,
		audioTiming,
		audioDecodedFrames,
		audioTailPaddingFrames: audioDecodedFrames - AUDIO.frames,
		audioDecodedSha256: sha256(audioPcm),
		ffmpegRgbSha256: sha256(ffmpegRgb),
		chromiumRgbSha256: sha256(chromiumRgb),
		containerSha256: sha256(webm),
		ffmpegPassed,
		chromiumPassed,
		observations,
		lifecycle: evidence.lifecycle,
		nativeEncodeQueuePeak: evidence.nativeEncodeQueuePeak,
		pendingMuxWritePeak: evidence.pendingMuxWritePeak,
		sourceSecondsTimingPreserved: testCase.adapter,
		containerTimingResolutionSeconds: 0.001,
	};
	await Promise.all([
		save("ffmpeg.rgb", ffmpegRgb),
		save("chromium.rgb", chromiumRgb),
		save("audio-decoded.f32le", audioPcm),
		save("ffprobe.json", JSON.stringify(streams, null, 2)),
		save("verification.json", JSON.stringify(result, null, 2)),
	]);
	return result;
}
