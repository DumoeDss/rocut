import { ProjectStoreError } from "@/editor/ports";

import {
	createDisposableBrowserStorageIdentity,
	attachmentAuthorityStoreName,
	isRecord,
	mediaBindingFingerprint,
	mediaBindingForIdentity,
	mediaDatabaseName,
	mediaDirectoryName,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import {
	BrowserProjectStore,
	resetBrowserProjectStoreRuntimeForTests,
} from "./browser-project-store";
import type { BrowserLibraryClearBindingV1 } from "./browser-project-store-library-clear-bindings";
import {
	cascadeMaintenanceStoreName,
	createClearJournal,
	projectTombstoneKey,
} from "./browser-project-store-cascade";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
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
	idbClear,
	idbGet,
	idbGetAll,
	idbPut,
	idbPutMany,
	listDatabaseNames,
	listRootEntries,
	opfsRead,
	opfsWrite,
	removeRootDirectoryExact,
} from "./browser-storage-mechanisms";

const CASCADE_FIELD = "__opencutProjectCascade";
const MEDIA_OWNER_FIELD = "__opencutMediaOwner";
const MEDIA_OWNER_COVERAGE_KEY = ".c5-media-owner-coverage";
const MEDIA_OWNER_PREFIX = ".c5-media-owner:";
const LIBRARY_CLEAR_BINDING_FIELD = "__opencutLibraryClearBinding";

export interface BrowserCascadeRound2ProbeResult {
	readonly opaqueCascadeLiteralRoundTrips: boolean;
	readonly opaqueCascadeLiteralCannotDeleteOtherProject: boolean;
	readonly forgedMaintenanceCannotCrossDelete: boolean;
	readonly namespaceClearIsAtomic: boolean;
	readonly allClearCommitIsRecoverable: boolean;
	readonly allClearRetriesAcrossReload: boolean;
	readonly certifiedProjectsClearWithoutEnumeration: boolean;
	readonly certifiedAllClearWithoutEnumeration: boolean;
	readonly uncertifiedProjectsClearRejectsAtomically: boolean;
	readonly uncertifiedAllClearRejectsAtomically: boolean;
	readonly ownerRegistrationClearRaceIsSerialized: boolean;
	readonly uncertifiedBindingMismatchRefusesAtomically: boolean;
	readonly certifiedBindingHistoryCleansExactNamespaces: boolean;
	readonly revision1NeverImplicitlyRebinds: boolean;
	readonly bindingScopedOwnersAvoidCrossProduct: boolean;
	readonly crossBindingRegistrationClearRaceIsSerialized: boolean;
	readonly version2JournalRetriesAcrossBindingReload: boolean;
	readonly version3AllJournalRetriesExactLibraryAcrossConfigurationReload: boolean;
	readonly projectsJournalNeverTouchesLibraryAcrossConfigurationReload: boolean;
	readonly tamperedLibraryBindingCannotCrossDelete: boolean;
	readonly legacyVersion2LibraryBooleanFailsClosed: boolean;
	readonly legacyVersion2LibraryBindingUpgradeConverges: boolean;
	readonly postLibraryPreJournalCrashRetriesExactTarget: boolean;
	readonly version3CodecCardinalityTamperRejects: boolean;
	readonly topologyLibraryReservedPairsRejectAtomically: boolean;
	readonly topologySharedProjectsDatabaseSafeLibraryStoreWorks: boolean;
	readonly topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority: boolean;
	readonly topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit: boolean;
	readonly topologyHistoricalProtectedMediaJournalFailsClosed: boolean;
	readonly topologyHistoricalPhysicalAliasesFailClosed: boolean;
	readonly topologyPrecommitRefusalAllowsSafeSameIdReuse: boolean;
	readonly topologyHistoricalUnsafeJournalKeepsSameIdBlocked: boolean;
	readonly topologyCollisionFreeCascadeStillConverges: boolean;
	readonly cleanupProof: readonly string[];
}

export async function runBrowserProjectStoreCascadeRound2Probes(): Promise<BrowserCascadeRound2ProbeResult> {
	const prefix = "c5-cascade-r2-";
	const cleanupProof: string[] = [];
	const opaque = await probeOpaqueCascadeLiteral({ prefix, cleanupProof });
	const forgedMaintenance = await probeForgedMaintenance({
		prefix,
		cleanupProof,
	});
	const namespaceClearIsAtomic = await probeAtomicNamespaceClear({
		prefix,
		cleanupProof,
	});
	const allClear = await probeRecoverableAllClear({ prefix, cleanupProof });
	const certifiedProjectsClearWithoutEnumeration =
		await probeCertifiedClearWithoutEnumeration({
			prefix,
			cleanupProof,
			scope: "projects",
		});
	const certifiedAllClearWithoutEnumeration =
		await probeCertifiedClearWithoutEnumeration({
			prefix,
			cleanupProof,
			scope: "all",
		});
	const uncertifiedProjectsClearRejectsAtomically =
		await probeUncertifiedClearWithoutEnumeration({
			prefix,
			cleanupProof,
			scope: "projects",
		});
	const uncertifiedAllClearRejectsAtomically =
		await probeUncertifiedClearWithoutEnumeration({
			prefix,
			cleanupProof,
			scope: "all",
		});
	const ownerRegistrationClearRaceIsSerialized =
		await probeOwnerRegistrationClearRace({ prefix, cleanupProof });
	const uncertifiedBindingMismatchRefusesAtomically =
		await probeUncertifiedBindingMismatch({ prefix, cleanupProof });
	const certifiedBindingHistoryCleansExactNamespaces =
		await probeCertifiedBindingHistory({ prefix, cleanupProof });
	const revision1NeverImplicitlyRebinds =
		await probeRevision1NeverImplicitlyRebinds({ prefix, cleanupProof });
	const bindingScopedOwnersAvoidCrossProduct =
		await probeBindingScopedExactness({ prefix, cleanupProof });
	const crossBindingRegistrationClearRaceIsSerialized =
		await probeCrossBindingRegistrationClearRace({ prefix, cleanupProof });
	const version2JournalRetriesAcrossBindingReload =
		await probeVersion2JournalReload({ prefix, cleanupProof });
	const version3AllJournalRetriesExactLibraryAcrossConfigurationReload =
		await probeVersion3AllJournalReload({ prefix, cleanupProof });
	const projectsJournalNeverTouchesLibraryAcrossConfigurationReload =
		await probeProjectsJournalLibraryIsolation({ prefix, cleanupProof });
	const tamperedLibraryBindingCannotCrossDelete =
		await probeTamperedLibraryBinding({ prefix, cleanupProof });
	const legacyVersion2LibraryBooleanFailsClosed =
		await probeLegacyVersion2LibraryBoolean({
			prefix,
			cleanupProof,
			withPreviousBinding: false,
		});
	const legacyVersion2LibraryBindingUpgradeConverges =
		await probeLegacyVersion2LibraryBoolean({
			prefix,
			cleanupProof,
			withPreviousBinding: true,
		});
	const postLibraryPreJournalCrashRetriesExactTarget =
		await probePostLibraryPreJournalCrash({ prefix, cleanupProof });
	const version3CodecCardinalityTamperRejects =
		await probeVersion3CodecNegatives({ prefix, cleanupProof });
	const topologyLibraryReservedPairsRejectAtomically =
		await isolateTopologyProbe(() =>
			probeTopologyLibraryReservedPairs({ prefix, cleanupProof }),
		);
	const topologySharedProjectsDatabaseSafeLibraryStoreWorks =
		await isolateTopologyProbe(() =>
			probeTopologySharedProjectsDatabase({ prefix, cleanupProof }),
		);
	const topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority =
		await isolateTopologyProbe(() =>
			probeTopologyMediaProjectsDatabaseAccess({ prefix, cleanupProof }),
		);
	const topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit =
		await isolateTopologyProbe(() =>
			probeTopologyProtectedMediaPrecommit({ prefix, cleanupProof }),
		);
	const topologyHistoricalProtectedMediaJournalFailsClosed =
		await isolateTopologyProbe(() =>
			probeTopologyHistoricalProtectedMedia({ prefix, cleanupProof }),
		);
	const topologyHistoricalPhysicalAliasesFailClosed =
		await isolateTopologyProbe(() =>
			probeTopologyHistoricalAliases({ prefix, cleanupProof }),
		);
	const topologyPrecommitRefusalAllowsSafeSameIdReuse =
		await isolateTopologyProbe(() =>
			probeTopologySafeSameIdReuse({ prefix, cleanupProof }),
		);
	const topologyHistoricalUnsafeJournalKeepsSameIdBlocked =
		await isolateTopologyProbe(() =>
			probeTopologyHistoricalSameIdBlocked({ prefix, cleanupProof }),
		);
	const topologyCollisionFreeCascadeStillConverges = await isolateTopologyProbe(
		() => probeTopologyCollisionFreeConvergence({ prefix, cleanupProof }),
	);
	return {
		opaqueCascadeLiteralRoundTrips: opaque.roundTrips,
		opaqueCascadeLiteralCannotDeleteOtherProject: opaque.targetSurvived,
		forgedMaintenanceCannotCrossDelete: forgedMaintenance,
		namespaceClearIsAtomic,
		allClearCommitIsRecoverable: allClear.commitRecoverable,
		allClearRetriesAcrossReload: allClear.retried,
		certifiedProjectsClearWithoutEnumeration,
		certifiedAllClearWithoutEnumeration,
		uncertifiedProjectsClearRejectsAtomically,
		uncertifiedAllClearRejectsAtomically,
		ownerRegistrationClearRaceIsSerialized,
		uncertifiedBindingMismatchRefusesAtomically,
		certifiedBindingHistoryCleansExactNamespaces,
		revision1NeverImplicitlyRebinds,
		bindingScopedOwnersAvoidCrossProduct,
		crossBindingRegistrationClearRaceIsSerialized,
		version2JournalRetriesAcrossBindingReload,
		version3AllJournalRetriesExactLibraryAcrossConfigurationReload,
		projectsJournalNeverTouchesLibraryAcrossConfigurationReload,
		tamperedLibraryBindingCannotCrossDelete,
		legacyVersion2LibraryBooleanFailsClosed,
		legacyVersion2LibraryBindingUpgradeConverges,
		postLibraryPreJournalCrashRetriesExactTarget,
		version3CodecCardinalityTamperRejects,
		topologyLibraryReservedPairsRejectAtomically,
		topologySharedProjectsDatabaseSafeLibraryStoreWorks,
		topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority,
		topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit,
		topologyHistoricalProtectedMediaJournalFailsClosed,
		topologyHistoricalPhysicalAliasesFailClosed,
		topologyPrecommitRefusalAllowsSafeSameIdReuse,
		topologyHistoricalUnsafeJournalKeepsSameIdBlocked,
		topologyCollisionFreeCascadeStillConverges,
		cleanupProof,
	};
}

async function isolateTopologyProbe(
	run: () => Promise<boolean>,
): Promise<boolean> {
	try {
		return await run();
	} catch {
		return false;
	}
}

