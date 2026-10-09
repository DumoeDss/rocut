import { expect, test } from "bun:test";
import { readNativeVp9Plan } from "../export-video-native-plan";

const response = {
	quantizer: 32,
	keyFrameIntervalFrames: 60,
	nativeConfig: {
		codec: "vp09.01.10.08.03.01.13.01.01",
		width: 96,
		height: 64,
		displayWidth: 96,
		displayHeight: 64,
		bitrate: 93000,
		framerate: 30,
		alpha: "discard",
		bitrateMode: "quantizer",
		latencyMode: "quality",
		hardwareAcceleration: "prefer-software",
	},
} as const;
test("Rust native configuration and keyframe cadence pass through unchanged", () => {
	expect(readNativeVp9Plan(response)).toEqual({
		config: response.nativeConfig,
		quantizer: 32,
		keyFrameIntervalFrames: 60,
	});
});
test("partial or malformed native bridge responses cannot fall back to Canvas", () => {
	for (const value of [
		null,
		{},
		{
			...response,
			nativeConfig: { ...response.nativeConfig, bitrateMode: "variable" },
		},
		{ ...response, quantizer: "32" },
		{ ...response, keyFrameIntervalFrames: 0 },
	])
		expect(() => readNativeVp9Plan(value)).toThrow("policy response");
});
