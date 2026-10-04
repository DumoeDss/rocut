import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { probePreviewSeek } from "./probe-preview-seek.mjs";

export async function probeMotionDuration({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
	measureSeek = false,
	fixture = "F04",
}) {
	assert(["F04", "F05"].includes(fixture));
	assert(
		!measureSeek || fixture === "F04",
		"F04 seek measurement requires its own fixture",
	);
	const cueCount = fixture === "F05" ? 600 : 120;
	const durationSeconds = fixture === "F05" ? 480 : 180;
	const cueStepCentiseconds = fixture === "F05" ? 80 : 150;
	const readData = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record.data,
		);
	const check = (name, detail = {}) =>
		evidence.checks.push({ name, ...detail, pass: true });
	onPhase("long lyrics duration validation");
	await page.getByLabel("Motion text", { exact: true }).click();
	await page
		.getByRole("combobox", { name: "Lyrics format", exact: true })
		.click();
	await page
		.getByRole("option", { name: "LRC timestamps", exact: true })
		.click();
	const source = Array.from({ length: cueCount }, (_, index) => {
		const centiseconds = index * cueStepCentiseconds;
		return (
			"[" +
			String(Math.floor(centiseconds / 6000)).padStart(2, "0") +
			":" +
			String(Math.floor(centiseconds / 100) % 60).padStart(2, "0") +
			"." +
			String(centiseconds % 100).padStart(2, "0") +
			"]第" +
			String(index + 1).padStart(3, "0") +
			"句 让节奏被看见"
		);
	}).join("\n");
	await page.locator("#motion-text-source").fill(source);
	const add = page.getByTestId("motion-text-add");
	await add.click();
	await expect(page.locator("#motion-text-message")).toBeVisible();
	assert.equal((await readData()).motionTextSequences?.length ?? 0, 0);
	check("long LRC is not silently truncated to the default 15 seconds");
	const duration = page.getByRole("spinbutton", {
		name: "Duration (seconds)",
		exact: true,
	});
	await expect(duration).toHaveValue("15");
	for (const value of ["", "0", "-1", "0.001"]) {
		await duration.fill(value);
		await add.click();
		await expect(page.locator("#motion-text-message")).toHaveText(
			/duration|Duration/,
		);
		await expect(page.locator("#motion-text-message")).toBeInViewport();
		await expect(duration).toHaveAttribute("aria-invalid", "true");
		await expect(page.locator("#motion-text-source")).not.toHaveAttribute(
			"aria-invalid",
			"true",
		);
		assert.equal((await readData()).motionTextSequences?.length ?? 0, 0);
	}
	check(
		"empty, nonpositive and sub-frame durations produce no project changes",
	);
	await duration.fill(String(durationSeconds));
	await expect(page.locator("#motion-text-message")).toHaveCount(0);
	await page.screenshot({ path: join(work, "long-lyrics-input.png") });
	await add.click();
	await expect
		.poll(async () => (await readData()).motionTextSequences?.length, {
			timeout: 20000,
		})
		.toBe(1);
	const created = await readData();
	const sequence = created.motionTextSequences[0];
	assert.equal(sequence.duration, durationSeconds * 120000);
	assert.equal(sequence.cues.length, cueCount);
	assert.deepEqual(
		sequence.cues.map((cue) => cue.startTime),
		Array.from({ length: cueCount }, (_, i) => i * cueStepCentiseconds * 1200),
	);
	const clips = [
		created.scenes[0].tracks.main,
		...created.scenes[0].tracks.overlay,
		...created.scenes[0].tracks.audio,
	].flatMap((track) => track.elements);
	assert.equal(clips.filter((c) => c.type === "motion-text").length, 1);
	assert.equal(
		clips.find((c) => c.type === "motion-text").duration,
		sequence.duration,
	);
	check(
		"UI creates the complete " +
			fixture +
			" LRC sequence with exact timestamps",
		{ cueCount, durationSeconds },
	);
	await page.locator('[data-testid="timeline-clip"]').first().click();
	await page.keyboard.press("Control+z");
	await expect
		.poll(async () => (await readData()).motionTextSequences.length)
		.toBe(0);
	await page.keyboard.press("Control+Shift+z");
	await expect
		.poll(async () => (await readData()).motionTextSequences)
		.toEqual(created.motionTextSequences);
	await page.reload();
	assert.deepEqual(
		(await readData()).motionTextSequences,
		created.motionTextSequences,
	);
	check(
		"long sequence insertion is one undo/redo transaction and reopens unchanged",
	);
	if (measureSeek) {
		onPhase("F04 real video underlay import");
		const videoPath = join(work, "f04-underlay.mp4");
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-f",
				"lavfi",
				"-i",
				"color=c=blue:s=1280x720:r=30:d=180",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:duration=180",
				"-c:v",
				"libx264",
				"-preset",
				"ultrafast",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-shortest",
				videoPath,
			],
			{ windowsHide: true, timeout: 60000 },
		);
		await page.getByLabel("Media", { exact: true }).click();
		const chooser = hostPage.waitForEvent("filechooser");
		await page.getByLabel("Import media", { exact: true }).click();
		await (await chooser).setFiles(videoPath);
		const insertVideo = page.getByLabel("Add f04-underlay.mp4 to timeline", {
			exact: true,
		});
		await expect(insertVideo).toBeVisible({ timeout: 30000 });
		await insertVideo.click();
		await expect
			.poll(
				async () => (await readData()).scenes[0].tracks.main.elements.length,
			)
			.toBe(1);
		check("F04 contains actual 720p video/audio under the full lyric sequence");
		await probePreviewSeek({ page, hostPage, work, evidence, onPhase });
	}
	return { created, readData };
}
