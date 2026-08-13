import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ProjectStoreError } from "@opencut/editor-ports";
import type {
	BrowserMediaBinding,
	BrowserStorageIdentity,
	BrowserStoreDiagnostic,
} from "../browser-project-store-internals";
import type { BrowserLibraryClearBindingV1 } from "../browser-project-store-library-clear-bindings";

interface MechanismState {
	readonly rows: Map<string, Record<string, unknown>[]>;
	calls: string[];
}

const mechanism: MechanismState = {
	rows: new Map(),
	calls: [],
};

function rows(store: string): Record<string, unknown>[] {
	let existing = mechanism.rows.get(store);
	if (!existing) {
		existing = [];
		mechanism.rows.set(store, existing);
	}
	return existing;
}

function upsert(args: { store: string; value: Record<string, unknown> }): void {
	const target = rows(args.store);
	const index = target.findIndex((row) => row.id === args.value.id);
	if (index === -1) target.push(structuredClone(args.value));
	else target[index] = structuredClone(args.value);
}

function removeRow(args: { store: string; key: string }): void {
	const target = rows(args.store);
	const index = target.findIndex((row) => row.id === args.key);
	if (index !== -1) target.splice(index, 1);
}

mock.module("../browser-storage-mechanisms", () => ({
	idbGet: async (args: { store: string; key: string }) => {
		mechanism.calls.push(`read-one:${args.store}`);
		return (
			structuredClone(rows(args.store).find((row) => row.id === args.key)) ??
			null
		);
	},
	idbGetAll: async (args: { store: string }) => {
		mechanism.calls.push(`read-all:${args.store}`);
		return structuredClone(rows(args.store));
	},
	idbGetAllProjectPairs: async (args: {
		projectStore: string;
		authorityStore: string;
	}) => {
		mechanism.calls.push(`read-all:${args.projectStore}`);
		const publicRows = rows(args.projectStore);
		const authorityRows = rows(args.authorityStore);
		const keys = new Set([
			...publicRows.map((row) => String(row.id)),
			...authorityRows.map((row) => String(row.id)),
		]);
		return [...keys].map((key) => ({
			key,
			publicRow: structuredClone(
				publicRows.find((row) => row.id === key) ?? null,
			),
			authorityRow: structuredClone(
				authorityRows.find((row) => row.id === key) ?? null,
			),
		}));
	},
	idbPut: async (args: { store: string; value: Record<string, unknown> }) => {
		mechanism.calls.push(`journal-put:${args.store}`);
		upsert({ store: args.store, value: args.value });
	},
	idbPutMany: async (args: {
		store: string;
		values: readonly Record<string, unknown>[];
	}) => {
		mechanism.calls.push(`write-many:${args.store}`);
		for (const value of args.values) upsert({ store: args.store, value });
	},
	idbDelete: async (args: { store: string; key: string }) => {
		mechanism.calls.push(`journal-delete:${args.store}`);
		removeRow({ store: args.store, key: args.key });
	},
	idbClear: async (args: { database: string; store: string }) => {
		mechanism.calls.push(`library-clear:${args.database}/${args.store}`);
		mechanism.rows.set(args.store, []);
	},
	idbCommitProjectRemoval: async (args: {
		projectStore: string;
		authorityStore: string;
		maintenanceStore: string;
		projectId: string;
		tombstone: Record<string, unknown>;
	}) => {
		mechanism.calls.push("logical-remove-commit");
		removeRow({ store: args.projectStore, key: args.projectId });
		removeRow({ store: args.authorityStore, key: args.projectId });
		upsert({ store: args.maintenanceStore, value: args.tombstone });
	},
	idbCommitProjectSave: async () => undefined,
	idbCommitProjectsClear: async (args: {
		projectStore: string;
		authorityStore: string;
		maintenanceStore: string;
		maintenanceValues: readonly Record<string, unknown>[];
	}) => {
		mechanism.calls.push("logical-clear-commit");
		mechanism.rows.set(args.projectStore, []);
		mechanism.rows.set(args.authorityStore, []);
		mechanism.rows.set(
			args.maintenanceStore,
			args.maintenanceValues.map((value) => structuredClone(value)),
		);
	},
	idbCommitProjectsClearWithLibraryBinding: async (args: {
		projectStore: string;
		authorityStore: string;
		maintenanceStore: string;
		bindingStore: string;
		maintenanceValues: readonly Record<string, unknown>[];
		bindingDescriptor: Record<string, unknown>;
	}) => {
		mechanism.calls.push("logical-all-clear-commit");
		mechanism.rows.set(args.projectStore, []);
		mechanism.rows.set(args.authorityStore, []);
		mechanism.rows.set(
			args.maintenanceStore,
			args.maintenanceValues.map((value) => structuredClone(value)),
		);
		upsert({ store: args.bindingStore, value: args.bindingDescriptor });
	},
	idbUpgradeCascadeJournalWithLibraryBinding: async (args: {
		maintenanceStore: string;
		bindingStore: string;
		upgradedJournal: Record<string, unknown>;
		bindingDescriptor: Record<string, unknown>;
	}) => {
		mechanism.calls.push("journal-upgrade");
		upsert({ store: args.maintenanceStore, value: args.upgradedJournal });
		upsert({ store: args.bindingStore, value: args.bindingDescriptor });
	},
	deleteDatabaseExact: async (database: string) => {
		mechanism.calls.push(`database-delete:${database}`);
	},
	removeRootDirectoryExact: async (directory: string) => {
		mechanism.calls.push(`directory-delete:${directory}`);
	},
	inspectDatabaseNames: async () => {
		mechanism.calls.push("database-inventory");
		return { kind: "available" as const, names: [] };
	},
	listRootEntries: async () => {
		mechanism.calls.push("directory-inventory");
		return [];
	},
}));