async function probeTopologyLibraryReservedPairs(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const label of [
		"public",
		"authority",
		"cascade",
		"mediaOwnership",
		"libraryClearBindings",
		"migrationMaintenance",
	] as const) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const stores = browserProjectTopologyStoreNames(base.projectsStore);
					const entries: ReadonlyArray<readonly [keyof typeof stores, string]> =
						[
							["public", stores.public],
							["authority", stores.authority],
							["cascade", stores.cascade],
							["mediaOwnership", stores.mediaOwnership],
							["libraryClearBindings", stores.libraryClearBindings],
							["migrationMaintenance", stores.migrationMaintenance],
						];
					for (const [index, [, store]] of entries.entries()) {
						await seedDatabaseSentinel({
							database: base.projectsDatabase,
							store,
							key: `${identity}-reserved-${index}`,
							byte: 101 + index,
						});
					}
					let failure: unknown;
					try {
						new BrowserProjectStore({
							storageIdentity: {
								...base,
								libraryDatabase: base.projectsDatabase,
								libraryStore: stores[label],
							},
						});
					} catch (error) {
						failure = error;
					}
					const retained = await Promise.all(
						entries.map(([, store], index) =>
							readDatabaseSentinel({
								database: base.projectsDatabase,
								store,
								key: `${identity}-reserved-${index}`,
							}),
						),
					);
					return (
						failure instanceof ProjectStoreError &&
						failure.code === "unavailable" &&
						retained.every((byte, index) => byte === 101 + index)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeTopologySharedProjectsDatabase(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	const scopes: readonly ("projects" | "all")[] = ["projects", "all"];
	for (const [index, scope] of scopes.entries()) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const storageIdentity = {
						...base,
						libraryDatabase: base.projectsDatabase,
						libraryStore: `${identity}-safe-library-store`,
					};
					const store = new BrowserProjectStore({ storageIdentity });
					await store.list();
					const projectId = `${identity}-shared-${scope}`;
					const namespace = `${identity}-shared-library`;
					await seedProjectTree({ store, projectId, byte: 111 + index });
					await store.saveLibraryRecord({
						namespace,
						key: "sentinel",
						schemaVersion: 1,
						data: { byte: 121 + index },
					});
					await store.clear({ scope: { kind: scope } });
					const [project, attachment, library] = await Promise.all([
						store.load({ id: projectId }),
						store.loadAttachment({ projectId, key: "media" }),
						store.loadLibraryRecord({ namespace, key: "sentinel" }),
					]);
					return (
						project === null &&
						attachment === null &&
						(scope === "projects"
							? JSON.stringify(library?.data) ===
								JSON.stringify({ byte: 121 + index })
							: library === null)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeTopologyMediaProjectsDatabaseAccess(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const [index, operation] of (["load", "save"] as const).entries()) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const projectId = "projects";
					const storageIdentity = mediaDatabaseTargetIdentity({
						base,
						projectId,
						database: base.projectsDatabase,
					});
					const store = new BrowserProjectStore({ storageIdentity });
					await store.list();
					await seedProject({
						store,
						projectId,
						data: { byte: 131 + index, identity },
					});
					const mediaStore = storageIdentity.mediaStore;
					const authorityStore = attachmentAuthorityStoreName(mediaStore);
					const targetDatabase = storageIdentity.projectsDatabase;
					const targetDirectory = mediaDirectoryName({
						identity: storageIdentity,
						projectId,
					});
					const beforeShape = await readDatabaseShape(targetDatabase);
					const beforeDirectories = await listRootEntries();
					const action = () =>
						runForbiddenMediaAction({
							store,
							projectId,
							operation,
							index,
						});
					const descriptorFaultsPassed = await runDescriptorFaultControls({
						database: targetDatabase,
						mediaStore,
						authorityStore,
						action,
						cleanupProof: args.cleanupProof,
					});
					const sensitivity = await probeForbiddenMediaAccessSensitivity({
						database: targetDatabase,
						mediaStore,
						authorityStore,
					});
					const afterSensitivityShape = await readDatabaseShape(targetDatabase);
					const afterSensitivityDirectories = await listRootEntries();
					const observed = await observeForbiddenMediaAccess({
						database: targetDatabase,
						mediaStore,
						authorityStore,
						run: action,
					});
					const afterShape = await readDatabaseShape(targetDatabase);
					const afterDirectories = await listRootEntries();
					const failure = observed.result;
					const project = await store.load({ id: projectId });
					args.cleanupProof.push(
						`media-pre-permit:${operation}:sensitivity=${sensitivity.targetDatabaseOpenCount}/${sensitivity.sidecarTransactionCount}/${sensitivity.opfsRootAccessCount}:observed=${observed.targetDatabaseOpenCount}/${observed.sidecarTransactionCount}/${observed.opfsRootAccessCount}`,
					);
					return (
						descriptorFaultsPassed &&
						failure instanceof ProjectStoreError &&
						failure.code === "unavailable" &&
						isRecord(project?.data) &&
						project.data.byte === 131 + index &&
						(await maintenanceRows(base)).length === 0 &&
						sensitivity.targetDatabaseOpenCount > 0 &&
						sensitivity.sidecarTransactionCount > 0 &&
						sensitivity.opfsRootAccessCount > 0 &&
						!beforeShape.stores.includes(mediaStore) &&
						!beforeShape.stores.includes(authorityStore) &&
						beforeShape.version === afterSensitivityShape.version &&
						JSON.stringify(beforeShape.stores) ===
							JSON.stringify(afterSensitivityShape.stores) &&
						!afterSensitivityDirectories.includes(targetDirectory) &&
						observed.sidecarTransactionCount === 0 &&
						observed.opfsRootAccessCount === 0 &&
						beforeShape.version === afterShape.version &&
						JSON.stringify(beforeShape.stores) ===
							JSON.stringify(afterShape.stores) &&
						!beforeDirectories.includes(targetDirectory) &&
						!afterDirectories.includes(targetDirectory)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

interface ForbiddenMediaAccessObservation {
	readonly result: unknown;
	readonly targetDatabaseOpenCount: number;
	readonly sidecarTransactionCount: number;
	readonly opfsRootAccessCount: number;
}

type DescriptorFaultPhase = "install" | "restore";

interface DescriptorFaultPlan {
	readonly phase: DescriptorFaultPhase;
	readonly position: 1 | 2 | 3;
}

interface DescriptorDefineRequest {
	readonly target: object;
	readonly property: PropertyKey;
	readonly descriptor: PropertyDescriptor;
	readonly phase: DescriptorFaultPhase;
	readonly position: 1 | 2 | 3;
}

type DescriptorDefine = (request: DescriptorDefineRequest) => void;

interface InstalledDescriptor {
	readonly target: object;
	readonly property: PropertyKey;
	readonly original: PropertyDescriptor;
	readonly wrapper: PropertyDescriptor;
}

async function observeForbiddenMediaAccess(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	run: () => Promise<unknown>;
	defineProperty?: DescriptorDefine;
}): Promise<ForbiddenMediaAccessObservation> {
	const openDescriptor = Object.getOwnPropertyDescriptor(
		IDBFactory.prototype,
		"open",
	);
	const transactionDescriptor = Object.getOwnPropertyDescriptor(
		IDBDatabase.prototype,
		"transaction",
	);
	const storagePrototype: unknown = Object.getPrototypeOf(navigator.storage);
	if (typeof storagePrototype !== "object" || storagePrototype === null) {
		return {
			result: await args.run(),
			targetDatabaseOpenCount: Number.POSITIVE_INFINITY,
			sidecarTransactionCount: Number.POSITIVE_INFINITY,
			opfsRootAccessCount: Number.POSITIVE_INFINITY,
		};
	}
	const directoryDescriptor = Object.getOwnPropertyDescriptor(
		storagePrototype,
		"getDirectory",
	);
	if (!openDescriptor || !transactionDescriptor || !directoryDescriptor) {
		return {
			result: await args.run(),
			targetDatabaseOpenCount: Number.POSITIVE_INFINITY,
			sidecarTransactionCount: Number.POSITIVE_INFINITY,
			opfsRootAccessCount: Number.POSITIVE_INFINITY,
		};
	}
	let targetDatabaseOpenCount = 0;
	let sidecarTransactionCount = 0;
	let opfsRootAccessCount = 0;
	const originalOpen = IDBFactory.prototype.open;
	const originalTransaction = IDBDatabase.prototype.transaction;
	const originalGetDirectory = navigator.storage.getDirectory;
	const defineProperty =
		args.defineProperty ??
		((request: DescriptorDefineRequest) => {
			Object.defineProperty(
				request.target,
				request.property,
				request.descriptor,
			);
		});
	const descriptors: readonly InstalledDescriptor[] = [
		{
			target: IDBFactory.prototype,
			property: "open",
			original: openDescriptor,
			wrapper: {
				...openDescriptor,
				// IndexedDB's native method signature is intentionally positional.
				// eslint-disable-next-line opencut/prefer-object-params
				value: function fixtureTopologyOpen(
					this: IDBFactory,
					name: string,
					version?: number,
				): IDBOpenDBRequest {
					if (name === args.database) targetDatabaseOpenCount += 1;
					return version === undefined
						? originalOpen.call(this, name)
						: originalOpen.call(this, name, version);
				},
			},
		},
		{
			target: IDBDatabase.prototype,
			property: "transaction",
			original: transactionDescriptor,
			wrapper: {
				...transactionDescriptor,
				// IndexedDB's native method signature is intentionally positional.
				// eslint-disable-next-line opencut/prefer-object-params
				value: function fixtureTopologyTransaction(
					this: IDBDatabase,
					storeNames: string | string[],
					...rest: unknown[]
				): IDBTransaction {
					const names =
						typeof storeNames === "string" ? [storeNames] : storeNames;
					if (
						this.name === args.database &&
						names.some(
							(store) =>
								store === args.mediaStore || store === args.authorityStore,
						)
					) {
						sidecarTransactionCount += 1;
					}
					const transaction = Reflect.apply(originalTransaction, this, [
						storeNames,
						...rest,
					]);
					if (!(transaction instanceof IDBTransaction)) {
						throw new TypeError("IndexedDB transaction instrumentation failed");
					}
					return transaction;
				},
			},
		},
		{
			target: storagePrototype,
			property: "getDirectory",
			original: directoryDescriptor,
			wrapper: {
				...directoryDescriptor,
				value: function fixtureTopologyGetDirectory(
					this: StorageManager,
				): Promise<FileSystemDirectoryHandle> {
					opfsRootAccessCount += 1;
					return Reflect.apply(originalGetDirectory, this, []);
				},
			},
		},
	];
	const installed: InstalledDescriptor[] = [];
	let primaryError: unknown = null;
	let result: unknown;
	try {
		for (const [index, descriptor] of descriptors.entries()) {
			const position = descriptorPositionForIndex(index);
			defineProperty({
				target: descriptor.target,
				property: descriptor.property,
				descriptor: descriptor.wrapper,
				phase: "install",
				position,
			});
			installed.push(descriptor);
		}
		if (installed.length !== descriptors.length) {
			throw new Error("Incomplete topology instrumentation installation");
		}
		result = await args.run();
	} catch (error) {
		primaryError = error;
	}
	const cleanupErrors = restoreInstalledDescriptors({
		installed,
		defineProperty,
	});
	if (primaryError !== null || cleanupErrors.length > 0) {
		throwObserverErrors({ primaryError, cleanupErrors });
	}
	return {
		result,
		targetDatabaseOpenCount,
		sidecarTransactionCount,
		opfsRootAccessCount,
	};
}

function restoreInstalledDescriptors(args: {
	installed: readonly InstalledDescriptor[];
	defineProperty: DescriptorDefine;
}): unknown[] {
	const failures: Array<{
		descriptor: InstalledDescriptor;
		error: unknown;
	}> = [];
	for (const [index, descriptor] of args.installed.entries()) {
		const position = descriptorPositionForIndex(index);
		try {
			args.defineProperty({
				target: descriptor.target,
				property: descriptor.property,
				descriptor: descriptor.original,
				phase: "restore",
				position,
			});
		} catch (error) {
			failures.push({ descriptor, error });
		}
	}
	for (const failure of [...failures]) {
		const position = descriptorPosition({
			installed: args.installed,
			target: failure.descriptor.target,
			property: failure.descriptor.property,
		});
		try {
			args.defineProperty({
				target: failure.descriptor.target,
				property: failure.descriptor.property,
				descriptor: failure.descriptor.original,
				phase: "restore",
				position,
			});
		} catch (error) {
			failures.push({ descriptor: failure.descriptor, error });
		}
	}
	for (const descriptor of args.installed) {
		const current = Object.getOwnPropertyDescriptor(
			descriptor.target,
			descriptor.property,
		);
		if (
			!samePropertyDescriptor({
				left: current,
				right: descriptor.original,
			})
		) {
			failures.push({
				descriptor,
				error: new Error(
					"Topology instrumentation descriptor was not restored",
				),
			});
		}
	}
	return failures.map((failure) => failure.error);
}

function descriptorPosition(args: {
	installed: readonly InstalledDescriptor[];
	target: object;
	property: PropertyKey;
}): 1 | 2 | 3 {
	const index = args.installed.findIndex(
		(descriptor) =>
			descriptor.target === args.target &&
			descriptor.property === args.property,
	);
	if (index < 0) throw new Error("Unknown topology instrumentation descriptor");
	return descriptorPositionForIndex(index);
}

function descriptorPositionForIndex(index: number): 1 | 2 | 3 {
	if (index === 0) return 1;
	if (index === 1) return 2;
	if (index === 2) return 3;
	throw new Error("Unknown topology instrumentation position");
}

function samePropertyDescriptor(args: {
	left: PropertyDescriptor | undefined;
	right: PropertyDescriptor;
}): boolean {
	if (!args.left) return false;
	return (
		args.left.configurable === args.right.configurable &&
		args.left.enumerable === args.right.enumerable &&
		args.left.writable === args.right.writable &&
		args.left.value === args.right.value &&
		args.left.get === args.right.get &&
		args.left.set === args.right.set
	);
}

function throwObserverErrors(args: {
	primaryError: unknown;
	cleanupErrors: readonly unknown[];
}): never {
	const errors = [
		...(args.primaryError === null ? [] : [args.primaryError]),
		...args.cleanupErrors,
	];
	if (errors.length === 1) throw errors[0];
	throw new AggregateError(errors, "Topology instrumentation failed");
}

interface TopologyDescriptorState {
	readonly storagePrototype: object;
	readonly descriptors: readonly InstalledDescriptor[];
}

function topologyDescriptorState(): TopologyDescriptorState | null {
	const storagePrototype: unknown = Object.getPrototypeOf(navigator.storage);
	if (typeof storagePrototype !== "object" || storagePrototype === null)
		return null;
	const descriptors: Array<InstalledDescriptor | null> = [
		topologyDescriptor({ target: IDBFactory.prototype, property: "open" }),
		topologyDescriptor({
			target: IDBDatabase.prototype,
			property: "transaction",
		}),
		topologyDescriptor({ target: storagePrototype, property: "getDirectory" }),
	];
	const complete = descriptors.filter(
		(descriptor): descriptor is InstalledDescriptor => descriptor !== null,
	);
	if (complete.length !== descriptors.length) return null;
	return { storagePrototype, descriptors: complete };
}

function topologyDescriptor(args: {
	target: object;
	property: PropertyKey;
}): InstalledDescriptor | null {
	const original = Object.getOwnPropertyDescriptor(args.target, args.property);
	return original
		? {
				target: args.target,
				property: args.property,
				original,
				wrapper: original,
			}
		: null;
}

function sameTopologyDescriptorState(args: {
	left: TopologyDescriptorState | null;
	right: TopologyDescriptorState | null;
}): boolean {
	if (!args.left || !args.right) return false;
	return args.left.descriptors.every((descriptor, index) => {
		const right = args.right?.descriptors[index];
		return (
			right !== undefined &&
			samePropertyDescriptor({
				left: Object.getOwnPropertyDescriptor(
					descriptor.target,
					descriptor.property,
				),
				right: right.original,
			})
		);
	});
}

async function runDescriptorFaultControls(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	action: () => Promise<unknown>;
	cleanupProof: string[];
}): Promise<boolean> {
	const plans: readonly DescriptorFaultPlan[] = [
		{ phase: "install", position: 1 },
		{ phase: "install", position: 2 },
		{ phase: "install", position: 3 },
		{ phase: "restore", position: 1 },
		{ phase: "restore", position: 2 },
		{ phase: "restore", position: 3 },
	];
	let allPassed = true;
	for (const plan of plans) {
		const before = topologyDescriptorState();
		const objectDefineDescriptor = Object.getOwnPropertyDescriptor(
			Object,
			"defineProperty",
		);
		if (!before || !objectDefineDescriptor) {
			allPassed = false;
			continue;
		}
		const originalDefineProperty = Object.defineProperty;
		let fired = false;
		// IndexedDB/OPFS native methods are intentionally positional here.
		// eslint-disable-next-line opencut/prefer-object-params
		const faultingObjectDefineProperty = function fixtureTopologyDefineProperty(
			this: ObjectConstructor,
			target: object,
			property: PropertyKey,
			attributes: PropertyDescriptor,
		): unknown {
			const position = topologyDescriptorPosition({
				state: before,
				target,
				property,
			});
			const original =
				position === null
					? null
					: (before.descriptors[position - 1]?.original ?? null);
			const isRestore =
				original !== null &&
				samePropertyDescriptor({ left: attributes, right: original });
			const isInstall = position !== null && !isRestore;
			if (
				!fired &&
				position === plan.position &&
				((plan.phase === "install" && isInstall) ||
					(plan.phase === "restore" && isRestore))
			) {
				fired = true;
				throw new Error(
					`one-shot Object.defineProperty fault: ${plan.phase}/${plan.position}`,
				);
			}
			return originalDefineProperty.call(this, target, property, attributes);
		};
		originalDefineProperty.call(Object, Object, "defineProperty", {
			...objectDefineDescriptor,
			value: faultingObjectDefineProperty,
		});
		let observerError: unknown = null;
		try {
			await observeForbiddenMediaAccess({
				database: args.database,
				mediaStore: args.mediaStore,
				authorityStore: args.authorityStore,
				run: args.action,
			});
		} catch (error) {
			observerError = error;
		} finally {
			originalDefineProperty.call(
				Object,
				Object,
				"defineProperty",
				objectDefineDescriptor,
			);
		}
		const restored = sameTopologyDescriptorState({
			left: before,
			right: topologyDescriptorState(),
		});
		let sensitivity: ForbiddenMediaAccessObservation | null = null;
		let subsequent: ForbiddenMediaAccessObservation | null = null;
		try {
			sensitivity = await probeForbiddenMediaAccessSensitivity({
				database: args.database,
				mediaStore: args.mediaStore,
				authorityStore: args.authorityStore,
			});
			subsequent = await observeForbiddenMediaAccess({
				database: args.database,
				mediaStore: args.mediaStore,
				authorityStore: args.authorityStore,
				run: args.action,
			});
		} catch {
			// The case is false; descriptor state and diagnostics below remain visible.
		}
		const casePassed =
			fired &&
			observerError !== null &&
			restored &&
			sensitivity !== null &&
			sensitivity.targetDatabaseOpenCount > 0 &&
			sensitivity.sidecarTransactionCount > 0 &&
			sensitivity.opfsRootAccessCount > 0 &&
			subsequent !== null &&
			subsequent.sidecarTransactionCount === 0 &&
			subsequent.opfsRootAccessCount === 0 &&
			subsequent.result instanceof ProjectStoreError &&
			subsequent.result.code === "unavailable";
		args.cleanupProof.push(
			`descriptor-fault:${plan.phase}/${plan.position}:fired=${fired}:restored=${restored}:subsequent=${casePassed}`,
		);
		allPassed = allPassed && casePassed;
	}
	return allPassed;
}

function topologyDescriptorPosition(args: {
	state: TopologyDescriptorState;
	target: object;
	property: PropertyKey;
}): 1 | 2 | 3 | null {
	const index = args.state.descriptors.findIndex(
		(descriptor) =>
			descriptor.target === args.target &&
			descriptor.property === args.property,
	);
	return index < 0 ? null : descriptorPositionForIndex(index);
}

async function probeForbiddenMediaAccessSensitivity(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
}): Promise<ForbiddenMediaAccessObservation> {
	return observeForbiddenMediaAccess({
		database: args.database,
		mediaStore: args.mediaStore,
		authorityStore: args.authorityStore,
		run: async () => {
			const database = await openDatabaseForObservation(args.database);
			try {
				try {
					database.transaction(args.authorityStore, "readonly");
				} catch {
					// The sidecar store is intentionally absent; NotFoundError is expected.
				}
			} finally {
				database.close();
			}
			await navigator.storage.getDirectory();
			return null;
		},
	});
}

async function openDatabaseForObservation(
	database: string,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(database);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new DOMException("blocked", "InvalidStateError"));
	});
}

