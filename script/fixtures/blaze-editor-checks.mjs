import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazeEditorContract as contract,
	blazeEditorSeekTicks,
} from "./blaze-editor-contract.mjs";
import {
	blazeEditorDigest,
	blazeEditorHistory,
	blazeEditorPoll,
	blazeEditorScreenshot,
	blazeEditorSeek,
	blazeEditorSnapshot,
	blazeEditorWrite,
} from "./blaze-editor-control.mjs";
import { runBlazeEditorInputs } from "./blaze-editor-inputs.mjs";
import {
	blazeEditorSaved,
	prepareBlazeEditorFirstOpen,
	verifyBlazeEditorReadOnly,
} from "./blaze-editor-persistence.mjs";

export async function runBlazeEditorChecks({ page, root, request, evidence }) {
	const prepared = JSON.parse(
		await readFile(join(root, "prepared.json"), "utf8"),
	);
	assert(prepared.ok && prepared.hostReopened && prepared.authorUnavailable);
	assert.deepEqual(await blazeEditorSnapshot(request), prepared.snapshot);
	evidence.firstOpen = await prepareBlazeEditorFirstOpen(root, request);
	const history = blazeEditorHistory(request);
	const initialHistory = await history(
		"history.status",
		"blaze-ui-initial-history",
	);
	assert.equal(initialHistory.scope, "attached-session");
	assert.equal(initialHistory.count, 0);
	evidence.scope = contract;
	evidence.initialScreenshot = await blazeEditorScreenshot(
		page,
		root,
		"editor-initial",
	);
	evidence.seekSequences = [];
	const animated = prepared.snapshot.clips.find(
		(clip) => clip.id === contract.animatedId,
	);
	assert.equal(Object.keys(animated.editing.animations).length, 7);
	const seekSequence = async (stage) => {
		const before = await blazeEditorSnapshot(request),
			samples = [];
		for (const ticks of blazeEditorSeekTicks) {
			samples.push(await blazeEditorSeek(page, ticks));
			await page
				.locator(
					`canvas[width="${contract.width}"][height="${contract.height}"]`,
				)
				.filter({ visible: true })
				.waitFor({ state: "visible", timeout: 30000 });
			const current = await blazeEditorSnapshot(request);
			assert.deepEqual(
				current,
				before,
				`${stage}: seeking changed authored state`,
			);
			assert.deepEqual(
				current.clips.find((clip) => clip.id === contract.animatedId),
				animated,
			);
		}
		evidence.seekSequences.push({
			stage,
			samples,
			parametersUnchanged: true,
			keyframesCreatedBy: "Creator helper then real Host transaction",
			pixelInterpolationVerified: false,
		});
	};
	await seekSequence("before-edits");
	await runBlazeEditorInputs({ page, request, evidence });
	await blazeEditorSeek(page, contract.finalTicks);
	const expected = await blazeEditorSnapshot(request);
	const baseline = await blazeEditorSaved(root, request);
	await blazeEditorWrite(root, "project-before-reload.json", baseline);
	evidence.reloadBaselineSha256 = blazeEditorDigest(baseline);
	await page.reload({ waitUntil: "commit" });
	await page
		.getByRole("button", { name: "Edit playhead time", exact: true })
		.waitFor({ timeout: 30000 });
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.staticId}"]`,
		)
		.waitFor({ timeout: 30000 });
	await blazeEditorPoll(async () => (await request("export")).surfaces === 1);
	assert.deepEqual(await blazeEditorSnapshot(request), expected);
	evidence.reload = await verifyBlazeEditorReadOnly(
		root,
		request,
		baseline,
		"after-readonly-reload",
	);
	// These explicit playhead edits begin a new authored UI stage, not a metadata exemption for reload.
	await seekSequence("after-reload");
	await blazeEditorSeek(page, contract.finalTicks);
	assert.deepEqual(await blazeEditorSnapshot(request), expected);
	const finalBytes = await blazeEditorSaved(root, request);
	await blazeEditorWrite(root, "project-final-ui.json", finalBytes);
	await blazeEditorWrite(root, "expected-edited.json", expected);
	evidence.finalUiSha256 = blazeEditorDigest(finalBytes);
	evidence.finalScreenshot = await blazeEditorScreenshot(
		page,
		root,
		"editor-final",
	);
	evidence.beforeClose = await verifyBlazeEditorReadOnly(
		root,
		request,
		finalBytes,
		"before-close",
	);
	evidence.checks = [
		"ten actual parameter inputs",
		"attached-session undo and redo for each input",
		"all other clips and sentinel retained",
		"seven Host-authored animation channels retained through seeks and reload",
		"read-only reload preserves every project byte",
		"final authored UI state saved before close",
	];
}
