import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ProjectStoreError } from "@opencut/editor-ports";
import type {
	BrowserMediaBinding,
	BrowserStorageIdentity,
} from "../browser-project-store-internals";

interface MechanismState {
	rows: Record<string, unknown>[];
	libraryRows: Record<string, unknown>[];
	databaseNames: string[];
	directoryNames: string[];
	calls: string[];
}

const mechanism: MechanismState = {
	rows: [],
	libraryRows: [],
	databaseNames: [],
	directoryNames: [],
	calls: [],
};

function upsert(value: Record<string, unknown>): void {
	const index = mechanism.rows.findIndex((row) => row.id === value.id);
	if (index === -1) mechanism.rows.push(structuredClone(value));
	else mechanism.rows[index] = structuredClone(value);
}

mock.module("../browser-storage-mechanisms", () => ({
	idbGet: async (args: { key: string; store: string }) => {
		mechanism.calls.push("idbGet");
		const source = args.store.endsWith("-library-clear-bindings")
			? mechanism.libraryRows
			: mechanism.rows;
		return structuredClone(source.find((row) => row.id === args.key)) ?? null;
	},
	idbGetAll: async (args: { store: string }) => {
		const readingLibraries = args.store.endsWith("-library-clear-bindings");
		mechanism.calls.push(readingLibraries ? "idbGetAllLibrary" : "idbGetAll");
		return structuredClone(
			readingLibraries ? mechanism.libraryRows : mechanism.rows,
		);
	},
	idbPut: async (args: { value: Record<string, unknown> }) => {
		mechanism.calls.push("idbPut");
		upsert(args.value);
	},
	idbPutMany: async (args: { values: readonly Record<string, unknown>[] }) => {
		mechanism.calls.push("idbPutMany");
		for (const value of args.values) upsert(value);
	},
	inspectDatabaseNames: async () => {
		mechanism.calls.push("inspectDatabaseNames");
		return { kind: "available" as const, names: mechanism.databaseNames };
	},
	listRootEntries: async () => {
		mechanism.calls.push("listRootEntries");
		return mechanism.directoryNames;
	},
}));

await import("../../../editor/session/__tests__/wasm-test-mock");
const { mediaBindingFingerprint } =
	await import("../browser-project-store-internals");
const { prepareLibraryClearAuthorization } =
	await import("../browser-project-store-library-clear-bindings");
const { opportunisticallyCertifyMediaOwnership, registerMediaOwner } =
	await import("../browser-project-store-media-ownership");

const context = {
	operation: "save-attachment" as const,
	scope: { kind: "project" as const, projectId: "asset" },
};

function storageIdentity(
	overrides: Partial<BrowserStorageIdentity> = {},
): BrowserStorageIdentity {
	return {
		identity: "media-topology-test",
		projectsDatabase: "control-project-stage",
		projectsStore: "projects",
		mediaDatabasePrefix: "current-db-",
		mediaStore: "media",
		libraryDatabase: "control-library-stage",
		libraryStore: "library",
		mediaDirectoryPrefix: "current-root-",
		...overrides,
	};
}

async function persistedBinding(binding: BrowserMediaBinding): Promise<{
	fingerprint: string;
	record: Record<string, unknown>;
}> {
	const fingerprint = await mediaBindingFingerprint(binding);
	return {
		fingerprint,
		record: {
			id: `.c5-media-binding:${fingerprint}`,
			__opencutMediaOwner: {
				revision: 2,
				kind: "binding",
				fingerprint,
				binding,
			},
		},
	};
}

async function retainedLibraryDescriptor(args: {
	identity: BrowserStorageIdentity;
	database: string;
	store: string;
}): Promise<Record<string, unknown>> {
	const prepared = await prepareLibraryClearAuthorization({
		identity: args.identity,
		binding: {
			revision: 1,
			projectsDatabase: args.identity.projectsDatabase,
			projectsStore: args.identity.projectsStore,
			libraryDatabase: args.database,
			libraryStore: args.store,
		},
		context,
	});
	return prepared.descriptor;
}

function persistedOwner(args: {
	fingerprint: string;
	projectId: string;
}): Record<string, unknown> {
	return {
		id: `.c5-media-owner-v2:${args.fingerprint}:${encodeURIComponent(args.projectId)}`,
		__opencutMediaOwner: {
			revision: 2,
			kind: "owner",
			fingerprint: args.fingerprint,
			projectId: args.projectId,
		},
	};
}

