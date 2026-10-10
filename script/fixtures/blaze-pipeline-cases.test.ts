import { expect, test } from "bun:test";
import {
	pipelineAnimated,
	pipelineExpected,
	pipelineFps,
	pipelineFrameTicks,
	pipelineLocalTicks,
	pipelineOffset,
	pipelineParamsAt,
	pipelineThresholds,
} from "./blaze-pipeline-cases";
import { codecDifference } from "./blaze-pipeline-metrics";
import { pipelineSource } from "./blaze-pipeline-source";

test("frozen six-frame rational clock and seven native animation channels", () => {
	expect(pipelineFps).toEqual({ numerator: 30000, denominator: 1001 });
	expect(pipelineFrameTicks).toBe(4004);
	expect(pipelineLocalTicks).toEqual([
		48048, 52052, 56056, 60060, 64064, 68068,
	]);
	expect(pipelineLocalTicks.map((t) => t + pipelineOffset)).toEqual([
		60060, 64064, 68068, 72072, 76076, 80080,
	]);
	expect(Object.keys(pipelineAnimated).sort()).toEqual([
		"amount",
		"flameOpacity",
		"height",
		"refraction",
		"smokeOpacity",
		"sparkOpacity",
		"wind",
	]);
	expect(pipelineParamsAt(0, true)).toEqual(pipelineParamsAt(48048, true));
	expect(pipelineParamsAt(90000, true)).toEqual(pipelineParamsAt(68068, true));
	for (const ticks of pipelineLocalTicks) {
		const params = pipelineParamsAt(ticks, true);
		expect([params.speed, params.scale, params.seed]).toEqual([
			0.5, 0.11, 31415,
		]);
		for (const [key, [start, end]] of Object.entries(pipelineAnimated))
			expect(params[key as keyof typeof params]).toBeCloseTo(
				start + ((end - start) * (ticks - 48048)) / 20020,
				12,
			);
	}
});

test("six independent black-composited references reject baseline and repeated-first before GPU or codec", () => {
	expect(pipelineThresholds).toEqual({
		exportMeanRgba: 10,
		exportActiveRgb: 15,
		exportMinimumActivePixels: 64,
		exportTimestampSeconds: 0.0011,
	});
	const source = pipelineSource(192, 128, "holes");
	const frames = pipelineLocalTicks.map((t) =>
		pipelineExpected(source, "attached", t, true),
	);
	for (const [index, frame] of frames.entries()) {
		expect(
			Array.from(frame.pixels)
				.filter((_, i) => i % 4 === 3)
				.every((alpha) => alpha === 255),
		).toBe(true);
		expect(
			codecDifference(frame.pixels, frame.pixels, frame.baseline).accepted,
		).toBe(true);
		expect(
			codecDifference(frame.baseline, frame.pixels, frame.baseline).accepted,
		).toBe(false);
		expect(
			codecDifference(frames[0].pixels, frame.pixels, frame.baseline).accepted,
		).toBe(index === 0);
	}
	expect(() => pipelineExpected(source, "effect-layer", 48048, true)).toThrow();
});
