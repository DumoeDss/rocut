import { expect, test } from "bun:test";
import {
	comparePresetFrame,
	presetPixelSamples,
	verifyPresetRgbStream,
} from "../remotion-presets-verification.mjs";

test("every frame uses the same original sample positions and transparent black composition", () => {
	const rgba = Buffer.alloc(36 * 4);
	for (let i = 0; i < 36; i++) rgba.set([100, 80, 40, 255], i * 4);
	rgba.set([255, 100, 200, 0], 17 * 4);
	const samples = presetPixelSamples(rgba);
	expect([...samples]).toEqual([
		100, 80, 40, 255, 255, 100, 200, 0, 100, 80, 40, 255,
	]);
	const rgb = Buffer.alloc(36 * 3);
	for (let i = 0; i < 36; i++) rgb.set([100, 80, 40], i * 3);
	rgb.fill(0, 17 * 3, 18 * 3);
	expect(comparePresetFrame(rgb, samples)).toEqual({
		difference: 0,
		count: 9,
		opaque: 2,
		nonblack: 6,
		meanAbsoluteError: 0,
	});
	expect(
		comparePresetFrame(Buffer.alloc(rgb.length), samples).meanAbsoluteError,
	).toBeGreaterThan(8);
	expect(() => comparePresetFrame(rgb, samples.subarray(4))).toThrow(
		"geometry",
	);
	expect(() => presetPixelSamples(Buffer.alloc(5))).toThrow("RGBA");
});

test("stream verifier covers chunk boundaries and detects missing/extra/truncated/changed frames", async () => {
	const width = 50,
		height = 40;
	const rgba = Buffer.alloc(width * height * 4, 255);
	const samples = presetPixelSamples(rgba);
	const picture = Buffer.alloc(width * height * 3, 255);
	const movie = Buffer.concat([picture, picture]);
	const requests = [];
	const options = {
		width,
		height,
		firstFrame: 7,
		frameCount: 2,
		readSamples: async (index) => {
			requests.push(index);
			return samples;
		},
	};
	async function* chunks(buffer) {
		for (let offset = 0; offset < buffer.length; offset += 997)
			yield buffer.subarray(offset, offset + 997);
	}
	expect(await verifyPresetRgbStream(chunks(movie), options)).toEqual({
		decodedFrames: 2,
		meanAbsoluteError: 0,
		worstFrameError: 0,
	});
	expect(requests).toEqual([7, 8]);
	await expect(verifyPresetRgbStream(chunks(picture), options)).rejects.toThrow(
		"missing frames",
	);
	await expect(
		verifyPresetRgbStream(chunks(Buffer.concat([movie, picture])), options),
	).rejects.toThrow("extra frames");
	await expect(
		verifyPresetRgbStream(chunks(movie.subarray(0, movie.length - 1)), options),
	).rejects.toThrow("Truncated RGB frame");
	await expect(
		verifyPresetRgbStream(
			chunks(Buffer.concat([picture, Buffer.alloc(picture.length)])),
			options,
		),
	).rejects.toThrow("Frame 8: exported picture mismatch");
	await expect(
		verifyPresetRgbStream(chunks(movie), { ...options, frameCount: 0 }),
	).rejects.toThrow();
});
