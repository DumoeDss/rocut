import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	sha256,
	sourceRgba,
	oracleRgba,
	rgbaToRgb,
	packetsToIvf,
	compareDecoderFrames,
} from "./master-encoder-analysis.mjs";
import { assertActualQuantizerOptions } from "./master-encoder-quantizer-cases.mjs";

const options = {
	windowsHide: true,
	timeout: 30000,
	maxBuffer: 8 * 1024 * 1024,
};
export const packetHashesFromProbe = (metadata) =>
	metadata.packets.map((packet) =>
		packet.data_hash.replace(/^SHA256:/, "").toLowerCase(),
	);
export function probeQuantizerVideo(ffprobe, path) {
	return JSON.parse(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-count_frames",
				"-show_streams",
				"-show_packets",
				"-show_data_hash",
				"sha256",
				"-of",
				"json",
				path,
			],
			options,
		),
	);
}

export async function loadQuantizerSource(directory, ffprobe) {
	const raw = await readFile(join(directory, "encoder-inputs-raw.json"));
	assert.equal(
		sha256(raw),
		"3767c360b44c6bb69b8508291a53e9c01021f47737158440c0cf9aa66de3ff8a",
	);
	const trace = JSON.parse(raw.toString("utf8"));
	const frames = trace.records.filter((record) => record.kind === "encode");
	const configurations = trace.records.filter(
		(record) => record.kind === "configure",
	);
	assert.equal(configurations.length, 1);
	assert.equal(frames.length, FRAME_COUNT);
	for (const [index, frame] of frames.entries()) {
		assert.equal(frame.timestamp, Math.trunc((index / FPS) * 1e6));
		assert.deepEqual(sourceRgba(frame), oracleRgba(FIRST_FRAME + index));
	}
	const originalVideo = join(directory, "master-effects.webm");
	const originalVideoSha256 = sha256(await readFile(originalVideo));
	assert.equal(
		originalVideoSha256,
		"2389638c47f03e1b3ded4e3a391e79d8d1d3b574b53fa18918bb916f5b671ca6",
	);
	const originalDecoded = await readFile(join(directory, "decoded.rgb"));
	assert.equal(
		sha256(originalDecoded),
		"fb3da766f59a81396f880fb756260e6cf257fd52544fd4c94805e3f1cdc3e74a",
	);
	const originalMetadata = probeQuantizerVideo(ffprobe, originalVideo);
	assert.equal(originalMetadata.packets.length, FRAME_COUNT);
	return {
		frames,
		config: configurations[0].config,
		originalDecoded,
		originalPacketHashes: packetHashesFromProbe(originalMetadata),
		originalMetadata,
		identity: {
			directory,
			rawInputsSha256: sha256(raw),
			originalVideoSha256,
			originalDecodedRgbSha256: sha256(originalDecoded),
		},
	};
}

export async function persistQuantizerCase({
	evidence,
	testCase,
	source,
	directory,
	ffmpeg,
	ffprobe,
}) {
	await writeFile(
		join(directory, "native-evidence.json"),
		JSON.stringify(evidence, null, 2),
		{ flag: "wx" },
	);
	if (!evidence.supported || evidence.error)
		return {
			name: testCase.name,
			profile: testCase.profile,
			quantizer: testCase.quantizer,
			supported: evidence.supported,
			error: evidence.error,
			requestedConfig: testCase.config,
			support: evidence.support,
			actualConfigure: evidence.actualConfigure,
			configureSucceeded: evidence.configureSucceeded,
			actualEncodeOptions: evidence.actualEncodeOptions,
		};
	assertActualQuantizerOptions(evidence, testCase);
	const packetHashes = evidence.packets.map((packet) =>
		sha256(Buffer.from(packet.bytes)),
	);
	const ivf = packetsToIvf(evidence.packets),
		video = join(directory, "encoded.ivf");
	await writeFile(video, ivf, { flag: "wx" });
	const metadata = probeQuantizerVideo(ffprobe, video);
	assert.deepEqual(packetHashesFromProbe(metadata), packetHashes);
	const stream = metadata.streams[0];
	assert.equal(stream.width, WIDTH);
	assert.equal(stream.height, HEIGHT);
	assert.equal(Number(stream.nb_read_frames), FRAME_COUNT);
	assert.equal(stream.pix_fmt, testCase.expectedPixelFormat);
	assert.equal(stream.r_frame_rate, `${FPS}/1`);
	const ffmpegRgb = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			video,
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
	const chromiumRgb = Buffer.concat(
		evidence.decoded.map((frame) => rgbaToRgb(frame.rgba)),
	);
	const observations = compareDecoderFrames(ffmpegRgb, evidence.decoded);
	const result = {
		name: testCase.name,
		profile: testCase.profile,
		quantizer: testCase.quantizer,
		supported: true,
		actualConfigure: evidence.actualConfigure,
		actualEncodeOptions: evidence.actualEncodeOptions,
		support: evidence.support,
		decoderConfig: evidence.decoderConfig,
		pixelFormat: stream.pix_fmt,
		colorSpace: stream.color_space,
		colorRange: stream.color_range,
		packetHashes,
		ivfSha256: sha256(ivf),
		encodedPayloadBytes: evidence.packets.reduce(
			(total, packet) => total + packet.bytes.length,
			0,
		),
		ffmpegRgbSha256: sha256(ffmpegRgb),
		chromiumRgbSha256: sha256(chromiumRgb),
		originalPacketsReproduced:
			JSON.stringify(packetHashes) ===
			JSON.stringify(source.originalPacketHashes),
		originalFfmpegDecodedReproduced: ffmpegRgb.equals(source.originalDecoded),
		ffmpegAllFramesUnderOriginalGate: observations.every(
			(row) => row.ffmpegPassed,
		),
		chromiumAllFramesUnderOriginalGate: observations.every(
			(row) => row.chromiumPassed,
		),
		observations,
	};
	await Promise.all([
		writeFile(join(directory, "ffmpeg.rgb"), ffmpegRgb, { flag: "wx" }),
		writeFile(join(directory, "chromium.rgb"), chromiumRgb, { flag: "wx" }),
		writeFile(
			join(directory, "ffprobe.json"),
			JSON.stringify(metadata, null, 2),
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
