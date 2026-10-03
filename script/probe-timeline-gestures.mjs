import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export function audioSyncRecordReader(page) {
	const read = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			const sequence = record.data.motionTextSequences[0];
			const tracks = record.data.scenes[0].tracks;
			const clips = [tracks.main, ...tracks.overlay, ...tracks.audio].flatMap(
				(t) => t.elements,
			);
			return {
				sequence,
				motion: clips.find(
					(c) => c.type === "motion-text" && c.sequenceId === sequence.id,
				),
				audio: clips.find((c) => c.id === sequence.audioBinding?.clipId),
				revision: record.data.__opencutTransaction.revision,
			};
		});
	const geometry = (clip) => ({
		startTime: clip.startTime,
		duration: clip.duration,
		trimStart: clip.trimStart,
		trimEnd: clip.trimEnd,
	});
	return { read, geometry };
}

export function timelineDrag(page) {
	const drag = async (locator, delta, center = false) => {
		// Zoom-out does not necessarily fit a long clip into an embedded pane. Let
		// Playwright scroll the real target into view before using page coordinates.
		await locator.hover(center ? { position: { x: 40, y: 8 } } : {});
		const box = await locator.boundingBox();
		assert(box, "The real drag target must be visible");
		const x = box.x + (center ? Math.min(40, box.width / 2) : box.width / 2),
			y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + delta, y, { steps: 12 });
		await page.mouse.up();
	};
	return drag;
}

export async function probeTrimHistory({
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
}) {
	const trimDelta = Math.max(8, Math.min(35, pixelsPerSecond * 0.5));
	for (const side of ["Left", "Right"]) {
		await drag(
			timeline.getByRole("button", {
				name: side + " resize handle",
				exact: true,
			}),
			side === "Left" ? trimDelta : -trimDelta,
		);
		await expect
			.poll(async () => (await read()).motion.duration)
			.toBeLessThan(baseline.motion.duration);
		const trimmed = await read();
		const removed = baseline.motion.duration - trimmed.motion.duration;
		assert.equal(
			trimmed.revision,
			baseline.revision + (side === "Left" ? 1 : 5),
			"One resize gesture must commit exactly once",
		);
		assert.equal(
			trimmed.motion.startTime,
			baseline.motion.startTime + (side === "Left" ? removed : 0),
		);
		assert.equal(
			trimmed.motion.trimStart,
			baseline.motion.trimStart + (side === "Left" ? removed : 0),
		);
		assert.equal(
			trimmed.motion.trimEnd,
			baseline.motion.trimEnd + (side === "Right" ? removed : 0),
		);
		assert.deepEqual(
			trimmed.sequence.cues,
			baseline.sequence.cues,
			"Trimming the clip must not rewrite sequence cues",
		);
		await undo();
		await waitGeometry(geometry(baseline.motion));
		await redo();
		await waitGeometry(geometry(trimmed.motion));
		await undo();
		await waitGeometry(geometry(baseline.motion));
		evidence.checks.push({
			name: side.toLowerCase() + " trim by real mouse, one commit, undo/redo",
			removedTicks: removed,
			pass: true,
		});
	}
}

export async function lockSyncFixtureCue(page, read, original) {
	const protectedCue = original.sequence.cues.at(-1);
	assert(
		protectedCue && protectedCue.locks.length === 0,
		"Fixture must offer an unlocked cue to protect",
	);
	await page
		.locator(
			'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
		)
		.last()
		.click();
	await page
		.locator('[aria-labelledby="motion-text-locks-' + protectedCue.id + '"]')
		.getByRole("button", { name: "Lock cue", exact: true })
		.click();
	await expect
		.poll(async () => (await read()).sequence.cues.at(-1).locks)
		.toContainEqual({ scope: "cue", key: "all" });
	await page
		.locator('textarea[id^="motion-text-cue-"]')
		.locator("..")
		.locator("..")
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	return protectedCue;
}
