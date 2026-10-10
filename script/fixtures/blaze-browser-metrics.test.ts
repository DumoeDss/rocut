import { expect, test } from "bun:test";
import {
	blazeActivePixels,
	blazeEqual,
	blazeRawThresholds,
	compareBlazeRaw,
} from "./blaze-browser-metrics";

test("RAW gates are preregistered exact literals", () => {
	expect(blazeRawThresholds).toEqual({
		premultipliedRgbMean: 0.5,
		premultipliedRgbMaximum: 4,
		alphaMean: 0.35,
		alphaMaximum: 3,
		straightRgbAlphaMinimum: 16,
		straightRgbMean: 1.5,
		straightRgbMaximum: 8,
		activeDifference: 8,
		minimumBroadActivePixels: 64,
		minimumSparkActivePixels: 8,
		identity: 0,
	});
});

test("premultiplied comparison ignores hidden RGB but byte identity does not", () => {
	const a = new Uint8ClampedArray([255, 0, 255, 0]),
		b = new Uint8ClampedArray(4);
	expect(compareBlazeRaw(a, b).pass).toBe(true);
	expect(blazeEqual(a, b)).toBe(false);
	expect(blazeActivePixels(a, b)).toBe(0);
});

test("max gate rejects sparse missing sparks despite tiny frame mean", () => {
	const expected = new Uint8ClampedArray(192 * 128 * 4),
		actual = new Uint8ClampedArray(expected);
	expected.set([255, 192, 64, 128], 800);
	const metric = compareBlazeRaw(actual, expected);
	expect(metric.premultipliedMean).toBeLessThan(0.5);
	expect(metric.pass).toBe(false);
	expect(blazeActivePixels(expected, actual)).toBe(1);
});

test("premultiplied values are fractional and entire alpha/hole image is measured", () => {
	const metric = compareBlazeRaw(
		new Uint8ClampedArray([1, 1, 1, 1]),
		new Uint8ClampedArray(4),
	);
	expect(metric.premultipliedMean).toBe(1 / 255);
	expect(metric.alphaMean).toBe(1);
	expect(metric.pass).toBe(false);
	expect(() =>
		compareBlazeRaw(new Uint8ClampedArray(0), new Uint8ClampedArray(0)),
	).toThrow();
});

test("straight RGB guard applies only when both alpha values are visible", () => {
	const actual = new Uint8ClampedArray([10, 0, 0, 16]),
		expected = new Uint8ClampedArray([0, 0, 0, 16]);
	expect(compareBlazeRaw(actual, expected).straightMaximum).toBe(10);
	expect(compareBlazeRaw(actual, expected).pass).toBe(false);
	actual[3] = expected[3] = 15;
	expect(compareBlazeRaw(actual, expected).straightChannels).toBe(0);
});
