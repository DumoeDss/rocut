import { expect, test } from "bun:test";
import { blazeDefaults, blazeRate } from "./blaze-cases";
import {
	blazeFractionF32,
	blazePhase,
	blazePhaseFraction,
	blazeSampleTicks,
	blazeSparks,
	blazeUnit,
} from "./blaze-oracle-time";

test("BigInt hash agrees with the frozen lattice golden vectors", () => {
	for (const [seed, index, expected] of [
		[0, 0, 0.29059529304504395],
		[1, 0, 0.9285773634910583],
		[1, 63, 0.4071630835533142],
		[1, 64, 0.925229549407959],
		[1, 255, 0.7583556771278381],
		[31415, 17, 0.49599093198776245],
		[65535, 255, 0.2589930295944214],
	])
		expect(blazeUnit({ seed, index, salt: 0x3c6ef372 })).toBe(expected);
});

test("frame sampling uses signed floor and rational rates without a float timestamp", () => {
	expect(blazeSampleTicks({ ticks: -1, rate: blazeRate })).toBe(-4000n);
	expect(blazeSampleTicks({ ticks: -4001, rate: blazeRate })).toBe(-8000n);
	expect(
		blazeSampleTicks({
			ticks: 12011,
			rate: { numerator: 30000, denominator: 1001 },
		}),
	).toBe(8008n);
	expect(
		blazeSampleTicks({
			ticks: 12012,
			rate: { numerator: 30000, denominator: 1001 },
		}),
	).toBe(12012n);
	expect(
		blazeSampleTicks({ ticks: Number.MAX_SAFE_INTEGER, rate: blazeRate }),
	).toBe(9007199254740000n);
	expect(blazePhase({ ticks: -1, speed: 0.5, rate: blazeRate })).toBe(
		Math.fround(59 / 60),
	);
	for (const rate of [
		{ numerator: 0, denominator: 1 },
		{ numerator: 7, denominator: 3 },
		{ numerator: 30, denominator: 0 },
	]) {
		expect(() => blazeSampleTicks({ ticks: 0, rate })).toThrow();
	}
});

test("speed remains binary64 until the exact modular phase is rounded to binary32", () => {
	const request = { ticks: 300000, speed: 0.4, rate: blazeRate };
	const fraction = blazePhaseFraction(request);
	expect(fraction.numerator * (1n << 54n)).toBe(fraction.denominator);
	expect(blazePhase(request)).toBe(2 ** -54);
	expect(blazePhase({ ticks: 240000, speed: 0.5, rate: blazeRate })).toBe(0);
	const large = { ticks: Number.MAX_SAFE_INTEGER, speed: 0.4, rate: blazeRate };
	expect(blazePhase(large)).not.toBe(
		blazePhase({ ...large, speed: Math.fround(large.speed) }),
	);
	expect(blazePhase({ ticks: 48000, speed: 0, rate: blazeRate })).toBe(0);
});

test("direct binary32 rational rounding handles ties, subnormals and the unit seam", () => {
	expect(
		blazeFractionF32({ numerator: (1n << 24n) + 1n, denominator: 1n << 25n }),
	).toBe(0.5);
	expect(
		blazeFractionF32({ numerator: (1n << 24n) + 3n, denominator: 1n << 25n }),
	).toBe(0.5 + 2 ** -23);
	expect(
		blazeFractionF32({ numerator: (1n << 25n) - 1n, denominator: 1n << 25n }),
	).toBe(0);
	expect(blazeFractionF32({ numerator: 1n, denominator: 1n << 150n })).toBe(0);
	expect(blazeFractionF32({ numerator: 3n, denominator: 1n << 150n })).toBe(
		2 ** -148,
	);
	expect(blazeFractionF32({ numerator: 1n, denominator: 1n << 149n })).toBe(
		2 ** -149,
	);
});

test("spark fields depend on their own salts and retain a fixed bounded population", () => {
	const first = blazeSparks({ params: blazeDefaults, phase: 0.25 });
	expect(first).toHaveLength(24);
	expect(
		first.every(
			(spark) =>
				spark.x >= 0 &&
				spark.x < 1 &&
				spark.age >= 0 &&
				spark.age < 1 &&
				spark.radius >= Math.fround(0.003) &&
				spark.radius <= Math.fround(0.007) &&
				spark.drift >= -1 &&
				spark.drift <= 1,
		),
	).toBe(true);
	expect(first).not.toEqual(
		blazeSparks({ params: { ...blazeDefaults, seed: 2 }, phase: 0.25 }),
	);
	expect(first.map((spark) => spark.x)).not.toEqual(
		first.map((spark) => spark.age),
	);
});
