export type CloudsNoise = { value: number; dx: number; dy: number };
const smooth = (x: number) => x * x * (3 - 2 * x);
const slope = (x: number) => 6 * x * (1 - x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Contract reference only; no production hash, uniform, evaluator, or shader imports. */
export function cloudsHash(seed: number, index: number) {
	if (
		!Number.isInteger(seed) ||
		seed < 0 ||
		seed > 65535 ||
		!Number.isInteger(index) ||
		index < 0 ||
		index > 1023
	)
		throw Error("Invalid Clouds lattice key");
	let value = (seed ^ Math.imul(index + 1, 0x9e3779b9) ^ 0x68bc21eb) >>> 0;
	value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
	value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
	return (value ^ (value >>> 16)) >>> 0;
}

export function cloudsLattice(seed: number) {
	return Float32Array.from(
		{ length: 1024 },
		(_, index) => (cloudsHash(seed, index) >>> 8) / 16777216,
	);
}

export function cloudsLatticeAt(
	lattice: Float32Array,
	plane: number,
	x: number,
	y: number,
): CloudsNoise {
	const left = Math.floor(x),
		top = Math.floor(y),
		tx = x - left,
		ty = y - top;
	const wrap = (index: number) => ((index % 16) + 16) % 16;
	const at = (px: number, py: number) =>
		lattice[plane * 256 + wrap(py) * 16 + wrap(px)];
	const a = at(left, top),
		b = at(left + 1, top),
		c = at(left, top + 1),
		d = at(left + 1, top + 1);
	const sx = smooth(tx),
		sy = smooth(ty);
	return {
		value: mix(mix(a, b, sx), mix(c, d, sx), sy),
		dx: mix(b - a, d - c, sy) * slope(tx),
		dy: mix(c - a, d - b, sx) * slope(ty),
	};
}

export function cloudsNoiseAt(
	lattice: Float32Array,
	x: number,
	y: number,
	phase: number,
): CloudsNoise {
	const position = phase * 4,
		first = Math.floor(position),
		blend = smooth(position - first);
	const result = { value: 0, dx: 0, dy: 0 };
	for (const [frequency, weight] of [
		[1, 4 / 7],
		[2, 2 / 7],
		[4, 1 / 7],
	]) {
		const a = cloudsLatticeAt(lattice, first, x * frequency, y * frequency);
		const b = cloudsLatticeAt(
			lattice,
			(first + 1) % 4,
			x * frequency,
			y * frequency,
		);
		result.value += mix(a.value, b.value, blend) * weight;
		result.dx += mix(a.dx, b.dx, blend) * frequency * weight;
		result.dy += mix(a.dy, b.dy, blend) * frequency * weight;
	}
	return result;
}