await import("../../../editor/session/__tests__/wasm-test-mock");
const { BrowserProjectStoreCascadeManager } =
	await import("../browser-project-store-cascade-manager");
const { BrowserProjectStoreControl } =
	await import("../browser-project-store-control");
const { mediaBindingFingerprint, mediaBindingForIdentity } =
	await import("../browser-project-store-internals");
const { createClearJournal, decodeCascadeCleanupRecord } =
	await import("../browser-project-store-cascade");
const { createBrowserStorageTopology, browserProjectTopologyStoreNames } =
	await import("../browser-project-store-topology");
const { libraryClearBindingFingerprint, libraryClearBindingForIdentity } =
	await import("../browser-project-store-library-clear-bindings");

function storageIdentity(
	overrides: Partial<BrowserStorageIdentity> = {},
): BrowserStorageIdentity {
	return {
		identity: "cascade-topology-test",
		projectsDatabase: "control-projects",
		projectsStore: "projects",
		mediaDatabasePrefix: "media-db-",
		mediaStore: "media",
		libraryDatabase: "control-library",
		libraryStore: "library",
		mediaDirectoryPrefix: "media-root-",
		...overrides,
	};
}

function stores(identity: BrowserStorageIdentity) {
	return browserProjectTopologyStoreNames(identity.projectsStore);
}

function manager(args: {
	identity: BrowserStorageIdentity;
	diagnostics?: BrowserStoreDiagnostic[];
	previousLibraryBinding?: BrowserLibraryClearBindingV1;
}) {
	return new BrowserProjectStoreCascadeManager({
		identity: args.identity,
		topology: createBrowserStorageTopology(args.identity),
		control: new BrowserProjectStoreControl(),
		previousLibraryBinding: args.previousLibraryBinding,
		diagnostic: (diagnostic) => args.diagnostics?.push(diagnostic),
	});
}

async function persistedMediaBinding(
	binding: BrowserMediaBinding,
): Promise<{ fingerprint: string; record: Record<string, unknown> }> {
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

function persistedMediaCoverage(fingerprint: string): Record<string, unknown> {
	return {
		id: `.c5-media-coverage:${fingerprint}`,
		__opencutMediaOwner: {
			revision: 2,
			kind: "coverage",
			fingerprint,
			coverage: "complete",
		},
	};
}

async function seedCurrentMedia(
	identity: BrowserStorageIdentity,
): Promise<void> {
	const persisted = await persistedMediaBinding(
		mediaBindingForIdentity(identity),
	);
	rows(stores(identity).mediaOwnership).push(
		persisted.record,
		persistedMediaCoverage(persisted.fingerprint),
	);
}

async function historicalTarget(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	database: string;
	directory: string;
}): Promise<{
	fingerprint: string;
	projectId: string;
	database: string;
	directory: string;
}> {
	const binding: BrowserMediaBinding = {
		revision: 1,
		mediaDatabasePrefix: args.database.slice(0, -args.projectId.length),
		mediaStore: args.identity.mediaStore,
		mediaDirectoryPrefix: args.directory.slice(0, -args.projectId.length),
	};
	const persisted = await persistedMediaBinding(binding);
	rows(stores(args.identity).mediaOwnership).push(
		persisted.record,
		persistedMediaCoverage(persisted.fingerprint),
	);
	return {
		fingerprint: persisted.fingerprint,
		projectId: args.projectId,
		database: args.database,
		directory: args.directory,
	};
}

