import assert from "node:assert/strict";
import {
	snapshot,
	seek,
	capture,
	settledRecord,
	digest,
	validateArtifacts,
	writeArtifact,
	poll,
} from "./flame-wrap-editor-controls.mjs";
import { frostEffect } from "./frost-editor-state.mjs";
import { editFrostWithHistory } from "./frost-editor-history.mjs";

export async function runFrostEditorChecks({ page, request, artifacts }) {
	validateArtifacts(artifacts);
	assert.equal(
		artifacts.usePresentationObserver,
		true,
		"Frost requires real publication boundary observer",
	);
	const evidence = {
		ok: false,
		uiHistory: [],
		frames: [],
		seeks: [],
		scope:
			"Actual production UI/history and full presentation-boundary copy; not native GPU bytes, export or UI-created strokes/animation",
	};
	const frames = [];
	try {
		const catalog = (await request("editing/catalog")).effects.frost;
		assert(Array.isArray(catalog));
		const initial = await snapshot(request);
		assert.equal(frostEffect(initial, artifacts).clip.startTime, 0);
		const frameRate = initial.project.frameRate;
		await seek(page, 40000, frameRate);
		evidence.uiHistory = await editFrostWithHistory({
			page,
			request,
			artifacts,
			catalog,
		});
		const graph = await snapshot(request);
		const observe = async (ticks, label, target = artifacts) => {
			evidence.seeks.push(await seek(page, ticks, frameRate));
			assert.deepEqual(
				await snapshot(request),
				graph,
				"Seek changed complete graph/revision",
			);
			const result = await capture(page, target, ticks, graph.revision, label);
			frames.push(result);
			evidence.frames.push({ ...result, rgbaBase64: undefined });
			return result;
		};
		const early = await observe(20000, "frost-early"),
			late = await observe(80000, "frost-late");
		assert.notEqual(
			early.sha256,
			late.sha256,
			"Melt/recovery showed no presentation change",
		);
		assert.equal((await observe(20000, "frost-reverse")).sha256, early.sha256);
		const disabled = graph.clips.find(
			(clip) => clip.id === artifacts.disabledClipId,
		);
		assert.equal(
			disabled?.editing?.effects?.find(
				(effect) => effect.id === artifacts.effectId,
			)?.enabled,
			false,
		);
		await observe(260000, "frost-disabled", {
			...artifacts,
			clipId: disabled.id,
		});
		const ticks = artifacts.finalTicks ?? 40000;
		const final = await observe(ticks, "frost-before-reload");
		const bytes = await settledRecord(artifacts, request);
		await writeArtifact(artifacts, "frost-editor-before-reload.json", bytes);
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
		evidence.reloadSeek = await seek(page, ticks, frameRate);
		assert.deepEqual(
			await snapshot(request),
			graph,
			"Reload changed complete graph/revision",
		);
		const reopened = await settledRecord(artifacts, request);
		assert(
			reopened.equals(bytes),
			"Read-only reload changed complete project bytes",
		);
		const reloaded = await capture(
			page,
			artifacts,
			ticks,
			graph.revision,
			"frost-after-reload",
		);
		assert.equal(
			reloaded.sha256,
			final.sha256,
			"Explicit re-seek changed presentation bytes",
		);
		frames.push(reloaded);
		evidence.frames.push({ ...reloaded, rgbaBase64: undefined });
		evidence.reload = {
			completeGraphUnchanged: true,
			completeProjectBytesIdentical: true,
			pixelsIdentical: true,
			playheadAutomaticallyRetained: false,
			explicitReseekTicks: ticks,
			sha256: digest(reopened),
		};
		await writeArtifact(artifacts, "frost-editor-final-expected.json", graph);
		await writeArtifact(artifacts, "frost-editor-expected-frames.json", frames);
		evidence.ok = true;
		return { evidence, frames, graph };
	} catch (error) {
		evidence.failure = error.stack ?? String(error);
		if (error.captureObservation)
			evidence.captureFailure = error.captureObservation;
		throw error;
	} finally {
		await writeArtifact(artifacts, "frost-editor-evidence.json", evidence);
	}
}
