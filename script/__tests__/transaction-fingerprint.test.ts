import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { normalizeOperationFingerprint } from "../../rust/wasm/pkg/opencut_wasm_sync.js";
import { createAutomation } from "../../packages/editor-automation/src/automation";
import { projectId, trackId } from "../../packages/editor-contracts/src";
import type { TransactionOperation } from "../../packages/editor-contracts/src";
import {
	canonicalOperationFingerprint,
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../../packages/editor-contracts/src/engine";
import { createInMemoryProjectStoreFixture } from "../../packages/editor-ports/src/in-memory";

const PREFIX = "oc-txn:v1:sha256:";
const id = projectId("fingerprint-regression");
function createTrack(name: string): TransactionOperation {
	return {
		kind: "create-track",
		track: { id: trackId(name), kind: "graphic", name, hidden: false },
	};
}

test("Rust fingerprint matches independent SHA-256 oracle, is bounded and keeps unknown formats opaque", () => {
	for (const canonical of [
		'["array",[]]',
		'["array",[["string","字幕🎬"]]]',
		'["array",' + "x".repeat(2_000_000) + "]",
	]) {
		const actual = normalizeOperationFingerprint(canonical);
		expect(actual).toBe(
			PREFIX +
				createHash("sha256")
					.update(PREFIX + "\0" + canonical)
					.digest("hex"),
		);
		expect(actual.length).toBe(PREFIX.length + 64);
		expect(normalizeOperationFingerprint(actual)).toBe(actual);
	}
	for (const unknown of ["", "oc-txn:v2:future", "oc-txn:v1:sha256:bad", "[]"])
		expect(normalizeOperationFingerprint(unknown)).toBe(unknown);
});

test("canonical distinctions and validation survive compaction", () => {
	const fingerprint = (value: unknown) =>
		normalizeOperationFingerprint(
			canonicalOperationFingerprint(value as TransactionOperation[]),
		);
	const variants = [
		[{}],
		[{ field: undefined }],
		[{ field: null }],
		[{ field: 0 }],
		[{ field: -0 }],
	];
	expect(new Set(variants.map(fingerprint)).size).toBe(variants.length);
	expect(fingerprint([{ a: 1, b: 2 }])).toBe(fingerprint([{ b: 2, a: 1 }]));
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	for (const invalid of [
		[cycle],
		[Infinity],
		[NaN],
		[new Date()],
		[() => 0],
		new Array(1),
	])
		expect(() => fingerprint(invalid)).toThrow();
});

test("legacy retries stay pure; next commit compacts all receipts; restart, conflicts and draft undo remain exact", async () => {
	const { store } = createInMemoryProjectStoreFixture();
	const adapter = createTransactionNativeDocumentAdapter();
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Before",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
			opaque: { privatePayload: "preserve" },
		}),
	);
	let saves = 0;
	const originalSave = store.save.bind(store);
	store.save = async (args) => {
		saves++;
		return originalSave(args);
	};
	const legacy = await createAutomation({ store, projectId: id });
	const batch = {
		operations: [createTrack("字幕".repeat(350_000))],
		idempotencyKey: "legacy-large",
	};
	const oldReceipt = await legacy.apply(batch);
	const before = await store.load({ id });
	if (!before) throw new Error("missing record");
	const readDocument = async () => {
		const record = await store.load({ id });
		if (!record) throw new Error("missing record");
		return adapter.decode({ projectId: id, record });
	};
	expect(
		(await readDocument()).idempotency[0].fingerprint.length,
	).toBeGreaterThan(1_000_000);
	saves = 0;
	const compact = await createAutomation({
		store,
		projectId: id,
		normalizeOperationFingerprint,
	});
	expect(await compact.apply(batch)).toEqual(oldReceipt);
	expect((await compact.engine.validate(batch)).valid).toBe(true);
	expect((await compact.engine.dryRun(batch)).accepted).toBe(true);
	expect(saves).toBe(0);
	expect(await store.load({ id })).toEqual(before);
	await expect(
		compact.apply({ ...batch, operations: [createTrack("changed")] }),
	).rejects.toThrow();
	expect(saves).toBe(0);
	await compact.apply({
		operations: [createTrack("next")],
		idempotencyKey: "next",
	});
	const after = await readDocument();
	expect(after.idempotency).toHaveLength(2);
	expect(
		after.idempotency.every(
			(entry) => entry.fingerprint.length === PREFIX.length + 64,
		),
	).toBe(true);
	expect(after.idempotency[0].result).toEqual(oldReceipt);
	const restarted = await createAutomation({
		store,
		projectId: id,
		normalizeOperationFingerprint,
	});
	expect(await restarted.apply(batch)).toEqual(oldReceipt);
	const oldHost = await createAutomation({ store, projectId: id });
	await expect(oldHost.apply(batch)).rejects.toThrow();
	const opened = await restarted.openDraft({
		id: "compact-draft",
		approvalMode: "manual",
	});
	if (!opened.opened) throw new Error(opened.error.message);
	expect(
		(await opened.session.stage({ operations: [createTrack("from-draft")] }))
			.accepted,
	).toBe(true);
	const approved = await opened.session.approve();
	if (!approved.applied) throw new Error(JSON.stringify(approved.error));
	expect(
		(await readDocument()).idempotency.every(
			(entry) => entry.fingerprint.length === PREFIX.length + 64,
		),
	).toBe(true);
	await restarted.apply(approved.receipt.undoPlan.batch);
	expect(
		(await restarted.tracks()).some((track) => track.name === "from-draft"),
	).toBe(false);
	expect(await restarted.apply(batch)).toEqual(oldReceipt);
	expect((await readDocument()).idempotency).toHaveLength(4);
	const record = await store.load({ id });
	expect((record?.data as Record<string, unknown>).privatePayload).toBe(
		"preserve",
	);
});

