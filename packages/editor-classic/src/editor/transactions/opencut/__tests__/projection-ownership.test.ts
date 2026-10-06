import { expect, spyOn, test } from "bun:test";
import { revisionOf } from "@opencut/editor-contracts";
import { projectOpenCutDraft } from "../projection";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import type { OpenCutCommitToken } from "../types";
import {
	motionTextSequenceFixture,
	projectFixture,
	recordFixture,
	TEST_PROJECT_ID,
} from "./fixture";

test("default projections isolate sequences while internal borrowed inspection avoids a duplicate copy", () => {
	const project = projectFixture();
	project.motionTextSequences.push(motionTextSequenceFixture());
	const draft = { project, assetCatalog: [] };
	const metadata = { revision: revisionOf(0), idempotency: [] };
	const owned = projectOpenCutDraft(draft, metadata);
	const clone = spyOn(globalThis, "structuredClone");
	try {
		const borrowed = projectOpenCutDraft(draft, {
			...metadata,
			sequenceOwnership: "borrow",
		});
		expect(borrowed.motionTextSequences).toBe(project.motionTextSequences);
		expect(borrowed).toEqual(owned);
		expect(clone).not.toHaveBeenCalled();
	} finally {
		clone.mockRestore();
	}
	Reflect.set(
		owned.motionTextSequences![0].cues[0],
		"text",
		"external mutation",
	);
	expect(project.motionTextSequences[0].cues[0].text).not.toBe(
		"external mutation",
	);
});

test("staging independently owns borrowed projections before caller mutation and encoding", () => {
	const project = projectFixture();
	project.motionTextSequences.push(motionTextSequenceFixture());
	const draft = { project, assetCatalog: [] };
	const initialRecord = recordFixture();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [],
	});
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Internal token fixture.
	const token = "opencut-ui:borrowed-projection" as OpenCutCommitToken;
	const projectedDocument = projectOpenCutDraft(draft, {
		revision: revisionOf(1),
		idempotency: [
			{
				key: token,
				fingerprint: "fixture",
				result: { revision: revisionOf(1), createdIds: [], changedIds: [] },
			},
		],
		sequenceOwnership: "borrow",
	});
	const document = structuredClone(projectedDocument),
		expected = structuredClone(draft);
	adapter.stage({
		token,
		baseRevision: 0,
		previousRecordDigest: adapter.currentRecordDigest(),
		draft,
		projectedDocument,
	});
	Reflect.set(project.motionTextSequences[0].cues[0], "text", "mutated input");
	expect(projectedDocument.motionTextSequences![0].cues[0].text).toBe(
		"mutated input",
	);
	adapter.encode({
		projectId: TEST_PROJECT_ID,
		previousRecord: initialRecord,
		document,
	});
	const receipt = adapter.consumeReceipt();
	expect(receipt?.draft).toEqual(expected);
	if (!receipt) throw new Error("missing receipt");
	Reflect.set(
		receipt.draft.project.motionTextSequences[0].cues[0],
		"text",
		"mutated receipt",
	);
	adapter.encode({
		projectId: TEST_PROJECT_ID,
		previousRecord: initialRecord,
		document,
	});
	expect(adapter.consumeReceipt()?.draft).toEqual(expected);
	adapter.clear(token);
});
