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

export async function runSweepScrollEditor(
	page,
	artifacts,
	evidence,
	agentRequest,
) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.originalInputUnavailable && prepared.hostReopened);
	assert.deepEqual(prepared.sampleLocalTicks, [60000, 120000]);
	assert.deepEqual(prepared.templates, [
		"asciiSweepText",
		"particleScrollImage",
	]);
	evidence.sweepScrollPrepared = prepared;
	evidence.agentTransport =
		"direct authenticated Host HTTP and actual attached-editor task runner";
	evidence.authoringMode = {
		parameterEntry:
			"Host apply update-clip replaces programmatic source/recipe",
		parameterUi: false,
		reason:
			"Programmatic source definition has no parameter fields; GraphicTab renders only definition.params",
		recipeReversal:
			"revision-checked Host restore/reapply; Host apply does not enter attached-session history",
		previewHistory:
			"separate real Blending/Opacity UI edit with attached-session undo/redo; generator source remains unchanged",
	};
	const readClip = async (index) =>
		(await agentRequest("clips")).find(
			(clip) => clip.id === `sweep-scroll-${index}`,
		);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	const at = async (ticks) =>
		seek(page, Math.floor(ticks / 120000), (ticks % 120000) / 4000);
	const history = createSweepScrollHistory(agentRequest);
	const replaceEditing = async (clip) => {
		const context = await agentRequest("context");
		await agentRequest("apply", {
			expectedRevision: context.revision,
			operations: [
				{
					kind: "update-clip",
					clipId: clip.id,
					patch: { editing: clip.editing },
				},
			],
		});
	};
	const emptyRecipeHistory = async (key) => {
		const status = await history("history.status", key);
		assert.equal(status.scope, "attached-session");
		assert.equal(status.count, 0);
		assert.equal(status.canUndo, false);
		assert.equal(status.canRedo, false);
		return status;
	};
	const controls = [
		["bandWidth", 0.4],
		["scatter", 0.4],
	];
	evidence.sweepScrollEdits = [];
	for (const [index, [key, value]] of controls.entries()) {
		const original = await readClip(index);
		const source = original.editing.programmatic;
		assert.deepEqual(source, prepared.shots[index].source);
		assert.deepEqual(original.editing.effects, prepared.shots[index].effects);
		const scene = (clip) => clip.editing.programmatic.recipe.nodes[0].scene;
		const param = (clip) => scene(clip).settings[key];
		assert.notEqual(param(original), value);
		const firstTicks = index * 240000 + 60000;
		const secondTicks = index * 240000 + 120000;
		await at(firstTicks);
		const first = await capture(page, artifacts, `sweep-scroll-first-${index}`);
		await at(secondTicks);
		const before = await capture(
			page,
			artifacts,
			`sweep-scroll-before-${index}`,
		);
		assert.notEqual(
			first.sha256,
			before.sha256,
			"Source-frame progression must change visible pixels",
		);
		await at(firstTicks);
		await capture(
			page,
			artifacts,
			`sweep-scroll-reversed-${index}`,
			first.sha256,
		);
		await at(secondTicks);
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="sweep-scroll-${index}"]`,
			)
			.click();
		const expected = structuredClone(original);
		scene(expected).settings[key] = value;
		const untouched = (await agentRequest("clips")).filter(
			(clip) => clip.id !== original.id,
		);
		await replaceEditing(expected);
		await poll(async () => param(await readClip(index)) === value);
		assert.deepEqual(
			await readClip(index),
			expected,
			"Recipe replacement must preserve the complete clip projection",
		);
		assert.deepEqual(
			(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
			untouched,
		);
		await page.keyboard.press("Escape");
		await at(secondTicks);
		const edited = await capture(
			page,
			artifacts,
			`sweep-scroll-edited-${index}-30`,
		);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${key} replacement must change visible pixels`,
		);
		const historyAfterApply = await emptyRecipeHistory(
			`sweep-scroll-agent-history-${index}`,
		);
		await replaceEditing(original);
		await poll(async () => param(await readClip(index)) === param(original));
		assert.deepEqual(
			await readClip(index),
			original,
			"Host inverse restore preserves source, role, span, easing, seed, resources and topology",
		);
		await at(secondTicks);
		await capture(
			page,
			artifacts,
			`sweep-scroll-agent-restored-${index}`,
			before.sha256,
		);
		await replaceEditing(expected);
		await poll(async () => param(await readClip(index)) === value);
		assert.deepEqual(
			await readClip(index),
			expected,
			"Host reapply restores the entire recipe replacement",
		);
		await at(secondTicks);
		await capture(
			page,
			artifacts,
			`sweep-scroll-agent-reapplied-${index}`,
			edited.sha256,
		);
		const historyAfterReapply = await emptyRecipeHistory(
			`sweep-scroll-agent-reapply-history-${index}`,
		);
		assert.deepEqual(
			(await agentRequest("clips")).filter((clip) => clip.id !== original.id),
			untouched,
		);
		await at(firstTicks);
		const editedFirst = await capture(
			page,
			artifacts,
			`sweep-scroll-edited-${index}-15`,
		);
		assert.notEqual(
			editedFirst.sha256,
			edited.sha256,
			"Edited source-frame progression must remain visible",
		);
		evidence.sweepScrollEdits.push({
			index,
			key,
			value,
			originalValue: param(original),
			parameterEntry: "Host recipe replacement",
			reversal:
				"revision-checked Host inverse restore and reapply, not local undo/redo",
			historyAfterApply,
			historyAfterReapply,
			before,
			source: expected.editing.programmatic,
			effects: expected.editing.effects,
			preserved: {
				seed: source.seed,
				role: scene(original).role,
				span: scene(original).span,
				easing: scene(original).easing,
				resources: source.resources,
				outputRoles: source.recipe.outputRoles,
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
			JSON.stringify({ phase: "sweep-scroll-agent-reversal-verified", index }),
		);
	}
	evidence.checks.push({
		name: "two Creator generators: revision-checked Host recipe replacement/restore/reapply and preview preserve complete sources without entering local history",
		pass: true,
	});
	await runSweepScrollOpacityHistory(page, artifacts, evidence, agentRequest);
	const clipsBeforeReload = byId(await agentRequest("clips"));
	const saved = await poll(async () => {
		const disk = JSON.parse(
			await readFile(join(artifacts, "project/project.json"), "utf8"),
		);
		const live = await agentRequest("record");
		return isDeepStrictEqual(disk.record, live.record) ? disk : null;
	});
	assert.equal(saved.wrapperVersion, 1);
	evidence.sweepScrollSavedToDisk = true;
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	for (const edit of evidence.sweepScrollEdits) {
		for (const sample of edit.samples) {
			await at(sample.timelineTicks);
			await capture(
				page,
				artifacts,
				`sweep-scroll-reopened-${edit.index}-${sample.localTicks}`,
				sample.sha256,
			);
		}
	}
	assert.deepEqual(byId(await agentRequest("clips")), clipsBeforeReload);
	evidence.checks.push({
		name: "saved project and editor reload preserve full sources, resources, roles, spans, seeds and four preview samples",
		pass: true,
	});
	const context = await agentRequest("context");
	const tracks = await agentRequest("tracks");
	await writeFile(
		join(artifacts, "expected-edited.json"),
		JSON.stringify(
			{
				revision: context.revision,
				clips: clipsBeforeReload,
				tracks: byId(tracks),
				authoredTrackIds: tracks
					.filter((track) => track.id === "sweep-scroll-shots")
					.map((track) => track.id),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	const started = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
	});
	let lastProgress = -1;
	const finished = await poll(async () => {
		const job = await agentRequest(`export/${started.id}`);
		const progress = Math.floor(job.progress * 10);
		if (progress !== lastProgress) {
			lastProgress = progress;
			console.log(
				JSON.stringify({
					phase: "sweep-scroll-export",
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
		evidence.sweepScrollEdits,
	);
	evidence.checks.push({
		name: "120-frame four-second export: independent decoder compares four edited-preview samples and final transparent-image endpoint",
		pass: true,
	});
}
