import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

// Decode independently: source is two seconds of red, then two seconds of blue,
// with a continuous 440 Hz tone. A 2x clip must switch color at one second.
export async function inspectVideoPropertyExport({
	page,
	project,
	frequency,
	visibleArea = 1,
	markerCenter = [0.125, 0.125],
}) {
	const request = (path, body) =>
		page.evaluate(
			async ({ path, body }) => {
				const response = await fetch(new URL(path, location.href), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					...(body ? { body: JSON.stringify(body) } : {}),
				});
				return { status: response.status, body: await response.json() };
			},
			{ path, body },
		);
	const started = await request("api/export", {
		format: "mp4",
		quality: "high",
		includeAudio: true,
	});
	assert.equal(started.status, 202);
	const readJob = () =>
		page.evaluate(
			async (id) =>
				(await fetch(new URL("api/export/" + id, location.href))).json(),
			started.body.id,
		);
	let job;
	try {
		await expect
			.poll(
				async () => {
					job = await readJob();
					return ["completed", "failed", "cancelled"].includes(job.status);
				},
				{ timeout: 120000, intervals: [100, 250, 500] },
			)
			.toBe(true);
		assert.equal(job.status, "completed", job.error);
	} finally {
		if (!job || !["completed", "failed", "cancelled"].includes(job.status)) {
			await request("api/export/" + started.body.id + "/cancel");
			await expect
				.poll(
					async () =>
						["completed", "failed", "cancelled"].includes(
							(await readJob()).status,
						),
					{ timeout: 10000 },
				)
				.toBe(true);
		}
	}
	const output = await realpath(job.outputPath);
	const inside = relative(await realpath(join(project, "exports")), output);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
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
				output,
			],
			{ encoding: "utf8", windowsHide: true, timeout: 30000 },
		),
	);
	const video = metadata.streams.filter((s) => s.codec_type === "video"),
		audio = metadata.streams.filter((s) => s.codec_type === "audio");
	assert.equal(video.length, 1);
	assert.equal(audio.length, 1);
	assert.equal(video[0].nb_read_frames, "60");
	assert(Math.abs(Number(metadata.format.duration) - 2) < 1 / 30);
	const samples = [];
	for (const [seconds, color] of [
		[0.5, "red"],
		[1.5, "blue"],
	]) {
		const pixels = execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-ss",
				String(seconds),
				"-i",
				output,
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
			{ windowsHide: true, timeout: 30000 },
		);
		let matching = 0,
			white = 0,
			whiteX = 0,
			whiteY = 0;
		for (let i = 0; i < pixels.length; i += 3) {
			if (
				color === "red"
					? pixels[i] > 160 && pixels[i + 1] < 70 && pixels[i + 2] < 70
					: pixels[i + 2] > 160 && pixels[i] < 70 && pixels[i + 1] < 70
			)
				matching++;
			if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) {
				white++;
				const index = i / 3;
				whiteX += (index % 160) + 0.5;
				whiteY += Math.floor(index / 160) + 0.5;
			}
		}
		const fraction = matching / (pixels.length / 3);
		assert(
			Math.abs(fraction - (visibleArea * 15) / 16) < 0.025,
			"Unexpected " + color + " source timing or transform area: " + fraction,
		);
		assert(white > 10, "Asymmetric source marker must remain visible");
		const marker = [whiteX / white / 160, whiteY / white / 90];
		assert(
			Math.abs(marker[0] - markerCenter[0]) < 0.02 &&
				Math.abs(marker[1] - markerCenter[1]) < 0.02,
			"Wrong transform marker location: " + JSON.stringify(marker),
		);
		samples.push({ seconds, color, fraction, marker });
	}
	const pcm = execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-ss",
			"0.25",
			"-i",
			output,
			"-t",
			"1.5",
			"-vn",
			"-ac",
			"1",
			"-ar",
			"8000",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ windowsHide: true, timeout: 30000 },
	);
	let energy = 0,
		crossings = 0,
		previous = 0;
	for (let i = 0; i < pcm.length; i += 4) {
		const value = pcm.readFloatLE(i);
		energy += value * value;
		if (previous <= 0 && value > 0) crossings++;
		previous = value;
	}
	const rms = Math.sqrt(energy / (pcm.length / 4)),
		actualFrequency = crossings / (pcm.length / 4 / 8000);
	assert(rms > 0.01, "Exported audio must be audible");
	assert(
		Math.abs(actualFrequency - frequency) < 15,
		"Unexpected exported pitch: " + actualFrequency,
	);
	return {
		frames: 60,
		duration: metadata.format.duration,
		samples,
		rms,
		frequency: actualFrequency,
	};
}
