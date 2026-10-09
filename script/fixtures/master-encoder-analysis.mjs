import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	interior,
	temporalColor,
} from "./master-effects-browser-oracle.ts";

export { WIDTH, HEIGHT, FPS, FIRST_FRAME, FRAME_COUNT };
export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const FACTORS = [
	{ name: "baseline", patch: {} },
	{ name: "latency-quality", patch: { latencyMode: "quality" } },
	{ name: "latency-realtime", patch: { latencyMode: "realtime" } },
	{ name: "bitrate-constant", patch: { bitrateMode: "constant" } },
	{ name: "bitrate-variable", patch: { bitrateMode: "variable" } },
	{ name: "bitrate-10x", patch: { bitrate: 560000 } },
];
export const CHROMA_BITRATE_FACTORS = [
	{ name: "baseline", patch: {}, expectedPixelFormat: "yuv420p" },
	{
		name: "profile0-base-budget",
		patch: { codec: "vp09.00.30.08" },
		expectedPixelFormat: "yuv420p",
	},
	{
		name: "profile0-high-budget",
		patch: { codec: "vp09.00.30.08", bitrate: 5600000 },
		expectedPixelFormat: "yuv420p",
	},
	{
		name: "profile1-base-budget",
		patch: { codec: "vp09.01.30.08" },
		expectedPixelFormat: "yuv444p",
	},
	{
		name: "profile1-high-budget",
		patch: { codec: "vp09.01.30.08", bitrate: 5600000 },
		expectedPixelFormat: "yuv444p",
	},
];
export const CHROMA_BITRATE_PAIRS = [
	["profile0-base-budget", "profile0-high-budget", "bitrate"],
	["profile0-base-budget", "profile1-base-budget", "codec"],
	["profile0-high-budget", "profile1-high-budget", "codec"],
	["profile1-base-budget", "profile1-high-budget", "bitrate"],
];
export const VP9_CODEC_SPECIFICATION = {
	url: "https://www.webmproject.org/vp9/mp4/",
	shortProfile1Rejection:
		"Omitted optional fields default to 4:2:0, which is incompatible with profile 1. Optional chroma and color fields must be present together. Profile 0 uses 4:2:0; profile 1 permits 4:2:2 or 4:4:4.",
	matchedDesign:
		"Use level 30 in every factorial cell; change profile 0/chroma 1 together to profile 1/chroma 3. Hold primaries, transfer, matrix and range at their explicit short-string defaults (1,1,1,0).",
};
export const CHROMA_BITRATE_FULL_FACTORS = [
	{ name: "baseline", patch: {}, expectedPixelFormat: "yuv420p" },
	{
		name: "level-only-control",
		patch: { codec: "vp09.00.30.08" },
		expectedPixelFormat: "yuv420p",
	},
	{
		name: "profile0-base-budget",
		patch: { codec: "vp09.00.30.08.01.01.01.01.00" },
		expectedPixelFormat: "yuv420p",
	},
	{
		name: "profile0-high-budget",
		patch: { codec: "vp09.00.30.08.01.01.01.01.00", bitrate: 5600000 },
		expectedPixelFormat: "yuv420p",
	},
	{
		name: "profile1-base-budget",
		patch: { codec: "vp09.01.30.08.03.01.01.01.00" },
		expectedPixelFormat: "yuv444p",
	},
	{
		name: "profile1-high-budget",
		patch: { codec: "vp09.01.30.08.03.01.01.01.00", bitrate: 5600000 },
		expectedPixelFormat: "yuv444p",
	},
];

export function vp9CodecFields(codec) {
	const parts = codec.split(".");
	assert.equal(parts[0], "vp09");
	assert.ok(
		parts.length === 4 || parts.length === 9,
		"VP9 optional group must be complete",
	);
	const defaults = [1, 1, 1, 1, 0];
	const values = [
		...parts.slice(1).map(Number),
		...(parts.length === 4 ? defaults : []),
	];
	return Object.fromEntries(
		[
			"profile",
			"level",
			"bitDepth",
			"chromaSubsampling",
			"colourPrimaries",
			"transferCharacteristics",
			"matrixCoefficients",
			"videoFullRangeFlag",
		].map((key, index) => [key, values[index]]),
	);
}

