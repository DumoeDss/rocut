import {
	inspectLanguagePixels,
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

// Only for the known cyan-over-red continuity fixture. At opacity a, the
// reference composite is (255*(1-a), 255*a, 255*a), not solid cyan. Rain,
// reflections and antialiasing are still visible text. Tolerances allow the
// recorded H.264/color conversion; neither a red frame nor white qualifies.
export function inspectContinuityPixels(pixels) {
	const sample = inspectLanguagePixels(pixels);
	const overlay = [];
	for (let y = 2; y < 178; y++) {
		for (let x = 2; x < 318; x++) {
			const i = (y * 320 + x) * 4;
			const [r, g, b] = pixels.slice(i, i + 3);
			if (
				g > 48 &&
				b > 48 &&
				Math.abs(g - b) < 25 &&
				Math.abs(r + b - 255) < 35
			)
				overlay.push(y * 320 + x);
		}
	}
	return { ...sample, overlay };
}

export const sampleContinuityPng = (page, png) =>
	samplePreviewPng(page, png, inspectContinuityPixels);
export const continuityPreview = async (page) =>
	sampleContinuityPng(page, await (await mainPreviewCanvas(page)).screenshot());
