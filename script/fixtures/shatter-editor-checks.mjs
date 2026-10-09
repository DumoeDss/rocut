import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import {
	createSweepScrollHistory,
	runSweepScrollOpacityHistory,
} from "./sweep-scroll-editor-history.mjs";
import { finishShatterEditor } from "./shatter-editor-export.mjs";

export async function runShatterEditor(
	page,
	artifacts,
	evidence,
	agentRequest,
) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.originalInputUnavailable && prepared.hostReopened);
	assert.deepEqual(prepared.templates, ["shatterImage"]);
	assert.equal(prepared.durationFrames, 120);
	assert.equal(prepared.shots.length, 2);
	evidence.shatterPrepared = prepared;
	evidence.authoringMode = {
		parameterUi: false,
		parameterEntry: "Host recipe replacement",
		recipeReversal:
			"revision-checked restore/reapply; Host apply is not local history",
		previewHistory:
			"actual Blending/Opacity input and attached-session undo/redo",
	};
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const readClip = async (index) =>
		(await agentRequest("clips")).find(
			(clip) => clip.id === `shatter-${index}`,
		);
	const at = (ticks) =>
		seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
	const history = createSweepScrollHistory(agentRequest);
	const replace = async (clip) =>
		agentRequest("apply", {
			expectedRevision: (await agentRequest("context")).revision,
			operations: [
				{
					kind: "update-clip",
					clipId: clip.id,
					patch: { editing: clip.editing },
				},
			],
		});
	const verifyUnrelated = async () => {
		assert.deepEqual(
			(await agentRequest("clips")).find(
				(clip) => clip.id === "shatter-unrelated",
			),
			prepared.unrelatedClip,
		);
		assert.deepEqual(
			(await agentRequest("tracks")).find(
				(track) => track.id === "shatter-unrelated-track",
			),
			prepared.unrelatedTrack,
		);
	};
	await verifyUnrelated();
	evidence.shatterEdits = [];
	for (const [index, [key, value]] of [
		["spread", 0.8],
		["refraction", 0.08],
	].entries()) {
		const original = await readClip(index);
		assert.deepEqual(
			original.editing.programmatic,
			prepared.shots[index].source,
		);
		assert.deepEqual(original.editing.effects, prepared.shots[index].effects);
		const scene = (clip) => clip.editing.programmatic.recipe.nodes.at(-1).scene;
		assert.equal(scene(original).kind, "shatter");
		assert.notEqual(scene(original).settings[key], value);
		const firstTicks = index * 240000 + 60000,
			secondTicks = index * 240000 + 120000;
		await at(firstTicks);
		const first = await capture(page, artifacts, `shatter-first-${index}`);
		await at(secondTicks);
		const before = await capture(page, artifacts, `shatter-before-${index}`);
		assert.notEqual(
			first.sha256,
			before.sha256,
			"Shatter source frames must change visible pixels",
		);
		await at(firstTicks);
		await capture(page, artifacts, `shatter-reverse-${index}`, first.sha256);
		const expected = structuredClone(original);
		scene(expected).settings[key] = value;
		const untouched = byId(
			(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
		);
		await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		const edited = await capture(page, artifacts, `shatter-edited-${index}-30`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${key} edit must change visible pixels`,
		);
		const status = await history(
			"history.status",
			`shatter-agent-history-${index}`,
		);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.count, 0);
		assert.equal(status.canUndo, false);
		await replace(original);
		await poll(async () => isDeepStrictEqual(await readClip(index), original));
		await at(secondTicks);
		await capture(page, artifacts, `shatter-restored-${index}`, before.sha256);
		await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		await capture(page, artifacts, `shatter-reapplied-${index}`, edited.sha256);
		assert.deepEqual(
			byId(
				(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
			),
			untouched,
		);
		await at(firstTicks);
		const editedFirst = await capture(
			page,
			artifacts,
			`shatter-edited-${index}-15`,
		);
		assert.notEqual(editedFirst.sha256, edited.sha256);
		evidence.shatterEdits.push({
			index,
			key,
			value,
			originalValue: scene(original).settings[key],
			historyAfterApply: status,
			source: expected.editing.programmatic,
			effects: expected.editing.effects,
			preserved: {
				seed: original.editing.programmatic.seed,
				resources: original.editing.programmatic.resources,
				span: scene(original).span,
				easing: scene(original).easing,
			},
			samples: [
				{
					...editedFirst,
					localTicks: 60000,
					timelineTicks: firstTicks,
					frame: firstTicks / 4000,
				},
				{
					...edited,
					localTicks: 120000,
					timelineTicks: secondTicks,
					frame: secondTicks / 4000,
				},
			],
		});
		console.log(
			JSON.stringify({ phase: "shatter-agent-reversal-verified", index }),
		);
	}
	evidence.checks.push({
		name: "two Creator Shatter sources: source seek, parameter replacement, full restore/reapply and unrelated clips preserved",
		pass: true,
	});
	await runSweepScrollOpacityHistory(page, artifacts, evidence, agentRequest, {
		prefix: "shatter",
		edits: evidence.shatterEdits,
		historyKey: "shatterUiHistory",
	});
	await verifyUnrelated();
	await finishShatterEditor(page, artifacts, evidence, agentRequest, prepared);
	await verifyUnrelated();
}
