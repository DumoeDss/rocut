import {
	BrowserProjectStore,
	resetBrowserProjectStoreRuntimeForTests,
} from "./browser-project-store";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
import {
	ATTACHMENT_ENVELOPE_KEY,
	attachmentAuthorityStoreName,
	createDisposableBrowserStorageIdentity,
	isRecord,
	mediaBindingFingerprint,
	mediaBindingForIdentity,
	mediaDatabaseName,
	mediaDirectoryName,
	projectAuthorityStoreName,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import {
	retryBrowserProjectMigrationCleanup,
	runBrowserProjectMigration,
	type BrowserMigrationHooks,
} from "./browser-project-store-migration";
import { libraryClearBindingFingerprint } from "./browser-project-store-library-clear-bindings";
import {
	createCurrentStoredAttachmentTombstone,
	createCurrentStoredAttachment,
	decodeStoredAttachment,
	decodeStoredAttachmentPair,
	decodeStoredProjectPair,
	digestAttachmentBody,
	projectVersionFromStored,
} from "./browser-project-store-records";
import {
	cleanupDisposableBrowserStorage,
	inspectDisposableBrowserStorage,
} from "./browser-project-store-conformance";
import {
	browserMigrationStageNames,
	browserProjectTopologyStoreNames,
} from "./browser-project-store-topology";
import {
	deleteDatabaseExact,
	idbDelete,
	idbGet,
	idbGetAll,
	idbGetAttachmentPair,
	idbGetProjectPair,
	idbPut,
	idbPutMany,
	listDatabaseNames,
	listRootEntries,
	opfsRead,
	opfsRemove,
	opfsWrite,
	removeRootDirectoryExact,
} from "./browser-storage-mechanisms";

const MEDIA_OWNER_FIELD = "__opencutMediaOwner";
const LIBRARY_CLEAR_BINDING_FIELD = "__opencutLibraryClearBinding";

type RaceOperation = "save" | "remove" | "projects-clear" | "all-clear";
type RaceDirection = "migration-first" | "mutation-first";

interface Deferred {
	readonly entered: Promise<void>;
	readonly wait: Promise<void>;
	enter(): void;
	release(): void;
}

export interface BrowserMigrationRound2ProbeResult {
	readonly sameWrapperLifecycleOrdered: boolean;
	readonly crossWrapperLifecycleOrdered: boolean;
	readonly earlierMigrationOrdersLaterMutations: boolean;
	readonly earlierMutationsOrderLaterMigration: boolean;
	readonly lifecycleRaceCount: number;
	readonly lifecycleRaceFailures: number;
	readonly initializationRetriesSameInstance: boolean;
	readonly initializationDiagnosticMechanismNeutral: boolean;
	readonly cleanupIntentRecoversAcrossReload: boolean;
	readonly committedReadbackRecoversAcrossReload: boolean;
	readonly stagedProjectLaterSaveWins: boolean;
	readonly stagedProjectLaterRemoveWins: boolean;
	readonly originalProjectLaterSaveWins: boolean;
	readonly originalProjectLaterRemoveWins: boolean;
	readonly physicalAbsenceRetainsRecovery: boolean;
	readonly digestMismatchRetainsRecovery: boolean;
	readonly preRecoveryIntentLaterRemoveMigrates: boolean;
	readonly malformedPreRecoveryTombstoneRejects: boolean;
	readonly currentProjectPairNoOpPreserved: boolean;
	readonly mixedProjectPairDiscoveryAndMigration: boolean;
	readonly migrationDestinationsUseCurrentPairs: boolean;
	readonly currentAttachmentIntentSurvivesMigration: boolean;
	readonly currentAttachmentIntentLossFailsClosed: boolean;
	readonly currentAttachmentIntentSupersetFailsClosed: boolean;
	readonly oldRevision2RecoveryWithoutRetiredKeysReadable: boolean;
	readonly bareAttachmentAbsenceRetainsRecovery: boolean;
	readonly authenticatedLaterRemoveObservedByRecovery: boolean;
	readonly totalBareAttachmentAbsenceRetainsRecovery: boolean;
	readonly topologyStageCleanupAliasesRefuseBeforeMutation: boolean;
	readonly topologyLegacyCleanupAliasesRefuseBeforeMutation: boolean;
	readonly topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup: boolean;
	readonly topologyMigrationPlanningPreauthorizesAttachmentDiscovery: boolean;
	readonly cleanupProof: readonly string[];
}

export async function runBrowserProjectStoreMigrationRound2Probes(): Promise<BrowserMigrationRound2ProbeResult> {
	const prefix = "c5-migration-r2-";
	const cleanupProof: string[] = [];
	const raceResults: Array<{
		sameWrapper: boolean;
		direction: RaceDirection;
		passed: boolean;
	}> = [];
	for (const sameWrapper of [true, false]) {
		for (const direction of ["migration-first", "mutation-first"] as const) {
			for (const operation of [
				"save",
				"remove",
				"projects-clear",
				"all-clear",
			] as const) {
				raceResults.push({
					sameWrapper,
					direction,
					passed: await probeMigrationMutationRace({
						prefix,
						cleanupProof,
						sameWrapper,
						direction,
						operation,
					}),
				});
			}
		}
	}
	const initialization = await probeRetryableInitialization({
		prefix,
		cleanupProof,
	});
	const cleanupIntentRecoversAcrossReload = await probeCleanupIntentFailure({
		prefix,
		cleanupProof,
	});
	const committedReadbackRecoversAcrossReload =
		await probeCommittedReadbackFailure({ prefix, cleanupProof });
	const stagedProjectLaterSaveWins = await probeAttachmentRecoveryWinner({
		prefix,
		cleanupProof,
		phase: "staged",
		mutation: "save",
	});
	const stagedProjectLaterRemoveWins = await probeAttachmentRecoveryWinner({
		prefix,
		cleanupProof,
		phase: "staged",
		mutation: "remove",
	});
	const originalProjectLaterSaveWins = await probeAttachmentRecoveryWinner({
		prefix,
		cleanupProof,
		phase: "original",
		mutation: "save",
	});
	const originalProjectLaterRemoveWins = await probeAttachmentRecoveryWinner({
		prefix,
		cleanupProof,
		phase: "original",
		mutation: "remove",
	});
	const physicalAbsenceRetainsRecovery = await probeAmbiguousAttachmentRecovery(
		{
			prefix,
			cleanupProof,
			mutation: "physical-absence",
		},
	);
	const digestMismatchRetainsRecovery = await probeAmbiguousAttachmentRecovery({
		prefix,
		cleanupProof,
		mutation: "digest-mismatch",
	});
	const preRecoveryIntentLaterRemoveMigrates =
		await probePreRecoveryIntentLaterRemove({
			prefix,
			cleanupProof,
			malformed: false,
		});
	const malformedPreRecoveryTombstoneRejects =
		await probePreRecoveryIntentLaterRemove({
			prefix,
			cleanupProof,
			malformed: true,
		});
	const currentProjectPairNoOpPreserved = await probeCurrentProjectPairNoOp({
		prefix,
		cleanupProof,
	});
	const mixedProjectPair = await probeMixedProjectPairMigration({
		prefix,
		cleanupProof,
	});
	const currentAttachmentIntentSurvivesMigration =
		await probeCurrentAttachmentIntentMigration({ prefix, cleanupProof });
	const currentAttachmentIntentLossFailsClosed =
		await probeCurrentAttachmentIntentLoss({ prefix, cleanupProof });
	const currentAttachmentIntentSupersetFailsClosed =
		await probeCurrentAttachmentIntentSuperset({ prefix, cleanupProof });
	const oldRevision2RecoveryWithoutRetiredKeysReadable =
		await probeOldRecoveryJournalWithoutRetiredBodyKeys({
			prefix,
			cleanupProof,
		});
	const bareAttachmentAbsenceRetainsRecovery =
		await probeAmbiguousAttachmentRecovery({
			prefix,
			cleanupProof,
			mutation: "pair-absence",
		});
	const authenticatedLaterRemoveObservedByRecovery =
		await probeAuthenticatedLaterRemoveRecovery({ prefix, cleanupProof });
	const totalBareAttachmentAbsenceRetainsRecovery =
		await probeTotalBareAttachmentAbsence({ prefix, cleanupProof });
	const topologyStageCleanupAliasesRefuseBeforeMutation =
		await probeTopologyStageCleanupAliases({ prefix, cleanupProof });
	const topologyLegacyCleanupAliasesRefuseBeforeMutation =
		await probeTopologyLegacyCleanupAliases({ prefix, cleanupProof });
	const topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup =
		await probeTopologyHistoricalMixedCleanup({ prefix, cleanupProof });
	const topologyMigrationPlanningPreauthorizesAttachmentDiscovery =
		await probeMigrationPlanningPreauthorization({ prefix, cleanupProof });
	return {
		sameWrapperLifecycleOrdered: raceResults
			.filter((result) => result.sameWrapper)
			.every((result) => result.passed),
		crossWrapperLifecycleOrdered: raceResults
			.filter((result) => !result.sameWrapper)
			.every((result) => result.passed),
		earlierMigrationOrdersLaterMutations: raceResults
			.filter((result) => result.direction === "migration-first")
			.every((result) => result.passed),
		earlierMutationsOrderLaterMigration: raceResults
			.filter((result) => result.direction === "mutation-first")
			.every((result) => result.passed),
		lifecycleRaceCount: raceResults.length,
		lifecycleRaceFailures: raceResults.filter((result) => !result.passed)
			.length,
		initializationRetriesSameInstance: initialization.retried,
		initializationDiagnosticMechanismNeutral: initialization.mechanismNeutral,
		cleanupIntentRecoversAcrossReload,
		committedReadbackRecoversAcrossReload,
		stagedProjectLaterSaveWins,
		stagedProjectLaterRemoveWins,
		originalProjectLaterSaveWins,
		originalProjectLaterRemoveWins,
		physicalAbsenceRetainsRecovery,
		digestMismatchRetainsRecovery,
		preRecoveryIntentLaterRemoveMigrates,
		malformedPreRecoveryTombstoneRejects,
		currentProjectPairNoOpPreserved,
		mixedProjectPairDiscoveryAndMigration: mixedProjectPair.discovery,
		migrationDestinationsUseCurrentPairs: mixedProjectPair.destination,
		currentAttachmentIntentSurvivesMigration,
		currentAttachmentIntentLossFailsClosed,
		currentAttachmentIntentSupersetFailsClosed,
		oldRevision2RecoveryWithoutRetiredKeysReadable,
		bareAttachmentAbsenceRetainsRecovery,
		authenticatedLaterRemoveObservedByRecovery,
		totalBareAttachmentAbsenceRetainsRecovery,
		topologyStageCleanupAliasesRefuseBeforeMutation,
		topologyLegacyCleanupAliasesRefuseBeforeMutation,
		topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup,
		topologyMigrationPlanningPreauthorizesAttachmentDiscovery,
		cleanupProof,
	};
}

type MigrationCleanupTarget =
	| { readonly kind: "stage-database"; readonly name: string }
	| {
			readonly kind: "legacy-database";
			readonly name: string;
			readonly projectId: string;
	  };

interface MigrationCleanupRetryResult {
	readonly diagnostics: readonly BrowserStoreDiagnostic[];
	readonly rejected: boolean;
}

async function probeMigrationPlanningPreauthorization(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const projectId = `${identity}-protected-alias`;
	const sceneId = "protected-scene";
	const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
	const projectTimelineDatabase = `video-editor-timelines-${projectId}`;
	const legacyMediaDatabase = `video-editor-media-${projectId}`;
	const baseIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const storageIdentity: BrowserStorageIdentity = {
		...baseIdentity,
		libraryDatabase: timelineDatabase,
		libraryStore: "c5-protected-library",
	};
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const stageDatabases = Object.values(
		browserMigrationStageNames(storageIdentity.projectsDatabase),
	).map((stage) => stage.database);
	const diagnostics: BrowserStoreDiagnostic[] = [];
	try {
		await seedLegacyV1({
			storageIdentity,
			projectId,
			sceneId,
			timelineDatabase,
		});
		await idbPut({
			database: timelineDatabase,
			store: "timeline",
			value: {
				id: "timeline",
				tracks: [],
				lastModified: "2026-08-02T00:00:00.000Z",
				bytes: Uint8Array.from([41, 42, 43, 44]).buffer,
			},
			context: { operation: "inspect", scope: { kind: "store" } },
		});
		const beforeShape = await readDatabaseShape(timelineDatabase);
		const beforeSentinel = await readPreauthorizationSentinel(timelineDatabase);
		const beforeDatabases = (await listDatabaseNames())
			.filter((name) => name.includes(identity))
			.sort();
		const beforeDirectories = (await listRootEntries())
			.filter((name) => name.includes(identity))
			.sort();

		let legacyTargetOpenCount = 0;
		const factoryPrototype = IDBFactory.prototype;
		const originalOpen = factoryPrototype.open;
		Object.defineProperty(factoryPrototype, "open", {
			configurable: true,
			writable: true,
			value: function open(
				this: IDBFactory,
				name: string,
				version?: number,
			): IDBOpenDBRequest {
				if (name === timelineDatabase) legacyTargetOpenCount += 1;
				return version === undefined
					? originalOpen.call(this, name)
					: originalOpen.call(this, name, version);
			},
		});
		let outcome: Awaited<ReturnType<typeof runBrowserProjectMigration>>;
		try {
			outcome = await runBrowserProjectMigration({
				identity: storageIdentity,
				policy: { kind: "disposable", identity, prefix: args.prefix },
				context: { from: 1, to: 31, report: () => undefined },
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
		} finally {
			Object.defineProperty(factoryPrototype, "open", {
				configurable: true,
				writable: true,
				value: originalOpen,
			});
		}

		const afterShape = await readDatabaseShape(timelineDatabase);
		const afterSentinel = await readPreauthorizationSentinel(timelineDatabase);
		const afterDatabases = (await listDatabaseNames())
			.filter((name) => name.includes(identity))
			.sort();
		const afterDirectories = (await listRootEntries())
			.filter((name) => name.includes(identity))
			.sort();
		const serializedFailure = JSON.stringify({ outcome, diagnostics });
		return (
			outcome.status === "failed" &&
			legacyTargetOpenCount === 0 &&
			hasMigrationTopologyConflictDiagnostic(diagnostics) &&
			!serializedFailure.includes(timelineDatabase) &&
			!serializedFailure.includes(storageIdentity.libraryStore) &&
			beforeShape.version === afterShape.version &&
			equalStoredValue({
				left: beforeShape.stores,
				right: afterShape.stores,
			}) &&
			equalBody({
				body: afterSentinel,
				expected: [...new Uint8Array(beforeSentinel)],
			}) &&
			equalStoredValue({ left: beforeDatabases, right: afterDatabases }) &&
			equalStoredValue({ left: beforeDirectories, right: afterDirectories }) &&
			afterShape.stores.includes("timeline") &&
			stageDatabases.every((database) => !afterDatabases.includes(database)) &&
			!afterDatabases.includes(projectTimelineDatabase) &&
			!afterDatabases.includes(legacyMediaDatabase) &&
			!afterDirectories.includes(directory)
		);
	} finally {
		for (const database of [
			storageIdentity.projectsDatabase,
			timelineDatabase,
			projectTimelineDatabase,
			legacyMediaDatabase,
			...stageDatabases,
		]) {
			await deleteDatabaseExact(database);
		}
		await removeRootDirectoryExact(directory);
		args.cleanupProof.push(
			storageIdentity.projectsDatabase,
			timelineDatabase,
			projectTimelineDatabase,
			legacyMediaDatabase,
			...stageDatabases,
			directory,
		);
	}
}

async function readDatabaseShape(
	database: string,
): Promise<{ version: number; stores: readonly string[] }> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(database);
		request.onsuccess = () => {
			const opened = request.result;
			const result = {
				version: opened.version,
				stores: [...opened.objectStoreNames].sort(),
			};
			opened.close();
			resolve(result);
		};
		request.onerror = () => reject(request.error);
	});
}