async function expectUnavailableWithoutWrites(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	physicalNames: readonly string[];
}): Promise<void> {
	let thrown: unknown;
	try {
		await registerMediaOwner({
			identity: args.identity,
			projectId: args.projectId,
			context,
		});
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(ProjectStoreError);
	if (!(thrown instanceof ProjectStoreError)) return;
	expect(thrown.code).toBe("unavailable");
	for (const name of args.physicalNames) {
		expect(String(thrown)).not.toContain(name);
	}
	expect(mechanism.calls).not.toContain("idbPut");
	expect(mechanism.calls).not.toContain("idbPutMany");
	expect(mechanism.calls).not.toContain("inspectDatabaseNames");
	expect(mechanism.calls).not.toContain("listRootEntries");
}

beforeEach(() => {
	mechanism.rows = [];
	mechanism.libraryRows = [];
	mechanism.databaseNames = [];
	mechanism.directoryNames = [];
	mechanism.calls = [];
});

describe("browser media ownership topology gate", () => {
	test("rejects current media databases that alias every protected database before I/O", async () => {
		const projectId = "stage";
		for (const database of [
			"control-project-stage",
			"control-library-stage",
			"control-project-stage-c5-projects-stage",
			"control-project-stage-c5-attachments-stage",
		]) {
			mechanism.calls = [];
			await expectUnavailableWithoutWrites({
				identity: storageIdentity({
					mediaDatabasePrefix: database.slice(0, -projectId.length),
				}),
				projectId,
				physicalNames: [database],
			});
			expect(mechanism.calls).toEqual(["idbGetAllLibrary"]);
		}
	});

	test("rejects retained library database aliases before media ownership writes", async () => {
		for (const libraryStore of ["media", "retained-library"] as const) {
			const identity = storageIdentity();
			mechanism.libraryRows = [
				await retainedLibraryDescriptor({
					identity,
					database: "current-db-asset",
					store: libraryStore,
				}),
			];
			mechanism.calls = [];

			await expectUnavailableWithoutWrites({
				identity,
				projectId: "asset",
				physicalNames: ["current-db-asset", libraryStore],
			});

			expect(mechanism.calls).toEqual(["idbGetAllLibrary"]);
		}
	});

	test("loads one library snapshot and preserves safe idempotent registration", async () => {
		const identity = storageIdentity();
		mechanism.libraryRows = [
			await retainedLibraryDescriptor({
				identity,
				database: "retained-library-database",
				store: "retained-library",
			}),
		];
		const binding = await persistedBinding({
			revision: 1,
			mediaDatabasePrefix: identity.mediaDatabasePrefix,
			mediaStore: identity.mediaStore,
			mediaDirectoryPrefix: identity.mediaDirectoryPrefix,
		});
		mechanism.rows = [
			binding.record,
			persistedOwner({ fingerprint: binding.fingerprint, projectId: "asset" }),
		];
		mechanism.calls = [];

		await registerMediaOwner({ identity, projectId: "asset", context });

		expect(mechanism.calls).toEqual([
			"idbGetAllLibrary",
			"idbGetAll",
			"idbPutMany",
		]);
	});

	test("rejects different persisted owners with an exact database or OPFS root collision", async () => {
		for (const scenario of [
			{
				identity: storageIdentity(),
				binding: {
					revision: 1 as const,
					mediaDatabasePrefix: "current-db-a",
					mediaStore: "media",
					mediaDirectoryPrefix: "old-root-",
				},
				oldProjectId: "sset",
			},
			{
				identity: storageIdentity(),
				binding: {
					revision: 1 as const,
					mediaDatabasePrefix: "old-db-",
					mediaStore: "media",
					mediaDirectoryPrefix: "current-root-a",
				},
				oldProjectId: "sset",
			},
		]) {
			const persisted = await persistedBinding(scenario.binding);
			mechanism.rows = [
				persisted.record,
				persistedOwner({
					fingerprint: persisted.fingerprint,
					projectId: scenario.oldProjectId,
				}),
			];
			mechanism.calls = [];
			await expectUnavailableWithoutWrites({
				identity: scenario.identity,
				projectId: "asset",
				physicalNames: ["current-db-asset", "current-root-asset"],
			});
			expect(mechanism.calls).toEqual(["idbGetAllLibrary", "idbGetAll"]);
		}
	});

	test("keeps exact same-owner tuple registration idempotent", async () => {
		const identity = storageIdentity();
		const binding = await persistedBinding({
			revision: 1,
			mediaDatabasePrefix: identity.mediaDatabasePrefix,
			mediaStore: identity.mediaStore,
			mediaDirectoryPrefix: identity.mediaDirectoryPrefix,
		});
		mechanism.rows = [
			binding.record,
			persistedOwner({ fingerprint: binding.fingerprint, projectId: "asset" }),
		];

		await registerMediaOwner({ identity, projectId: "asset", context });

		expect(mechanism.calls).toEqual([
			"idbGetAllLibrary",
			"idbGetAll",
			"idbPutMany",
		]);
	});

	test("does not certify inventory that resolves a protected media database", async () => {
		const identity = storageIdentity({
			mediaDatabasePrefix: "control-project-",
		});
		const binding = await persistedBinding({
			revision: 1,
			mediaDatabasePrefix: identity.mediaDatabasePrefix,
			mediaStore: identity.mediaStore,
			mediaDirectoryPrefix: identity.mediaDirectoryPrefix,
		});
		mechanism.rows = [binding.record];
		mechanism.databaseNames = [identity.projectsDatabase];

		const certified = await opportunisticallyCertifyMediaOwnership({
			identity,
		});

		expect(certified).toBe(false);
		expect(mechanism.calls).toEqual([
			"idbGetAllLibrary",
			"idbGetAll",
			"inspectDatabaseNames",
			"listRootEntries",
		]);
	});

	test("does not certify an inventory name claimed by two bindings", async () => {
		const identity = storageIdentity({ mediaDatabasePrefix: "shared-" });
		const current = await persistedBinding({
			revision: 1,
			mediaDatabasePrefix: identity.mediaDatabasePrefix,
			mediaStore: identity.mediaStore,
			mediaDirectoryPrefix: identity.mediaDirectoryPrefix,
		});
		const retained = await persistedBinding({
			revision: 1,
			mediaDatabasePrefix: "shared-a",
			mediaStore: identity.mediaStore,
			mediaDirectoryPrefix: "retained-root-",
		});
		mechanism.rows = [current.record, retained.record];
		mechanism.databaseNames = ["shared-asset"];

		const certified = await opportunisticallyCertifyMediaOwnership({
			identity,
		});

		expect(certified).toBe(false);
		expect(mechanism.calls).toEqual([
			"idbGetAllLibrary",
			"idbGetAll",
			"inspectDatabaseNames",
			"listRootEntries",
		]);
	});
});
