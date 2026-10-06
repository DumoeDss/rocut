import { expect, spyOn, test } from "bun:test";
import { projectId, revisionOf } from "../..";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { openTransactionEngine } from "../engine";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";
import type { TransactionEngineDocument } from "../types";

test("publication owns its candidate without recloning it after durable save", async () => {
	const id = projectId("private-commit-candidate");
	const { store } = createInMemoryProjectStoreFixture();
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Original",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
		}),
	);
	const adapter = createTransactionNativeDocumentAdapter();
	const encode = adapter.encode.bind(adapter);
	let exposed: TransactionEngineDocument | undefined;
	adapter.encode = (args) => {
		exposed = args.document;
		return encode(args);
	};
	const engine = await openTransactionEngine({
		store,
		projectId: id,
		documentAdapter: adapter,
	});
	const save = store.save.bind(store);
	let durable = false;
	let rejectSave = false;
	store.save = async (args) => {
		expect(await engine.revision()).toBe(revisionOf(durable ? 1 : 0));
		if (rejectSave) throw new Error("injected save failure");
		await save(args);
		durable = true;
	};
	const revisions: number[] = [];
	engine.watch((revision) => revisions.push(Number(revision)));
	const clone = globalThis.structuredClone;
	let publicationCopies = 0;
	const cloning = spyOn(globalThis, "structuredClone").mockImplementation(
		(value, options) => {
			if (
				durable &&
				value &&
				typeof value === "object" &&
				"tracks" in value &&
				"idempotency" in value
			) {
				publicationCopies += 1;
			}
			return clone(value, options);
		},
	);
	try {
		await engine.apply({
			expectedRevision: revisionOf(0),
			idempotencyKey: "first-edit",
			operations: [
				{ kind: "update-project", projectId: id, patch: { name: "Saved" } },
			],
		});
	} finally {
		cloning.mockRestore();
	}
	expect(publicationCopies).toBe(0);
	expect(revisions).toEqual([1]);
	if (!exposed?.project) throw new Error("adapter did not receive a project");
	Reflect.set(exposed.project, "name", "adapter mutation");
	Reflect.set(exposed, "revision", revisionOf(90));
	expect((await engine.project())?.name).toBe("Saved");
	expect(await engine.revision()).toBe(revisionOf(1));
	const returned = await engine.project();
	if (!returned) throw new Error("missing committed project");
	Reflect.set(returned, "name", "reader mutation");
	expect((await engine.project())?.name).toBe("Saved");

	rejectSave = true;
	await expect(
		engine.apply({
			expectedRevision: revisionOf(1),
			operations: [
				{ kind: "update-project", projectId: id, patch: { name: "Unsaved" } },
			],
		}),
	).rejects.toThrow("injected save failure");
	expect((await engine.project())?.name).toBe("Saved");
	expect(await engine.revision()).toBe(revisionOf(1));
	expect(revisions).toEqual([1]);
	rejectSave = false;
	await engine.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{ kind: "update-project", projectId: id, patch: { name: "Recovered" } },
		],
	});
	expect((await engine.project())?.name).toBe("Recovered");
	expect(revisions).toEqual([1, 2]);
});
