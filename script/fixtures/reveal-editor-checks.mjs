import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import { decodeRevealEditor } from "./reveal-editor-decode.mjs";

export async function runRevealEditor(page, artifacts, evidence, agentRequest) {
	const prepared = JSON.parse(
		await readFile(join(artifacts, "prepared.json"), "utf8"),
	);
	assert(prepared.originalInputUnavailable && prepared.hostReopened);
	assert.deepEqual(prepared.sampleLocalTicks, [60000, 180000]);
	evidence.revealPrepared = prepared;
	evidence.agentTransport =
		"direct authenticated Host HTTP and actual attached-editor task runner";
	const readClip = async (index) =>
		(await agentRequest("clips")).find((clip) => clip.id === `reveal-${index}`);
	const history = async (kind, key) => {
		const context = await agentRequest("context");
		const started = await agentRequest("editor-tasks", {
			request: {
				kind,
				expectedRevision: context.revision,
				idempotencyKey: key,
			},
		});
		const job = await poll(async () => {
			const job = await agentRequest(`editor-tasks/${started.id}`);
			return job.status === "running" ? null : job;
		});
		assert.equal(job.status, "complete", JSON.stringify(job));
	};
	const controls = [
		["glow", "Laser glow", 0],
		["cellSize", "Character width (pixels)", 20],
	];
	evidence.revealEdits = [];
	for (let index = 0; index < controls.length; index++) {
		const [key, label, value] = controls[index];
		const original = await readClip(index);
		const param = (clip) => clip.editing.effects[0].params[key];
		assert.notEqual(param(original), value);
		assert.deepEqual(original.editing.effects, prepared.shots[index].effects);
		assert.deepEqual(
			original.editing.animations,
			prepared.shots[index].animations,
		);
		await seek(page, index * 2, 15);
		const first = await capture(page, artifacts, `reveal-first-${index}`);
		await seek(page, index * 2 + 1, 15);
		const before = await capture(page, artifacts, `reveal-before-${index}`);
		assert.notEqual(
			first.sha256,
			before.sha256,
			"Authored reveal progress must change pixels",
		);
		await seek(page, index * 2, 15);
		await capture(page, artifacts, `reveal-reversed-${index}`, first.sha256);
		await seek(page, index * 2 + 1, 15);
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="reveal-${index}"]`,
			)
			.click();
		await page
			.getByRole("button", { name: "Effects", exact: true })
			.last()
			.click();
		const input = page.getByRole("textbox", { name: label, exact: true });
		await input.fill(String(value));
		await input.press("Tab");
		await poll(async () => param(await readClip(index)) === value);
		await page.keyboard.press("Escape");
		await seek(page, index * 2 + 1, 15);
		const edited = await capture(page, artifacts, `reveal-edited-${index}-45`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${label} must change visible pixels`,
		);
		await history("history.undo", `reveal-undo-${index}`);
		await poll(async () => param(await readClip(index)) === param(original));
		assert.deepEqual(
			(await readClip(index)).editing,
			original.editing,
			"Undo must restore the entire source/effect/animation state",
		);
		await capture(page, artifacts, `reveal-undone-${index}`, before.sha256);
		await history("history.redo", `reveal-redo-${index}`);
		await poll(async () => param(await readClip(index)) === value);
		await capture(page, artifacts, `reveal-redone-${index}`, edited.sha256);
		const modified = await readClip(index);
		assert.deepEqual(
			modified.editing.programmatic,
			original.editing.programmatic,
		);
		assert.deepEqual(modified.editing.animations, original.editing.animations);
		const expectedEffects = structuredClone(original.editing.effects);
		expectedEffects[0].params[key] = value;
		assert.deepEqual(
			modified.editing.effects,
			expectedEffects,
			"UI edits must preserve all other controls and animation fallbacks",
		);
		await seek(page, index * 2, 15);
		const editedFirst = await capture(
			page,
			artifacts,
			`reveal-edited-${index}-15`,
		);
		assert.notEqual(
			editedFirst.sha256,
			edited.sha256,
			"Edited reveal progression remains time-dependent",
		);
		const samples = [
			{
				...editedFirst,
				localTicks: 60000,
				timelineTicks: index * 240000 + 60000,
				frame: index * 60 + 15,
			},
			{
				...edited,
				localTicks: 180000,
				timelineTicks: index * 240000 + 180000,
				frame: index * 60 + 45,
			},
		];
		evidence.revealEdits.push({
			index,
			key,
			value,
			originalValue: param(original),
			before,
			effects: modified.editing.effects,
			animations: modified.editing.animations,
			samples,
		});
		console.log(JSON.stringify({ phase: "reveal-ui-history-verified", index }));
	}
	evidence.checks.push({
		name: "two effects, explicit progress animation, UI parameter edits and undo/redo checked against visible pixels",
		pass: true,
	});
	const clipsBeforeReload = await agentRequest("clips");
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	for (const edit of evidence.revealEdits)
		for (const sample of edit.samples) {
			await seek(page, Math.floor(sample.timelineTicks / 120000), 15);
			await capture(
				page,
				artifacts,
				`reveal-reopened-${edit.index}-${sample.localTicks}`,
				sample.sha256,
			);
		}
	assert.deepEqual(await agentRequest("clips"), clipsBeforeReload);
	evidence.checks.push({
		name: "reload preserves sources, all effects, animations, and four preview samples",
		pass: true,
	});
	const started = await agentRequest("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
	});
	let lastProgress = -1;
	const finished = await poll(async () => {
		const job = await agentRequest(`export/${started.id}`),
			progress = Math.floor(job.progress * 10);
		if (progress !== lastProgress) {
			lastProgress = progress;
			console.log(
				JSON.stringify({
					phase: "reveal-export",
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
	evidence.decoded = decodeRevealEditor(
		finished.outputPath,
		artifacts,
		process.env.ROCUT_FUSION_FFMPEG_DIR,
		evidence.revealEdits,
	);
	evidence.checks.push({
		name: "120-frame four-second export with independent decoder and four edited-preview comparisons",
		pass: true,
	});
}
