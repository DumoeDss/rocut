import { expect, test } from "bun:test";
import {
	liquidInput,
	liquidParameters,
	liquidRate,
	liquidSource,
} from "./liquid-browser-cases";
import {
	liquidDifference,
	liquidExpected,
	liquidSample,
} from "./liquid-browser-oracle";

test("Liquid browser oracle preserves constant alpha at the inclusive cutoff", () => {
	for (const alpha of [0, 1, 2, 96, 255]) {
		const source = new Uint8ClampedArray([
			20,
			50,
			100,
			alpha,
			60,
			70,
			180,
			alpha,
			150,
			80,
			60,
			alpha,
			80,
			90,
			30,
			alpha,
		]);
		for (const fx of [0, 0.032706215866636, 0.25, 0.75, 1])
			for (const fy of [0, 0.56065448633136, 1])
				expect(liquidSample(source, 2, 2, fx + 0.5, fy + 0.5)[3]).toBe(
					alpha / 255,
				);
	}
});
test("Liquid browser oracle maps legal frame clocks before start and fixed steps", () => {
	const params = liquidParameters(),
		source = liquidSource(93, 62);
	const result = (local: number, numerator = 120, denominator = 1) =>
		liquidExpected(source, 93, 62, params, local, { numerator, denominator });
	expect(result(2500).steps).toBe(0);
	expect(result(3000).steps).toBe(0);
	expect(result(3500).steps).toBe(0);
	expect(result(3500, 240).steps).toBe(1);
	expect(result(10500, 240).eventsApplied).toBe(1);
	expect(result(11500, 240).eventsApplied).toBe(2);
	expect(result(60000).steps).toBe(24);
	expect(result(60000).eventsApplied).toBe(2);
	expect(result(60000).pixels).toEqual(result(28000).pixels);
	expect(
		liquidInput(params, 10000, { numerator: 30000, denominator: 1001 }, 93, 62)
			.elapsedTicks,
	).toBe(5508);
	expect(
		liquidExpected(source, 93, 62, { ...params, amount: 0 }, 26000, liquidRate)
			.pixels,
	).toEqual(source);
});
test("Liquid browser pixels reject three independent solver counterexamples", () => {
	const params = liquidParameters(),
		source = liquidSource(93, 62);
	const expected = liquidExpected(
		source,
		93,
		62,
		params,
		26000,
		liquidRate,
	).pixels;
	for (const control of ["noProjection", "ignoreEvents", "uvRadius"] as const)
		expect(
			liquidDifference(
				expected,
				liquidExpected(source, 93, 62, params, 26000, liquidRate, control)
					.pixels,
			).failures,
		).toBeGreaterThan(20);
});