async function readPreauthorizationSentinel(
	database: string,
): Promise<ArrayBuffer> {
	const value = await idbGet<unknown>({
		database,
		store: "timeline",
		key: "timeline",
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	if (!isRecord(value) || !(value.bytes instanceof ArrayBuffer)) {
		throw new Error("Migration preauthorization sentinel is unavailable");
	}
	return value.bytes;
}

async function probeTopologyStageCleanupAliases(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const staticLibraryAlias = await withFixture({
		...args,
		run: async ({ storageIdentity }) => {
			const stage = browserMigrationStageNames(storageIdentity.projectsDatabase)
				.projects.database;
			const identity = {
				...storageIdentity,
				libraryDatabase: stage,
				libraryStore: "c5-distinct-library",
			};
			await seedMigrationSentinel({ database: stage, byte: 11 });
			const before = await putMigrationCleanupJournal({
				identity,
				targets: [{ kind: "stage-database", name: stage }],
			});
			const retry = await retryMigrationCleanup({
				identity,
				prefix: args.prefix,
			});
			return (
				retry.rejected &&
				(await readMigrationSentinel(stage)) === 11 &&
				equalStoredValue({
					left: await readMigrationCleanupJournal(identity),
					right: before,
				})
			);
		},
	});
	const retainedLibraryAlias = await withFixture({
		...args,
		run: async ({ storageIdentity }) => {
			const stage = browserMigrationStageNames(storageIdentity.projectsDatabase)
				.projects.database;
			await seedRetainedLibraryClaim({
				controlIdentity: storageIdentity,
				database: stage,
				store: "c5-retained-library",
			});
			await seedMigrationSentinel({ database: stage, byte: 12 });
			const before = await putMigrationCleanupJournal({
				identity: storageIdentity,
				targets: [{ kind: "stage-database", name: stage }],
			});
			const retry = await retryMigrationCleanup({
				identity: storageIdentity,
				prefix: args.prefix,
			});
			return (
				!retry.rejected &&
				hasMigrationTopologyConflictDiagnostic(retry.diagnostics) &&
				(await readMigrationSentinel(stage)) === 12 &&
				equalStoredValue({
					left: await readMigrationCleanupJournal(storageIdentity),
					right: before,
				})
			);
		},
	});
	const currentMediaAlias = await withFixture({
		...args,
		run: async ({ storageIdentity }) => {
			const projectId = "stage";
			const stage = browserMigrationStageNames(storageIdentity.projectsDatabase)
				.attachments.database;
			const identity = {
				...storageIdentity,
				mediaDatabasePrefix: stage.slice(0, -projectId.length),
			};
			await seedMediaOwnershipClaim({
				controlIdentity: identity,
				binding: mediaBindingForIdentity(identity),
				projectId,
			});
			await seedMigrationSentinel({ database: stage, byte: 13 });
			const before = await putMigrationCleanupJournal({
				identity,
				targets: [{ kind: "stage-database", name: stage }],
			});
			const retry = await retryMigrationCleanup({
				identity,
				prefix: args.prefix,
			});
			return (
				!retry.rejected &&
				hasMigrationTopologyConflictDiagnostic(retry.diagnostics) &&
				(await readMigrationSentinel(stage)) === 13 &&
				equalStoredValue({
					left: await readMigrationCleanupJournal(identity),
					right: before,
				})
			);
		},
	});
	const safeStageControl = await withFixture({
		...args,
		run: async ({ storageIdentity }) => {
			const stages = browserMigrationStageNames(
				storageIdentity.projectsDatabase,
			);
			await Promise.all([
				seedMigrationSentinel({ database: stages.projects.database, byte: 14 }),
				seedMigrationSentinel({
					database: stages.attachments.database,
					byte: 15,
				}),
			]);
			await putMigrationCleanupJournal({
				identity: storageIdentity,
				targets: [
					{ kind: "stage-database", name: stages.projects.database },
					{ kind: "stage-database", name: stages.attachments.database },
				],
			});
			const retry = await retryMigrationCleanup({
				identity: storageIdentity,
				prefix: args.prefix,
			});
			const databases = await listDatabaseNames();
			return (
				!retry.rejected &&
				!databases.includes(stages.projects.database) &&
				!databases.includes(stages.attachments.database) &&
				(await readMigrationCleanupJournal(storageIdentity)) === null
			);
		},
	});
	return (
		staticLibraryAlias &&
		retainedLibraryAlias &&
		currentMediaAlias &&
		safeStageControl
	);
}

async function probeTopologyLegacyCleanupAliases(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	for (const role of [
		"projects",
		"library",
		"current-media",
		"retained-media",
	] as const) {
		const passed = await withFixture({
			...args,
			run: async ({ identity: fixtureIdentity, storageIdentity }) => {
				const projectId = `${fixtureIdentity}-legacy-${role}`;
				const target = `video-editor-timelines-${projectId}`;
				const identity: BrowserStorageIdentity = {
					...storageIdentity,
					...(role === "projects" ? { projectsDatabase: target } : {}),
					...(role === "library" ? { libraryDatabase: target } : {}),
					...(role === "current-media"
						? { mediaDatabasePrefix: "video-editor-timelines-" }
						: {}),
				};
				try {
					if (role === "current-media") {
						await seedMediaOwnershipClaim({
							controlIdentity: identity,
							binding: mediaBindingForIdentity(identity),
							projectId,
						});
					}
					if (role === "retained-media") {
						await seedMediaOwnershipClaim({
							controlIdentity: identity,
							binding: {
								revision: 1,
								mediaDatabasePrefix: target.slice(0, -projectId.length),
								mediaStore: identity.mediaStore,
								mediaDirectoryPrefix: `${identity.mediaDirectoryPrefix}retained-`,
							},
							projectId,
						});
					}
					await seedMigrationSentinel({ database: target, byte: 21 });
					const before = await putMigrationCleanupJournal({
						identity,
						targets: [
							{
								kind: "legacy-database",
								name: target,
								projectId,
							},
						],
					});
					const retry = await retryMigrationCleanup({
						identity,
						prefix: args.prefix,
					});
					return (
						!retry.rejected &&
						hasMigrationTopologyConflictDiagnostic(retry.diagnostics) &&
						(await readMigrationSentinel(target)) === 21 &&
						equalStoredValue({
							left: await readMigrationCleanupJournal(identity),
							right: before,
						})
					);
				} finally {
					await deleteExternalMigrationDatabases([target]);
					args.cleanupProof.push(target);
				}
			},
		});
		if (!passed) return false;
	}
	return true;
}

async function probeTopologyHistoricalMixedCleanup(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity: fixtureIdentity, storageIdentity }) => {
			const unsafeProjectId = `${fixtureIdentity}-unsafe`;
			const unsafeTarget = `video-editor-timelines-${unsafeProjectId}`;
			const safeProjectId = `${fixtureIdentity}-safe`;
			const safeTarget = `video-editor-timelines-${safeProjectId}`;
			const identity = {
				...storageIdentity,
				projectsDatabase: unsafeTarget,
			};
			try {
				await Promise.all([
					seedMigrationSentinel({ database: safeTarget, byte: 31 }),
					seedMigrationSentinel({ database: unsafeTarget, byte: 32 }),
				]);
				const before = await putMigrationCleanupJournal({
					identity,
					targets: [
						{
							kind: "legacy-database",
							name: safeTarget,
							projectId: safeProjectId,
						},
						{
							kind: "legacy-database",
							name: unsafeTarget,
							projectId: unsafeProjectId,
						},
					],
				});
				const retry = await retryMigrationCleanup({
					identity,
					prefix: args.prefix,
				});
				return (
					!retry.rejected &&
					hasMigrationTopologyConflictDiagnostic(retry.diagnostics) &&
					(await readMigrationSentinel(safeTarget)) === 31 &&
					(await readMigrationSentinel(unsafeTarget)) === 32 &&
					equalStoredValue({
						left: await readMigrationCleanupJournal(identity),
						right: before,
					})
				);
			} finally {
				await deleteExternalMigrationDatabases([safeTarget, unsafeTarget]);
				args.cleanupProof.push(safeTarget, unsafeTarget);
			}
		},
	});
}

