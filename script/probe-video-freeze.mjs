import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { expect } from "@playwright/test";

const run = (command, args) =>
	execFileSync(command, args, { windowsHide: true });
const seek = async (page, seconds) => {
	await page.getByLabel("Edit playhead time", { exact: true }).click();
	await page
		.getByLabel("Playhead time", { exact: true })
		.fill("00:00:0" + seconds + ":00");
	await page.getByLabel("Playhead time", { exact: true }).press("Enter");
};
const readClips = (page) =>
	page.evaluate(async () => {
		const { record } = await (
			await fetch(new URL("api/record", location.href))
		).json();
		const tracks = record.data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
			(track) => track.elements,
		);
	});
async function previewColor(page, expected) {
	let fraction = 0;
	await expect
		.poll(
			async () => {
				const png = await page.locator("canvas").first().screenshot();
				fraction = await page.evaluate(
					async ({ bytes, channel }) => {
						const bitmap = await createImageBitmap(
							new Blob([new Uint8Array(bytes)], { type: "image/png" }),
						);
						const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
						const context = canvas.getContext("2d");
						context.drawImage(bitmap, 0, 0);
						const { data } = context.getImageData(
							0,
							0,
							bitmap.width,
							bitmap.height,
						);
						let matches = 0;
						for (let i = 0; i < data.length; i += 4) {
							if (
								data[i + channel] > 150 &&
								data[i + ((channel + 1) % 3)] < 100 &&
								data[i + ((channel + 2) % 3)] < 100
							)
								matches++;
						}
						bitmap.close();
						return matches / (data.length / 4);
					},
					{ bytes: Array.from(png), channel: expected },
				);
				return fraction;
			},
			{
				timeout: 15000,
				message: "Preview must resolve the expected source frame",
			},
		)
		.toBeGreaterThan(0.7);
	return fraction;
}
async function exportClip(page, project, frozen) {
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
	const fractions = [];
	for (const [time, channel] of [
		[1, frozen ? 1 : 0],
		[5, frozen ? 1 : 2],
	]) {
		const pixels = run("ffmpeg", [
			"-v",
			"error",
			"-ss",
			String(time),
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
		let matches = 0;
		for (let i = 0; i < pixels.length; i += 3)
			if (
				pixels[i + channel] > 150 &&
				pixels[i + ((channel + 1) % 3)] < 100 &&
				pixels[i + ((channel + 2) % 3)] < 100
			)
				matches++;
		const fraction = matches / (pixels.length / 3);
		assert(
			fraction > 0.9,
			"Decoded MP4 must contain the expected source frame",
		);
		fractions.push(fraction);
	}
	let rms = 0;
	if (metadata.streams.some((stream) => stream.codec_type === "audio")) {
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
		let energy = 0;
		for (let i = 0; i < pcm.length; i += 4) energy += pcm.readFloatLE(i) ** 2;
		rms = Math.sqrt(energy / (pcm.length / 4));
	}
	assert(
		frozen ? rms < 0.001 : rms > 0.01,
		"Frame hold must pause source audio and unfreeze must restore it",
	);
	return { fractions, rms, duration: metadata.format.duration };
}

export async function probeVideoFreeze({
	page,
	project,
	work,
	evidence,
	onPhase,
}) {
	onPhase("freeze frame media fixture");
	const source = join(work, "fixture-freeze.mp4");
	run("ffmpeg", [
		"-v",
		"error",
		"-n",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=640x360:r=30:d=6",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=660:duration=6",
		"-vf",
		"drawbox=c=lime:t=fill:enable='gte(t,2)',drawbox=c=blue:t=fill:enable='gte(t,4)'",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		source,
	]);
	await page.getByLabel("Media", { exact: true }).click();
	await page.locator('input[type="file"]').setInputFiles(source);
	const list = page.getByLabel("Switch to list view", { exact: true });
	if (await list.count()) await list.click();
	await page
		.getByLabel("Add fixture-freeze.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await readClips(page)).length).toBe(1);
	const original = (await readClips(page))[0];
	await seek(page, 6);
	await expect(page.getByLabel("Freeze frame", { exact: true })).toBeDisabled();
	await seek(page, 1);
	await previewColor(page, 0);
	await seek(page, 5);
	await previewColor(page, 2);
	evidence.checks.push({
		name: "moving video preview resolves red/blue frames and rejects exclusive clip end",
		pass: true,
	});
	onPhase("freeze frame UI transaction");
	await seek(page, 3);
	await page.getByLabel("Freeze frame", { exact: true }).click();
	await expect
		.poll(async () => (await readClips(page))[0].freezeFrame)
		.toBe(360000);
	const held = (await readClips(page))[0];
	assert.deepEqual(held, { ...original, freezeFrame: 360000 });
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await readClips(page))[0].freezeFrame)
		.toBeUndefined();
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await readClips(page))[0].freezeFrame)
		.toBe(360000);
	for (const time of [1, 5]) {
		await seek(page, time);
		await previewColor(page, 1);
	}
	evidence.checks.push({
		name: "freeze frame holds green at two timeline times; one-step undo/redo; geometry unchanged",
		pass: true,
	});
	await page.reload();
	// Timeline media clips expose their visible filename (unlike generated text clips).
	await page.getByText("fixture-freeze.mp4", { exact: true }).last().click();
	await expect(
		page.getByLabel("Unfreeze frame", { exact: true }),
	).toBeEnabled();
	await seek(page, 1);
	await previewColor(page, 1);
	evidence.checks.push({
		name: "freeze frame survives real iframe reload and still renders the held frame",
		pass: true,
	});
	onPhase("frozen frame decoded export");
	evidence.checks.push({
		name: "frozen MP4 holds green and suppresses source audio",
		...(await exportClip(page, project, true)),
		pass: true,
	});
	await seek(page, 7);
	await page.getByLabel("Unfreeze frame", { exact: true }).click();
	await expect
		.poll(async () => (await readClips(page))[0].freezeFrame)
		.toBeUndefined();
	assert.deepEqual((await readClips(page))[0], original);
	await seek(page, 1);
	await previewColor(page, 0);
	await seek(page, 5);
	await previewColor(page, 2);
	onPhase("unfrozen decoded export");
	evidence.checks.push({
		name: "unfreeze outside clip restores changing MP4 frames and audible source audio",
		...(await exportClip(page, project, false)),
		pass: true,
	});
}
