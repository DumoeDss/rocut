import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import {
	assertContinuityExport,
	compareContinuityExport,
	inspectContinuityExportPixels,
	sampleContinuityExportPng,
} from "./probe-continuity-export-pixels.mjs";
import { samplePreviewPng } from "./probe-multilingual-media.mjs";

function fixture({ blank = false, shift = 0, color = [0, 255, 255] } = {}) {
	const pixels = new Uint8Array(320 * 180 * 4);
	for (let y = 0; y < 180; y++) {
		for (let x = 0; x < 320; x++) {
			let rgb = y >= 120 ? [246, 50, 23] : [255, 24, 0];
			const xx = x - shift;
			if (!blank && xx >= 40 && xx < 180 && y >= 30 && y < 110)
				rgb = xx < 75 || xx > 145 || (y >= 60 && y < 85) ? color : [25, 25, 25];
			pixels.set([...rgb, 255], (y * 320 + x) * 4);
		}
	}
	return pixels;
}

function roundTripPng(pixels) {
	const encoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-f",
			"rawvideo",
			"-pixel_format",
			"rgba",
			"-video_size",
			"320x180",
			"-i",
			"pipe:0",
			"-vf",
			"scale=out_color_matrix=bt709",
			"-frames:v",
			"1",
			"-c:v",
			"libx264",
			"-crf",
			"18",
			"-pix_fmt",
			"yuv420p",
			"-colorspace",
			"bt709",
			"-color_trc",
			"bt709",
			"-color_primaries",
			"bt709",
			"-f",
			"h264",
			"pipe:1",
		],
		{ input: pixels, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
	);
	return execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			"pipe:0",
			"-frames:v",
			"1",
			"-f",
			"image2pipe",
			"-vcodec",
			"png",
			"pipe:1",
		],
		{ input: encoded, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
	);
}

const browser = await chromium.launch({
	executablePath: process.env.ROCUT_TEST_CHROMIUM,
	headless: true,
});
try {
	const page = await browser.newPage();
	const reference = fixture();
	const expected = inspectContinuityExportPixels(reference);
	const png = roundTripPng(reference);
	assert(
		png.includes(Buffer.from("cICP")) && png.includes(Buffer.from("gAMA")),
		"Must exercise tagged decoded PNGs",
	);
	const original = compareContinuityExport({
		expected,
		actual: await samplePreviewPng(page, png, inspectContinuityExportPixels),
	});
	console.log(JSON.stringify({ original }));
	assert.throws(
		() => assertContinuityExport(original),
		"Default image conversion must reproduce the retained failure",
	);
	const corrected = compareContinuityExport({
		expected,
		actual: await sampleContinuityExportPng(page, png),
	});
	assertContinuityExport(corrected);
	for (const wrong of [
		fixture({ blank: true }),
		fixture({ shift: 100 }),
		fixture({ color: [255, 0, 255] }),
	]) {
		const score = compareContinuityExport({
			expected,
			actual: await sampleContinuityExportPng(page, roundTripPng(wrong)),
		});
		assert.throws(
			() => assertContinuityExport(score),
			"Blank, shifted and recolored exports must still fail",
		);
	}
	console.log(JSON.stringify({ passed: true, checks: 5, original, corrected }));
} finally {
	await browser.close();
}
