import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import {
	audioSyncRecordReader,
	lockSyncFixtureCue,
	timelineDrag,
	probeTrimHistory,
} from "./probe-timeline-gestures.mjs";

// Only mouse/keyboard gestures mutate the editor. Durable record reads are the oracle.
export async function probeAudioSync(page, evidence) {
	const { read, geometry } = audioSyncRecordReader(page);
	const original = await read();
	const protectedCue = await lockSyncFixtureCue(page, read, original);
	const baseline = await read();
	assert(baseline.audio && baseline.motion && baseline.sequence.audioBinding);
	const timeline = page.getByRole("region", { name: "Timeline", exact: true });
	const clip = timeline.getByRole("button", {
		name: baseline.motion.name,
		exact: true,
	});
	const zoom = page.getByRole("slider", { name: "Timeline zoom", exact: true });
	const originalZoom = Number(await zoom.getAttribute("aria-valuenow"));
	const snap = timeline.getByRole("button", {
		name: "Auto snapping",
		exact: true,
	});
	const snapped = (await snap.getAttribute("aria-pressed")) === "true";
	if (snapped) await snap.click();
	await zoom.press("Home");
	const drag = timelineDrag(page);
	const undo = () => page.keyboard.press("Control+z");
	const redo = () => page.keyboard.press("Control+Shift+z");
	const waitGeometry = (expected) =>
		expect
			.poll(async () => geometry((await read()).motion), { timeout: 10000 })
			.toEqual(expected);
	try {
		await clip.click();
		const width = (await clip.boundingBox()).width;
		const pixelsPerSecond = (width + 3) / (baseline.motion.duration / 120000);
		await probeTrimHistory({
			timeline,
			read,
			geometry,
			baseline,
			pixelsPerSecond,
			drag,
			undo,
			redo,
			waitGeometry,
			evidence,
		});
		const slackSeconds =
			(baseline.audio.startTime +
				baseline.audio.duration -
				baseline.motion.startTime -
				baseline.motion.duration) /
			120000;
		assert(
			slackSeconds > 0.2,
			"Audio fixture must cover the moved motion-text clip",
		);
		const moveDelta = Math.max(
			6,
			Math.min(24, pixelsPerSecond * slackSeconds * 0.5),
		);
		await drag(clip, moveDelta, true);
		await expect
			.poll(async () => (await read()).motion.startTime)
			.toBeGreaterThan(baseline.motion.startTime);
		const moved = await read();
		assert.equal(moved.motion.duration, baseline.motion.duration);
		assert.equal(moved.motion.trimStart, baseline.motion.trimStart);
		assert.deepEqual(
			moved.sequence.audioBinding,
			baseline.sequence.audioBinding,
			"Dragging must mark stale geometry, not silently overwrite binding",
		);
		await expect(
			page.getByText("Audio clip timing changed", { exact: true }),
		).toBeVisible();
		const expectedOffset =
			moved.motion.startTime -
			moved.motion.trimStart -
			moved.audio.startTime +
			moved.audio.trimStart;
		assert(expectedOffset > baseline.sequence.audioBinding.sourceOffset);
		const preview = page.getByTestId("motion-text-audio-sync-preview");
		await page
			.getByRole("button", { name: "Preview re-sync", exact: true })
			.click();
		await expect(preview).toBeVisible({ timeout: 30000 });
		assert.deepEqual(
			(await read()).sequence,
			moved.sequence,
			"Preview must not persist a candidate",
		);
		await preview
			.getByRole("button", { name: "Cancel preview", exact: true })
			.click();
		await expect(preview).toHaveCount(0);
		assert.deepEqual(
			(await read()).sequence,
			moved.sequence,
			"Cancel must preserve the committed sequence",
		);
		assert(
			await page.evaluate(
				() => !!document.activeElement?.closest("[data-editor-surface]"),
			),
			"Cancel sync must retain shortcut focus",
		);
		await page
			.getByRole("button", { name: "Preview re-sync", exact: true })
			.click();
		await expect(preview).toBeVisible({ timeout: 30000 });
		await preview
			.getByRole("button", { name: "Apply sync", exact: true })
			.click();
		await expect
			.poll(async () => (await read()).sequence.audioBinding.sourceOffset)
			.toBe(expectedOffset);
		await expect(preview).toHaveCount(0);
		const applied = await read();
		assert.equal(
			applied.revision,
			moved.revision + 1,
			"Applying sync must create exactly one history entry",
		);
		for (const cue of baseline.sequence.cues.filter(
			(c) =>
				c.timingSource === "manual" ||
				c.timingSource === "tap" ||
				c.locks.some((l) => l.scope === "cue" && l.key === "all"),
		)) {
			const after = applied.sequence.cues.find((c) => c.id === cue.id);
			assert.equal(after.startTime, cue.startTime);
			assert.equal(after.duration, cue.duration);
		}
		const derived = baseline.sequence.cues.filter(
			(c) =>
				(c.timingSource === "lrc" || c.timingSource === "estimated") &&
				c.startTime > expectedOffset &&
				c.id !== protectedCue.id,
		);
		assert(
			derived.length > 0,
			"Fixture must exercise a derived cue that really moves",
		);
		for (const cue of derived)
			assert.equal(
				applied.sequence.cues.find((c) => c.id === cue.id).startTime,
				cue.startTime -
					(expectedOffset - baseline.sequence.audioBinding.sourceOffset),
			);
		assert(
			await page.evaluate(
				() => !!document.activeElement?.closest("[data-editor-surface]"),
			),
			"Apply sync must retain shortcut focus",
		);
		await undo();
		await expect
			.poll(async () => (await read()).sequence.audioBinding)
			.toEqual(moved.sequence.audioBinding);
		await redo();
		await expect
			.poll(async () => (await read()).sequence.audioBinding)
			.toEqual(applied.sequence.audioBinding);
		await undo();
		await expect
			.poll(async () => (await read()).sequence.audioBinding)
			.toEqual(moved.sequence.audioBinding);
		await undo();
		await waitGeometry(geometry(baseline.motion));
		await undo();
		await expect
			.poll(async () => (await read()).sequence.cues)
			.toEqual(original.sequence.cues);
		evidence.checks.push({
			name: "audio re-sync after real clip drag: nonpersistent preview/cancel, atomic apply, protected cues and history",
			offsetTicks: expectedOffset,
			pass: true,
		});
	} finally {
		if (snapped && (await snap.getAttribute("aria-pressed")) !== "true")
			await snap.click();
		await zoom.press("Home");
		for (let i = 0; i < Math.round(originalZoom / 0.005); i++)
			await zoom.press("ArrowRight");
	}
}
