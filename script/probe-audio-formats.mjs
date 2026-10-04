import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	attachAudioOutputObserver,
	observeAudioPlayback,
	inspectAudioExport,
} from "./probe-audio-format-output.mjs";

export async function probeAudioFormats({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	const entries = [];
	for (const [extension, codec] of [
		["wav", "pcm_s16le"],
		["mp3", "libmp3lame"],
		["flac", "flac"],
		["ogg", "libvorbis"],
		["opus", "libopus"],
		["m4a", "aac"],
	]) {
		const name = "audio-output." + extension,
			path = join(work, name);
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-n",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=880:duration=2",
				"-c:a",
				codec,
				path,
			],
			{ windowsHide: true },
		);
		entries.push({ name, path });
	}
	const record = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const clips = async () => {
		const tracks = (await record()).data.scenes[0].tracks;
		return [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
			(t) => t.elements,
		);
	};
	const seekStart = async () => {
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill("00:00:00:00");
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
	};
	onPhase("audio formats real batch import");
	await page.getByLabel("Media", { exact: true }).click();
	const choosing = hostPage.waitForEvent("filechooser");
	await page.getByLabel("Import media", { exact: true }).click();
	await (await choosing).setFiles(entries.map((e) => e.path));
	await expect
		.poll(
			() =>
				page.evaluate(
					async () =>
						(
							await (
								await fetch(new URL("api/attachments", location.href))
							).json()
						).length,
				),
			{ timeout: 30000 },
		)
		.toBe(entries.length);
	await expect(page.getByLabel("Import media", { exact: true })).toBeEnabled();
	evidence.audioFormats = [];
	for (const entry of entries) {
		onPhase("audio timeline playback and export: " + entry.name);
		await seekStart();
		await page
			.getByLabel("Add " + entry.name + " to timeline", { exact: true })
			.click();
		await expect.poll(async () => (await clips()).length).toBe(1);
		const initial = (await clips())[0];
		assert.equal(initial.type, "audio");
		assert.equal(initial.startTime, 0);
		assert(
			initial.duration > 228000 && initial.duration < 264000,
			"Audio duration must survive timeline insertion",
		);
		await page.reload();
		await page.getByTestId("timeline-clip").click();
		assert.deepEqual(
			(await clips())[0],
			initial,
			"Audio properties must persist across reopen",
		);
		await attachAudioOutputObserver(page);
		const playback = await observeAudioPlayback(page);
		const output = await inspectAudioExport(page, project);
		evidence.audioFormats.push({ name: entry.name, playback, output });
		evidence.checks.push({
			name:
				entry.name +
				" real timeline/reopen/880Hz preview and decoded ranged MP4",
			pass: true,
		});
		if (entry.name.endsWith(".wav")) {
			onPhase("audio volume mute history and export");
			await page.getByLabel("Volume", { exact: true }).fill("-6");
			await page.getByLabel("Volume", { exact: true }).press("Enter");
			await expect.poll(async () => (await clips())[0].params.volume).toBe(-6);
			const lowered = await observeAudioPlayback(page);
			const quieter = await inspectAudioExport(page, project);
			assert(
				lowered.maxRms / playback.maxRms > 0.45 &&
					lowered.maxRms / playback.maxRms < 0.56,
				"-6dB preview gain",
			);
			assert(
				quieter.rms / output.rms > 0.45 && quieter.rms / output.rms < 0.56,
				"-6dB export gain",
			);
			const mute = page
				.getByText("Muted", { exact: true })
				.locator("..")
				.locator("..")
				.getByRole("switch");
			await mute.click();
			await expect.poll(async () => (await clips())[0].params.muted).toBe(true);
			const muted = await observeAudioPlayback(page, { silent: true });
			const silent = await inspectAudioExport(page, project, { silent: true });
			await page.keyboard.press("Control+z");
			await expect
				.poll(async () => (await clips())[0].params.muted)
				.toBe(false);
			await page.keyboard.press("Control+Shift+z");
			await expect.poll(async () => (await clips())[0].params.muted).toBe(true);
			await page.reload();
			const persisted = (await clips())[0];
			assert.equal(persisted.params.muted, true);
			assert.equal(persisted.params.volume, -6);
			evidence.audioControls = { lowered, quieter, muted, silent };
			evidence.checks.push({
				name: "Volume and mute affect real playback/export; undo redo and reopen preserve edits",
				pass: true,
			});
			await page.getByTestId("timeline-clip").click();
			const handle = page.getByTitle("Drag to adjust clip volume", {
				exact: true,
			});
			await handle.scrollIntoViewIfNeeded();
			const rect = await handle.boundingBox();
			assert(rect);
			await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
			await page.mouse.down();
			await page.mouse.move(
				rect.x + rect.width / 2,
				rect.y + rect.height / 2 + 8,
				{ steps: 8 },
			);
			await page.mouse.up();
			await expect
				.poll(async () => (await clips())[0].params.volume)
				.not.toBe(-6);
			assert.equal(
				(await clips())[0].params.muted,
				true,
				"Volume-line drag must preserve the existing mute parameter",
			);
			await expect(
				page
					.getByText("Muted", { exact: true })
					.locator("..")
					.locator("..")
					.getByRole("switch"),
			).toBeChecked();
			await attachAudioOutputObserver(page);
			await observeAudioPlayback(page, { silent: true });
			evidence.checks.push({
				name: "Dragging an audio volume line preserves muted state",
				pass: true,
			});
		}
		await page.getByLabel("Delete element", { exact: true }).click();
		await expect.poll(async () => (await clips()).length).toBe(0);
		await page.getByLabel("Media", { exact: true }).click();
	}
	await page.screenshot({ path: join(work, "audio-formats-complete.png") });
}
