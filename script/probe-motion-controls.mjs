import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { probeAudioTempo } from "./probe-audio-tempo.mjs";

// UI-only mutations; durable API reads are independent acceptance assertions.
export async function probeMotionControls(page, evidence) {
	const readSequence = () => page.evaluate(async () => {
		const { record } = await (await fetch(new URL("api/record", location.href))).json();
		return record.data.motionTextSequences[0];
	});
	const before = await readSequence();
	const font = before.fonts.find(font => font.id !== before.defaults.fontId);
	assert(font, "Fixture must offer a different font");
	await page.getByRole("button", { name: "Edit font and colors", exact: true }).click();
	const field = page.getByText("Default font", { exact: true }).locator("..").locator("..");
	await field.getByRole("combobox").click();
	// The current font may be near the end of a long scrollable menu. Scroll
	// that viewport with real input before clicking an initially offscreen row.
	await page.getByRole("listbox").hover();
	await page.mouse.wheel(0, -2000);
	await page.waitForTimeout(250);
	await page.getByRole("option", {
		name: `${font.family} · ${font.weight} · ${font.supportedLanguages?.join("/") ?? "coverage unknown"}`,
		exact: true,
	}).click();
	await page.getByRole("button", { name: "Apply changes", exact: true }).click();
	await expect.poll(async () => (await readSequence()).defaults.fontId).toBe(font.id);
	await expect(page.getByText("Default font", { exact: true })).toHaveCount(0);
	const focus = await page.evaluate(() => ({
		tag: document.activeElement?.tagName,
		insideSurface: !!document.activeElement?.closest("[data-editor-surface]"),
	}));
	evidence.checks.push({ name: "default font apply focus", ...focus });
	assert(focus.insideSurface, "Closing defaults after Apply must keep keyboard focus in the editor");
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence()).defaults.fontId).toBe(before.defaults.fontId);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readSequence()).defaults.fontId).toBe(font.id);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence()).defaults.fontId).toBe(before.defaults.fontId);
	evidence.checks.push({ name: "default font apply, close, undo and redo persist", pass: true });
}

export async function probeAudioBinding(page, evidence) {
	const readState = () => page.evaluate(async () => {
		const { record } = await (await fetch(new URL("api/record", location.href))).json();
		return {
			binding: record.data.motionTextSequences[0].audioBinding,
			audio: record.data.scenes[0].tracks.audio.flatMap(track => track.elements),
		};
	});
	await page.locator('[aria-label="Edit playhead time"]').click();
	await page.locator('[aria-label="Playhead time"]').fill("00:00:00:00");
	await page.locator('[aria-label="Playhead time"]').press("Enter");
	await page.locator('[aria-label="Add fixture-tone-a4.wav to timeline"]').click();
	await expect.poll(async () => (await readState()).audio.length).toBe(1);
	const clip = (await readState()).audio[0];
	await page.locator('[aria-label="Timeline"]').getByText("Clean caption", { exact: true }).click();
	await page.getByRole("button", { name: "Analyze and bind", exact: true }).click();
	try {
		await expect.poll(async () => (await readState()).binding?.clipId, { timeout: 30000 }).toBe(clip.id);
	} catch (error) {
		evidence.checks.push({ name: "audio binding failure", alerts: await page.locator('[role="alert"],[role="status"]').allTextContents(), body: (await page.locator("body").innerText()).slice(-6000) });
		throw error;
	}
	const bound = await readState();
	assert.equal(bound.binding.assetId, clip.mediaId);
	assert(bound.binding.contentDigest?.length > 0);
	assert.equal(bound.audio.length, 1, "Binding must not duplicate the audio track");
	await probeAudioTempo(page, evidence);
	await page.getByRole("button", { name: "Clear binding", exact: true }).click();
	await expect.poll(async () => (await readState()).binding).toBeUndefined();
	assert.equal((await readState()).audio.length, 1, "Clearing binding must retain the timeline audio");
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readState()).binding?.clipId).toBe(clip.id);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readState()).binding).toBeUndefined();
	evidence.checks.push({ name: "audio analysis binds existing clip, clears without adding/removing audio", pass: true });
}

export async function probeLocksAndVariations(page, evidence) {
	const readSequence = () => page.evaluate(async () => {
		const { record } = await (await fetch(new URL("api/record", location.href))).json();
		return record.data.motionTextSequences[0];
	});
	await page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first().click();
	const initial = await readSequence();
	const cueId = initial.cues[0].id;
	const locks = page.locator(`[aria-labelledby="motion-text-locks-${cueId}"]`);
	await locks.getByRole("button", { name: "Style", exact: true }).click();
	const readStyleLock = async () => (await readSequence()).cues[0].locks.some(lock => lock.scope === "preset-group" && lock.key === "style");
	await expect.poll(readStyleLock).toBe(true);
	const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") }));
	evidence.checks.push({ name: "lock save focus", ...focus });
	assert(focus.insideSurface, "Lock changes must retain editor shortcut focus");
	await page.keyboard.press("Control+z");
	await expect.poll(readStyleLock).toBe(false);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(readStyleLock).toBe(true);
	const locked = await readSequence();
	const variation = page.getByRole("heading", { name: "Variation", exact: true }).locator("..").locator("..");
	await variation.getByRole("button", { name: "Generate variation", exact: true }).click();
	await expect(variation.getByText("Canvas preview", { exact: true })).toBeVisible();
	assert.deepEqual((await readSequence()).resolvedPlan, locked.resolvedPlan, "Preview must not persist candidate values");
	await variation.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.deepEqual((await readSequence()).resolvedPlan, locked.resolvedPlan, "Cancel must leave committed values unchanged");
	await expect(variation.getByRole("button", { name: "Generate variation", exact: true })).toBeFocused();
	await variation.getByRole("button", { name: "Generate variation", exact: true }).click();
	await variation.getByRole("button", { name: "Apply variation", exact: true }).click();
	await expect.poll(async () => (await readSequence()).revision).toBeGreaterThan(locked.revision);
	const applied = await readSequence();
	const cueStyles = sequence => sequence.resolvedPlan.cuts.filter(cut => cut.cueId === cueId).map(cut => cut.preset.style);
	assert.deepEqual(cueStyles(applied), cueStyles(locked), "Variation must preserve the locked cue's style");
	assert.notDeepEqual(applied.resolvedPlan.cuts, locked.resolvedPlan.cuts, "Applying a variation must actually change unlocked values");
	const variationFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") }));
	evidence.checks.push({ name: "variation apply focus", ...variationFocus });
	assert(variationFocus.insideSurface, "Applying a variation must retain editor shortcut focus");
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence()).resolvedPlan.cuts).toEqual(locked.resolvedPlan.cuts);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readSequence()).resolvedPlan.cuts).toEqual(applied.resolvedPlan.cuts);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence()).resolvedPlan.cuts).toEqual(locked.resolvedPlan.cuts);
	await page.keyboard.press("Control+z");
	await expect.poll(readStyleLock).toBe(false);
	await page.locator('textarea[id^="motion-text-cue-"]').locator("..").locator("..").getByRole("button", { name: "Cancel", exact: true }).click();
	evidence.checks.push({ name: "lock history, nonpersistent variation preview/cancel, locked-style apply and history", pass: true });
}
