import { describe, expect, test } from "bun:test";
import { cloudsRate } from "./clouds-cases";
import {
	cloudsHash,
	cloudsLattice,
	cloudsLatticeAt,
	cloudsNoiseAt,
} from "./clouds-oracle-noise";
import { cloudsSampleTicks, cloudsTimePhase } from "./clouds-oracle-time";

describe("Independent Clouds noise and exact clock", () => {
	test("fixed uint32 lattice vectors from separate bigint arithmetic", () => {
		for (const [seed, index, hash, value] of [
			[0, 0, 983910899, 0.2290845513343811],
			[1, 0, 3422441734, 0.7968493103981018],
			[1, 255, 1976262035, 0.4601343274116516],
			[1, 256, 4127296945, 0.9609611630439758],
			[1, 1023, 2990523251, 0.6962854266166687],
			[31415, 17, 3188082950, 0.7422834038734436],
			[65535, 1023, 526135150, 0.12250036001205444],
		]) {
			expect(cloudsHash(seed, index)).toBe(hash);
			expect(cloudsLattice(seed)[index]).toBe(value);
		}
		for (const seed of [0, 1, 65535]) {
			const lattice = cloudsLattice(seed);
			expect(lattice.length).toBe(1024);
			expect(
				lattice.every(
					(value) => value >= 0 && value < 1 && Math.fround(value) === value,
				),
			).toBe(true);
		}
		expect(() => cloudsHash(1, 1024)).toThrow();
		expect(() => cloudsHash(65536, 0)).toThrow();
	});
	test("hand-calculated cubic interpolation, gradient and negative lattice wrapping", () => {
		const lattice = new Float32Array(1024);
		lattice[0] = 0;
		lattice[1] = 1;
		lattice[16] = 0.25;
		lattice[17] = 0.75;
		expect(cloudsLatticeAt(lattice, 0, 0.5, 0.5)).toEqual({
			value: 0.5,
			dx: 1.125,
			dy: 0,
		});
		expect(cloudsLatticeAt(lattice, 0, -15.5, -15.5)).toEqual({
			value: 0.5,
			dx: 1.125,
			dy: 0,
		});
		const corner = cloudsLatticeAt(lattice, 0, 1, 1);
		expect(corner.value).toBe(0.75);
		expect(Math.abs(corner.dx)).toBe(0);
		expect(Math.abs(corner.dy)).toBe(0);
	});
	test("octave derivative includes frequency and temporal gradient blending", () => {
		const lattice = cloudsLattice(31415),
			epsilon = 1e-6;
		for (const [x, y, phase] of [
			[0.37, -0.43, 0.19],
			[-20.13, 18.31, 0.61],
		]) {
			const value = cloudsNoiseAt(lattice, x, y, phase);
			const dx =
				(cloudsNoiseAt(lattice, x + epsilon, y, phase).value -
					cloudsNoiseAt(lattice, x - epsilon, y, phase).value) /
				(2 * epsilon);
			const dy =
				(cloudsNoiseAt(lattice, x, y + epsilon, phase).value -
					cloudsNoiseAt(lattice, x, y - epsilon, phase).value) /
				(2 * epsilon);
			expect(value.dx).toBeCloseTo(dx, 7);
			expect(value.dy).toBeCloseTo(dy, 7);
			const wrapped = cloudsNoiseAt(lattice, x + 16, y - 16, phase);
			for (const key of ["value", "dx", "dy"] as const)
				expect(wrapped[key]).toBeCloseTo(value[key], 11);
		}
	});
	test("all four temporal seams are continuous without historical state", () => {
		const lattice = cloudsLattice(1);
		for (const seam of [0, 0.25, 0.5, 0.75]) {
			const left = cloudsNoiseAt(lattice, 0.37, -0.29, (seam - 1e-6 + 1) % 1);
			const right = cloudsNoiseAt(lattice, 0.37, -0.29, seam + 1e-6);
			for (const key of ["value", "dx", "dy"] as const)
				expect(left[key]).toBeCloseTo(right[key], 8);
		}
	});
	test("Euclidean frame floor and exact IEEE754 speed survive huge signed times", () => {
		const fractional = { numerator: 30000, denominator: 1001 };
		expect(cloudsSampleTicks(-1, fractional)).toBe(-4004n);
		expect(cloudsSampleTicks(4003, fractional)).toBe(0n);
		expect(cloudsSampleTicks(4004, fractional)).toBe(4004n);
		expect(cloudsTimePhase(120000, 0.5, cloudsRate)).toBe(0.5);
		expect(cloudsTimePhase(-60000, 0.5, cloudsRate)).toBe(0.75);
		expect(cloudsTimePhase(240000, 0.5, cloudsRate)).toBe(0);
		// .05 is exactly 3602879701896397 / 2^56, not a decimal rational 1/20.
		expect(cloudsTimePhase(2400000, 0.05, cloudsRate)).toBe(
			5.551115123125783e-17,
		);
		expect(cloudsTimePhase(Number.MAX_SAFE_INTEGER, 0.05, cloudsRate)).toBe(
			0.47500020265579224,
		);
		expect(cloudsTimePhase(-Number.MAX_SAFE_INTEGER, 0.05, cloudsRate)).toBe(
			0.5233331322669983,
		);
		expect(cloudsTimePhase(Number.MAX_SAFE_INTEGER, 0.05, fractional)).toBe(
			0.47403520345687866,
		);
		expect(cloudsTimePhase(-1, 0.05, fractional)).toBe(0.9983316659927368);
		expect(cloudsTimePhase(-1, Number.MIN_VALUE, cloudsRate)).toBe(0);
		expect(cloudsTimePhase(Number.MAX_SAFE_INTEGER, 0, cloudsRate)).toBe(0);
	});
	test("invalid time or rate still rejects when speed is zero", () => {
		for (const local of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
			expect(() => cloudsTimePhase(local, 0, cloudsRate)).toThrow();
		for (const rate of [
			{ numerator: 0, denominator: 1 },
			{ numerator: 7, denominator: 1 },
			{ numerator: 120001, denominator: 1 },
			{ numerator: 30, denominator: 1002 },
			{ numerator: 30, denominator: 0 },
		])
			expect(() => cloudsTimePhase(0, 0, rate)).toThrow();
		for (const speed of [-1, 4.001, Infinity, NaN])
			expect(() => cloudsTimePhase(0, speed, cloudsRate)).toThrow();
	});
});
