import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCompositionPixels } from "../probe-composition-pixels.mjs";

test("composition allows only one-level channel rounding with identical glyph coverage", () => {
	const expected = { pixels: [180, 90, 72, 255], cyan: [100], magenta: [200] };
	assertCompositionPixels(
		{ ...expected, pixels: [181, 89, 72, 255] },
		expected,
	);
	assert.throws(
		() =>
			assertCompositionPixels(
				{ ...expected, pixels: [182, 90, 72, 255] },
				expected,
			),
		/beyond one/,
	);
	assert.throws(
		() => assertCompositionPixels({ ...expected, cyan: [101] }, expected),
		/Chinese glyph/,
	);
	assert.throws(
		() => assertCompositionPixels({ ...expected, magenta: [] }, expected),
		/English glyph/,
	);
});