function migrationMaintenanceStore(identity: BrowserStorageIdentity): string {
	return browserProjectTopologyStoreNames(identity.projectsStore)
		.migrationMaintenance;
}

async function putMigrationCleanupJournal(args: {
	identity: BrowserStorageIdentity;
	targets: readonly MigrationCleanupTarget[];
}): Promise<Record<string, unknown>> {
	const journal = {
		id: "postcommit-cleanup",
		revision: 1,
		targets: args.targets,
	};
	await idbPut({
		database: args.identity.projectsDatabase,
		store: migrationMaintenanceStore(args.identity),
		value: journal,
		context: { operation: "clear", scope: { kind: "store" } },
	});
	return structuredClone(journal);
}

async function readMigrationCleanupJournal(
	identity: BrowserStorageIdentity,
): Promise<unknown | null> {
	const rows = await idbGetAll<unknown>({
		database: identity.projectsDatabase,
		store: migrationMaintenanceStore(identity),
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	return (
		rows.find((row) => isRecord(row) && row.id === "postcommit-cleanup") ?? null
	);
}

async function seedMigrationSentinel(args: {
	database: string;
	byte: number;
}): Promise<void> {
	await idbPut({
		database: args.database,
		store: "c5-migration-sentinel",
		value: { id: "sentinel", byte: args.byte },
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function readMigrationSentinel(database: string): Promise<number | null> {
	const value = await idbGet<unknown>({
		database,
		store: "c5-migration-sentinel",
		key: "sentinel",
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	return isRecord(value) && typeof value.byte === "number" ? value.byte : null;
}

async function seedMediaOwnershipClaim(args: {
	controlIdentity: BrowserStorageIdentity;
	binding: ReturnType<typeof mediaBindingForIdentity>;
	projectId: string;
}): Promise<void> {
	const fingerprint = await mediaBindingFingerprint(args.binding);
	await idbPutMany({
		database: args.controlIdentity.projectsDatabase,
		store: browserProjectTopologyStoreNames(args.controlIdentity.projectsStore)
			.mediaOwnership,
		values: [
			{
				id: `.c5-media-binding:${fingerprint}`,
				[MEDIA_OWNER_FIELD]: {
					revision: 2,
					kind: "binding",
					fingerprint,
					binding: args.binding,
				},
			},
			{
				id: `.c5-media-owner-v2:${fingerprint}:${encodeURIComponent(args.projectId)}`,
				[MEDIA_OWNER_FIELD]: {
					revision: 2,
					kind: "owner",
					fingerprint,
					projectId: args.projectId,
				},
			},
			{
				id: `.c5-media-coverage:${fingerprint}`,
				[MEDIA_OWNER_FIELD]: {
					revision: 2,
					kind: "coverage",
					fingerprint,
					coverage: "complete",
				},
			},
		],
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function seedRetainedLibraryClaim(args: {
	controlIdentity: BrowserStorageIdentity;
	database: string;
	store: string;
}): Promise<void> {
	const binding = {
		revision: 1 as const,
		projectsDatabase: args.controlIdentity.projectsDatabase,
		projectsStore: args.controlIdentity.projectsStore,
		libraryDatabase: args.database,
		libraryStore: args.store,
	};
	const fingerprint = await libraryClearBindingFingerprint(binding);
	await idbPut({
		database: args.controlIdentity.projectsDatabase,
		store: browserProjectTopologyStoreNames(args.controlIdentity.projectsStore)
			.libraryClearBindings,
		value: {
			id: `.c5-library-clear-binding:${fingerprint}`,
			[LIBRARY_CLEAR_BINDING_FIELD]: {
				revision: 1,
				kind: "clear-authorization",
				fingerprint,
				binding,
			},
		},
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function retryMigrationCleanup(args: {
	identity: BrowserStorageIdentity;
	prefix: string;
}): Promise<MigrationCleanupRetryResult> {
	const diagnostics: BrowserStoreDiagnostic[] = [];
	const rejected = await retryBrowserProjectMigrationCleanup({
		identity: args.identity,
		policy: {
			kind: "disposable",
			identity: args.identity.identity,
			prefix: args.prefix,
		},
		diagnostic: (diagnostic) => diagnostics.push(diagnostic),
	})
		.then(() => false)
		.catch(() => true);
	return { diagnostics, rejected };
}

function hasMigrationTopologyConflictDiagnostic(
	diagnostics: readonly BrowserStoreDiagnostic[],
): boolean {
	return diagnostics.some(
		(diagnostic) =>
			diagnostic.phase === "migration-cleanup-topology-conflict" &&
			diagnostic.code === "unavailable" &&
			diagnostic.retryable === false,
	);
}

function equalStoredValue(args: { left: unknown; right: unknown }): boolean {
	return JSON.stringify(args.left) === JSON.stringify(args.right);
}

async function deleteExternalMigrationDatabases(
	databases: readonly string[],
): Promise<void> {
	for (const database of databases) await deleteDatabaseExact(database);
}

async function probeCurrentProjectPairNoOp(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-current-opaque-noop`;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			await store.prepareForSession();
			await store.save({
				record: {
					id: projectId,
					schemaVersion: store.schemaVersion,
					data: Uint8Array.from([31, 5, 31]),
				},
				summary: summary({ projectId, name: "current opaque no-op" }),
			});
			const before = await readProjectPair({ storageIdentity, projectId });
			const outcome = await store.migrate({
				from: store.schemaVersion,
				to: store.schemaVersion,
				report: () => undefined,
			});
			const after = await readProjectPair({ storageIdentity, projectId });
			return (
				outcome.status === "not-needed" &&
				equalStoredValue({ left: before, right: after }) &&
				decodeStoredProjectPair(after)?.record.data instanceof Uint8Array
			);
		},
	});
}

async function probeMixedProjectPairMigration(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{ discovery: boolean; destination: boolean }> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const currentId = `${identity}-mixed-current`;
			const legacyId = `${identity}-mixed-legacy`;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			await store.prepareForSession();
			await store.save({
				record: {
					id: currentId,
					schemaVersion: store.schemaVersion,
					data: Uint8Array.from([4, 5, 6]),
				},
				summary: summary({ projectId: currentId, name: "mixed current" }),
			});
			const currentBefore = await readProjectPair({
				storageIdentity,
				projectId: currentId,
			});
			await seedLegacyV30({ storageIdentity, projectId: legacyId });
			const outcome = await store.migrate(migrationContext());
			const currentAfter = await readProjectPair({
				storageIdentity,
				projectId: currentId,
			});
			const legacyAfter = await readProjectPair({
				storageIdentity,
				projectId: legacyId,
			});
			const decodedLegacy = decodeStoredProjectPair(legacyAfter);
			return {
				discovery:
					outcome.status === "migrated" &&
					equalStoredValue({ left: currentBefore, right: currentAfter }) &&
					decodedLegacy?.record.schemaVersion === store.schemaVersion,
				destination:
					legacyAfter.publicRow !== null &&
					legacyAfter.authorityRow !== null &&
					decodedLegacy?.record.id === legacyId,
			};
		},
	});
}

async function probeCurrentAttachmentIntentMigration(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-current-attachment-intent`;
			const key = "current-attachment";
			const bodyKey = ".c5-body-current-source";
			const mutationId = ".c5-attachment-mutation-current-source";
			const retiredBodyKeys = [
				".c5-body-retired-current-a",
				".c5-body-retired-current-b",
			];
			const body = Uint8Array.from([7, 6, 5, 4]).buffer;
			const bodyDigest = await digestAttachmentBody(body);
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeProjectCommit: () => {
						throw new Error("fixture inspect current attachment stage");
					},
				},
			});
			await store.prepareForSession();
			await seedLegacyV30({ storageIdentity, projectId });
			const current = createCurrentStoredAttachment({
				projectId,
				key,
				metadata: { generation: "current-source" },
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys,
			});
			await putAttachmentPair({ storageIdentity, projectId, pair: current });
			await opfsWrite({
				directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
				key: bodyKey,
				body,
				context: {
					operation: "save-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
			const first = await store.migrate(migrationContext());
			const destination = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const decodedDestination = decodeStoredAttachmentPair({
				projectId,
				...destination,
			});
			const journal = await readMigrationRecoveryJournal(storageIdentity);
			const journalAttachment = migrationRecoveryAttachment({
				journal,
				projectId,
				key,
			});
			const stagedRows = await idbGetAll<unknown>({
				...browserMigrationStageNames(storageIdentity.projectsDatabase)
					.attachments,
				context: {
					operation: "list-attachments",
					scope: { kind: "project", projectId },
				},
			});
			const stagedRow = stagedRows.find(
				(row) =>
					isRecord(row) && row.projectId === projectId && row.key === key,
			);
			const stagedFingerprint =
				isRecord(stagedRow) && isRecord(stagedRow.staged)
					? stagedRow.staged
					: null;
			const journalOriginal =
				isRecord(journalAttachment) && isRecord(journalAttachment.original)
					? journalAttachment.original
					: null;
			const journalStaged =
				isRecord(journalAttachment) && isRecord(journalAttachment.staged)
					? journalAttachment.staged
					: null;
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const recovered = await reopened
				.prepareForSession()
				.then(() => true)
				.catch(() => false);
			const loaded = recovered
				? await reopened.loadAttachment({ projectId, key })
				: null;
			return (
				first.status === "failed" &&
				decodedDestination?.kind === "attachment" &&
				decodedDestination.bodyKey === bodyKey &&
				decodedDestination.mutationId === mutationId &&
				decodedDestination.bodyDigest === bodyDigest &&
				decodedDestination.byteLength === body.byteLength &&
				equalStoredValue({
					left: decodedDestination.retiredBodyKeys,
					right: retiredBodyKeys,
				}) &&
				journalOriginal !== null &&
				equalStoredValue({
					left: journalOriginal.retiredBodyKeys,
					right: retiredBodyKeys,
				}) &&
				journalStaged !== null &&
				equalStoredValue({
					left: journalStaged.retiredBodyKeys,
					right: retiredBodyKeys,
				}) &&
				stagedFingerprint !== null &&
				equalStoredValue({
					left: stagedFingerprint.retiredBodyKeys,
					right: retiredBodyKeys,
				}) &&
				recovered &&
				loaded !== null &&
				equalBody({ body: loaded.body, expected: [7, 6, 5, 4] })
			);
		},
	});
}

async function probeCurrentAttachmentIntentLoss(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-current-attachment-intent-loss`;
			const key = "current-attachment";
			const bodyKey = ".c5-body-current-intent-loss";
			const retiredBodyKey = "provider-retired-body-must-remain-authorized";
			const mutationId = ".c5-attachment-mutation-intent-loss";
			const body = Uint8Array.from([8, 6, 7, 5]).buffer;
			const retiredBody = Uint8Array.from([3, 0, 9]).buffer;
			const bodyDigest = await digestAttachmentBody(body);
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeProjectCommit: () => {
						throw new Error("fixture inspect unauthorized intent loss");
					},
				},
			});
			await store.prepareForSession();
			await seedLegacyV30({ storageIdentity, projectId });
			const current = createCurrentStoredAttachment({
				projectId,
				key,
				metadata: { generation: "current-intent-loss" },
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: [retiredBodyKey],
			});
			await putAttachmentPair({ storageIdentity, projectId, pair: current });
			const directory = mediaDirectoryName({
				identity: storageIdentity,
				projectId,
			});
			const context = {
				operation: "save-attachment" as const,
				scope: { kind: "attachment" as const, projectId, key },
			};
			await opfsWrite({ directory, key: bodyKey, body, context });
			await opfsWrite({
				directory,
				key: retiredBodyKey,
				body: retiredBody,
				context,
			});
			const first = await store.migrate(migrationContext());
			const tampered = createCurrentStoredAttachment({
				projectId,
				key,
				metadata: { generation: "current-intent-loss" },
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: [],
			});
			await putAttachmentPair({ storageIdentity, projectId, pair: tampered });
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const rejected = await reopened
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			const retainedBody = await opfsRead({
				directory,
				key: retiredBodyKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
			const retainedJournal =
				(await readMigrationRecoveryJournal(storageIdentity)) !== null;
			return (
				first.status === "failed" &&
				rejected &&
				retainedJournal &&
				retainedBody !== null &&
				equalBody({ body: retainedBody, expected: [3, 0, 9] })
			);
		},
	});
}

async function probeCurrentAttachmentIntentSuperset(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-current-attachment-intent-superset`;
			const key = "current-attachment";
			const bodyKey = ".c5-body-current-intent-superset";
			const protectedKey = "protected-attachment";
			const protectedBodyKey = ".c5-body-protected-live";
			const mutationId = ".c5-attachment-mutation-intent-superset";
			const protectedMutationId = ".c5-attachment-mutation-protected-live";
			const body = Uint8Array.from([4, 2, 4, 2]).buffer;
			const protectedBody = Uint8Array.from([1, 6, 1, 8]).buffer;
			const bodyDigest = await digestAttachmentBody(body);
			const protectedDigest = await digestAttachmentBody(protectedBody);
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeProjectCommit: () => {
						throw new Error("fixture inspect unauthorized intent superset");
					},
				},
			});
			await store.prepareForSession();
			await seedLegacyV30({ storageIdentity, projectId });
			const current = createCurrentStoredAttachment({
				projectId,
				key,
				metadata: { generation: "current-intent-superset" },
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: [],
			});
			const protectedAttachment = createCurrentStoredAttachment({
				projectId,
				key: protectedKey,
				metadata: { generation: "protected-live" },
				bodyKey: protectedBodyKey,
				mutationId: protectedMutationId,
				bodyDigest: protectedDigest,
				byteLength: protectedBody.byteLength,
				retiredBodyKeys: [],
			});
			await putAttachmentPair({ storageIdentity, projectId, pair: current });
			await putAttachmentPair({
				storageIdentity,
				projectId,
				pair: protectedAttachment,
			});
			const directory = mediaDirectoryName({
				identity: storageIdentity,
				projectId,
			});
			const context = {
				operation: "save-attachment" as const,
				scope: { kind: "attachment" as const, projectId, key },
			};
			await opfsWrite({ directory, key: bodyKey, body, context });
			await opfsWrite({
				directory,
				key: protectedBodyKey,
				body: protectedBody,
				context: {
					operation: "save-attachment",
					scope: { kind: "attachment", projectId, key: protectedKey },
				},
			});
			const first = await store.migrate(migrationContext());
			const tampered = createCurrentStoredAttachment({
				projectId,
				key,
				metadata: { generation: "current-intent-superset" },
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: [protectedBodyKey],
			});
			await putAttachmentPair({ storageIdentity, projectId, pair: tampered });
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const rejected = await reopened
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			const protectedBodyAfter = await opfsRead({
				directory,
				key: protectedBodyKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "attachment", projectId, key: protectedKey },
				},
			});
			const retainedJournal =
				(await readMigrationRecoveryJournal(storageIdentity)) !== null;
			return (
				first.status === "failed" &&
				rejected &&
				retainedJournal &&
				protectedBodyAfter !== null &&
				equalBody({ body: protectedBodyAfter, expected: [1, 6, 1, 8] })
			);
		},
	});
}

async function probeOldRecoveryJournalWithoutRetiredBodyKeys(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-old-recovery-journal`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeCommittedReadback: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture old revision 2 recovery journal");
					},
				},
			});
			const first = await store.migrate(migrationContext());
			const journal = await readMigrationRecoveryJournal(storageIdentity);
			if (!isRecord(journal)) return false;
			const oldJournal = structuredClone(journal);
			for (const project of Array.isArray(oldJournal.projects)
				? oldJournal.projects
				: []) {
				if (!isRecord(project) || !Array.isArray(project.attachments)) continue;
				for (const attachment of project.attachments) {
					if (!isRecord(attachment)) continue;
					if (isRecord(attachment.original)) {
						delete attachment.original.retiredBodyKeys;
					}
					if (isRecord(attachment.staged)) {
						delete attachment.staged.retiredBodyKeys;
					}
				}
			}
			await idbPut({
				database: storageIdentity.projectsDatabase,
				store: migrationMaintenanceStore(storageIdentity),
				value: oldJournal,
				context: { operation: "save-project", scope: { kind: "store" } },
			});
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const recovered = await reopened
				.prepareForSession()
				.then(() => true)
				.catch(() => false);
			const loaded = recovered
				? await reopened.loadAttachment({ projectId, key })
				: null;
			return (
				first.status === "failed" &&
				recovered &&
				loaded !== null &&
				(await readMigrationRecoveryJournal(storageIdentity)) === null
			);
		},
	});
}

async function probePreRecoveryIntentLaterRemove(args: {
	prefix: string;
	cleanupProof: string[];
	malformed: boolean;
}): Promise<boolean> {
	return withFixture({
		prefix: args.prefix,
		cleanupProof: args.cleanupProof,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-pre-intent-${args.malformed ? "malformed" : "remove"}`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeValidation: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture pre-recovery-intent interruption");
					},
				},
			});
			const first = await store.migrate(migrationContext());
			await store.removeAttachment({ projectId, key });
			if (args.malformed) {
				await addUnexpectedTombstoneField({ storageIdentity, projectId, key });
			}

			resetBrowserProjectStoreRuntimeForTests();
			const firstRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			await firstRetry.prepareForSession();
			const firstRetryOutcome = await firstRetry.migrate(migrationContext());
			if (!args.malformed) {
				const project = await firstRetry.load({ id: projectId });
				const attachment = await firstRetry.loadAttachment({ projectId, key });
				const inventory = await inspectDisposableBrowserStorage({
					identity,
					prefix: args.prefix,
				});
				return (
					first.status === "failed" &&
					(firstRetryOutcome.status === "migrated" ||
						firstRetryOutcome.status === "not-needed") &&
					project?.schemaVersion === firstRetry.schemaVersion &&
					attachment === null &&
					!inventory.databases.some(isMigrationStageDatabase)
				);
			}

			resetBrowserProjectStoreRuntimeForTests();
			const secondRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			await secondRetry.prepareForSession();
			const secondRetryOutcome = await secondRetry.migrate(migrationContext());
			const rawProject = await idbGet<unknown>({
				database: storageIdentity.projectsDatabase,
				store: storageIdentity.projectsStore,
				key: projectId,
				context: {
					operation: "load-project",
					scope: { kind: "project", projectId },
				},
			});
			const publicCorrupt = await secondRetry
				.loadAttachment({ projectId, key })
				.then(() => false)
				.catch(() => true);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				first.status === "failed" &&
				firstRetryOutcome.status === "failed" &&
				secondRetryOutcome.status === "failed" &&
				projectVersionFromStored(rawProject) === 30 &&
				publicCorrupt &&
				!inventory.databases.some(isMigrationStageDatabase)
			);
		},
	});
}

