import { expect, spyOn, test } from "bun:test";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import { recordFixture, TEST_PROJECT_ID } from "./fixture";

test("record digests are memoized only for the adapter-owned record", () => {
	const record = recordFixture();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord: record,
		initialAssets: [],
	});
	const first = adapter.currentRecordDigest();
	const keys = spyOn(Object, "keys");
	try {
		expect(adapter.currentRecordDigest()).toBe(first);
		expect(keys).not.toHaveBeenCalled();
	} finally {
		keys.mockRestore();
	}
	Reflect.set(record, "schemaVersion", record.schemaVersion + 1);
	expect(adapter.currentRecordDigest()).toBe(first);
	adapter.adoptCommittedRecord(record);
	const second = adapter.currentRecordDigest();
	expect(second).not.toBe(first);
	Reflect.set(record, "schemaVersion", record.schemaVersion + 1);
	expect(adapter.currentRecordDigest()).toBe(second);
	adapter.adoptCommittedRecord(recordFixture());
	expect(adapter.currentRecordDigest()).toBe(first);
});

test("catalog-only reads isolate entries without decoding or cloning the project", () => {
	const initialRecord = recordFixture();
	const initialAssets = [
		{ id: "asset", name: "source", type: "image" as const },
	];
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets,
	});
	const clone = spyOn(globalThis, "structuredClone");
	let catalog;
	try {
		catalog = adapter.currentAssetCatalog();
		expect(clone).toHaveBeenCalledTimes(1);
		expect(clone.mock.calls[0][0]).toEqual(initialAssets);
	} finally {
		clone.mockRestore();
	}
	expect(catalog).toEqual(initialAssets);
	Reflect.set(catalog[0], "name", "caller edit");
	catalog.push({ id: "added", name: "added", type: "image" });
	expect(initialAssets[0].name).toBe("source");
	expect(adapter.currentAssetCatalog()).toEqual(initialAssets);
	const document = adapter.decode({
		projectId: TEST_PROJECT_ID,
		record: initialRecord,
	});
	const encoded = adapter.encode({
		projectId: TEST_PROJECT_ID,
		previousRecord: initialRecord,
		document,
	});
	adapter.adoptCommittedRecord(encoded.record);
	initialAssets[0].name = "later fallback mutation";
	expect(adapter.currentAssetCatalog()[0].name).toBe("source");
	expect(adapter.currentAssetCatalog()).toEqual(
		adapter.currentDraft().assetCatalog,
	);
	expect(initialRecord).toEqual(recordFixture());
});

test("currentDraft decodes an isolated snapshot without cloning that fresh snapshot again", () => {
	const initialRecord = recordFixture();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [],
	});
	const clone = spyOn(globalThis, "structuredClone");
	try {
		const first = adapter.currentDraft();
		expect(clone.mock.calls.some(([value]) => value === first)).toBe(false);
		// The decoded draft is already owned by this call. It must not be
		// passed through one more complete project/asset-catalog clone.
		expect(
			clone.mock.calls.some(
				([value]) =>
					value &&
					typeof value === "object" &&
					"project" in value &&
					"assetCatalog" in value,
			),
		).toBe(false);
		first.project.metadata.name = "caller edit";
		first.project.scenes[0].name = "caller scene";
		first.assetCatalog.push({ id: "caller", name: "caller", type: "image" });
		const second = adapter.currentDraft();
		expect(second.project.metadata.name).not.toBe("caller edit");
		expect(second.project.scenes[0].name).not.toBe("caller scene");
		expect(second.assetCatalog).toEqual([]);
		expect(initialRecord).toEqual(recordFixture());
	} finally {
		clone.mockRestore();
	}
});

test("consumeReceipt transfers its private copy once without exposing adapter or encoder state", () => {
	const initialRecord = recordFixture();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord,
		initialAssets: [],
	});
	const document = adapter.decode({
		projectId: TEST_PROJECT_ID,
		record: initialRecord,
	});
	const encoded = adapter.encode({
		projectId: TEST_PROJECT_ID,
		previousRecord: initialRecord,
		document,
	});
	const before = structuredClone(encoded.record);
	const clone = spyOn(globalThis, "structuredClone");
	let receipt;
	try {
		receipt = adapter.consumeReceipt();
		expect(receipt).not.toBeNull();
		expect(clone).not.toHaveBeenCalled();
		expect(adapter.consumeReceipt()).toBeNull();
	} finally {
		clone.mockRestore();
	}
	if (!receipt) throw new Error("missing receipt");
	Reflect.set(receipt.record, "schemaVersion", -1);
	receipt.draft.project.metadata.name = "consumer mutation";
	receipt.draft.project.scenes[0].name = "consumer scene";
	expect(encoded.record).toEqual(before);
	expect(adapter.currentDraft().project.metadata.name).not.toBe(
		"consumer mutation",
	);
	adapter.encode({
		projectId: TEST_PROJECT_ID,
		previousRecord: initialRecord,
		document,
	});
	const next = adapter.consumeReceipt();
	expect(next?.record.schemaVersion).toBe(initialRecord.schemaVersion);
	expect(next?.draft.project.scenes[0].name).not.toBe("consumer scene");
});
