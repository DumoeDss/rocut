import { expect, test } from "bun:test";
import { liquidDifference } from "./liquid-browser-oracle";
import { liquidSurfaceQuantizedReference } from "./liquid-surface-quantization";

test("RGBA8 presentation explains a measured edge without relaxing the raw oracle", () => {
	const raw = new Uint8ClampedArray([134, 0, 32, 41]);
	const observed = new Uint8ClampedArray([137, 0, 31, 41]);
	expect(liquidDifference(observed, raw).failures).toBe(1);
	expect(liquidSurfaceQuantizedReference(raw)).toEqual(observed);
	expect(raw).toEqual(new Uint8ClampedArray([134, 0, 32, 41]));
});

test("opaque identity, hidden RGB loss and extreme low-alpha quantization are explicit", () => {
	expect(
		liquidSurfaceQuantizedReference(
			new Uint8Array([134, 32, 240, 255, 134, 32, 240, 0, 128, 64, 254, 1]),
		),
	).toEqual(
		new Uint8ClampedArray([134, 32, 240, 255, 0, 0, 0, 0, 255, 0, 255, 1]),
	);
	expect(liquidSurfaceQuantizedReference(new Uint8Array())).toHaveLength(0);
	expect(() => liquidSurfaceQuantizedReference(new Uint8Array(3))).toThrow(
		"complete RGBA",
	);
});

test("every color/alpha pair stays in its independent integer quantization bin", () => {
	// Integer quotient/remainder bounds independently check rounding. No low
	// alpha or edge value is excluded; every pair, including zero, is visited.
	const input = new Uint8Array(256 * 256 * 4);
	for (let alpha = 0; alpha <= 255; alpha++)
		for (let color = 0; color <= 255; color++) {
			const i = (alpha * 256 + color) * 4;
			input.set([color, color, color, alpha], i);
		}
	const output = liquidSurfaceQuantizedReference(input);
	let violations = 0;
	for (let alpha = 0; alpha <= 255; alpha++) {
		let previous = 0;
		for (let color = 0; color <= 255; color++) {
			const i = (alpha * 256 + color) * 4;
			const numerator = color * alpha;
			const premultiplied =
				Math.trunc(numerator / 255) + (numerator % 255 >= 128 ? 1 : 0);
			const recovered = output[i];
			if (
				output[i + 3] !== alpha ||
				recovered < previous ||
				output[i + 1] !== recovered ||
				output[i + 2] !== recovered ||
				(alpha === 0
					? recovered !== 0
					: Math.abs(recovered * alpha - premultiplied * 255) > alpha / 2)
			)
				violations++;
			previous = recovered;
		}
	}
	expect(violations).toBe(0);
});

test("missing or double premultiplication is not accepted as quantization", () => {
	const expected = liquidSurfaceQuantizedReference(
		new Uint8ClampedArray([134, 0, 32, 41]),
	);
	for (const wrong of [
		[255, 0, 199, 41],
		[25, 0, 6, 41],
		[137, 0, 31, 255],
	])
		expect(
			liquidDifference(new Uint8ClampedArray(wrong), expected).failures,
		).toBeGreaterThan(0);
});