async function addUnexpectedTombstoneField(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
	key: string;
}): Promise<void> {
	const database = mediaDatabaseName({
		identity: args.storageIdentity,
		projectId: args.projectId,
	});
	const row = await idbGet<unknown>({
		database,
		store: args.storageIdentity.mediaStore,
		key: args.key,
		context: {
			operation: "load-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
	if (isRecord(row) && isRecord(row[ATTACHMENT_ENVELOPE_KEY])) {
		await idbPut({
			database,
			store: args.storageIdentity.mediaStore,
			value: {
				...row,
				[ATTACHMENT_ENVELOPE_KEY]: {
					...row[ATTACHMENT_ENVELOPE_KEY],
					unexpected: "must-fail-closed",
				},
			},
			context: {
				operation: "save-attachment",
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			},
		});
		return;
	}
	const authorityStore = attachmentAuthorityStoreName(
		args.storageIdentity.mediaStore,
	);
	const authority = await idbGet<unknown>({
		database,
		store: authorityStore,
		key: args.key,
		context: {
			operation: "load-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
	const tombstone = isRecord(authority)
		? authority
		: createCurrentStoredAttachmentTombstone({
				projectId: args.projectId,
				key: args.key,
				mutationId: ".c5-attachment-mutation-malformed-probe",
			}).authorityRow;
	await idbPut({
		database,
		store: authorityStore,
		value: {
			...tombstone,
			unexpected: "must-fail-closed",
		},
		context: {
			operation: "save-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
}

type AttachmentRecoveryPhase = "original" | "staged";
type AttachmentRecoveryMutation = "save" | "remove";

async function probeAttachmentRecoveryWinner(args: {
	prefix: string;
	cleanupProof: string[];
	phase: AttachmentRecoveryPhase;
	mutation: AttachmentRecoveryMutation;
}): Promise<boolean> {
	return withFixture({
		prefix: args.prefix,
		cleanupProof: args.cleanupProof,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-${args.phase}-${args.mutation}`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const fail = () => {
				if (failed) return;
				failed = true;
				throw new Error(`fixture ${args.phase} project interruption`);
			};
			const hooks: BrowserMigrationHooks =
				args.phase === "original"
					? { beforeProjectCommit: fail }
					: { beforeCommittedReadback: fail };
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks,
			});
			const first = await store.migrate(migrationContext());
			if (args.mutation === "save") {
				await store.saveAttachment({
					projectId,
					key,
					metadata: {
						generation: "newer",
						providerPrivate: { keep: true },
					},
					body: Uint8Array.from([9, 8, 7]).buffer,
				});
			} else {
				await store.removeAttachment({ projectId, key });
			}
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const recovered = await reopened
				.prepareForSession()
				.then(() => true)
				.catch(() => false);
			const attachment = recovered
				? await reopened.loadAttachment({ projectId, key })
				: null;
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			const stageRemoved = !inventory.databases.some(isMigrationStageDatabase);
			const mutationWon =
				args.mutation === "remove"
					? attachment === null
					: isRecord(attachment?.metadata) &&
						attachment.metadata.generation === "newer" &&
						isRecord(attachment.metadata.providerPrivate) &&
						attachment.metadata.providerPrivate.keep === true &&
						equalBody({ body: attachment.body, expected: [9, 8, 7] });
			return (
				first.status === "failed" && recovered && stageRemoved && mutationWon
			);
		},
	});
}

async function probeAuthenticatedLaterRemoveRecovery(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-authenticated-later-remove`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeProjectCommit: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture authenticated later remove interruption");
					},
				},
			});
			const first = await store.migrate(migrationContext());
			const migrationPair = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const migrationAttachment = decodeStoredAttachmentPair({
				projectId,
				...migrationPair,
			});
			const journalBeforeRemove =
				await readMigrationRecoveryJournal(storageIdentity);

			await store.removeAttachment({ projectId, key });
			const markerPair = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const marker = decodeStoredAttachmentPair({ projectId, ...markerPair });
			const markerBody =
				migrationAttachment?.kind === "attachment"
					? await opfsRead({
							directory: mediaDirectoryName({
								identity: storageIdentity,
								projectId,
							}),
							key: migrationAttachment.bodyKey,
							context: {
								operation: "load-attachment",
								scope: { kind: "attachment", projectId, key },
							},
						})
					: new ArrayBuffer(0);

			resetBrowserProjectStoreRuntimeForTests();
			const reopened = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const recovered = await reopened
				.prepareForSession()
				.then(() => true)
				.catch(() => false);
			const loaded = recovered
				? await reopened.loadAttachment({ projectId, key })
				: null;
			const pairAfterRecovery = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				first.status === "failed" &&
				journalBeforeRemove !== null &&
				migrationAttachment?.kind === "attachment" &&
				migrationAttachment.revision === "current" &&
				marker?.kind === "tombstone" &&
				marker.revision === "current" &&
				marker.mutationId !== migrationAttachment.mutationId &&
				markerBody === null &&
				recovered &&
				loaded === null &&
				pairAfterRecovery.publicRow === null &&
				pairAfterRecovery.authorityRow === null &&
				(await readMigrationRecoveryJournal(storageIdentity)) === null &&
				!inventory.databases.some(isMigrationStageDatabase)
			);
		},
	});
}

async function probeTotalBareAttachmentAbsence(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-total-bare-absence`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeProjectCommit: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture total bare absence interruption");
					},
				},
			});
			const first = await store.migrate(migrationContext());
			const committedPair = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const committed = decodeStoredAttachmentPair({
				projectId,
				...committedPair,
			});
			if (committed?.kind !== "attachment") return false;
			const retainedBefore = await migrationRetentionSnapshot({
				storageIdentity,
				projectId,
			});
			const database = mediaDatabaseName({
				identity: storageIdentity,
				projectId,
			});
			const context = {
				operation: "remove-attachment" as const,
				scope: { kind: "attachment" as const, projectId, key },
			};
			await idbDelete({
				database,
				store: storageIdentity.mediaStore,
				key,
				context,
			});
			await idbDelete({
				database,
				store: attachmentAuthorityStoreName(storageIdentity.mediaStore),
				key,
				context,
			});
			await opfsRemove({
				directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
				key: committed.bodyKey,
				context,
			});

			resetBrowserProjectStoreRuntimeForTests();
			const firstRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const firstRejected = await firstRetry
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			const retainedAfterFirst = await migrationRetentionSnapshot({
				storageIdentity,
				projectId,
			});

			resetBrowserProjectStoreRuntimeForTests();
			const secondRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const secondRejected = await secondRetry
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			const retainedAfterSecond = await migrationRetentionSnapshot({
				storageIdentity,
				projectId,
			});
			const absentPair = await readAttachmentPair({
				storageIdentity,
				projectId,
				key,
			});
			const absentBody = await opfsRead({
				directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
				key: committed.bodyKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
			return (
				first.status === "failed" &&
				firstRejected &&
				secondRejected &&
				equalStoredValue({
					left: retainedAfterFirst,
					right: retainedBefore,
				}) &&
				equalStoredValue({
					left: retainedAfterSecond,
					right: retainedBefore,
				}) &&
				absentPair.publicRow === null &&
				absentPair.authorityRow === null &&
				absentBody === null
			);
		},
	});
}

async function migrationRetentionSnapshot(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
}): Promise<unknown> {
	const stages = browserMigrationStageNames(
		args.storageIdentity.projectsDatabase,
	);
	return snapshotProbeValue({
		journal: await readMigrationRecoveryJournal(args.storageIdentity),
		projectSource: await idbGetProjectPair({
			database: args.storageIdentity.projectsDatabase,
			projectStore: args.storageIdentity.projectsStore,
			authorityStore: projectAuthorityStoreName(
				args.storageIdentity.projectsStore,
			),
			key: args.projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId: args.projectId },
			},
		}),
		stagedProjects: await idbGetAll<unknown>({
			...stages.projects,
			context: { operation: "list-projects", scope: { kind: "store" } },
		}),
		stagedAttachments: await idbGetAll<unknown>({
			...stages.attachments,
			context: {
				operation: "list-attachments",
				scope: { kind: "project", projectId: args.projectId },
			},
		}),
	});
}

function snapshotProbeValue(value: unknown): unknown {
	if (value instanceof ArrayBuffer) {
		return { arrayBuffer: [...new Uint8Array(value)] };
	}
	if (ArrayBuffer.isView(value)) {
		return {
			arrayBufferView: [
				...new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
			],
		};
	}
	if (Array.isArray(value)) return value.map(snapshotProbeValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort((left, right) => left.localeCompare(right))
			.map((key) => [key, snapshotProbeValue(value[key])]),
	);
}

async function probeAmbiguousAttachmentRecovery(args: {
	prefix: string;
	cleanupProof: string[];
	mutation: "physical-absence" | "pair-absence" | "digest-mismatch";
}): Promise<boolean> {
	return withFixture({
		prefix: args.prefix,
		cleanupProof: args.cleanupProof,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-${args.mutation}`;
			const key = "legacy-attachment";
			await seedLegacyV30WithAttachment({ storageIdentity, projectId, key });
			let failed = false;
			const store = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				hooks: {
					beforeCommittedReadback: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture committed readback interruption");
					},
				},
			});
			const first = await store.migrate(migrationContext());
			const database = mediaDatabaseName({
				identity: storageIdentity,
				projectId,
			});
			if (
				args.mutation === "physical-absence" ||
				args.mutation === "pair-absence"
			) {
				await idbDelete({
					database,
					store: storageIdentity.mediaStore,
					key,
					context: {
						operation: "remove-attachment",
						scope: { kind: "attachment", projectId, key },
					},
				});
				if (args.mutation === "pair-absence") {
					await idbDelete({
						database,
						store: attachmentAuthorityStoreName(storageIdentity.mediaStore),
						key,
						context: {
							operation: "remove-attachment",
							scope: { kind: "attachment", projectId, key },
						},
					});
				}
			} else {
				const metadata = await idbGet<unknown>({
					database,
					store: storageIdentity.mediaStore,
					key,
					context: {
						operation: "load-attachment",
						scope: { kind: "attachment", projectId, key },
					},
				});
				const decoded = decodeStoredAttachment({ projectId, value: metadata });
				if (!decoded) return false;
				await opfsWrite({
					directory: mediaDirectoryName({
						identity: storageIdentity,
						projectId,
					}),
					key: decoded.bodyKey,
					body: Uint8Array.from([0, 0, 0, 0]).buffer,
					context: {
						operation: "save-attachment",
						scope: { kind: "attachment", projectId, key },
					},
				});
			}
			resetBrowserProjectStoreRuntimeForTests();
			const firstRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const firstRejected = await firstRetry
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			resetBrowserProjectStoreRuntimeForTests();
			const secondRetry = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
			});
			const secondRejected = await secondRetry
				.prepareForSession()
				.then(() => false)
				.catch(() => true);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				first.status === "failed" &&
				firstRejected &&
				secondRejected &&
				inventory.databases.some(isMigrationStageDatabase)
			);
		},
	});
}