async function runForbiddenMediaAction(args: {
	store: BrowserProjectStore;
	projectId: string;
	operation: "load" | "save";
	index: number;
}): Promise<unknown> {
	try {
		if (args.operation === "load") {
			await args.store.loadAttachment({
				projectId: args.projectId,
				key: "sentinel",
			});
		} else {
			await args.store.saveAttachment({
				projectId: args.projectId,
				key: "sentinel",
				metadata: { operation: args.operation },
				body: new Uint8Array([141 + args.index]).buffer,
			});
		}
	} catch (error) {
		return error;
	}
	return null;
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

async function probeTopologyProtectedMediaPrecommit(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const targetKind of ["PDB", "LDB", "SP", "SA"] as const) {
		for (const operation of ["remove", "projects", "all"] as const) {
			outcomes.push(
				await withTopologyFixture({
					...args,
					run: async ({ identity, base }) => {
						const stages = browserMigrationStageNames(base.projectsDatabase);
						const target =
							targetKind === "PDB"
								? { database: base.projectsDatabase, projectId: "projects" }
								: targetKind === "LDB"
									? { database: base.libraryDatabase, projectId: "sounds" }
									: targetKind === "SP"
										? {
												database: stages.projects.database,
												projectId: "stage",
											}
										: {
												database: stages.attachments.database,
												projectId: "stage",
											};
						const storageIdentity = mediaDatabaseTargetIdentity({
							base,
							...target,
						});
						const store = new BrowserProjectStore({ storageIdentity });
						await store.list();
						const byte =
							151 +
							["PDB", "LDB", "SP", "SA"].indexOf(targetKind) * 3 +
							["remove", "projects", "all"].indexOf(operation);
						await seedProject({
							store,
							projectId: target.projectId,
							data: { byte, targetKind, operation },
						});
						const namespace = `${identity}-${targetKind}-${operation}`;
						await store.saveLibraryRecord({
							namespace,
							key: "sentinel",
							schemaVersion: 1,
							data: { byte: byte + 20 },
						});
						if (targetKind === "SP" || targetKind === "SA") {
							await seedDatabaseSentinel({
								database: target.database,
								store:
									targetKind === "SP"
										? stages.projects.store
										: stages.attachments.store,
								key: `${identity}-stage-sentinel`,
								byte: byte + 40,
							});
						}
						let failure: unknown;
						try {
							if (operation === "remove") {
								await store.remove({ id: target.projectId });
							} else {
								await store.clear({ scope: { kind: operation } });
							}
						} catch (error) {
							failure = error;
						}
						const [project, library, maintenance] = await Promise.all([
							store.load({ id: target.projectId }),
							store.loadLibraryRecord({ namespace, key: "sentinel" }),
							maintenanceRows(base),
						]);
						const stageByte =
							targetKind === "SP" || targetKind === "SA"
								? await readDatabaseSentinel({
										database: target.database,
										store:
											targetKind === "SP"
												? stages.projects.store
												: stages.attachments.store,
										key: `${identity}-stage-sentinel`,
									})
								: null;
						return (
							failure instanceof ProjectStoreError &&
							failure.code === "unavailable" &&
							isRecord(project?.data) &&
							project.data.byte === byte &&
							isRecord(library?.data) &&
							library.data.byte === byte + 20 &&
							maintenance.length === 0 &&
							(stageByte === null || stageByte === byte + 40)
						);
					},
				}),
			);
		}
	}
	return outcomes.every(Boolean);
}

