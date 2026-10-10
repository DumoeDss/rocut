import assert from "node:assert/strict";
import { bubbleEditorContract as spec } from "./bubble-editor-contract.mjs";
import {
	poll, snapshot, seek, bubbleEditorSet as set,
	bubbleEditorInput as input, bubbleEditorParams as params,
	bubbleEditorClip as clip, bubbleEditorUndoRedo as undoRedo,
} from "./bubble-editor-control.mjs";
import { blazeEditorSaved } from "./blaze-editor-persistence.mjs";
import { beginBubbleEditorCommitObservation, finishBubbleEditorCommitObservation,
	isBubbleEditorCommitObservationComplete, assertBubbleEditorCommitCycle } from "./bubble-editor-observe.mjs";

export function assertBubbleEditorDuplicateRejection(body, wire) {
	assert.equal(body.accepted, false);
	assert(/Invalid Bubble trajectory: InvalidPointTime/.test(JSON.stringify(body)),
		"409 must identify native Bubble point-time validation");
	const hasDuplicate = (value) => value && typeof value === "object" &&
		((value.point0Time === 0 && value.point1Time === 0) || Object.values(value).some(hasDuplicate));
	assert(hasDuplicate(JSON.parse(wire)), "Rejected DOM request must contain duplicate point time");
}

export async function bubbleEditorCrossRetry({ page, request, root, evidence, id, start }) {
	const baseline = await clip(request, id);
	const fallback = params(baseline)[spec.opticalKey];
	const propertyPath = baseline.editing.type === "effect"
		? `params.${spec.opticalKey}`
		: `effects.${baseline.editing.effects[0].id}.params.${spec.opticalKey}`;
	assert(baseline.editing.animations[propertyPath].keys.some((key) => key.time === 0));
	const expected = structuredClone(baseline);
	const expectedParams = params(expected);
	expectedParams.point1Time = 160000;
	expectedParams.durationTicks = 360000;
	expected.editing.animations[propertyPath].keys.find((key) => key.time === 0).value = 0.09;
	const alert = page.getByRole("alert").filter({ hasText: "Effect was not saved." });
	const reject = async (label, value) => {
		const bytes = await blazeEditorSaved(root, request), before = await snapshot(request);
		const attempt = `${id}:${evidence.validatedRejections.length}:${label}`;
		const writesBefore = evidence.applyRequests.length;
		evidence.rejectionWindow = { id: attempt, clipId: id, field: label, value, duplicateTime: 0 };
		await beginBubbleEditorCommitObservation(page, label, attempt);
		await set(page, label, value);
		await alert.waitFor();
		await poll(() => isBubbleEditorCommitObservationComplete(page, attempt));
		const commitCycle = await finishBubbleEditorCommitObservation(page, attempt);
		assertBubbleEditorCommitCycle(commitCycle, attempt);
		assert.equal(await alert.textContent(),
			"Effect was not saved. Previous values restored; check your changes and try again. Unsaved inputs are shown below.");
		assert.deepEqual(await snapshot(request), before);
		assert.deepEqual(await blazeEditorSaved(root, request), bytes);
		assert.deepEqual(await clip(request, id), baseline);
		assert.equal(Number(await input(page, "point1Time").inputValue()), 0);
		assert.equal(Number(await input(page, "point0Time").inputValue()), 0);
		assert.equal(Number(await input(page, label).inputValue()), value, "Attempted field must remain visible");
		assert(await page.getByTitle(spec.keyframeTitle, { exact: true }).isDisabled());
		const responses = evidence.applyRejections.filter((item) => item.attempt === attempt);
		const nativeConsoleIndices = evidence.localPointErrors.filter((item) => item.attempt === attempt).map((item) => item.consoleIndex);
		const applyWrites = evidence.applyRequests.length - writesBefore;
		let body;
		if (responses.length) {
			assert.equal(responses.length, 1); assert.equal(applyWrites, 1);
			body = responses[0].body; assertBubbleEditorDuplicateRejection(body, responses[0].wire);
		} else { assert.equal(applyWrites, 0, "Local DOM commit rejection must not send an apply write"); }
		evidence.validatedRejections.push({ id, attempt, field: label, attemptedValue: value,
			cause: responses.length ? "native duplicate point time" : "duplicate-time draft rejected by actual UI commit",
			boundary: responses.length ? "http-native" : "local-dom-commit-rejection",
			body, nativeConsoleIndices, commitCycle, applyWrites, snapshotUnchanged: true, savedBytesUnchanged: true, draftVisible: true });
	};
	await seek(page, start);
	await reject("point1Time", 0);
	await reject(spec.opticalLabel, 0.09);
	for (const [ticks, value] of [[start + spec.keyTime, 0.15], [start, 0.09]]) {
		await seek(page, ticks);
		await poll(async () => Math.abs(Number(await input(page, spec.opticalLabel).inputValue()) - value) < 0.0001);
		assert.equal(Number(await input(page, "point1Time").inputValue()), 0);
		assert.deepEqual(await clip(request, id), baseline);
	}
	await reject(spec.activityLabel, 360000);
	assert.equal(Number(await input(page, spec.activityLabel).inputValue()), 360000);
	await set(page, "point1Time", 160000);
	await poll(async () => params(await clip(request, id)).point1Time === 160000);
	await alert.waitFor({ state: "hidden" });
	evidence.rejectionWindow = null;
	const after = await clip(request, id);
	assert.deepEqual(after, expected, "Complete params, animations and clip state must survive cross retry");
	assert.equal(params(after)[spec.opticalKey], fallback);
	await undoRedo({ page, request, before: baseline, after, evidence,
		label: `${id}: failed static/animated/static draft corrected atomically` });
	for (const [ticks, value] of [[start + spec.keyTime, 0.15], [start, 0.09]]) {
		await seek(page, ticks);
		await poll(async () => Math.abs(Number(await input(page, spec.opticalLabel).inputValue()) - value) < 0.0001);
	}
	evidence.domOperations.push({ label: `${id}: rejected draft cross retry and seek`,
		mechanism: "DOM point/optical/activity inputs, fresh completed DOM commit rejection or exact HTTP-native rejection, playhead and keyboard history",
		completeParamsAndAnimationsCompared: true, failedAttempts: 3 });
}

export async function bubbleEditorAuthorKeys({ page, request, id, start }) {
	await seek(page, start);
	const fallback = params(await clip(request, id))[spec.opticalKey];
	const button = page.getByTitle(spec.keyframeTitle, { exact: true });
	for (const [time, value] of [[0, 0.05], [spec.keyTime, 0.15]]) {
		await seek(page, start + time);
		await button.click();
		await poll(async () => (await button.getAttribute("aria-pressed")) === "true");
		await set(page, spec.opticalLabel, value);
		await poll(async () => {
			const valueClip = await clip(request, id);
			const path = valueClip.editing.type === "effect" ? `params.${spec.opticalKey}`
				: `effects.${valueClip.editing.effects[0].id}.params.${spec.opticalKey}`;
			return valueClip.editing.animations?.[path]?.keys?.some((key) => key.time === time && key.value === value);
		});
	}
	assert.equal(params(await clip(request, id))[spec.opticalKey], fallback);
}
