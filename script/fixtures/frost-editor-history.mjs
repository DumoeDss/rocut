import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
	snapshot,
	poll,
	history,
	finiteField,
	finiteInput,
} from "./flame-wrap-editor-controls.mjs";
import {
	frostEffect,
	editedFrostClip,
	assertFrostTransition,
	frostChanges,
} from "./frost-editor-state.mjs";

export async function editFrostWithHistory({
	page,
	request,
	artifacts,
	catalog,
}) {
	const callHistory = history(request),
		observations = [];
	const select = async () => {
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="${artifacts.clipId}"]`,
			)
			.click();
		await page
			.getByRole("button", { name: "Effects", exact: true })
			.last()
			.click();
	};
	for (const { key, value } of frostChanges) {
		const definition = catalog.find((field) => field.key === key);
		assert(
			definition && typeof definition.label === "string",
			`Missing catalog ${key}`,
		);
		const before = await snapshot(request),
			original = frostEffect(before, artifacts).clip;
		const oldValue = finiteField(
			frostEffect(before, artifacts).effect.params,
			key,
		);
		assert.notEqual(oldValue, value, `No-op fixture edit ${key}`);
		const expected = editedFrostClip(original, artifacts.effectId, key, value);
		await select();
		const input = page
			.getByRole("textbox", { name: definition.label, exact: true })
			.filter({ visible: true });
		assert.equal(await input.count(), 1, `Missing/ambiguous ${key} input`);
		const originalText = await input.inputValue();
		assert.equal(finiteInput(originalText, key), oldValue);
		await input.fill(String(value));
		await input.press("Enter");
		await poll(async () =>
			isDeepStrictEqual(
				frostEffect(await snapshot(request), artifacts).clip,
				expected,
			),
		);
		const committed = await snapshot(request);
		assertFrostTransition(before, committed, expected);
		assert.equal(finiteInput(await input.inputValue(), key), value);
		const status = await callHistory(
			"history.status",
			`frost-ui-status-${key}`,
		);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.canUndo, true);
		await callHistory("history.undo", `frost-ui-undo-${key}`);
		await poll(async () =>
			isDeepStrictEqual(
				frostEffect(await snapshot(request), artifacts).clip,
				original,
			),
		);
		await poll(async () => (await input.inputValue()) === originalText);
		const undone = await snapshot(request);
		assertFrostTransition(committed, undone, original);
		await callHistory("history.redo", `frost-ui-redo-${key}`);
		await poll(async () =>
			isDeepStrictEqual(
				frostEffect(await snapshot(request), artifacts).clip,
				expected,
			),
		);
		await poll(
			async () => finiteInput(await input.inputValue(), key) === value,
		);
		const redone = await snapshot(request);
		assertFrostTransition(undone, redone, expected);
		observations.push({
			key,
			value,
			originalValue: oldValue,
			beforeRevision: before.revision,
			committedRevision: committed.revision,
			undoneRevision: undone.revision,
			afterRevision: redone.revision,
			completeClipUndoRedo: true,
			otherClipsTracksProjectUnchanged: true,
			historyScope: status.scope,
		});
	}
	return observations;
}