async function probeTopologyHistoricalProtectedMedia(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const targetKind of ["PDB", "LDB", "SP", "SA"] as const) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const store = new BrowserProjectStore({ storageIdentity: base });
					await store.list();
					const stages = browserMigrationStageNames(base.projectsDatabase);
					const target =
						targetKind === "PDB"
							? { database: base.projectsDatabase, projectId: "projects" }
							: targetKind === "LDB"
								? { database: base.libraryDatabase, projectId: "sounds" }
								: targetKind === "SP"
									? {
											database: stages.projects.database,
											projectId: "stage",
										}
									: {
											database: stages.attachments.database,
											projectId: "stage",
										};
					const byte = 191 + ["PDB", "LDB", "SP", "SA"].indexOf(targetKind);
					const directory = `${identity}-historical-root-${target.projectId}`;
					const claim = await seedHistoricalMediaClaim({
						controlIdentity: base,
						...target,
						directory,
					});
					await seedPhysicalSentinel({
						database: target.database,
						directory,
						store: `${identity}-historical-protected`,
						key: `${identity}-${targetKind}`,
						byte,
					});
					const journal = createClearJournal({
						id: `.c5-project-clear-${identity}-${targetKind}`,
						clearScope: "projects",
						mediaTargets: [claim],
						libraryTargets: [],
					});
					await putMaintenanceRow({ identity: base, value: journal });
					const diagnostics: BrowserStoreDiagnostic[] = [];
					resetBrowserProjectStoreRuntimeForTests();
					const reopened = new BrowserProjectStore({
						storageIdentity: base,
						diagnostic: (diagnostic) => diagnostics.push(diagnostic),
					});
					await reopened.list();
					const [databaseByte, directoryByte, maintenance] = await Promise.all([
						readDatabaseSentinel({
							database: target.database,
							store: `${identity}-historical-protected`,
							key: `${identity}-${targetKind}`,
						}),
						readDirectorySentinel({
							directory,
							key: `${identity}-${targetKind}`,
						}),
						maintenanceRows(base),
					]);
					return (
						databaseByte === byte &&
						directoryByte === byte &&
						maintenance.some(
							(row) => JSON.stringify(row) === JSON.stringify(journal),
						) &&
						hasTopologyConflictDiagnostic(diagnostics)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeTopologyHistoricalAliases(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const [caseIndex, alias] of ["database", "directory"].entries()) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const store = new BrowserProjectStore({ storageIdentity: base });
					await store.list();
					const projectIds = ["a", "ba"] as const;
					const sharedDatabase = `${identity}-shared-dba`;
					const sharedDirectory = `${identity}-shared-root-ba`;
					const targets = await Promise.all(
						projectIds.map((projectId, index) =>
							seedHistoricalMediaClaim({
								controlIdentity: base,
								projectId,
								database:
									alias === "database"
										? sharedDatabase
										: `${identity}-alias-${index}-db-${projectId}`,
								directory:
									alias === "directory"
										? sharedDirectory
										: `${identity}-alias-${index}-root-${projectId}`,
							}),
						),
					);
					for (const [index, target] of targets.entries()) {
						await seedPhysicalSentinel({
							database: target.database,
							directory: target.directory,
							store: `${identity}-alias-sentinels`,
							key: `${identity}-${alias}-${index}`,
							byte: 201 + caseIndex * 4 + index,
						});
					}
					const journal = createClearJournal({
						id: `.c5-project-clear-${identity}-${alias}`,
						clearScope: "projects",
						mediaTargets: targets,
						libraryTargets: [],
					});
					await putMaintenanceRow({ identity: base, value: journal });
					const diagnostics: BrowserStoreDiagnostic[] = [];
					resetBrowserProjectStoreRuntimeForTests();
					const reopened = new BrowserProjectStore({
						storageIdentity: base,
						diagnostic: (diagnostic) => diagnostics.push(diagnostic),
					});
					await reopened.list();
					const retained = await Promise.all(
						targets.flatMap((target, index) => [
							readDatabaseSentinel({
								database: target.database,
								store: `${identity}-alias-sentinels`,
								key: `${identity}-${alias}-${index}`,
							}),
							readDirectorySentinel({
								directory: target.directory,
								key: `${identity}-${alias}-${index}`,
							}),
						]),
					);
					return (
						retained.every(
							(byte, index) =>
								byte === 201 + caseIndex * 4 + Math.floor(index / 2),
						) &&
						(await rawClearJournals(base)).length === 1 &&
						hasTopologyConflictDiagnostic(diagnostics)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeTopologySafeSameIdReuse(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	const operations: readonly ("remove" | "projects" | "all")[] = [
		"remove",
		"projects",
		"all",
	];
	for (const [index, operation] of operations.entries()) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const projectId = "projects";
					const dangerousIdentity = mediaDatabaseTargetIdentity({
						base,
						projectId,
						database: base.projectsDatabase,
					});
					const dangerous = new BrowserProjectStore({
						storageIdentity: dangerousIdentity,
					});
					await dangerous.list();
					await seedProject({
						store: dangerous,
						projectId,
						data: { byte: 211 + index },
					});
					let refusal: unknown;
					try {
						if (operation === "remove")
							await dangerous.remove({ id: projectId });
						else
							await dangerous.clear({
								scope: { kind: operation },
							});
					} catch (error) {
						refusal = error;
					}
					const beforeReuse = await maintenanceRows(base);
					resetBrowserProjectStoreRuntimeForTests();
					const safeIdentity = {
						...base,
						mediaDatabasePrefix: `${identity}-safe-media-`,
						mediaDirectoryPrefix: `${identity}-safe-root-`,
					};
					const safe = new BrowserProjectStore({
						storageIdentity: safeIdentity,
					});
					await safe.list();
					await seedProject({
						store: safe,
						projectId,
						data: { byte: 221 + index },
					});
					await safe.saveAttachment({
						projectId,
						key: "same-id",
						metadata: { operation },
						body: new Uint8Array([231 + index]).buffer,
					});
					const [project, attachment] = await Promise.all([
						safe.load({ id: projectId }),
						safe.loadAttachment({ projectId, key: "same-id" }),
					]);
					return (
						refusal instanceof ProjectStoreError &&
						refusal.code === "unavailable" &&
						beforeReuse.length === 0 &&
						isRecord(project?.data) &&
						project.data.byte === 221 + index &&
						byteString(attachment?.body) === String(231 + index)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeTopologyHistoricalSameIdBlocked(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withTopologyFixture({
		...args,
		run: async ({ identity, base }) => {
			const initial = new BrowserProjectStore({ storageIdentity: base });
			await initial.list();
			const projectId = "projects";
			const directory = `${identity}-blocked-root-${projectId}`;
			const target = await seedHistoricalMediaClaim({
				controlIdentity: base,
				projectId,
				database: base.projectsDatabase,
				directory,
			});
			await seedPhysicalSentinel({
				database: target.database,
				directory,
				store: `${identity}-same-id-blocked`,
				key: `${identity}-same-id`,
				byte: 241,
			});
			await putMaintenanceRow({
				identity: base,
				value: createClearJournal({
					id: `.c5-project-clear-${identity}-same-id`,
					clearScope: "projects",
					mediaTargets: [target],
					libraryTargets: [],
				}),
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: base,
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
			let failure: unknown;
			try {
				await seedProject({ store: reopened, projectId, data: { byte: 242 } });
			} catch (error) {
				failure = error;
			}
			return (
				failure instanceof ProjectStoreError &&
				failure.code === "unavailable" &&
				(await rawClearJournals(base)).length === 1 &&
				(await readDatabaseSentinel({
					database: target.database,
					store: `${identity}-same-id-blocked`,
					key: `${identity}-same-id`,
				})) === 241 &&
				hasTopologyConflictDiagnostic(diagnostics)
			);
		},
	});
}

async function probeTopologyCollisionFreeConvergence(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const [index, window] of ["O", "A"].entries()) {
		outcomes.push(
			await withTopologyFixture({
				...args,
				run: async ({ identity, base }) => {
					const control = new BrowserProjectStoreControl();
					const store = new BrowserProjectStore({
						storageIdentity: base,
						conformanceControl: control,
					});
					await store.list();
					const projectId = `${identity}-converge-${window}`;
					const namespace = `${identity}-converge-library-${window}`;
					await seedProjectTree({ store, projectId, byte: 243 + index });
					await store.saveLibraryRecord({
						namespace,
						key: "sentinel",
						schemaVersion: 1,
						data: { byte: 247 + index },
					});
					if (window === "O") {
						control.failCascadeCleanupAfter({
							operation: "clear",
							afterCompletedTargets: 1,
							code: "unavailable",
						});
						await store.clear({ scope: { kind: "projects" } });
					} else {
						control.failAfterAllClearLibraryCommit("unavailable");
						await store.clear({ scope: { kind: "all" } });
					}
					const pendingBeforeReload = await rawClearJournals(base);
					resetBrowserProjectStoreRuntimeForTests();
					const reopened = new BrowserProjectStore({ storageIdentity: base });
					await reopened.list();
					const [library, inventory, journals] = await Promise.all([
						reopened.loadLibraryRecord({ namespace, key: "sentinel" }),
						inspectDisposableBrowserStorage({ identity, prefix: args.prefix }),
						rawClearJournals(base),
					]);
					return (
						pendingBeforeReload.length === 1 &&
						journals.length === 0 &&
						!inventory.databases.includes(
							mediaDatabaseName({ identity: base, projectId }),
						) &&
						!inventory.directories.includes(
							mediaDirectoryName({ identity: base, projectId }),
						) &&
						(window === "O"
							? isRecord(library?.data) && library.data.byte === 247 + index
							: library === null)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeCertifiedClearWithoutEnumeration(args: {
	prefix: string;
	cleanupProof: string[];
	scope: "projects" | "all";
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, store }) => {
			const projectId = `${identity}-${args.scope}`;
			const ownerOnlyId = `${identity}-${args.scope}-owner-only`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store, projectId, byte: 44 });
			await store.saveAttachment({
				projectId: ownerOnlyId,
				key: "media",
				metadata: { ownerOnly: true },
				body: new Uint8Array([45]).buffer,
			});
			await store.saveLibraryRecord({
				namespace,
				key: "item",
				schemaVersion: 1,
				data: { keep: true },
			});
			await withDatabaseEnumerationMasked(() =>
				store.clear({ scope: { kind: args.scope } }),
			);
			await seedProject({ store, projectId });
			await seedProject({ store, projectId: ownerOnlyId });
			let oldAttachment: Awaited<ReturnType<typeof store.loadAttachment>>;
			let ownerOnlyAttachment: Awaited<ReturnType<typeof store.loadAttachment>>;
			try {
				oldAttachment = await store.loadAttachment({
					projectId,
					key: "media",
				});
				ownerOnlyAttachment = await store.loadAttachment({
					projectId: ownerOnlyId,
					key: "media",
				});
			} catch {
				return false;
			}
			const library = await store.loadLibraryRecord({
				namespace,
				key: "item",
			});
			return (
				oldAttachment === null &&
				ownerOnlyAttachment === null &&
				(args.scope === "projects" ? library !== null : library === null)
			);
		},
	});
}

async function probeUncertifiedClearWithoutEnumeration(args: {
	prefix: string;
	cleanupProof: string[];
	scope: "projects" | "all";
}): Promise<boolean> {
	return withMaskedFixture({
		...args,
		run: async ({ identity, store }) => {
			const projectId = `${identity}-${args.scope}`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store, projectId, byte: 55 });
			await store.saveLibraryRecord({
				namespace,
				key: "item",
				schemaVersion: 1,
				data: { keep: true },
			});
			let failure: unknown;
			try {
				await store.clear({ scope: { kind: args.scope } });
			} catch (error) {
				failure = error;
			}
			if (
				!(failure instanceof ProjectStoreError) ||
				failure.code !== "unavailable"
			) {
				return false;
			}
			const project = await store.load({ id: projectId });
			const attachment = await store.loadAttachment({
				projectId,
				key: "media",
			});
			const library = await store.loadLibraryRecord({
				namespace,
				key: "item",
			});
			return (
				project !== null &&
				byteString(attachment?.body) === "55" &&
				library !== null
			);
		},
	});
}

async function probeOwnerRegistrationClearRace(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity, store, control }) => {
			const projectId = `${identity}-read-owner`;
			const pause = control.pauseNextMediaAccess({
				operation: "load-attachment",
			});
			const read = store.loadAttachment({ projectId, key: "missing" });
			await pause.entered;
			let clearSettled = false;
			const clear = withDatabaseEnumerationMasked(async () => {
				await store.clear({ scope: { kind: "projects" } });
				clearSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			const settledBeforeRelease = clearSettled;
			pause.release();
			await Promise.all([read, clear]);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				!settledBeforeRelease &&
				inventory.databases.every(
					(name) => !name.startsWith(storageIdentity.mediaDatabasePrefix),
				) &&
				inventory.directories.every(
					(name) => !name.startsWith(storageIdentity.mediaDirectoryPrefix),
				)
			);
		},
	});
}

async function probeUncertifiedBindingMismatch(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const base = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const oldIdentity = mediaBindingVariant({ base, label: "old" });
	const newIdentity = mediaBindingVariant({ base, label: "new" });
	const oldStore = new BrowserProjectStore({ storageIdentity: oldIdentity });
	try {
		await oldStore.list();
		const projectId = `${identity}-mismatch`;
		const namespace = `${identity}-library`;
		await seedProjectTree({ store: oldStore, projectId, byte: 61 });
		await oldStore.saveLibraryRecord({
			namespace,
			key: "item",
			schemaVersion: 1,
			data: { keep: true },
		});
		const failures: unknown[] = [];
		await withDatabaseEnumerationMasked(async () => {
			const newStore = new BrowserProjectStore({
				storageIdentity: newIdentity,
			});
			await newStore.list();
			for (const scope of ["projects", "all"] as const) {
				try {
					await newStore.clear({ scope: { kind: scope } });
				} catch (error) {
					failures.push(error);
				}
			}
		});
		const project = await oldStore.load({ id: projectId });
		const attachment = await oldStore.loadAttachment({
			projectId,
			key: "media",
		});
		const library = await oldStore.loadLibraryRecord({
			namespace,
			key: "item",
		});
		const inventory = await inspectDisposableBrowserStorage({
			identity,
			prefix: args.prefix,
		});
		return (
			failures.length === 2 &&
			failures.every(
				(error) =>
					error instanceof ProjectStoreError && error.code === "unavailable",
			) &&
			project !== null &&
			byteString(attachment?.body) === "61" &&
			library !== null &&
			inventory.databases.includes(
				mediaDatabaseName({ identity: oldIdentity, projectId }),
			)
		);
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeCertifiedBindingHistory(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const scope of ["projects", "all"] as const) {
		outcomes.push(
			await withBindingFixture({
				...args,
				run: async ({ identity, oldStore, newStore }) => {
					const projectId = `${identity}-${scope}-history`;
					const namespace = `${identity}-library`;
					await seedProject({ store: oldStore, projectId });
					await oldStore.saveAttachment({
						projectId,
						key: "media",
						metadata: { binding: "old" },
						body: new Uint8Array([62]).buffer,
					});
					await newStore.saveAttachment({
						projectId,
						key: "media",
						metadata: { binding: "new" },
						body: new Uint8Array([63]).buffer,
					});
					await newStore.saveLibraryRecord({
						namespace,
						key: "item",
						schemaVersion: 1,
						data: { keep: true },
					});
					await withDatabaseEnumerationMasked(() =>
						newStore.clear({ scope: { kind: scope } }),
					);
					await seedProject({ store: newStore, projectId });
					const [oldAttachment, newAttachment, library] = await Promise.all([
						oldStore.loadAttachment({ projectId, key: "media" }),
						newStore.loadAttachment({ projectId, key: "media" }),
						newStore.loadLibraryRecord({ namespace, key: "item" }),
					]);
					return (
						oldAttachment === null &&
						newAttachment === null &&
						(scope === "projects" ? library !== null : library === null)
					);
				},
			}),
		);
	}
	return outcomes.every(Boolean);
}

async function probeRevision1NeverImplicitlyRebinds(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const outcomes: boolean[] = [];
	for (const maskEnumeration of [false, true] as const) {
		outcomes.push(
			await withBindingFixture({
				...args,
				run: async ({ identity, oldIdentity, newIdentity, oldStore }) => {
					const projectId = `${identity}-rev1-${maskEnumeration ? "masked" : "available"}`;
					const namespace = `${identity}-library`;
					await seedProjectTree({ store: oldStore, projectId, byte: 64 });
					await oldStore.saveLibraryRecord({
						namespace,
						key: "item",
						schemaVersion: 1,
						data: { keep: true },
					});
					await replaceWithRevision1Ownership({
						storageIdentity: oldIdentity,
						projectId,
					});
					resetBrowserProjectStoreRuntimeForTests();
					let failure: unknown;
					const run = async () => {
						const newStore = new BrowserProjectStore({
							storageIdentity: newIdentity,
						});
						await newStore.list();
						try {
							await newStore.clear({ scope: { kind: "all" } });
						} catch (error) {
							failure = error;
						}
					};
					if (maskEnumeration) await withDatabaseEnumerationMasked(run);
					else await run();
					const rows = await ownershipRows(newIdentity);
					const legacyCoverage = rows.some(isRevision1CoverageRow);
					const reboundCoverage = rows.some((row) => {
						if (!isRecord(row)) return false;
						const envelope = row[MEDIA_OWNER_FIELD];
						return (
							isRecord(envelope) &&
							envelope.kind === "coverage" &&
							envelope.revision === 2
						);
					});
					const project = await oldStore.load({ id: projectId });
					const attachment = await oldStore.loadAttachment({
						projectId,
						key: "media",
					});
					const library = await oldStore.loadLibraryRecord({
						namespace,
						key: "item",
					});
					return (
						failure instanceof ProjectStoreError &&
						failure.code === "unavailable" &&
						legacyCoverage &&
						!reboundCoverage &&
						project !== null &&
						byteString(attachment?.body) === "64" &&
						library !== null
					);
				},
			}),
		);
	}
	const explicitMigrationWorks = await probeExplicitRevision1Binding(args);
	return outcomes.every(Boolean) && explicitMigrationWorks;
}

async function probeExplicitRevision1Binding(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const base = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const oldIdentity = mediaBindingVariant({ base, label: "old" });
	const newIdentity = mediaBindingVariant({ base, label: "new" });
	const oldStore = new BrowserProjectStore({ storageIdentity: oldIdentity });
	const projectId = `${identity}-explicit-rev1`;
	try {
		await oldStore.list();
		await seedProjectTree({ store: oldStore, projectId, byte: 69 });
		await replaceWithRevision1Ownership({
			storageIdentity: oldIdentity,
			projectId,
		});
		resetBrowserProjectStoreRuntimeForTests();
		const migrated = new BrowserProjectStore({
			storageIdentity: newIdentity,
			previousMediaBinding: mediaBindingForIdentity(oldIdentity),
		});
		await migrated.list();
		const oldFingerprint = await mediaBindingFingerprint(
			mediaBindingForIdentity(oldIdentity),
		);
		const rows = await ownershipRows(newIdentity);
		const marker = rows.some((row) => {
			if (!isRecord(row) || row.id !== MEDIA_OWNER_COVERAGE_KEY) return false;
			const envelope = row[MEDIA_OWNER_FIELD];
			return (
				isRecord(envelope) &&
				envelope.revision === 2 &&
				envelope.kind === "legacy-binding" &&
				envelope.fingerprint === oldFingerprint
			);
		});
		await withDatabaseEnumerationMasked(() =>
			migrated.clear({ scope: { kind: "projects" } }),
		);
		await seedProject({ store: migrated, projectId });
		const reader = new BrowserProjectStore({ storageIdentity: oldIdentity });
		const attachment = await reader.loadAttachment({ projectId, key: "media" });
		return marker && attachment === null;
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeBindingScopedExactness(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withBindingFixture({
		...args,
		run: async ({ identity, oldIdentity, newIdentity, oldStore, newStore }) => {
			const oldProjectId = `${identity}-owner-a`;
			const newProjectId = `${identity}-owner-b`;
			await oldStore.saveAttachment({
				projectId: oldProjectId,
				key: "media",
				metadata: { owner: "old" },
				body: new Uint8Array([65]).buffer,
			});
			await newStore.saveAttachment({
				projectId: newProjectId,
				key: "media",
				metadata: { owner: "new" },
				body: new Uint8Array([66]).buffer,
			});
			await seedRawMediaNamespace({
				identity: oldIdentity,
				projectId: newProjectId,
				key: "sentinel-old-b",
			});
			await seedRawMediaNamespace({
				identity: newIdentity,
				projectId: oldProjectId,
				key: "sentinel-new-a",
			});
			await withDatabaseEnumerationMasked(() =>
				newStore.clear({ scope: { kind: "projects" } }),
			);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			const oldA = mediaDatabaseName({
				identity: oldIdentity,
				projectId: oldProjectId,
			});
			const oldB = mediaDatabaseName({
				identity: oldIdentity,
				projectId: newProjectId,
			});
			const newA = mediaDatabaseName({
				identity: newIdentity,
				projectId: oldProjectId,
			});
			const newB = mediaDatabaseName({
				identity: newIdentity,
				projectId: newProjectId,
			});
			return (
				!inventory.databases.includes(oldA) &&
				inventory.databases.includes(oldB) &&
				inventory.databases.includes(newA) &&
				!inventory.databases.includes(newB) &&
				!inventory.directories.includes(
					mediaDirectoryName({
						identity: oldIdentity,
						projectId: oldProjectId,
					}),
				) &&
				inventory.directories.includes(
					mediaDirectoryName({
						identity: oldIdentity,
						projectId: newProjectId,
					}),
				) &&
				inventory.directories.includes(
					mediaDirectoryName({
						identity: newIdentity,
						projectId: oldProjectId,
					}),
				) &&
				!inventory.directories.includes(
					mediaDirectoryName({
						identity: newIdentity,
						projectId: newProjectId,
					}),
				)
			);
		},
	});
}

async function probeCrossBindingRegistrationClearRace(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withBindingFixture({
		...args,
		run: async ({ identity, oldIdentity, oldStore, newStore, control }) => {
			const projectId = `${identity}-cross-binding-race`;
			const pause = control.pauseNextMediaAccess({
				operation: "load-attachment",
			});
			const read = oldStore.loadAttachment({ projectId, key: "missing" });
			await pause.entered;
			let clearSettled = false;
			const clear = withDatabaseEnumerationMasked(async () => {
				await newStore.clear({ scope: { kind: "projects" } });
				clearSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			const settledBeforeRelease = clearSettled;
			pause.release();
			await Promise.all([read, clear]);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				!settledBeforeRelease &&
				!inventory.databases.includes(
					mediaDatabaseName({ identity: oldIdentity, projectId }),
				)
			);
		},
	});
}

async function probeVersion2JournalReload(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withBindingFixture({
		...args,
		run: async ({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			control,
		}) => {
			const projectId = `${identity}-journal-reload`;
			await seedProject({ store: newStore, projectId });
			await oldStore.saveAttachment({
				projectId,
				key: "media",
				metadata: { binding: "old" },
				body: new Uint8Array([67]).buffer,
			});
			await newStore.saveAttachment({
				projectId,
				key: "media",
				metadata: { binding: "new" },
				body: new Uint8Array([68]).buffer,
			});
			control.failCascadeCleanupAfter({
				operation: "clear",
				afterCompletedTargets: 1,
				code: "unavailable",
			});
			await withDatabaseEnumerationMasked(() =>
				newStore.clear({ scope: { kind: "projects" } }),
			);
			resetBrowserProjectStoreRuntimeForTests();
			const reloadControl = new BrowserProjectStoreControl();
			for (let attempt = 0; attempt < 2; attempt += 1) {
				reloadControl.failCascadeCleanupAfter({
					operation: "clear",
					afterCompletedTargets: 1,
					code: "unavailable",
				});
			}
			const reopened = new BrowserProjectStore({
				storageIdentity: oldIdentity,
				conformanceControl: reloadControl,
			});
			await reopened.list();
			let blockedSave: unknown;
			try {
				await seedProject({ store: reopened, projectId });
			} catch (error) {
				blockedSave = error;
			}
			resetBrowserProjectStoreRuntimeForTests();
			const completed = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			await completed.list();
			await seedProject({ store: completed, projectId });
			const oldAttachment = await completed.loadAttachment({
				projectId,
				key: "media",
			});
			const other = new BrowserProjectStore({ storageIdentity: newIdentity });
			const newAttachment = await other.loadAttachment({
				projectId,
				key: "media",
			});
			return (
				blockedSave instanceof ProjectStoreError &&
				blockedSave.code === "unavailable" &&
				oldAttachment === null &&
				newAttachment === null
			);
		},
	});
}

async function probeVersion3AllJournalReload(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			oldControl,
		}) => {
			const projectId = `${identity}-v3-all-reload`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store: oldStore, projectId, byte: 71 });
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 81,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 82,
			});
			oldControl.failCascadeCleanupAfter({
				operation: "clear",
				afterCompletedTargets: 1,
				code: "unavailable",
			});
			await oldStore.clear({ scope: { kind: "all" } });
			const beforeOld = await loadLibrarySentinel({
				store: oldStore,
				namespace,
			});
			const beforeNew = await loadLibrarySentinel({
				store: newStore,
				namespace,
			});
			const pending = await rawClearJournals(oldIdentity);
			const committed = (await oldStore.load({ id: projectId })) === null;
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: newIdentity,
			});
			await reopened.list();
			const oldReader = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			const afterOld = await loadLibrarySentinel({
				store: oldReader,
				namespace,
			});
			const afterNew = await loadLibrarySentinel({
				store: reopened,
				namespace,
			});
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				committed &&
				librarySentinelEquals({ value: beforeOld, binding: "old", byte: 81 }) &&
				librarySentinelEquals({ value: beforeNew, binding: "new", byte: 82 }) &&
				pending.length === 1 &&
				journalHasLibraryCardinality({
					value: pending[0],
					revision: 3,
					clearScope: "all",
					count: 1,
				}) &&
				afterOld === null &&
				librarySentinelEquals({ value: afterNew, binding: "new", byte: 82 }) &&
				!inventory.databases.includes(
					mediaDatabaseName({ identity: oldIdentity, projectId }),
				) &&
				!inventory.directories.includes(
					mediaDirectoryName({ identity: oldIdentity, projectId }),
				) &&
				(await rawClearJournals(oldIdentity)).length === 0
			);
		},
	});
}

