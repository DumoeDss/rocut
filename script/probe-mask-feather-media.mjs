import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function featherSamples({
	pixels,
	channels,
	shape,
	rotation,
	inverted,
}) {
	assert.equal(pixels.length, 160 * 90 * channels);
	const positions =
		shape === "Split"
			? [0.18, 0.35, 0.42, 0.48, 0.52, 0.58, 0.65, 0.82]
			: [0.16, 0.205, 0.235, 0.265, 0.295, 0.35];
	const samples = positions.map((position) => {
		const x = rotation === 90 ? 80 : Math.floor(position * 160);
		const y = rotation === 90 ? Math.floor(position * 90) : 45;
		const i = (y * 160 + x) * channels;
		const red = pixels[i];
		assert(
			pixels[i + 1] < 30 && pixels[i + 2] < 30,
			"feather must not add other colors",
		);
		if (shape === "Split") {
			const distance =
				rotation === 90
					? ((y + 0.5) / 90 - 0.5) * 1080
					: ((x + 0.5) / 160 - 0.5) * 1920;
			const alpha = Math.min(1, Math.max(0, 0.5 + distance / 400));
			const expected = (inverted ? 1 - alpha : alpha) * 253;
			assert(
				Math.abs(red - expected) < 22,
				"split feather " + position + " expected " + expected + " got " + red,
			);
		}
		return { x, y, red };
	});
	const values = samples.map((s) => (inverted ? 253 - s.red : s.red));
	assert(
		values[0] < 20 && values.at(-1) > 230,
		"feather must span hidden and fully exposed regions",
	);
	assert(
		values.filter((v) => v > 25 && v < 225).length >= 2,
		"feather must include multiple intermediate alpha values",
	);
	for (let i = 1; i < values.length; i++)
		assert(
			values[i] >= values[i - 1] - 5,
			"feather gradient must be monotonic",
		);
	return samples;
}

export function checkFeatherExport({
	file,
	shape,
	rotation,
	inverted,
	preview,
}) {
	return [0.1, 0.5, 0.9].map((time) => {
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(time),
				"-i",
				file,
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
		const samples = featherSamples({
			pixels,
			channels: 3,
			shape,
			rotation,
			inverted,
		});
		samples.forEach((sample, index) =>
			assert(
				Math.abs(sample.red - preview[index].red) < 18,
				"feather preview/export mismatch at " + index,
			),
		);
		return { time, samples };
	});
}
