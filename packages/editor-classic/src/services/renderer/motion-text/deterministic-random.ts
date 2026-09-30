export function unitRandom({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d) >>> 0;
	value ^= value >>> 15;
	value = Math.imul(value, 0x846ca68b) >>> 0;
	value ^= value >>> 16;
	return (value >>> 0) / 0x1_0000_0000;
}

export function signedRandom({
	seed,
	salt,
}: {
	readonly seed: number;
	readonly salt: number;
}): number {
	return unitRandom({ seed, salt }) * 2 - 1;
}