async function probeMigrationMutationRace(args: {
	prefix: string;
	cleanupProof: string[];
	sameWrapper: boolean;
	direction: RaceDirection;
	operation: RaceOperation;
}): Promise<boolean> {
	return withFixture({
		prefix: args.prefix,
		cleanupProof: args.cleanupProof,
		run: async ({ identity, storageIdentity }) => {
			const projectId = `${identity}-race-project`;
			await seedLegacyV30({ storageIdentity, projectId });
			const migrationPause = deferred();
			const migrationHooks: BrowserMigrationHooks = {
				beforeCommit: async () => {
					if (args.direction !== "migration-first") return;
					migrationPause.enter();
					await migrationPause.wait;
				},
			};
			const migrationControl = new BrowserProjectStoreControl();
			const migrationStore = disposableStore({
				identity,
				prefix: args.prefix,
				storageIdentity,
				control: migrationControl,
				hooks: migrationHooks,
			});
			const mutationControl = args.sameWrapper
				? migrationControl
				: new BrowserProjectStoreControl();
			const mutationStore = args.sameWrapper
				? migrationStore
				: disposableStore({
						identity,
						prefix: args.prefix,
						storageIdentity,
						control: mutationControl,
					});
			await Promise.all([
				migrationStore.prepareForSession(),
				mutationStore.prepareForSession(),
			]);
			if (args.direction === "migration-first") {
				const migration = migrationStore.migrate(migrationContext());
				await migrationPause.entered;
				let mutationSettled = false;
				const mutation = runMutation({
					store: mutationStore,
					projectId,
					operation: args.operation,
				}).finally(() => {
					mutationSettled = true;
				});
				await delay(30);
				const ordered = !mutationSettled;
				migrationPause.release();
				await Promise.all([migration, mutation]);
				return (
					ordered &&
					(await finalMutationWon({
						store: mutationStore,
						projectId,
						operation: args.operation,
					}))
				);
			}

			const mutationPause = mutationControl.pauseNext({
				operation: publicOperation(args.operation),
			});
			const mutation = runMutation({
				store: mutationStore,
				projectId,
				operation: args.operation,
			});
			await mutationPause.entered;
			let migrationSettled = false;
			const migration = migrationStore
				.migrate(migrationContext())
				.finally(() => {
					migrationSettled = true;
				});
			await delay(30);
			const ordered = !migrationSettled;
			mutationPause.release();
			await Promise.all([mutation, migration]);
			return (
				ordered &&
				(await finalMutationWon({
					store: mutationStore,
					projectId,
					operation: args.operation,
				}))
			);
		},
	});
}

