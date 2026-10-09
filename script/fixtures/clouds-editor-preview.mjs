import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function fullCanvasFilter(bounds, pngWidth, pngHeight) {
	assert(
		bounds &&
			["x", "y", "width", "height"].every((key) =>
				Number.isInteger(bounds[key]),
			),
	);
	assert(
		bounds.width >= 630 &&
			bounds.width <= 640 &&
			bounds.height >= 350 &&
			bounds.height <= 360,
	);
	assert.equal(
		pngWidth,
		bounds.width,
		"Screenshot must contain exactly the complete integer canvas",
	);
	assert.equal(
		pngHeight,
		bounds.height,
		"Screenshot must contain exactly the complete integer canvas",
	);
	return "scale=640:360:flags=bicubic";
}

export async function normalizeCloudsPreview(file, bounds, directory, output) {
	const png = await readFile(file);
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const filter = fullCanvasFilter(
		bounds,
		png.readUInt32BE(16),
		png.readUInt32BE(20),
	);
	const run = (args) =>
		execFileSync(join(directory, "ffmpeg.exe"), args, {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 2 * 1024 * 1024,
		});
	run([
		"-v",
		"error",
		"-n",
		"-i",
		file,
		"-vf",
		filter,
		"-frames:v",
		"1",
		output,
	]);
	const rgba = run([
		"-v",
		"error",
		"-i",
		output,
		"-frames:v",
		"1",
		"-pix_fmt",
		"rgba",
		"-f",
		"rawvideo",
		"pipe:1",
	]);
	assert.equal(rgba.length, 640 * 360 * 4);
	return { rgba, filter };
}
