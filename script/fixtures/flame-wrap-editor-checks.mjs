import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
	history,
	poll,
	snapshot,
	effectFor,
	finiteField,
	finiteInput,
	unchangedNeighbors,
	seek,
	capture,
	settledRecord,
	digest,
	validateArtifacts,
	writeArtifact,
} from "./flame-wrap-editor-controls.mjs";

const changes = [
	{ key: "amount", label: "Amount", value: 0.75 },
	{ key: "boundaryWidth", label: "Boundary width (pixels)", value: 8.125 },
	{ key: "flameHeight", label: "Flame height (pixels)", value: 24.375 },
	{ key: "flameOpacity", label: "Flame opacity", value: 0.8125 },
	{ key: "sparkOpacity", label: "Spark opacity", value: 0.625 },
	{ key: "refraction", label: "Heat refraction (pixels)", value: 0 },
	{ key: "speed", label: "Cycles per second", value: 0 },
	{ key: "wind", label: "Rise drift", value: -0.375 },
	{ key: "seed", label: "Seed", value: 41 },
];

export async function runFlameWrapEditorChecks({ page, request, artifacts }) {
	validateArtifacts(artifacts);
	const evidence = {
		ok: false,
		scope:
			"Actual production editor textboxes, attached-session history tasks, real Host graph/record and full presentation canvas pixels. Not raw native pixels or UI-created animation channels.",
		uiHistory: [],
		seeks: [],
		frames: [],
		failure: null,
	};
	const expectedFrames = [];
	let finalEditing;
	try {
		const initial = await snapshot(request),
			{ clip } = effectFor(initial, artifacts);
		const frameRate = initial.project.frameRate;
		assert(
			frameRate &&
				frameRate.denominator === 1 &&
				Number.isSafeInteger(frameRate.numerator),
		);
		assert.equal(clip.startTime, 0);
		assert(clip.duration >= 100000);
		for (const { key } of changes)
			finiteField(effectFor(initial, artifacts).effect.params, key);
		const finalTicks = artifacts.finalTicks ?? 40000;
		const callHistory = history(request);
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
		await seek(page, finalTicks, frameRate);
		await select();
		const toggles = page
			.locator('button[title^="Toggle"][title$="keyframe"]')
			.filter({ visible: true });
		assert.equal(
			await toggles.count(),
			7,
			"Expected exactly seven animatable effect toggles",
		);
		for (const title of [
			"Toggle cycles per second keyframe",
			"Toggle seed keyframe",
		])
			assert.equal(await page.locator(`button[title="${title}"]`).count(), 0);
		const edit = async (change, phase) => {
			const before = await snapshot(request),
				original = effectFor(before, artifacts).clip;
			const originalValue = finiteField(
				effectFor(before, artifacts).effect.params,
				change.key,
			);
			assert.notEqual(
				originalValue,
				change.value,
				`${change.key} fixture would be a no-op`,
			);
			await select();
			const input = page
				.getByRole("textbox", { name: change.label, exact: true })
				.filter({ visible: true });
			assert.equal(await input.count(), 1, `Missing/ambiguous ${change.label}`);
			const originalText = await input.inputValue();
			assert.equal(finiteInput(originalText, change.label), originalValue);
			const expected = structuredClone(original);
			expected.editing.effects.find(
				(effect) => effect.id === artifacts.effectId,
			).params[change.key] = change.value;
			await input.fill(String(change.value));
			await input.press("Enter");
			await poll(
				async () => (await page.locator("[data-focus-locked]").count()) === 0,
			);
			await poll(async () =>
				isDeepStrictEqual(
					effectFor(await snapshot(request), artifacts).clip,
					expected,
				),
			);
			assert.equal(
				finiteInput(await input.inputValue(), change.label),
				change.value,
			);
			const committed = await snapshot(request);
			assert(committed.revision > before.revision);
			finiteField(effectFor(committed, artifacts).effect.params, change.key);
			unchangedNeighbors(before, committed, artifacts.clipId);
			const status = await callHistory(
				"history.status",
				`flame-wrap-ui-status-${phase}-${change.key}`,
			);
			assert.equal(status.scope, "attached-session");
			assert.equal(status.canUndo, true);
			await callHistory(
				"history.undo",
				`flame-wrap-ui-undo-${phase}-${change.key}`,
			);
			await poll(async () =>
				isDeepStrictEqual(
					effectFor(await snapshot(request), artifacts).clip,
					original,
				),
			);
			await poll(async () => (await input.inputValue()) === originalText);
			unchangedNeighbors(before, await snapshot(request), artifacts.clipId);
			await callHistory(
				"history.redo",
				`flame-wrap-ui-redo-${phase}-${change.key}`,
			);
			await poll(async () =>
				isDeepStrictEqual(
					effectFor(await snapshot(request), artifacts).clip,
					expected,
				),
			);
			const after = await snapshot(request);
			assert.equal(
				finiteField(effectFor(after, artifacts).effect.params, change.key),
				change.value,
			);
			assert.equal(
				finiteInput(await input.inputValue(), change.label),
				change.value,
			);
			unchangedNeighbors(before, after, artifacts.clipId);
			evidence.uiHistory.push({
				...change,
				phase,
				originalValue,
				beforeRevision: before.revision,
				committedRevision: committed.revision,
				afterRevision: after.revision,
				mechanism: "visible production textbox fill + Enter",
				historyScope: status.scope,
				completeClipUndoRedo: true,
				otherClipsTracksProjectUnchanged: true,
			});
		};
		for (const change of changes) await edit(change, "nine-controls");
		await edit(
			{ key: "speed", label: "Cycles per second", value: 0.75 },
			"restore-motion-after-zero",
		);
		const graph = await snapshot(request);
		finalEditing = effectFor(graph, artifacts).clip.editing;
		const seekAndCapture = async (
			ticks,
			label,
			captureArtifacts = artifacts,
			role = "effect",
		) => {
			evidence.seeks.push(await seek(page, ticks, frameRate));
			const afterSeek = await snapshot(request);
			assert.deepEqual(
				afterSeek,
				graph,
				"Seeking changed complete authored graph/revision",
			);
			const observed = {
				...(await capture(
					page,
					captureArtifacts,
					ticks,
					graph.revision,
					label,
				)),
				role,
			};
			expectedFrames.push(observed);
			evidence.frames.push({ ...observed, rgbaBase64: undefined });
			return observed;
		};
		const early = await seekAndCapture(20000, "early"),
			late = await seekAndCapture(80000, "late");
		assert.notEqual(
			early.sha256,
			late.sha256,
			"Flame motion produced no observable presentation activity",
		);
		const back = await seekAndCapture(20000, "reverse-early");
		assert.equal(
			back.sha256,
			early.sha256,
			"Reverse seek did not restore exact presentation bytes",
		);
		const disabled = graph.clips.find((item) => item.id === "flame-disabled");
		assert(disabled?.editing && Array.isArray(disabled.editing.effects));
		const disabledEffect = disabled.editing.effects.find(
			(item) => item.id === artifacts.effectId,
		);
		assert.equal(disabledEffect?.type, "flame-wrap");
		assert.equal(disabledEffect.enabled, false);
		await seekAndCapture(
			260000,
			"disabled-baseline",
			{ ...artifacts, clipId: disabled.id },
			"baseline",
		);
		const final = await seekAndCapture(finalTicks, "before-reload");
		const baseline = await settledRecord(artifacts, request);
		await writeArtifact(
			artifacts,
			"flame-wrap-editor-before-reload.json",
			baseline,
		);
		evidence.recordBeforeReloadSha256 = digest(baseline);
		await page.reload({ waitUntil: "commit" });
		await page
			.getByRole("button", { name: "Edit playhead time", exact: true })
			.waitFor({ timeout: 30000 });
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="${artifacts.clipId}"]`,
			)
			.waitFor({ timeout: 30000 });
		await poll(async () => (await request("export")).surfaces === 1);
		// PlaybackManager's playhead is session state, not authored project data.
		// Re-seek through the real UI; reload must retain the graph, not the cursor.
		evidence.reloadSeek = await seek(page, finalTicks, frameRate);
		assert.deepEqual(
			await snapshot(request),
			graph,
			"Reload changed authored graph/revision",
		);
		const reopenedBytes = await settledRecord(artifacts, request);
		assert(
			reopenedBytes.equals(baseline),
			"Read-only reload changed complete persisted project bytes",
		);
		const reloaded = await capture(
			page,
			artifacts,
			finalTicks,
			graph.revision,
			"after-reload",
		);
		assert.equal(
			reloaded.sha256,
			final.sha256,
			"Same-project reload changed presentation pixels after explicit UI re-seek",
		);
		expectedFrames.push(reloaded);
		evidence.frames.push({ ...reloaded, rgbaBase64: undefined });
		evidence.reload = {
			completeGraphUnchanged: true,
			completeProjectBytesIdentical: true,
			pixelsIdentical: true,
			playheadAutomaticallyRetained: false,
			comparison: "same saved project after explicit UI re-seek",
			sha256: digest(reopenedBytes),
		};
		await writeArtifact(
			artifacts,
			"flame-wrap-editor-final-expected.json",
			graph,
		);
		await writeArtifact(
			artifacts,
			"flame-wrap-editor-expected-frames.json",
			expectedFrames,
		);
		evidence.finalExpectedFile = "flame-wrap-editor-final-expected.json";
		evidence.animationChannelsCreatedByUI = false;
		evidence.ok = true;
	} catch (error) {
		if (error.captureObservation)
			evidence.captureFailure = error.captureObservation;
		evidence.failure = error?.stack ?? String(error);
		throw error;
	} finally {
		await writeArtifact(artifacts, "flame-wrap-editor-evidence.json", evidence);
	}
	return { evidence, expectedFrames, finalEditing };
}
