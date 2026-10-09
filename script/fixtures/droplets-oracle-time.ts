import type { DropletsParams, DropletsRate } from "./droplets-cases";

/** Independent reference of the agreed seeded ellipse/optical contract.
 * No production evaluator, shader, or resolved uniforms are imported. */
export function dropletsHash(seed: number, index: number, salt: number) {
	let value = (seed ^ Math.imul(index + 1, 0x9e3779b9) ^ salt) >>> 0;
	value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
	value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
	return (value ^ (value >>> 16)) >>> 0;
}

export function dropletsSampleTicks(local: number, rate: DropletsRate) {
	const step = (120000 * rate.denominator) / rate.numerator;
	if (
		!Number.isSafeInteger(local) ||
		!Number.isSafeInteger(step) ||
		step < 1 ||
		!Number.isInteger(rate.numerator) ||
		rate.numerator < 1 ||
		rate.numerator > 120000 ||
		!Number.isInteger(rate.denominator) ||
		rate.denominator < 1 ||
		rate.denominator > 1001
	)
		throw Error("Invalid oracle time or frame rate");
	const ticks = BigInt(local),
		divisor = BigInt(step);
	const remainder = ((ticks % divisor) + divisor) % divisor;
	return ticks - remainder;
}

export function dropletsTimePhase(
	local: number,
	speed: number,
	rate: DropletsRate,
) {
	if (!Number.isFinite(speed) || speed < 0 || speed > 4)
		throw Error("Invalid speed");
	const ticks = dropletsSampleTicks(local, rate);
	if (speed === 0) return 0;
	const bits = new DataView(new ArrayBuffer(8));
	bits.setFloat64(0, speed, false);
	const word = bits.getBigUint64(0, false);
	const exponent = Number((word >> 52n) & 0x7ffn);
	const mantissa = (word & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
	const power = exponent ? exponent - 1075 : -1074;
	const numerator = ticks * mantissa * (power > 0 ? 1n << BigInt(power) : 1n);
	const denominator = 120000n * (power < 0 ? 1n << BigInt(-power) : 1n);
	const remainder = ((numerator % denominator) + denominator) % denominator;
	// Avoid converting an enormous subnormal denominator to Infinity.
	const shift = Math.max(0, denominator.toString(2).length - 1000);
	const phase =
		Number(remainder >> BigInt(shift)) / Number(denominator >> BigInt(shift));
	return phase >= 1 ? 0 : phase;
}

export function dropletsGeometry(
	params: DropletsParams,
	local: number,
	rate: DropletsRate,
) {
	const resolvedPhase = Math.fround(
		dropletsTimePhase(local, params.speed, rate),
	);
	const phase = resolvedPhase >= 1 ? 0 : resolvedPhase;
	const uniform = (index: number, salt: number) =>
		(dropletsHash(params.seed, index, salt) >>> 8) / 16777216;
	return Array.from({ length: params.count }, (_, index) => ({
		x: Math.fround(uniform(index, 0xa511e9b3)),
		phase: Math.fround((uniform(index, 0x63d83595) + phase) % 1),
		radius: Math.fround(
			Math.fround(params.radius) * (0.75 + 0.5 * uniform(index, 0xb5297a4d)),
		),
		elongation: Math.fround(params.elongation),
	}));
}
