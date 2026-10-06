import assert from "node:assert/strict";
import {
	languageOverlap,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

// Only the known flat-red underlay fixture. Styled text can have dark fills
// and translucent outlines; cyan compositing equations do not describe it.
// Keep exact preview comparison separate from this compressed-export oracle.
export function inspectContinuityExportPixels(pixels) {
	assert.equal(pixels.length, 320 * 180 * 4);
	const foreground = [];
	for (let y = 2; y < 178; y++) {
		for (let x = 2; x < 318; x++) {
			const index = y * 320 + x;
			const [r, g, b] = pixels.slice(index * 4, index * 4 + 3);
			// Exclude plain red and its small H.264/YUV ringing, not dark ink.
			if (r < 210 || g > 45 || b > 45) foreground.push(index);
		}
	}
	return { foreground, pixels: Uint8Array.from(pixels) };
}

export const sampleContinuityExportPng = (page, png) =>
	// FFmpeg has already decoded the video into RGB samples. Its PNG can retain
	// video cICP/gAMA metadata; another image color conversion changes those
	// samples (and the foreground mask). Compare the decoded numerical raster.
	// General preview-image sampling deliberately keeps its default conversion.
	samplePreviewPng(page, png, inspectContinuityExportPixels, {
		colorSpaceConversion: "none",
	});

export function compareContinuityExport({ expected, actual }) {
	const union = new Set([...expected.foreground, ...actual.foreground]);
	let colorError = 0;
	for (const index of union) {
		for (let channel = 0; channel < 3; channel++) {
			const offset = index * 4 + channel;
			colorError += Math.abs(expected.pixels[offset] - actual.pixels[offset]);
		}
	}
	return {
		overlap: languageOverlap({
			expected: expected.foreground,
			actual: actual.foreground,
		}),
		// Excluding the red background prevents sparse text errors being diluted.
		meanColorError: colorError / Math.max(1, union.size * 3 * 255),
		expectedPixels: expected.foreground.length,
		actualPixels: actual.foreground.length,
	};
}

export function assertContinuityExport(scores) {
	assert(
		scores.expectedPixels > 25 && scores.actualPixels > 25,
		"visible export glyphs required",
	);
	assert(
		scores.overlap > 0.7,
		`export glyph position mismatch: ${scores.overlap}`,
	);
	assert(
		scores.meanColorError <= 0.1,
		`export foreground color mismatch: ${scores.meanColorError}`,
	);
}
