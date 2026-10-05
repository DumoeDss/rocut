/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Focused persistence harnesses intentionally inspect opaque records and provide narrowed EditorCore collaborators. */
import { describe, expect, spyOn, test } from "bun:test";
import { trackId } from "@opencut/editor-contracts";
import type { EditorCore } from "../..";
import { SaveManager } from "../save-manager";
import { SessionPersistenceCoordinator } from "../../../editor/persistence";
import {
	OPEN_CUT_TRANSACTION_ENVELOPE_KEY,
	ProjectMutationArbiter,
	SessionOpenCutTransactions,
} from "../../../editor/transactions/opencut";
import {
	projectFixture,
	storeFixture,
	TEST_PROJECT_ID,
} from "../../../editor/transactions/opencut/__tests__/fixture";

describe("transaction persistence coordination", () => {
	test("cache-only adoption avoids discarded project copies and keeps inputs and listeners isolated", async () => {
		const fixture = await storeFixture();
		const persistence = new SessionPersistenceCoordinator(fixture.store);
		const record = await fixture.store.load({ id: TEST_PROJECT_ID });
		if (!record) throw new Error("missing fixture record");
		const original = structuredClone(record);
		const expected = projectFixture();
		persistence.subscribeProjectRecords((snapshot) => {
			(snapshot.data as { metadata: { name: string } }).metadata.name = "listener edit";
		});
		const clone = spyOn(globalThis, "structuredClone");
		try {
			expect(await persistence.adoptCommittedProjectRecord({ record, returnProject: false })).toBeUndefined();
			expect(clone.mock.calls.filter(([value]) => value === record.data)).toHaveLength(1);
			expect(clone.mock.calls.filter(([value]) => Bun.deepEquals(value, expected))).toHaveLength(0);
		} finally {
			clone.mockRestore();
		}
		expect(record).toEqual(original);
		(record.data as { metadata: { name: string } }).metadata.name = "input edit";
		const cached = persistence.readCachedProject({ id: TEST_PROJECT_ID });
		expect(cached).toEqual(expected);
		if (!cached) throw new Error("missing cache");
		cached.metadata.name = "returned cache edit";
		expect(persistence.readCachedProject({ id: TEST_PROJECT_ID })).toEqual(expected);
		await expect(persistence.adoptCommittedProjectRecord({ record: { ...original, id: "wrong" }, returnProject: false })).rejects.toThrow("identity does not match");
		expect(persistence.readCachedProject({ id: TEST_PROJECT_ID })).toEqual(expected);
		expect(fixture.getSaveCount()).toBe(0);
	});

	test("adoption transfers its private decoded result without a second clone", async () => {
		const fixture = await storeFixture();
		const persistence = new SessionPersistenceCoordinator(fixture.store);
		const record = await fixture.store.load({ id: TEST_PROJECT_ID });
		if (!record) throw new Error("missing fixture record");
		const original = structuredClone(record);
		const received: (typeof record)[] = [];
		persistence.subscribeProjectRecords((snapshot) => {
			(snapshot.data as { metadata: { name: string } }).metadata.name =
				"listener mutation";
		});
		persistence.subscribeProjectRecords((snapshot) => received.push(snapshot));
		const clone = spyOn(globalThis, "structuredClone");
		let adopted;
		try {
			adopted = await persistence.adoptCommittedProjectRecord({ record });
			// The fresh decoded project is copied only for the private cache.
			// Returning another full clone used to create two equal clone inputs.
			expect(
				clone.mock.calls.filter(([value]) => Bun.deepEquals(value, adopted)),
			).toHaveLength(1);
		} finally {
			clone.mockRestore();
		}
		expect(record).toEqual(original);
		expect(received).toEqual([original]);
		const expected = structuredClone(adopted);
		adopted.metadata.name = "caller mutation";
		adopted.scenes[0].name = "caller scene";
		(record.data as { metadata: { name: string } }).metadata.name =
			"input mutation";
		const cached = persistence.readCachedProject({ id: TEST_PROJECT_ID });
		expect(cached).toEqual(expected);
		expect(received).toEqual([original]);
		if (!cached) throw new Error("missing cached project");
		await persistence.saveProject({ project: cached });
		const saved = await fixture.store.load({ id: TEST_PROJECT_ID });
		expect((saved?.data as Record<string, unknown>).nestedOpaque).toEqual(
			(original.data as Record<string, unknown>).nestedOpaque,
		);
		expect(persistence.readCachedProject({ id: TEST_PROJECT_ID })).toEqual(
			expected,
		);
	});

	test("adopts the exact committed record without a second save", async () => {
		const fixture = await storeFixture();
		const persistence = new SessionPersistenceCoordinator(fixture.store);
		const record = await fixture.store.load({ id: TEST_PROJECT_ID });
		if (!record) throw new Error("missing fixture record");
		const data = {
			...(record.data as Record<string, unknown>),
			metadata: {
				...((record.data as { metadata: Record<string, unknown> }).metadata ??
					{}),
				name: "Adopted",
			},
		};
		await persistence.adoptCommittedProjectRecord({
			record: { ...record, data },
		});
		expect(fixture.getSaveCount()).toBe(0);
		expect(
			persistence.readCachedProject({ id: TEST_PROJECT_ID })?.metadata.name,
		).toBe("Adopted");
	});

	test("already-durable publications suppress only their own dirty signals", async () => {
		let sceneListener: () => void = () => undefined;
		let timelineListener: () => void = () => undefined;
		let saves = 0;
		const editor = {
			scenes: {
				subscribe: (listener: () => void) => {
					sceneListener = listener;
					return () => undefined;
				},
			},
			timeline: {
				subscribe: (listener: () => void) => {
					timelineListener = listener;
					return () => undefined;
				},
			},
			project: {
				getActive: () => projectFixture(),
				getIsLoading: () => false,
				getMigrationState: () => ({ isMigrating: false }),
				saveCurrentProject: async () => {
					saves += 1;
				},
			},
			resources: undefined,
		} as unknown as EditorCore;
		const save = new SaveManager({ editor, debounceMs: 0 });
		save.start();
		save.publishAlreadyDurable(() => {
			sceneListener();
			timelineListener();
		});
		await Promise.resolve();
		expect(save.getIsDirty()).toBe(false);
		expect(saves).toBe(0);

		save.markDirty();
		save.publishAlreadyDurable(() => sceneListener());
		expect(save.getIsDirty()).toBe(true);
		await save.flush();
		expect(saves).toBe(1);
	});

	for (const order of ["transaction-first", "legacy-first"] as const) {
		test(`serializes ${order} without losing metadata or opaque siblings`, async () => {
			const fixture = await storeFixture();
			const arbiter = new ProjectMutationArbiter();
			const persistence = new SessionPersistenceCoordinator(
				fixture.store,
				arbiter,
			);
			await persistence.loadProject({ id: TEST_PROJECT_ID });
			const facade = new SessionOpenCutTransactions({
				persistence,
				arbiter,
				publish: () => undefined,
			});
			await facade.open({ projectId: TEST_PROJECT_ID, assets: [] });
			const legacyProject = projectFixture();
			legacyProject.settings.background = {
				type: "color",
				color: "#123456",
			};
			const transaction = () =>
				facade.apply({
					operations: [
						{
							kind: "update-track",
							trackId: trackId("main-track"),
							patch: { name: "transaction" },
						},
					],
				});
			const legacy = () => persistence.saveProject({ project: legacyProject });
			const promises =
				order === "transaction-first"
					? [transaction(), legacy()]
					: [legacy(), transaction()];
			await Promise.all(promises);
			const record = await fixture.store.load({ id: TEST_PROJECT_ID });
			const data = record?.data as Record<string, unknown>;
			expect(
				(data[OPEN_CUT_TRANSACTION_ENVELOPE_KEY] as { revision: number })
					.revision,
			).toBe(1);
			expect((data.nestedOpaque as { sentinel: unknown }).sentinel).toEqual([
				"keep",
				{ value: 42 },
			]);
			expect(
				(data.settings as { background: { color: string } }).background.color,
			).toBe("#123456");
		});
	}
});
