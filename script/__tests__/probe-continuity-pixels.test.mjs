import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectContinuityPixels } from "../probe-continuity-pixels.mjs";

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
