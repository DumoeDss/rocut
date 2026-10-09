import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cloudsDifference } from "./clouds-oracle";
import {
	blackComposite,
	pipelineAnimated,
	pipelineDuration,
	pipelineExpected,
	pipelineLocalTicks,
	pipelineParamsAt,
	pipelineSize,
	pipelineThresholds,
	type PipelineChannel,
} from "./clouds-pipeline-cases";
import { codecDifference } from "./clouds-pipeline-metrics";
import { pipelineSource } from "./clouds-pipeline-source";

const { width, height } = pipelineSize;
const source = pipelineSource(width, height, "holes");
const baseline = blackComposite(source);
const frames = pipelineLocalTicks.map((local) =>
	pipelineExpected(source, "attached", local, true),
);

test("fixed Clouds source includes broad colored edges, cut-out holes and gradient background", () => {
	expect(source.length).toBe(width * height * 4);
	expect(source.some((value, index) => index % 4 === 3 && value === 0)).toBe(
		true,
	);
	expect(source.some((value, index) => index % 4 === 3 && value === 255)).toBe(
		true,
	);
	const colors = new Set<string>();
	for (let i = 0; i < source.length; i += 4) {
		if (source[i + 3] === 0)
			expect(source.subarray(i, i + 3)).toEqual(new Uint8ClampedArray(3));
		else colors.add(Array.from(source.subarray(i, i + 3)).join(","));
	}
	expect(colors.has("30,190,210")).toBe(true);
	expect(colors.has("224,90,36")).toBe(true);
	expect(colors.has("234,220,72")).toBe(true);
	expect(colors.size).toBeGreaterThan(100);
});

test("independent black composition and inactive placement boundaries remain distinct", () => {
	expect(
		blackComposite(new Uint8ClampedArray([255, 0, 255, 0, 120, 80, 240, 128])),
	).toEqual(new Uint8ClampedArray([0, 0, 0, 255, 60, 40, 120, 255]));
	for (const local of [-1, pipelineDuration, pipelineDuration + 1]) {
		const attached = pipelineExpected(source, "attached", local, true);
		const layer = pipelineExpected(source, "effect-layer", local, false);
		expect(attached.active).toBe(false);
		expect(
			attached.pixels.every(
				(value, index) => value === (index % 4 === 3 ? 255 : 0),
			),
		).toBe(true);
		expect(layer.active).toBe(false);
		expect(layer.pixels).toEqual(baseline);
	}
	expect(() => pipelineExpected(source, "effect-layer", 48000, true)).toThrow(
		"do not support animation",
	);
});

test("scene effects retain transparent edge pixels after composition; attached output is opaque", () => {
	const layer = pipelineExpected(source, "effect-layer", 68000, false);
	const attached = pipelineExpected(source, "attached", 68000, false);
	expect(
		layer.pixels.some((value, index) => index % 4 === 3 && value < 255),
	).toBe(true);
	expect(
		attached.pixels.every((value, index) => index % 4 !== 3 || value === 255),
	).toBe(true);
	expect(layer.pixels).not.toEqual(attached.pixels);
	expect(layer.exteriorSamples).toBeGreaterThan(0);
});

test("static morph time is frame-floored while nine authored curves retain exact local tick semantics", () => {
	for (const placement of ["attached", "effect-layer"] as const)
		expect(pipelineExpected(source, placement, 0, false).pixels).toEqual(
			pipelineExpected(source, placement, 3999, false).pixels,
		);
	expect(Object.keys(pipelineAnimated).length).toBe(9);
	expect(pipelineParamsAt(-1, true)).toEqual(pipelineParamsAt(0, true));
	expect(pipelineParamsAt(50000, true).windX).not.toBe(
		pipelineParamsAt(50001, true).windX,
	);
	expect(pipelineParamsAt(68000, true).seed).toBe(31415);
});

test("each of the nine independent animation channels changes pixels beyond the raster gate", () => {
	const staticFrame = pipelineExpected(source, "attached", 68000, false);
	for (const key of Object.keys(pipelineAnimated) as PipelineChannel[]) {
		const animated = pipelineExpected(source, "attached", 68000, true, key);
		expect(
			cloudsDifference(staticFrame.pixels, animated, animated.baseline).failed,
			key,
		).toBeGreaterThan(0);
	}
});

test("predeclared six-frame codec references reject no-effect and repeated-first sequences", () => {
	expect(pipelineThresholds).toEqual({
		premultipliedRgb: 2,
		alpha: 1,
		identity: 0,
		exportMeanRgba: 10,
		exportActiveRgb: 15,
		exportMinimumActivePixels: 64,
		exportTimestampSeconds: 0.0011,
	});
	const noEffect = frames.map((frame) =>
		codecDifference(baseline, frame.pixels, baseline),
	);
	const repeated = frames.map((frame) =>
		codecDifference(frames[0].pixels, frame.pixels, baseline),
	);
	expect(noEffect.every((metric) => !metric.accepted)).toBe(true);
	expect(noEffect.every((metric) => metric.activePixels >= 64)).toBe(true);
	expect(repeated[0].accepted).toBe(true);
	expect(repeated.slice(1).some((metric) => !metric.accepted)).toBe(true);
	console.log(
		JSON.stringify({
			cloudsPipelineCpu: {
				sourceSha256: createHash("sha256").update(source).digest("hex"),
				expectedSha256: createHash("sha256")
					.update(
						Buffer.concat(frames.map((frame) => Buffer.from(frame.pixels))),
					)
					.digest("hex"),
				localTicks: pipelineLocalTicks,
				noEffect,
				repeated,
			},
		}),
	);
});

test("codec metrics reject malformed buffers and frames without independently defined active pixels", () => {
	expect(() =>
		codecDifference(
			new Uint8ClampedArray(),
			new Uint8ClampedArray(),
			new Uint8ClampedArray(),
		),
	).toThrow();
	expect(() =>
		codecDifference(
			new Uint8ClampedArray(3),
			new Uint8ClampedArray(3),
			new Uint8ClampedArray(3),
		),
	).toThrow();
	expect(codecDifference(baseline, baseline, baseline).accepted).toBe(false);
});
