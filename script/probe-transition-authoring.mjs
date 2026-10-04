import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// Only the ordinary clip geometry is seeded. Every transition write below uses UI.
export async function probeTransitionAuthoring({ page, evidence, onPhase, preview, seek }) {
	const clips = () => page.evaluate(async () =>
		(await (await fetch(new URL("api/record", location.href))).json()).record.data.scenes[0].tracks.main.elements);
	const original = await clips(), incomingId = original[1].id;
	const relation = async () => (await clips()).find(clip => clip.id === incomingId)?.transitionIn ?? null;
	const selectIncoming = async () => {
		await page.locator('[data-testid="timeline-clip"][data-element-id="'+incomingId+'"]').click();
		await page.getByLabel("Transitions", { exact: true }).click();
		await page.getByTestId("transition-configure").click();
		await expect(page.getByTestId("transition-properties")).toBeVisible();
	};
	onPhase("transition authoring validation");
	assert.equal(await relation(), null);
	await selectIncoming();
	await expect(page.getByTestId("transition-outgoing")).toHaveValue(original[0].id);
	await page.getByTestId("transition-duration").fill("1");
	await expect(page.getByTestId("transition-validation")).toContainText("at least 2 frames");
	await expect(page.getByTestId("transition-apply")).toHaveAttribute("aria-disabled", "true");
	assert.equal(await relation(), null);
	await page.getByTestId("transition-duration").fill("1000");
	await expect(page.getByTestId("transition-apply")).toHaveAttribute("aria-disabled", "true");
	assert.deepEqual(await clips(), original);
	evidence.checks.push({ name: "authoring rejects invalid duration and unavailable clip span without writing", pass: true });
	onPhase("transition authoring add and duration history");
	await page.getByTestId("transition-duration").fill("30");
	await expect(page.getByTestId("transition-apply")).toHaveAttribute("aria-disabled", "false");
	await page.getByTestId("transition-apply").click();
	const expected = { kind: "cross-dissolve", outgoingClipId: original[0].id, durationFrames: 30 };
	await expect.poll(relation).toEqual(expected);
	await page.keyboard.press("Control+z");
	await expect.poll(relation).toBe(null);
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(relation).toEqual(expected);
	await expect(page.getByTestId("transition-duration")).toHaveValue("30");
	await page.getByTestId("transition-duration").fill("16");
	await page.getByTestId("transition-apply").click();
	await expect.poll(relation).toEqual({ ...expected, durationFrames: 16 });
	await seek(page, "00:00:02:23");
	const shortSample = await preview(page, 1 / 16);
	// Seek leaves focus in its input. Restore a non-input control before editor shortcuts.
	await page.getByLabel("Transition", { exact: true }).click();
	await page.keyboard.press("Control+z");
	await expect.poll(relation).toEqual(expected);
	await expect(page.getByTestId("transition-duration")).toHaveValue("30");
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(relation).toEqual({ ...expected, durationFrames: 16 });
	await expect(page.getByTestId("transition-duration")).toHaveValue("16");
	evidence.checks.push({ name: "UI-created relation and duration each undo/redo in one step; shorter preview window is sampled", pass: true, shortSample });
	onPhase("transition authoring removal and reopen");
	await page.getByTestId("transition-remove").click();
	await expect.poll(relation).toBe(null);
	await page.keyboard.press("Control+z");
	await expect.poll(relation).toEqual({ ...expected, durationFrames: 16 });
	await page.keyboard.press("Control+Shift+z");
	await expect.poll(relation).toBe(null);
	await page.reload();
	assert.equal(await relation(), null);
	await selectIncoming();
	await page.getByTestId("transition-duration").fill("30");
	await page.getByTestId("transition-apply").click();
	await expect.poll(relation).toEqual(expected);
	await page.reload();
	await selectIncoming();
	await expect(page.getByTestId("transition-duration")).toHaveValue("30");
	assert.deepEqual(await relation(), expected);
	const final = await clips();
	const { transitionIn, ...incoming } = final[1];
	assert.deepEqual(final[0], original[0]);
	assert.deepEqual(incoming, original[1]);
	evidence.checks.push({ name: "UI removal undo/redo and re-add survive reopen with all original clip geometry, audio and parameters unchanged", pass: true });
	await page.screenshot({ path: evidence.transitionAuthoringScreenshot });
}