async function probeRetryableInitialization(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{ retried: boolean; mechanismNeutral: boolean }> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const held = await openHeldProjectsDatabase(storageIdentity);
	const diagnostics: BrowserStoreDiagnostic[] = [];
	try {
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			diagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const firstRejected = await store
			.prepareForSession()
			.then(() => false)
			.catch(() => true);
		held.close();
		await delay(30);
		const secondSucceeded = await store
			.prepareForSession()
			.then(() => true)
			.catch(() => false);
		const serialized = JSON.stringify(diagnostics);
		return {
			retried: firstRejected && secondSucceeded,
			mechanismNeutral:
				diagnostics.some(
					(diagnostic) =>
						diagnostic.phase === "storage-initialization" &&
						diagnostic.retryable === true,
				) && !/(indexeddb|opfs|database|object store|target)/i.test(serialized),
		};
	} finally {
		held.close();
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeCleanupIntentFailure(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return probeDurableMigrationFailure({
		...args,
		kind: "cleanup-intent",
	});
}

async function probeCommittedReadbackFailure(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return probeDurableMigrationFailure({
		...args,
		kind: "commit-readback",
	});
}

async function probeDurableMigrationFailure(args: {
	prefix: string;
	cleanupProof: string[];
	kind: "cleanup-intent" | "commit-readback";
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-${args.kind}`;
	const sceneId = "legacy-scene";
	const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
	const projectTimelineDatabase = `video-editor-timelines-${projectId}`;
	let failed = false;
	const hooks: BrowserMigrationHooks =
		args.kind === "cleanup-intent"
			? {
					beforeCleanupIntentWrite: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture cleanup intent write failure");
					},
				}
			: {
					beforeCommittedReadback: () => {
						if (failed) return;
						failed = true;
						throw new Error("fixture committed readback failure");
					},
				};
	const diagnostics: BrowserStoreDiagnostic[] = [];
	try {
		await seedLegacyV1({
			storageIdentity,
			projectId,
			sceneId,
			timelineDatabase,
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			hooks,
			diagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const first = await store.migrate({
			from: 1,
			to: store.schemaVersion,
			report: () => undefined,
		});
		const afterFirst = await idbGet<unknown>({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId },
			},
		});
		const stagedAfterFirst = (
			await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			})
		).databases.some(
			(name) => name.includes("-c5-") && name.endsWith("-stage"),
		);
		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			diagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		await reopened.prepareForSession();
		const second = await reopened.migrate({
			from: projectVersionFromStored(afterFirst),
			to: reopened.schemaVersion,
			report: () => undefined,
		});
		const finalProject = await reopened.load({ id: projectId });
		const finalDatabases = await listDatabaseNames();
		const finalInventory = await inspectDisposableBrowserStorage({
			identity,
			prefix: args.prefix,
		});
		const expectedFirstVersion =
			args.kind === "cleanup-intent" ? 1 : reopened.schemaVersion;
		const expectedDiagnosticPhase =
			args.kind === "cleanup-intent"
				? "migration-cleanup-intent"
				: "migration-commit-validation";
		return (
			first.status === "failed" &&
			projectVersionFromStored(afterFirst) === expectedFirstVersion &&
			stagedAfterFirst &&
			(second.status === "migrated" || second.status === "not-needed") &&
			finalProject?.schemaVersion === reopened.schemaVersion &&
			isRecord(finalProject.data) &&
			isRecord(finalProject.data.providerPrivateProject) &&
			finalProject.data.providerPrivateProject.keep === args.kind &&
			!finalDatabases.includes(timelineDatabase) &&
			!finalDatabases.includes(projectTimelineDatabase) &&
			!finalInventory.databases.some(
				(name) => name.includes("-c5-") && name.endsWith("-stage"),
			) &&
			diagnostics.some(
				(diagnostic) =>
					diagnostic.phase === expectedDiagnosticPhase &&
					diagnostic.retryable === true,
			)
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		await deleteDatabaseExact(timelineDatabase);
		await deleteDatabaseExact(projectTimelineDatabase);
		args.cleanupProof.push(identity, timelineDatabase, projectTimelineDatabase);
	}
}

async function readProjectPair(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
}) {
	return idbGetProjectPair({
		database: args.storageIdentity.projectsDatabase,
		projectStore: args.storageIdentity.projectsStore,
		authorityStore: projectAuthorityStoreName(
			args.storageIdentity.projectsStore,
		),
		key: args.projectId,
		context: {
			operation: "load-project",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
}

async function putAttachmentPair(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
	pair: ReturnType<typeof createCurrentStoredAttachment>;
}): Promise<void> {
	if (args.pair.publicRow === null) {
		throw new Error("Fixture attachment unexpectedly decoded as deleted");
	}
	const database = mediaDatabaseName({
		identity: args.storageIdentity,
		projectId: args.projectId,
	});
	const context = {
		operation: "save-attachment" as const,
		scope: {
			kind: "attachment" as const,
			projectId: args.projectId,
			key: String(args.pair.authorityRow.key),
		},
	};
	await idbPut({
		database,
		store: args.storageIdentity.mediaStore,
		value: args.pair.publicRow,
		context,
	});
	await idbPut({
		database,
		store: attachmentAuthorityStoreName(args.storageIdentity.mediaStore),
		value: args.pair.authorityRow,
		context,
	});
}

async function readAttachmentPair(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
	key: string;
}) {
	return idbGetAttachmentPair({
		database: mediaDatabaseName({
			identity: args.storageIdentity,
			projectId: args.projectId,
		}),
		mediaStore: args.storageIdentity.mediaStore,
		authorityStore: attachmentAuthorityStoreName(
			args.storageIdentity.mediaStore,
		),
		key: args.key,
		context: {
			operation: "load-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
}

async function readMigrationRecoveryJournal(
	identity: BrowserStorageIdentity,
): Promise<unknown | null> {
	return idbGet<unknown>({
		database: identity.projectsDatabase,
		store: migrationMaintenanceStore(identity),
		key: "migration-recovery",
		context: { operation: "inspect", scope: { kind: "store" } },
	});
}

function migrationRecoveryAttachment(args: {
	journal: unknown;
	projectId: string;
	key: string;
}): unknown {
	if (!isRecord(args.journal) || !Array.isArray(args.journal.projects)) {
		return null;
	}
	const project = args.journal.projects.find(
		(candidate) => isRecord(candidate) && candidate.id === args.projectId,
	);
	if (!isRecord(project) || !Array.isArray(project.attachments)) return null;
	return (
		project.attachments.find(
			(candidate) => isRecord(candidate) && candidate.key === args.key,
		) ?? null
	);
}

async function withFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(input: {
		identity: string;
		storageIdentity: BrowserStorageIdentity;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	try {
		return await args.run({ identity, storageIdentity });
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

function disposableStore(args: {
	identity: string;
	prefix: string;
	storageIdentity: BrowserStorageIdentity;
	control?: BrowserProjectStoreControl;
	hooks?: BrowserMigrationHooks;
	diagnostic?(diagnostic: BrowserStoreDiagnostic): void;
}): BrowserProjectStore {
	return new BrowserProjectStore({
		storageIdentity: args.storageIdentity,
		migrationPolicy: {
			kind: "disposable",
			identity: args.identity,
			prefix: args.prefix,
		},
		conformanceControl: args.control,
		migrationHooks: args.hooks,
		diagnostic: args.diagnostic,
	});
}

async function runMutation(args: {
	store: BrowserProjectStore;
	projectId: string;
	operation: RaceOperation;
}): Promise<void> {
	if (args.operation === "save") {
		await args.store.save({
			record: {
				id: args.projectId,
				schemaVersion: args.store.schemaVersion,
				data: { concurrentSaveSentinel: { keep: "newer" } },
			},
			summary: summary({ projectId: args.projectId, name: "newer save" }),
		});
		return;
	}
	if (args.operation === "remove") {
		await args.store.remove({ id: args.projectId });
		return;
	}
	await args.store.clear({
		scope: { kind: args.operation === "projects-clear" ? "projects" : "all" },
	});
}

async function finalMutationWon(args: {
	store: BrowserProjectStore;
	projectId: string;
	operation: RaceOperation;
}): Promise<boolean> {
	const project = await args.store.load({ id: args.projectId });
	if (args.operation !== "save") return project === null;
	return (
		project?.schemaVersion === args.store.schemaVersion &&
		isRecord(project.data) &&
		isRecord(project.data.concurrentSaveSentinel) &&
		project.data.concurrentSaveSentinel.keep === "newer"
	);
}

function publicOperation(
	operation: RaceOperation,
): "save-project" | "remove-project" | "clear" {
	if (operation === "save") return "save-project";
	if (operation === "remove") return "remove-project";
	return "clear";
}

async function seedLegacyV30(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
}): Promise<void> {
	await idbPut({
		database: args.storageIdentity.projectsDatabase,
		store: args.storageIdentity.projectsStore,
		value: {
			id: args.projectId,
			version: 30,
			metadata: summary({ projectId: args.projectId, name: "legacy v30" }),
			scenes: [],
			providerPrivateLegacy: { keep: "legacy" },
		},
		context: {
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
}

async function seedLegacyV30WithAttachment(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
	key: string;
}): Promise<void> {
	await seedLegacyV30(args);
	await idbPut({
		database: mediaDatabaseName({
			identity: args.storageIdentity,
			projectId: args.projectId,
		}),
		store: args.storageIdentity.mediaStore,
		value: {
			id: args.key,
			generation: "legacy",
			providerPrivate: { keep: "opaque" },
		},
		context: {
			operation: "save-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
	await opfsWrite({
		directory: mediaDirectoryName({
			identity: args.storageIdentity,
			projectId: args.projectId,
		}),
		key: args.key,
		body: Uint8Array.from([1, 2, 3, 4]).buffer,
		context: {
			operation: "save-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
		},
	});
}

async function seedLegacyV1(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
	sceneId: string;
	timelineDatabase: string;
}): Promise<void> {
	await idbPut({
		database: args.storageIdentity.projectsDatabase,
		store: args.storageIdentity.projectsStore,
		value: {
			id: args.projectId,
			version: 1,
			metadata: summary({ projectId: args.projectId, name: "legacy v1" }),
			scenes: [
				{
					id: args.sceneId,
					isMain: true,
					tracks: [],
					providerPrivateScene: { keep: true },
				},
			],
			providerPrivateProject: {
				keep: args.projectId.endsWith("cleanup-intent")
					? "cleanup-intent"
					: "commit-readback",
			},
		},
		context: {
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
	await idbPut({
		database: args.timelineDatabase,
		store: "timeline",
		value: {
			id: "timeline",
			tracks: [],
			lastModified: "2026-08-02T00:00:00.000Z",
		},
		context: {
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
}

function summary(args: { projectId: string; name: string }) {
	return {
		id: args.projectId,
		name: args.name,
		createdAt: "2026-08-02T00:00:00.000Z",
		updatedAt: "2026-08-02T00:00:00.000Z",
	};
}

function migrationContext() {
	return { from: 30, to: 31, report: () => undefined } as const;
}

function deferred(): Deferred {
	let enter!: () => void;
	const entered = new Promise<void>((resolve) => {
		enter = resolve;
	});
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return {
		entered,
		enter,
		release,
		wait,
	};
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

function isMigrationStageDatabase(name: string): boolean {
	return name.includes("-c5-") && name.endsWith("-stage");
}

function equalBody(args: {
	body: ArrayBuffer;
	expected: readonly number[];
}): boolean {
	const actual = new Uint8Array(args.body);
	return (
		actual.byteLength === args.expected.length &&
		actual.every((value, index) => value === args.expected[index])
	);
}

async function openHeldProjectsDatabase(
	identity: BrowserStorageIdentity,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(identity.projectsDatabase, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(identity.projectsStore)) {
				request.result.createObjectStore(identity.projectsStore, {
					keyPath: "id",
				});
			}
		};
		request.onsuccess = () => {
			request.result.onversionchange = () => undefined;
			resolve(request.result);
		};
		request.onerror = () => reject(request.error);
	});
}
