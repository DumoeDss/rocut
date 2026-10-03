import assert from "node:assert/strict";
import { expect } from "@playwright/test";

const readSequence = page => page.evaluate(async () => {
	const { record } = await (await fetch(new URL("api/record", location.href))).json();
	return record.data.motionTextSequences[0];
});

export async function probeCueStyle(page, evidence) {
	const initial = await readSequence(page);
	const font = initial.fonts.find(entry => entry.id !== initial.defaults.fontId);
	assert(font, "Fixture must contain an alternative font");
	await page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first().click();
	const form = page.locator('textarea[id^="motion-text-cue-"]').locator("..").locator("..");
	const style = form.getByText("Local style", { exact: true }).locator("..").locator("..");
	await style.getByRole("combobox").click();
	await page.getByRole("option", { name: "Editorial paper", exact: true }).click();
	const localFont = form.getByText("Local font", { exact: true }).locator("..").locator("..");
	await localFont.getByRole("combobox").click();
	await page.getByRole("option", { name: `${font.family} · ${font.weight} · ${font.supportedLanguages?.join("/") ?? "coverage unknown"}`, exact: true }).click();
	await form.getByRole("button", { name: "Override colors", exact: true }).click();
	const color = form.locator("label").filter({ hasText: /^Text$/ }).locator("..").getByRole("textbox");
	await color.fill("00FF00");
	await color.press("Tab");
	await form.getByRole("button", { name: "Apply changes", exact: true }).click();
	await expect.poll(async () => (await readSequence(page)).cues[0].overrides.colors?.foreground).toBe("#00FF00");
	const applied = await readSequence(page);
	assert.equal(applied.cues[0].overrides.fontId, font.id);
	assert.equal(applied.cues[0].overrides.preset.style, "paper");
	assert.deepEqual(applied.cues.slice(1), initial.cues.slice(1), "Local styling must not change other cues");
	assert.deepEqual(applied.defaults, initial.defaults, "Local styling must not change sequence defaults");
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(initial.cues);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(applied.cues);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(initial.cues);
	evidence.checks.push({ name: "cue-local preset/font/colors persist atomically without altering other cues, undo/redo", pass: true });
}

export async function probeCueTaps(page, evidence) {
	const initial = await readSequence(page);
	const controls = page.getByRole("heading", { name: "Manual cue tapping", exact: true }).locator("..").locator("..");
	await controls.getByRole("button", { name: "Start tapping from first cue", exact: true }).click();
	const seek = async seconds => {
		await page.locator('[aria-label="Edit playhead time"]').click();
		await page.locator('[aria-label="Playhead time"]').fill(`00:00:0${seconds}:00`);
		await page.locator('[aria-label="Playhead time"]').press("Enter");
	};
	await seek(1);
	await controls.getByRole("button", { name: "Tap current cue", exact: true }).click();
	await expect(controls.getByText("1 recorded", { exact: true })).toBeVisible();
	await controls.getByRole("button", { name: "Tap current cue", exact: true }).click();
	await expect(page.getByRole("alert").filter({ hasText: "Each tap must be later" })).toBeVisible();
	await expect(controls.getByText("1 recorded", { exact: true })).toBeVisible();
	await seek(6);
	await controls.getByRole("button", { name: "Tap current cue", exact: true }).click();
	await expect(controls.getByText("2 recorded", { exact: true })).toBeVisible();
	await controls.getByRole("button", { name: "Undo last tap", exact: true }).click();
	await expect(controls.getByText("1 recorded", { exact: true })).toBeVisible();
	assert.deepEqual((await readSequence(page)).cues, initial.cues, "Unapplied taps must not persist");
	await controls.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.deepEqual((await readSequence(page)).cues, initial.cues, "Cancelled taps must not persist");
	await page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first().click();
	await controls.getByRole("button", { name: "Start tapping from selected cue", exact: true }).click();
	await seek(1);
	await controls.getByRole("button", { name: "Tap current cue", exact: true }).click();
	await seek(6);
	await controls.getByRole("button", { name: "Tap current cue", exact: true }).click();
	await controls.getByRole("button", { name: "Apply taps", exact: true }).click();
	await expect.poll(async () => (await readSequence(page)).revision).toBeGreaterThan(initial.revision);
	const applied = await readSequence(page);
	assert.equal(applied.cues[0].startTime, 120000, "First cue must use the one-second tap");
	assert.equal(applied.cues[1].startTime, 720000, "Second cue must use the six-second tap");
	assert.notDeepEqual(applied.cues.map(cue => cue.startTime), initial.cues.map(cue => cue.startTime));
	assert.deepEqual(applied.cues.map(cue => cue.text), initial.cues.map(cue => cue.text));
	evidence.checks.push({ name: "cue tap apply focus", ...await page.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") })) });
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(initial.cues);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(applied.cues);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).cues).toEqual(initial.cues);
	await page.locator('textarea[id^="motion-text-cue-"]').locator("..").locator("..").getByRole("button", { name: "Cancel", exact: true }).click();
	evidence.checks.push({ name: "cue tapping validates monotonic time, undo-tap/cancel stay local, apply and undo/redo persist", pass: true });
}

