import assert from "node:assert/strict";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";

export async function editFusion(page, artifacts, evidence, agentRequest) {
	const readClip = async () =>
		(await agentRequest("clips")).find((clip) => clip.id === "fusion-0");
	const original = await readClip();
	const amountOf = (clip) =>
		clip.editing.effects.find((effect) => effect.type === "vhs").params.amount;
	const originalAmount = amountOf(original),
		changedAmount = 0.2;
	assert.notEqual(originalAmount, changedAmount);
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="fusion-0"]')
		.click();
	await page
		.getByRole("button", { name: "Effects", exact: true })
		.last()
		.click();
	const amount = page.getByRole("textbox", { name: "Amount", exact: true });
	await amount.fill(String(changedAmount));
	await amount.press("Tab");
	await poll(async () => amountOf(await readClip()) === changedAmount);
	await page.keyboard.press("Escape");
	await seek(page, 1);
	const modified = await capture(page, artifacts, "preview-retro-edited");
	assert.notEqual(
		modified.sha256,
		evidence.preview[0].sha256,
		"VHS edit must change actual pixels",
	);
	const history = async (kind, key) => {
		const context = await agentRequest("context");
		const started = await agentRequest("editor-tasks", {
			request: {
				kind,
				expectedRevision: context.revision,
				idempotencyKey: key,
			},
		});
		const job = await poll(async () => {
			const current = await agentRequest(`editor-tasks/${started.id}`);
			return current.status === "running" ? null : current;
		});
		assert.equal(job.status, "complete", JSON.stringify(job));
		return job.result;
	};
	assert.equal(
		(await history("history.status", "fusion-history-status")).canUndo,
		true,
	);
	await history("history.undo", "fusion-history-undo");
	await poll(async () => amountOf(await readClip()) === originalAmount);
	const undone = await capture(
		page,
		artifacts,
		"preview-retro-undone",
		evidence.preview[0].sha256,
	);
	assert.equal(undone.sha256, evidence.preview[0].sha256);
	await history("history.redo", "fusion-history-redo");
	await poll(async () => amountOf(await readClip()) === changedAmount);
	const redone = await capture(
		page,
		artifacts,
		"preview-retro-redone",
		modified.sha256,
	);
	assert.equal(redone.sha256, modified.sha256);
	await history("history.undo", "fusion-history-restore");
	await poll(async () => amountOf(await readClip()) === originalAmount);
	assert.deepEqual(
		(await readClip()).editing.programmatic,
		original.editing.programmatic,
	);
	evidence.checks.push({
		name: "UI VHS parameter edit and attached-session undo/redo restore actual pixels",
		pass: true,
	});
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	await seek(page, 1);
	const reopened = await capture(
		page,
		artifacts,
		"preview-retro-reopened",
		evidence.preview[0].sha256,
	);
	assert.equal(reopened.sha256, evidence.preview[0].sha256);
	assert.equal(amountOf(await readClip()), originalAmount);
	evidence.checks.push({
		name: "editor reload after editing preserves source, parameters and visible pixels",
		pass: true,
	});
	console.log(JSON.stringify({ phase: "editing-and-reload-verified" }));
}
