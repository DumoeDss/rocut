import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import {
	createSweepScrollHistory,
	runSweepScrollOpacityHistory,
} from "./sweep-scroll-editor-history.mjs";
import { finishClothEditor } from "./cloth-editor-export.mjs";

export async function runClothEditor(page, artifacts, evidence, agentRequest) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.originalInputUnavailable && prepared.hostReopened);
	assert.deepEqual(prepared.templates, ["clothImage"]);
	assert.equal(prepared.durationFrames, 120);
	assert.equal(prepared.shots.length, 2);
	evidence.clothPrepared = prepared;
	evidence.authoringMode = {
		parameterUi: false,
		parameterEntry: "Host full source replacement",
		recipeReversal:
			"revision-checked restore/reapply; Host apply is not local history",
		previewHistory:
			"actual Blending/Opacity input and attached-session undo/redo",
	};
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const readClip = async (index) =>
		(await agentRequest("clips")).find((clip) => clip.id === `cloth-${index}`);
	const at = (ticks) =>
		seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
	const history = createSweepScrollHistory(agentRequest);
	const replace = async (clip) => {
		const before = (await agentRequest("context")).revision;
		await agentRequest("apply", {
			expectedRevision: before,
			operations: [
				{
					kind: "update-clip",
					clipId: clip.id,
					patch: { editing: clip.editing },
				},
			],
		});
		const after = (await agentRequest("context")).revision;
		assert.notEqual(
			after,
			before,
			"A source replacement must advance the Host revision",
		);
		return { before, after };
	};
	const verifyUnrelated = async () => {
		assert.deepEqual(
			(await agentRequest("clips")).find(
				(clip) => clip.id === "cloth-unrelated",
			),
			prepared.unrelatedClip,
		);
		assert.deepEqual(byId(await agentRequest("tracks")), prepared.tracks);
	};
	await verifyUnrelated();
	const changes = [
		{
			parameters: ["wind[2]"],
			read: (settings) => ({ wind: settings.wind }),
			write: (settings) => {
				settings.wind[2] = 3.2;
			},
		},
		{
			parameters: ["events[0].radius", "events[0].velocity"],
			read: (settings) => settings.events[0],
			write: (settings) => {
				settings.events[0].radius = 0.65;
				settings.events[0].velocity = [0.25, -0.25, 2.4];
			},
		},
	];
	evidence.clothEdits = [];
	for (const [index, change] of changes.entries()) {
		const original = await readClip(index);
		assert.deepEqual(
			original.editing.programmatic,
			prepared.shots[index].source,
		);
		assert.deepEqual(original.editing.effects, prepared.shots[index].effects);
		const scene = (clip) => clip.editing.programmatic.recipe.nodes.at(-1).scene;
		assert.equal(scene(original).kind, "cloth");
		assert.equal(
			scene(original).settings.pins,
			index === 0 ? "topEdge" : "leftEdge",
		);
		assert.equal("easing" in scene(original), false);
		const firstTicks = index * 240000 + 60000;
		const secondTicks = index * 240000 + 120000;
		await at(firstTicks);
		const first = await capture(page, artifacts, `cloth-first-${index}`);
		await at(secondTicks);
		const before = await capture(page, artifacts, `cloth-before-${index}`);
		assert.notEqual(
			first.sha256,
			before.sha256,
			"Cloth source frames must change visible pixels",
		);
		await at(firstTicks);
		await capture(page, artifacts, `cloth-reverse-${index}`, first.sha256);
		const expected = structuredClone(original);
		change.write(scene(expected).settings);
		assert.notDeepEqual(
			change.read(scene(original).settings),
			change.read(scene(expected).settings),
		);
		const untouched = byId(
			(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
		);
		const editedRevision = await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		const edited = await capture(page, artifacts, `cloth-edited-${index}-30`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${change.parameters.join(", ")} edit must change visible pixels`,
		);
		const status = await history(
			"history.status",
			`cloth-agent-history-${index}`,
		);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.count, 0);
		assert.equal(status.canUndo, false);
		const restoredRevision = await replace(original);
		await poll(async () => isDeepStrictEqual(await readClip(index), original));
		await at(secondTicks);
		await capture(page, artifacts, `cloth-restored-${index}`, before.sha256);
		const reappliedRevision = await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		await capture(page, artifacts, `cloth-reapplied-${index}`, edited.sha256);
		assert.deepEqual(
			byId(
				(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
			),
			untouched,
		);
		await verifyUnrelated();
		await at(firstTicks);
		const editedFirst = await capture(
			page,
			artifacts,
			`cloth-edited-${index}-15`,
		);
		assert.notEqual(editedFirst.sha256, edited.sha256);
		evidence.clothEdits.push({
			index,
			parameters: change.parameters,
			originalValue: change.read(scene(original).settings),
			value: change.read(scene(expected).settings),
			revisions: {
				edited: editedRevision,
				restored: restoredRevision,
				reapplied: reappliedRevision,
			},
			historyAfterApply: status,
			source: expected.editing.programmatic,
			effects: expected.editing.effects,
			preserved: {
				seed: original.editing.programmatic.seed,
				resources: original.editing.programmatic.resources,
				span: scene(original).span,
				pins: scene(original).settings.pins,
				grid: [scene(original).settings.columns, scene(original).settings.rows],
				eventClock: scene(original).settings.events.map(
					({ atTicks, center }) => ({ atTicks, center }),
				),
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
			JSON.stringify({ phase: "cloth-agent-reversal-verified", index }),
		);
	}
	evidence.checks.push({
		name: "two Creator Cloth sources: fixed-step seek, wind/impulse source replacement, revision restore/reapply, all unrelated clips and tracks preserved",
		pass: true,
	});
	await runSweepScrollOpacityHistory(page, artifacts, evidence, agentRequest, {
		prefix: "cloth",
		edits: evidence.clothEdits,
		historyKey: "clothUiHistory",
	});
	await verifyUnrelated();
	await finishClothEditor(page, artifacts, evidence, agentRequest, prepared);
	await verifyUnrelated();
}
