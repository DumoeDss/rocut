import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	assertContinuityPreview,
	continuityPreview,
} from "./probe-continuity-pixels.mjs";
import { sampleContinuityExportPng } from "./probe-continuity-export-pixels.mjs";
import { captureExportReference } from "./probe-export-reference.mjs";
import {
	languageOverlap,
	mainPreviewCanvas,
} from "./probe-multilingual-media.mjs";
import {
	createMotionContinuityFixture,
	exportMotionContinuity,
} from "./probe-motion-clip-fixture.mjs";

export async function probeMotionClipContinuity({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
	existingLyrics = false,
}) {
	await hostPage.setViewportSize({ width: 1920, height: 1080 });
	const readState = () =>
		page.evaluate(async () => {
			const { record } = await (
				await fetch(new URL("api/record", location.href))
			).json();
			return {
				sequences: record.data.motionTextSequences ?? [],
				scenes: record.data.scenes,
				settings: record.data.settings,
			};
		});
	const clips = (state) =>
		[
			state.scenes[0].tracks.main,
			...state.scenes[0].tracks.overlay,
			...state.scenes[0].tracks.audio,
		].flatMap((t) => t.elements);
	const motion = (state) =>
		clips(state)
			.filter((c) => c.type === "motion-text")
			.sort((a, b) => a.startTime - b.startTime);
	const select = (id) =>
		page
			.locator('[data-testid="timeline-clip"][data-element-id="' + id + '"]')
			.click();
	const seek = async (frame) => {
		const label =
			"00:00:" +
			String(Math.floor(frame / 30)).padStart(2, "0") +
			":" +
			String(frame % 30).padStart(2, "0");
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill(label);
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await hostPage.keyboard.press("Escape");
	};
	const capture = async (frame) => {
		await seek(frame);
		await page.waitForTimeout(400);
		let previous,
			streak = 0,
			sample;
		await expect
			.poll(
				async () => {
					sample = await continuityPreview(page);
					streak = sample.hash === previous ? streak + 1 : 1;
					previous = sample.hash;
					return streak >= 3;
				},
				{ timeout: 20000 },
			)
			.toBe(true);
		return sample;
	};
	const check = (name, extra = {}) =>
		evidence.checks.push({ name, pass: true, ...extra });
	if (!existingLyrics) {
		onPhase("import locked animated text and real video audio underlay");
		await createMotionContinuityFixture({ page, hostPage, work });
	}
	const initial = await readState(),
		original = motion(initial)[0];
	onPhase(
		"capture original animation phases over the same audiovisual project",
	);
	assert.equal(original.startTime, 0);
	assert.equal(original.duration, existingLyrics ? 720000 : 528000);
	const frames = existingLyrics ? [24, 48, 84, 144, 168] : [24, 36, 42, 69, 87],
		baselines = new Map(),
		exportBaselines = new Map();
	for (const frame of frames) {
		const sample = await capture(frame);
		const visible = existingLyrics ? sample.foreground : sample.overlay;
		assert(
			visible.length > 25,
			"baseline frame " +
				frame +
				" must contain visible motion artwork, got " +
				visible.length,
		);
		baselines.set(frame, sample);
		const exportReference = await captureExportReference({
			page,
			hostPage,
			path: join(work, "export-reference-" + frame + ".png"),
			sample: sampleContinuityExportPng,
		});
		assert(
			exportReference.foreground.length > 25,
			"high-density reference must contain the displayed glyphs",
		);
		exportBaselines.set(frame, exportReference);
		await (
			await mainPreviewCanvas(page)
		).screenshot({ path: join(work, "baseline-" + frame + ".png") });
	}
	assert(
		new Set(
			[...baselines.values()].map((s) =>
				JSON.stringify([s.foreground, s.foregroundRgba]),
			),
		).size >= 3,
		"different animation phases must render different pixels",
	);
	const reset = await capture(existingLyrics ? 0 : 6);
	if (existingLyrics)
		assert.notDeepEqual(
			[reset.foreground, reset.foregroundRgba],
			[baselines.get(48).foreground, baselines.get(48).foregroundRgba],
			"restart negative control must differ from the running cue",
		);
	else
		assert.equal(
			reset.overlay.length,
			0,
			"reset-to-zero negative control must lack the first cue",
		);
	check(
		"independent original-time frame baselines contain changing locked animation over audiovisual media",
	);
	for (const label of ["Auto snapping", "Ripple editing"]) {
		const toggle = page.getByLabel(label, { exact: true });
		if ((await toggle.getAttribute("aria-pressed")) === "true")
			await toggle.click();
	}
	await select(original.id);
	const element = page.locator(
		'[data-testid="timeline-clip"][data-element-id="' + original.id + '"]',
	);
	const box = await element.boundingBox();
	assert(box);
	const pixelSecond = box.width / (original.duration / 120000);
	onPhase("move motion clip later using actual pointer drag");
	await hostPage.mouse.move(
		box.x + Math.min(35, box.width / 2),
		box.y + box.height / 2,
	);
	await hostPage.mouse.down();
	await hostPage.mouse.move(
		box.x + Math.min(35, box.width / 2) + pixelSecond,
		box.y + box.height / 2,
		{ steps: 12 },
	);
	await hostPage.mouse.up();
	await expect
		.poll(async () => motion(await readState())[0].startTime)
		.toBeGreaterThan(0);
	const moved = await readState(),
		shifted = motion(moved)[0],
		offset = shifted.startTime / 4000;
	assert(
		Number.isInteger(offset) && offset >= 27 && offset <= 33,
		"one-second drag must move by about 30 project frames",
	);
	assert.equal(shifted.duration, original.duration);
	assert.equal(shifted.trimStart, original.trimStart);
	assert.deepEqual(moved.sequences, initial.sequences);
	const compare = async (label) => {
		for (const frame of frames) {
			const sample = await capture(frame + offset);
			evidence.continuitySamples ??= [];
			evidence.continuitySamples.push({
				label,
				frame,
				expectedHash: baselines.get(frame).hash,
				actualHash: sample.hash,
				expectedPixels: baselines.get(frame).overlay.length,
				actualPixels: sample.overlay.length,
				expectedForegroundPixels: baselines.get(frame).foreground.length,
				actualForegroundPixels: sample.foreground.length,
				overlap: languageOverlap({
					expected: baselines.get(frame).overlay,
					actual: sample.overlay,
				}),
			});
			await (
				await mainPreviewCanvas(page)
			).screenshot({
				path: join(work, label.replaceAll(" ", "-") + "-" + frame + ".png"),
			});
			// Preserve the exact cyan gate and include card backs/dark artwork.
			assertContinuityPreview({
				actual: sample,
				expected: baselines.get(frame),
				label: label + " must preserve source animation phase at " + frame,
			});
		}
	};
	await compare("moved clip");
	check(
		"moving the clip preserves exact original-time rendered pixels and sequence plans",
		{ offsetFrames: offset },
	);
	onPhase("trim leading half second with real resize handle");
	await select(original.id);
	const handle = await page
		.getByLabel("Left resize handle", { exact: true })
		.boundingBox();
	assert(handle);
	await hostPage.mouse.move(
		handle.x + handle.width / 2,
		handle.y + handle.height / 2,
	);
	await hostPage.mouse.down();
	await hostPage.mouse.move(
		handle.x + handle.width / 2 + pixelSecond / 2,
		handle.y + handle.height / 2,
		{ steps: 10 },
	);
	await hostPage.mouse.up();
	await expect
		.poll(async () => motion(await readState())[0].trimStart)
		.toBeGreaterThan(shifted.trimStart);
	const trimmed = await readState(),
		shortened = motion(trimmed)[0],
		removed = shortened.trimStart - shifted.trimStart;
	assert(
		removed >= 48000 && removed <= 72000,
		"head trim must remove about half a second",
	);
	assert.equal(shortened.startTime, shifted.startTime + removed);
	assert.equal(shortened.duration, shifted.duration - removed);
	assert.equal(
		shortened.startTime + shortened.duration,
		shifted.startTime + shifted.duration,
	);
	assert.deepEqual(trimmed.sequences, initial.sequences);
	await compare("head-trimmed clip");
	check(
		"head resize retains the original source-time animation and final timeline end",
		{ removedTicks: removed },
	);
	onPhase("split in the middle of a running animation");
	await seek(offset + 30);
	// seek dismisses input focus with Escape, which also clears selection.
	await select(original.id);
	await page.getByLabel("Split element", { exact: true }).click();
	await expect.poll(async () => motion(await readState()).length).toBe(2);
	const split = await readState(),
		parts = motion(split);
	assert.equal(parts[0].startTime, shortened.startTime);
	assert.equal(parts[1].startTime, shifted.startTime + 120000);
	assert.equal(parts[0].startTime + parts[0].duration, parts[1].startTime);
	assert.equal(parts[1].trimStart, 120000);
	assert.equal(
		parts[1].startTime + parts[1].duration,
		shifted.startTime + shifted.duration,
	);
	assert.deepEqual(split.sequences, initial.sequences);
	assert(parts.every((p) => p.sequenceId === original.sequenceId));
	await compare("split clips");
	check(
		"split clips share the unchanged plan and do not restart animation on the right side",
	);
	await select(parts[1].id);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readState).toEqual(trimmed);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readState).toEqual(moved);
	await hostPage.keyboard.press("Control+z");
	await expect.poll(readState).toEqual(initial);
	for (const expected of [moved, trimmed, split]) {
		await hostPage.keyboard.press("Control+Shift+z");
		await expect.poll(readState).toEqual(expected);
	}
	if (existingLyrics) {
		const editorUrl = page.url();
		await hostPage
			.locator(
				'[data-testid="chat-button-workspace-close"][data-workspace-id="rocut"]',
			)
			.click();
		await expect(
			hostPage.locator(
				'[data-testid="webpane-tab-slot"][data-tool-id="rocut"]',
			),
		).toHaveCount(0);
		await hostPage
			.locator('[data-testid="chat-tab-workspace"][data-workspace-id="rocut"]')
			.click();
		await expect
			.poll(
				() => {
					const reopened = hostPage
						.frames()
						.find((frame) => frame.url() === editorUrl);
					if (reopened) page = reopened;
					return !!reopened;
				},
				{ timeout: 30000 },
			)
			.toBe(true);
		await page.getByLabel("Media", { exact: true }).waitFor({ timeout: 30000 });
	} else await page.reload();
	assert.deepEqual(await readState(), split);
	await compare("reopened split clips");
	await hostPage.screenshot({
		path: join(work, "motion-continuity-reopened.png"),
	});
	check(
		"move trim split undo and redo restore exact data and survive reload with matching pixels",
	);
	onPhase(
		"export edited timeline and decode independent glyph and audio samples",
	);
	await exportMotionContinuity({
		page,
		hostPage,
		work,
		frames,
		offset,
		baselines: exportBaselines,
		readState,
		split,
		check,
	});
	onPhase(
		"export completion restores the unchanged playhead preview without a seek",
	);
	const expected = baselines.get(frames[frames.length - 1]);
	let restored;
	await expect
		.poll(
			async () => {
				restored = await continuityPreview(page);
				return (
					JSON.stringify([
						restored.overlay,
						restored.foreground,
						restored.foregroundRgba,
					]) ===
					JSON.stringify([
						expected.overlay,
						expected.foreground,
						expected.foregroundRgba,
					])
				);
			},
			{ timeout: 10000 },
		)
		.toBe(true);
	check(
		"export completion restores exact current-time glyph pixels without moving the playhead",
		{ overlayPixels: restored.overlay.length },
	);
	return {
		page,
		state: split,
		existingTimeline: {
			clipCount: clips(split).length,
			clipId: parts[1].id,
			verifyTicks: offset * 4000 + 540000,
		},
	};
}
