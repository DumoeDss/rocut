import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FPS,
	FRAME_COUNT,
	FIRST_FRAME,
	oracleRgba,
	sha256,
} from "./master-encoder-analysis.mjs";
import {
	AUDIO,
	AUDIO_INPUT_SHA256,
	adapterCases,
	assertAdapterInputs,
	audioSamples,
	loadFrozenSource,
} from "./vp9-quantizer-source-cases.mjs";
import {
	assertContainerTiming,
	vp9Header,
} from "./vp9-quantizer-source-assertions.mjs";

const config = {
	codec: "vp09.00.10.08",
	width: 96,
	height: 64,
	displayWidth: 96,
	displayHeight: 64,
	bitrate: 56000,
	alpha: "discard",
	framerate: FPS,
	hardwareAcceleration: "prefer-software",
};
const colorSpace = {
	fullRange: true,
	matrix: "rgb",
	primaries: "bt709",
	transfer: "iec61966-2-1",
};
const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
	const bytes = [...oracleRgba(FIRST_FRAME + index)];
	for (let offset = 0; offset < bytes.length; offset += 4)
		[bytes[offset], bytes[offset + 2]] = [bytes[offset + 2], bytes[offset]];
	return {
		format: "BGRA",
		codedWidth: 96,
		codedHeight: 64,
		layout: [{ offset: 0, stride: 384 }],
		bytes,
		timestamp: Math.trunc((index / FPS) * 1e6),
		duration: 33333,
		options: { keyFrame: index === 0 },
		colorSpace,
	};
});
test("case matrix keeps source content and original baseline config", () => {
	const cases = adapterCases(config, frames);
	assert.deepEqual(
		cases.map((entry) => entry.name),
		[
			"baseline",
			"profile0-q0",
			"profile1-q0",
			"profile1-q32",
			"profile1-q63",
			"profile1-q0-repeat",
		],
	);
	assert.deepEqual(cases[0].config, config);
	assert.equal(cases.filter((entry) => entry.expectOriginalGate).length, 4);
	assert.deepEqual(cases[2].frames, cases[5].frames);
	assert.equal(cases[4].expectOriginalGate, false);
	assert.equal(cases[1].config.bitrate, 56000);
});
test("input proof rejects a single pixel, duration or color-metadata change", () => {
	const testCase = adapterCases(config, frames)[0];
	const evidence = { actualConfigure: config, frames: structuredClone(frames) };
	assert.doesNotThrow(() => assertAdapterInputs(evidence, testCase));
	for (const mutation of [
		(frame) => frame.bytes[0]++,
		(frame) => frame.duration++,
		(frame) => (frame.colorSpace.fullRange = false),
	]) {
		const changed = structuredClone(evidence);
		mutation(changed.frames[0]);
		assert.throws(() => assertAdapterInputs(changed, testCase));
	}
});
test("adapter proof rejects rounded source seconds and reversed lifecycle", () => {
	const testCase = adapterCases(config, frames)[2];
	const evidence = {
		actualConfigure: testCase.config,
		frames,
		actualEncodeOptions: testCase.frames.map((frame) => ({
			timestamp: frame.timestamp,
			options: frame.options,
		})),
		nativeEncodeQueuePeak: 1,
		pendingMuxWritePeak: 1,
		packetWrites: frames.map((frame, index) => ({
			timestamp: index / FPS,
			duration: 1 / FPS,
			metadata: index
				? undefined
				: { decoderConfig: { codec: testCase.config.codec } },
		})),
		lifecycle: ["adapter.close", "output.finalize"],
	};
	assert.doesNotThrow(() => assertAdapterInputs(evidence, testCase));
	const rounded = structuredClone(evidence);
	rounded.packetWrites[1].timestamp = 33333 / 1e6;
	assert.throws(() => assertAdapterInputs(rounded, testCase));
	assert.throws(() =>
		assertAdapterInputs(
			{ ...evidence, lifecycle: ["output.finalize", "adapter.close"] },
			testCase,
		),
	);
});
test("container timing allows only the fixed Matroska millisecond resolution", () => {
	const packets = frames.map((_, index) => ({
		timestamp: Math.round((index / FPS) * 1000) / 1000,
		duration: 0.033,
	}));
	assert.doesNotThrow(() => assertContainerTiming(packets));
	assert.doesNotThrow(() =>
		assertContainerTiming(
			packets.map((packet) => ({
				pts_time: String(packet.timestamp),
				duration: 33,
				duration_time: "0.033000",
			})),
		),
	);
	const shifted = structuredClone(packets);
	shifted[2].timestamp += 0.002;
	assert.throws(() => assertContainerTiming(shifted));
});
test("VP9 header facts independently distinguish profile0/profile1 keyframes", () => {
	assert.deepEqual(vp9Header([0x82, 0x49, 0x83, 0x42]), {
		marker: 2,
		profile: 0,
		showExistingFrame: false,
		keyframe: true,
	});
	assert.equal(vp9Header([0xa2]).profile, 1);
	assert.equal(vp9Header([0x86]).keyframe, false);
	assert.throws(() => vp9Header([0x00]));
});
test("fixed companion audio is deterministic and precisely 0.2 seconds", () => {
	const first = audioSamples(),
		second = audioSamples();
	assert.equal(first.length, AUDIO.sampleRate / 5);
	assert.equal(sha256(Buffer.from(first.buffer)), AUDIO_INPUT_SHA256);
	assert.deepEqual(first, second);
	assert.equal(AUDIO.channels, 1);
});
test(
	"original real input freeze and independent CPU oracle match",
	{ skip: !process.env.ROCUT_MASTER_ENCODER_INPUTS },
	async () => {
		const source = await loadFrozenSource(
			process.env.ROCUT_MASTER_ENCODER_INPUTS,
		);
		assert.deepEqual(source.config, config);
		assert.equal(source.frames.length, FRAME_COUNT);
	},
);
