import assert from "node:assert/strict";
import {
	inspectLanguagePixels,
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

export async function compositionPreview(page) {
	return samplePreviewPng(
		page,
		await (await mainPreviewCanvas(page)).screenshot(),
		(pixels) => ({ ...inspectLanguagePixels(pixels), pixels }),
	);
}

// A rebuilt GPU graph can round an antialiased color channel by one 8-bit
// level. Keep glyph coverage exact and reject every channel difference >1;
// this is not a perceptual/image-similarity threshold or a shape tolerance.
export function assertCompositionPixels(actual, expected) {
	assert.deepEqual(
		actual.cyan,
		expected.cyan,
		"Chinese glyph coverage changed",
	);
	assert.deepEqual(
		actual.magenta,
		expected.magenta,
		"English glyph coverage changed",
	);
	assert.equal(actual.pixels.length, expected.pixels.length);
	let maxDifference = 0;
	for (let i = 0; i < actual.pixels.length; i++)
		maxDifference = Math.max(
			maxDifference,
			Math.abs(actual.pixels[i] - expected.pixels[i]),
		);
	assert(
		maxDifference <= 1,
		"compositor channels differ by " +
			maxDifference +
			", beyond one 8-bit rounding level",
	);
}
