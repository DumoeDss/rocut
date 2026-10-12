// Test-only scalar reference. No production resolver, uniforms or shader imports.
const u32 = (value) => BigInt.asUintN(32, value);
export function cellRandom(x, y, seed, salt) {
	let value = u32(BigInt(x) * 0x8da6b343n) ^
		u32(BigInt(y) * 0xd8163841n) ^
		u32(BigInt(seed) * 0xcb1ab31fn) ^
		u32(BigInt(salt) * 0x9e3779b9n);
	value = u32((value ^ (value >> 16n)) * 0x7feb352dn);
	value = u32((value ^ (value >> 15n)) * 0x846ca68bn);
	return Number((value ^ (value >> 16n)) & 65535n) / 65535;
}

export function crystalAt(px, py, scale, seed) {
	const sx = px * scale, sy = py * scale;
	let result = 0;
	for (let cy = Math.floor(sy) - 1; cy <= Math.floor(sy) + 1; cy++) {
		for (let cx = Math.floor(sx) - 1; cx <= Math.floor(sx) + 1; cx++) {
			const dx = sx - cx - 0.15 - 0.7 * cellRandom(cx, cy, seed, 1);
			const dy = sy - cy - 0.15 - 0.7 * cellRandom(cx, cy, seed, 2);
			const angle = cellRandom(cx, cy, seed, 3) * 6.28318530718;
			for (let arm = 0; arm < 3; arm++) {
				const theta = angle + arm * 1.0471975512;
				const cos = Math.cos(theta), sin = Math.sin(theta);
				const along = dx * cos + dy * sin;
				const across = dy * cos - dx * sin;
				const length = Math.max(0, 1 - Math.abs(along) / 0.7);
				result = Math.max(result, length / (1 + 784 * across ** 2));
			}
		}
	}
	return result;
}

export function capsuleAt(x, y, stroke, width, height) {
	const short = Math.min(width, height);
	const ax = stroke.from[0] * width / short;
	const ay = stroke.from[1] * height / short;
	const dx = (stroke.to[0] - stroke.from[0]) * width / short;
	const dy = (stroke.to[1] - stroke.from[1]) * height / short;
	const square = dx * dx + dy * dy;
	const projection = square === 0 ? 0 : Math.max(0, Math.min(1,
		((x - ax) * dx + (y - ay) * dy) / square));
	const distance = Math.hypot(x - ax - projection * dx, y - ay - projection * dy);
	const skirt = Math.max(0, Math.min(1, (distance / stroke.radius - 0.6) / 0.4));
	return 1 - skirt * skirt * (3 - 2 * skirt);
}

export function strengthAt(stroke, ticks, hold, recovery) {
	const age = BigInt(ticks) - BigInt(stroke.time);
	if (age < 0n || age >= BigInt(hold) + BigInt(recovery)) return 0;
	if (age <= BigInt(hold)) return stroke.strength;
	return stroke.strength * Number(BigInt(hold) + BigInt(recovery) - age) / recovery;
}

export function frameTicks(ticks, rate) {
	if (!Number.isSafeInteger(ticks)) throw Error("Safe integer ticks required");
	if (!Number.isSafeInteger(rate.numerator) || rate.numerator < 1 ||
		!Number.isSafeInteger(rate.denominator) || rate.denominator < 1)
		throw Error("Positive integer frame rate required");
	const scale = 120000n * BigInt(rate.denominator);
	if (rate.numerator > 120000 || rate.denominator > 1001 ||
		scale % BigInt(rate.numerator) !== 0n)
		throw Error("Frost frame rate requires bounded integral ticks/frame");
	if (ticks < 0) return ticks;
	const index = BigInt(ticks) * BigInt(rate.numerator) / scale;
	return Number(index * scale / BigInt(rate.numerator));
}

export function samplePremultiplied(source, width, height, x, y) {
	const left = Math.floor(x - 0.5), top = Math.floor(y - 0.5);
	const fx = x - 0.5 - left, fy = y - 0.5 - top;
	const result = [0, 0, 0, 0];
	for (let row = 0; row < 2; row++) {
		for (let col = 0; col < 2; col++) {
			const tx = left + col, ty = top + row;
			if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
			const offset = (ty * width + tx) * 4;
			const weight = (col ? fx : 1 - fx) * (row ? fy : 1 - fy);
			const alpha = source[offset + 3] / 255;
			for (let channel = 0; channel < 3; channel++)
				result[channel] += source[offset + channel] / 255 * alpha * weight;
			result[3] += alpha * weight;
		}
	}
	return result;
}
