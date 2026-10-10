import assert from "node:assert/strict";

// Fixed before any export or reference inspection; codec tolerance is not fitted.
export const thresholds = Object.freeze({
	meanRgb: 4,
	activeRgb: 6,
	activePixels: 48,
	activeDelta: 16,
	timestamp: 0.0011,
});
export function frameIndex(ticks, startTicks) {
	assert(Number.isSafeInteger(ticks) && Number.isSafeInteger(startTicks));
	assert(
		ticks >= startTicks && (ticks - startTicks) % 5000 === 0,
		"Reference is not on the 24fps export grid",
	);
	return (ticks - startTicks) / 5000;
}
export function opaqueRgb(rgba, background) {
	assert(rgba.length % 4 === 0);
	const rgb = Buffer.alloc((rgba.length / 4) * 3);
	for (let p = 0; p < rgba.length / 4; p++) {
		// Opaque references need no assumed compositor; transparent ones fail closed.
		assert.equal(
			rgba[p * 4 + 3],
			255,
			"Production preview must already contain the actual opaque export background",
		);
		for (let c = 0; c < 3; c++) rgb[p * 3 + c] = rgba[p * 4 + c];
	}
	return rgb;
}
export function metric(actual, expected, baseline) {
	assert.equal(actual.length, expected.length);
	assert.equal(actual.length, baseline.length);
	let total = 0,
		activeTotal = 0,
		activePixels = 0;
	for (let p = 0; p < actual.length; p += 3) {
		const active = [0, 1, 2].some(
			(c) =>
				Math.abs(expected[p + c] - baseline[p + c]) > thresholds.activeDelta,
		);
		if (active) activePixels++;
		for (let c = 0; c < 3; c++) {
			const error = Math.abs(actual[p + c] - expected[p + c]);
			total += error;
			if (active) activeTotal += error;
		}
	}
	return {
		meanRgb: total / actual.length,
		activeRgb: activePixels ? activeTotal / (activePixels * 3) : Infinity,
		activePixels,
	};
}
export function accepts(value) {
	return (
		value.meanRgb <= thresholds.meanRgb &&
		value.activeRgb <= thresholds.activeRgb &&
		value.activePixels >= thresholds.activePixels
	);
}
export function shiftRight(rgb, width, height) {
	assert.equal(rgb.length, width * height * 3);
	const shifted = Buffer.from(rgb);
	for (let y = 0; y < height; y++)
		for (let x = 1; x < width; x++)
			for (let c = 0; c < 3; c++)
				shifted[(y * width + x) * 3 + c] = rgb[(y * width + x - 1) * 3 + c];
	return shifted;
}
