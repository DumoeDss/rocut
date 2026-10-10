import { expect, test } from "bun:test";
import { blazeLattice, blazeNoise, blazeOctave } from "./blaze-oracle-noise";

test("lattice interpolation wraps signed coordinates and is periodic over eight cells", () => {
	const lattice = blazeLattice(31415);
	const sample = blazeOctave({ lattice, plane: 2, x: -1.37, y: 2.41 });
	const wrapped = blazeOctave({ lattice, plane: 2, x: 6.63, y: 10.41 });
	for (const key of ["value", "dx", "dy"] as const)
		expect(sample[key]).toBeCloseTo(wrapped[key], 12);
	const corner = blazeOctave({ lattice, plane: 1, x: 0, y: 0 });
	expect(corner.value).toBe(lattice[64]);
	expect(Math.abs(corner.dx)).toBe(0);
	expect(Math.abs(corner.dy)).toBe(0);
});

test("analytic octave gradients match an independent finite difference", () => {
	const lattice = blazeLattice(27182);
	const point = { lattice, x: 1.37, y: -2.41, phase: 0.29 };
	const result = blazeNoise(point);
	const delta = 1e-5;
	const dx =
		(blazeNoise({ ...point, x: point.x + delta }).value -
			blazeNoise({ ...point, x: point.x - delta }).value) /
		(2 * delta);
	const dy =
		(blazeNoise({ ...point, y: point.y + delta }).value -
			blazeNoise({ ...point, y: point.y - delta }).value) /
		(2 * delta);
	expect(result.dx).toBeCloseTo(dx, 8);
	expect(result.dy).toBeCloseTo(dy, 8);
	expect(Math.hypot(result.dx, result.dy)).toBeGreaterThan(0.01);
});

test("temporal plane blending and the full eight-cell upward shift meet continuously", () => {
	const lattice = blazeLattice(65535);
	const first = blazeNoise({ lattice, x: 1.27, y: 3.19, phase: 0 });
	const near = blazeNoise({
		lattice,
		x: 1.27,
		y: 3.19 - 8 * (1 - 1e-7),
		phase: 1 - 1e-7,
	});
	for (const key of ["value", "dx", "dy"] as const)
		expect(near[key]).toBeCloseTo(first[key], 4);
	const otherPlane = blazeNoise({ lattice, x: 1.27, y: 3.19, phase: 0.25 });
	expect(Math.abs(otherPlane.value - first.value)).toBeGreaterThan(0.001);
});
