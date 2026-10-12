import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	hash,
	readJson,
	treeManifest,
	writeJson,
} from "../particle-c4-export-support.mjs";
import { particleEditorContract } from "./particle-editor-contract.mjs";

/** Final saved-project handoff after all original cleanup and failure gates. */
export async function finishParticleEditorHandoff({
	options,
	root,
	evidence,
	authority,
	baseline,
	secrets,
}) {
	if (options.mode === "run") {
		evidence.hostChildren = await readJson(join(root, "host-children.json"));
		assert.ok(evidence.hostChildren.allObservedDirectChildrenClosed);
		assert.deepEqual(
			await readJson(join(root, "host-reopened-state.json")),
			await readJson(join(root, "expected-final-state.json")),
		);
		const finalManifest = await treeManifest(join(root, "project"));
		const initialState = await readJson(join(root, "initial-state.json"));
		const finalState = await readJson(join(root, "expected-final-state.json"));
		const originalDisk = await readJson(
			join(options["source-project"], "project.json"),
		);
		const finalDisk = await readJson(join(root, "project/project.json"));
		await writeJson(join(root, "export-handoff.json"), {
			project: join(root, "project"),
			revision: evidence.finalRevision,
			opacity: evidence.finalOpacity,
			exactUiSavedProject: true,
			hostReopened: true,
			previewReferences: evidence.previewReferences,
			...(authority
				? {
						authority: {
							laneId: authority.laneId,
							authorityReceiptSha256: authority.authorityReceiptSha256,
							baselineReceiptSha256: baseline.baselineReceiptSha256,
						},
					}
				: {}),
			baseline: {
				revision: initialState.revision,
				projectSha256: baseline
					? baseline.metadata.project.files.find(
							(file) => file.path === "project.json",
						).sha256
					: particleEditorContract.initialProjectSha256,
				metadata: originalDisk.record.data.metadata,
				settings: originalDisk.record.data.settings,
				fullStateFile: "initial-state.json",
				fullStateSha256: hash(await readFile(join(root, "initial-state.json"))),
			},
			final: {
				revision: finalState.revision,
				metadata: finalDisk.record.data.metadata,
				settings: finalDisk.record.data.settings,
				fullStateFile: "expected-final-state.json",
				fullStateSha256: hash(
					await readFile(join(root, "expected-final-state.json")),
				),
				sourceSha256: hash(
					JSON.stringify(
						finalState.clips.find(
							(clip) => clip.id === particleEditorContract.clipId,
						).editing.programmatic,
					),
				),
			},
			instruction:
				"Consume this saved project unchanged. Do not rebuild source or replay the UI opacity edit.",
			...finalManifest,
		});
		assert.equal(
			finalManifest.files.find((entry) => entry.path === "project.json").sha256,
			evidence.uiSavedProjectSha256,
		);
		if (authority) {
			assert.equal(finalState.revision, evidence.finalRevision);
			assert.equal(
				hash(
					JSON.stringify(
						finalState.clips.find(
							(clip) => clip.id === particleEditorContract.clipId,
						).editing.programmatic,
					),
				),
				baseline.metadata.sourceSha256,
			);
			evidence.authority = {
				laneId: authority.laneId,
				authorityReceiptSha256: authority.authorityReceiptSha256,
				baselineReceiptSha256: baseline.baselineReceiptSha256,
				hostActualWasmObservation: await readJson(
					join(root, "host-actual-wasm-authority-final.json"),
				),
				archivedParticleIdentity: await readJson(
					join(root, "host-archived-particle-authority.json"),
				),
				initialProjectClosure: baseline.metadata.project,
				finalProjectManifest: finalManifest,
			};
		}
		evidence.exportHandoff = join(root, "export-handoff.json");
	}
	evidence.status = options.mode === "run" ? "passed" : "build-only-passed";
	if (secrets.size) {
		const artifactManifest = await treeManifest(root);
		const leaks = [];
		for (const entry of artifactManifest.files) {
			const bytes = await readFile(join(root, entry.path));
			if ([...secrets].some((secret) => bytes.includes(Buffer.from(secret))))
				leaks.push(entry.path);
		}
		assert.deepEqual(
			leaks,
			[],
			"Known private capability found in retained artifacts",
		);
		evidence.credentialAudit = {
			exactKnownHostSecretScan: true,
			filesScanned: artifactManifest.files.length,
			leaks,
			readinessFilesRemoved: true,
			scope:
				"Known current Host token and editor URL; no prior-session credentials used",
		};
	}
	await writeJson(join(root, "evidence.json"), evidence);
	console.log(
		JSON.stringify({
			status: evidence.status,
			root,
			evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
		}),
	);
}
