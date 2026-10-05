import assert from "node:assert/strict";
import { appendEnglishOverlay } from "./probe-linked-language-import.mjs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
	compositionPreview,
	assertCompositionPixels,
} from "./probe-composition-pixels.mjs";

// Continue the already edited/split/Agent-reviewed project, never replace it
// with a clean multilingual fixture. Hiding only the new English clip must
// restore the exact previous composition, including its audiovisual underlay.
export async function probeLinkedLanguages({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const read = () =>
		page.evaluate(
			async () =>
				(await (await fetch(new URL("api/record", location.href))).json())
					.record,
		);
	const clips = (record) => {
		const t = record.data.scenes[0].tracks;
		return [t.main, ...t.overlay, ...t.audio].flatMap(
			(track) => track.elements,
		);
	};
	const seek = async (frame) => {
		const label = `00:00:${String(Math.floor(frame / 30)).padStart(2, "0")}:${String(frame % 30).padStart(2, "0")}`;
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		await page.getByLabel("Playhead time", { exact: true }).fill(label);
		await page.getByLabel("Playhead time", { exact: true }).press("Enter");
		await hostPage.keyboard.press("Escape");
	};
	const capture = async (frame) => {
		await seek(frame);
		await page.waitForTimeout(400);
		let previous,
			sample,
			streak = 0;
		await expect
			.poll(
				async () => {
					sample = await compositionPreview(page);
					streak = sample.hash === previous ? streak + 1 : 1;
					previous = sample.hash;
					return streak >= 3;
				},
				{ timeout: 20000 },
			)
			.toBe(true);
		return sample;
	};
	const before = await read(),
		originals = new Map(),
		frames = [54, 102, 114];
	onPhase("same-project original composition before English overlay");
	for (const frame of frames) originals.set(frame, await capture(frame));
	await seek(0);
	const { english, clip } = await appendEnglishOverlay({
		page,
		hostPage,
		before,
		read,
		clips,
		onPhase,
	});
	const authored = await read();
	assert.equal(authored.id, before.id);
	assert.deepEqual(
		authored.data.motionTextSequences.filter((s) => s.id !== english.id),
		before.data.motionTextSequences,
	);
	assert.deepEqual(
		clips(authored).filter((c) => c.id !== clip.id),
		clips(before),
	);
	const mixed = new Map();
	for (const frame of frames) {
		const sample = await capture(frame);
		assert(
			sample.magenta.length > 25,
			`English glyphs must be visible at ${frame}`,
		);
		assert.notEqual(sample.hash, originals.get(frame).hash);
		mixed.set(frame, sample);
	}
	const fonts = await page.evaluate(() =>
		Array.from(document.fonts, (f) => ({
			family: f.family,
			status: f.status,
		})).filter((f) => f.family.startsWith("__rocut_mt_")),
	);
	for (const fontId of [
		english.defaults.fontId,
		before.data.motionTextSequences[0].defaults.fontId,
	]) {
		assert(
			fonts.some(
				(f) =>
					new RegExp(`^__rocut_mt_${fontId}_[a-f0-9]{16}$`).test(f.family) &&
					f.status === "loaded",
			),
		);
	}
	onPhase("same-project multilingual shuffled seeks and visibility isolation");
	for (const frame of [114, 54, 102, 54, 114, 102]) {
		await seek(frame);
		await expect
			.poll(async () => (await compositionPreview(page)).hash)
			.toBe(mixed.get(frame).hash);
	}
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${clip.id}"]`)
		.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Hide", exact: true }).click();
	await expect
		.poll(async () => clips(await read()).find((c) => c.id === clip.id).hidden)
		.toBe(true);
	for (const frame of frames) {
		await seek(frame);
		await expect
			.poll(
				async () => {
					try {
						assertCompositionPixels(
							await compositionPreview(page),
							originals.get(frame),
						);
						return null;
					} catch (error) {
						return error.message;
					}
				},
				{ timeout: 15000 },
			)
			.toBeNull();
	}
	// Seeking dismisses selection; focus the clip before issuing history input.
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${clip.id}"]`)
		.click();
	await hostPage.keyboard.press("Control+z");
	// Undo is a new durable save: timestamps change, authored content must not.
	const content = (record) => ({
		sequences: record.data.motionTextSequences,
		settings: record.data.settings,
		scenes: record.data.scenes.map(({ updatedAt, ...scene }) => scene),
	});
	await expect
		.poll(async () => content(await read()))
		.toEqual(content(authored));
	for (const frame of [102, 54, 114]) {
		await seek(frame);
		await expect
			.poll(async () => (await compositionPreview(page)).hash)
			.toBe(mixed.get(frame).hash);
	}
	await hostPage.screenshot({ path: join(work, "linked-languages.png") });
	evidence.checks.push({
		name: "same-project English overlay preserves original split clips, cue locks, fonts and seeds; shuffled seeks and hide/undo reproduce exact composition",
		pass: true,
		fonts,
	});
	return page;
}
