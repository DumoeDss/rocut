import assert from "node:assert/strict";
import { test } from "node:test";
import { p1dAcesExposure1Linear, p1dLinearToSrgb8, P1D_SVG_COLOR_RGBA } from "./p1d-three-browser-color-reference.mjs";

test("independent fixed ACES scalar reference preserves the analytic green intermediate and sRGB8 result", () => {
	// Analytic reference recorded before browser readback; not values loaded from a failure PNG.
	const expected = [.2933592560122896, .7746073220329723, .09943390398268362];
	const actual = p1dAcesExposure1Linear([0, 1, 0]);
	actual.forEach((channel, i) => assert(Math.abs(channel - expected[i]) < 1e-12));
	assert.deepEqual(P1D_SVG_COLOR_RGBA, [147, 228, 89, 255]);
});
test("independent sRGB8 transfer has fixed black, linear-knee, middle-gray and white reference values", () => {
	for (const [linear, byte] of [[0, 0], [.0031308, 10], [.18, 118], [.5, 188], [1, 255], [-1, 0], [2, 255]])
		assert.equal(p1dLinearToSrgb8(linear), byte);
});
test("ACES black clamps to zero and neutral white has no channel tint", () => {
	assert.deepEqual(p1dAcesExposure1Linear([0, 0, 0]), [0, 0, 0]);
	const neutral = p1dAcesExposure1Linear([1, 1, 1]).map(p1dLinearToSrgb8);
	assert(neutral[0] > 200 && neutral[0] < 255);
	assert.equal(neutral[0], neutral[1]); assert.equal(neutral[1], neutral[2]);
});
