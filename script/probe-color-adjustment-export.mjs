import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, relative, isAbsolute } from "node:path";
import { expect } from "@playwright/test";
const run = (command, args) =>
	execFileSync(command, args, { windowsHide: true });
const mono = (rgba) =>
	Math.max(...rgba.slice(0, 3)) - Math.min(...rgba.slice(0, 3)) < 4;
const original = (rgba) =>
	rgba[0] > 110 &&
	rgba[0] < 145 &&
	rgba[1] > 50 &&
	rgba[1] < 80 &&
	rgba[2] < 50;

export async function verifyAdjustmentExport(page, project) {
	await expect
		.poll(() =>
			page.evaluate(
				async () =>
					(await (await fetch(new URL("api/export", location.href))).json())
						.surfaces,
			),
		)
		.toBe(1);
	const started = await page.evaluate(async () => {
		const response = await fetch(new URL("api/export", location.href), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				format: "mp4",
				quality: "low",
				includeAudio: true,
				range: { startTime: 0, endTime: 720000 },
			}),
		});
		return { status: response.status, job: await response.json() };
	});
	assert.equal(started.status, 202);
	let job;
	await expect
		.poll(
			async () => {
				job = await page.evaluate(
					async (id) =>
						(await fetch(new URL("api/export/" + id, location.href))).json(),
					started.job.id,
				);
				return ["completed", "failed", "cancelled"].includes(job.status);
			},
			{ timeout: 120000, intervals: [250, 500, 1000] },
		)
		.toBe(true);
	assert.equal(job.status, "completed", job.error);
	const output = relative(join(project, "exports"), job.outputPath);
	assert(output && !output.startsWith("..") && !isAbsolute(output));
	const metadata = JSON.parse(
		run("ffprobe", [
			"-v",
			"error",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			job.outputPath,
		]).toString("utf8"),
	);
	assert(Math.abs(Number(metadata.format.duration) - 6) < 0.15);
	const samples = [];
	for (const second of [1, 5]) {
		const pixels = run("ffmpeg", [
			"-v",
			"error",
			"-ss",
			String(second),
			"-i",
			job.outputPath,
			"-frames:v",
			"1",
			"-vf",
			"scale=160:90",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		]);
		const rgb = [
			...pixels.subarray((45 * 160 + 80) * 3, (45 * 160 + 80) * 3 + 3),
		];
		assert(
			second === 1 ? mono(rgb) : original(rgb),
			"Decoded export must be grayscale only inside the adjustment layer range: " +
				JSON.stringify(rgb),
		);
		samples.push(rgb);
	}
	assert(metadata.streams.some((stream) => stream.codec_type === "audio"));
	const pcm = run("ffmpeg", [
		"-v",
		"error",
		"-i",
		job.outputPath,
		"-vn",
		"-ac",
		"1",
		"-ar",
		"8000",
		"-f",
		"f32le",
		"pipe:1",
	]);
	let sum = 0;
	for (let i = 0; i < pcm.length; i += 4) sum += pcm.readFloatLE(i) ** 2;
	const rms = Math.sqrt(sum / (pcm.length / 4));
	assert(rms > 0.01, "Adjustment must not suppress audio");
	return { samples, rms, duration: metadata.format.duration };
}
