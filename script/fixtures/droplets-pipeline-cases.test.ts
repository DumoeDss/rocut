import { expect, test } from "bun:test";
import { dropletsSource } from "./droplets-cases";
import { dropletsExpected } from "./droplets-oracle";
import {
	blackComposite,
	pipelineDuration,
	pipelineExpected,
	pipelineFps,
	pipelineLocalTicks,
	pipelineParamsAt,
	pipelineSize,
} from "./droplets-pipeline-cases";

const { width, height } = pipelineSize;
const opaque = dropletsSource(width, height, "opaque");
const holes = dropletsSource(width, height, "holes");

test("independent opaque-black composition preserves premultiplied colors", () => {
	expect(
		blackComposite(new Uint8ClampedArray([255, 0, 255, 0, 120, 80, 240, 128])),
	).toEqual(new Uint8ClampedArray([0, 0, 0, 255, 60, 40, 120, 255]));
});

test("attached before-start and exclusive-end frames are opaque black", () => {
	for (const source of [opaque, holes])
		for (const local of [-1, pipelineDuration, pipelineDuration + 1]) {
			const expected = pipelineExpected(source, "attached", local, true);
			expect(expected.active).toBe(false);
			expect(expected.activePixels).toBe(0);
			expect(
				expected.pixels.every(
					(value, index) => value === (index % 4 === 3 ? 255 : 0),
				),
			).toBe(true);
			expect(expected.baseline).toEqual(expected.pixels);
		}
});

test("inactive effect layer leaves its black-composited image visible at both boundaries", () => {
	for (const source of [opaque, holes])
		for (const local of [-1, pipelineDuration, pipelineDuration + 1]) {
			const expected = pipelineExpected(source, "effect-layer", local, false);
			expect(expected.active).toBe(false);
			expect(expected.pixels).toEqual(blackComposite(source));
			expect(expected.baseline).toEqual(expected.pixels);
		}
});

test("attached and scene-effect alpha follow different composition orders", () => {
	const attached = pipelineExpected(holes, "attached", 68000, false);
	const layer = pipelineExpected(holes, "effect-layer", 68000, false);
	expect(attached.active).toBe(true);
	expect(layer.active).toBe(true);
	expect(
		attached.pixels
			.filter((_, index) => index % 4 === 3)
			.every((value) => value === 255),
	).toBe(true);
	expect(
		layer.pixels.filter((value, index) => index % 4 === 3 && value < 255)
			.length,
	).toBe(54);
	expect(attached.pixels).not.toEqual(layer.pixels);
	for (let pixel = 0; pixel < layer.outside.length; pixel++)
		if (layer.outside[pixel])
			expect(layer.pixels.subarray(pixel * 4, pixel * 4 + 4)).toEqual(
				layer.baseline.subarray(pixel * 4, pixel * 4 + 4),
			);
});

test("active frame flooring remains independent of backdrop correction", () => {
	for (const placement of ["attached", "effect-layer"] as const) {
		expect(pipelineExpected(holes, placement, 0, false).pixels).toEqual(
			pipelineExpected(holes, placement, 3999, false).pixels,
		);
		expect(
			pipelineExpected(holes, placement, pipelineDuration - 1, false).active,
		).toBe(true);
	}
});

test("opaque attached VP9 references are unchanged by the preview-oracle correction", () => {
	for (const local of pipelineLocalTicks) {
		const priorCodecReference = blackComposite(
			dropletsExpected(
				opaque,
				width,
				height,
				pipelineParamsAt(local, true),
				local,
				pipelineFps,
			).pixels,
		);
		expect(pipelineExpected(opaque, "attached", local, true).pixels).toEqual(
			priorCodecReference,
		);
	}
});
