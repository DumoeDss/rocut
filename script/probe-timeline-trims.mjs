import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function probeTimelineTrims({
	page,
	readClips,
	select,
	seek,
	check,
	onPhase,
}) {
	onPhase("timeline split-left/right durable UI geometry");
	const original = (await readClips())[0];
	assert.equal(original.startTime, 0);
	assert.equal(
		original.duration,
		480000,
		"The source fixture is exactly four seconds",
	);
	const ripple = page.getByLabel("Ripple editing", { exact: true });
	if ((await ripple.getAttribute("aria-pressed")) === "true")
		await ripple.click();
	await expect(ripple).toHaveAttribute("aria-pressed", "false");
	await select(original.id);
	await seek(1);
	await page.getByLabel("Split left", { exact: true }).click();
	await expect.poll(async () => (await readClips())[0].duration).toBe(360000);
	const right = (await readClips())[0];
	assert.equal(right.startTime, 120000);
	assert.equal(right.trimStart, original.trimStart + 120000);
	assert.equal(right.trimEnd, original.trimEnd);
	assert.equal(right.mediaId, original.mediaId);
	assert.deepEqual(right.params, original.params);
	await page.keyboard.press("Control+z");
	await expect.poll(readClips).toEqual([original]);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(readClips).toEqual([right]);
	await page.keyboard.press("Control+z");
	await expect.poll(readClips).toEqual([original]);
	check(
		"Split left retains the right source span; geometry/gain and undo/redo are durable",
	);
	await select(original.id);
	await seek(3);
	await page.getByLabel("Split right", { exact: true }).click();
	await expect.poll(async () => (await readClips())[0].duration).toBe(360000);
	const left = (await readClips())[0];
	assert.equal(left.startTime, 0);
	assert.equal(left.trimStart, original.trimStart);
	assert.equal(left.trimEnd, original.trimEnd + 120000);
	assert.deepEqual(left.params, original.params);
	await page.keyboard.press("Control+z");
	await expect.poll(readClips).toEqual([original]);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(readClips).toEqual([left]);
	await page.reload();
	assert.deepEqual(await readClips(), [left]);
	check(
		"Split right retains the left source span and survives history/reopening",
	);
	await select(left.id);
	await seek(1);
	await ripple.click();
	await expect(ripple).toHaveAttribute("aria-pressed", "true");
	await page.getByLabel("Split left", { exact: true }).click();
	await expect.poll(async () => (await readClips())[0].duration).toBe(240000);
	const rippled = (await readClips())[0];
	assert.equal(
		rippled.startTime,
		0,
		"Ripple split closes the removed leading gap",
	);
	assert.equal(rippled.trimStart, left.trimStart + 120000);
	await page.keyboard.press("Control+z");
	await expect.poll(readClips).toEqual([left]);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(readClips).toEqual([rippled]);
	check("Ripple split-left closes the gap as one undo/redo operation");
}
