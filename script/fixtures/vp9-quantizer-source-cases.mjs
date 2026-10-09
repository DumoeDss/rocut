import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	FPS,
	FRAME_COUNT,
	FIRST_FRAME,
	sha256,
	sourceRgba,
	oracleRgba,
} from "./master-encoder-analysis.mjs";
import {
	createQuantizerCases,
	assertSameFrameContent,
} from "./master-encoder-quantizer-cases.mjs";

export const FROZEN_INPUTS = {
	"encoder-inputs-raw.json":
		"3767c360b44c6bb69b8508291a53e9c01021f47737158440c0cf9aa66de3ff8a",
	"master-effects.webm":
		"2389638c47f03e1b3ded4e3a391e79d8d1d3b574b53fa18918bb916f5b671ca6",
	"decoded.rgb":
		"fb3da766f59a81396f880fb756260e6cf257fd52544fd4c94805e3f1cdc3e74a",
};
export const AUDIO = {
	sampleRate: 48000,
	channels: 1,
	frames: 9600,
	bitrate: 192000,
	frequency: 997,
	amplitude: 0.125,
};
export const AUDIO_INPUT_SHA256 =
	"7ce9acc137484345c3d93db51dd32a7a0059a31e921b02e1936fa61495f51312";
export function audioSamples() {
	const samples = Float32Array.from(
		{ length: AUDIO.frames },
		(_, index) =>
			AUDIO.amplitude *
			Math.sin((2 * Math.PI * AUDIO.frequency * index) / AUDIO.sampleRate),
	);
	assert.equal(
		sha256(Buffer.from(samples.buffer)),
		AUDIO_INPUT_SHA256,
		"Fixed companion audio input changed",
	);
	return samples;
}
export async function loadFrozenSource(directory) {
	const files = {};
	for (const [name, expected] of Object.entries(FROZEN_INPUTS)) {
		const bytes = await readFile(join(directory, name));
		assert.equal(sha256(bytes), expected, `Frozen input changed: ${name}`);
		files[name] = bytes;
	}
	const trace = JSON.parse(files["encoder-inputs-raw.json"].toString("utf8"));
	const configurations = trace.records.filter(
		(record) => record.kind === "configure",
	);
	const frames = trace.records.filter((record) => record.kind === "encode");
	assert.equal(configurations.length, 1);
	assert.equal(frames.length, FRAME_COUNT);
	for (const [index, frame] of frames.entries()) {
		assert.equal(frame.timestamp, Math.trunc((index / FPS) * 1e6));
		assert.equal(frame.duration, Math.trunc((1 / FPS) * 1e6));
		assert.deepEqual(sourceRgba(frame), oracleRgba(FIRST_FRAME + index));
	}
	return {
		config: configurations[0].config,
		frames,
		originalDecoded: files["decoded.rgb"],
		identity: FROZEN_INPUTS,
	};
}
export function adapterCases(config, frames) {
	const native = createQuantizerCases(config, frames);
	const selected = [
		"baseline",
		"profile0-q0",
		"profile1-q0",
		"profile1-q32",
		"profile1-q63",
	];
	const cases = selected.map((name) => {
		const testCase = native.find((entry) => entry.name === name);
		assertSameFrameContent(testCase.frames, frames);
		return {
			...testCase,
			adapter: name !== "baseline",
			expectOriginalGate: name !== "baseline" && name !== "profile1-q63",
		};
	});
	return [
		...cases,
		{ ...cases[2], name: "profile1-q0-repeat", repeatOf: "profile1-q0" },
	];
}
export function assertAdapterInputs(evidence, testCase) {
	assert.deepEqual(
		JSON.parse(JSON.stringify(evidence.actualConfigure)),
		testCase.config,
	);
	assert.equal(evidence.frames.length, FRAME_COUNT);
	for (const [index, actual] of evidence.frames.entries()) {
		const frame = testCase.frames[index];
		assert.equal(actual.timestamp, frame.timestamp);
		assert.equal(actual.duration, frame.duration);
		assert.deepEqual(actual.colorSpace, frame.colorSpace);
		assert.deepEqual(
			actual.bytes,
			frame.bytes,
			"Canvas/native input must reproduce the original BGRA bytes",
		);
	}
	if (!testCase.adapter) return;
	assert.equal(evidence.actualEncodeOptions.length, FRAME_COUNT);
	for (const [index, actual] of evidence.actualEncodeOptions.entries()) {
		assert.equal(actual.timestamp, testCase.frames[index].timestamp);
		assert.deepEqual(actual.options, testCase.frames[index].options);
	}
	assert.equal(evidence.nativeEncodeQueuePeak <= 1, true);
	assert.equal(evidence.pendingMuxWritePeak <= 1, true);
	assert.equal(evidence.packetWrites.length, FRAME_COUNT);
	assert.ok(evidence.packetWrites[0].metadata?.decoderConfig);
	for (const [index, packet] of evidence.packetWrites.entries()) {
		assert.equal(packet.timestamp, index / FPS);
		assert.equal(packet.duration, 1 / FPS);
	}
	assert.equal(evidence.lifecycle.at(-1), "output.finalize");
	assert.ok(
		evidence.lifecycle.indexOf("adapter.close") <
			evidence.lifecycle.indexOf("output.finalize"),
	);
}
