import assert from "node:assert/strict";
import {
	inspectLanguagePixels,
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

// Only for the known red-underlay continuity fixtures. For cyan at opacity a, the
// reference composite is (255*(1-a), 255*a, 255*a), not solid cyan. Rain,
// reflections and antialiasing are still visible text. Tolerances allow the
// recorded H.264/color conversion; neither red nor white qualifies as cyan.
export function inspectContinuityPixels(pixels) {
	const sample = inspectLanguagePixels(pixels);
	const overlay = [];
	const foreground = [];
	const foregroundRgba = [];
	for (let y = 2; y < 178; y++) {
		for (let x = 2; x < 318; x++) {
			const i = (y * 320 + x) * 4;
			const [r, g, b] = pixels.slice(i, i + 3);
			// Variation may legitimately show a card back or dark ink instead of
			// cyan. Retain exact positions AND colors outside the known red video;
			// keep the original cyan mask too, not a looser overlap-only oracle.
			if (r < 210 || g > 45 || b > 45) {
				foreground.push(y * 320 + x);
				foregroundRgba.push(r, g, b, pixels[i + 3]);
			}
			if (
				g > 48 &&
				b > 48 &&
				Math.abs(g - b) < 25 &&
				Math.abs(r + b - 255) < 35
			)
				overlay.push(y * 320 + x);
		}
	}
	return { ...sample, overlay, foreground, foregroundRgba };
}

export function assertContinuityPreview({ expected, actual, label }) {
	assert.deepEqual(
		actual.overlay,
		expected.overlay,
		`${label}: cyan positions`,
	);
	assert.deepEqual(
		actual.foreground,
		expected.foreground,
		`${label}: all foreground positions`,
	);
	assert.deepEqual(
		actual.foregroundRgba,
		expected.foregroundRgba,
		`${label}: exact foreground RGBA`,
	);
}

export const sampleContinuityPng = (page, png) =>
	samplePreviewPng(page, png, inspectContinuityPixels);
export const continuityPreview = async (page) =>
	sampleContinuityPng(page, await (await mainPreviewCanvas(page)).screenshot());
