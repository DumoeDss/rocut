import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertContinuityPreview,
	inspectContinuityPixels,
} from "../probe-continuity-pixels.mjs";

test("cyan over red includes visible transparency but rejects empty and unrelated colors", () => {
	const pixels = new Uint8Array(320 * 180 * 4);
	const colors = [
		[255, 0, 0],
		[0, 255, 255],
		[128, 127, 127],
		[180, 75, 75],
		[255, 255, 255],
		[255, 0, 255],
		[0, 255, 0],
		[255, 255, 0],
		[235, 20, 20],
	];
	for (const [index, color] of colors.entries())
		pixels.set([...color, 255], (3 * 320 + 3 + index) * 4);
	const sample = inspectContinuityPixels(pixels);
	assert.deepEqual(sample.overlay, [964, 965, 966]);
	assert.deepEqual(sample.cyan, [964]);
});

test("card backs remain visible without cyan and require exact geometry and RGBA", () => {
	const pixels = new Uint8Array(320 * 180 * 4);
	for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 0, 255], i);
	assert.equal(inspectContinuityPixels(pixels).foreground.length, 0);
	for (let x = 20; x < 60; x++)
		pixels.set([197, 184, 140, 255], (40 * 320 + x) * 4);
	const expected = inspectContinuityPixels(pixels);
	assert.equal(expected.overlay.length, 0);
	assert.equal(expected.foreground.length, 40);
	assertContinuityPreview({
		expected,
		actual: inspectContinuityPixels(pixels),
		label: "same card",
	});
	const recolored = pixels.slice();
	recolored[(40 * 320 + 20) * 4]++;
	assert.throws(
		() =>
			assertContinuityPreview({
				expected,
				actual: inspectContinuityPixels(recolored),
				label: "changed card",
			}),
		/exact foreground RGBA/,
	);
	const moved = pixels.slice();
	moved.set([255, 0, 0, 255], (40 * 320 + 20) * 4);
	moved.set([197, 184, 140, 255], (40 * 320 + 60) * 4);
	assert.throws(
		() =>
			assertContinuityPreview({
				expected,
				actual: inspectContinuityPixels(moved),
				label: "moved card",
			}),
		/all foreground positions/,
	);
	const blank = pixels.slice();
	for (let x = 20; x < 60; x++) blank.set([255, 0, 0, 255], (40 * 320 + x) * 4);
	assert.throws(
		() =>
			assertContinuityPreview({
				expected,
				actual: inspectContinuityPixels(blank),
				label: "missing card",
			}),
		/all foreground positions/,
	);
});