test("actual CLI editor-plane compacts legacy OpenCut envelopes and reopens without losing receipts", async () => {
	const {
		createOpenCutProjectRecord,
		createOpenCutTransactionDocumentAdapter,
	} = await import("../../packages/editor-classic/src/transactions");
	const { openEditorPlaneAutomation } =
		await import("../../apps/cli/src/editor-plane");
	const { store } = createInMemoryProjectStoreFixture();
	const seed = createOpenCutProjectRecord({
		projectId: id,
		name: "Legacy editor",
	});
	await store.save(seed);
	const legacy = await createAutomation({
		store,
		projectId: id,
		documentAdapter: createOpenCutTransactionDocumentAdapter({
			initialRecord: seed.record,
			initialAssets: [],
		}),
	});
	const batch = {
		operations: [
			{
				kind: "update-project" as const,
				projectId: id,
				patch: { name: "Legacy title" },
			},
		],
		idempotencyKey: "legacy-editor",
	};
	const receipt = await legacy.apply(batch);
	const opened = await openEditorPlaneAutomation({
		baseStore: store,
		projectId: id,
	});
	expect(await opened.automation.apply(batch)).toEqual(receipt);
	await opened.automation.apply({
		operations: [
			{
				kind: "update-project",
				projectId: id,
				patch: { name: "Compact title" },
			},
		],
		idempotencyKey: "compact-editor",
	});
	const record = await store.load({ id });
	if (!record) throw new Error("missing record");
	const doc = opened.adapter.decode({ projectId: id, record });
	expect(doc.idempotency).toHaveLength(2);
	expect(
		doc.idempotency.every(
			(entry) => entry.fingerprint.length === PREFIX.length + 64,
		),
	).toBe(true);
	const reopened = await openEditorPlaneAutomation({
		baseStore: store,
		projectId: id,
	});
	expect(await reopened.automation.apply(batch)).toEqual(receipt);
	expect((await reopened.automation.project())?.name).toBe("Compact title");
});
