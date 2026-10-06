import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { inspectF03, assertF03 } from "../probe-f03-pixels.mjs";
import { compareF03Export, assertF03Export } from "../probe-f03-export.mjs";

const raster = ({ omitted = -1, shift = 0, recolor = false } = {}) => {
	const pixels = Buffer.alloc(320 * 180 * 4);
	for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
	const colors = [
		[0, 255, 255],
		[255, 0, 255],
		[0, 255, 0],
	];
	for (let layer = 0; layer < 3; layer++) {
		if (layer === omitted) continue;
		for (let y = 70; y < 105; y++)
			for (let x = 25 + layer * 106; x < 75 + layer * 106; x++) {
				if (x % 10 > 5 && y % 10 > 4) continue;
				pixels.set(
					recolor ? [240, 240, 240] : colors[layer],
					(y * 320 + x + shift) * 4,
				);
			}
	}
	return pixels;
};
const expected = inspectF03(raster());

test("F03 complete simultaneous masks match exactly", () => {
	assertF03(expected);
	assert.deepEqual(compareF03Export(expected, expected), [1, 1, 1]);
	assertF03Export([1, 1, 1]);
});

test("F03 rejects every omitted layer and a blank/recolored picture", () => {
	for (let omitted = 0; omitted < 3; omitted++)
		assert.throws(() => assertF03(inspectF03(raster({ omitted }))));
	assert.throws(() => assertF03(inspectF03(Buffer.alloc(320 * 180 * 4))));
	assert.throws(() => assertF03(inspectF03(raster({ recolor: true }))));
});

test("F03 rejects shifted masks even when all three colors remain visible", () => {
	const shifted = inspectF03(raster({ shift: 20 }));
	assertF03(shifted);
	assert.throws(() => assertF03Export(compareF03Export(expected, shifted)));
	assert.throws(() => assertF03(inspectF03(raster({ shift: 45 }))));
});

test("F03 mask oracle tolerates independent H.264 YUV420P encode/decode", () => {
	const encoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			"320x180",
			"-r",
			"30",
			"-i",
			"pipe:0",
			"-frames:v",
			"1",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-f",
			"h264",
			"pipe:1",
		],
		{ input: raster(), windowsHide: true },
	);
	const decoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-f",
			"h264",
			"-i",
			"pipe:0",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		],
		{ input: encoded, windowsHide: true, maxBuffer: 1024 * 1024 },
	);
	assertF03Export(compareF03Export(expected, inspectF03(decoded)));
});