export function controlledComparisons(results) {
	return CHROMA_BITRATE_PAIRS.map(([from, to, changedField]) => {
		const original = results.find((result) => result.factor.name === from);
		const variant = results.find((result) => result.factor.name === to);
		if (!original?.actualConfigure || !variant?.actualConfigure)
			return { from, to, changedField, supported: false };
		const changed = Object.keys({
			...original.actualConfigure,
			...variant.actualConfigure,
		}).filter(
			(key) => original.actualConfigure[key] !== variant.actualConfigure[key],
		);
		assert.deepEqual(
			changed,
			[changedField],
			"Causal pair must differ in exactly its declared field",
		);
		const originalCodecFields = vp9CodecFields(original.actualConfigure.codec);
		const variantCodecFields = vp9CodecFields(variant.actualConfigure.codec);
		const codecFieldChanges = Object.keys(originalCodecFields).filter(
			(key) => originalCodecFields[key] !== variantCodecFields[key],
		);
		if (changedField === "codec") {
			assert.deepEqual(
				codecFieldChanges,
				["profile", "chromaSubsampling"],
				"Matched chroma pair must only change its legally bound profile/subsampling fields",
			);
		} else assert.deepEqual(codecFieldChanges, []);
		return {
			from,
			to,
			changedField,
			originalCodecFields,
			variantCodecFields,
			codecFieldChanges,
			supported: true,
			originalValue: original.actualConfigure[changedField],
			variantValue: variant.actualConfigure[changedField],
			originalPayloadBytes: original.encodedPayloadBytes,
			variantPayloadBytes: variant.encodedPayloadBytes,
			originalFfmpegMae: original.observations.map(
				(row) => row.ffmpegToOracle.interiorRgbMae,
			),
			variantFfmpegMae: variant.observations.map(
				(row) => row.ffmpegToOracle.interiorRgbMae,
			),
			originalChromiumMae: original.observations.map(
				(row) => row.chromiumToOracle.interiorRgbMae,
			),
			variantChromiumMae: variant.observations.map(
				(row) => row.chromiumToOracle.interiorRgbMae,
			),
		};
	});
}

export function sourceRgba(frame) {
	assert.equal(frame.format, "BGRA");
	assert.equal(frame.codedWidth, WIDTH);
	assert.equal(frame.codedHeight, HEIGHT);
	assert.deepEqual(frame.layout, [{ offset: 0, stride: WIDTH * 4 }]);
	assert.equal(frame.bytes.length, WIDTH * HEIGHT * 4);
	const rgba = Buffer.from(frame.bytes);
	for (let i = 0; i < rgba.length; i += 4)
		[rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
	return rgba;
}

export function oracleRgba(sceneFrame) {
	const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++)
			rgba.set([...temporalColor(x, y, sceneFrame), 255], (y * WIDTH + x) * 4);
	return rgba;
}

export function rgbaToRgb(rgba) {
	assert.equal(rgba.length, WIDTH * HEIGHT * 4);
	const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
	for (let i = 0; i < WIDTH * HEIGHT; i++)
		for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c];
	return rgb;
}

/** IVF stores the same VP9 packet payloads; frame timestamps are in a 1/FPS time base. */
export function packetsToIvf(packets) {
	assert.equal(packets.length, FRAME_COUNT);
	const header = Buffer.alloc(32);
	header.write("DKIF", 0, "ascii");
	header.writeUInt16LE(0, 4);
	header.writeUInt16LE(32, 6);
	header.write("VP90", 8, "ascii");
	header.writeUInt16LE(WIDTH, 12);
	header.writeUInt16LE(HEIGHT, 14);
	header.writeUInt32LE(FPS, 16);
	header.writeUInt32LE(1, 20);
	header.writeUInt32LE(packets.length, 24);
	return Buffer.concat([
		header,
		...packets.flatMap((packet, index) => {
			assert.equal(packet.timestamp, Math.trunc((index / FPS) * 1e6));
			const bytes = Buffer.from(packet.bytes),
				entry = Buffer.alloc(12);
			entry.writeUInt32LE(bytes.length, 0);
			entry.writeBigUInt64LE(BigInt(index), 4);
			return [entry, bytes];
		}),
	]);
}

export function rgbMetrics(actual, expected) {
	assert.equal(actual.length, WIDTH * HEIGHT * 3);
	assert.equal(expected.length, actual.length);
	let all = 0,
		interiorSum = 0,
		count = 0,
		maximum = 0;
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++)
			for (let c = 0; c < 3; c++) {
				const index = (y * WIDTH + x) * 3 + c;
				const error = Math.abs(actual[index] - expected[index]);
				all += error;
				maximum = Math.max(maximum, error);
				if (interior(x, y)) {
					interiorSum += error;
					count++;
				}
			}
	return {
		fullRgbMae: all / actual.length,
		interiorRgbMae: interiorSum / count,
		maximumChannelError: maximum,
	};
}

export function compareDecoderFrames(ffmpegRgb, browserFrames) {
	assert.equal(ffmpegRgb.length, WIDTH * HEIGHT * 3 * FRAME_COUNT);
	assert.equal(browserFrames.length, FRAME_COUNT);
	return browserFrames.map((frame, index) => {
		assert.equal(frame.timestamp, Math.trunc((index / FPS) * 1e6));
		const oracle = rgbaToRgb(oracleRgba(FIRST_FRAME + index));
		const chromium = rgbaToRgb(frame.rgba);
		const ffmpeg = ffmpegRgb.subarray(
			index * WIDTH * HEIGHT * 3,
			(index + 1) * WIDTH * HEIGHT * 3,
		);
		const ffmpegToOracle = rgbMetrics(ffmpeg, oracle),
			chromiumToOracle = rgbMetrics(chromium, oracle);
		return {
			sceneFrame: FIRST_FRAME + index,
			ffmpegToOracle,
			chromiumToOracle,
			chromiumToFfmpeg: rgbMetrics(chromium, ffmpeg),
			ffmpegPassed: ffmpegToOracle.interiorRgbMae < 3,
			chromiumPassed: chromiumToOracle.interiorRgbMae < 3,
		};
	});
}
