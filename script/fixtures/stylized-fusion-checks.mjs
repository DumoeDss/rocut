import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { compareFusionFrames } from "./stylized-fusion-visuals.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function request(page, route, body) {
	return page.evaluate(
		async ({ route, body }) => {
			const response = await fetch(
				`api/${route}`,
				body === undefined
					? { signal: AbortSignal.timeout(15000) }
					: {
							signal: AbortSignal.timeout(15000),
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(body),
						},
			);
			const value = await response.json();
			if (!response.ok)
				throw Error(`${route}: ${response.status} ${JSON.stringify(value)}`);
			return value;
		},
		{ route, body },
	);
}
export async function poll(check, timeout = 30000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await check();
		if (value) return value;
		await sleep(250);
	}
	throw Error("Fusion observation deadline exceeded");
}
export async function seek(page, seconds, frame = 0) {
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.click();
	const input = page.getByRole("textbox", {
		name: "Playhead time",
		exact: true,
	});
	await input.fill(
		`00:00:${String(seconds).padStart(2, "0")}:${String(frame).padStart(2, "0")}`,
	);
	await input.press("Enter");
}
export async function capture(page, artifacts, name, expectedSha256) {
	const canvas = page
		.locator('canvas[width="640"][height="360"]')
		.filter({ visible: true });
	// Wait for stable visible pixels, not an internal store or a mocked renderer.
	let previous,
		stable = 0,
		pixels;
	await poll(async () => {
		const count = await canvas.count();
		assert(count <= 1, "At most one visible native preview canvas");
		// A source edit can temporarily replace the canvas with the loading UI.
		// Presence and stable pixels share the existing bounded observation period.
		if (count === 0) {
			previous = undefined;
			stable = 0;
			return false;
		}
		pixels = await canvas.screenshot();
		const hash = createHash("sha256").update(pixels).digest("hex");
		stable = hash === previous ? stable + 1 : 0;
		previous = hash;
		return (
			stable >= 3 && (expectedSha256 === undefined || hash === expectedSha256)
		);
	});
	await writeFile(join(artifacts, `${name}.png`), pixels, { flag: "wx" });
	return {
		name,
		sha256: previous,
		bytes: pixels.length,
		bounds: await canvas.boundingBox(),
	};
}
export async function exportFusion(page, artifacts, evidence, agentRequest) {
	// Start inside Three, then cancel once a real HTML frame request has begun.
	const frameStarted = page.waitForRequest(
		(r) => new URL(r.url()).pathname.endsWith("/api/programmatic/frame"),
		{ timeout: 30000 },
	);
	const cancelled = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: true,
		range: { startTime: 840000, endTime: 1200000 },
	});
	await frameStarted;
	await agentRequest(`export/${cancelled.id}/cancel`, {});
	const terminal = async (id) =>
		poll(async () => {
			const job = await agentRequest(`export/${id}`);
			evidence.cancellation = job;
			return ["completed", "cancelled", "failed"].includes(job.status)
				? job
				: null;
		}, 30000);
	const cancelResult = await terminal(cancelled.id);
	assert.equal(cancelResult.status, "cancelled", cancelResult.error);
	assert.equal(cancelResult.outputPath, undefined);
	evidence.checks.push({
		name: "in-flight Three export cancellation without published output",
		pass: true,
	});
	console.log(JSON.stringify({ phase: "export-cancelled" }));
	const started = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: true,
	});
	let lastProgress = -1;
	const finished = await poll(async () => {
		const job = await agentRequest(`export/${started.id}`);
		const progress = Math.floor(job.progress * 20);
		if (progress !== lastProgress) {
			lastProgress = progress;
			console.log(
				JSON.stringify({
					phase: "export",
					progress: job.progress,
					status: job.status,
				}),
			);
		}
		return ["completed", "cancelled", "failed"].includes(job.status)
			? job
			: null;
	}, 600000);
	assert.equal(finished.status, "completed", finished.error);
	const inside = relative(
		join(artifacts, "project/exports"),
		finished.outputPath,
	);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
	evidence.export = finished;
	evidence.checks.push({
		name: "full mixed export after cancellation",
		pass: true,
	});
	return finished.outputPath;
}
export function decodeFusion(video, artifacts, ffmpegDirectory) {
	assert(isAbsolute(ffmpegDirectory), "Explicit ffmpeg directory required");
	const run = (binary, args, extra = {}) =>
		execFileSync(join(ffmpegDirectory, binary), args, {
			windowsHide: true,
			maxBuffer: 32 * 1024 * 1024,
			timeout: 60000,
			...extra,
		});
	const metadata = JSON.parse(
		run(
			"ffprobe.exe",
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_format",
				"-of",
				"json",
				video,
			],
			{ encoding: "utf8" },
		),
	);
	const picture = metadata.streams.filter((s) => s.codec_type === "video"),
		sound = metadata.streams.filter((s) => s.codec_type === "audio");
	assert.equal(picture.length, 1);
	assert.equal(sound.length, 1);
	assert.equal(picture[0].width, 640);
	assert.equal(picture[0].height, 360);
	assert.equal(Number(picture[0].nb_read_frames), 300);
	assert.equal(picture[0].r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - 10) < 0.12);
	assert.equal(sound[0].channels, 2);
	const pcm = run("ffmpeg.exe", [
		"-v",
		"error",
		"-i",
		video,
		"-vn",
		"-ar",
		"48000",
		"-ac",
		"2",
		"-f",
		"f32le",
		"pipe:1",
	]);
	const audio = [];
	for (let segment = 0; segment < 5; segment++)
		for (let channel = 0; channel < 2; channel++) {
			const start = segment * 2 * 48000 + 19200,
				count = 48000;
			let square = 0,
				real = 0,
				imaginary = 0,
				wrongReal = 0,
				wrongImaginary = 0;
			const frequency = 220 + segment * 110 + channel * 55,
				otherFrequency = 220 + segment * 110 + (1 - channel) * 55;
			for (let i = 0; i < count; i++) {
				const value = pcm.readFloatLE(((start + i) * 2 + channel) * 4);
				square += value * value;
				const angle = (2 * Math.PI * frequency * i) / 48000,
					otherAngle = (2 * Math.PI * otherFrequency * i) / 48000;
				real += value * Math.cos(angle);
				imaginary += value * Math.sin(angle);
				wrongReal += value * Math.cos(otherAngle);
				wrongImaginary += value * Math.sin(otherAngle);
			}
			const rms = Math.sqrt(square / count),
				amplitude = (2 * Math.hypot(real, imaginary)) / count;
			const leakage = (2 * Math.hypot(wrongReal, wrongImaginary)) / count;
			const expectedRms = (0.2 * 10 ** (-6 / 20)) / Math.SQRT2;
			assert(
				Math.abs(rms - expectedRms) < 0.01,
				`Stereo gain at segment ${segment}/${channel}: ${rms}`,
			);
			assert(
				amplitude > 0.08 && leakage < 0.01,
				`Tone/channel identity ${segment}/${channel}`,
			);
			audio.push({ segment, channel, frequency, rms, amplitude, leakage });
		}
	run("ffmpeg.exe", [
		"-v",
		"error",
		"-n",
		"-i",
		video,
		"-vf",
		"select='eq(n,30)+eq(n,90)+eq(n,150)+eq(n,195)+eq(n,200)+eq(n,255)',scale=320:180,tile=3x2",
		"-frames:v",
		"1",
		join(artifacts, "contact-sheet.png"),
	]);
	return { metadata, audio, video: compareFusionFrames(run, video, artifacts) };
}