async function probeProjectsJournalLibraryIsolation(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			oldControl,
		}) => {
			const projectId = `${identity}-v3-projects-reload`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store: oldStore, projectId, byte: 72 });
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 83,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 84,
			});
			oldControl.failCascadeCleanupAfter({
				operation: "clear",
				afterCompletedTargets: 1,
				code: "unavailable",
			});
			await oldStore.clear({ scope: { kind: "projects" } });
			const pending = await rawClearJournals(oldIdentity);
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: newIdentity,
			});
			await reopened.list();
			const oldReader = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			const [oldLibrary, newLibrary] = await Promise.all([
				loadLibrarySentinel({ store: oldReader, namespace }),
				loadLibrarySentinel({ store: reopened, namespace }),
			]);
			return (
				pending.length === 1 &&
				journalHasLibraryCardinality({
					value: pending[0],
					revision: 3,
					clearScope: "projects",
					count: 0,
				}) &&
				librarySentinelEquals({
					value: oldLibrary,
					binding: "old",
					byte: 83,
				}) &&
				librarySentinelEquals({
					value: newLibrary,
					binding: "new",
					byte: 84,
				}) &&
				(await rawClearJournals(oldIdentity)).length === 0
			);
		},
	});
}

async function probeTamperedLibraryBinding(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			oldControl,
		}) => {
			const projectId = `${identity}-v3-tamper`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store: oldStore, projectId, byte: 73 });
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 85,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 86,
			});
			oldControl.failCascadeCleanupAfter({
				operation: "clear",
				afterCompletedTargets: 1,
				code: "unavailable",
			});
			await oldStore.clear({ scope: { kind: "all" } });
			const bindingStore = `${oldIdentity.projectsStore}-library-clear-bindings`;
			const descriptors = await idbGetAll<unknown>({
				database: oldIdentity.projectsDatabase,
				store: bindingStore,
				context: { operation: "clear", scope: { kind: "store" } },
			});
			if (descriptors.length !== 1 || !isRecord(descriptors[0])) return false;
			const envelope = descriptors[0][LIBRARY_CLEAR_BINDING_FIELD];
			if (!isRecord(envelope) || !isRecord(envelope.binding)) return false;
			await idbPut({
				database: oldIdentity.projectsDatabase,
				store: bindingStore,
				value: {
					...descriptors[0],
					[LIBRARY_CLEAR_BINDING_FIELD]: {
						...envelope,
						binding: {
							...envelope.binding,
							libraryStore: `${newIdentity.libraryStore}-tampered`,
						},
					},
				},
				context: { operation: "clear", scope: { kind: "store" } },
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: newIdentity,
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
			await reopened.list();
			const oldReader = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			const [oldLibrary, newLibrary] = await Promise.all([
				loadLibrarySentinel({ store: oldReader, namespace }),
				loadLibrarySentinel({ store: reopened, namespace }),
			]);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			return (
				librarySentinelEquals({
					value: oldLibrary,
					binding: "old",
					byte: 85,
				}) &&
				librarySentinelEquals({
					value: newLibrary,
					binding: "new",
					byte: 86,
				}) &&
				inventory.directories.includes(
					mediaDirectoryName({ identity: oldIdentity, projectId }),
				) &&
				(await rawClearJournals(oldIdentity)).length === 1 &&
				diagnostics.some(
					(diagnostic) =>
						diagnostic.phase === "project-cascade-postcommit-cleanup" &&
						diagnostic.code === "corrupt" &&
						diagnostic.retryable === false,
				)
			);
		},
	});
}

