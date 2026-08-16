/**
 * Stride/channel proof for the producer's RGBA→RGB24 drop (review B-1's
 * follow-up): synthetic gradient fixtures satisfy any uniform-but-wrong drop,
 * so the exact byte mapping is asserted here on crafted buffers — including a
 * 3-wide row, where a stride bug (reading `width*3` source bytes per row
 * instead of `width*4`) would pull pixel bytes from the previous row's tail.
 */
import { describe, expect, test } from "bun:test";
import { rgbaToRgb24 } from "../rgb24";

describe("rgbaToRgb24", () => {
	test("2x2: drops alpha, preserves per-pixel RGB order, length 3/4 of input", () => {
		const rgba = new Uint8ClampedArray([
			255, 0, 0, 255, // (0,0) opaque red
			10, 20, 30, 255, // (1,0)
			200, 100, 50, 128, // (0,1) alpha is ignored, not premultiplied
			0, 255, 0, 0, // (1,1) zero alpha still carries its RGB
		]);
		const rgb = rgbaToRgb24({ data: rgba, pixels: 4 });
		expect(rgb).toEqual(
			new Uint8Array([255, 0, 0, 10, 20, 30, 200, 100, 50, 0, 255, 0]),
		);
	});

	test("3x1 row: source stride is 4 bytes/pixel, not 3 — no cross-row bleed", () => {
		const rgba = new Uint8ClampedArray([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
		const rgb = rgbaToRgb24({ data: rgba, pixels: 3 });
		expect(rgb).toEqual(new Uint8Array([1, 2, 3, 5, 6, 7, 9, 10, 11]));
	});
});
