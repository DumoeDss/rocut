import type { BlazeParams, BlazeRate } from "./blaze-cases";

const wordMask = (1n << 32n) - 1n;

/** BigInt reference: no production hash, evaluator, uniforms or shader imports. */
export function blazeHash({
	seed,
	index,
	salt,
}: {
	seed: number;
	index: number;
	salt: number;
}) {
	if (
		!Number.isInteger(seed) ||
		seed < 0 ||
		seed > 65535 ||
		!Number.isInteger(index) ||
		index < 0 ||
		index > 0xffffffff ||
		!Number.isInteger(salt) ||
		salt < 0 ||
		salt > 0xffffffff
	)
		throw Error("Invalid Blaze hash key");
	let value =
		BigInt(seed) ^
		(((BigInt(index) + 1n) * 0x9e3779b9n) & wordMask) ^
		BigInt(salt);
	value = ((value ^ (value >> 16n)) * 0x7feb352dn) & wordMask;
	value = ((value ^ (value >> 15n)) * 0x846ca68bn) & wordMask;
	return Number(value ^ (value >> 16n));
}

export function blazeUnit(key: Parameters<typeof blazeHash>[0]) {
	return Math.floor(blazeHash(key) / 256) / 16777216;
}

export function blazeSampleTicks({
	ticks,
	rate,
}: {
	ticks: number;
	rate: BlazeRate;
}) {
	if (
		!Number.isSafeInteger(ticks) ||
		!Number.isInteger(rate.numerator) ||
		rate.numerator < 1 ||
		rate.numerator > 120000 ||
		!Number.isInteger(rate.denominator) ||
		rate.denominator < 1 ||
		rate.denominator > 1001
	)
		throw Error("Invalid Blaze clock");
	const numerator = 120000n * BigInt(rate.denominator);
	const denominator = BigInt(rate.numerator);
	if (numerator % denominator !== 0n)
		throw Error("Blaze clock requires integral frame ticks");
	const step = numerator / denominator;
	const local = BigInt(ticks);
	return local - (((local % step) + step) % step);
}

export function blazePhaseFraction({
	ticks,
	speed,
	rate,
}: {
	ticks: number;
	speed: number;
	rate: BlazeRate;
}) {
	if (!Number.isFinite(speed) || speed < 0 || speed > 4)
		throw Error("Invalid Blaze speed");
	const sampled = blazeSampleTicks({ ticks, rate });
	if (speed === 0) return { numerator: 0n, denominator: 1n };
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, speed);
	const bits = view.getBigUint64(0);
	const exponent = Number((bits >> 52n) & 2047n);
	const significand =
		(bits & ((1n << 52n) - 1n)) + (exponent === 0 ? 0n : 1n << 52n);
	const shift = exponent === 0 ? -1074 : exponent - 1075;
	const product =
		sampled * significand * (shift > 0 ? 1n << BigInt(shift) : 1n);
	const denominator = 120000n * (shift < 0 ? 1n << BigInt(-shift) : 1n);
	return {
		numerator: ((product % denominator) + denominator) % denominator,
		denominator,
	};
}

/** Exact positive rational -> binary32, round-to-nearest/ties-to-even. */
export function blazeFractionF32({
	numerator,
	denominator,
}: {
	numerator: bigint;
	denominator: bigint;
}) {
	if (denominator <= 0n || numerator < 0n || numerator >= denominator)
		throw Error("Expected a unit fraction");
	if (numerator === 0n) return 0;
	let exponent = numerator.toString(2).length - denominator.toString(2).length;
	if (
		exponent >= 0
			? numerator < denominator << BigInt(exponent)
			: numerator << BigInt(-exponent) < denominator
	)
		exponent--;
	const power = Math.max(exponent, -126) - 23;
	const scaled = numerator << BigInt(-power);
	let integer = scaled / denominator;
	const twiceRemainder = (scaled % denominator) * 2n;
	if (
		twiceRemainder > denominator ||
		(twiceRemainder === denominator && integer % 2n === 1n)
	)
		integer++;
	const rounded = Number(integer) * 2 ** power;
	return rounded >= 1 ? 0 : rounded;
}

export function blazePhase(request: Parameters<typeof blazePhaseFraction>[0]) {
	return blazeFractionF32(blazePhaseFraction(request));
}

export function blazeSparks({
	params,
	phase,
}: {
	params: BlazeParams;
	phase: number;
}) {
	return Array.from({ length: 24 }, (_, index) => {
		const unit = (salt: number) =>
			blazeUnit({ seed: params.seed, index, salt });
		const summed = unit(0x63d83595) + phase;
		const age = Math.fround(summed - Math.floor(summed));
		return {
			x: unit(0xa511e9b3),
			age: age >= 1 ? 0 : age,
			radius: Math.fround(0.003 + 0.004 * unit(0xb5297a4d)),
			drift: Math.fround(2 * unit(0x1b56c4e9) - 1),
		};
	});
}
