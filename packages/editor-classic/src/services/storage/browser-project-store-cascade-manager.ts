import type {
	ProjectStoreErrorCode,
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	isRecord,
	mapBrowserStoreError,
	mediaDatabaseName,
	mediaDirectoryName,
	projectAuthorityStoreName,
	throwIfBrowserStoreAborted,
	type BrowserMediaBinding,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import {
	cascadeMaintenanceStoreName,
	completeProjectTombstone,
	createClearJournal,
	createProjectTombstone,
	decodeCascadeCleanupRecord,
	projectTombstoneKey,
	type CascadeCleanupRecord,
} from "./browser-project-store-cascade";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
import {
	prepareLibraryClearAuthorization,
	readKnownLibraryPhysicalClaims,
	validateLibraryClearBinding,
	validateLibraryClearTarget,
	validatePreparedLibraryClearAuthorization,
	type BrowserLibraryClearBindingV1,
	type LibraryClearTargetV1,
} from "./browser-project-store-library-clear-bindings";
import {
	currentMediaPhysicalClaim,
	planMediaClear,
	readKnownMediaPhysicalClaims,
	validateMediaClearPlan,
} from "./browser-project-store-media-ownership";
import {
	isBrowserStorageTopologyConflict,
	type BrowserStorageTopology,
	type BrowserStorageTopologyPermit,
	type MediaPhysicalClaim,
} from "./browser-project-store-topology";
import { decodeStoredProjectPair } from "./browser-project-store-records";
import {
	deleteDatabaseExact,
	idbClear,
	idbCommitProjectRemoval,
	idbCommitProjectSave,
	idbCommitProjectsClear,
	idbCommitProjectsClearWithLibraryBinding,
	idbDelete,
	idbGet,
	idbGetAll,
	idbGetAllProjectPairs,
	idbPut,
	idbUpgradeCascadeJournalWithLibraryBinding,
	removeRootDirectoryExact,
} from "./browser-storage-mechanisms";

interface CascadeManagerOptions {
	readonly identity: BrowserStorageIdentity;
	readonly topology: BrowserStorageTopology;
	readonly control: BrowserProjectStoreControl;
	readonly previousBinding?: BrowserMediaBinding;
	readonly previousLibraryBinding?: BrowserLibraryClearBindingV1;
	readonly diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
}

type CascadeCleanupPermit = Extract<
	BrowserStorageTopologyPermit,
	{ kind: "cascade-cleanup" }
>;

interface PreparedLegacyLibraryClearUpgrade {
	readonly record: CascadeCleanupRecord;
	readonly expectedRecord: Record<string, unknown>;
	readonly authorization: Awaited<
		ReturnType<typeof prepareLibraryClearAuthorization>
	>;
}

export class BrowserProjectStoreCascadeManager {
	private readonly identity: BrowserStorageIdentity;
	private readonly topology: BrowserStorageTopology;
	private readonly control: BrowserProjectStoreControl;
	private readonly previousBinding?: BrowserMediaBinding;
	private readonly previousLibraryBinding?: BrowserLibraryClearBindingV1;
	private readonly diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
	private readonly maintenanceStore: string;

	constructor(options: CascadeManagerOptions) {
		this.identity = options.identity;
		this.topology = options.topology;
		this.control = options.control;
		this.previousBinding = options.previousBinding;
		this.previousLibraryBinding = options.previousLibraryBinding;
		if (this.previousLibraryBinding) {
			validateLibraryClearBinding(this.previousLibraryBinding);
		}
		this.diagnostic = options.diagnostic;
		this.maintenanceStore = cascadeMaintenanceStoreName(
			options.identity.projectsStore,
		);
	}

	async retryPendingCleanup(): Promise<void> {
		const rows = await idbGetAll<unknown>({
			database: this.identity.projectsDatabase,
			store: this.maintenanceStore,
			context: { operation: "clear", scope: { kind: "store" } },
		});
		for (const row of rows) {
			const record = decodeCascadeCleanupRecord(row);
			if (!record) {
				this.reportMalformedCleanupRecord();
				continue;
			}
			if (this.hasPendingCleanup(record)) {
				await this.cleanup({
					record,
					rawRecord: isRecord(row) ? row : undefined,
				});
			}
		}
	}

	async prepareProjectSave(projectId: string): Promise<void> {
		await this.retryPendingCleanup();
		const pending = await this.pendingCleanupForProject(projectId);
		if (!pending) return;
		throw new ProjectStoreError({
			code: "unavailable",
			operation: "save-project",
			scope: { kind: "project", projectId },
			message: "Project storage cleanup is pending retry",
		});
	}

	async commitProjectSave(args: {
		projectId: string;
		project: Record<string, unknown>;
		projectAuthority: Record<string, unknown>;
		signal?: AbortSignal;
	}): Promise<void> {
		await idbCommitProjectSave({
			database: this.identity.projectsDatabase,
			projectStore: this.identity.projectsStore,
			authorityStore: projectAuthorityStoreName(this.identity.projectsStore),
			maintenanceStore: this.maintenanceStore,
			maintenanceKey: projectTombstoneKey(args.projectId),
			project: args.project,
			projectAuthority: args.projectAuthority,
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId: args.projectId },
			},
			signal: args.signal,
		});
	}

	async assertProjectAcceptsAttachments(args: {
		projectId: string;
		key: string;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		if (
			!(await this.projectBlocksAttachmentAccess({
				projectId: args.projectId,
				operation: "save-attachment",
				scope,
			}))
		) {
			return;
		}
		throw new ProjectStoreError({
			code: "conflict",
			operation: "save-attachment",
			scope,
			message: "Cannot save an attachment for a removed project",
		});
	}

	async projectBlocksAttachmentAccess(args: {
		projectId: string;
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
	}): Promise<boolean> {
		const row = await idbGet<unknown>({
			database: this.identity.projectsDatabase,
			store: this.maintenanceStore,
			key: projectTombstoneKey(args.projectId),
			context: { operation: args.operation, scope: args.scope },
		});
		if (row === null) return false;
		const record = decodeCascadeCleanupRecord(row);
		if (
			!record ||
			record.envelope.kind !== "project-tombstone" ||
			!(await this.isOwnedRecord(record))
		) {
			throw new ProjectStoreError({
				code: "corrupt",
				operation: args.operation,
				scope: args.scope,
			});
		}
		return true;
	}

	async commitProjectRemoval(args: {
		projectId: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const { projectId, signal } = args;
		const scope = { kind: "project", projectId } as const;
		const media = await currentMediaPhysicalClaim({
			identity: this.identity,
			projectId,
			context: { operation: "remove-project", scope },
		});
		const permit = await this.authorizeCurrentCleanup({
			media: [media],
			library: [],
			context: { operation: "remove-project", scope },
		});
		const raw = createProjectTombstone({
			projectId,
			operation: "remove-project",
			databases: permit.media.map((target) => target.database),
			directories: permit.media.map((target) => target.directory),
		});
		const record = this.requireCleanupRecord({ value: raw, scope });
		throwIfBrowserStoreAborted({
			operation: "remove-project",
			scope,
			signal,
		});
		await idbCommitProjectRemoval({
			database: this.identity.projectsDatabase,
			projectStore: this.identity.projectsStore,
			authorityStore: projectAuthorityStoreName(this.identity.projectsStore),
			maintenanceStore: this.maintenanceStore,
			projectId,
			tombstone: raw,
			context: { operation: "remove-project", scope },
			signal,
		});
		await this.cleanup({ record, rawRecord: raw, permit });
	}

	async commitProjectsClear(args: {
		signal?: AbortSignal;
		clearScope: "projects" | "all";
	}): Promise<void> {
		const scope = { kind: "store" } as const;
		await this.retryPendingCleanup();
		const pairs = await idbGetAllProjectPairs({
			database: this.identity.projectsDatabase,
			projectStore: this.identity.projectsStore,
			authorityStore: projectAuthorityStoreName(this.identity.projectsStore),
			context: { operation: "clear", scope },
		});
		const maintenanceRows = await idbGetAll<unknown>({
			database: this.identity.projectsDatabase,
			store: this.maintenanceStore,
			context: { operation: "clear", scope },
		});
		const projectIds = new Set<string>();
		for (const pair of pairs) {
			const project = decodeStoredProjectPair(pair);
			if (!project) throwClearFailure("corrupt");
			projectIds.add(project.record.id);
		}
		for (const row of maintenanceRows) {
			const cleanup = decodeCascadeCleanupRecord(row);
			if (!cleanup || !(await this.isOwnedRecord(cleanup))) {
				throwClearFailure("corrupt");
			}
			if (this.hasPendingCleanup(cleanup)) {
				throw new ProjectStoreError({
					code: "unavailable",
					operation: "clear",
					scope,
					message: "Project storage cleanup is pending retry",
				});
			}
			if (
				cleanup.envelope.kind === "project-tombstone" &&
				cleanup.envelope.scope.kind === "project"
			) {
				projectIds.add(cleanup.envelope.scope.projectId);
			}
		}
		const mediaPlan = await planMediaClear({
			identity: this.identity,
			logicalProjectIds: projectIds,
			previousBinding: this.previousBinding,
			diagnostic: this.diagnostic,
		});
		const libraryAuthorization =
			args.clearScope === "all"
				? await prepareLibraryClearAuthorization({
						identity: this.identity,
						context: { operation: "clear", scope },
					})
				: null;
		if (libraryAuthorization) {
			await validatePreparedLibraryClearAuthorization({
				identity: this.identity,
				prepared: libraryAuthorization,
				context: { operation: "clear", scope },
			});
		}
		const permit = await this.authorizeCurrentCleanup({
			media: mediaPlan.targets,
			library: libraryAuthorization ? [libraryAuthorization.target] : [],
			context: { operation: "clear", scope },
		});
		const tombstones = mediaPlan.projectIds.map((projectId) =>
			createProjectTombstone({ projectId, operation: "clear" }),
		);
		const rawJournal =
			permit.media.length > 0 || args.clearScope === "all"
				? createClearJournal({
						clearScope: args.clearScope,
						mediaTargets: permit.media,
						libraryTargets: permit.library.map((target) => ({
							revision: 1,
							kind: "library",
							...target,
						})),
					})
				: null;
		const record = rawJournal
			? this.requireCleanupRecord({ value: rawJournal, scope })
			: null;
		throwIfBrowserStoreAborted({
			operation: "clear",
			scope,
			signal: args.signal,
		});
		const maintenanceValues = rawJournal
			? [...tombstones, rawJournal]
			: tombstones;
		if (libraryAuthorization) {
			await idbCommitProjectsClearWithLibraryBinding({
				database: this.identity.projectsDatabase,
				projectStore: this.identity.projectsStore,
				authorityStore: projectAuthorityStoreName(this.identity.projectsStore),
				maintenanceStore: this.maintenanceStore,
				bindingStore: libraryAuthorization.bindingStore,
				maintenanceValues,
				bindingDescriptor: libraryAuthorization.descriptor,
				context: { operation: "clear", scope },
				signal: args.signal,
			});
		} else {
			await idbCommitProjectsClear({
				database: this.identity.projectsDatabase,
				projectStore: this.identity.projectsStore,
				authorityStore: projectAuthorityStoreName(this.identity.projectsStore),
				maintenanceStore: this.maintenanceStore,
				maintenanceValues,
				context: { operation: "clear", scope },
				signal: args.signal,
			});
		}
		if (record) {
			await this.cleanup({
				record,
				rawRecord: rawJournal ?? undefined,
				permit,
			});
		}
	}

	private async cleanup(args: {
		record: CascadeCleanupRecord;
		rawRecord?: Record<string, unknown>;
		permit?: CascadeCleanupPermit;
	}): Promise<boolean> {
		let effective = args.record;
		let legacyUpgrade: PreparedLegacyLibraryClearUpgrade | null = null;
		if (this.isLegacyLibraryClear(args.record)) {
			if (
				args.record.envelope.revision !== 2 ||
				!this.previousLibraryBinding ||
				!args.rawRecord
			) {
				this.reportLegacyLibraryBindingRequired(args.record);
				return false;
			}
		}
		let completedTargets = 0;
		try {
			if (this.isLegacyLibraryClear(args.record)) {
				const rawRecord = args.rawRecord;
				if (!rawRecord) this.throwCleanupCorrupt(args.record);
				legacyUpgrade = await this.prepareLegacyLibraryClearUpgrade({
					record: args.record,
					rawRecord,
				});
				effective = legacyUpgrade.record;
			}
			const permit =
				args.permit ??
				(legacyUpgrade
					? await this.authorizeCleanup({
							media:
								legacyUpgrade.record.envelope.revision === 3
									? legacyUpgrade.record.envelope.targets.media
									: [],
							library: [legacyUpgrade.authorization.target],
							context: {
								operation: legacyUpgrade.record.envelope.operation,
								scope: legacyUpgrade.record.envelope.scope,
							},
						})
					: await this.preflightHistoricalCleanup(effective));
			if (legacyUpgrade) {
				await this.commitLegacyLibraryClearUpgrade({
					upgrade: legacyUpgrade,
					permit,
				});
			}
			for (const target of permit.media) {
				await deleteDatabaseExact(target.database);
				completedTargets += 1;
				this.control.afterCascadeCleanupTarget({
					operation: effective.envelope.operation,
					completedTargets,
					scope: effective.envelope.scope,
				});
			}
			for (const target of permit.media) {
				await removeRootDirectoryExact(target.directory);
				completedTargets += 1;
				this.control.afterCascadeCleanupTarget({
					operation: effective.envelope.operation,
					completedTargets,
					scope: effective.envelope.scope,
				});
			}
			for (const target of permit.library) {
				this.control.beforeAllClearLibraryCommit(effective.envelope.scope);
				await idbClear({
					database: target.database,
					store: target.store,
					context: {
						operation: effective.envelope.operation,
						scope: effective.envelope.scope,
					},
				});
				this.control.afterAllClearLibraryCommit(effective.envelope.scope);
			}
			if (effective.envelope.kind === "project-tombstone") {
				await idbPut({
					database: this.identity.projectsDatabase,
					store: this.maintenanceStore,
					value: completeProjectTombstone(effective),
					context: {
						operation: effective.envelope.operation,
						scope: effective.envelope.scope,
					},
				});
			} else {
				await idbDelete({
					database: this.identity.projectsDatabase,
					store: this.maintenanceStore,
					key: effective.id,
					context: {
						operation: effective.envelope.operation,
						scope: effective.envelope.scope,
					},
				});
			}
			return true;
		} catch (error) {
			if (isBrowserStorageTopologyConflict(error)) {
				this.reportTopologyConflict(effective);
				return false;
			}
			const mapped = mapBrowserStoreError({
				error,
				operation: effective.envelope.operation,
				scope: effective.envelope.scope,
			});
			this.reportCleanupFailure({
				record: effective,
				code: mapped.code,
				retryable: mapped.code !== "corrupt",
			});
			return false;
		}
	}

	private async prepareLegacyLibraryClearUpgrade(args: {
		record: CascadeCleanupRecord;
		rawRecord: Record<string, unknown>;
	}): Promise<PreparedLegacyLibraryClearUpgrade> {
		if (!this.previousLibraryBinding) throwClearFailure("unavailable");
		if (args.record.envelope.revision !== 2) throwClearFailure("corrupt");
		await validateMediaClearPlan({
			identity: this.identity,
			plan: { revision: 2, targets: args.record.envelope.targets },
			context: { operation: "clear", scope: { kind: "store" } },
		});
		const authorization = await prepareLibraryClearAuthorization({
			identity: this.identity,
			binding: this.previousLibraryBinding,
			context: { operation: "clear", scope: { kind: "store" } },
		});
		await validatePreparedLibraryClearAuthorization({
			identity: this.identity,
			prepared: authorization,
			context: { operation: "clear", scope: { kind: "store" } },
		});
		const rawUpgrade = createClearJournal({
			id: args.record.id,
			clearScope: "all",
			mediaTargets: args.record.envelope.targets,
			libraryTargets: [authorization.target],
		});
		const record = this.requireCleanupRecord({
			value: rawUpgrade,
			scope: { kind: "store" },
		});
		return {
			record,
			expectedRecord: args.rawRecord,
			authorization,
		};
	}

	private async commitLegacyLibraryClearUpgrade(args: {
		upgrade: PreparedLegacyLibraryClearUpgrade;
		permit: CascadeCleanupPermit;
	}): Promise<void> {
		const upgradedRecord = createClearJournal({
			id: args.upgrade.record.id,
			clearScope: "all",
			mediaTargets: args.permit.media,
			libraryTargets: args.permit.library.map((target) => ({
				revision: 1,
				kind: "library",
				...target,
			})),
		});
		this.requireCleanupRecord({
			value: upgradedRecord,
			scope: args.upgrade.record.envelope.scope,
		});
		await idbUpgradeCascadeJournalWithLibraryBinding({
			database: this.identity.projectsDatabase,
			maintenanceStore: this.maintenanceStore,
			bindingStore: args.upgrade.authorization.bindingStore,
			journalId: args.upgrade.record.id,
			expectedJournal: args.upgrade.expectedRecord,
			upgradedJournal: upgradedRecord,
			bindingDescriptor: args.upgrade.authorization.descriptor,
			context: { operation: "clear", scope: { kind: "store" } },
		});
	}

	private async authorizeCurrentCleanup(args: {
		media: readonly MediaPhysicalClaim[];
		library: readonly LibraryClearTargetV1[];
		context: {
			operation: ProjectStoreOperation;
			scope: ProjectStoreErrorScope;
		};
	}): Promise<CascadeCleanupPermit> {
		try {
			return await this.authorizeCleanup(args);
		} catch (error) {
			if (!isBrowserStorageTopologyConflict(error)) throw error;
			throw new ProjectStoreError({
				code: "unavailable",
				operation: args.context.operation,
				scope: args.context.scope,
			});
		}
	}

	private async preflightHistoricalCleanup(
		record: CascadeCleanupRecord,
	): Promise<CascadeCleanupPermit> {
		await this.assertOwnedRecord(record);
		return this.authorizeCleanup({
			media: await this.mediaClaimsForRecord(record),
			library: this.libraryTargets(record),
			context: {
				operation: record.envelope.operation,
				scope: record.envelope.scope,
			},
		});
	}

	private async authorizeCleanup(args: {
		media: readonly MediaPhysicalClaim[];
		library: readonly LibraryClearTargetV1[];
		context: {
			operation: ProjectStoreOperation;
			scope: ProjectStoreErrorScope;
		};
	}): Promise<CascadeCleanupPermit> {
		const knownMedia = await readKnownMediaPhysicalClaims({
			identity: this.identity,
			context: args.context,
		});
		const knownLibraries = await readKnownLibraryPhysicalClaims({
			identity: this.identity,
			context: args.context,
		});
		return this.topology.authorize({
			kind: "cascade-cleanup",
			media: args.media,
			library: args.library,
			knownMedia,
			knownLibraries,
			context: args.context,
		});
	}

	private async mediaClaimsForRecord(
		record: CascadeCleanupRecord,
	): Promise<readonly MediaPhysicalClaim[]> {
		if (record.envelope.revision === 2) return record.envelope.targets;
		if (record.envelope.revision === 3) return record.envelope.targets.media;
		if (
			record.envelope.databases.length === 0 &&
			record.envelope.directories.length === 0
		) {
			return [];
		}
		if (
			record.envelope.kind === "project-tombstone" &&
			record.envelope.scope.kind === "project"
		) {
			const claim = await currentMediaPhysicalClaim({
				identity: this.identity,
				projectId: record.envelope.scope.projectId,
				context: {
					operation: record.envelope.operation,
					scope: record.envelope.scope,
				},
			});
			if (
				record.envelope.databases.length !== 1 ||
				record.envelope.databases[0] !== claim.database ||
				record.envelope.directories.length !== 1 ||
				record.envelope.directories[0] !== claim.directory
			) {
				this.throwCleanupCorrupt(record);
			}
			return [claim];
		}
		if (
			record.envelope.databases.length !== record.envelope.directories.length
		) {
			this.throwCleanupCorrupt(record);
		}
		const claims: MediaPhysicalClaim[] = [];
		const directories = new Set(record.envelope.directories);
		for (const database of record.envelope.databases) {
			const projectId = database.slice(
				this.identity.mediaDatabasePrefix.length,
			);
			const claim = await currentMediaPhysicalClaim({
				identity: this.identity,
				projectId,
				context: {
					operation: record.envelope.operation,
					scope: record.envelope.scope,
				},
			});
			if (claim.database !== database || !directories.delete(claim.directory)) {
				this.throwCleanupCorrupt(record);
			}
			claims.push(claim);
		}
		if (directories.size !== 0) this.throwCleanupCorrupt(record);
		return claims;
	}

	private throwCleanupCorrupt(record: CascadeCleanupRecord): never {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: record.envelope.operation,
			scope: record.envelope.scope,
		});
	}

	private async pendingCleanupForProject(projectId: string): Promise<boolean> {
		const rows = await idbGetAll<unknown>({
			database: this.identity.projectsDatabase,
			store: this.maintenanceStore,
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		return rows.some((row) => {
			const record = decodeCascadeCleanupRecord(row);
			if (!record || !this.hasPhysicalTargets(record)) return false;
			if (record.envelope.revision === 2) {
				return record.envelope.targets.some(
					(target) => target.projectId === projectId,
				);
			}
			if (record.envelope.revision === 3) {
				return record.envelope.targets.media.some(
					(target) => target.projectId === projectId,
				);
			}
			const database = mediaDatabaseName({
				identity: this.identity,
				projectId,
			});
			const directory = mediaDirectoryName({
				identity: this.identity,
				projectId,
			});
			return (
				(record.envelope.scope.kind === "project" &&
					record.envelope.scope.projectId === projectId) ||
				record.envelope.databases.includes(database) ||
				record.envelope.directories.includes(directory)
			);
		});
	}

	private hasPhysicalTargets(record: CascadeCleanupRecord): boolean {
		if (record.envelope.revision === 2)
			return record.envelope.targets.length > 0;
		if (record.envelope.revision === 3)
			return record.envelope.targets.media.length > 0;
		return (
			record.envelope.databases.length > 0 ||
			record.envelope.directories.length > 0
		);
	}

	private hasPendingCleanup(record: CascadeCleanupRecord): boolean {
		return (
			this.hasPhysicalTargets(record) ||
			this.libraryTargets(record).length > 0 ||
			this.isLegacyLibraryClear(record)
		);
	}

	private isLegacyLibraryClear(record: CascadeCleanupRecord): boolean {
		if (record.envelope.revision === 3) return false;
		return (
			record.envelope.kind === "clear-journal" && record.envelope.clearLibrary
		);
	}

	private async isOwnedRecord(record: CascadeCleanupRecord): Promise<boolean> {
		try {
			await this.assertOwnedRecord(record);
			return true;
		} catch {
			return false;
		}
	}

	private async assertOwnedRecord(record: CascadeCleanupRecord): Promise<void> {
		if (record.envelope.revision === 2) {
			await validateMediaClearPlan({
				identity: this.identity,
				plan: { revision: 2, targets: record.envelope.targets },
				context: {
					operation: record.envelope.operation,
					scope: record.envelope.scope,
				},
			});
			return;
		}
		if (record.envelope.revision === 3) {
			await validateMediaClearPlan({
				identity: this.identity,
				plan: { revision: 2, targets: record.envelope.targets.media },
				context: {
					operation: record.envelope.operation,
					scope: record.envelope.scope,
				},
			});
			for (const target of record.envelope.targets.library) {
				await validateLibraryClearTarget({
					identity: this.identity,
					target,
					context: {
						operation: record.envelope.operation,
						scope: record.envelope.scope,
					},
				});
			}
			return;
		}
		if (this.isOwnedRevision1Record(record)) return;
		throw new ProjectStoreError({
			code: "corrupt",
			operation: record.envelope.operation,
			scope: record.envelope.scope,
		});
	}

	private isOwnedRevision1Record(record: CascadeCleanupRecord): boolean {
		if (record.envelope.revision !== 1) return false;
		if (record.envelope.kind === "clear-journal") {
			return (
				record.envelope.databases.every((name) =>
					name.startsWith(this.identity.mediaDatabasePrefix),
				) &&
				record.envelope.directories.every((name) =>
					name.startsWith(this.identity.mediaDirectoryPrefix),
				)
			);
		}
		if (
			record.envelope.scope.kind !== "project" ||
			record.envelope.clearLibrary
		) {
			return false;
		}
		const expectedDatabase = mediaDatabaseName({
			identity: this.identity,
			projectId: record.envelope.scope.projectId,
		});
		const expectedDirectory = mediaDirectoryName({
			identity: this.identity,
			projectId: record.envelope.scope.projectId,
		});
		const completed =
			record.envelope.databases.length === 0 &&
			record.envelope.directories.length === 0;
		return (
			completed ||
			(record.envelope.databases.length === 1 &&
				record.envelope.databases[0] === expectedDatabase &&
				record.envelope.directories.length === 1 &&
				record.envelope.directories[0] === expectedDirectory)
		);
	}

	private libraryTargets(
		record: CascadeCleanupRecord,
	): readonly LibraryClearTargetV1[] {
		return record.envelope.revision === 3
			? record.envelope.targets.library
			: [];
	}

	private reportCleanupFailure(args: {
		record: CascadeCleanupRecord;
		code: ProjectStoreErrorCode;
		retryable: boolean;
	}): void {
		this.diagnostic?.({
			level: "warning",
			phase: "project-cascade-postcommit-cleanup",
			operation: args.record.envelope.operation,
			scope: args.record.envelope.scope,
			code: args.code,
			retryable: args.retryable,
		});
	}

	private reportTopologyConflict(record: CascadeCleanupRecord): void {
		this.diagnostic?.({
			level: "warning",
			phase: "project-cascade-topology-conflict",
			operation: record.envelope.operation,
			scope: record.envelope.scope,
			code: "unavailable",
			retryable: false,
		});
	}

	private reportLegacyLibraryBindingRequired(
		record: CascadeCleanupRecord,
	): void {
		this.diagnostic?.({
			level: "warning",
			phase: "project-cascade-library-binding-required",
			operation: record.envelope.operation,
			scope: record.envelope.scope,
			code: "unavailable",
			retryable: false,
		});
	}

	private reportMalformedCleanupRecord(): void {
		this.diagnostic?.({
			level: "warning",
			phase: "project-cascade-postcommit-cleanup",
			operation: "clear",
			scope: { kind: "store" },
			code: "corrupt",
			retryable: false,
		});
	}

	private requireCleanupRecord(args: {
		value: unknown;
		scope: ProjectStoreErrorScope;
	}): CascadeCleanupRecord {
		const record = decodeCascadeCleanupRecord(args.value);
		if (record) return record;
		throw new ProjectStoreError({
			code: "corrupt",
			operation: args.scope.kind === "project" ? "remove-project" : "clear",
			scope: args.scope,
		});
	}
}

function throwClearFailure(code: ProjectStoreErrorCode): never {
	throw new ProjectStoreError({
		code,
		operation: "clear",
		scope: { kind: "store" },
	});
}
