import assert from "node:assert/strict";
import {
	FPS,
	FRAME_COUNT,
	FIRST_FRAME,
	sourceRgba,
} from "./master-encoder-analysis.mjs";
import { AUDIO, AUDIO_INPUT_SHA256 } from "./vp9-quantizer-source-cases.mjs";
import { sha256 } from "./master-encoder-analysis.mjs";

export function assertEditorInputs(evidence, testCase, source) {
	assert.equal(evidence.frames.length, FRAME_COUNT);
	assert.equal(evidence.sceneCaptures.length, FRAME_COUNT);
	for (const [index, frame] of evidence.frames.entries()) {
		const original = source.frames[index];
		assert.deepEqual(
			frame,
			{
				timestamp: original.timestamp,
				duration: original.duration,
				colorSpace: original.colorSpace,
				bytes: original.bytes,
			},
			"Real exporter native frame changed original pixels/color/timing",
		);
		assert.equal(
			evidence.sceneCaptures[index].time,
			(FIRST_FRAME + index) * 4000,
		);
		assert.deepEqual(
			evidence.sceneCaptures[index].rgba,
			[...sourceRgba(original)],
			"Real buildScene/CanvasRenderer pixels differ from frozen source",
		);
	}
	assert.equal(evidence.completeCount, 1);
	assert.equal(evidence.cancelledCount, 0);
	assert.equal(evidence.bufferPublished, true);
	assert.equal(evidence.audioInput.sampleRate, AUDIO.sampleRate);
	assert.equal(evidence.audioInput.channels, AUDIO.channels);
	assert.equal(
		sha256(Buffer.from(Float32Array.from(evidence.audioInput.samples).buffer)),
		AUDIO_INPUT_SHA256,
	);
	const order = evidence.lifecycle;
	assert.equal(
		order.filter((name) => name === "lifetime.addVideoFrame").length,
		FRAME_COUNT,
	);
	assert.ok(order.indexOf("audio.close") < order.indexOf("output.finalize"));
	assert.equal(order.filter((name) => name === "output.finalize").length, 1);
	assert.equal(order.includes("output.cancel"), false);
	if (!testCase.adapter) {
		// Frozen baseline is JSON. Native JS options may carry explicit undefined
		// optional keys, which are absent in that unchanged JSON representation.
		assert.deepEqual(
			JSON.parse(JSON.stringify(evidence.actualConfigure)),
			source.config,
		);
		assert.equal(order.includes("adapter.initialize"), false);
		assert.equal(
			order.filter((name) => name === "canvas.add").length,
			FRAME_COUNT,
		);
		return;
	}
	assert.equal(evidence.rustResponse.kind, "vp9Quantizer");
	assert.equal(evidence.rustResponse.quantizer, testCase.quantizer);
	assert.deepEqual(
		evidence.actualConfigure,
		evidence.rustResponse.nativeConfig,
		"Native configure must execute exact actual Rust response",
	);
	if (testCase.rustPolicy)
		assert.deepEqual(evidence.rustResponse, testCase.rustPolicy.response);
	assert.equal(order.includes("canvas.add"), false);
	assert.equal(
		order.filter((name) => name === "adapter.add").length,
		FRAME_COUNT,
	);
	assert.ok(
		order.indexOf("adapter.initialize.resolved") <
			order.indexOf("lifetime.markVideoInitialized"),
	);
	assert.ok(
		order.indexOf("adapter.close.resolved") < order.indexOf("output.finalize"),
	);
	assert.equal(evidence.actualEncodeOptions.length, FRAME_COUNT);
	for (const [index, encoded] of evidence.actualEncodeOptions.entries()) {
		assert.equal(encoded.timestamp, source.frames[index].timestamp);
		assert.deepEqual(encoded.options, {
			keyFrame: index % evidence.rustResponse.keyFrameIntervalFrames === 0,
			vp9: { quantizer: testCase.quantizer },
		});
	}
	assert.ok(evidence.nativeEncodeQueuePeak <= 4);
	assert.ok(evidence.pendingMuxWritePeak <= 1);
	assert.equal(evidence.packetWrites.length, FRAME_COUNT);
	for (const [index, packet] of evidence.packetWrites.entries()) {
		assert.equal(packet.timestamp, index / FPS);
		assert.equal(packet.duration, 1 / FPS);
	}
	assert.ok(evidence.packetWrites[0].metadata?.decoderConfig);
}

export function assertEditorCancellation(evidence) {
	assert.equal(evidence.cancelled, true);
	assert.equal(evidence.bufferPublished, false);
	assert.equal(evidence.completeCount, 0);
	assert.equal(evidence.cancelledCount, 1);
	assert.equal(evidence.lifecycle.includes("output.finalize"), false);
	assert.equal(
		evidence.lifecycle.filter((name) => name === "output.cancel").length,
		1,
	);
	assert.ok(evidence.lifecycle.includes("lifetime.cancel"));
	assert.ok(evidence.lifecycle.includes("adapter.cancel"));
	assert.ok(evidence.lifecycle.includes("lifetime.addVideoFrame.resolved"));
}