async function probeLegacyVersion2LibraryBoolean(args: {
	prefix: string;
	cleanupProof: string[];
	withPreviousBinding: boolean;
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({ identity, oldIdentity, newIdentity, oldStore, newStore }) => {
			const projectId = `${identity}-legacy-v2-${args.withPreviousBinding ? "upgrade" : "blocked"}`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store: oldStore, projectId, byte: 74 });
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 87,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 88,
			});
			await seedStrictVersion2ClearJournal({
				identity: oldIdentity,
				projectId,
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			resetBrowserProjectStoreRuntimeForTests();
			const options = {
				storageIdentity: newIdentity,
				diagnostic: (diagnostic: BrowserStoreDiagnostic) =>
					diagnostics.push(diagnostic),
				...(args.withPreviousBinding
					? { previousLibraryBinding: libraryClearBinding(oldIdentity) }
					: {}),
			};
			const reopened = new BrowserProjectStore(options);
			await reopened.list();
			const oldReader = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			const [oldLibrary, newLibrary] = await Promise.all([
				loadLibrarySentinel({ store: oldReader, namespace }),
				loadLibrarySentinel({ store: reopened, namespace }),
			]);
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			const journalCount = (await rawClearJournals(oldIdentity)).length;
			if (args.withPreviousBinding) {
				return (
					oldLibrary === null &&
					librarySentinelEquals({
						value: newLibrary,
						binding: "new",
						byte: 88,
					}) &&
					journalCount === 0 &&
					!inventory.databases.includes(
						mediaDatabaseName({ identity: oldIdentity, projectId }),
					) &&
					!inventory.directories.includes(
						mediaDirectoryName({ identity: oldIdentity, projectId }),
					)
				);
			}
			return (
				librarySentinelEquals({
					value: oldLibrary,
					binding: "old",
					byte: 87,
				}) &&
				librarySentinelEquals({
					value: newLibrary,
					binding: "new",
					byte: 88,
				}) &&
				journalCount === 1 &&
				inventory.databases.includes(
					mediaDatabaseName({ identity: oldIdentity, projectId }),
				) &&
				inventory.directories.includes(
					mediaDirectoryName({ identity: oldIdentity, projectId }),
				) &&
				diagnostics.some(
					(diagnostic) =>
						diagnostic.phase === "project-cascade-library-binding-required" &&
						diagnostic.code === "unavailable" &&
						diagnostic.retryable === false,
				)
			);
		},
	});
}

async function probePostLibraryPreJournalCrash(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			oldControl,
		}) => {
			const namespace = `${oldIdentity.identity}-post-library`;
			const projectId = `${oldIdentity.identity}-post-library-project`;
			await seedProject({ store: oldStore, projectId });
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 89,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 90,
			});
			oldControl.failAfterAllClearLibraryCommit("unavailable");
			await oldStore.clear({ scope: { kind: "all" } });
			const afterFirstOld = await loadLibrarySentinel({
				store: oldStore,
				namespace,
			});
			const pendingBeforeReload = await rawClearJournals(oldIdentity);
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: newIdentity,
			});
			await reopened.list();
			const newLibrary = await loadLibrarySentinel({
				store: reopened,
				namespace,
			});
			return (
				afterFirstOld === null &&
				pendingBeforeReload.length === 1 &&
				librarySentinelEquals({
					value: newLibrary,
					binding: "new",
					byte: 90,
				}) &&
				(await rawClearJournals(oldIdentity)).length === 0
			);
		},
	});
}

