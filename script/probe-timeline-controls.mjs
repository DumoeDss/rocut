import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	attachAudioOutputObserver,
	observeAudioPlayback,
	inspectAudioExport,
} from "./probe-audio-format-output.mjs";
import { probeTimelineTrims } from "./probe-timeline-trims.mjs";

export async function probeTimelineControls({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	const readClips = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			const tracks = record.data.scenes[0].tracks;
			return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
				(track) => track.elements,
			);
		});
	const select = (id) =>
		page
			.locator('[data-testid="timeline-clip"][data-element-id="' + id + '"]')
			.click();
	const seek = async (seconds) => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page
			.getByLabel("Playhead time", { exact: true })
			.fill("00:00:0" + seconds + ":00");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	};
	const check = (name, detail = {}) =>
		evidence.checks.push({ name, ...detail, pass: true });
	onPhase("timeline controls real audiovisual fixtures");
	const audible = join(work, "timeline-tone.mp4"),
		silent = join(work, "timeline-silent.mp4");
	for (const [path, audio] of [
		[audible, true],
		[silent, false],
	]) {
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=640x360:r=30:d=4",
				...(audio
					? ["-f", "lavfi", "-i", "sine=frequency=880:duration=4"]
					: []),
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				...(audio ? ["-c:a", "aac", "-shortest"] : ["-an"]),
				path,
			],
			{ windowsHide: true },
		);
	}
	await page.getByLabel("Media", { exact: true }).click();
	const chooser = hostPage.waitForEvent("filechooser");
	await page.getByLabel("Import media", { exact: true }).click();
	await (await chooser).setFiles([audible, silent]);
	await expect(
		page.getByLabel("Add timeline-silent.mp4 to timeline", { exact: true }),
	).toBeVisible({ timeout: 30000 });
	await page
		.getByLabel("Add timeline-silent.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await readClips()).length).toBe(1);
	await select((await readClips())[0].id);
	await expect(
		page.getByLabel("Extract audio", { exact: true }),
	).toBeDisabled();
	await page.getByLabel("Delete element", { exact: true }).click();
	await expect.poll(async () => (await readClips()).length).toBe(0);
	check("video without an audio stream disables extraction");
	await seek(0);
	await page.getByLabel("Media", { exact: true }).click();
	await page
		.getByLabel("Add timeline-tone.mp4 to timeline", { exact: true })
		.click();
	await expect.poll(async () => (await readClips()).length).toBe(1);
	const initial = (await readClips())[0];
	await select(initial.id);
	await page.getByLabel("Audio", { exact: true }).click();
	await page.getByLabel("Volume", { exact: true }).fill("-6");
	await page.getByLabel("Volume", { exact: true }).press("Enter");
	await expect.poll(async () => (await readClips())[0].params.volume).toBe(-6);
	const original = (await readClips())[0];
	const baseline = await inspectAudioExport(page, project);
	await attachAudioOutputObserver(page);
	const previewBaseline = await observeAudioPlayback(page);
	await seek(0);
	onPhase("extract source audio UI and independent decoded output");
	await page.getByLabel("Extract audio", { exact: true }).click();
	await expect.poll(async () => (await readClips()).length).toBe(2);
	const separated = await readClips(),
		video = separated.find((c) => c.type === "video"),
		audio = separated.find((c) => c.type === "audio");
	assert.deepEqual(video, { ...original, isSourceAudioEnabled: false });
	for (const field of [
		"mediaId",
		"duration",
		"startTime",
		"trimStart",
		"trimEnd",
		"sourceDuration",
	])
		assert.equal(
			audio[field],
			original[field],
			"Extracted audio must preserve " + field,
		);
	assert.equal(audio.params.volume, -6);
	assert.equal(audio.params.muted, original.params.muted === true);
	assert.equal(audio.sourceType, "upload");
	const extracted = await inspectAudioExport(page, project);
	assert(
		extracted.rms / baseline.rms > 0.95 && extracted.rms / baseline.rms < 1.05,
		"Extraction must not double or lose audio",
	);
	await attachAudioOutputObserver(page);
	const playback = await observeAudioPlayback(page);
	assert(
		playback.tailRms / previewBaseline.tailRms > 0.9 &&
			playback.tailRms / previewBaseline.tailRms < 1.1,
		"Extracted preview must preserve the baseline gain, not double source audio",
	);
	check(
		"extraction preserves source geometry/gain and does not double preview/export audio",
		{ previewBaseline, playback, baseline, extracted },
	);
	await select(video.id);
	await page.keyboard.press("Control+z");
	await expect.poll(readClips).toEqual([original]);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(readClips).toEqual(separated);
	await page.reload();
	assert.deepEqual(await readClips(), separated);
	await select(video.id);
	await expect(page.getByLabel("Recover audio", { exact: true })).toBeEnabled();
	check(
		"audio separation is one durable undo/redo step and survives reopening",
	);
	onPhase("delete extracted audio then recover source audio");
	await select(audio.id);
	await page.getByLabel("Delete element", { exact: true }).click();
	await expect.poll(async () => (await readClips()).length).toBe(1);
	assert.equal((await readClips())[0].isSourceAudioEnabled, false);
	const muted = await inspectAudioExport(page, project, { silent: true });
	await select(video.id);
	await page.getByLabel("Recover audio", { exact: true }).click();
	await expect
		.poll(async () => (await readClips())[0].isSourceAudioEnabled)
		.toBe(true);
	const recovered = await inspectAudioExport(page, project);
	assert(
		recovered.rms / baseline.rms > 0.95 && recovered.rms / baseline.rms < 1.05,
	);
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await readClips())[0].isSourceAudioEnabled)
		.toBe(false);
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await readClips())[0].isSourceAudioEnabled)
		.toBe(true);
	await page.reload();
	assert.equal((await readClips())[0].isSourceAudioEnabled, true);
	check(
		"deleting extracted audio stays silent; Recover restores source sound and persists",
		{ muted, recovered },
	);
	await probeTimelineTrims({ page, readClips, select, seek, check, onPhase });
}
