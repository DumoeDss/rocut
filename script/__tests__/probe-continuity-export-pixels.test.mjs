import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
	inspectContinuityExportPixels,
	compareContinuityExport,
	assertContinuityExport,
} from "../probe-continuity-export-pixels.mjs";

function fixture({
	shift = 0,
	color = [0, 255, 255],
	empty = false,
	solid = false,
} = {}) {
	const pixels = new Uint8Array(320 * 180 * 4);
	for (let y = 0; y < 180; y++)
		for (let x = 0; x < 320; x++) {
			let rgb = [255, 0, 0];
			const xx = x - shift;
			if (!empty && xx >= 60 && xx < 180 && y >= 40 && y < 140) {
				if (solid) rgb = color;
				else if (xx < 70 || xx >= 170 || (y >= 85 && y < 95)) rgb = color;
				else if (xx < 76 || xx >= 164) rgb = [112, 185, 166];
				else if (xx < 86 || xx >= 154) rgb = [25, 25, 25];
			}
			pixels.set([...rgb, 255], (y * 320 + x) * 4);
		}
	return pixels;
}
const inspect = inspectContinuityExportPixels;
const scores = (left, right) =>
	compareContinuityExport({ expected: inspect(left), actual: inspect(right) });

test("styled cyan/dark ink survives independent chroma subsampling with fixed geometry and color gates", () => {
	const reference = fixture();
	const decoded = execFileSync(
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
			"scale=1920:1080,format=yuv420p,scale=320:180,format=rgba",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		],
		{ input: reference, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
	);
	assertContinuityExport(scores(reference, decoded));
});

test("blank, shifted/wrong-phase, filled bounding box and unrelated colors cannot pass", () => {
	const reference = fixture();
	for (const wrong of [
		fixture({ empty: true }),
		fixture({ shift: 80 }),
		fixture({ solid: true }),
		fixture({ color: [255, 0, 255] }),
	]) {
		assert.throws(() => assertContinuityExport(scores(reference, wrong)));
	}
	assert.throws(() =>
		assertContinuityExport(
			scores(fixture({ empty: true }), fixture({ empty: true })),
		),
	);
});

test("an independent H.264 round trip preserves styled foreground geometry and color", () => {
	const reference = fixture();
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
			"scale=1920:1080",
			"-frames:v",
			"1",
			"-c:v",
			"libx264",
			"-crf",
			"20",
			"-pix_fmt",
			"yuv420p",
			"-f",
			"h264",
			"pipe:1",
		],
		{ input: reference, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
	);
	const decoded = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			"pipe:0",
			"-vf",
			"scale=320:180",
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"pipe:1",
		],
		{ input: encoded, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
	);
	assertContinuityExport(scores(reference, decoded));
});

test("same silhouette with color loss is rejected even over a large unchanged red background", () => {
	const reference = fixture(),
		grayscale = fixture({ color: [128, 128, 128] });
	const result = scores(reference, grayscale);
	assert.equal(result.overlap, 1);
	assert(result.meanColorError > 0.1);
	assert.throws(() => assertContinuityExport(result), /color mismatch/);
});

test("unaltered snapshots pass without mutation and malformed buffers are refused", () => {
	const reference = fixture(),
		before = reference.slice();
	assertContinuityExport(scores(reference, reference));
	assert.deepEqual(reference, before);
	assert.throws(() => inspect(new Uint8Array(4)));
});
