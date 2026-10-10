import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
	blazeEditorPoll as poll,
	blazeEditorSnapshot as snapshot,
	blazeEditorSeek as seek,
} from "./blaze-editor-control.mjs";
import { bubbleEditorContract as spec } from "./bubble-editor-contract.mjs";
export { poll, snapshot, seek };

export function bubbleEditorParams(clip) {
	return clip.editing.type === "effect"
		? clip.editing.params
		: clip.editing.effects.find((effect) => effect.type === "bubble").params;
}
export async function bubbleEditorSelect(page, clipId, standalone = false) {
	const clip = page.locator(
		`[data-testid="timeline-clip"][data-element-id="${clipId}"]`,
	);
	await clip.scrollIntoViewIfNeeded();
	await clip.click();
	if (!standalone)
		await page
			.getByRole("button", { name: "Effects", exact: true })
			.last()
			.click();
	await page
		.getByRole("heading", { name: "Trajectory", exact: true })
		.waitFor();
}
export function bubbleEditorInput(page, label) {
	return page
		.getByRole("textbox", { name: label, exact: true })
		.filter({ visible: true });
}
export async function bubbleEditorSet(page, label, value) {
	const input = bubbleEditorInput(page, label);
	assert.equal(await input.count(), 1, `Ambiguous input: ${label}`);
	await input.fill(String(value));
	await input.press("Enter");
	await poll(
		async () => (await page.locator("[data-focus-locked]").count()) === 0,
	);
}
export async function bubbleEditorClip(request, id = spec.clipId) {
	return (await request("clips")).find((clip) => clip.id === id);
}
export async function bubbleEditorWaitClip(request, expected) {
	await poll(async () =>
		isDeepStrictEqual(await bubbleEditorClip(request, expected.id), expected),
	);
}
export async function bubbleEditorUndoRedo({
	page,
	request,
	before,
	after,
	evidence,
	label,
}) {
	// Move focus from the native number input so Ctrl+Z reaches actual editor history.
	await page.getByRole("heading", { name: "Trajectory", exact: true }).click();
	await page.keyboard.press("Control+z");
	await bubbleEditorWaitClip(request, before);
	await page.keyboard.press("Control+Shift+z");
	await bubbleEditorWaitClip(request, after);
	evidence.domOperations.push({
		label,
		mechanism: "actual editor keyboard Control+z / Control+Shift+z",
		completeClipRestored: true,
	});
}