export async function probePlanningControls(page, evidence) {
	const initial = (await readSequence(page)).planningControls;
	assert(initial, "Fixture must declare planning controls");
	const panel = page.locator('[data-motion-text-planning-controls]');
	const readControls = async () => (await readSequence(page)).planningControls;
	await panel.getByRole("button", { name: "Unified look", exact: true }).click();
	await expect.poll(async () => (await readControls()).unify).toBe(!initial.unify);
	evidence.checks.push({ name: "planning save focus", ...await page.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") })) });
	await page.keyboard.press("Control+z");
	await expect.poll(readControls).toEqual(initial);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readControls()).unify).toBe(!initial.unify);
	await page.keyboard.press("Control+z");
	await expect.poll(readControls).toEqual(initial);
	await panel.getByRole("button", { name: "Horror", exact: true }).click();
	await expect.poll(async () => (await readControls()).presetSets.horror).toBe(!initial.presetSets.horror);
	await page.keyboard.press("Control+z");
	await expect.poll(readControls).toEqual(initial);
	assert.equal(initial.centerFree, false, "Fixture starts without a clear center");
	await expect(panel.getByRole("button", { name: "Left / right", exact: true })).toBeDisabled();
	await panel.getByRole("button", { name: "Keep center clear", exact: true }).click();
	await expect.poll(async () => (await readControls()).centerFree).toBe(true);
	await panel.getByRole("button", { name: "Left / right", exact: true }).click();
	await expect.poll(async () => (await readControls()).centerDirection).toBe("lr");
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readControls()).centerDirection).toBe(initial.centerDirection);
	await page.keyboard.press("Control+z");
	await expect.poll(readControls).toEqual(initial);
	evidence.checks.push({ name: "planning families, unified look and center direction persist with correct disabled state and undo/redo", pass: true });
}

export async function probeCutBoundary(page, evidence) {
	const initial = await readSequence(page);
	const cue = initial.cues[0];
	const cuts = initial.resolvedPlan.cuts.filter(cut => cut.cueId === cue.id).sort((a, b) => a.startTime - b.startTime);
	assert(cuts.length >= 2, "Fixture must offer an internal cut boundary");
	await page.locator('[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]').first().click();
	const input = page.locator(`input[id="motion-text-cut-end-${cuts[0].id}"]`);
	const row = input.locator("..").locator("..").locator("..");
	const apply = row.getByRole("button", { name: "Apply boundary", exact: true });
	await input.fill("9999");
	await apply.click();
	await expect(page.getByRole("alert")).toBeVisible();
	assert.deepEqual((await readSequence(page)).resolvedPlan.cuts, initial.resolvedPlan.cuts, "Invalid boundary must not mutate the plan");
	const nextEnd = Math.round((cuts[0].startTime + cuts[0].duration) / 120) * 120 + 12000;
	assert(nextEnd < cuts[1].startTime + cuts[1].duration);
	await input.fill((nextEnd / 120000).toFixed(3));
	await apply.click();
	await expect.poll(async () => (await readSequence(page)).resolvedPlan.cuts.find(cut => cut.id === cuts[0].id)?.duration).toBe(nextEnd - cuts[0].startTime);
	await expect(input).toHaveValue((nextEnd / 120000).toFixed(3));
	const applied = await readSequence(page);
	const next = applied.resolvedPlan.cuts.find(cut => cut.id === cuts[1].id);
	assert.equal(next.startTime, nextEnd);
	assert.equal(next.startTime + next.duration, cuts[1].startTime + cuts[1].duration);
	assert.equal(applied.cues[0].startTime, cue.startTime);
	assert.equal(applied.cues[0].duration, cue.duration);
	evidence.checks.push({ name: "cut boundary save focus", ...await page.evaluate(() => ({ tag: document.activeElement?.tagName, insideSurface: !!document.activeElement?.closest("[data-editor-surface]") })) });
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).resolvedPlan.cuts).toEqual(initial.resolvedPlan.cuts);
	await expect(input).toHaveValue(((cuts[0].startTime + cuts[0].duration) / 120000).toFixed(3));
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(async () => (await readSequence(page)).resolvedPlan.cuts).toEqual(applied.resolvedPlan.cuts);
	await page.keyboard.press("Control+z");
	await expect.poll(async () => (await readSequence(page)).resolvedPlan.cuts).toEqual(initial.resolvedPlan.cuts);
	await page.locator('textarea[id^="motion-text-cue-"]').locator("..").locator("..").getByRole("button", { name: "Cancel", exact: true }).click();
	evidence.checks.push({ name: "cut boundary rejects invalid input, updates adjacent cuts without moving cue range, undo/redo", pass: true });
}
