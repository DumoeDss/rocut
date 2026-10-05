import { expect, spyOn, test } from "bun:test";
import { revisionOf } from "@opencut/editor-contracts";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import { projectOpenCutDraft } from "../projection";
import type { OpenCutCommitToken } from "../types";
import {
	motionTextSequenceFixture,
	projectFixture,
	recordFixture,
	TEST_PROJECT_ID,
} from "./fixture";

test("encoding borrows its private staged draft without exposing it through receipts or records", () => {
	const project = projectFixture();
	project.motionTextSequences.push(motionTextSequenceFixture());
	const initialRecord = recordFixture();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [],
	});
	const draft = { project, assetCatalog: [] };
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fixture supplies the router-internal branded commit token.
	const token = "opencut-ui:owned-encoding" as OpenCutCommitToken;
	const document = projectOpenCutDraft(draft, {
		revision: revisionOf(1),
		idempotency: [
			{
				key: token,
				fingerprint: "fixture",
				result: { revision: revisionOf(1), createdIds: [], changedIds: [] },
			},
		],
	});
	const expected = structuredClone(draft);
	adapter.stage({
		token,
		baseRevision: 0,
		previousRecordDigest: adapter.currentRecordDigest(),
		draft,
		projectedDocument: document,
	});
	draft.project.metadata.name = "mutated stage input";
	Reflect.set(
		draft.project.motionTextSequences[0].cues[0],
		"text",
		"mutated input cue",
	);
	const encode = () =>
		adapter.encode({
			projectId: TEST_PROJECT_ID,
			previousRecord: initialRecord,
			document,
		});
	const clone = spyOn(globalThis, "structuredClone");
	let encoded;
	try {
		encoded = encode();
		// Exactly one complete draft copy is needed for the externally owned receipt.
		expect(
			clone.mock.calls.filter(
				([value]) =>
					value &&
					typeof value === "object" &&
					"project" in value &&
					"assetCatalog" in value,
			),
		).toHaveLength(1);
	} finally {
		clone.mockRestore();
	}
	const expectedRecord = structuredClone(encoded.record);
	const receipt = adapter.consumeReceipt();
	if (!receipt) throw new Error("missing receipt");
	expect(receipt.draft).toEqual(expected);
	receipt.draft.project.metadata.name = "mutated receipt";
	Reflect.set(
		receipt.draft.project.motionTextSequences[0].cues[0],
		"text",
		"mutated receipt cue",
	);
	Reflect.set(receipt.record, "schemaVersion", 99);
	if (typeof receipt.record.data !== "object" || !receipt.record.data)
		throw new Error("missing receipt data");
	Reflect.set(receipt.record.data, "motionTextSequences", []);
	expect(encoded.record).toEqual(expectedRecord);
	if (typeof encoded.record.data !== "object" || !encoded.record.data)
		throw new Error("missing encoded data");
	Reflect.set(encoded.record.data, "motionTextSequences", []);
	expect(encode().record).toEqual(expectedRecord);
	expect(adapter.consumeReceipt()?.draft).toEqual(expected);
	expect(adapter.currentDraft().project).toEqual(projectFixture());
	adapter.clear(token);
	expect(adapter.consumeReceipt()).toBeNull();
});
