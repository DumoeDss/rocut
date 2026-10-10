import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bubbleEditorContract as spec } from "./bubble-editor-contract.mjs";
import {
	poll,
	snapshot,
	seek,
	bubbleEditorSelect as select,
	bubbleEditorInput as input,
	bubbleEditorSet as set,
	bubbleEditorParams as params,
	bubbleEditorClip as clip,
	bubbleEditorUndoRedo as undoRedo,
} from "./bubble-editor-control.mjs";
import { blazeEditorSaved } from "./blaze-editor-persistence.mjs";
import { bubbleEditorCrossRetry, bubbleEditorAuthorKeys } from "./bubble-editor-cross-retry.mjs";
import { blazeEditorScreenshot as screenshot } from "./blaze-editor-control.mjs";
import {
	bubbleExportSave as save,
	bubbleExportHash as hash,
} from "./bubble-export-preflight.mjs";

export async function runBubbleEditorChecks({ page, request, root, evidence }) {
	const prepared = JSON.parse(
		await readFile(join(root, "prepared.json"), "utf8"),
	);
	assert(prepared.authorUnavailable);
	assert.deepEqual(await snapshot(request), prepared.snapshot);
	await blazeEditorSaved(root, request);
	evidence.domOperations = [];
	evidence.screenshots = [];
	evidence.validatedRejections = [];
	const assertOthers = async (before, id) => {
		const after = await snapshot(request);
		assert.deepEqual(after.tracks, before.tracks);
		assert.deepEqual(
			after.clips.filter((item) => item.id !== id),
			before.clips.filter((item) => item.id !== id),
		);
	};
	await seek(page, spec.start);
	await select(page, spec.clipId);
	assert.equal(await input(page, "point1Time").count(), 0);
	assert.equal(
		await page
			.getByRole("button", { name: "Remove point", exact: true })
			.first()
			.isDisabled(),
		true,
	);
	const beforeAdd = await clip(request),
		beforeOthers = await snapshot(request);
	await page.getByRole("button", { name: "Add point", exact: true }).click();
	await poll(async () => params(await clip(request)).pointCount === 2);
	const afterAdd = await clip(request);
	assert(await page.getByRole("button", { name: "Remove point", exact: true }).first().isDisabled(),
		"First point must stay locked with two points");
	for (const key of ["point1Time", "point1X", "point1Y"])
		assert(Object.hasOwn(params(afterAdd), key));
	await undoRedo({
		page,
		request,
		before: beforeAdd,
		after: afterAdd,
		evidence,
		label: "Add complete trajectory point",
	});
	await assertOthers(beforeOthers, spec.clipId);
	await page
		.getByRole("button", { name: "Remove point", exact: true })
		.last()
		.click();
	await poll(async () => params(await clip(request)).pointCount === 1);
	const afterRemove = await clip(request);
	assert.equal(Object.hasOwn(params(afterRemove), "point1Time"), false);
	await undoRedo({
		page,
		request,
		before: afterAdd,
		after: afterRemove,
		evidence,
		label: "Remove complete trajectory point",
	});
	await page.getByRole("button", { name: "Add point", exact: true }).click();
	await poll(async () => params(await clip(request)).pointCount === 2);
	await set(page, spec.pointTimeLabel, 120000);
	await poll(async () => params(await clip(request)).point1Time === 120000);
	const beforeMiddleAdd = await clip(request);
	await page.getByRole("button", { name: "Add point", exact: true }).click();
	await poll(async () => params(await clip(request)).pointCount === 3);
	const three = await clip(request);
	await page.getByRole("button", { name: "Remove point", exact: true }).nth(1).click();
	await poll(async () => params(await clip(request)).pointCount === 2);
	const compacted = await clip(request), expectedCompacted = structuredClone(three);
	params(expectedCompacted).pointCount = 2;
	for (const axis of ["Time", "X", "Y"]) {
		params(expectedCompacted)[`point1${axis}`] = params(three)[`point2${axis}`];
		delete params(expectedCompacted)[`point2${axis}`];
	}
	assert.deepEqual(compacted, expectedCompacted);
	await undoRedo({ page, request, before: three, after: compacted, evidence, label: "Remove interior point compacts complete slots" });
	assert.equal(params(beforeMiddleAdd).point0Time, params(compacted).point0Time);
	evidence.screenshots.push(await screenshot(page, root, "points-authored"));
	const savedFallback = params(await clip(request))[spec.opticalKey];
	const keyButton = page.getByTitle(spec.keyframeTitle, { exact: true });
	await keyButton.click();
	await poll(
		async () => (await keyButton.getAttribute("aria-pressed")) === "true",
	);
	await set(page, spec.opticalLabel, 0.05);
	await seek(page, spec.start + spec.keyTime);
	await keyButton.click();
	await poll(
		async () => (await keyButton.getAttribute("aria-pressed")) === "true",
	);
	await set(page, spec.opticalLabel, 0.15);
	await poll(async () => {
		const value = await clip(request),
			effectId = value.editing.effects[0].id;
		const channel =
			value.editing.animations?.[
				`effects.${effectId}.params.${spec.opticalKey}`
			];
		return (
			channel?.keys?.some((key) => key.time === 0 && key.value === 0.05) &&
			channel.keys.some(
				(key) => key.time === spec.keyTime && key.value === 0.15,
			)
		);
	});
	assert.equal(params(await clip(request))[spec.opticalKey], savedFallback);
	for (const [ticks, expected] of [
		[spec.start, 0.05],
		[spec.start + spec.keyTime, 0.15],
		[spec.start, 0.05],
	]) {
		await seek(page, ticks);
		await poll(
			async () =>
				Math.abs(
					Number(await input(page, spec.opticalLabel).inputValue()) - expected,
				) < 0.0001,
		);
	}
	evidence.domOperations.push({
		label: "Optical keys and current values",
		mechanism: "actual keyframe button + input + clip-local playhead input",
		values: [0.05, 0.15],
		staticFallbackRetained: true,
	});
	await bubbleEditorCrossRetry({ page, request, root, evidence, id: spec.clipId, start: spec.start });
	await select(page, spec.disabledId);
	await seek(page, 504000);
	assert.equal(
		(await clip(request, spec.disabledId)).editing.effects[0].enabled,
		false,
	);
	assert.equal(
		await page
			.getByRole("button", { name: "Toggle Bubble", exact: true })
			.count(),
		1,
	);
	assert.equal(await input(page, "point0Time").count(), 1);
	await set(page, "point0X", 0.6);
	await poll(
		async () => params(await clip(request, spec.disabledId)).point0X === 0.6,
	);
	assert.equal(
		(await clip(request, spec.disabledId)).editing.effects[0].enabled,
		false,
	);
	evidence.domOperations.push({
		label: "Disabled Bubble entry and parameter edit",
		mechanism: "actual selected clip and point input",
		enabledRetained: false,
	});
	await page.getByRole("button", { name: "Add point", exact: true }).click();
	await poll(async () => params(await clip(request, spec.disabledId)).pointCount === 2);
	assert(await page.getByRole("button", { name: "Remove point", exact: true }).first().isDisabled());
	await set(page, "point1Time", 120000);
	await poll(async () => params(await clip(request, spec.disabledId)).point1Time === 120000);
	await bubbleEditorAuthorKeys({ page, request, id: spec.disabledId, start: 504000 });
	await bubbleEditorCrossRetry({ page, request, root, evidence, id: spec.disabledId, start: 504000 });
	assert.equal((await clip(request, spec.disabledId)).editing.effects[0].enabled, false);
	await select(page, spec.standaloneId, true);
	await seek(page, 996000);
	assert.equal(await input(page, "point0Time").count(), 1);
	assert.equal(
		await page.getByTitle(spec.keyframeTitle, { exact: true }).count(),
		1,
	);
	await page.getByRole("button", { name: "Add point", exact: true }).click();
	await poll(
		async () => params(await clip(request, spec.standaloneId)).pointCount === 2,
	);
	assert.equal((await clip(request, spec.standaloneId)).editing.type, "effect");
	assert(await page.getByRole("button", { name: "Remove point", exact: true }).first().isDisabled());
	await set(page, "point1Time", 120000);
	await poll(async () => params(await clip(request, spec.standaloneId)).point1Time === 120000);
	await bubbleEditorAuthorKeys({ page, request, id: spec.standaloneId, start: 996000 });
	await bubbleEditorCrossRetry({ page, request, root, evidence, id: spec.standaloneId, start: 996000 });
	evidence.domOperations.push({
		label: "Standalone Bubble entry and Add point",
		mechanism: "actual standalone timeline selection and point button",
	});
	await seek(page, spec.start);
	await select(page, spec.clipId);
	const expected = await snapshot(request),
		bytes = await blazeEditorSaved(root, request);
	await page.reload({ waitUntil: "commit" });
	await page
		.locator(`[data-testid="timeline-clip"][data-element-id="${spec.clipId}"]`)
		.waitFor({ timeout: 120000 });
	await poll(async () => (await request("export")).surfaces === 1);
	assert.deepEqual(await snapshot(request), expected);
	assert.deepEqual(await blazeEditorSaved(root, request), bytes);
	await select(page, spec.clipId);
	assert.equal(
		Number(await input(page, spec.pointTimeLabel).inputValue()),
		160000,
	);
	const finalBytes = await blazeEditorSaved(root, request);
	assert.deepEqual(finalBytes, bytes);
	await save(root, "project-final-ui.json", finalBytes);
	await save(root, "expected-edited.json", expected);
	evidence.reload = {
		snapshotUnchanged: true,
		byteIdentical: true,
		sha256: hash(bytes),
	};
	evidence.screenshots.push(await screenshot(page, root, "final-after-reload"));
	assert(isDeepStrictEqual(await snapshot(request), expected));
}
