import type { CloudsRate } from "./clouds-cases";

export function cloudsSampleTicks(local: number, rate: CloudsRate): bigint {
	const { numerator, denominator } = rate;
	const step = (120000 * denominator) / numerator;
	if (
		!Number.isSafeInteger(local) ||
		!Number.isInteger(numerator) ||
		numerator < 1 ||
		numerator > 120000 ||
		!Number.isInteger(denominator) ||
		denominator < 1 ||
		denominator > 1001 ||
		!Number.isSafeInteger(step) ||
		step < 1
	)
		throw Error("Invalid Clouds oracle time or frame rate");
	const ticks = BigInt(local),
		quantum = BigInt(step);
	return ticks - (((ticks % quantum) + quantum) % quantum);
}

/** Exact IEEE754-speed rational reduction precedes the final shader f32 phase. */
export function cloudsTimePhase(
	local: number,
	speed: number,
	rate: CloudsRate,
) {
	const ticks = cloudsSampleTicks(local, rate);
	if (!Number.isFinite(speed) || speed < 0 || speed > 4)
		throw Error("Invalid Clouds speed");
	if (speed === 0) return 0;
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, speed, false);
	const bits = view.getBigUint64(0, false);
	const exponent = Number((bits >> 52n) & 2047n);
	const significand = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
	const power = exponent ? exponent - 1075 : -1074;
	const numerator =
		ticks * significand * (power > 0 ? 1n << BigInt(power) : 1n);
	const denominator = 120000n * (power < 0 ? 1n << BigInt(-power) : 1n);
	const remainder = ((numerator % denominator) + denominator) % denominator;
	const shift = BigInt(Math.max(0, denominator.toString(2).length - 1000));
	const phase = Math.fround(
		Number(remainder >> shift) / Number(denominator >> shift),
	);
	return phase >= 1 ? 0 : phase;
}
