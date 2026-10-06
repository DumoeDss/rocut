import { expect, spyOn, test } from "bun:test";
import { SessionPersistenceCoordinator } from "../session-persistence-coordinator";
import { decodeProject } from "../project-codec";
import { createOpenCutTransactionDocumentAdapter } from "../../transactions/opencut/adapter";
import {
	motionTextSequenceFixture,
	projectFixture,
	recordFixture,
	storeFixture,
	TEST_PROJECT_ID,
} from "../../transactions/opencut/__tests__/fixture";
import type { ProjectRecord } from "@opencut/editor-ports";

function populatedRecord() {
	const project = projectFixture();
	project.motionTextSequences.push(motionTextSequenceFixture());
	const record = recordFixture(project);
	if (!record.data || typeof record.data !== "object")
		throw new Error("missing data");
	const sequences = Reflect.get(record.data, "motionTextSequences");
	return { record, sequences };
}

test("private cache decode can borrow owned immutable sequences while default reads remain detached", () => {
	const { record, sequences } = populatedRecord();
	const normal = decodeProject(record.data);
	const borrowed = decodeProject(record.data, { sequenceOwnership: "borrow" });
	expect(borrowed.motionTextSequences).toBe(sequences);
	expect(normal.motionTextSequences).not.toBe(sequences);
	Reflect.set(normal.motionTextSequences[0].cues[0], "text", "reader mutation");
	expect(borrowed.motionTextSequences[0].cues[0].text).not.toBe(
		"reader mutation",
	);
});

test("owned adoption avoids data/sequence/snapshot recopy but each observer owns a separate record", async () => {
	const { record, sequences } = populatedRecord();
	const { store } = await storeFixture();
	const persistence = new SessionPersistenceCoordinator(store);
	const observed: ProjectRecord[] = [];
	persistence.subscribeProjectRecords((value) => {
		observed.push(value);
		Reflect.set(value, "schemaVersion", -1);
		const listenerSequences = Reflect.get(
			Object(value.data),
			"motionTextSequences",
		);
		Reflect.set(
			listenerSequences[0].cues[0],
			"text",
			"nested listener mutation",
		);
		const project = decodeProject(value.data);
		project.metadata.name = "listener mutation";
		Reflect.set(value, "data", project);
	});
	persistence.subscribeProjectRecords((value) => observed.push(value));
	const original = structuredClone(record);
	const clone = globalThis.structuredClone;
	let dataCopies = 0,
		sequenceCopies = 0,
		recordCopies = 0;
	const cloning = spyOn(globalThis, "structuredClone").mockImplementation(
		(value, options) => {
			if (value === record.data) dataCopies++;
			if (value === sequences) sequenceCopies++;
			if (value === record) recordCopies++;
			return clone(value, options);
		},
	);
	try {
		await persistence.adoptCommittedProjectRecord({
			record,
			returnProject: false,
			takeOwnership: true,
		});
	} finally {
		cloning.mockRestore();
	}
	expect(dataCopies).toBe(0);
	expect(sequenceCopies).toBe(0);
	expect(recordCopies).toBe(2);
	expect(observed[0]).not.toBe(observed[1]);
	expect(observed[1]).toEqual(original);
	expect(record).toEqual(original);
	const first = persistence.readCachedProject({ id: record.id });
	if (!first) throw new Error("missing cache");
	Reflect.set(
		first.motionTextSequences[0].cues[0],
		"text",
		"cache reader mutation",
	);
	first.settings.canvasSize.width = 1;
	expect(persistence.readCachedProject({ id: record.id })).toEqual(
		decodeProject(original.data),
	);
});

test("default publication snapshots before observers run and preserves live subscription iteration", async () => {
	const { record } = populatedRecord();
	const original = structuredClone(record);
	const { store } = await storeFixture();
	const persistence = new SessionPersistenceCoordinator(store);
	const received: ProjectRecord[] = [];
	let removeLater = () => {};
	persistence.subscribeProjectRecords(() => {
		Reflect.set(record, "data", {});
		removeLater();
		persistence.subscribeProjectRecords((value) => received.push(value));
	});
	removeLater = persistence.subscribeProjectRecords(() => {
		throw new Error("removed listener called");
	});
	await persistence.adoptCommittedProjectRecord({
		record,
		returnProject: false,
	});
	expect(received).toEqual([original]);
	expect(persistence.readCachedProject({ id: record.id })).toEqual(
		decodeProject(original.data),
	);
});

test("default adoption protects cache and returned project from source and observer mutation", async () => {
	const { record } = populatedRecord();
	const original = structuredClone(record);
	const { store } = await storeFixture();
	const persistence = new SessionPersistenceCoordinator(store);
	persistence.subscribeProjectRecords((value) =>
		Reflect.set(value, "data", {}),
	);
	const returned = await persistence.adoptCommittedProjectRecord({ record });
	Reflect.set(record, "data", {});
	Reflect.set(
		returned.motionTextSequences[0].cues[0],
		"text",
		"returned mutation",
	);
	expect(persistence.readCachedProject({ id: record.id })).toEqual(
		decodeProject(original.data),
	);
});

test("adapter takes its subscription-owned record without copying and still isolates subsequent reads", () => {
	const { record } = populatedRecord();
	const adapter = createOpenCutTransactionDocumentAdapter({
		initialRecord: recordFixture(),
		initialAssets: [],
	});
	const clone = spyOn(globalThis, "structuredClone");
	try {
		adapter.adoptCommittedRecord(record, { takeOwnership: true });
		expect(clone).not.toHaveBeenCalled();
	} finally {
		clone.mockRestore();
	}
	const first = adapter.currentDraft();
	Reflect.set(
		first.project.motionTextSequences[0].cues[0],
		"text",
		"reader mutation",
	);
	expect(adapter.currentDraft().project).toEqual(decodeProject(record.data));
	adapter.adoptCommittedRecord(recordFixture());
	expect(adapter.currentDraft().project.motionTextSequences).toEqual([]);
	expect(adapter.currentDraft().project.metadata.id).toBe(TEST_PROJECT_ID);
});
