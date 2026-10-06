import { expect, spyOn, test } from "bun:test";
import { projectId, revisionOf } from "../..";
import { evaluateTransactionBatch } from "../evaluator";
import { projectCommittedTransactionDocument } from "../projection";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";

for (const keyed of [false, true]) {
	test(`private evaluated document transfers without a second whole copy (keyed=${keyed})`, async () => {
		const id = projectId("projection-ownership");
		const seed = createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Original",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
		});
		const document = createTransactionNativeDocumentAdapter().decode({
			projectId: id,
			record: seed.record,
		});
		const patch = {
			name: "Saved",
			frameRate: { numerator: 25, denominator: 1 },
		};
		const batch = {
			expectedRevision: revisionOf(0),
			...(keyed ? { idempotencyKey: "edit" } : {}),
			operations: [{ kind: "update-project" as const, projectId: id, patch }],
		};
		const evaluated = await evaluateTransactionBatch({ document, batch });
		if (!evaluated.accepted || evaluated.replayed)
			throw new Error("expected new accepted evaluation");
		const args = {
			evaluatedDocument: evaluated.document,
			batch,
			result: evaluated.result,
			fingerprint: evaluated.fingerprint,
		};
		const independent = projectCommittedTransactionDocument(args);
		expect(independent.project).not.toBe(evaluated.document.project);
		expect(independent.tracks).not.toBe(evaluated.document.tracks);
		const clone = globalThis.structuredClone;
		let copies = 0;
		const cloning = spyOn(globalThis, "structuredClone").mockImplementation(
			(value, options) => {
				if (value === evaluated.document) copies++;
				return clone(value, options);
			},
		);
		let owned;
		try {
			owned = projectCommittedTransactionDocument({
				...args,
				takeOwnership: true,
			});
		} finally {
			cloning.mockRestore();
		}
		expect(copies).toBe(0);
		expect(owned).toEqual(independent);
		expect(owned.project).toBe(evaluated.document.project);
		expect(owned.tracks).toBe(evaluated.document.tracks);
		// Evaluation already isolated mutable input, including operation patches.
		patch.frameRate.numerator = 60;
		if (!document.project || !owned.project || !independent.project)
			throw new Error("missing project");
		Reflect.set(document.project, "name", "input mutation");
		expect(owned.project.name).toBe("Saved");
		expect(owned.project.frameRate.numerator).toBe(25);
		Reflect.set(owned.project, "name", "private candidate mutation");
		expect(independent.project.name).toBe("Saved");
		expect(document.project.name).toBe("input mutation");
		if (keyed) {
			expect(evaluated.document.idempotency).toHaveLength(0);
			expect(owned.idempotency[0].result).not.toBe(evaluated.result);
			Reflect.set(evaluated.result, "revision", revisionOf(99));
			expect(owned.idempotency[0].result.revision).toBe(revisionOf(1));
		}
	});
}
