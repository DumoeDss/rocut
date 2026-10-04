import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { probeMotionDuration } from "./probe-motion-duration.mjs";
import { probeMotionStressExport } from "./probe-motion-stress-export.mjs";
import { probeMotionStressMemory } from "./probe-motion-stress-memory.mjs";

export async function probeMotionStress({
	page,
	hostPage,
	project,
	work,
	evidence,
	onPhase,
}) {
	const { created, readData } = await probeMotionDuration({
		page,
		hostPage,
		work,
		evidence,
		onPhase,
		fixture: "F05",
	});
	const original = created.motionTextSequences[0];
	const readSequence = async () => (await readData()).motionTextSequences[0];
	onPhase("F05 beginning, middle and final cue editing");
	await page.getByTestId("timeline-clip").first().click();
	const rows = page.locator(
		'[aria-labelledby="motion-text-cues-heading"] button[aria-expanded]',
	);
	await expect(rows).toHaveCount(600);
	for (const index of [0, 299, 599]) {
		const before = await readSequence();
		const cue = before.cues[index];
		await rows.nth(index).click();
		const input = page.locator('textarea[id^="motion-text-cue-"]');
		await expect(input).toHaveValue(cue.text);
		const edited = cue.text + " · 已编辑";
		await input.fill(edited);
		await input.press("Control+Enter");
		await expect
			.poll(async () => (await readSequence()).cues[index].text, {
				timeout: 20000,
			})
			.toBe(edited);
		await expect(input).toHaveCount(0);
		const after = await readSequence();
		assert.equal(after.cues[index].id, cue.id);
		assert.equal(after.duration, before.duration);
		assert.deepEqual(
			after.cues.filter((_, i) => i !== index),
			before.cues.filter((_, i) => i !== index),
		);
		await page.keyboard.press("Control+z");
		await expect
			.poll(async () => (await readSequence()).cues)
			.toEqual(before.cues);
		await page.keyboard.press("Control+Shift+z");
		await expect
			.poll(async () => (await readSequence()).cues)
			.toEqual(after.cues);
		await page.keyboard.press("Control+z");
		await expect
			.poll(async () => (await readSequence()).cues)
			.toEqual(before.cues);
		evidence.checks.push({
			name: "F05 UI edit preserves other cues, exact history and identity",
			cueIndex: index,
			pass: true,
		});
	}
	await page.screenshot({ path: join(work, "f05-final-cue-edit.png") });
	await page.reload();
	assert.deepEqual((await readSequence()).cues, original.cues);
	assert.equal((await readSequence()).duration, 480 * 120000);
	evidence.checks.push({
		name: "F05 all 600 cues and eight-minute range survive local edits/history and reopening",
		pass: true,
	});
	await probeMotionStressExport({ page, project, evidence, onPhase });
	await probeMotionStressMemory({ page, hostPage, work, evidence, onPhase });
}