async function seedLibraryBinding(
	identity: BrowserStorageIdentity,
): Promise<void> {
	const binding = libraryClearBindingForIdentity(identity);
	const fingerprint = await libraryClearBindingFingerprint(binding);
	rows(stores(identity).libraryClearBindings).push({
		id: `.c5-library-clear-binding:${fingerprint}`,
		__opencutLibraryClearBinding: {
			revision: 1,
			kind: "clear-authorization",
			fingerprint,
			binding,
		},
	});
}

function physicalCalls(): string[] {
	return mechanism.calls.filter(
		(call) =>
			call.startsWith("database-delete:") ||
			call.startsWith("directory-delete:") ||
			call.startsWith("library-clear:") ||
			call.startsWith("journal-") ||
			call.includes("commit"),
	);
}

async function expectUnavailable(action: () => Promise<void>): Promise<void> {
	let thrown: unknown;
	try {
		await action();
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(ProjectStoreError);
	if (thrown instanceof ProjectStoreError)
		expect(thrown.code).toBe("unavailable");
}

beforeEach(() => {
	mechanism.rows.clear();
	mechanism.calls = [];
});

describe("browser project cascade topology gate", () => {
	test("refuses current remove for PDB, LDB, SP, and SA before tombstone commit", async () => {
		const base = storageIdentity();
		const topology = createBrowserStorageTopology(base);
		for (const [projectId, database] of [
			["projects", base.projectsDatabase],
			["library", base.libraryDatabase],
			["stage", topology.names.migrationStages.projects.database],
			["stage", topology.names.migrationStages.attachments.database],
		] as const) {
			mechanism.rows.clear();
			mechanism.calls = [];
			const identity = storageIdentity({
				mediaDatabasePrefix: database.slice(0, -projectId.length),
			});
			await expectUnavailable(() =>
				manager({ identity }).commitProjectRemoval({ projectId }),
			);
			expect(physicalCalls()).toEqual([]);
			expect(rows(stores(identity).cascade)).toEqual([]);
		}
	});

	test("refuses current projects clear for PDB, LDB, SP, and SA before journal commit", async () => {
		const base = storageIdentity();
		const topology = createBrowserStorageTopology(base);
		for (const [projectId, database] of [
			["projects", base.projectsDatabase],
			["library", base.libraryDatabase],
			["stage", topology.names.migrationStages.projects.database],
			["stage", topology.names.migrationStages.attachments.database],
		] as const) {
			mechanism.rows.clear();
			mechanism.calls = [];
			const identity = storageIdentity({
				mediaDatabasePrefix: database.slice(0, -projectId.length),
			});
			await seedCurrentMedia(identity);
			rows(identity.projectsStore).push({
				id: projectId,
				__opencutProjectStore: {
					revision: 1,
					record: { id: projectId, schemaVersion: 1, data: {} },
					summary: {
						id: projectId,
						name: projectId,
						createdAt: "1970-01-01T00:00:00.000Z",
						updatedAt: "1970-01-01T00:00:00.000Z",
					},
				},
			});
			await expectUnavailable(() =>
				manager({ identity }).commitProjectsClear({
					clearScope: "projects",
				}),
			);
			expect(physicalCalls()).toEqual([]);
			expect(rows(stores(identity).cascade)).toEqual([]);
		}
	});

	test("retains a mixed historical journal and performs zero partial physical I/O", async () => {
		const identity = storageIdentity();
		const safe = await historicalTarget({
			identity,
			projectId: "safe",
			database: "historical-db-safe",
			directory: "historical-root-safe",
		});
		const unsafe = await historicalTarget({
			identity,
			projectId: "projects",
			database: identity.projectsDatabase,
			directory: "historical-root-projects",
		});
		const journal = createClearJournal({
			id: ".c5-project-clear-topology-conflict",
			clearScope: "projects",
			mediaTargets: [safe, unsafe],
			libraryTargets: [],
		});
		rows(stores(identity).cascade).push(journal);
		const before = structuredClone(journal);
		const diagnostics: BrowserStoreDiagnostic[] = [];

		await manager({ identity, diagnostics }).retryPendingCleanup();

		expect(physicalCalls()).toEqual([]);
		expect(rows(stores(identity).cascade)).toEqual([before]);
		expect(diagnostics).toEqual([
			{
				level: "warning",
				phase: "project-cascade-topology-conflict",
				operation: "clear",
				scope: { kind: "store" },
				code: "unavailable",
				retryable: false,
			},
		]);
	});

	test("keeps an exact same-owner protected historical target blocked", async () => {
		const identity = storageIdentity();
		const unsafe = await historicalTarget({
			identity,
			projectId: "projects",
			database: identity.projectsDatabase,
			directory: "historical-root-projects",
		});
		const journal = createClearJournal({
			id: ".c5-project-clear-same-owner",
			clearScope: "projects",
			mediaTargets: [unsafe],
			libraryTargets: [],
		});
		rows(stores(identity).cascade).push(journal);

		await manager({ identity }).retryPendingCleanup();

		expect(physicalCalls()).toEqual([]);
		expect(rows(stores(identity).cascade)).toEqual([journal]);
	});

	test("does not rewrite a legacy all-clear journal before its full topology permit", async () => {
		const identity = storageIdentity();
		const unsafe = await historicalTarget({
			identity,
			projectId: "projects",
			database: identity.projectsDatabase,
			directory: "historical-root-projects",
		});
		const journal = {
			id: ".c5-project-clear-legacy-topology-conflict",
			__opencutProjectCascade: {
				revision: 2,
				kind: "clear-journal",
				operation: "clear",
				scope: { kind: "store" },
				targets: [unsafe],
				clearLibrary: true,
			},
		};
		rows(stores(identity).cascade).push(journal);
		const diagnostics: BrowserStoreDiagnostic[] = [];

		await manager({
			identity,
			diagnostics,
			previousLibraryBinding: libraryClearBindingForIdentity(identity),
		}).retryPendingCleanup();

		expect(physicalCalls()).toEqual([]);
		expect(mechanism.calls).not.toContain("journal-upgrade");
		expect(rows(stores(identity).cascade)).toEqual([journal]);
		expect(diagnostics.at(-1)?.phase).toBe("project-cascade-topology-conflict");
		expect(diagnostics.at(-1)?.retryable).toBe(false);
	});

	test("strictly rejects a malformed retained library claim before clear commit", async () => {
		const identity = storageIdentity();
		await seedCurrentMedia(identity);
		rows(stores(identity).libraryClearBindings).push({
			id: ".c5-library-clear-binding:malformed",
			__opencutLibraryClearBinding: {
				revision: 1,
				kind: "clear-authorization",
				fingerprint: "malformed",
				binding: libraryClearBindingForIdentity(identity),
				extra: true,
			},
		});
		let thrown: unknown;

		try {
			await manager({ identity }).commitProjectsClear({
				clearScope: "projects",
			});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(ProjectStoreError);
		if (thrown instanceof ProjectStoreError) {
			expect(thrown.code).toBe("corrupt");
		}
		expect(physicalCalls()).toEqual([]);
	});

	test("allows all-clear when LDB equals PDB through a safe library store", async () => {
		const identity = storageIdentity({
			libraryDatabase: "control-projects",
			libraryStore: "safe-library",
		});
		await seedCurrentMedia(identity);
		await seedLibraryBinding(identity);

		await manager({ identity }).commitProjectsClear({ clearScope: "all" });

		expect(mechanism.calls).toContain("logical-all-clear-commit");
		expect(mechanism.calls).toContain(
			"library-clear:control-projects/safe-library",
		);
		expect(
			rows(stores(identity).cascade)
				.map(decodeCascadeCleanupRecord)
				.filter((record) => record?.envelope.kind === "clear-journal"),
		).toEqual([]);
	});
});
