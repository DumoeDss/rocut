import { blazeUnit } from "./blaze-oracle-time";

export type BlazeNoise = { value: number; dx: number; dy: number };
export const blazeSmooth = (x: number) => x * x * (3 - 2 * x);
const slope = (x: number) => 6 * x * (1 - x);
export const blazeMix = (a: number, b: number, t: number) => a + (b - a) * t;
export function blazeSmoothstep({
	low,
	high,
	value,
}: {
	low: number;
	high: number;
	value: number;
}) {
	return blazeSmooth(Math.min(1, Math.max(0, (value - low) / (high - low))));
}

export function blazeLattice(seed: number) {
	return Float64Array.from({ length: 256 }, (_, index) =>
		blazeUnit({ seed, index, salt: 0x3c6ef372 }),
	);
}

export function blazeOctave({
	lattice,
	plane,
	x,
	y,
}: {
	lattice: Float64Array;
	plane: number;
	x: number;
	y: number;
}): BlazeNoise {
	const left = Math.floor(x),
		top = Math.floor(y);
	const u = x - left,
		v = y - top;
	const wrap = (coordinate: number) => ((coordinate % 8) + 8) % 8;
	const at = (px: number, py: number) =>
		lattice[plane * 64 + wrap(py) * 8 + wrap(px)];
	const a = at(left, top),
		b = at(left + 1, top),
		c = at(left, top + 1),
		d = at(left + 1, top + 1);
	const sx = blazeSmooth(u),
		sy = blazeSmooth(v);
	return {
		value: blazeMix(blazeMix(a, b, sx), blazeMix(c, d, sx), sy),
		dx: slope(u) * blazeMix(b - a, d - c, sy),
		dy: slope(v) * blazeMix(c - a, d - b, sx),
	};
}

export function blazeNoise({
	lattice,
	x,
	y,
	phase,
}: {
	lattice: Float64Array;
	x: number;
	y: number;
	phase: number;
}): BlazeNoise {
	const cycle = phase * 4;
	const first = Math.floor(cycle);
	const blend = blazeSmooth(cycle - first);
	const planes = [first, (first + 1) % 4].map((plane) => {
		const low = blazeOctave({ lattice, plane, x, y });
		const high = blazeOctave({ lattice, plane, x: 2 * x, y: 2 * y });
		return {
			value: (2 * low.value + high.value) / 3,
			dx: (2 * low.dx + 2 * high.dx) / 3,
			dy: (2 * low.dy + 2 * high.dy) / 3,
		};
	});
	return {
		value: blazeMix(planes[0].value, planes[1].value, blend),
		dx: blazeMix(planes[0].dx, planes[1].dx, blend),
		dy: blazeMix(planes[0].dy, planes[1].dy, blend),
	};
}
