import { describe, expect, test } from "bun:test";
import {
	dropletsParameters,
	dropletsRate,
	dropletsSource,
} from "./droplets-cases";
import {
	dropletsDifference,
	dropletsExpected,
	dropletsGeometry,
	dropletsHash,
	dropletsSample,
	dropletsSampleTicks,
	dropletsTimePhase,
} from "./droplets-oracle";

describe("Independent Droplets optical reference", () => {
	test("known bilinear premultiplication and transparent exterior", () => {
		const pixels = new Uint8ClampedArray([200, 0, 0, 255, 0, 255, 0, 0]);
		expect(dropletsSample(pixels, 2, 1, 0.5, 0)).toEqual([100, 0, 0, 127.5]);
		expect(dropletsSample(pixels, 2, 1, -0.5, 0)).toEqual([100, 0, 0, 127.5]);
		expect(dropletsSample(pixels, 2, 1, 3, 0)).toEqual([0, 0, 0, 0]);
	});
	test("frame flooring and Euclidean phase including negative and large ticks", () => {
		const rate = { numerator: 30000, denominator: 1001 };
		expect(dropletsSampleTicks(-1, rate)).toBe(-4004n);
		expect(dropletsSampleTicks(4003, rate)).toBe(0n);
		expect(dropletsSampleTicks(4004, rate)).toBe(4004n);
		expect(dropletsTimePhase(120000, 0.5, dropletsRate)).toBe(0.5);
		expect(dropletsTimePhase(-60000, 0.5, dropletsRate)).toBe(0.75);
		expect(dropletsTimePhase(240000, 0.5, dropletsRate)).toBe(0);
		for (const time of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
			const quantized = dropletsSampleTicks(time, dropletsRate);
			const expected =
				Number(((quantized % 240000n) + 240000n) % 240000n) / 240000;
			expect(dropletsTimePhase(time, 0.5, dropletsRate)).toBe(expected);
		}
		expect(dropletsTimePhase(-1, Number.MIN_VALUE, dropletsRate)).toBe(0);
		expect(() => dropletsTimePhase(0.5, 0, dropletsRate)).toThrow(
			"Invalid oracle time or frame rate",
		);
		expect(() =>
			dropletsTimePhase(0, 0, { numerator: 0, denominator: 1 }),
		).toThrow("Invalid oracle time or frame rate");
	});
	test("independent hash unsigned and seed/index sensitive", () => {
		const values = Array.from({ length: 64 }, (_, i) =>
			dropletsHash(31415, i, 0xa511e9b3),
		);
		expect(new Set(values).size).toBe(64);
		expect(values.every((value) => value >= 0 && value <= 0xffffffff)).toBe(
			true,
		);
		expect(dropletsHash(31416, 0, 0xa511e9b3)).not.toBe(values[0]);
	});
	for (const [width, height] of [
		[192, 128],
		[128, 192],
	]) {
		test(`${width}x${height}: oracle rejects no-op, overlay-only, ignored seed, wrong time and wrong aspect`, () => {
			const source = dropletsSource(width, height, "opaque");
			const params = dropletsParameters;
			const expected = dropletsExpected(
				source,
				width,
				height,
				params,
				48000,
				dropletsRate,
			);
			expect(expected.activePixels).toBeGreaterThan(500);
			expect(expected.overlapPixels).toBeGreaterThan(50);
			expect(dropletsDifference(expected.pixels, expected, source).failed).toBe(
				0,
			);
			const controls = {
				noOp: source,
				overlayOnly: dropletsExpected(
					source,
					width,
					height,
					{ ...params, refraction: 0 },
					48000,
					dropletsRate,
				).pixels,
				ignoredSeed: dropletsExpected(
					source,
					width,
					height,
					{ ...params, seed: 1 },
					48000,
					dropletsRate,
				).pixels,
				wrongTime: dropletsExpected(
					source,
					width,
					height,
					params,
					0,
					dropletsRate,
				).pixels,
				wrongAspect: dropletsExpected(
					source,
					width,
					height,
					{
						...params,
						radius:
							(params.radius * Math.max(width, height)) /
							Math.min(width, height),
					},
					48000,
					dropletsRate,
				).pixels,
			};
			for (const [name, pixels] of Object.entries(controls))
				expect(
					dropletsDifference(pixels, expected).failed,
					name,
				).toBeGreaterThan(100);
		});
		test(`${width}x${height}: finite spatial support and offscreen wrapping`, () => {
			const source = dropletsSource(width, height, "opaque");
			const frame = dropletsExpected(
				source,
				width,
				height,
				dropletsParameters,
				48000,
				dropletsRate,
			);
			expect(
				frame.outside.reduce((sum, value) => sum + value, 0),
			).toBeGreaterThan((width * height) / 2);
			expect(
				dropletsDifference(frame.pixels, frame, source).outsideFailed,
			).toBe(0);
			const single = { ...dropletsParameters, count: 1 };
			const initial = dropletsGeometry(single, 0, dropletsRate)[0].phase;
			const wrapTicks = Math.ceil((1 - initial) * 240000);
			for (const time of [wrapTicks - 1, wrapTicks]) {
				const wrap = dropletsExpected(source, width, height, single, time, {
					numerator: 120000,
					denominator: 1,
				});
				expect(wrap.activePixels).toBe(0);
				expect(wrap.pixels).toEqual(source);
			}
		});
	}
});
