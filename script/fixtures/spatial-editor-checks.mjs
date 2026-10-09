import assert from "node:assert/strict";
import { isAbsolute, join, relative } from "node:path";
import { capture, poll, seek } from "./stylized-fusion-checks.mjs";
import { decodeSpatialEditor } from "./spatial-editor-decode.mjs";

export async function runSpatialEditor(
	page,
	artifacts,
	evidence,
	agentRequest,
) {
	const readClip = async (index) =>
		(await agentRequest("clips")).find(
			(clip) => clip.id === `spatial-${index}`,
		);
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
			const value = await agentRequest(`editor-tasks/${started.id}`);
			return value.status === "running" ? null : value;
		});
		assert.equal(job.status, "complete", JSON.stringify(job));
	};
	evidence.agentTransport =
		"direct authenticated Host HTTP and actual attached-editor task runner";
	evidence.spatialEdits = [];
	const controls = [
		["zoom", "Magnification", 1.8],
		["hud", "HUD opacity", 0.2],
		["cellSize", "Character width (pixels)", 20],
		["levels", "Levels per channel", 8],
	];
	for (let index = 0; index < 4; index++) {
		const [key, label, value] = controls[index];
		const original = await readClip(index);
		const param = (clip) => clip.editing.effects[0].params[key];
		assert.notEqual(param(original), value);
		await seek(page, index * 2);
		const start = await capture(page, artifacts, `spatial-start-${index}`);
		await seek(page, index * 2 + 1);
		const before = await capture(page, artifacts, `spatial-before-${index}`);
		assert.notEqual(
			start.sha256,
			before.sha256,
			"Authored trajectory must change visible pixels",
		);
		await seek(page, index * 2);
		await capture(page, artifacts, `spatial-reversed-${index}`, start.sha256);
		await seek(page, index * 2 + 1);
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="spatial-${index}"]`,
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
		await seek(page, index * 2 + 1);
		const edited = await capture(page, artifacts, `spatial-edited-${index}`);
		assert.notEqual(
			edited.sha256,
			before.sha256,
			`${label} must change visible pixels`,
		);
		await history("history.undo", `spatial-undo-${index}`);
		await poll(async () => param(await readClip(index)) === param(original));
		await capture(page, artifacts, `spatial-undone-${index}`, before.sha256);
		await history("history.redo", `spatial-redo-${index}`);
		await poll(async () => param(await readClip(index)) === value);
		await capture(page, artifacts, `spatial-redone-${index}`, edited.sha256);
		const modified = await readClip(index);
		assert.deepEqual(
			modified.editing.programmatic,
			original.editing.programmatic,
		);
		assert.deepEqual(modified.editing.animations, original.editing.animations);
		evidence.spatialEdits.push({
			index,
			key,
			value,
			originalValue: param(original),
			before,
			edited,
		});
		console.log(
			JSON.stringify({ phase: "spatial-ui-history-verified", index }),
		);
	}
	evidence.checks.push({
		name: "four template trajectories, UI edits and undo/redo checked against visible pixels",
		pass: true,
	});
	const clipsBeforeReload = await agentRequest("clips");
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor();
	for (const edit of evidence.spatialEdits) {
		await seek(page, edit.index * 2 + 1);
		await capture(
			page,
			artifacts,
			`spatial-reopened-${edit.index}`,
			edit.edited.sha256,
		);
	}
	assert.deepEqual(await agentRequest("clips"), clipsBeforeReload);
	evidence.checks.push({
		name: "reload preserves all modified effects, keyframes and actual preview pixels",
		pass: true,
	});
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
					phase: "spatial-export",
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
	evidence.decoded = decodeSpatialEditor(
		finished.outputPath,
		artifacts,
		process.env.ROCUT_FUSION_FFMPEG_DIR,
		evidence.spatialEdits,
	);
	evidence.checks.push({
		name: "240-frame export with independent decoder and four edited-preview comparisons",
		pass: true,
	});
}
