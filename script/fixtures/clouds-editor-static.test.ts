import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { cloudsAnimatedFields, cloudsRate } from "./clouds-cases";
import { cloudsExpected, cloudsValidate } from "./clouds-oracle";
import { pipelineSource } from "./clouds-pipeline-source";
import {
	editorChanges,
	editorExportLocalTicks,
	editorParams,
	editorParamsAt,
	editorRgb,
	editorSampleLocalTicks,
	editorSize,
	finalEditorParams,
	opticalChannels,
} from "./clouds-editor-contract";
import { editorImage } from "./clouds-editor-scene";
import {
	acceptsMetric,
	editorExportThresholds,
	rgbMetric,
	validateVideoMetadata,
} from "./clouds-editor-metrics.mjs";
import {
	assertPrivateDirectory,
	isIntegerPreview,
	previewViewports,
} from "./clouds-editor-lifecycle.mjs";
import { fullCanvasFilter } from "./clouds-editor-preview.mjs";

const source = pipelineSource(editorSize.width, editorSize.height, "holes");
const oracle = (params: typeof editorParams, local: number) =>
	editorRgb(cloudsExpected(source, 640, 360, params, local, cloudsRate).pixels);

test("integer geometry is selected from frozen vertical-only candidates and never crops the canvas", () => {
	const viewport = { width: 1440, height: 1000 };
	const bounds = { x: 401, y: 118, width: 638, height: 358 };
	expect(isIntegerPreview(bounds, viewport)).toBe(true);
	expect(fullCanvasFilter(bounds, 638, 358)).toBe(
		"scale=640:360:flags=bicubic",
	);
	for (const key of ["x", "y", "width", "height"]) {
		const fractional = {
			...bounds,
			[key]: bounds[key as keyof typeof bounds] + 1 / 64,
		};
		expect(isIntegerPreview(fractional, viewport)).toBe(false);
		expect(() => fullCanvasFilter(fractional, 638, 358)).toThrow();
	}
	expect(() => fullCanvasFilter(bounds, 639, 358)).toThrow();
	expect(() => fullCanvasFilter(bounds, 638, 357)).toThrow();
	expect(isIntegerPreview({ ...bounds, x: 1000 }, viewport)).toBe(false);
	expect(previewViewports).toHaveLength(128);
	expect(
		previewViewports.every(
			(item, i) => item.width === 1440 && item.height === 1000 + i,
		),
	).toBe(true);
	expect(
		Object.isFrozen(previewViewports) &&
			previewViewports.every(Object.isFrozen),
	).toBe(true);
});

test("editor acceptance only admits private C drive descendants", () => {
	expect(() =>
		assertPrivateDirectory("C:/tmps/clouds/run", "Fixture"),
	).not.toThrow();
	for (const path of [
		"",
		"relative",
		"C:/tmps",
		"C:/tmps/../users",
		"C:/tmps-other",
		"E:/rocut",
	])
		expect(() => assertPrivateDirectory(path, "Fixture")).toThrow();
});

