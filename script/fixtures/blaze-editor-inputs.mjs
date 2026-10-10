import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
	blazeEditorChanges,
	blazeEditorContract as contract,
} from "./blaze-editor-contract.mjs";
import {
	blazeEditorById,
	blazeEditorHistory,
	blazeEditorPoll,
	blazeEditorSeek,
	blazeEditorSnapshot,
} from "./blaze-editor-control.mjs";

export function blazeEditorExpectedEdit(clip, key, value) {
	assert(blazeEditorChanges.some((change) => change.key === key));
	assert(Number.isFinite(value));
	const expected = structuredClone(clip);
	const effect = expected.editing.effects.find(
		(item) => item.id === contract.effectId,
	);
	assert(effect?.type === "blaze" && effect.enabled);
	effect.params[key] = value;
	return expected;
}

export function blazeEditorUnchangedOthers(before, after, editedId) {
	assert.deepEqual(
		after.tracks,
		before.tracks,
		"UI parameter edit changed tracks",
	);
	assert.deepEqual(
		after.clips.filter((clip) => clip.id !== editedId),
		before.clips.filter((clip) => clip.id !== editedId),
		"UI parameter edit changed another clip or sentinel",
	);
}

export async function blazeEditorSelectEffects(page) {
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.staticId}"]`,
		)
		.click();
	await page
		.getByRole("button", { name: "Effects", exact: true })
		.last()
		.click();
}

export async function runBlazeEditorInputs({ page, request, evidence }) {
	const history = blazeEditorHistory(request);
	const clip = async () =>
		(await request("clips")).find((item) => item.id === contract.staticId);
	const record = await request("record");
	const metadata = ({ updatedAt, thumbnail, ...rest }) => rest;
	const preserved = {
		settings: record.record.data.settings,
		metadata: metadata(record.record.data.metadata),
		summary: metadata(record.summary),
	};
	evidence.uiHistory = [];
	for (const { key, label, value } of blazeEditorChanges) {
		const before = await blazeEditorSnapshot(request),
			original = await clip();
		await blazeEditorSeek(page, contract.finalTicks);
		await blazeEditorSelectEffects(page);
		const input = page
			.getByRole("textbox", { name: label, exact: true })
			.filter({ visible: true });
		assert.equal(await input.count(), 1, `Ambiguous visible ${label} input`);
		const originalUiValue = await input.inputValue();
		const expected = blazeEditorExpectedEdit(original, key, value);
		assert.notDeepEqual(expected, original);
		await input.fill(String(value));
		await input.press("Enter");
		await blazeEditorPoll(
			async () => (await page.locator("[data-focus-locked]").count()) === 0,
		);
		await blazeEditorPoll(async () =>
			isDeepStrictEqual(await clip(), expected),
		);
		assert.equal(Number(await input.inputValue()), value);
		const status = await history("history.status", `blaze-ui-status-${key}`);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.canUndo, true);
		await history("history.undo", `blaze-ui-undo-${key}`);
		await blazeEditorPoll(async () =>
			isDeepStrictEqual(await clip(), original),
		);
		await blazeEditorPoll(
			async () => (await input.inputValue()) === originalUiValue,
		);
		blazeEditorUnchangedOthers(
			before,
			await blazeEditorSnapshot(request),
			original.id,
		);
		await history("history.redo", `blaze-ui-redo-${key}`);
		await blazeEditorPoll(async () =>
			isDeepStrictEqual(await clip(), expected),
		);
		assert.equal(Number(await input.inputValue()), value);
		const after = await blazeEditorSnapshot(request);
		blazeEditorUnchangedOthers(before, after, original.id);
		const retained = await request("record");
		assert.deepEqual(
			{
				settings: retained.record.data.settings,
				metadata: metadata(retained.record.data.metadata),
				summary: metadata(retained.summary),
			},
			preserved,
		);
		evidence.uiHistory.push({
			key,
			label,
			value,
			originalUiValue,
			beforeRevision: before.revision,
			afterRevision: after.revision,
			completeClipRestoredByUndo: true,
			completeClipRestoredByRedo: true,
			otherClipsAndTracksUnchanged: true,
			inputMechanism: "visible textbox.fill + Enter",
			historyScope: status.scope,
		});
		console.log(
			JSON.stringify({ phase: "blaze-editor-parameter-verified", key }),
		);
	}
	assert.equal(evidence.uiHistory.length, 10);
	return blazeEditorById(await request("clips"));
}
