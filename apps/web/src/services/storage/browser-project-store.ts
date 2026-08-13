import type {
	LibraryRecord,
	MigrationContext,
	MigrationOutcome,
	ProjectAttachment,
	ProjectRecord,
	ProjectStore,
	ProjectStoreClearScope,
	ProjectStoreErrorScope,
	ProjectStoreInspection,
	ProjectStoreOperation,
	ProjectSummary,
} from "@/editor/ports";
import { ProjectStoreError } from "@/editor/ports";
import {
	ATTACHMENT_BODY_PREFIX,
	ATTACHMENT_STAGE_PREFIX,
	BROWSER_STORE_SCHEMA_VERSION,
	DEFAULT_BROWSER_STORAGE_IDENTITY,
	LIBRARY_ENVELOPE_KEY,
	attachmentAuthorityStoreName,
	cloneBrowserValue,
	durableIdentityKey,
	encodeLibraryKey,
	isRecord,
	mapBrowserStoreError,
	mediaDatabaseName,
	mediaDirectoryName,
	projectsControlPlaneKey,
	projectAuthorityStoreName,
	randomInternalName,
	throwIfBrowserStoreAborted,
	validateStorageIdentity,
	validateMediaBinding,
	type BrowserMediaBinding,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import {
	BrowserMutationQueue,
	BrowserProjectStoreControl,
	browserMutationQueueForIdentity,
	resetBrowserMutationQueuesForTests,
} from "./browser-project-store-control";
import { BrowserProjectStoreCascadeManager } from "./browser-project-store-cascade-manager";
import type { BrowserLibraryClearBindingV1 } from "./browser-project-store-library-clear-bindings";
import {
	opportunisticallyCertifyMediaOwnership,
	registerMediaOwner,
} from "./browser-project-store-media-ownership";
import {
	createCurrentStoredAttachment,
	createCurrentStoredAttachmentTombstone,
	createCurrentStoredProject,
	createStoredLibraryRecord,
	decodeStoredAttachmentPair,
	decodeStoredLibraryRecord,
	decodeStoredProjectPair,
	digestAttachmentBody,
	type DecodedStoredAttachment,
	type DecodedStoredAttachmentRecord,
} from "./browser-project-store-records";
import {
	hasPendingBrowserProjectMigrationAttachmentRecovery,
	readPersistedBrowserSchemaVersion,
	resetBrowserMigrationStateForTests,
	retryBrowserProjectMigrationCleanup,
	retryBrowserProjectMigrationRecovery,
	runBrowserProjectMigration,
	type BrowserMigrationHooks,
	type BrowserMigrationPolicy,
} from "./browser-project-store-migration";
import {
	createBrowserStorageTopology,
	isBrowserStorageTopologyConflict,
	type BrowserStorageTopology,
} from "./browser-project-store-topology";
import {
	idbCommitAttachment,
	idbCommitAttachmentRemoval,
	idbDelete,
	idbDeleteByStringKeyPrefix,
	idbGet,
	idbGetAll,
	idbGetAllAttachmentPairs,
	idbGetAllProjectPairs,
	idbGetAttachmentPair,
	idbGetProjectPair,
	idbPut,
	idbResolveAttachmentBodyCleanup,
	inventoryForIdentity,
	listOpfsFiles,
	opfsRead,
	opfsRemove,
	opfsWrite,
} from "./browser-storage-mechanisms";

export interface BrowserProjectStoreOptions {
	readonly storageIdentity?: BrowserStorageIdentity;
	/** Trusted configuration-migration input for binding legacy ownership state. */
	readonly previousMediaBinding?: BrowserMediaBinding;
	/** Trusted configuration-migration input for an ambiguous legacy all-clear. */
	readonly previousLibraryBinding?: BrowserLibraryClearBindingV1;
	readonly migrationPolicy?: BrowserMigrationPolicy;
	readonly diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
	/** Test fixture plumbing. Never expose this object through `ProjectStore`. */
	readonly conformanceControl?: BrowserProjectStoreControl;
	/** Browser migration probe plumbing. Never used by a production Host. */
	readonly migrationHooks?: BrowserMigrationHooks;
}

interface DurableMigrationState {
	completed: boolean;
	inFlight: Promise<MigrationOutcome> | null;
}

function throwCorrupt(args: {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
}): never {
	throw new ProjectStoreError({ code: "corrupt", ...args });
}

function isRecognizedLegacySavedSoundsRow(
	value: unknown,
): value is Record<string, unknown> & { id: "user-sounds" } {
	return (
		isRecord(value) &&
		value.id === "user-sounds" &&
		!Object.hasOwn(value, LIBRARY_ENVELOPE_KEY)
	);
}

const migrationStates = new Map<string, DurableMigrationState>();
const initializationRuns = new Map<string, Promise<void>>();
const maintenanceRuns = new Map<string, Promise<void>>();

export class BrowserProjectStore implements ProjectStore {
	readonly schemaVersion = BROWSER_STORE_SCHEMA_VERSION;
	readonly storageIdentity: BrowserStorageIdentity;
	private readonly migrationPolicy: BrowserMigrationPolicy;
	private readonly diagnostic?: (diagnostic: BrowserStoreDiagnostic) => void;
	private readonly migrationHooks?: BrowserMigrationHooks;
	private readonly previousMediaBinding?: BrowserMediaBinding;
	private readonly previousLibraryBinding?: BrowserLibraryClearBindingV1;
	private readonly control: BrowserProjectStoreControl;
	private readonly queue: BrowserMutationQueue;
	private readonly cascade: BrowserProjectStoreCascadeManager;
	private readonly topology: BrowserStorageTopology;
	private ready: Promise<void> | null = null;

	constructor(options: BrowserProjectStoreOptions = {}) {
		this.storageIdentity =
			options.storageIdentity ?? DEFAULT_BROWSER_STORAGE_IDENTITY;
		validateStorageIdentity(this.storageIdentity);
		this.topology = createBrowserStorageTopology(this.storageIdentity);
		try {
			this.topology.authorize({
				kind: "static-identity",
				context: { operation: "inspect", scope: { kind: "store" } },
			});
		} catch (error) {
			if (!isBrowserStorageTopologyConflict(error)) throw error;
			throw new ProjectStoreError({
				code: "unavailable",
				operation: "inspect",
				scope: { kind: "store" },
			});
		}
		if (options.previousMediaBinding) {
			validateMediaBinding(options.previousMediaBinding);
		}
		this.migrationPolicy =
			options.migrationPolicy ??
			(this.storageIdentity.identity ===
			DEFAULT_BROWSER_STORAGE_IDENTITY.identity
				? { kind: "production" }
				: { kind: "disabled" });
		this.diagnostic = options.diagnostic;
		this.migrationHooks = options.migrationHooks;
		this.previousMediaBinding = options.previousMediaBinding;
		this.previousLibraryBinding = options.previousLibraryBinding;
		this.control =
			options.conformanceControl ?? new BrowserProjectStoreControl();
		this.queue = browserMutationQueueForIdentity(
			projectsControlPlaneKey(this.storageIdentity),
		);
		this.cascade = new BrowserProjectStoreCascadeManager({
			identity: this.storageIdentity,
			topology: this.topology,
			control: this.control,
			previousBinding: this.previousMediaBinding,
			previousLibraryBinding: this.previousLibraryBinding,
			diagnostic: this.diagnostic,
		});
		void this.initializationReady().catch(() => undefined);
	}

	private initializationReady(): Promise<void> {
		if (this.ready) return this.ready;
		const key = durableIdentityKey(this.storageIdentity);
		let shared = initializationRuns.get(key);
		if (!shared) {
			shared = this.queue.run({
				identity: { kind: "all-projects" },
				operation: async () => {
					await idbGetAllProjectPairs({
						database: this.storageIdentity.projectsDatabase,
						projectStore: this.storageIdentity.projectsStore,
						authorityStore: projectAuthorityStoreName(
							this.storageIdentity.projectsStore,
						),
						context: {
							operation: "list-projects",
							scope: { kind: "store" },
						},
					});
					await this.cascade.retryPendingCleanup();
					const mediaCoverageReady =
						await opportunisticallyCertifyMediaOwnership({
							identity: this.storageIdentity,
							topology: this.topology,
							previousBinding: this.previousMediaBinding,
							diagnostic: this.diagnostic,
						});
					await retryBrowserProjectMigrationRecovery({
						identity: this.storageIdentity,
						policy: this.migrationPolicy,
						diagnostic: this.diagnostic,
						hooks: this.migrationHooks,
					});
					await retryBrowserProjectMigrationCleanup({
						identity: this.storageIdentity,
						policy: this.migrationPolicy,
						diagnostic: this.diagnostic,
						hooks: this.migrationHooks,
					});
					if (mediaCoverageReady) await this.cleanupAttachmentOrphans();
				},
			});
			initializationRuns.set(key, shared);
			const current = shared;
			void current
				.finally(() => {
					if (initializationRuns.get(key) === current) {
						initializationRuns.delete(key);
					}
				})
				.catch(() => undefined);
		}
		let failed = false;
		const observed = shared
			.catch((error) => {
				failed = true;
				this.diagnostic?.({
					level: "warning",
					phase: "storage-initialization",
					operation: "inspect",
					scope: { kind: "store" },
					code: "unavailable",
					retryable: true,
				});
				throw error;
			})
			.finally(() => {
				if (failed && this.ready === observed) this.ready = null;
			});
		this.ready = observed;
		return observed;
	}

	/**
	 * A Host calls this for each session it creates. Cleanup maintenance is
	 * deliberately independent from the session factory's migration-once memo.
	 */
	async prepareForSession(): Promise<void> {
		await this.initializationReady();
		const key = durableIdentityKey(this.storageIdentity);
		let run = maintenanceRuns.get(key);
		if (!run) {
			run = this.queue
				.run({
					identity: { kind: "all-projects" },
					operation: async () => {
						await this.cascade.retryPendingCleanup();
						await retryBrowserProjectMigrationRecovery({
							identity: this.storageIdentity,
							policy: this.migrationPolicy,
							diagnostic: this.diagnostic,
							hooks: this.migrationHooks,
						});
						await retryBrowserProjectMigrationCleanup({
							identity: this.storageIdentity,
							policy: this.migrationPolicy,
							diagnostic: this.diagnostic,
							hooks: this.migrationHooks,
						});
					},
				})
				.finally(() => {
					if (maintenanceRuns.get(key) === run) maintenanceRuns.delete(key);
				});
			maintenanceRuns.set(key, run);
		}
		await run;
	}

	async persistedSchemaVersion(): Promise<number | null> {
		await this.initializationReady();
		return readPersistedBrowserSchemaVersion(this.storageIdentity);
	}

	async migrate(context: MigrationContext): Promise<MigrationOutcome> {
		await this.initializationReady();
		const key = durableIdentityKey(this.storageIdentity);
		let state = migrationStates.get(key);
		if (!state) {
			state = { completed: false, inFlight: null };
			migrationStates.set(key, state);
		}
		if (state.completed) {
			await this.queue.run({
				identity: { kind: "all-projects" },
				operation: () =>
					retryBrowserProjectMigrationCleanup({
						identity: this.storageIdentity,
						policy: this.migrationPolicy,
						diagnostic: this.diagnostic,
						hooks: this.migrationHooks,
					}),
			});
			return { status: "not-needed" };
		}
		if (state.inFlight) return state.inFlight;
		const run = this.queue.run({
			identity: { kind: "all-projects" },
			operation: () =>
				runBrowserProjectMigration({
					identity: this.storageIdentity,
					policy: this.migrationPolicy,
					context,
					diagnostic: this.diagnostic,
					hooks: this.migrationHooks,
				}),
		});
		state.inFlight = run;
		const outcome = await run;
		if (outcome.status === "failed") {
			migrationStates.delete(key);
		} else {
			state.completed = true;
			state.inFlight = null;
		}
		return outcome;
	}

	async list(
		args: { signal?: AbortSignal } = {},
	): Promise<readonly ProjectSummary[]> {
		const scope = { kind: "store" } as const;
		throwIfBrowserStoreAborted({
			operation: "list-projects",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "list-projects",
			scope,
			signal: args.signal,
		});
		const pairs = await this.readAfterDispatch({
			io: idbGetAllProjectPairs({
				database: this.storageIdentity.projectsDatabase,
				projectStore: this.storageIdentity.projectsStore,
				authorityStore: projectAuthorityStoreName(
					this.storageIdentity.projectsStore,
				),
				context: { operation: "list-projects", scope },
			}),
			operation: "list-projects",
			scope,
			signal: args.signal,
		});
		const summaries: ProjectSummary[] = [];
		for (const pair of pairs) {
			const decoded = decodeStoredProjectPair(pair);
			if (!decoded) throwCorrupt({ operation: "list-projects", scope });
			summaries.push(
				cloneBrowserValue({
					value: decoded.summary,
					operation: "list-projects",
					scope,
				}),
			);
		}
		return summaries.sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		);
	}

	async load(args: {
		id: string;
		signal?: AbortSignal;
	}): Promise<ProjectRecord | null> {
		const scope = { kind: "project", projectId: args.id } as const;
		throwIfBrowserStoreAborted({
			operation: "load-project",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "load-project",
			scope,
			signal: args.signal,
		});
		const pair = await this.readAfterDispatch({
			io: idbGetProjectPair({
				database: this.storageIdentity.projectsDatabase,
				projectStore: this.storageIdentity.projectsStore,
				authorityStore: projectAuthorityStoreName(
					this.storageIdentity.projectsStore,
				),
				key: args.id,
				context: { operation: "load-project", scope },
			}),
			operation: "load-project",
			scope,
			signal: args.signal,
		});
		const decoded = decodeStoredProjectPair(pair);
		if ((pair.publicRow !== null || pair.authorityRow !== null) && !decoded)
			throwCorrupt({ operation: "load-project", scope });
		return decoded
			? cloneBrowserValue({
					value: decoded.record,
					operation: "load-project",
					scope,
				})
			: null;
	}

	async save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: args.record.id } as const;
		throwIfBrowserStoreAborted({
			operation: "save-project",
			scope,
			signal: args.signal,
		});
		if (args.record.id !== args.summary.id) {
			throw new ProjectStoreError({
				code: "conflict",
				operation: "save-project",
				scope,
				message: "Project record and summary identities do not match",
			});
		}
		const stored = createCurrentStoredProject(args);
		const project = stored.publicRow;
		if (project === null) {
			throwCorrupt({ operation: "save-project", scope });
		}
		await this.initializationReady();
		await this.queue.run({
			identity: { kind: "project-record", projectId: args.record.id },
			operation: async () => {
				await this.cascade.prepareProjectSave(args.record.id);
				await this.control.beforeCommit({
					operation: "save-project",
					scope,
					signal: args.signal,
				});
				throwIfBrowserStoreAborted({
					operation: "save-project",
					scope,
					signal: args.signal,
				});
				await this.cascade.commitProjectSave({
					projectId: args.record.id,
					project,
					projectAuthority: stored.authorityRow,
					signal: args.signal,
				});
			},
		});
	}

	async remove(args: { id: string; signal?: AbortSignal }): Promise<void> {
		const scope = { kind: "project", projectId: args.id } as const;
		throwIfBrowserStoreAborted({
			operation: "remove-project",
			scope,
			signal: args.signal,
		});
		await this.initializationReady();
		await this.queue.run({
			identity: { kind: "project-tree", projectId: args.id },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-project",
					scope,
					signal: args.signal,
				});
				await this.cascade.commitProjectRemoval({
					projectId: args.id,
					signal: args.signal,
				});
			},
		});
	}

	async listAttachments(args: {
		projectId: string;
		signal?: AbortSignal;
	}): Promise<readonly ProjectAttachment[]> {
		const scope = { kind: "project", projectId: args.projectId } as const;
		throwIfBrowserStoreAborted({
			operation: "list-attachments",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "list-attachments",
			scope,
			signal: args.signal,
		});
		return this.queue.run({
			identity: { kind: "project-tree", projectId: args.projectId },
			operation: async () => {
				throwIfBrowserStoreAborted({
					operation: "list-attachments",
					scope,
					signal: args.signal,
				});
				if (
					await this.cascade.projectBlocksAttachmentAccess({
						projectId: args.projectId,
						operation: "list-attachments",
						scope,
					})
				) {
					return [];
				}
				await registerMediaOwner({
					identity: this.storageIdentity,
					topology: this.topology,
					projectId: args.projectId,
					context: { operation: "list-attachments", scope },
				});
				await this.control.afterMediaOwnerRegistration({
					operation: "list-attachments",
				});
				throwIfBrowserStoreAborted({
					operation: "list-attachments",
					scope,
					signal: args.signal,
				});
				const pairs = await this.readAfterDispatch({
					io: idbGetAllAttachmentPairs({
						database: mediaDatabaseName({
							identity: this.storageIdentity,
							projectId: args.projectId,
						}),
						mediaStore: this.storageIdentity.mediaStore,
						authorityStore: attachmentAuthorityStoreName(
							this.storageIdentity.mediaStore,
						),
						context: { operation: "list-attachments", scope },
					}),
					operation: "list-attachments",
					scope,
					signal: args.signal,
				});
				const values: ProjectAttachment[] = [];
				for (const pair of pairs) {
					const decoded = decodeStoredAttachmentPair({
						projectId: args.projectId,
						...pair,
					});
					if (!decoded) throwCorrupt({ operation: "list-attachments", scope });
					if (decoded.kind === "tombstone") continue;
					const attachment = await this.readAfterDispatch({
						io: this.readAttachmentBody(decoded),
						operation: "list-attachments",
						scope,
						signal: args.signal,
					});
					if (!attachment) {
						throw new ProjectStoreError({
							code: "corrupt",
							operation: "list-attachments",
							scope,
						});
					}
					values.push(attachment);
				}
				return values.sort((left, right) => left.key.localeCompare(right.key));
			},
		});
	}

	async loadAttachment(args: {
		projectId: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment | null> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "load-attachment",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "load-attachment",
			scope,
			signal: args.signal,
		});
		return this.queue.run({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				throwIfBrowserStoreAborted({
					operation: "load-attachment",
					scope,
					signal: args.signal,
				});
				if (
					await this.cascade.projectBlocksAttachmentAccess({
						projectId: args.projectId,
						operation: "load-attachment",
						scope,
					})
				) {
					return null;
				}
				await registerMediaOwner({
					identity: this.storageIdentity,
					topology: this.topology,
					projectId: args.projectId,
					context: { operation: "load-attachment", scope },
				});
				await this.control.afterMediaOwnerRegistration({
					operation: "load-attachment",
				});
				throwIfBrowserStoreAborted({
					operation: "load-attachment",
					scope,
					signal: args.signal,
				});
				const pair = await this.readAfterDispatch({
					io: idbGetAttachmentPair({
						database: mediaDatabaseName({
							identity: this.storageIdentity,
							projectId: args.projectId,
						}),
						mediaStore: this.storageIdentity.mediaStore,
						authorityStore: attachmentAuthorityStoreName(
							this.storageIdentity.mediaStore,
						),
						key: args.key,
						context: { operation: "load-attachment", scope },
					}),
					operation: "load-attachment",
					scope,
					signal: args.signal,
				});
				const decoded = decodeStoredAttachmentPair({
					projectId: args.projectId,
					...pair,
				});
				if (!decoded) {
					if (pair.publicRow === null && pair.authorityRow === null)
						return null;
					throwCorrupt({ operation: "load-attachment", scope });
				}
				if (decoded.kind === "tombstone") return null;
				const attachment = await this.readAfterDispatch({
					io: this.readAttachmentBody(decoded),
					operation: "load-attachment",
					scope,
					signal: args.signal,
				});
				if (!attachment) {
					throw new ProjectStoreError({
						code: "corrupt",
						operation: "load-attachment",
						scope,
					});
				}
				return attachment;
			},
		});
	}

	async saveAttachment(args: {
		projectId: string;
		key: string;
		metadata: unknown;
		body: ArrayBuffer;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "save-attachment",
			scope,
			signal: args.signal,
		});
		const copied = cloneBrowserValue({
			value: { metadata: args.metadata, body: args.body },
			operation: "save-attachment",
			scope,
		});
		await this.initializationReady();
		await this.queue.run({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				await this.cascade.assertProjectAcceptsAttachments(args);
				await registerMediaOwner({
					identity: this.storageIdentity,
					topology: this.topology,
					projectId: args.projectId,
					context: { operation: "save-attachment", scope },
				});
				await this.control.afterMediaOwnerRegistration({
					operation: "save-attachment",
				});
				await this.commitAttachment({ ...args, ...copied, scope });
			},
		});
	}

	async removeAttachment(args: {
		projectId: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "remove-attachment",
			scope,
			signal: args.signal,
		});
		await this.initializationReady();
		await this.queue.run({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				if (
					await this.cascade.projectBlocksAttachmentAccess({
						projectId: args.projectId,
						operation: "remove-attachment",
						scope,
					})
				) {
					return;
				}
				await registerMediaOwner({
					identity: this.storageIdentity,
					topology: this.topology,
					projectId: args.projectId,
					context: { operation: "remove-attachment", scope },
				});
				await this.control.afterMediaOwnerRegistration({
					operation: "remove-attachment",
				});
				const existing = await this.readAttachmentRecord(args);
				const retainDeletionAuthorityForRecovery =
					await hasPendingBrowserProjectMigrationAttachmentRecovery({
						identity: this.storageIdentity,
						policy: this.migrationPolicy,
						projectId: args.projectId,
						key: args.key,
					});
				await this.control.beforeCommit({
					operation: "remove-attachment",
					scope,
					signal: args.signal,
				});
				const deletion = createCurrentStoredAttachmentTombstone({
					projectId: args.projectId,
					key: args.key,
					mutationId: randomInternalName(".c5-attachment-mutation-"),
					retiredBodyKeys: attachmentRetiredBodyKeys(existing),
				});
				throwIfBrowserStoreAborted({
					operation: "remove-attachment",
					scope,
					signal: args.signal,
				});
				await idbCommitAttachmentRemoval({
					database: mediaDatabaseName({
						identity: this.storageIdentity,
						projectId: args.projectId,
					}),
					mediaStore: this.storageIdentity.mediaStore,
					authorityStore: attachmentAuthorityStoreName(
						this.storageIdentity.mediaStore,
					),
					key: args.key,
					deletionAuthority: deletion.authorityRow,
					context: { operation: "remove-attachment", scope },
					signal: args.signal,
				});
				await this.cleanupRetiredAttachmentBodies({
					projectId: args.projectId,
					key: args.key,
					retiredBodyKeys: attachmentRetiredBodyKeys(existing),
					expectedAuthority: deletion.authorityRow,
					resolveWhenEmpty: true,
					replacementAuthority: (remaining) =>
						remaining.length === 0 && !retainDeletionAuthorityForRecovery
							? null
							: createCurrentStoredAttachmentTombstone({
									projectId: args.projectId,
									key: args.key,
									mutationId: String(deletion.authorityRow.mutationId),
									retiredBodyKeys: remaining,
								}).authorityRow,
					scope,
				});
			},
		});
	}

	async listLibraryRecords(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<readonly LibraryRecord[]> {
		const scope = { kind: "library", namespace: args.namespace } as const;
		throwIfBrowserStoreAborted({
			operation: "list-library-records",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "list-library-records",
			scope,
			signal: args.signal,
		});
		const rows = await this.readAfterDispatch({
			io: idbGetAll<unknown>({
				database: this.storageIdentity.libraryDatabase,
				store: this.storageIdentity.libraryStore,
				context: { operation: "list-library-records", scope },
			}),
			operation: "list-library-records",
			scope,
			signal: args.signal,
		});
		const records: LibraryRecord[] = [];
		for (const row of rows) {
			const decoded = decodeStoredLibraryRecord(row);
			if (!decoded) {
				if (isRecognizedLegacySavedSoundsRow(row)) continue;
				throwCorrupt({ operation: "list-library-records", scope });
			}
			if (decoded.namespace === args.namespace) records.push(decoded);
		}
		const legacy = await this.loadLegacySavedSounds({
			namespace: args.namespace,
			operation: "list-library-records",
			scope,
			signal: args.signal,
		});
		if (legacy && !records.some((record) => record.key === legacy.key))
			records.push(legacy);
		return cloneBrowserValue({
			value: records.sort((left, right) => left.key.localeCompare(right.key)),
			operation: "list-library-records",
			scope,
		});
	}

	async loadLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<LibraryRecord | null> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
		await this.readyForRead({
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
		const row = await this.readAfterDispatch({
			io: idbGet<unknown>({
				database: this.storageIdentity.libraryDatabase,
				store: this.storageIdentity.libraryStore,
				key: encodeLibraryKey(args),
				context: { operation: "load-library-record", scope },
			}),
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
		const record = row === null ? null : decodeStoredLibraryRecord(row);
		if (record) {
			return cloneBrowserValue({
				value: record,
				operation: "load-library-record",
				scope,
			});
		}
		if (row !== null) throwCorrupt({ operation: "load-library-record", scope });
		if (args.key !== "user-sounds") return null;
		return this.loadLegacySavedSounds({
			namespace: args.namespace,
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
	}

	async saveLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		data: unknown;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "save-library-record",
			scope,
			signal: args.signal,
		});
		const stored = createStoredLibraryRecord(args);
		await this.initializationReady();
		await this.queue.run({
			identity: {
				kind: "library-record",
				namespace: args.namespace,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-library-record",
					scope,
					signal: args.signal,
				});
				await idbPut({
					database: this.storageIdentity.libraryDatabase,
					store: this.storageIdentity.libraryStore,
					value: stored,
					context: { operation: "save-library-record", scope },
				});
			},
		});
	}

	async removeLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "library",
			namespace: args.namespace,
			key: args.key,
		} as const;
		throwIfBrowserStoreAborted({
			operation: "remove-library-record",
			scope,
			signal: args.signal,
		});
		await this.initializationReady();
		await this.queue.run({
			identity: {
				kind: "library-record",
				namespace: args.namespace,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-library-record",
					scope,
					signal: args.signal,
				});
				await idbDelete({
					database: this.storageIdentity.libraryDatabase,
					store: this.storageIdentity.libraryStore,
					key: encodeLibraryKey(args),
					context: { operation: "remove-library-record", scope },
				});
			},
		});
	}

	async inspect(
		args: { signal?: AbortSignal } = {},
	): Promise<ProjectStoreInspection> {
		const scope = { kind: "store" } as const;
		throwIfBrowserStoreAborted({
			operation: "inspect",
			scope,
			signal: args.signal,
		});
		const controlled = this.control.readInspection();
		if (controlled) return controlled;
		if (typeof indexedDB === "undefined") {
			return {
				availability: "unsupported",
				capacity: null,
				reason: "durable storage unsupported",
			};
		}
		if (
			!navigator.storage ||
			typeof navigator.storage.getDirectory !== "function"
		) {
			return {
				availability: "unsupported",
				capacity: null,
				reason: "binary storage unsupported",
			};
		}
		try {
			const estimate = await this.readAfterDispatch({
				io: navigator.storage.estimate(),
				operation: "inspect",
				scope,
				signal: args.signal,
			});
			const usedBytes = finiteBytes(estimate.usage);
			const totalBytes = finiteBytes(estimate.quota);
			return {
				availability: "available",
				capacity:
					usedBytes === null || totalBytes === null
						? null
						: {
								usedBytes,
								totalBytes,
								remainingBytes: Math.max(totalBytes - usedBytes, 0),
							},
			};
		} catch {
			throwIfBrowserStoreAborted({
				operation: "inspect",
				scope,
				signal: args.signal,
			});
			return {
				availability: "unavailable",
				capacity: null,
				reason: "durable storage unavailable",
			};
		}
	}

	async clear(args: {
		scope: ProjectStoreClearScope;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope =
			args.scope.kind === "library"
				? ({ kind: "library", namespace: args.scope.namespace } as const)
				: ({ kind: "store" } as const);
		throwIfBrowserStoreAborted({
			operation: "clear",
			scope,
			signal: args.signal,
		});
		await this.initializationReady();
		await this.queue.run({
			identity:
				args.scope.kind === "projects"
					? { kind: "all-projects" }
					: args.scope.kind === "library"
						? { kind: "library-namespace", namespace: args.scope.namespace }
						: { kind: "all" },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "clear",
					scope,
					signal: args.signal,
				});
				if (args.scope.kind === "library") {
					await this.clearLibraryNamespace(args.scope.namespace);
				} else {
					await this.cascade.commitProjectsClear({
						signal: args.signal,
						clearScope: args.scope.kind,
					});
				}
			},
		});
	}

	private async readyForRead(
		args: Parameters<typeof throwIfBrowserStoreAborted>[0],
	): Promise<void> {
		try {
			await this.initializationReady();
		} catch (error) {
			throwIfBrowserStoreAborted(args);
			throw error;
		}
		throwIfBrowserStoreAborted(args);
	}

	private async readAfterDispatch<Result>(
		args: Parameters<typeof throwIfBrowserStoreAborted>[0] & {
			io: Promise<Result>;
		},
	): Promise<Result> {
		await this.control.afterReadDispatch({ operation: args.operation });
		try {
			const result = await args.io;
			throwIfBrowserStoreAborted(args);
			return result;
		} catch (error) {
			throwIfBrowserStoreAborted(args);
			throw error;
		}
	}

	private async commitAttachment(args: {
		projectId: string;
		key: string;
		metadata: unknown;
		body: ArrayBuffer;
		signal?: AbortSignal;
		scope: Extract<
			Parameters<typeof throwIfBrowserStoreAborted>[0]["scope"],
			{ kind: "attachment" }
		>;
	}): Promise<void> {
		const directory = mediaDirectoryName({
			identity: this.storageIdentity,
			projectId: args.projectId,
		});
		const stageKey = randomInternalName(ATTACHMENT_STAGE_PREFIX);
		const bodyKey = randomInternalName(ATTACHMENT_BODY_PREFIX);
		const existing = await this.readAttachmentRecord(args);
		let committed = false;
		let committedAuthority: Record<string, unknown> | null = null;
		let committedRetiredBodyKeys: readonly string[] = [];
		let committedMutationId: string | null = null;
		let committedBodyDigest: string | null = null;
		let committedByteLength: number | null = null;
		try {
			const inspection = await this.inspect();
			if (
				inspection.availability === "available" &&
				inspection.capacity !== null &&
				args.body.byteLength > inspection.capacity.remainingBytes
			) {
				throw new ProjectStoreError({
					code: "quota-exceeded",
					operation: "save-attachment",
					scope: args.scope,
				});
			}
			await opfsWrite({
				directory,
				key: stageKey,
				body: args.body,
				context: { operation: "save-attachment", scope: args.scope },
			});
			const staged = await opfsRead({
				directory,
				key: stageKey,
				context: { operation: "save-attachment", scope: args.scope },
			});
			if (!staged || !equalBytes({ left: staged, right: args.body })) {
				throw new ProjectStoreError({
					code: "corrupt",
					operation: "save-attachment",
					scope: args.scope,
				});
			}
			const bodyDigest = await digestAttachmentBody(staged);
			await opfsWrite({
				directory,
				key: bodyKey,
				body: staged,
				context: { operation: "save-attachment", scope: args.scope },
			});
			await this.control.beforeCommit({
				operation: "save-attachment",
				scope: args.scope,
				signal: args.signal,
			});
			const mutationId = randomInternalName(".c5-attachment-mutation-");
			const retiredBodyKeys = attachmentRetiredBodyKeys(existing).filter(
				(key) => key !== bodyKey,
			);
			const stored = createCurrentStoredAttachment({
				projectId: args.projectId,
				key: args.key,
				metadata: args.metadata,
				bodyKey,
				mutationId,
				bodyDigest,
				byteLength: staged.byteLength,
				retiredBodyKeys,
			});
			if (stored.publicRow === null) {
				throwCorrupt({ operation: "save-attachment", scope: args.scope });
			}
			throwIfBrowserStoreAborted({
				operation: "save-attachment",
				scope: args.scope,
				signal: args.signal,
			});
			await idbCommitAttachment({
				database: mediaDatabaseName({
					identity: this.storageIdentity,
					projectId: args.projectId,
				}),
				mediaStore: this.storageIdentity.mediaStore,
				authorityStore: attachmentAuthorityStoreName(
					this.storageIdentity.mediaStore,
				),
				metadata: stored.publicRow,
				authority: stored.authorityRow,
				context: { operation: "save-attachment", scope: args.scope },
				signal: args.signal,
			});
			committed = true;
			committedAuthority = stored.authorityRow;
			committedRetiredBodyKeys = retiredBodyKeys;
			committedMutationId = mutationId;
			committedBodyDigest = bodyDigest;
			committedByteLength = staged.byteLength;
		} catch (error) {
			throw mapBrowserStoreError({
				error,
				operation: "save-attachment",
				scope: args.scope,
			});
		} finally {
			await this.cleanupBody({
				projectId: args.projectId,
				key: stageKey,
				scope: args.scope,
			});
			if (!committed) {
				await this.cleanupBody({
					projectId: args.projectId,
					key: bodyKey,
					scope: args.scope,
				});
			}
		}
		if (
			committedAuthority &&
			committedMutationId &&
			committedBodyDigest &&
			committedByteLength !== null
		) {
			await this.cleanupRetiredAttachmentBodies({
				projectId: args.projectId,
				key: args.key,
				retiredBodyKeys: committedRetiredBodyKeys,
				expectedAuthority: committedAuthority,
				resolveWhenEmpty: false,
				replacementAuthority: (remaining) =>
					createCurrentStoredAttachment({
						projectId: args.projectId,
						key: args.key,
						metadata: args.metadata,
						bodyKey,
						mutationId: committedMutationId,
						bodyDigest: committedBodyDigest,
						byteLength: committedByteLength,
						retiredBodyKeys: remaining,
					}).authorityRow,
				scope: args.scope,
			});
		}
	}

	private async readAttachmentRecord(args: { projectId: string; key: string }) {
		const pair = await idbGetAttachmentPair({
			database: mediaDatabaseName({
				identity: this.storageIdentity,
				projectId: args.projectId,
			}),
			mediaStore: this.storageIdentity.mediaStore,
			authorityStore: attachmentAuthorityStoreName(
				this.storageIdentity.mediaStore,
			),
			key: args.key,
			context: {
				operation: "load-attachment",
				scope: { kind: "attachment", projectId: args.projectId, key: args.key },
			},
		});
		const decoded = decodeStoredAttachmentPair({
			projectId: args.projectId,
			...pair,
		});
		if (!decoded) {
			if (pair.publicRow === null && pair.authorityRow === null) return null;
			throwCorrupt({
				operation: "load-attachment",
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			});
		}
		return decoded;
	}

	private async readAttachmentBody(
		metadata: DecodedStoredAttachment,
	): Promise<ProjectAttachment | null> {
		const scope = {
			kind: "attachment",
			projectId: metadata.projectId,
			key: metadata.key,
		} as const;
		const body = await opfsRead({
			directory: mediaDirectoryName({
				identity: this.storageIdentity,
				projectId: metadata.projectId,
			}),
			key: metadata.bodyKey,
			context: { operation: "load-attachment", scope },
		});
		if (
			body &&
			(metadata.revision === 2 || metadata.revision === "current") &&
			(body.byteLength !== metadata.byteLength ||
				(await digestAttachmentBody(body)) !== metadata.bodyDigest)
		) {
			return null;
		}
		return body
			? cloneBrowserValue({
					value: {
						projectId: metadata.projectId,
						key: metadata.key,
						metadata: metadata.metadata,
						body,
					},
					operation: "load-attachment",
					scope,
				})
			: null;
	}

	private async cleanupBody(args: {
		projectId: string;
		key: string;
		scope: Parameters<typeof opfsRemove>[0]["context"]["scope"];
	}): Promise<boolean> {
		try {
			await opfsRemove({
				directory: mediaDirectoryName({
					identity: this.storageIdentity,
					projectId: args.projectId,
				}),
				key: args.key,
				context: { operation: "remove-attachment", scope: args.scope },
			});
			return true;
		} catch {
			this.diagnostic?.({
				level: "warning",
				phase: "attachment-orphan-cleanup",
				operation: "remove-attachment",
				scope: args.scope,
				retryable: true,
			});
			return false;
		}
	}

	private async cleanupRetiredAttachmentBodies(args: {
		projectId: string;
		key: string;
		retiredBodyKeys: readonly string[];
		expectedAuthority: Record<string, unknown>;
		resolveWhenEmpty: boolean;
		replacementAuthority(
			remaining: readonly string[],
		): Record<string, unknown> | null;
		scope: ProjectStoreErrorScope;
	}): Promise<void> {
		if (args.retiredBodyKeys.length === 0 && !args.resolveWhenEmpty) return;
		const remaining: string[] = [];
		for (const key of args.retiredBodyKeys) {
			if (
				!(await this.cleanupBody({
					projectId: args.projectId,
					key,
					scope: args.scope,
				}))
			) {
				remaining.push(key);
			}
		}
		if (
			remaining.length === args.retiredBodyKeys.length &&
			args.retiredBodyKeys.length > 0
		) {
			return;
		}
		try {
			await idbResolveAttachmentBodyCleanup({
				database: mediaDatabaseName({
					identity: this.storageIdentity,
					projectId: args.projectId,
				}),
				mediaStore: this.storageIdentity.mediaStore,
				authorityStore: attachmentAuthorityStoreName(
					this.storageIdentity.mediaStore,
				),
				key: args.key,
				expectedAuthority: args.expectedAuthority,
				replacementAuthority: args.replacementAuthority(remaining),
				context: { operation: "remove-attachment", scope: args.scope },
			});
		} catch {
			this.diagnostic?.({
				level: "warning",
				phase: "attachment-deletion-authority-cleanup",
				operation: "remove-attachment",
				scope: args.scope,
				retryable: true,
			});
		}
	}

	private async clearLibraryNamespace(namespace: string): Promise<void> {
		const scope = { kind: "library", namespace } as const;
		await idbDeleteByStringKeyPrefix({
			database: this.storageIdentity.libraryDatabase,
			store: this.storageIdentity.libraryStore,
			prefix: encodeLibraryKey({ namespace, key: "" }),
			additionalKeys: namespace === "saved-sounds" ? ["user-sounds"] : [],
			afterDelete: (deletedKeys) =>
				this.control.afterLibraryNamespaceDelete({
					namespace,
					deletedKeys,
					scope,
				}),
			context: { operation: "clear", scope },
		});
	}

	private async loadLegacySavedSounds(args: {
		namespace: string;
		operation: "list-library-records" | "load-library-record";
		scope: Extract<ProjectStoreErrorScope, { kind: "library" }>;
		signal?: AbortSignal;
	}): Promise<LibraryRecord | null> {
		if (args.namespace !== "saved-sounds") return null;
		const row = await this.readAfterDispatch({
			io: idbGet<unknown>({
				database: this.storageIdentity.libraryDatabase,
				store: this.storageIdentity.libraryStore,
				key: "user-sounds",
				context: {
					operation: args.operation,
					scope: args.scope,
				},
			}),
			operation: args.operation,
			scope: args.scope,
			signal: args.signal,
		});
		if (row === null) return null;
		if (!isRecognizedLegacySavedSoundsRow(row)) {
			throwCorrupt({ operation: args.operation, scope: args.scope });
		}
		const { id: _legacyId, ...data } = cloneBrowserValue({
			value: row,
			operation: args.operation,
			scope: args.scope,
		});
		return {
			namespace: args.namespace,
			key: "user-sounds",
			schemaVersion: 1,
			data,
		};
	}

	private async cleanupAttachmentOrphans(): Promise<void> {
		try {
			const inventory = await inventoryForIdentity(this.storageIdentity);
			const targets = inventory.databases
				.filter((name) =>
					name.startsWith(this.storageIdentity.mediaDatabasePrefix),
				)
				.map((database) => ({
					database,
					projectId: database.slice(
						this.storageIdentity.mediaDatabasePrefix.length,
					),
				}));
			for (const target of targets) {
				await registerMediaOwner({
					identity: this.storageIdentity,
					topology: this.topology,
					projectId: target.projectId,
					context: {
						operation: "list-attachments",
						scope: { kind: "project", projectId: target.projectId },
					},
				});
			}

			const plans: Array<{
				projectId: string;
				database: string;
				directory: string;
				files: readonly string[];
				liveBodyKeys: ReadonlySet<string>;
				cleanupIntents: readonly {
					key: string;
					kind: "attachment" | "tombstone";
					expectedAuthority: Record<string, unknown>;
					retiredBodyKeys: readonly string[];
				}[];
			}> = [];
			for (const target of targets) {
				const scope = {
					kind: "project",
					projectId: target.projectId,
				} as const;
				try {
					const pairs = await idbGetAllAttachmentPairs({
						database: target.database,
						mediaStore: this.storageIdentity.mediaStore,
						authorityStore: attachmentAuthorityStoreName(
							this.storageIdentity.mediaStore,
						),
						context: { operation: "list-attachments", scope },
					});
					const liveBodyKeys = new Set<string>();
					const cleanupIntents: Array<{
						key: string;
						kind: "attachment" | "tombstone";
						expectedAuthority: Record<string, unknown>;
						retiredBodyKeys: readonly string[];
					}> = [];
					for (const pair of pairs) {
						const decoded = decodeStoredAttachmentPair({
							projectId: target.projectId,
							publicRow: pair.publicRow,
							authorityRow: pair.authorityRow,
						});
						if (decoded === null) {
							throw new ProjectStoreError({
								code: "corrupt",
								operation: "list-attachments",
								scope,
							});
						}
						if (decoded.kind === "attachment") {
							liveBodyKeys.add(decoded.bodyKey);
						}
						if (decoded.revision === "current") {
							if (!isRecord(pair.authorityRow)) {
								throw new ProjectStoreError({
									code: "corrupt",
									operation: "list-attachments",
									scope,
								});
							}
							cleanupIntents.push({
								key: decoded.key,
								kind: decoded.kind,
								expectedAuthority: pair.authorityRow,
								retiredBodyKeys: decoded.retiredBodyKeys,
							});
						}
					}
					const directory = mediaDirectoryName({
						identity: this.storageIdentity,
						projectId: target.projectId,
					});
					plans.push({
						projectId: target.projectId,
						database: target.database,
						directory,
						files: await listOpfsFiles(directory),
						liveBodyKeys,
						cleanupIntents,
					});
				} catch (error) {
					this.diagnostic?.({
						level: "warning",
						phase: "attachment-orphan-scan",
						operation: "list-attachments",
						scope,
						code:
							error instanceof ProjectStoreError ? error.code : "unavailable",
						retryable: true,
					});
				}
			}

			for (const plan of plans) {
				const deletionKeys = new Set(
					plan.files.filter(
						(key) =>
							(key.startsWith(ATTACHMENT_STAGE_PREFIX) ||
								key.startsWith(ATTACHMENT_BODY_PREFIX)) &&
							!plan.liveBodyKeys.has(key),
					),
				);
				for (const intent of plan.cleanupIntents) {
					for (const key of intent.retiredBodyKeys) {
						if (!plan.liveBodyKeys.has(key)) deletionKeys.add(key);
					}
				}
				const outcomes = new Map<string, boolean>();
				for (const key of [...deletionKeys].sort()) {
					outcomes.set(
						key,
						await this.cleanupBody({
							projectId: plan.projectId,
							key,
							scope: { kind: "project", projectId: plan.projectId },
						}),
					);
				}
				for (const intent of plan.cleanupIntents) {
					const remaining = intent.retiredBodyKeys.filter(
						(key) => plan.liveBodyKeys.has(key) || outcomes.get(key) !== true,
					);
					if (
						remaining.length === intent.retiredBodyKeys.length &&
						(intent.kind !== "tombstone" || remaining.length > 0)
					) {
						continue;
					}
					const scope = {
						kind: "attachment",
						projectId: plan.projectId,
						key: intent.key,
					} as const;
					try {
						await idbResolveAttachmentBodyCleanup({
							database: plan.database,
							mediaStore: this.storageIdentity.mediaStore,
							authorityStore: attachmentAuthorityStoreName(
								this.storageIdentity.mediaStore,
							),
							key: intent.key,
							expectedAuthority: intent.expectedAuthority,
							replacementAuthority:
								intent.kind === "tombstone" && remaining.length === 0
									? null
									: {
											...intent.expectedAuthority,
											retiredBodyKeys: remaining,
										},
							context: { operation: "remove-attachment", scope },
						});
					} catch {
						this.diagnostic?.({
							level: "warning",
							phase: "attachment-deletion-authority-cleanup",
							operation: "remove-attachment",
							scope,
							retryable: true,
						});
					}
				}
			}
		} catch {
			this.diagnostic?.({
				level: "warning",
				phase: "attachment-orphan-scan",
				retryable: true,
			});
		}
	}
}

function attachmentRetiredBodyKeys(
	record: DecodedStoredAttachmentRecord | null,
): string[] {
	if (!record) return [];
	const keys = [...record.retiredBodyKeys];
	if (record.kind === "attachment" && !keys.includes(record.bodyKey)) {
		keys.push(record.bodyKey);
	}
	return keys;
}

function finiteBytes(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

function equalBytes(args: { left: ArrayBuffer; right: ArrayBuffer }): boolean {
	const { left, right } = args;
	if (left.byteLength !== right.byteLength) return false;
	const a = new Uint8Array(left);
	const b = new Uint8Array(right);
	return a.every((byte, index) => byte === b[index]);
}

export function resetBrowserProjectStoreRuntimeForTests(): void {
	migrationStates.clear();
	initializationRuns.clear();
	maintenanceRuns.clear();
	resetBrowserMutationQueuesForTests();
	resetBrowserMigrationStateForTests();
}
