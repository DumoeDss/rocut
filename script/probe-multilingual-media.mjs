import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export function inspectLanguagePixels(pixels, channels = 4) {
	assert.equal(pixels.length, 320 * 180 * channels);
	const cyan = [],
		magenta = [];
	for (let y = 2; y < 178; y++) {
		for (let x = 2; x < 318; x++) {
			const i = (y * 320 + x) * channels;
			const [r, g, b] = pixels.slice(i, i + 3);
			if (r < 70 && g > 180 && b > 180) cyan.push(y * 320 + x);
			if (r > 180 && g < 70 && b > 180) magenta.push(y * 320 + x);
		}
	}
	return {
		hash: createHash("sha256").update(Buffer.from(pixels)).digest("hex"),
		cyan,
		magenta,
	};
}

export async function mainPreviewCanvas(page) {
	// Preset cards also render canvases. Anchor to the actual preview region.
	const canvas = page
		.getByRole("application", { name: "Preview canvas", exact: true })
		.locator("..")
		.locator("..")
		.locator("canvas");
	assert.equal(
		await canvas.count(),
		1,
		"one main compositor canvas is required",
	);
	return canvas;
}

export async function languagePreview(page) {
	const png = await (await mainPreviewCanvas(page)).screenshot();
	return samplePreviewPng(page, png);
}

export async function samplePreviewPng(
	page,
	png,
	inspect = inspectLanguagePixels,
) {
	const pixels = await page.evaluate(async (bytes) => {
		const image = await createImageBitmap(
			new Blob([new Uint8Array(bytes)], { type: "image/png" }),
		);
		try {
			const canvas = new OffscreenCanvas(320, 180),
				ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0, 320, 180);
			return Array.from(ctx.getImageData(0, 0, 320, 180).data);
		} finally {
			image.close();
		}
	}, Array.from(png));
	return inspect(pixels);
}

export function assertBothLanguages(sample) {
	assert(sample.cyan.length > 25, "Chinese cyan glyphs must be visible");
	assert(sample.magenta.length > 25, "English magenta glyphs must be visible");
	assert(
		sample.cyan.every((index) => index % 320 < 160),
		"Chinese layer must stay in left half",
	);
	assert(
		sample.magenta.every((index) => index % 320 > 160),
		"English layer must stay in right half",
	);
}

export function languageOverlap({ expected, actual }) {
	const matches = expected.filter((index) => actual.includes(index)).length;
	return matches / Math.max(1, new Set([...expected, ...actual]).size);
}

export function verifyLanguageExport({ output, baselines, durationTicks }) {
	const meta = JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				output.path,
			],
			{ windowsHide: true, encoding: "utf8" },
		),
	);
	assert.equal(meta.streams.length, 1);
	const video = meta.streams[0];
	assert.equal(video.codec_name, "h264");
	assert.equal(video.width, 1920);
	assert.equal(video.height, 1080);
	assert.equal(Number(video.nb_read_frames), Math.floor(durationTicks / 4000));
	assert(
		Math.abs(Number(meta.format.duration) - durationTicks / 120000) < 0.05,
	);
	assert(output.suggestedFilename.endsWith(".mp4"));
	const samples = [];
	for (const [frame, baseline] of baselines) {
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(frame / 30),
				"-i",
				output.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=320:180",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true },
		);
		const sample = inspectLanguagePixels(pixels, 3);
		assertBothLanguages(sample);
		const cyan = languageOverlap({
			expected: baseline.cyan,
			actual: sample.cyan,
		});
		const magenta = languageOverlap({
			expected: baseline.magenta,
			actual: sample.magenta,
		});
		assert(
			cyan > 0.7 && magenta > 0.7,
			"each decoded language must match its own preview at frame " +
				frame +
				": " +
				[cyan, magenta],
		);
		samples.push({ frame, cyan, magenta });
	}
	return { file: output.path, frames: Number(video.nb_read_frames), samples };
}
