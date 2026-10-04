import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { inspectFullMotionExport } from "./probe-motion-full-export-media.mjs";

// Native host export API with the installed editor: not export-button acceptance.
export async function probeMotionFullExport({
	page,
	project,
	work,
	evidence,
	onPhase,
}) {
	const readData = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
	const original = await readData();
	assert.equal(original.motionTextSequences.length, 1);
	assert.equal(original.motionTextSequences[0].cues.length, 600);
	assert.equal(original.motionTextSequences[0].duration, 480 * 120000);
	assert.deepEqual(original.settings.canvasSize, { width: 1920, height: 1080 });
	const audioClips = (data) =>
		data.scenes[0].tracks.audio.flatMap((track) => track.elements);
	const audioName = "f05-full-tone.wav";
	const reusedAudio = audioClips(original).length === 1;
	assert(
		audioClips(original).length <= 1,
		"Unexpected audio in dedicated fixture",
	);
	if (reusedAudio) assert.equal(audioClips(original)[0].name, audioName);
	else {
		onPhase("F05 import and place eight-minute audio through actual media UI");
		const audioPath = join(work, audioName);
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:duration=480",
				"-ar",
				"48000",
				"-ac",
				"1",
				"-c:a",
				"pcm_s16le",
				audioPath,
			],
			{ windowsHide: true, timeout: 30000 },
		);
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await page.getByLabel("Media", { exact: true }).click();
		const list = page.getByLabel("Switch to list view", { exact: true });
		if (await list.count()) await list.click();
		const addAudio = page.getByLabel("Add " + audioName + " to timeline", {
			exact: true,
		});
		if (!(await addAudio.count()))
			await page
				.locator("input[type=file]")
				.setInputFiles(audioPath, { timeout: 90000 });
		await page
			.getByLabel("Add " + audioName + " to timeline", { exact: true })
			.click({ timeout: 90000 });
		await expect
			.poll(async () => audioClips(await readData()).length, { timeout: 15000 })
			.toBe(1);
	}
	const before = await readData();
	const clip = audioClips(before)[0];
	assert.equal(clip.startTime, 0);
	assert.equal(clip.duration, 480 * 120000);
	assert.deepEqual(before.motionTextSequences, original.motionTextSequences);
	evidence.checks.push({
		name: reusedAudio
			? "F05 reuses the exact owned full-duration audio clip without duplicate insertion"
			: "F05 real UI imports and places full-duration audio without modifying 600 cues",
		pass: true,
	});
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
	const get = (id) =>
		page.evaluate(
			async (id) =>
				(await fetch(new URL("api/export/" + id, location.href))).json(),
			id,
		);
	onPhase("F05 full eight-minute 1080p export with audio");
	const startedAt = performance.now();
	const started = await request("api/export", {
		format: "mp4",
		quality: "high",
		includeAudio: true,
	});
	assert.equal(started.status, 202);
	const id = started.body.id;
	const samples = [];
	let job,
		lastBucket = -1;
	try {
		await expect
			.poll(
				async () => {
					job = await get(id);
					const bucket = Math.floor((job.progress ?? 0) * 10);
					if (
						bucket !== lastBucket ||
						["completed", "failed", "cancelled"].includes(job.status)
					) {
						lastBucket = bucket;
						samples.push({
							status: job.status,
							progress: job.progress,
							elapsedMs: performance.now() - startedAt,
						});
						onPhase(
							"F05 full export " + job.status + " progress=" + job.progress,
						);
					}
					return ["completed", "failed", "cancelled"].includes(job.status);
				},
				{ timeout: 15 * 60 * 1000, intervals: [500, 1000, 2000] },
			)
			.toBe(true);
		assert.equal(job.status, "completed", job.error);
	} finally {
		evidence.f05FullExport = {
			jobId: id,
			samples,
			elapsedMs: performance.now() - startedAt,
			status: job?.status,
		};
		if (!job || !["completed", "failed", "cancelled"].includes(job.status)) {
			await request("api/export/" + id + "/cancel");
			await expect
				.poll(
					async () =>
						["completed", "failed", "cancelled"].includes(
							(await get(id)).status,
						),
					{ timeout: 15000 },
				)
				.toBe(true);
		}
	}
	onPhase(
		"F05 decode complete export, validate streams and first/middle/last content",
	);
	await inspectFullMotionExport({
		output: job.outputPath,
		project,
		work,
		sequence: before.motionTextSequences[0],
		evidence,
	});
	const after = await readData();
	assert.deepEqual(after.scenes, before.scenes);
	assert.deepEqual(after.motionTextSequences, before.motionTextSequences);
	evidence.checks.push({
		name: "F05 full export leaves the durable timeline unchanged",
		pass: true,
	});
}
