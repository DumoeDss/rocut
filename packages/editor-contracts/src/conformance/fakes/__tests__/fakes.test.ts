import { describe, expect, test } from "bun:test";

import { ProjectStoreError } from "@opencut/editor-ports";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";

import {
	assetId,
	markerId,
	mediaTime,
	revisionOf,
	trackId,
} from "../../..";
import type { TransactionPlacementPolicy } from "../../../engine";
import type { VectorSeedDocument } from "../../../vectors";
import { createProjectStoreConformanceFactories } from "..";

function markerOperation(id: string) {
	return {
		kind: "create-marker" as const,
		marker: {
			id: markerId(id),
			time: mediaTime({ ticks: 0 }),
			note: id,
		},
	};
}

function trackOperation(id: string) {
	return {
		kind: "create-track" as const,
		track: {
			id: trackId(id),
			kind: "graphic" as const,
			name: id,
			hidden: false,
		},
	};
}

function inMemoryFactories() {
	return createProjectStoreConformanceFactories({
		createStore: () => new InMemoryProjectStore(),
	});
}

describe("ProjectStore conformance factories", () => {
	test("invokes createStore for every factory and isolates their state", async () => {
		const stores: InMemoryProjectStore[] = [];
		const factories = createProjectStoreConformanceFactories({
			createStore: async () => {
				const store = new InMemoryProjectStore();
				stores.push(store);
				return store;
			},
		});

		const first = await factories.engine();
		await first.engine.apply({ operations: [markerOperation("isolated")] });
		const second = await factories.engine();
		const draft = await factories.draft();
		await factories.vectors.openRelative({ vectorId: "relative-isolation" });

		expect(stores).toHaveLength(4);
		expect(await first.engine.markers()).toHaveLength(1);
		expect(await second.engine.markers()).toHaveLength(0);
		expect(await draft.engine.markers()).toHaveLength(0);
	});

	test("reopens an engine on its fixture's original store", async () => {
		let createCalls = 0;
		const factories = createProjectStoreConformanceFactories({
			createStore: () => {
				createCalls += 1;
				return new InMemoryProjectStore();
			},
		});
		const fixture = await factories.engine();
		await fixture.engine.apply({
			operations: [markerOperation("survives-reopen")],
			idempotencyKey: "same-store-reopen",
		});

		const reopened = await fixture.reopen();

		expect(createCalls).toBe(1);
		expect(await reopened.markers()).toEqual([
			expect.objectContaining({ id: markerId("survives-reopen") }),
		]);
		expect(Number(await reopened.revision())).toBe(1);
	});

	test("forwards engine options and preserves opaque persisted data", async () => {
		let policyCalls = 0;
		const policy: TransactionPlacementPolicy = {
			evaluate() {
				policyCalls += 1;
				return [];
			},
		};
		const fixture = await inMemoryFactories().engine({
			profile: "engine",
			opaque: { authorSentinel: { retained: true } },
			optionalFeatures: { "author-engine-option": true },
			placementPolicies: [policy],
		});

		await fixture.engine.apply({ operations: [markerOperation("engine-options")] });
		const capabilities = await fixture.engine.capabilities();
		const persisted = await fixture.readPersistedRecord();

		expect(capabilities["author-engine-option"]).toBe(true);
		expect(policyCalls).toBe(1);
		expect(persisted.data).toMatchObject({
			authorSentinel: { retained: true },
		});
	});

	test("forwards draft options and excludes seed work from counters", async () => {
		let policyCalls = 0;
		const policy: TransactionPlacementPolicy = {
			evaluate() {
				policyCalls += 1;
				return [];
			},
		};
		const retained = assetId("retained-by-author");
		const fixture = await inMemoryFactories().draft({
			seedOperations: [markerOperation("draft-seed")],
			retainedAssetIds: [retained],
			placementPolicies: [policy],
			snapshotRevisionSequence: [revisionOf(41), revisionOf(42)],
			snapshotAttempts: 3,
			optionalFeatures: { "author-draft-option": true },
		});

		expect(await fixture.engine.markers()).toEqual([
			expect.objectContaining({ id: markerId("draft-seed") }),
		]);
		expect(fixture.saveCount()).toBe(0);
		expect(fixture.applyCount()).toBe(0);
		expect(fixture.watchCount()).toBe(0);
		expect(Number(await fixture.engine.revision())).toBe(41);
		expect(Number(await fixture.engine.revision())).toBe(42);
		expect((await fixture.engine.capabilities())["author-draft-option"]).toBe(
			true,
		);
		const opened = await fixture.manager.open({
			id: "retention-option",
			approvalMode: "manual",
		});
		if (!opened.opened) throw new Error(opened.error.message);
		const snapshot = opened.session.snapshot();
		expect(
			await fixture.retention.preflight({
				draftId: snapshot.id,
				candidate: snapshot.working,
				referencedAssetIds: [retained],
			}),
		).toMatchObject({ retained: true });
		const validation = await fixture.engine.validate({
			operations: [trackOperation("draft-policy")],
		});
		expect(validation.valid).toBe(true);
		expect(policyCalls).toBe(2);
	});

	test("observes successful, failed, and paused engine saves", async () => {
		const fixture = await inMemoryFactories().engine({ profile: "engine" });
		expect(fixture.saveCount()).toBe(0);

		await fixture.engine.apply({ operations: [markerOperation("saved")] });
		expect(fixture.saveCount()).toBe(1);

		fixture.failNextSave();
		let failure: unknown;
		try {
			await fixture.engine.apply({ operations: [markerOperation("failed")] });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(ProjectStoreError);
		expect(fixture.saveCount()).toBe(2);
		expect(await fixture.engine.markers()).toHaveLength(1);

		const pause = fixture.pauseNextSave();
		let settled = false;
		const applying = fixture.engine
			.apply({ operations: [markerOperation("paused")] })
			.finally(() => {
				settled = true;
			});
		await pause.entered;
		expect(fixture.saveCount()).toBe(3);
		expect(settled).toBe(false);
		pause.release();
		await applying;
		expect(await fixture.engine.markers()).toHaveLength(2);
	});

	test("opens seeded and relative vector targets over fresh stores", async () => {
		let createCalls = 0;
		const factories = createProjectStoreConformanceFactories({
			createStore: () => {
				createCalls += 1;
				return new InMemoryProjectStore();
			},
		});
		const document: VectorSeedDocument = {
			project: {
				id: "author-vector-project",
				name: "Author vector project",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
			tracks: [
				{
					id: "author-vector-track",
					kind: "graphic",
					name: "Author vector track",
					hidden: false,
				},
			],
			clips: [],
			assets: [],
			markers: [
				{ id: "author-vector-marker", time: 0, note: "seeded" },
			],
		};
		const seeded = await factories.vectors.openSeeded!({
			document,
			vectorId: "seeded-vector",
		});
		const relative = await factories.vectors.openRelative({
			vectorId: "relative-vector",
		});

		expect(createCalls).toBe(2);
		expect(await seeded.target.project()).toMatchObject({
			id: "author-vector-project",
		});
		expect(await seeded.target.tracks()).toEqual([
			expect.objectContaining({ id: "author-vector-track" }),
		]);
		expect(await seeded.target.markers()).toEqual([
			expect.objectContaining({ id: "author-vector-marker" }),
		]);
		expect(await relative.target.project()).not.toMatchObject({
			id: "author-vector-project",
		});
		expect(await relative.target.tracks()).toHaveLength(0);
	});

	test("prefixes setup failures but preserves ProjectStoreError ownership", async () => {
		const unavailable = createProjectStoreConformanceFactories({
			createStore: () => {
				throw new Error("adapter unavailable");
			},
		});
		await expect(unavailable.engine()).rejects.toThrow(
			/^contract fakes: engine createStore: adapter unavailable$/,
		);

		const storeError = new ProjectStoreError({
			code: "unavailable",
			operation: "save-project",
			scope: { kind: "store" },
			message: "author store unavailable",
		});
		class SeedFailingStore extends InMemoryProjectStore {
			override async save(
				_args: Parameters<InMemoryProjectStore["save"]>[0],
			): Promise<void> {
				throw storeError;
			}
		}
		const seedFailing = createProjectStoreConformanceFactories({
			createStore: () => new SeedFailingStore(),
		});
		let observed: unknown;
		try {
			await seedFailing.engine();
		} catch (error) {
			observed = error;
		}
		expect(observed).toBe(storeError);
	});

	test("prefixes every malformed resolved ProjectStore shape", async () => {
		const cases: ReadonlyArray<{
			readonly name: string;
			readonly value: unknown;
			readonly detail: string;
		}> = [
			{
				name: "non-object",
				value: null,
				detail: "createStore must resolve to a ProjectStore object",
			},
			{
				name: "schemaVersion",
				value: { schemaVersion: "31", load() {}, save() {} },
				detail: "ProjectStore.schemaVersion must be a number",
			},
			{
				name: "load",
				value: { schemaVersion: 31, save() {} },
				detail: "ProjectStore.load must be a function",
			},
			{
				name: "save",
				value: { schemaVersion: 31, load() {} },
				detail: "ProjectStore.save must be a function",
			},
		];

		for (const entry of cases) {
			const malformed = createProjectStoreConformanceFactories({
				// @ts-expect-error — exercises the runtime boundary against an external author.
				createStore: () => entry.value,
			});
			await expect(malformed.engine(), entry.name).rejects.toThrow(
				`contract fakes: engine createStore: ${entry.detail}`,
			);
		}
	});
});
