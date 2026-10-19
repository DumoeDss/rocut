import { expect, test } from "bun:test";
import { projectId, revisionOf } from "../..";
import { evaluateTransactionBatch } from "../evaluator";
import type { TransactionEngineDocument } from "../types";

test("folder metadata travels in the project patch and obeys revision CAS without media edits", async () => {
	const document: TransactionEngineDocument = {
		project: {
			id: projectId("folders"),
			name: "Folders",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		assets: [],
		tracks: [],
		clips: [],
		markers: [],
		revision: revisionOf(0),
		idempotency: [],
	};
	const mediaFolders = {
		projectId: "folders",
		folders: [{ id: "stable", name: "Media" }],
		assignments: [],
	};
	const operation = {
		kind: "update-project" as const,
		projectId: projectId("folders"),
		patch: { mediaFolders },
	};
	const result = await evaluateTransactionBatch({
		placementPolicies: [{ validatesMediaFolders: true, evaluate: () => [] }],
		document,
		batch: {
			expectedRevision: revisionOf(0),
			idempotencyKey: "folder-create",
			operations: [operation],
		},
	});
	if (!result.accepted) throw new Error(JSON.stringify(result.issues));
	expect(result.document.project?.mediaFolders).toEqual(mediaFolders);
	expect(result.document.assets).toEqual(document.assets);
	expect(document.project?.mediaFolders).toBeUndefined();
	const stale = await evaluateTransactionBatch({
		document: result.document,
		batch: {
			expectedRevision: revisionOf(0),
			operations: [operation],
		},
	});
	expect(stale.accepted).toBe(false);
});