test("dedicated imported PNG retains every source RGBA pixel, including full-frame edges and holes", () => {
	const png = editorImage();
	expect(png).toEqual(editorImage());
	expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(png.readUInt32BE(16)).toBe(640);
	expect(png.readUInt32BE(20)).toBe(360);
	expect(png[24]).toBe(8);
	expect(png[25]).toBe(6);
	const compressed: Buffer[] = [];
	for (let offset = 8; offset < png.length; ) {
		const length = png.readUInt32BE(offset);
		if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
			compressed.push(png.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(compressed));
	expect(rows.length).toBe(360 * 2561);
	for (let y = 0; y < 360; y++) {
		expect(rows[y * 2561]).toBe(0);
		expect(rows.subarray(y * 2561 + 1, (y + 1) * 2561)).toEqual(
			Buffer.from(source.subarray(y * 2560, (y + 1) * 2560)),
		);
	}
	expect(source[source.length - 1]).toBe(255);
	expect(source.some((value, i) => i % 4 === 3 && value === 0)).toBe(true);
});

test("all twelve authored edits are legal and change independent visible pixels cumulatively", () => {
	expect(Object.keys(editorParams).sort()).toEqual(
		editorChanges.map((item) => item.key).sort(),
	);
	const params = { ...editorParams };
	let previous = oracle(params, 24000);
	for (const change of editorChanges) {
		expect(change.value).not.toBe(params[change.key]);
		params[change.key] = change.value;
		expect(() => cloudsValidate(params)).not.toThrow();
		const next = oracle(params, 24000);
		expect(next).not.toEqual(previous);
		previous = next;
	}
	expect(params).toEqual(finalEditorParams());
});

test("nine Host-authored channels interpolate to static reference parameters at identical local ticks", () => {
	expect(Object.keys(opticalChannels).sort()).toEqual(
		[...cloudsAnimatedFields].sort(),
	);
	const hashes = editorSampleLocalTicks.map((local) => {
		const params = editorParamsAt(local);
		for (const [key, [first, last]] of Object.entries(opticalChannels))
			expect(params[key as keyof typeof params]).toBeCloseTo(
				first + ((last - first) * local) / 24000,
				14,
			);
		return createHash("sha256").update(oracle(params, local)).digest("hex");
	});
	expect(new Set(hashes).size).toBe(3);
});

test("predeclared six-frame references reject no-effect and repeated-first exports before GPU execution", () => {
	expect(editorExportThresholds).toEqual({
		meanRgb: 10,
		effectRgb: 15,
		effectPixels: 64,
		timestamp: 0.0011,
	});
	const baseline = editorRgb(source);
	const frames = editorExportLocalTicks.map((local) =>
		oracle(finalEditorParams(), local),
	);
	const noEffect = frames.map((frame) => rgbMetric(baseline, frame, baseline));
	const repeatedFirst = frames.map((frame) =>
		rgbMetric(frames[0], frame, baseline),
	);
	expect(noEffect.every((metric) => metric.effectPixels >= 64)).toBe(true);
	expect(noEffect.some((metric) => !acceptsMetric(metric))).toBe(true);
	expect(repeatedFirst.slice(1).some((metric) => !acceptsMetric(metric))).toBe(
		true,
	);
	console.log(
		JSON.stringify({
			cloudsEditorCpu: {
				pngSha256: createHash("sha256").update(editorImage()).digest("hex"),
				sourceSha256: createHash("sha256").update(source).digest("hex"),
				expectedSha256: createHash("sha256")
					.update(Buffer.concat(frames.map(Buffer.from)))
					.digest("hex"),
				noEffect,
				repeatedFirst,
				params: finalEditorParams(),
				localTicks: editorExportLocalTicks,
			},
		}),
	);
});

test("codec gate rejects malformed, nonfinite and inactive inputs", () => {
	expect(() =>
		rgbMetric(new Uint8Array(), new Uint8Array(), new Uint8Array()),
	).toThrow();
	expect(() =>
		rgbMetric(new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)),
	).toThrow();
	expect(acceptsMetric({ meanRgb: NaN, effectRgb: 1, effectPixels: 64 })).toBe(
		false,
	);
	expect(acceptsMetric({ meanRgb: 0, effectRgb: 0, effectPixels: 63 })).toBe(
		false,
	);
	expect(acceptsMetric({ meanRgb: 10, effectRgb: 15, effectPixels: 64 })).toBe(
		true,
	);
});

test("every decoded timestamp, packet duration and final end must meet the fixed 30fps gate", () => {
	const metadata = {
		streams: [
			{
				codec_name: "vp9",
				width: 640,
				height: 360,
				nb_read_frames: "6",
				r_frame_rate: "30/1",
			},
		],
		format: { duration: "0.2" },
		frames: Array.from({ length: 6 }, (_, index) => ({
			best_effort_timestamp_time: String(index / 30),
			pkt_duration_time: String(1 / 30),
		})),
	};
	expect(validateVideoMetadata(metadata).lastEnd).toBeCloseTo(0.2, 14);
	for (const key of [
		"best_effort_timestamp_time",
		"pkt_duration_time",
	] as const) {
		const invalid = structuredClone(metadata);
		invalid.frames[3][key] = "0.1";
		if (key === "best_effort_timestamp_time") invalid.frames[3][key] = "0.12";
		expect(() => validateVideoMetadata(invalid)).toThrow();
		invalid.frames[3][key] = "NaN";
		expect(() => validateVideoMetadata(invalid)).toThrow();
	}
	const invalid = structuredClone(metadata);
	invalid.format.duration = "0.21";
	expect(() => validateVideoMetadata(invalid)).toThrow();
});
