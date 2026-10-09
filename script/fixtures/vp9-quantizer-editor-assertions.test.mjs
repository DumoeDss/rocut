import assert from "node:assert/strict";
import { test } from "node:test";
import {
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	sourceRgba,
} from "./master-encoder-analysis.mjs";
import {
	AUDIO,
	audioSamples,
	loadFrozenSource,
	adapterCases,
} from "./vp9-quantizer-source-cases.mjs";
import {
	assertEditorInputs,
	assertEditorCancellation,
} from "./vp9-quantizer-editor-assertions.mjs";

const directory = process.env.ROCUT_MASTER_ENCODER_INPUTS;
const source = directory ? await loadFrozenSource(directory) : null;
const nativeCase = source
	? adapterCases(source.config, source.frames)[2]
	: null;
function fixture(native = true) {
	const config = native ? nativeCase.config : source.config;
	const response = {
		kind: "vp9Quantizer",
		quantizer: 0,
		nativeConfig: config,
		keyFrameIntervalFrames: 60,
	};
	return {
		frames: source.frames.map((frame) => ({
			timestamp: frame.timestamp,
			duration: frame.duration,
			colorSpace: structuredClone(frame.colorSpace),
			bytes: [...frame.bytes],
		})),
		sceneCaptures: source.frames.map((frame, index) => ({
			time: (FIRST_FRAME + index) * 4000,
			rgba: [...sourceRgba(frame)],
		})),
		completeCount: 1,
		cancelledCount: 0,
		bufferPublished: true,
		audioInput: {
			sampleRate: AUDIO.sampleRate,
			channels: AUDIO.channels,
			samples: [...audioSamples()],
		},
		actualConfigure: config,
		rustResponse: response,
		actualEncodeOptions: source.frames.map((frame, index) => ({
			timestamp: frame.timestamp,
			options: { keyFrame: index === 0, vp9: { quantizer: 0 } },
		})),
		nativeEncodeQueuePeak: 4,
		pendingMuxWritePeak: 1,
		packetWrites: source.frames.map((_, index) => ({
			timestamp: index / FPS,
			duration: 1 / FPS,
			metadata: index === 0 ? { decoderConfig: {} } : undefined,
		})),
		lifecycle: [
			"output.start",
			...(native ? ["adapter.initialize", "adapter.initialize.resolved"] : []),
			"lifetime.markVideoInitialized",
			"audio.add",
			"audio.close",
			...Array.from({ length: FRAME_COUNT }, () => [
				"lifetime.addVideoFrame",
				native ? "adapter.add" : "canvas.add",
			]).flat(),
			...(native
				? ["adapter.close", "adapter.close.resolved"]
				: ["canvas.close"]),
			"output.finalize",
		],
	};
}
const options = { skip: !source };
test(
	"real-editor input validation accepts exact original/default and explicit native plans",
	options,
	() => {
		assertEditorInputs(fixture(false), { adapter: false }, source);
		assertEditorInputs(fixture(), nativeCase, source);
		const optionalUndefined = fixture(false);
		optionalUndefined.actualConfigure = {
			...optionalUndefined.actualConfigure,
			bitrateMode: undefined,
			latencyMode: undefined,
			scalabilityMode: undefined,
			contentHint: undefined,
		};
		assertEditorInputs(optionalUndefined, { adapter: false }, source);
		for (const [key, value] of Object.entries({
			bitrate: 56001,
			codec: "vp09.00.11.08",
			latencyMode: "quality",
			bitrateMode: "constant",
			contentHint: "detail",
			scalabilityMode: "L1T2",
		})) {
			const changed = fixture(false);
			changed.actualConfigure = { ...changed.actualConfigure, [key]: value };
			assert.throws(
				() => assertEditorInputs(changed, { adapter: false }, source),
				`Defined default config change must reject: ${key}`,
			);
		}
	},
);
for (const [name, mutate] of [
	[
		"changed native BGRA pixel",
		(e) => {
			e.frames[0].bytes[0] ^= 1;
		},
	],
	[
		"range-local scene clock",
		(e) => {
			e.sceneCaptures[0].time = 0;
		},
	],
	[
		"changed native color metadata",
		(e) => {
			e.frames[0].colorSpace.fullRange = !e.frames[0].colorSpace.fullRange;
		},
	],
	[
		"native configuration not from Rust",
		(e) => {
			e.actualConfigure = { ...e.actualConfigure, codec: "vp09.00.10.08" };
		},
	],
	[
		"rounded public packet seconds",
		(e) => {
			e.packetWrites[1].timestamp = 0.033333;
		},
	],
	[
		"q inferred instead of exact q0",
		(e) => {
			e.actualEncodeOptions[0].options.vp9.quantizer = 1;
		},
	],
	[
		"shifted companion audio",
		(e) => {
			e.audioInput.samples[0] = 1;
		},
	],
	[
		"finalize before native close settles",
		(e) => {
			e.lifecycle.splice(e.lifecycle.indexOf("adapter.close.resolved"), 1);
			e.lifecycle.push("adapter.close.resolved");
		},
	],
	[
		"no OutputLifetime frame ownership",
		(e) => {
			e.lifecycle.splice(e.lifecycle.indexOf("lifetime.addVideoFrame"), 1);
		},
	],
])
	test(`real-editor input validation rejects ${name}`, options, () => {
		const evidence = fixture();
		mutate(evidence);
		assert.throws(() => assertEditorInputs(evidence, nativeCase, source));
	});
test("real-editor cancellation validation rejects finalization and publication", () => {
	const evidence = {
		cancelled: true,
		bufferPublished: false,
		completeCount: 0,
		cancelledCount: 1,
		lifecycle: [
			"lifetime.addVideoFrame.resolved",
			"adapter.cancel",
			"lifetime.cancel",
			"output.cancel",
		],
	};
	assertEditorCancellation(evidence);
	assert.throws(() =>
		assertEditorCancellation({
			...evidence,
			lifecycle: [...evidence.lifecycle, "output.finalize"],
		}),
	);
	assert.throws(() =>
		assertEditorCancellation({ ...evidence, bufferPublished: true }),
	);
});
