import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import { decodeSweepScrollEditor } from "./sweep-scroll-editor-decode.mjs";
import {
	createSweepScrollHistory,
	runSweepScrollOpacityHistory,
} from "./sweep-scroll-editor-history.mjs";

export async function runMeshScenesEditor(
	page,
	artifacts,
	evidence,
	agentRequest,
) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.originalInputUnavailable && prepared.hostReopened);
	assert.deepEqual(prepared.templates, [
		"gridImage",
		"hexFloatImage",
		"bendTransition",
	]);
	evidence.meshPrepared = prepared;
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
		(await agentRequest("clips")).find((c) => c.id === `mesh-scenes-${index}`);
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
	evidence.meshEdits = [];
	for (const [index, [key, value]] of [
		["lift", 0.6],
		["tilt", 0.9],
		["hinge", 0.25],
	].entries()) {
		const original = await readClip(index);
		assert.deepEqual(
			original.editing.programmatic,
			prepared.shots[index].source,
		);
		const scene = (clip) => clip.editing.programmatic.recipe.nodes.at(-1).scene;
		const controls = (clip) =>
			index === 2 ? scene(clip).style : scene(clip).settings;
		assert.notEqual(controls(original)[key], value);
		const firstTicks = index * 240000 + 60000,
			secondTicks = index * 240000 + 120000;
		await at(firstTicks);
		const first = await capture(page, artifacts, `mesh-first-${index}`);
		await at(secondTicks);
		const before = await capture(page, artifacts, `mesh-before-${index}`);
		assert.notEqual(
			first.sha256,
			before.sha256,
			"Mesh source frames must change visible pixels",
		);
		await at(firstTicks);
		await capture(page, artifacts, `mesh-reverse-${index}`, first.sha256);
		const expected = structuredClone(original);
		controls(expected)[key] = value;
		const untouched = byId(
			(await agentRequest("clips")).filter((c) => c.id !== original.id),
		);
		await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		const edited = await capture(page, artifacts, `mesh-edited-${index}-30`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${key} edit must change visible pixels`,
		);
		const status = await history(
			"history.status",
			`mesh-agent-history-${index}`,
		);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.count, 0);
		assert.equal(status.canUndo, false);
		await replace(original);
		await poll(async () => isDeepStrictEqual(await readClip(index), original));
		await at(secondTicks);
		await capture(page, artifacts, `mesh-restored-${index}`, before.sha256);
		await replace(expected);
		await poll(async () => isDeepStrictEqual(await readClip(index), expected));
		await at(secondTicks);
		await capture(page, artifacts, `mesh-reapplied-${index}`, edited.sha256);
		assert.deepEqual(
			byId((await agentRequest("clips")).filter((c) => c.id !== original.id)),
			untouched,
		);
		await at(firstTicks);
		const editedFirst = await capture(
			page,
			artifacts,
			`mesh-edited-${index}-15`,
		);
		assert.notEqual(editedFirst.sha256, edited.sha256);
		evidence.meshEdits.push({
			index,
			key,
			value,
			originalValue: controls(original)[key],
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
			JSON.stringify({ phase: "mesh-agent-reversal-verified", index }),
		);
	}
	evidence.checks.push({
		name: "three Creator meshes: source seek, parameter replacement, full inverse restore/reapply and unrelated clips preserved",
		pass: true,
	});
	await runSweepScrollOpacityHistory(page, artifacts, evidence, agentRequest, {
		prefix: "mesh-scenes",
		edits: evidence.meshEdits,
		historyKey: "meshUiHistory",
	});
	const clips = byId(await agentRequest("clips"));
	const saved = await poll(async () => {
		const disk = JSON.parse(
			await readFile(join(artifacts, "project/project.json"), "utf8"),
		);
		return isDeepStrictEqual(disk.record, (await agentRequest("record")).record)
			? disk
			: null;
	});
	assert.equal(saved.wrapperVersion, 1);
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	for (const edit of evidence.meshEdits)
		for (const sample of edit.samples) {
			await at(sample.timelineTicks);
			await capture(
				page,
				artifacts,
				`mesh-reopened-${edit.index}-${sample.localTicks}`,
				sample.sha256,
			);
		}
	assert.deepEqual(byId(await agentRequest("clips")), clips);
	const context = await agentRequest("context"),
		tracks = await agentRequest("tracks");
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(
			{
				revision: context.revision,
				clips,
				tracks: byId(tracks),
				authoredTrackIds: tracks
					.filter((t) => t.id === "mesh-scenes-shots")
					.map((t) => t.id),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: "disk save and editor reload preserve all mesh recipes and six edited preview samples",
		pass: true,
	});
	const started = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
	});
	let previous = -1;
	const finished = await poll(async () => {
		const job = await agentRequest(`export/${started.id}`),
			p = Math.floor(job.progress * 10);
		if (p !== previous) {
			previous = p;
			console.log(
				JSON.stringify({
					phase: "mesh-scenes-export",
					progress: job.progress,
					status: job.status,
				}),
			);
		}
		return ["completed", "failed", "cancelled"].includes(job.status)
			? job
			: null;
	}, 300000);
	assert.equal(finished.status, "completed", finished.error);
	const inside = relative(
		join(artifacts, "project/exports"),
		finished.outputPath,
	);
	assert(inside && !inside.startsWith("..") && !isAbsolute(inside));
	evidence.export = finished;
	evidence.decoded = decodeSweepScrollEditor(
		finished.outputPath,
		artifacts,
		process.env.ROCUT_FUSION_FFMPEG_DIR,
		evidence.meshEdits,
		{ count: 3, finalBackground: false },
	);
	evidence.checks.push({
		name: "180-frame six-second export independently decoded against six edited preview samples",
		pass: true,
	});
}
