import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";

export function createSweepScrollHistory(agentRequest) {
	return async (kind, key) => {
		const context = await agentRequest("context");
		const started = await agentRequest("editor-tasks", {
			request: {
				kind,
				expectedRevision: context.revision,
				idempotencyKey: key,
			},
		});
		const job = await poll(async () => {
			const job = await agentRequest(`editor-tasks/${started.id}`);
			return job.status === "running" ? null : job;
		});
		assert.equal(job.status, "complete", JSON.stringify(job));
		return job.result;
	};
}

export async function runSweepScrollOpacityHistory(
	page,
	artifacts,
	evidence,
	agentRequest,
	{
		prefix = "sweep-scroll",
		edits = evidence.sweepScrollEdits,
		historyKey = "sweepScrollUiHistory",
	} = {},
) {
	const history = createSweepScrollHistory(agentRequest);
	const readClip = async (index) =>
		(await agentRequest("clips")).find(
			(clip) => clip.id === `${prefix}-${index}`,
		);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const at = async (ticks) =>
		seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
	evidence[historyKey] = [];
	for (const edit of edits) {
		const index = edit.index;
		const original = await readClip(index);
		const untouched = byId(
			(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
		);
		const originalOpacity = original.editing.params.opacity ?? 1;
		assert.notEqual(originalOpacity, 0.55);
		const sample = edit.samples[1];
		await at(sample.timelineTicks);
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="${prefix}-${index}"]`,
			)
			.click();
		await page
			.getByRole("button", { name: "Blending", exact: true })
			.last()
			.click();
		const input = page.getByRole("textbox", { name: "Opacity", exact: true });
		assert.equal(Number(await input.inputValue()), originalOpacity);
		await input.fill("0.55");
		await input.press("Tab");
		await poll(
			async () => (await readClip(index)).editing.params.opacity === 0.55,
		);
		const expected = structuredClone(original);
		expected.editing.params.opacity = 0.55;
		assert.deepEqual(
			await readClip(index),
			expected,
			"UI Opacity edits only outer clip params, never generator source opacity",
		);
		assert.deepEqual((await readClip(index)).editing.programmatic, edit.source);
		await page.keyboard.press("Escape");
		await at(sample.timelineTicks);
		const changed = await capture(
			page,
			artifacts,
			`${prefix}-ui-opacity-${index}`,
		);
		assert.notEqual(
			changed.sha256,
			sample.sha256,
			"The actual Opacity input must change visible pixels",
		);
		await history("history.undo", `${prefix}-ui-undo-${index}`);
		await poll(async () => isDeepStrictEqual(await readClip(index), original));
		await capture(
			page,
			artifacts,
			`${prefix}-ui-undone-${index}`,
			sample.sha256,
		);
		await history("history.redo", `${prefix}-ui-redo-${index}`);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await capture(
			page,
			artifacts,
			`${prefix}-ui-redone-${index}`,
			changed.sha256,
		);
		await history("history.undo", `${prefix}-ui-restore-${index}`);
		await poll(async () => isDeepStrictEqual(await readClip(index), original));
		await capture(
			page,
			artifacts,
			`${prefix}-ui-restored-${index}`,
			sample.sha256,
		);
		assert.deepEqual((await readClip(index)).editing.programmatic, edit.source);
		assert.deepEqual(
			byId(
				(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
			),
			untouched,
		);
		evidence[historyKey].push({
			index,
			tab: "Blending",
			field: "Opacity",
			value: 0.55,
			originalValue: originalOpacity,
			sourceUnchanged: true,
			completeClipRestored: true,
			sequence: ["UI input", "history.undo", "history.redo", "history.undo"],
			changed,
		});
		console.log(
			JSON.stringify({
				phase: `${prefix}-ui-opacity-history-verified`,
				index,
			}),
		);
	}
	evidence.checks.push({
		name: "real Blending/Opacity input plus attached-session undo/redo/restore preserves full generator sources and every other clip",
		pass: true,
	});
}