async function probeVersion3CodecNegatives(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFullBindingFixture({
		...args,
		run: async ({ oldIdentity, newIdentity, oldStore, newStore }) => {
			const namespace = `${oldIdentity.identity}-codec-negative`;
			await seedLibrarySentinel({
				store: oldStore,
				namespace,
				binding: "old",
				byte: 91,
			});
			await seedLibrarySentinel({
				store: newStore,
				namespace,
				binding: "new",
				byte: 92,
			});
			const target = rawLibraryTarget(oldIdentity);
			const rows = [
				rawVersion3Journal({ clearScope: "projects", library: [target] }),
				rawVersion3Journal({ clearScope: "all", library: [] }),
				rawVersion3Journal({
					clearScope: "all",
					library: [target, { ...target }],
					extraEnvelope: true,
				}),
			];
			await idbPutMany({
				database: oldIdentity.projectsDatabase,
				store: cascadeMaintenanceStoreName(oldIdentity.projectsStore),
				values: rows,
				context: { operation: "clear", scope: { kind: "store" } },
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity: newIdentity,
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
			await reopened.list();
			const oldReader = new BrowserProjectStore({
				storageIdentity: oldIdentity,
			});
			const [oldLibrary, newLibrary] = await Promise.all([
				loadLibrarySentinel({ store: oldReader, namespace }),
				loadLibrarySentinel({ store: reopened, namespace }),
			]);
			return (
				librarySentinelEquals({
					value: oldLibrary,
					binding: "old",
					byte: 91,
				}) &&
				librarySentinelEquals({
					value: newLibrary,
					binding: "new",
					byte: 92,
				}) &&
				(await rawClearJournals(oldIdentity)).length === 3 &&
				diagnostics.filter(
					(diagnostic) =>
						diagnostic.phase === "project-cascade-postcommit-cleanup" &&
						diagnostic.code === "corrupt" &&
						diagnostic.retryable === false,
				).length >= 3
			);
		},
	});
}

async function probeOpaqueCascadeLiteral(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{ roundTrips: boolean; targetSurvived: boolean }> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity, store }) => {
			const targetId = `${identity}-target`;
			const providerId = `${identity}-provider`;
			await seedProjectTree({ store, projectId: targetId, byte: 11 });
			const literal = forgedTombstone({
				storageIdentity,
				recordId: providerId,
				targetId,
			});
			await seedProject({
				store,
				projectId: providerId,
				data: {
					providerPrivate: "keep",
					[CASCADE_FIELD]: literal[CASCADE_FIELD],
				},
			});
			const immediate = await store.load({ id: providerId });
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({ storageIdentity });
			await reopened.list();
			const after = await reopened.load({ id: providerId });
			const target = await reopened.loadAttachment({
				projectId: targetId,
				key: "media",
			});
			return {
				roundTrips:
					JSON.stringify(immediate?.data) ===
						JSON.stringify({
							providerPrivate: "keep",
							[CASCADE_FIELD]: literal[CASCADE_FIELD],
						}) &&
					JSON.stringify(after?.data) === JSON.stringify(immediate?.data),
				targetSurvived: byteString(target?.body) === "11",
			};
		},
	});
}

