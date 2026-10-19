import { describe, expect, test } from "bun:test";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import {
	assetId,
	projectId,
	revisionOf,
	type MediaFolderState,
	type TransactionOperation,
} from "../..";
import { planDraftCompensatingOperations } from "../../draft/inverse";
import { openTransactionEngine } from "../engine";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";
import { evaluateTransactionBatch } from "../evaluator";
import type { TransactionEngineDocument } from "../types";

const id = projectId("folder-boundary-audit");
// These fixed valid states test policy wiring and undo, not native graph semantics.
const nativeFolderFixture = {
	validatesMediaFolders: true as const,
	evaluate: () => [],
};
function document(): TransactionEngineDocument {
	return {
		project: {
			id,
			name: "Audit",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		assets: [{ id: assetId("asset"), name: "Media", kind: "image" }],
		tracks: [],
		clips: [],
		markers: [],
		revision: revisionOf(0),
		idempotency: [],
	};
}
function patch(mediaFolders: MediaFolderState): TransactionOperation {
	return { kind: "update-project", projectId: id, patch: { mediaFolders } };
}

describe("independent media folder transaction boundary audit", () => {
	for (const [name, state] of Object.entries({
		cycle: {
			projectId: id,
			folders: [
				{ id: "a", name: "A", parentId: "b" },
				{ id: "b", name: "B", parentId: "a" },
			],
			assignments: [],
		},
		foreignProject: { projectId: "foreign", folders: [], assignments: [] },
		unknownParent: {
			projectId: id,
			folders: [{ id: "a", name: "A", parentId: "missing" }],
			assignments: [],
		},
		duplicateFolder: {
			projectId: id,
			folders: [
				{ id: "a", name: "A" },
				{ id: "a", name: "B" },
			],
			assignments: [],
		},
		foreignAsset: {
			projectId: id,
			folders: [{ id: "a", name: "A" }],
			assignments: [{ assetId: "missing", folderId: "a" }],
		},
	})) {
		test(`direct engine apply rejects ${name} without relying on the planner`, async () => {
			const { store } = createInMemoryProjectStoreFixture();
			await store.save(
				createTransactionNativeProjectSeed({
					projectId: id,
					project: document().project,
				}),
			);
			const engine = await openTransactionEngine({
				store,
				projectId: id,
				documentAdapter: createTransactionNativeDocumentAdapter(),
			});
			const before = await engine.project();
			const batch = {
				expectedRevision: revisionOf(0),
				operations: [patch(state)],
			};
			expect((await engine.validate(batch)).valid).toBe(false);
			expect((await engine.dryRun(batch)).accepted).toBe(false);
			await expect(engine.apply(batch)).rejects.toThrow();
			expect(await engine.project()).toEqual(before);
		});
	}

	test("deleting an assigned asset cannot commit a dangling folder assignment", async () => {
		const original = document();
		const before = {
			...original,
			project: {
				...original.project!,
				mediaFolders: {
					projectId: id,
					folders: [{ id: "a", name: "A" }],
					assignments: [{ assetId: "asset", folderId: "a" }],
				},
			},
		};
		const result = await evaluateTransactionBatch({
			document: before,
			batch: {
				expectedRevision: revisionOf(0),
				operations: [{ kind: "delete-asset", assetId: assetId("asset") }],
			},
		});
		if (result.accepted) {
			expect(result.document.assets).toEqual([]);
			expect(result.document.project?.mediaFolders?.assignments).toEqual([]);
		} else {
			expect(result.issues.length).toBeGreaterThan(0);
		}
		expect(before.project?.mediaFolders?.assignments).toHaveLength(1);
	});

	test("a legacy project can commit unrelated metadata and reopen with folder state still absent", async () => {
		const { store } = createInMemoryProjectStoreFixture();
		await store.save(
			createTransactionNativeProjectSeed({
				projectId: id,
				project: document().project,
			}),
		);
		const adapter = createTransactionNativeDocumentAdapter();
		const engine = await openTransactionEngine({
			store,
			projectId: id,
			documentAdapter: adapter,
		});
		await engine.apply({
			expectedRevision: revisionOf(0),
			operations: [
				{
					kind: "update-project",
					projectId: id,
					patch: { name: "Renamed legacy" },
				},
			],
		});
		const reopened = await openTransactionEngine({
			store,
			projectId: id,
			documentAdapter: adapter,
		});
		expect((await reopened.project())?.mediaFolders).toBeUndefined();
		expect(Object.hasOwn((await reopened.project())!, "mediaFolders")).toBe(
			false,
		);
	});

	test("legacy state stays absent and undo of its first folder update restores absence", async () => {
		const base = document();
		const operation = patch({
			projectId: id,
			folders: [{ id: "a", name: "A" }],
			assignments: [],
		});
		const changed = await evaluateTransactionBatch({
			document: base,
			placementPolicies: [nativeFolderFixture],
			batch: { operations: [operation] },
		});
		if (!changed.accepted) throw new Error(JSON.stringify(changed.issues));
		const inverse = planDraftCompensatingOperations({
			base,
			candidate: changed.document,
			operations: [operation],
		});
		const restored = await evaluateTransactionBatch({
			document: changed.document,
			placementPolicies: [nativeFolderFixture],
			batch: {
				expectedRevision: changed.document.revision,
				operations: inverse,
			},
		});
		if (!restored.accepted) throw new Error(JSON.stringify(restored.issues));
		expect(restored.document.project?.mediaFolders).toBeUndefined();
		expect(base.project?.mediaFolders).toBeUndefined();
		expect(restored.document.assets).toEqual(base.assets);
	});

	test("undo restores an existing folder state without changing media", async () => {
		const original = document();
		const base = {
			...original,
			project: {
				...original.project!,
				mediaFolders: {
					projectId: id,
					folders: [],
					assignments: [],
				},
			},
		};
		const operation = patch({
			projectId: id,
			folders: [{ id: "a", name: "A" }],
			assignments: [],
		});
		const changed = await evaluateTransactionBatch({
			document: base,
			placementPolicies: [nativeFolderFixture],
			batch: { expectedRevision: revisionOf(0), operations: [operation] },
		});
		if (!changed.accepted) throw new Error(JSON.stringify(changed.issues));
		const inverse = planDraftCompensatingOperations({
			base,
			candidate: changed.document,
			operations: [operation],
		});
		const restored = await evaluateTransactionBatch({
			document: changed.document,
			placementPolicies: [nativeFolderFixture],
			batch: {
				expectedRevision: changed.document.revision,
				operations: inverse,
			},
		});
		if (!restored.accepted) throw new Error(JSON.stringify(restored.issues));
		expect(restored.document.project).toEqual(base.project);
		expect(restored.document.assets).toEqual(base.assets);
		const stale = await evaluateTransactionBatch({
			document: restored.document,
			batch: {
				expectedRevision: changed.document.revision,
				operations: [operation],
			},
		});
		expect(stale.accepted).toBe(false);
	});
});
