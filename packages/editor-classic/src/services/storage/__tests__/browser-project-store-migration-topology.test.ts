import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type {
	BrowserStorageIdentity,
	BrowserStoreDiagnostic,
} from "../browser-project-store-internals";
import type {
	LibraryPhysicalClaim,
	MediaPhysicalClaim,
} from "../browser-project-store-topology";

if (process.env.OPENCUT_BROWSER_MIGRATION_TOPOLOGY_ISOLATED !== "1") {
	test("browser project migration topology gate runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_BROWSER_MIGRATION_TOPOLOGY_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated browser migration topology suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	interface MechanismState {
		readonly rows: Map<string, Record<string, unknown>[]>;
		calls: string[];
	}

	interface ClaimState {
		media: MediaPhysicalClaim[];
		libraries: LibraryPhysicalClaim[];
		currentMedia: Map<string, MediaPhysicalClaim>;
	}

	const mechanism: MechanismState = { rows: new Map(), calls: [] };
	const claims: ClaimState = {
		media: [],
		libraries: [],
		currentMedia: new Map(),
	};

	function rowKey(args: { database: string; store: string }): string {
		return JSON.stringify([args.database, args.store]);
	}

	function rows(args: {
		database: string;
		store: string;
	}): Record<string, unknown>[] {
		const key = rowKey(args);
		let existing = mechanism.rows.get(key);
		if (!existing) {
			existing = [];
			mechanism.rows.set(key, existing);
		}
		return existing;
	}

	function upsert(args: {
		database: string;
		store: string;
		value: Record<string, unknown>;
	}): void {
		const target = rows(args);
		const index = target.findIndex((row) => row.id === args.value.id);
		if (index === -1) target.push(structuredClone(args.value));
		else target[index] = structuredClone(args.value);
	}

	function removeRow(args: {
		database: string;
		store: string;
		key: string;
	}): void {
		const target = rows(args);
		const index = target.findIndex((row) => row.id === args.key);
		if (index !== -1) target.splice(index, 1);
	}

	function pairedRow(args: {
		database: string;
		publicStore: string;
		authorityStore: string;
		key: string;
	}): {
		publicRow: Record<string, unknown> | null;
		authorityRow: unknown | null;
	} {
		const publicRow = rows({
			database: args.database,
			store: args.publicStore,
		}).find((row) => row.id === args.key);
		const authorityRow = rows({
			database: args.database,
			store: args.authorityStore,
		}).find((row) => row.id === args.key);
		return {
			publicRow: publicRow === undefined ? null : structuredClone(publicRow),
			authorityRow:
				authorityRow === undefined ? null : structuredClone(authorityRow),
		};
	}

	function pairedRows(args: {
		database: string;
		publicStore: string;
		authorityStore: string;
	}): Array<{
		publicRow: Record<string, unknown> | null;
		authorityRow: unknown | null;
	}> {
		const keys = new Set<string>();
		for (const row of rows({
			database: args.database,
			store: args.publicStore,
		})) {
			if (typeof row.id === "string") keys.add(row.id);
		}
		for (const row of rows({
			database: args.database,
			store: args.authorityStore,
		})) {
			if (typeof row.id === "string") keys.add(row.id);
		}
		return [...keys]
			.sort((left, right) => left.localeCompare(right))
			.map((key) => pairedRow({ ...args, key }));
	}

	mock.module("../indexeddb-adapter", () => ({
		IndexedDBAdapter: class {
			private readonly database: string;
			private readonly store: string;

			constructor(args: { dbName: string; storeName: string }) {
				this.database = args.dbName;
				this.store = args.storeName;
			}

			async get(key: string): Promise<Record<string, unknown> | null> {
				mechanism.calls.push(`legacy-get:${this.database}/${this.store}`);
				const value = rows({ database: this.database, store: this.store }).find(
					(row) => row.id === key,
				);
				return value === undefined ? null : structuredClone(value);
			}
		},
		deleteDatabase: async ({ dbName }: { dbName: string }) => {
			mechanism.calls.push(`legacy-delete-database:${dbName}`);
		},
	}));

	mock.module("../browser-storage-mechanisms", () => ({
		idbGetAllProjectPairs: async (args: {
			database: string;
			projectStore: string;
			authorityStore: string;
		}) => {
			mechanism.calls.push(`read-all:${args.database}/${args.projectStore}`);
			return pairedRows({
				database: args.database,
				publicStore: args.projectStore,
				authorityStore: args.authorityStore,
			});
		},
		idbGetProjectPair: async (args: {
			database: string;
			projectStore: string;
			authorityStore: string;
			key: string;
		}) => {
			mechanism.calls.push(`read-one:${args.database}/${args.projectStore}`);
			return pairedRow({
				database: args.database,
				publicStore: args.projectStore,
				authorityStore: args.authorityStore,
				key: args.key,
			});
		},
		idbGetAllAttachmentPairs: async (args: {
			database: string;
			mediaStore: string;
			authorityStore: string;
		}) => {
			mechanism.calls.push(`read-all:${args.database}/${args.mediaStore}`);
			return pairedRows({
				database: args.database,
				publicStore: args.mediaStore,
				authorityStore: args.authorityStore,
			});
		},
		idbGetAttachmentPair: async (args: {
			database: string;
			mediaStore: string;
			authorityStore: string;
			key: string;
		}) => {
			mechanism.calls.push(`read-one:${args.database}/${args.mediaStore}`);
			return pairedRow({
				database: args.database,
				publicStore: args.mediaStore,
				authorityStore: args.authorityStore,
				key: args.key,
			});
		},
		idbCommitProjectSave: async (args: {
			database: string;
			projectStore: string;
			authorityStore: string;
			maintenanceStore: string;
			maintenanceKey: string;
			project: Record<string, unknown>;
			projectAuthority: Record<string, unknown>;
		}) => {
			mechanism.calls.push(`put:${args.database}/${args.projectStore}`);
			upsert({
				database: args.database,
				store: args.projectStore,
				value: args.project,
			});
			mechanism.calls.push(`put:${args.database}/${args.authorityStore}`);
			upsert({
				database: args.database,
				store: args.authorityStore,
				value: args.projectAuthority,
			});
			mechanism.calls.push(
				`delete-row:${args.database}/${args.maintenanceStore}`,
			);
			removeRow({
				database: args.database,
				store: args.maintenanceStore,
				key: args.maintenanceKey,
			});
		},
		idbCommitAttachment: async (args: {
			database: string;
			mediaStore: string;
			authorityStore: string;
			metadata: Record<string, unknown>;
			authority: Record<string, unknown>;
		}) => {
			mechanism.calls.push(`put:${args.database}/${args.mediaStore}`);
			upsert({
				database: args.database,
				store: args.mediaStore,
				value: args.metadata,
			});
			mechanism.calls.push(`put:${args.database}/${args.authorityStore}`);
			upsert({
				database: args.database,
				store: args.authorityStore,
				value: args.authority,
			});
		},
		idbGet: async (args: { database: string; store: string; key: string }) => {
			mechanism.calls.push(`read-one:${args.database}/${args.store}`);
			const value = rows(args).find((row) => row.id === args.key);
			return value === undefined ? null : structuredClone(value);
		},
		idbGetAll: async (args: { database: string; store: string }) => {
			mechanism.calls.push(`read-all:${args.database}/${args.store}`);
			return structuredClone(rows(args));
		},
		idbPut: async (args: {
			database: string;
			store: string;
			value: Record<string, unknown>;
		}) => {
			mechanism.calls.push(`put:${args.database}/${args.store}`);
			upsert(args);
		},
		idbDelete: async (args: {
			database: string;
			store: string;
			key: string;
		}) => {
			mechanism.calls.push(`delete-row:${args.database}/${args.store}`);
			removeRow(args);
		},
		deleteDatabaseExact: async (database: string) => {
			mechanism.calls.push(`delete-database:${database}`);
		},
		opfsRead: async (args: { directory: string }) => {
			mechanism.calls.push(`opfs-read:${args.directory}`);
			return null;
		},
	}));

	mock.module("../browser-project-store-media-ownership", () => ({
		readKnownMediaPhysicalClaims: async () => {
			mechanism.calls.push("read-known-media");
			return structuredClone(claims.media);
		},
		currentMediaPhysicalClaim: async (args: {
			identity: BrowserStorageIdentity;
			projectId: string;
		}) => {
			mechanism.calls.push(`current-media:${args.projectId}`);
			return (
				claims.currentMedia.get(args.projectId) ?? {
					fingerprint: "current-media",
					projectId: args.projectId,
					database: `${args.identity.mediaDatabasePrefix}${args.projectId}`,
					directory: `${args.identity.mediaDirectoryPrefix}${args.projectId}`,
				}
			);
		},
		registerMediaOwner: async (args: { projectId: string }) => {
			mechanism.calls.push(`register-media:${args.projectId}`);
		},
	}));

	mock.module("../browser-project-store-library-clear-bindings", () => ({
		readKnownLibraryPhysicalClaims: async () => {
			mechanism.calls.push("read-known-libraries");
			return structuredClone(claims.libraries);
		},
		decodeLibraryClearTarget: (value: unknown) => {
			if (!isRecord(value)) return null;
			const target = value;
			return target.revision === 1 &&
				target.kind === "library" &&
				typeof target.fingerprint === "string" &&
				typeof target.database === "string" &&
				typeof target.store === "string"
				? {
						revision: 1,
						kind: "library",
						fingerprint: target.fingerprint,
						database: target.database,
						store: target.store,
					}
				: null;
		},
	}));

	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { isRecord } = await import("../browser-project-store-internals");
	const { runBrowserProjectMigration, retryBrowserProjectMigrationCleanup } =
		await import("../browser-project-store-migration");
	const { browserProjectTopologyStoreNames, createBrowserStorageTopology } =
		await import("../browser-project-store-topology");

	function storageIdentity(
		overrides: Partial<BrowserStorageIdentity> = {},
	): BrowserStorageIdentity {
		return {
			identity: "migration-topology-test",
			projectsDatabase: "migration-projects",
			projectsStore: "projects",
			mediaDatabasePrefix: "migration-media-",
			mediaStore: "media",
			libraryDatabase: "migration-library",
			libraryStore: "library",
			mediaDirectoryPrefix: "migration-root-",
			...overrides,
		};
	}

	function migrationPolicy(identity: BrowserStorageIdentity) {
		return {
			kind: "disposable" as const,
			identity: identity.identity,
			prefix: "migration-topology-",
		};
	}

	function maintenanceStore(identity: BrowserStorageIdentity): string {
		return browserProjectTopologyStoreNames(identity.projectsStore)
			.migrationMaintenance;
	}

	function seedLegacyProject(args: {
		identity: BrowserStorageIdentity;
		projectId: string;
	}): void {
		upsert({
			database: args.identity.projectsDatabase,
			store: args.identity.projectsStore,
			value: {
				id: args.projectId,
				version: 30,
				metadata: {
					id: args.projectId,
					name: "legacy project",
					createdAt: "2026-08-02T00:00:00.000Z",
					updatedAt: "2026-08-02T00:00:00.000Z",
				},
				scenes: [],
				providerPrivate: { keep: true },
			},
		});
	}

	function seedLegacyV1Project(args: {
		identity: BrowserStorageIdentity;
		projectId: string;
		sceneId: string;
	}): void {
		upsert({
			database: args.identity.projectsDatabase,
			store: args.identity.projectsStore,
			value: {
				id: args.projectId,
				version: 1,
				metadata: {
					id: args.projectId,
					name: "legacy v1 project",
					createdAt: "2026-08-02T00:00:00.000Z",
					updatedAt: "2026-08-02T00:00:00.000Z",
				},
				currentSceneId: args.sceneId,
				scenes: [
					{
						id: args.sceneId,
						name: "main",
						isMain: true,
						tracks: [],
						bookmarks: [],
						createdAt: "2026-08-02T00:00:00.000Z",
						updatedAt: "2026-08-02T00:00:00.000Z",
					},
				],
				providerPrivate: { keep: true },
			},
		});
	}

	function seedLegacyTimeline(args: {
		projectId: string;
		sceneId: string;
	}): string {
		const database = `video-editor-timelines-${args.projectId}-${args.sceneId}`;
		upsert({
			database,
			store: "timeline",
			value: {
				id: "timeline",
				tracks: [],
				lastModified: "2026-08-02T00:00:00.000Z",
			},
		});
		return database;
	}

	type CleanupTargetFixture =
		| { readonly kind: "stage-database"; readonly name: string }
		| {
				readonly kind: "legacy-database";
				readonly name: string;
				readonly projectId: string;
		  };

	function seedCleanupJournal(args: {
		identity: BrowserStorageIdentity;
		targets: readonly CleanupTargetFixture[];
	}): Record<string, unknown> {
		const journal = {
			id: "postcommit-cleanup",
			revision: 1,
			targets: args.targets,
		};
		upsert({
			database: args.identity.projectsDatabase,
			store: maintenanceStore(args.identity),
			value: journal,
		});
		return structuredClone(journal);
	}

	function cleanupJournal(
		identity: BrowserStorageIdentity,
	): Record<string, unknown> | null {
		return (
			structuredClone(
				rows({
					database: identity.projectsDatabase,
					store: maintenanceStore(identity),
				}).find((row) => row.id === "postcommit-cleanup"),
			) ?? null
		);
	}

	function diagnosticCollector() {
		const diagnostics: BrowserStoreDiagnostic[] = [];
		return {
			diagnostics,
			diagnostic: (value: BrowserStoreDiagnostic) => {
				diagnostics.push(value);
			},
		};
	}

	function mutationCalls(): string[] {
		return mechanism.calls.filter(
			(call) =>
				call.startsWith("register-media:") ||
				call.startsWith("put:") ||
				call.startsWith("delete-row:") ||
				call.startsWith("delete-database:"),
		);
	}

	function expectTopologyDiagnostic(
		diagnostics: readonly BrowserStoreDiagnostic[],
	): void {
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				phase: "migration-cleanup-topology-conflict",
				code: "unavailable",
				retryable: false,
			}),
		);
	}

	function resetFixture(): void {
		mechanism.rows.clear();
		mechanism.calls = [];
		claims.media = [];
		claims.libraries = [];
		claims.currentMedia.clear();
	}

	beforeEach(resetFixture);

	describe("browser project migration topology gate", () => {
		test("authorizes a genuine v1 transformer source before it can open an aliased database", async () => {
			const base = storageIdentity();
			const projectId = `${base.identity}-preauthorization`;
			const sceneId = "protected-scene";
			const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
			const identity = storageIdentity({ libraryDatabase: timelineDatabase });
			seedLegacyV1Project({ identity, projectId, sceneId });
			seedLegacyTimeline({ projectId, sceneId });
			claims.libraries = [
				{
					fingerprint: "retained-library",
					database: timelineDatabase,
					store: "retained-library-store",
				},
			];
			const collected = diagnosticCollector();
			mechanism.calls = [];

			const outcome = await runBrowserProjectMigration({
				identity,
				policy: migrationPolicy(identity),
				context: { from: 1, to: 31, report: () => undefined },
				diagnostic: collected.diagnostic,
			});

			expect(outcome.status).toBe("failed");
			expect(mechanism.calls).toEqual([
				`read-one:${identity.projectsDatabase}/${maintenanceStore(identity)}`,
				`read-all:${identity.projectsDatabase}/${identity.projectsStore}`,
				`current-media:${projectId}`,
				`read-one:${identity.projectsDatabase}/${maintenanceStore(identity)}`,
				"read-known-media",
				"read-known-libraries",
			]);
			expect(mechanism.calls).not.toContain(
				`legacy-get:${timelineDatabase}/timeline`,
			);
			expect(mutationCalls()).toEqual([]);
			expectTopologyDiagnostic(collected.diagnostics);
		});

		test("migrates a topology-safe v1 project after authorizing its frozen source plan", async () => {
			const identity = storageIdentity();
			const projectId = `${identity.identity}-safe-v1`;
			const sceneId = "main-scene";
			const timelineDatabase = seedLegacyTimeline({ projectId, sceneId });
			seedLegacyV1Project({ identity, projectId, sceneId });
			mechanism.calls = [];

			const outcome = await runBrowserProjectMigration({
				identity,
				policy: migrationPolicy(identity),
				context: { from: 1, to: 31, report: () => undefined },
			});

			expect(outcome.status).toBe("migrated");
			const sourceRead = mechanism.calls.indexOf(
				`legacy-get:${timelineDatabase}/timeline`,
			);
			expect(sourceRead).toBeGreaterThan(-1);
			expect(mechanism.calls.indexOf("read-known-libraries")).toBeLessThan(
				sourceRead,
			);
		});

		test("refuses SP aliased by a retained LDB before owner, stage, or journal writes", async () => {
			const identity = storageIdentity();
			const projectId = `${identity.identity}-sp-library`;
			const stage =
				createBrowserStorageTopology(identity).names.migrationStages.projects
					.database;
			seedLegacyProject({ identity, projectId });
			claims.libraries = [
				{ fingerprint: "retained-library", database: stage, store: "library" },
			];
			const collected = diagnosticCollector();
			mechanism.calls = [];

			const outcome = await runBrowserProjectMigration({
				identity,
				policy: migrationPolicy(identity),
				context: { from: 30, to: 31, report: () => undefined },
				diagnostic: collected.diagnostic,
			});

			expect(outcome.status).toBe("failed");
			expect(mutationCalls()).toEqual([]);
			expectTopologyDiagnostic(collected.diagnostics);
		});

		test("refuses SA aliased by the current MDB before owner, stage, or journal writes", async () => {
			const identity = storageIdentity();
			const projectId = `${identity.identity}-sa-media`;
			const stage =
				createBrowserStorageTopology(identity).names.migrationStages.attachments
					.database;
			seedLegacyProject({ identity, projectId });
			claims.currentMedia.set(projectId, {
				fingerprint: "current-media",
				projectId,
				database: stage,
				directory: "migration-root-safe",
			});
			const collected = diagnosticCollector();
			mechanism.calls = [];

			const outcome = await runBrowserProjectMigration({
				identity,
				policy: migrationPolicy(identity),
				context: { from: 30, to: 31, report: () => undefined },
				diagnostic: collected.diagnostic,
			});

			expect(outcome.status).toBe("failed");
			expect(mutationCalls()).toEqual([]);
			expectTopologyDiagnostic(collected.diagnostics);
		});

		test("retains stage cleanup journals aliased by LDB or current MDB", async () => {
			for (const scenario of ["library", "media"] as const) {
				resetFixture();
				const identity = storageIdentity();
				const stages =
					createBrowserStorageTopology(identity).names.migrationStages;
				const target =
					scenario === "library"
						? stages.projects.database
						: stages.attachments.database;
				const before = seedCleanupJournal({
					identity,
					targets: [{ kind: "stage-database", name: target }],
				});
				if (scenario === "library") {
					claims.libraries = [
						{ fingerprint: "library", database: target, store: "library" },
					];
				} else {
					claims.media = [
						{
							fingerprint: "media",
							projectId: `${identity.identity}-media`,
							database: target,
							directory: "migration-root-media",
						},
					];
				}
				const collected = diagnosticCollector();
				mechanism.calls = [];

				await retryBrowserProjectMigrationCleanup({
					identity,
					policy: migrationPolicy(identity),
					diagnostic: collected.diagnostic,
				});

				expect(mutationCalls()).toEqual([]);
				expect(cleanupJournal(identity)).toEqual(before);
				expectTopologyDiagnostic(collected.diagnostics);
			}
		});

		test("retains legacy cleanup targets that alias PDB, LDB, or MDB", async () => {
			for (const scenario of ["projects", "library", "media"] as const) {
				resetFixture();
				const base = storageIdentity();
				const projectId = `${base.identity}-${scenario}`;
				const target = `video-editor-timelines-${projectId}`;
				const identity = storageIdentity(
					scenario === "projects"
						? { projectsDatabase: target }
						: scenario === "library"
							? { libraryDatabase: target }
							: { mediaDatabasePrefix: "video-editor-timelines-" },
				);
				if (scenario === "media") {
					claims.media = [
						{
							fingerprint: "current-media",
							projectId,
							database: target,
							directory: `${identity.mediaDirectoryPrefix}${projectId}`,
						},
					];
				}
				const before = seedCleanupJournal({
					identity,
					targets: [{ kind: "legacy-database", name: target, projectId }],
				});
				const collected = diagnosticCollector();
				mechanism.calls = [];

				await retryBrowserProjectMigrationCleanup({
					identity,
					policy: migrationPolicy(identity),
					diagnostic: collected.diagnostic,
				});

				expect(mutationCalls()).toEqual([]);
				expect(cleanupJournal(identity)).toEqual(before);
				expectTopologyDiagnostic(collected.diagnostics);
			}
		});

		test("performs zero partial cleanup and zero journal shrink for mixed historical targets", async () => {
			const base = storageIdentity();
			const unsafeProjectId = `${base.identity}-unsafe`;
			const unsafeTarget = `video-editor-timelines-${unsafeProjectId}`;
			const identity = storageIdentity({ projectsDatabase: unsafeTarget });
			const safeProjectId = `${identity.identity}-safe`;
			const before = seedCleanupJournal({
				identity,
				targets: [
					{
						kind: "legacy-database",
						name: `video-editor-timelines-${safeProjectId}`,
						projectId: safeProjectId,
					},
					{
						kind: "legacy-database",
						name: unsafeTarget,
						projectId: unsafeProjectId,
					},
				],
			});
			const collected = diagnosticCollector();
			mechanism.calls = [];

			await retryBrowserProjectMigrationCleanup({
				identity,
				policy: migrationPolicy(identity),
				diagnostic: collected.diagnostic,
			});

			expect(mutationCalls()).toEqual([]);
			expect(cleanupJournal(identity)).toEqual(before);
			expectTopologyDiagnostic(collected.diagnostics);
		});

		test("uses an authorized safe permit for early stage cleanup", async () => {
			const identity = storageIdentity();
			const projectId = `${identity.identity}-safe-early-cleanup`;
			const stages =
				createBrowserStorageTopology(identity).names.migrationStages;
			seedLegacyProject({ identity, projectId });
			mechanism.calls = [];

			const outcome = await runBrowserProjectMigration({
				identity,
				policy: migrationPolicy(identity),
				context: { from: 30, to: 31, report: () => undefined },
				hooks: {
					beforeValidation: () => {
						throw new Error("fixture validation interruption");
					},
				},
			});

			expect(outcome.status).toBe("failed");
			expect(
				mechanism.calls.filter((call) => call.startsWith("delete-database:")),
			).toEqual([
				`delete-database:${stages.projects.database}`,
				`delete-database:${stages.attachments.database}`,
			]);
			expect(cleanupJournal(identity)).toBeNull();
		});

		test("completes canonical unaliased stage self-cleanup", async () => {
			const identity = storageIdentity();
			const stages =
				createBrowserStorageTopology(identity).names.migrationStages;
			seedCleanupJournal({
				identity,
				targets: [
					{ kind: "stage-database", name: stages.projects.database },
					{ kind: "stage-database", name: stages.attachments.database },
				],
			});
			mechanism.calls = [];

			await retryBrowserProjectMigrationCleanup({
				identity,
				policy: migrationPolicy(identity),
			});

			expect(
				mechanism.calls.filter((call) => call.startsWith("delete-database:")),
			).toEqual([
				`delete-database:${stages.projects.database}`,
				`delete-database:${stages.attachments.database}`,
			]);
			expect(cleanupJournal(identity)).toBeNull();
		});
	});
}