async function probeForgedMaintenance(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity, store }) => {
			const targetId = `${identity}-target`;
			const forgedId = `${identity}-forged`;
			await seedProjectTree({ store, projectId: targetId, byte: 22 });
			await idbPut({
				database: storageIdentity.projectsDatabase,
				store: cascadeMaintenanceStoreName(storageIdentity.projectsStore),
				value: forgedTombstone({
					storageIdentity,
					recordId: forgedId,
					targetId,
				}),
				context: {
					operation: "remove-project",
					scope: { kind: "project", projectId: forgedId },
				},
			});
			await idbPut({
				database: storageIdentity.projectsDatabase,
				store: cascadeMaintenanceStoreName(storageIdentity.projectsStore),
				value: forgedRevision2Journal({
					storageIdentity,
					projectId: targetId,
				}),
				context: { operation: "clear", scope: { kind: "store" } },
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({
				storageIdentity,
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
			await reopened.list();
			const attachment = await reopened.loadAttachment({
				projectId: targetId,
				key: "media",
			});
			return (
				byteString(attachment?.body) === "22" &&
				diagnostics.some(
					(diagnostic) =>
						diagnostic.phase === "project-cascade-postcommit-cleanup" &&
						diagnostic.code === "corrupt" &&
						diagnostic.retryable === false,
				)
			);
		},
	});
}

async function probeAtomicNamespaceClear(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withFixture({
		...args,
		run: async ({ storageIdentity, store, control }) => {
			const namespace = "saved-sounds";
			for (const key of ["first", "second"]) {
				await store.saveLibraryRecord({
					namespace,
					key,
					schemaVersion: 1,
					data: { key },
				});
			}
			await idbPut({
				database: storageIdentity.libraryDatabase,
				store: storageIdentity.libraryStore,
				value: { id: "user-sounds", sounds: [{ id: 3 }] },
				context: {
					operation: "save-library-record",
					scope: { kind: "library", namespace, key: "user-sounds" },
				},
			});
			control.failLibraryNamespaceClearAfter({
				namespace,
				afterDeletedKeys: 2,
				code: "unavailable",
			});
			let failure: unknown;
			try {
				await store.clear({ scope: { kind: "library", namespace } });
			} catch (error) {
				failure = error;
			}
			const values = await Promise.all(
				["first", "second", "user-sounds"].map((key) =>
					store.loadLibraryRecord({ namespace, key }),
				),
			);
			return (
				failure instanceof ProjectStoreError &&
				failure.code === "unavailable" &&
				values.every((value) => value !== null)
			);
		},
	});
}

async function probeRecoverableAllClear(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{ commitRecoverable: boolean; retried: boolean }> {
	return withFixture({
		...args,
		run: async ({ identity, storageIdentity, store, control }) => {
			const projectId = `${identity}-all`;
			const namespace = `${identity}-library`;
			await seedProjectTree({ store, projectId, byte: 33 });
			await store.saveLibraryRecord({
				namespace,
				key: "item",
				schemaVersion: 1,
				data: { keep: true },
			});
			const diagnostics: BrowserStoreDiagnostic[] = [];
			const diagnosticStore = new BrowserProjectStore({
				storageIdentity,
				conformanceControl: control,
				diagnostic: (diagnostic) => diagnostics.push(diagnostic),
			});
			await diagnosticStore.list();
			control.failAllClearLibraryAfterProjectCommit("unavailable");
			let rejected = false;
			try {
				await diagnosticStore.clear({ scope: { kind: "all" } });
			} catch {
				rejected = true;
			}
			const commitRecoverable =
				!rejected &&
				(await diagnosticStore.load({ id: projectId })) === null &&
				diagnostics.some(
					(diagnostic) =>
						diagnostic.phase === "project-cascade-postcommit-cleanup" &&
						diagnostic.operation === "clear" &&
						diagnostic.retryable === true,
				);

			resetBrowserProjectStoreRuntimeForTests();
			const reopened = new BrowserProjectStore({ storageIdentity });
			await reopened.list();
			const inventory = await inspectDisposableBrowserStorage({
				identity,
				prefix: args.prefix,
			});
			const retried =
				(await reopened.loadLibraryRecord({ namespace, key: "item" })) ===
					null &&
				inventory.databases.every(
					(name) => !name.startsWith(storageIdentity.mediaDatabasePrefix),
				) &&
				inventory.directories.length === 0;
			return { commitRecoverable, retried };
		},
	});
}

async function withTopologyFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(fixture: {
		identity: string;
		base: BrowserStorageIdentity;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const base = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	try {
		return await args.run({ identity, base });
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function cleanupProbeFixture(args: {
	identity: string;
	prefix: string;
}): Promise<void> {
	try {
		await cleanupDisposableBrowserStorage(args);
		for (const database of (await listDatabaseNames()).filter((name) =>
			name.startsWith(args.identity),
		)) {
			await deleteDatabaseExact(database);
		}
		for (const directory of (await listRootEntries()).filter((name) =>
			name.startsWith(args.identity),
		)) {
			await removeRootDirectoryExact(directory);
		}
		const residualDatabases = (await listDatabaseNames()).filter((name) =>
			name.startsWith(args.identity),
		);
		const residualDirectories = (await listRootEntries()).filter((name) =>
			name.startsWith(args.identity),
		);
		if (residualDatabases.length > 0 || residualDirectories.length > 0) {
			throw new Error("Topology probe cleanup left a randomized target behind");
		}
	} catch (error) {
		throw new Error(
			`Cascade probe cleanup failed for ${args.identity}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function mediaDatabaseTargetIdentity(args: {
	base: BrowserStorageIdentity;
	projectId: string;
	database: string;
}): BrowserStorageIdentity {
	if (!args.database.endsWith(args.projectId)) {
		throw new Error("Topology probe database does not encode its project id");
	}
	return {
		...args.base,
		mediaDatabasePrefix: args.database.slice(0, -args.projectId.length),
		mediaDirectoryPrefix: `${args.base.identity}-target-root-`,
	};
}

async function maintenanceRows(
	identity: BrowserStorageIdentity,
): Promise<unknown[]> {
	return idbGetAll<unknown>({
		database: identity.projectsDatabase,
		store: cascadeMaintenanceStoreName(identity.projectsStore),
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function putMaintenanceRow(args: {
	identity: BrowserStorageIdentity;
	value: Record<string, unknown>;
}): Promise<void> {
	await idbPut({
		database: args.identity.projectsDatabase,
		store: cascadeMaintenanceStoreName(args.identity.projectsStore),
		value: args.value,
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

async function seedDatabaseSentinel(args: {
	database: string;
	store: string;
	key: string;
	byte: number;
}): Promise<void> {
	await idbPut({
		database: args.database,
		store: args.store,
		value: { id: args.key, byte: args.byte },
		context: { operation: "inspect", scope: { kind: "store" } },
	});
}

async function readDatabaseSentinel(args: {
	database: string;
	store: string;
	key: string;
}): Promise<number | null> {
	const value = await idbGet<unknown>({
		database: args.database,
		store: args.store,
		key: args.key,
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	return isRecord(value) && typeof value.byte === "number" ? value.byte : null;
}

async function seedDirectorySentinel(args: {
	directory: string;
	key: string;
	byte: number;
}): Promise<void> {
	await opfsWrite({
		directory: args.directory,
		key: args.key,
		body: new Uint8Array([args.byte]).buffer,
		context: { operation: "inspect", scope: { kind: "store" } },
	});
}

async function readDirectorySentinel(args: {
	directory: string;
	key: string;
}): Promise<number | null> {
	const value = await opfsRead({
		directory: args.directory,
		key: args.key,
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	return value && value.byteLength === 1 ? new Uint8Array(value)[0] : null;
}

async function seedPhysicalSentinel(args: {
	database: string;
	directory: string;
	store: string;
	key: string;
	byte: number;
}): Promise<void> {
	await Promise.all([seedDatabaseSentinel(args), seedDirectorySentinel(args)]);
}

async function seedHistoricalMediaClaim(args: {
	controlIdentity: BrowserStorageIdentity;
	projectId: string;
	database: string;
	directory: string;
}): Promise<{
	fingerprint: string;
	projectId: string;
	database: string;
	directory: string;
}> {
	if (
		!args.database.endsWith(args.projectId) ||
		!args.directory.endsWith(args.projectId)
	) {
		throw new Error("Historical topology target does not encode its owner");
	}
	const binding = {
		revision: 1 as const,
		mediaDatabasePrefix: args.database.slice(0, -args.projectId.length),
		mediaStore: args.controlIdentity.mediaStore,
		mediaDirectoryPrefix: args.directory.slice(0, -args.projectId.length),
	};
	const fingerprint = await mediaBindingFingerprint(binding);
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
					binding,
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
	return {
		fingerprint,
		projectId: args.projectId,
		database: args.database,
		directory: args.directory,
	};
}

function hasTopologyConflictDiagnostic(
	diagnostics: readonly BrowserStoreDiagnostic[],
): boolean {
	return diagnostics.some(
		(diagnostic) =>
			diagnostic.phase === "project-cascade-topology-conflict" &&
			diagnostic.code === "unavailable" &&
			diagnostic.retryable === false,
	);
}

async function withFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(fixture: {
		identity: string;
		storageIdentity: BrowserStorageIdentity;
		store: BrowserProjectStore;
		control: BrowserProjectStoreControl;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const control = new BrowserProjectStoreControl();
	const store = new BrowserProjectStore({
		storageIdentity,
		conformanceControl: control,
	});
	try {
		await store.list();
		return await args.run({ identity, storageIdentity, store, control });
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function withMaskedFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(fixture: {
		identity: string;
		storageIdentity: BrowserStorageIdentity;
		store: BrowserProjectStore;
		control: BrowserProjectStoreControl;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const control = new BrowserProjectStoreControl();
	try {
		return await withDatabaseEnumerationMasked(async () => {
			const store = new BrowserProjectStore({
				storageIdentity,
				conformanceControl: control,
			});
			await store.list();
			return args.run({ identity, storageIdentity, store, control });
		});
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function withBindingFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(fixture: {
		identity: string;
		oldIdentity: BrowserStorageIdentity;
		newIdentity: BrowserStorageIdentity;
		oldStore: BrowserProjectStore;
		newStore: BrowserProjectStore;
		control: BrowserProjectStoreControl;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const base = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const oldIdentity = mediaBindingVariant({ base, label: "old" });
	const newIdentity = mediaBindingVariant({ base, label: "new" });
	const control = new BrowserProjectStoreControl();
	const oldStore = new BrowserProjectStore({
		storageIdentity: oldIdentity,
		conformanceControl: control,
	});
	const newStore = new BrowserProjectStore({
		storageIdentity: newIdentity,
		conformanceControl: control,
	});
	try {
		await oldStore.list();
		await newStore.list();
		return await args.run({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			control,
		});
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function withFullBindingFixture<Result>(args: {
	prefix: string;
	cleanupProof: string[];
	run(fixture: {
		identity: string;
		oldIdentity: BrowserStorageIdentity;
		newIdentity: BrowserStorageIdentity;
		oldStore: BrowserProjectStore;
		newStore: BrowserProjectStore;
		oldControl: BrowserProjectStoreControl;
		newControl: BrowserProjectStoreControl;
	}): Promise<Result>;
}): Promise<Result> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const base = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const oldIdentity = fullBindingVariant({ base, label: "old" });
	const newIdentity = fullBindingVariant({ base, label: "new" });
	const oldControl = new BrowserProjectStoreControl();
	const newControl = new BrowserProjectStoreControl();
	const oldStore = new BrowserProjectStore({
		storageIdentity: oldIdentity,
		conformanceControl: oldControl,
	});
	const newStore = new BrowserProjectStore({
		storageIdentity: newIdentity,
		conformanceControl: newControl,
	});
	try {
		await oldStore.list();
		await newStore.list();
		return await args.run({
			identity,
			oldIdentity,
			newIdentity,
			oldStore,
			newStore,
			oldControl,
			newControl,
		});
	} finally {
		await cleanupProbeFixture({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

function fullBindingVariant(args: {
	base: BrowserStorageIdentity;
	label: string;
}): BrowserStorageIdentity {
	return {
		...mediaBindingVariant(args),
		libraryStore: `${args.base.libraryStore}-${args.label}`,
	};
}

function mediaBindingVariant(args: {
	base: BrowserStorageIdentity;
	label: string;
}): BrowserStorageIdentity {
	return {
		...args.base,
		mediaDatabasePrefix: `${args.base.mediaDatabasePrefix}${args.label}-`,
		mediaDirectoryPrefix: `${args.base.mediaDirectoryPrefix}${args.label}-`,
	};
}

function libraryClearBinding(
	identity: BrowserStorageIdentity,
): BrowserLibraryClearBindingV1 {
	return {
		revision: 1,
		projectsDatabase: identity.projectsDatabase,
		projectsStore: identity.projectsStore,
		libraryDatabase: identity.libraryDatabase,
		libraryStore: identity.libraryStore,
	};
}

async function seedLibrarySentinel(args: {
	store: BrowserProjectStore;
	namespace: string;
	binding: "old" | "new";
	byte: number;
}): Promise<void> {
	await args.store.saveLibraryRecord({
		namespace: args.namespace,
		key: "sentinel",
		schemaVersion: 1,
		data: { binding: args.binding, bytes: [args.byte] },
	});
}

async function loadLibrarySentinel(args: {
	store: BrowserProjectStore;
	namespace: string;
}): Promise<Awaited<ReturnType<BrowserProjectStore["loadLibraryRecord"]>>> {
	return args.store.loadLibraryRecord({
		namespace: args.namespace,
		key: "sentinel",
	});
}

function librarySentinelEquals(args: {
	value: Awaited<ReturnType<BrowserProjectStore["loadLibraryRecord"]>>;
	binding: "old" | "new";
	byte: number;
}): boolean {
	return (
		JSON.stringify(args.value?.data) ===
		JSON.stringify({ binding: args.binding, bytes: [args.byte] })
	);
}

async function rawClearJournals(
	identity: BrowserStorageIdentity,
): Promise<unknown[]> {
	const rows = await idbGetAll<unknown>({
		database: identity.projectsDatabase,
		store: cascadeMaintenanceStoreName(identity.projectsStore),
		context: { operation: "clear", scope: { kind: "store" } },
	});
	return rows.filter((row) => {
		if (!isRecord(row)) return false;
		const envelope = row[CASCADE_FIELD];
		return isRecord(envelope) && envelope.kind === "clear-journal";
	});
}

function journalHasLibraryCardinality(args: {
	value: unknown;
	revision: number;
	clearScope: "projects" | "all";
	count: number;
}): boolean {
	if (!isRecord(args.value)) return false;
	const envelope = args.value[CASCADE_FIELD];
	if (
		!isRecord(envelope) ||
		envelope.revision !== args.revision ||
		envelope.clearScope !== args.clearScope ||
		!isRecord(envelope.targets) ||
		!Array.isArray(envelope.targets.library)
	) {
		return false;
	}
	return envelope.targets.library.length === args.count;
}

async function seedStrictVersion2ClearJournal(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
}): Promise<void> {
	const fingerprint = await mediaBindingFingerprint(
		mediaBindingForIdentity(args.identity),
	);
	await idbPut({
		database: args.identity.projectsDatabase,
		store: cascadeMaintenanceStoreName(args.identity.projectsStore),
		value: {
			id: `.c5-project-clear-${crypto.randomUUID()}`,
			[CASCADE_FIELD]: {
				revision: 2,
				kind: "clear-journal",
				operation: "clear",
				scope: { kind: "store" },
				targets: [
					{
						fingerprint,
						projectId: args.projectId,
						database: mediaDatabaseName(args),
						directory: mediaDirectoryName(args),
					},
				],
				clearLibrary: true,
			},
		},
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

function rawLibraryTarget(
	identity: BrowserStorageIdentity,
): Record<string, unknown> {
	return {
		revision: 1,
		kind: "library",
		fingerprint: "0".repeat(64),
		database: identity.libraryDatabase,
		store: identity.libraryStore,
	};
}

function rawVersion3Journal(args: {
	clearScope: "projects" | "all";
	library: readonly Record<string, unknown>[];
	extraEnvelope?: boolean;
}): Record<string, unknown> {
	return {
		id: `.c5-project-clear-${crypto.randomUUID()}`,
		[CASCADE_FIELD]: {
			revision: 3,
			kind: "clear-journal",
			operation: "clear",
			scope: { kind: "store" },
			clearScope: args.clearScope,
			targets: { media: [], library: args.library },
			...(args.extraEnvelope ? { extra: true } : {}),
		},
	};
}

async function replaceWithRevision1Ownership(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
}): Promise<void> {
	const store = `${args.storageIdentity.projectsStore}-media-ownership`;
	await idbClear({
		database: args.storageIdentity.projectsDatabase,
		store,
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	await idbPutMany({
		database: args.storageIdentity.projectsDatabase,
		store,
		values: [
			{
				id: `${MEDIA_OWNER_PREFIX}${encodeURIComponent(args.projectId)}`,
				[MEDIA_OWNER_FIELD]: {
					revision: 1,
					kind: "owner",
					projectId: args.projectId,
				},
			},
			{
				id: MEDIA_OWNER_COVERAGE_KEY,
				[MEDIA_OWNER_FIELD]: {
					revision: 1,
					kind: "coverage",
					coverage: "complete",
				},
			},
		],
		context: { operation: "inspect", scope: { kind: "store" } },
	});
}

async function ownershipRows(
	storageIdentity: BrowserStorageIdentity,
): Promise<unknown[]> {
	return idbGetAll<unknown>({
		database: storageIdentity.projectsDatabase,
		store: `${storageIdentity.projectsStore}-media-ownership`,
		context: { operation: "inspect", scope: { kind: "store" } },
	});
}

function isRevision1CoverageRow(value: unknown): boolean {
	if (!isRecord(value) || value.id !== MEDIA_OWNER_COVERAGE_KEY) return false;
	const envelope = value[MEDIA_OWNER_FIELD];
	return (
		isRecord(envelope) &&
		envelope.revision === 1 &&
		envelope.kind === "coverage" &&
		envelope.coverage === "complete"
	);
}

async function seedRawMediaNamespace(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	key: string;
}): Promise<void> {
	await idbPut({
		database: mediaDatabaseName(args),
		store: args.identity.mediaStore,
		value: { id: args.key, sentinel: true },
		context: {
			operation: "save-attachment",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
	await opfsWrite({
		directory: mediaDirectoryName(args),
		key: args.key,
		body: new Uint8Array([99]).buffer,
		context: {
			operation: "save-attachment",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
}

async function withDatabaseEnumerationMasked<Result>(
	run: () => Promise<Result>,
): Promise<Result> {
	const descriptor = Object.getOwnPropertyDescriptor(indexedDB, "databases");
	Object.defineProperty(indexedDB, "databases", {
		configurable: true,
		value: undefined,
	});
	try {
		return await run();
	} finally {
		if (descriptor) {
			Object.defineProperty(indexedDB, "databases", descriptor);
		} else {
			Reflect.deleteProperty(indexedDB, "databases");
		}
	}
}

function forgedTombstone(args: {
	storageIdentity: BrowserStorageIdentity;
	recordId: string;
	targetId: string;
}): Record<string, unknown> {
	return {
		id: projectTombstoneKey(args.recordId),
		[CASCADE_FIELD]: {
			revision: 1,
			kind: "project-tombstone",
			operation: "remove-project",
			scope: { kind: "project", projectId: args.recordId },
			databases: [
				mediaDatabaseName({
					identity: args.storageIdentity,
					projectId: args.targetId,
				}),
			],
			directories: [
				mediaDirectoryName({
					identity: args.storageIdentity,
					projectId: args.targetId,
				}),
			],
			clearLibrary: false,
		},
	};
}

function forgedRevision2Journal(args: {
	storageIdentity: BrowserStorageIdentity;
	projectId: string;
}): Record<string, unknown> {
	return {
		id: `.c5-project-clear-${crypto.randomUUID()}`,
		[CASCADE_FIELD]: {
			revision: 2,
			kind: "clear-journal",
			operation: "clear",
			scope: { kind: "store" },
			targets: [
				{
					fingerprint: "0".repeat(64),
					projectId: args.projectId,
					database: mediaDatabaseName({
						identity: args.storageIdentity,
						projectId: args.projectId,
					}),
					directory: mediaDirectoryName({
						identity: args.storageIdentity,
						projectId: args.projectId,
					}),
				},
			],
			clearLibrary: false,
		},
	};
}

async function seedProject(args: {
	store: BrowserProjectStore;
	projectId: string;
	data?: Record<string, unknown>;
}): Promise<void> {
	const now = "2026-08-02T00:00:00.000Z";
	await args.store.save({
		record: {
			id: args.projectId,
			schemaVersion: args.store.schemaVersion,
			data: args.data ?? {},
		},
		summary: {
			id: args.projectId,
			name: args.projectId,
			createdAt: now,
			updatedAt: now,
		},
	});
}

async function seedProjectTree(args: {
	store: BrowserProjectStore;
	projectId: string;
	byte: number;
}): Promise<void> {
	await seedProject(args);
	await args.store.saveAttachment({
		projectId: args.projectId,
		key: "media",
		metadata: {},
		body: new Uint8Array([args.byte]).buffer,
	});
}

function byteString(body: ArrayBuffer | undefined): string {
	return body ? [...new Uint8Array(body)].join(",") : "";
}
