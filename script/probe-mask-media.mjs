import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

function redFraction(pixels, channels) {
	let red = 0;
	for (let i = 0; i < pixels.length; i += channels)
		if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
	return red / (pixels.length / channels);
}

export async function verifyMaskPreview(page, expectedFraction) {
	let fraction;
	await expect
		.poll(
			async () => {
				const png = await page.locator("canvas").first().screenshot();
				const pixels = await page.evaluate(async (bytes) => {
					const image = await createImageBitmap(
						new Blob([new Uint8Array(bytes)], { type: "image/png" }),
					);
					try {
						const canvas = new OffscreenCanvas(160, 90);
						const context = canvas.getContext("2d");
						context.drawImage(image, 0, 0, 160, 90);
						return Array.from(context.getImageData(0, 0, 160, 90).data);
					} finally {
						image.close();
					}
				}, Array.from(png));
				fraction = redFraction(pixels, 4);
				return Math.abs(fraction - expectedFraction) < 0.04;
			},
			{
				timeout: 15000,
				message: "preview must reflect the authored mask area",
			},
		)
		.toBe(true);
	return fraction;
}

export function verifyMaskExport(output, expectedFraction) {
	const metadata = JSON.parse(
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
	assert(output.suggestedFilename.endsWith(".mp4"));
	assert.equal(metadata.streams.length, 1);
	const video = metadata.streams[0];
	assert.equal(video.codec_name, "h264");
	assert.equal(video.width, 1920);
	assert.equal(video.height, 1080);
	assert.equal(Number(video.nb_read_frames), 30);
	assert(Math.abs(Number(metadata.format.duration) - 1) < 0.05);
	const fractions = [];
	for (const time of [0.1, 0.5, 0.9]) {
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(time),
				"-i",
				output.path,
				"-frames:v",
				"1",
				"-vf",
				"scale=160:90",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			],
			{ windowsHide: true },
		);
		assert.equal(pixels.length, 160 * 90 * 3);
		const fraction = redFraction(pixels, 3);
		assert(
			Math.abs(fraction - expectedFraction) < 0.04,
			"decoded mask must retain the expected reveal area",
		);
		fractions.push({ time, fraction });
	}
	return { file: output.path, fractions, frames: 30 };
}
