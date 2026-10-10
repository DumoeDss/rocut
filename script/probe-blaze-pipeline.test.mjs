import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazePipelineContract,
	validateBlazePipelineMedia,
} from "./probe-blaze-pipeline-contract.mjs";
import {
	compareBlazePipelineSequence,
	validateBlazePipelineProbeTiming,
} from "./probe-blaze-pipeline-metrics.mjs";
import { blazePipelinePng } from "./probe-blaze-pipeline-png.mjs";
import { saveBlazePipelineMedia } from "./probe-blaze-pipeline-artifacts.mjs";
import { blazeSha256 } from "./probe-blaze-evidence.mjs";

function media() {
	return {
		...structuredClone(blazePipelineContract),
		requestedVideoChroma: "default",
		fps: 30000 / 1001,
		paramsPerFrame: Array.from({ length: 6 }, (_, i) => ({
			...blazePipelineContract.staticParams,
			...Object.fromEntries(
				Object.entries(blazePipelineContract.animated).map(
					([key, [start, end]]) => [key, start + ((end - start) * i) / 5],
				),
			),
		})),
	};
}
test("pipeline contract rejects altered clocks, quality, chroma, thresholds and animation", () => {
	assert.doesNotThrow(() => validateBlazePipelineMedia(media()));
	for (const change of [
		(m) => {
			m.fps = 30;
		},
		(m) => {
			m.quality = "high";
		},
		(m) => {
			m.requestedVideoChroma = "420";
		},
		(m) => {
			m.thresholds.exportMeanRgba = 11;
		},
		(m) => {
			m.paramsPerFrame[3].wind = 1;
		},
		(m) => {
			m.keyframeLocalTicks[0]++;
		},
	]) {
		const value = media();
		change(value);
		assert.throws(() => validateBlazePipelineMedia(value));
	}
	const explicit = media();
	explicit.requestedVideoChroma = "444";
	assert.doesNotThrow(() => validateBlazePipelineMedia(explicit));
});

test("PNG packaging is lossless RGBA including hidden color and alpha", () => {
	const pixels = Buffer.from([
		255, 0, 255, 0, 10, 20, 30, 128, 4, 5, 6, 255, 90, 80, 70, 1,
	]);
	const png = blazePipelinePng(pixels, 2, 2);
	assert.deepEqual(
		png.subarray(0, 8),
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	let offset = 8,
		data;
	while (offset < png.length) {
		const length = png.readUInt32BE(offset),
			type = png.toString("ascii", offset + 4, offset + 8);
		if (type === "IHDR") {
			assert.equal(png.readUInt32BE(offset + 8), 2);
			assert.equal(png.readUInt32BE(offset + 12), 2);
		}
		if (type === "IDAT")
			data = inflateSync(png.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	assert(data);
	assert.equal(data[0], 0);
	assert.equal(data[9], 0);
	assert.deepEqual(
		Buffer.concat([data.subarray(1, 9), data.subarray(10)]),
		pixels,
	);
	assert.throws(() => blazePipelinePng(pixels, 3, 2));
});

test("rational frame and packet timing use fixed 1.1ms tolerance", () => {
	const packets = [0, 0.033, 0.067, 0.1, 0.133, 0.167].map((t) => ({
		codec_type: "video",
		pts_time: String(t),
		duration_time: "0.033",
	}));
	const frames = packets.map((p) => ({
		media_type: "video",
		best_effort_timestamp_time: p.pts_time,
		pkt_duration_time: p.duration_time,
	}));
	const probe = { packets, frames, format: { duration: "0.200" } };
	assert.doesNotThrow(() => validateBlazePipelineProbeTiming(probe, media()));
	frames[2].best_effort_timestamp_time = "0.075";
	assert.throws(() => validateBlazePipelineProbeTiming(probe, media()));
});

test("decoded metrics reject baseline and repeated first-frame with unchanged codec gates", () => {
	const stride = 192 * 128 * 4,
		baseline = Buffer.alloc(stride);
	for (let i = 3; i < stride; i += 4) baseline[i] = 255;
	const expected = Buffer.concat(
		Array.from({ length: 6 }, (_, index) => {
			const frame = Buffer.from(baseline);
			for (let i = 0; i < frame.length; i += 4)
				frame[i] = frame[i + 1] = frame[i + 2] = (index + 1) * 32;
			return frame;
		}),
	);
	const positive = compareBlazePipelineSequence(
		expected,
		expected,
		baseline,
		stride,
		6,
	);
	assert.equal(positive.actualPassed, true);
	assert.deepEqual(positive.baselineRejectedFrames, [0, 1, 2, 3, 4, 5]);
	assert.deepEqual(positive.repeatedFirstRejectedFrames, [1, 2, 3, 4, 5]);
	const repeated = Buffer.concat(
		Array.from({ length: 6 }, () => expected.subarray(0, stride)),
	);
	assert.equal(
		compareBlazePipelineSequence(repeated, expected, baseline, stride, 6)
			.actualPassed,
		false,
	);
});

test("media packaging preserves full RAW and PNG references and predecode counterfactuals", async () => {
	const directory = await mkdtemp("C:/tmps/blaze-pipeline-artifacts-test-");
	const input = media(),
		frame = Buffer.alloc(192 * 128 * 4);
	for (let i = 3; i < frame.length; i += 4) frame[i] = 255;
	Object.assign(input, {
		source: frame.toString("base64"),
		baseline: frame.toString("base64"),
		expected: Buffer.concat(Array.from({ length: 6 }, () => frame)).toString(
			"base64",
		),
		video: Buffer.from(
			"synthetic packaging test bytes, not encoded video",
		).toString("base64"),
	});
	const saved = await saveBlazePipelineMedia(directory, input);
	assert.equal(saved.independentDecodeVerified, false);
	assert.equal(saved.expectedPngs.length, 6);
	for (const descriptor of [
		...Object.values(saved.files),
		...saved.expectedPngs,
		...Object.values(saved.counterfactuals),
		saved.baselinePng,
		saved.sourcePng,
	]) {
		const bytes = await readFile(join(directory, descriptor.filename));
		assert.equal(bytes.length, descriptor.bytes);
		assert.equal(blazeSha256(bytes), descriptor.sha256);
	}
	assert.equal(saved.counterfactuals.baseline.bytes, 6 * frame.length);
	assert.equal(saved.counterfactuals.repeatedFirst.bytes, 6 * frame.length);
	await assert.rejects(saveBlazePipelineMedia(directory, input), /EEXIST/);
});
