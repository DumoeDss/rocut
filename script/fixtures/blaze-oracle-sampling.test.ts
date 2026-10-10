import { expect, test } from "bun:test";
import { blazeSource } from "./blaze-cases-source";
import { blazeSample, blazeStraightBytes } from "./blaze-oracle-sampling";

test("bilinear filtering ignores hidden RGB and preserves fractional coverage", () => {
	const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 255, 0]);
	const filtered = blazeSample({ pixels, width: 2, height: 1, x: 0.5, y: 0 });
	expect(filtered).toEqual([0.5, 0, 0, 0.5]);
	expect(Array.from(blazeStraightBytes(filtered))).toEqual([255, 0, 0, 128]);
	// Straight-alpha filtering would leak cyan; nearest sampling would lose the half coverage.
	expect(filtered).not.toEqual([0.25, 0.25, 0.25, 0.5]);
	expect(filtered).not.toEqual([0, 0, 0, 0]);
});

test("outside taps are transparent rather than edge-clamped", () => {
	const pixels = new Uint8ClampedArray([0, 128, 255, 255]);
	const edge = blazeSample({ pixels, width: 1, height: 1, x: -0.5, y: 0.5 });
	expect(edge).toEqual([0, 32 / 255, 0.25, 0.25]);
	expect(blazeSample({ pixels, width: 1, height: 1, x: -2, y: 0 })).toEqual([
		0, 0, 0, 0,
	]);
	expect(Array.from(blazeStraightBytes([1, 1, 1, 0]))).toEqual([0, 0, 0, 0]);
});

test("default sources contain asymmetric partial edges, transparent holes and non-periodic gradients", () => {
	const source = blazeSource();
	const opaque = blazeSource({ kind: "opaque" });
	const alpha = Array.from(
		{ length: source.length / 4 },
		(_, i) => source[i * 4 + 3],
	);
	expect(alpha.some((value) => value === 0)).toBe(true);
	expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
	expect(alpha.some((value) => value === 255)).toBe(true);
	expect(opaque[(64 * 192 + 40) * 4]).not.toBe(opaque[(64 * 192 + 80) * 4]);
	expect(blazeSource({ pattern: "stress" })).not.toEqual(source);
	const transparent = blazeSource({ kind: "transparent" });
	expect(
		blazeSample({
			pixels: transparent,
			width: 192,
			height: 128,
			x: 51.7,
			y: 48.3,
		}),
	).toEqual([0, 0, 0, 0]);
});
