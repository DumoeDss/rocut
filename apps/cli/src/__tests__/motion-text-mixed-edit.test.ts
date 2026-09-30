import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { revisionOf, type MotionTextSequence } from "@opencut/editor-contracts";
import type { ProjectRecord, ProjectSummary } from "@opencut/editor-ports";
import {
	MOTION_TEXT_RENDERER_SUPPORT,
	mutateMotionTextSequence,
} from "@opencut/editor-classic/motion-text/factory";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence as canonicalMutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { openEditorPlaneAutomation } from "../editor-plane";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import type { MotionTextFactoryCores } from "../motion-text";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(
		path.join(tmpdir(), "rocut-motion-text-mixed-edit-"),
	);
	roots.push(root);
	return root;
}

afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

const canonicalCores: MotionTextFactoryCores = {
	create: createMotionTextSequence,
	importJizura: importJizuraMotionTextProject,
	mutate: canonicalMutateMotionTextSequence,
	variation: createMotionTextVariationCandidate,
};

describe("motion-text mixed user and agent editing", () => {
	test("an external user commit forces stale-agent read-back before retry", async () => {
		const host = await startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
			motionTextCores: canonicalCores,
		});
		const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
		const post = (route: string, body: unknown) =>
			fetch(`${base}/${route}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		try {
			const createdResponse = await post("motion-text/sequences", {
				source: "ORIGINAL LINE",
				sourceFormat: "plain",
				language: "en",
				duration: 240_000,
				expectedRevision: 0,
				idempotencyKey: "test:mixed-edit:create",
			});
			expect(createdResponse.status).toBe(200);
			const created = (await createdResponse.json()) as {
				projectRevision: number;
				sequenceId: string;
				sequenceRevision: number;
			};
			expect(created).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});

			const sequences = (await (
				await fetch(`${base}/motion-text-sequences`)
			).json()) as MotionTextSequence[];
			const original = sequences.find(
				(sequence) => sequence.id === created.sequenceId,
			);
			expect(original).toBeDefined();
			const cue = original?.cues[0];
			expect(cue).toBeDefined();
			if (original === undefined || cue === undefined) {
				throw new Error("The created sequence must contain its first cue");
			}
			const userMutation = mutateMotionTextSequence({
				sequence: original,
				mutation: {
					kind: "update-cue",
					cueId: cue.id,
					text: "USER REVISED LINE",
					startTime: cue.startTime,
					duration: cue.duration,
					preset: { mode: "keep" },
					font: { mode: "keep" },
					colors: { mode: "keep" },
				},
				rendererSupport: MOTION_TEXT_RENDERER_SUPPORT,
				core: canonicalMutateMotionTextSequence,
			});
			if (userMutation.sequence === null) {
				throw new Error(
					`The canonical user mutation must produce a sequence: ${JSON.stringify(userMutation.diagnostics)}`,
				);
			}
			expect(userMutation.sequence).not.toBeNull();

			const recordResponse = (await (await fetch(`${base}/record`)).json()) as {
				record: ProjectRecord;
				summary: ProjectSummary;
			};
			const editorStore = new FileProjectStore({
				root: await tempRoot(),
				schemaVersion: recordResponse.record.schemaVersion,
			});
			await editorStore.save(recordResponse);
			const editor = await openEditorPlaneAutomation({
				baseStore: editorStore,
				projectId: recordResponse.record.id,
			});
			const userCommit = await editor.automation.apply({
				operations: [
					{
						kind: "update-motion-text-sequence",
						sequenceId: original.id,
						expectedSequenceRevision: 0,
						sequence: userMutation.sequence,
					},
				],
				expectedRevision: revisionOf(1),
				idempotencyKey: "test:mixed-edit:user-commit",
			});
			expect(Number(userCommit.revision)).toBe(2);

			const externalRecord = await editorStore.load({
				id: recordResponse.record.id,
			});
			const externalSummary = (await editorStore.list())[0];
			expect(externalRecord).not.toBeNull();
			expect(externalSummary).toBeDefined();
			const accepted = await fetch(`${base}/record`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					record: externalRecord,
					summary: externalSummary,
				}),
			});
			expect(accepted.status).toBe(200);
			expect(await accepted.json()).toMatchObject({
				accepted: true,
				revision: 2,
			});

			const agentIntent = {
				mutation: {
					kind: "update-planning-controls",
					controls: {
						presetSets: { horror: false, typo: true, kinetic: true },
						unify: true,
						centerFree: true,
						centerDirection: "lr",
					},
				},
				expectedRevision: 2,
				expectedSequenceRevision: 0,
				idempotencyKey: "test:mixed-edit:agent-stale",
			};
			const stale = await post(
				`motion-text/sequences/${encodeURIComponent(original.id)}/mutations`,
				agentIntent,
			);
			expect(stale.status).toBe(409);
			expect(await stale.json()).toMatchObject({
				accepted: false,
				code: "motion-text-sequence-conflict",
				expectedSequenceRevision: 0,
				actualSequenceRevision: 1,
			});
			expect(await host.automation.revision()).toBe(2);

			const afterUserEdit = (await (
				await fetch(`${base}/motion-text-sequences`)
			).json()) as MotionTextSequence[];
			expect(afterUserEdit[0]).toMatchObject({
				id: original.id,
				revision: 1,
				cues: [expect.objectContaining({ text: "USER REVISED LINE" })],
			});

			const retried = await post(
				`motion-text/sequences/${encodeURIComponent(original.id)}/mutations`,
				{
					...agentIntent,
					expectedSequenceRevision: 1,
					idempotencyKey: "test:mixed-edit:agent-retry",
				},
			);
			expect(retried.status).toBe(200);
			expect(await retried.json()).toMatchObject({
				accepted: true,
				projectRevision: 3,
				sequenceRevision: 2,
			});

			const afterRetry = (await (
				await fetch(`${base}/motion-text-sequences`)
			).json()) as MotionTextSequence[];
			expect(afterRetry[0]).toMatchObject({
				id: original.id,
				revision: 2,
				planningControls: {
					unify: true,
					centerDirection: "lr",
				},
				cues: [expect.objectContaining({ text: "USER REVISED LINE" })],
			});
		} finally {
			await host.close();
		}
	});
});
