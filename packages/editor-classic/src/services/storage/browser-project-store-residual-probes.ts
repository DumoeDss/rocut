import type {
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	BrowserProjectStore,
	resetBrowserProjectStoreRuntimeForTests,
	type BrowserProjectStoreOptions,
} from "./browser-project-store";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
import { cascadeMaintenanceStoreName } from "./browser-project-store-cascade";
import { cleanupDisposableBrowserStorage } from "./browser-project-store-conformance";
import {
	ATTACHMENT_ENVELOPE_KEY,
	LIBRARY_ENVELOPE_KEY,
	PROJECT_ENVELOPE_KEY,
	attachmentAuthorityStoreName,
	createDisposableBrowserStorageIdentity,
	encodeLibraryKey,
	isRecord,
	mediaDatabaseName,
	mediaDirectoryName,
	projectAuthorityStoreName,
} from "./browser-project-store-internals";
import {
	createCurrentStoredAttachment,
	createCurrentStoredAttachmentTombstone,
	createStoredAttachment,
	createStoredProject,
	digestAttachmentBody,
} from "./browser-project-store-records";
import {
	idbCommitAttachment,
	idbCommitAttachmentRemoval,
	idbCommitProjectRemoval,
	idbCommitProjectSave,
	idbCommitProjectsClear,
	idbCommitProjectsClearWithLibraryBinding,
	idbGet,
	idbPut,
	idbResolveAttachmentBodyCleanup,
	opfsRead,
	opfsWrite,
} from "./browser-storage-mechanisms";

interface ReadPause {
	readonly entered: Promise<void>;
	release(): void;
}

interface ReadPauseControl {
	pauseNextRead?(args: {
		operation: ProjectStoreOperation;
		afterDispatches?: number;
	}): ReadPause;
}

export interface BrowserResidualProbeResult {
	readonly corruptProjectList: boolean;
	readonly corruptProjectLoad: boolean;
	readonly corruptAttachmentList: boolean;
	readonly corruptAttachmentLoad: boolean;
	readonly authorityOnlyAttachmentListRejects: boolean;
	readonly authorityOnlyAttachmentLoadRejects: boolean;
	readonly corruptLibraryList: boolean;
	readonly corruptLibraryLoad: boolean;
	readonly midFlightReadAbortCount: number;
	readonly midFlightReadsAborted: boolean;
	readonly postOpenProjectSaveAborted: boolean;
	readonly postOpenProjectRemovalAborted: boolean;
	readonly postOpenProjectsClearAborted: boolean;
	readonly postOpenAllClearAborted: boolean;
	readonly postOpenAttachmentSaveAborted: boolean;
	readonly postOpenAttachmentRemovalAborted: boolean;
	readonly projectPairCommitIsAtomic: boolean;
	readonly projectRemovalPairCommitIsAtomic: boolean;
	readonly projectsClearPairCommitIsAtomic: boolean;
	readonly allClearPairCommitIsAtomic: boolean;
	readonly attachmentPairCommitIsAtomic: boolean;
	readonly exactCurrentPublicRows: boolean;
	readonly authorityStateIsPrivate: boolean;
	readonly legacyRowsReadWithoutRewrite: boolean;
	readonly legacyRowsConvertOnNormalSave: boolean;
	readonly providerOwnedEnvelopeFieldsSurvive: boolean;
	readonly replaceCleanupIntentSurvivesReopen: boolean;
	readonly deleteCleanupIntentSurvivesReopen: boolean;
	readonly partialDeletionCleanupShrinksIntent: boolean;
	readonly partialDeletionCleanupRetryConverges: boolean;
	readonly staleCleanupCannotEraseLaterSave: boolean;
	readonly reopenPreservesCurrentBody: boolean;
	readonly malformedAuthoritySkipsOrphanDeletion: boolean;
	readonly orphanLiveSetPreservesAllGenerations: boolean;
	readonly orphanUnreferencedCandidatesDeletedAfterValidation: boolean;
	readonly orphanUnknownLegacyFilePreserved: boolean;
	readonly orphanLiveRetiredIntentShrinksOnReopen: boolean;
	readonly orphanDeletionRetiredIntentShrinksOnReopen: boolean;
	readonly orphanRetiredIntentRetryConverges: boolean;
	readonly orphanMalformedPairsFailClosedPerDatabase: boolean;
	readonly orphanCorruptDiagnosticIsMechanismNeutral: boolean;
	readonly orphanIndependentDatabaseStillCleans: boolean;
	readonly orphanLegacyOnlyDatabaseCompatible: boolean;
}

function disposableStore(args: {
	identity: string;
	prefix: string;
	control?: BrowserProjectStoreControl;
	diagnostic?: BrowserProjectStoreOptions["diagnostic"];
}): BrowserProjectStore {
	const options: BrowserProjectStoreOptions = {
		storageIdentity: createDisposableBrowserStorageIdentity(args),
		migrationPolicy: {
			kind: "disposable",
			identity: args.identity,
			prefix: args.prefix,
		},
		...(args.control ? { conformanceControl: args.control } : {}),
		...(args.diagnostic ? { diagnostic: args.diagnostic } : {}),
	};
	return new BrowserProjectStore(options);
}

function isTypedError(args: {
	error: unknown;
	code: "aborted" | "corrupt";
	operation: ProjectStoreOperation;
	forbiddenIdentity: string;
}): boolean {
	return (
		args.error instanceof ProjectStoreError &&
		args.error.code === args.code &&
		args.error.operation === args.operation &&
		!args.error.message.includes(args.forbiddenIdentity) &&
		!/(indexeddb|opfs|database|object store)/i.test(args.error.message)
	);
}

async function rejectsCorrupt(args: {
	run(): Promise<unknown>;
	operation: ProjectStoreOperation;
	identity: string;
}): Promise<boolean> {
	try {
		await args.run();
		return false;
	} catch (error) {
		return isTypedError({
			error,
			code: "corrupt",
			operation: args.operation,
			forbiddenIdentity: args.identity,
		});
	}
}

async function probeCorruptRows(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "corruptProjectList"
		| "corruptProjectLoad"
		| "corruptAttachmentList"
		| "corruptAttachmentLoad"
		| "corruptLibraryList"
		| "corruptLibraryLoad"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-corrupt-project`;
	const attachmentKey = "corrupt-attachment";
	const namespace = "corrupt-library";
	const libraryKey = "corrupt-record";
	try {
		await store.prepareForSession();
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: {
				id: projectId,
				[PROJECT_ENVELOPE_KEY]: { revision: 1, record: { id: projectId } },
			},
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		await idbPut({
			database: mediaDatabaseName({ identity: storageIdentity, projectId }),
			store: storageIdentity.mediaStore,
			value: {
				id: attachmentKey,
				[ATTACHMENT_ENVELOPE_KEY]: {
					revision: 1,
					projectId,
					key: attachmentKey,
					metadata: { malformed: true },
					bodyKey: 42,
				},
			},
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: attachmentKey },
			},
		});
		await opfsWrite({
			directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
			key: attachmentKey,
			body: new Uint8Array([1, 2, 3]).buffer,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: attachmentKey },
			},
		});
		await idbPut({
			database: storageIdentity.libraryDatabase,
			store: storageIdentity.libraryStore,
			value: {
				id: encodeLibraryKey({ namespace, key: libraryKey }),
				[LIBRARY_ENVELOPE_KEY]: {
					revision: 1,
					namespace,
					key: libraryKey,
					schemaVersion: "invalid",
				},
			},
			context: {
				operation: "save-library-record",
				scope: { kind: "library", namespace, key: libraryKey },
			},
		});

		const [
			corruptProjectList,
			corruptProjectLoad,
			corruptAttachmentList,
			corruptAttachmentLoad,
			corruptLibraryList,
			corruptLibraryLoad,
		] = await Promise.all([
			rejectsCorrupt({
				run: () => store.list(),
				operation: "list-projects",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.load({ id: projectId }),
				operation: "load-project",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.listAttachments({ projectId }),
				operation: "list-attachments",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.loadAttachment({ projectId, key: attachmentKey }),
				operation: "load-attachment",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.listLibraryRecords({ namespace }),
				operation: "list-library-records",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.loadLibraryRecord({ namespace, key: libraryKey }),
				operation: "load-library-record",
				identity,
			}),
		]);
		return {
			corruptProjectList,
			corruptProjectLoad,
			corruptAttachmentList,
			corruptAttachmentLoad,
			corruptLibraryList,
			corruptLibraryLoad,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeAuthorityOnlyLiveAttachment(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		"authorityOnlyAttachmentListRejects" | "authorityOnlyAttachmentLoadRejects"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-authority-only-project`;
	const key = "authority-only-live";
	const database = mediaDatabaseName({ identity: storageIdentity, projectId });
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const body = new Uint8Array([71, 72, 73]).buffer;
	try {
		await store.prepareForSession();
		await store.listAttachments({ projectId });
		const stored = createCurrentStoredAttachment({
			projectId,
			key,
			metadata: { id: key, marker: "sensitive-authority-only" },
			bodyKey: ".c5-authority-only-live-body",
			mutationId: ".c5-authority-only-live-mutation",
			bodyDigest: await digestAttachmentBody(body),
			byteLength: body.byteLength,
		});
		await opfsWrite({
			directory,
			key: String(stored.authorityRow.bodyKey),
			body,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key },
			},
		});
		await idbPut({
			database,
			store: attachmentAuthorityStoreName(storageIdentity.mediaStore),
			value: stored.authorityRow,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key },
			},
		});
		const [
			authorityOnlyAttachmentListRejects,
			authorityOnlyAttachmentLoadRejects,
		] = await Promise.all([
			rejectsCorrupt({
				run: () => store.listAttachments({ projectId }),
				operation: "list-attachments",
				identity,
			}),
			rejectsCorrupt({
				run: () => store.loadAttachment({ projectId, key }),
				operation: "load-attachment",
				identity,
			}),
		]);
		return {
			authorityOnlyAttachmentListRejects,
			authorityOnlyAttachmentLoadRejects,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function abortAfterDispatch(args: {
	control: BrowserProjectStoreControl;
	operation: ProjectStoreOperation;
	identity: string;
	afterDispatches?: number;
	run(signal: AbortSignal): Promise<unknown>;
}): Promise<boolean> {
	const pause = (args.control as ReadPauseControl).pauseNextRead?.({
		operation: args.operation,
		afterDispatches: args.afterDispatches,
	});
	if (!pause) return false;
	const abort = new AbortController();
	const outcome = args.run(abort.signal).then(
		() => ({ status: "published" as const, error: null }),
		(error: unknown) => ({ status: "rejected" as const, error }),
	);
	await pause.entered;
	abort.abort();
	pause.release();
	const settled = await outcome;
	return (
		settled.status === "rejected" &&
		isTypedError({
			error: settled.error,
			code: "aborted",
			operation: args.operation,
			forbiddenIdentity: args.identity,
		})
	);
}

async function probeMidFlightReadAbort(args: {
	prefix: string;
}): Promise<number> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const control = new BrowserProjectStoreControl();
	const store = disposableStore({ identity, prefix: args.prefix, control });
	const projectId = `${identity}-abort-project`;
	try {
		await store.prepareForSession();
		await store.save({
			record: {
				id: projectId,
				schemaVersion: store.schemaVersion,
				data: { ok: true },
			},
			summary: {
				id: projectId,
				name: "Abort probe",
				createdAt: "2026-08-02T00:00:00.000Z",
				updatedAt: "2026-08-02T00:00:00.000Z",
			},
		});
		await store.saveAttachment({
			projectId,
			key: "media",
			metadata: { ok: true },
			body: new Uint8Array([4, 5, 6]).buffer,
		});
		await store.saveLibraryRecord({
			namespace: "abort-library",
			key: "item",
			schemaVersion: 1,
			data: { ok: true },
		});
		const checks = await Promise.all([
			abortAfterDispatch({
				control,
				operation: "list-projects",
				identity,
				run: (signal) => store.list({ signal }),
			}),
			abortAfterDispatch({
				control,
				operation: "load-project",
				identity,
				run: (signal) => store.load({ id: projectId, signal }),
			}),
			abortAfterDispatch({
				control,
				operation: "list-attachments",
				identity,
				afterDispatches: 2,
				run: (signal) => store.listAttachments({ projectId, signal }),
			}),
			abortAfterDispatch({
				control,
				operation: "load-attachment",
				identity,
				afterDispatches: 2,
				run: (signal) =>
					store.loadAttachment({ projectId, key: "media", signal }),
			}),
			abortAfterDispatch({
				control,
				operation: "list-library-records",
				identity,
				run: (signal) =>
					store.listLibraryRecords({ namespace: "abort-library", signal }),
			}),
			abortAfterDispatch({
				control,
				operation: "load-library-record",
				identity,
				run: (signal) =>
					store.loadLibraryRecord({
						namespace: "abort-library",
						key: "item",
						signal,
					}),
			}),
			abortAfterDispatch({
				control,
				operation: "inspect",
				identity,
				run: (signal) => store.inspect({ signal }),
			}),
		]);
		return checks.filter(Boolean).length;
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function rawRow(args: {
	database: string;
	store: string;
	key: string;
	operation: "load-project" | "load-attachment";
	projectId: string;
}): Promise<unknown | null> {
	return idbGet<unknown>({
		database: args.database,
		store: args.store,
		key: args.key,
		context: {
			operation: args.operation,
			scope:
				args.operation === "load-project"
					? { kind: "project", projectId: args.projectId }
					: {
							kind: "attachment",
							projectId: args.projectId,
							key: args.key,
						},
		},
	});
}

async function withStorePutFailure<Result>(args: {
	store: string;
	run(): Promise<Result>;
}): Promise<{ rejected: boolean; result: Result | null }> {
	const descriptor = Object.getOwnPropertyDescriptor(
		IDBObjectStore.prototype,
		"put",
	);
	if (!descriptor) return { rejected: false, result: null };
	const originalPut = IDBObjectStore.prototype.put;
	Object.defineProperty(IDBObjectStore.prototype, "put", {
		...descriptor,
		value: function fixturePutFailure(
			this: IDBObjectStore,
			value: unknown,
			key?: IDBValidKey,
		): IDBRequest<IDBValidKey> {
			if (this.name === args.store) {
				throw new DOMException(
					"fixture pair commit failure",
					"QuotaExceededError",
				);
			}
			return Reflect.apply(
				originalPut,
				this,
				key === undefined ? [value] : [value, key],
			) as IDBRequest<IDBValidKey>;
		},
	});
	try {
		return { rejected: false, result: await args.run() };
	} catch {
		return { rejected: true, result: null };
	} finally {
		Object.defineProperty(IDBObjectStore.prototype, "put", descriptor);
	}
}

async function withOpfsRemoveFailure<Result>(args: {
	key: string | readonly string[];
	run(): Promise<Result>;
}): Promise<{ completed: boolean; result: Result | null }> {
	const descriptor = Object.getOwnPropertyDescriptor(
		FileSystemDirectoryHandle.prototype,
		"removeEntry",
	);
	if (!descriptor) return { completed: false, result: null };
	const originalRemove = FileSystemDirectoryHandle.prototype.removeEntry;
	const failedKeys = new Set(
		typeof args.key === "string" ? [args.key] : args.key,
	);
	Object.defineProperty(FileSystemDirectoryHandle.prototype, "removeEntry", {
		...descriptor,
		value: async function fixtureRemoveFailure(
			this: FileSystemDirectoryHandle,
			name: string,
			options?: FileSystemRemoveOptions,
		): Promise<void> {
			if (failedKeys.has(name)) {
				throw new DOMException(
					"fixture body cleanup failure",
					"InvalidStateError",
				);
			}
			return Reflect.apply(
				originalRemove,
				this,
				options === undefined ? [name] : [name, options],
			) as Promise<void>;
		},
	});
	try {
		return { completed: true, result: await args.run() };
	} catch {
		return { completed: false, result: null };
	} finally {
		Object.defineProperty(
			FileSystemDirectoryHandle.prototype,
			"removeEntry",
			descriptor,
		);
	}
}

interface ObservedMechanismRow {
	readonly database: string;
	readonly store: string;
	readonly key: string;
	readonly operation: "load-project" | "load-attachment";
	readonly projectId: string;
}

async function observeMechanismRows(
	rows: readonly ObservedMechanismRow[],
): Promise<unknown[]> {
	return Promise.all(rows.map((row) => rawRow(row)));
}

async function postOpenAbortPreservesRows(args: {
	database: string;
	identity: string;
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
	rows: readonly ObservedMechanismRow[];
	run(signal: AbortSignal): Promise<void>;
}): Promise<boolean> {
	const descriptor = Object.getOwnPropertyDescriptor(
		IDBFactory.prototype,
		"open",
	);
	if (!descriptor) return false;
	const before = await observeMechanismRows(args.rows);
	const originalOpen = IDBFactory.prototype.open;
	const abort = new AbortController();
	let intercepted = false;
	Object.defineProperty(IDBFactory.prototype, "open", {
		...descriptor,
		value: function fixturePostOpenAbort(
			this: IDBFactory,
			name: string,
			version?: number,
		): IDBOpenDBRequest {
			const request = Reflect.apply(
				originalOpen,
				this,
				version === undefined ? [name] : [name, version],
			) as IDBOpenDBRequest;
			if (!intercepted && name === args.database) {
				intercepted = true;
				request.addEventListener("success", () => abort.abort(), {
					once: true,
				});
			}
			return request;
		},
	});
	let error: unknown = null;
	try {
		await args.run(abort.signal);
	} catch (caught) {
		error = caught;
	} finally {
		Object.defineProperty(IDBFactory.prototype, "open", descriptor);
	}
	const after = await observeMechanismRows(args.rows);
	return (
		intercepted &&
		isTypedError({
			error,
			code: "aborted",
			operation: args.operation,
			forbiddenIdentity: args.identity,
		}) &&
		equalStructured({ left: before, right: after })
	);
}

async function probePostOpenCommitAborts(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "postOpenProjectSaveAborted"
		| "postOpenProjectRemovalAborted"
		| "postOpenProjectsClearAborted"
		| "postOpenAllClearAborted"
		| "postOpenAttachmentSaveAborted"
		| "postOpenAttachmentRemovalAborted"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectsDatabase = storageIdentity.projectsDatabase;
	const projectStore = storageIdentity.projectsStore;
	const authorityStore = projectAuthorityStoreName(projectStore);
	const maintenanceStore = cascadeMaintenanceStoreName(projectStore);
	const bindingStore = `${projectStore}-abort-binding`;
	const projectScope = (projectId: string) =>
		({ kind: "project", projectId }) as const;
	const attachmentScope = (args: { projectId: string; key: string }) =>
		({ kind: "attachment", ...args }) as const;
	const mechanismContext = (args: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
	}) => args;
	const put = async (args: {
		database: string;
		store: string;
		value: Record<string, unknown>;
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
	}) => {
		await idbPut({
			database: args.database,
			store: args.store,
			value: args.value,
			context: mechanismContext({
				operation: args.operation,
				scope: args.scope,
			}),
		});
	};
	const projectRows = (args: { projectId: string; maintenanceKey: string }) => [
		{
			database: projectsDatabase,
			store: projectStore,
			key: args.projectId,
			operation: "load-project" as const,
			projectId: args.projectId,
		},
		{
			database: projectsDatabase,
			store: authorityStore,
			key: args.projectId,
			operation: "load-project" as const,
			projectId: args.projectId,
		},
		{
			database: projectsDatabase,
			store: maintenanceStore,
			key: args.maintenanceKey,
			operation: "load-project" as const,
			projectId: args.projectId,
		},
	];
	try {
		const saveId = `${identity}-post-open-save`;
		const saveMaintenanceKey = `${saveId}-maintenance`;
		for (const [store, value] of [
			[projectStore, { id: saveId, marker: "public-before-save" }],
			[authorityStore, { id: saveId, marker: "authority-before-save" }],
			[
				maintenanceStore,
				{ id: saveMaintenanceKey, marker: "maintenance-before-save" },
			],
		] as const) {
			await put({
				database: projectsDatabase,
				store,
				value,
				operation: "save-project",
				scope: projectScope(saveId),
			});
		}
		const postOpenProjectSaveAborted = await postOpenAbortPreservesRows({
			database: projectsDatabase,
			identity,
			operation: "save-project",
			scope: projectScope(saveId),
			rows: projectRows({
				projectId: saveId,
				maintenanceKey: saveMaintenanceKey,
			}),
			run: (signal) =>
				(
					idbCommitProjectSave as (
						args: Parameters<typeof idbCommitProjectSave>[0] & {
							signal?: AbortSignal;
						},
					) => Promise<void>
				)({
					database: projectsDatabase,
					projectStore,
					authorityStore,
					maintenanceStore,
					maintenanceKey: saveMaintenanceKey,
					project: { id: saveId, marker: "public-after-save" },
					projectAuthority: {
						id: saveId,
						marker: "authority-after-save",
					},
					context: mechanismContext({
						operation: "save-project",
						scope: projectScope(saveId),
					}),
					signal,
				}),
		});

		const removeId = `${identity}-post-open-remove`;
		const removalJournalId = `${removeId}-journal`;
		for (const [store, value] of [
			[projectStore, { id: removeId, marker: "public-before-remove" }],
			[authorityStore, { id: removeId, marker: "authority-before-remove" }],
			[
				maintenanceStore,
				{ id: removalJournalId, marker: "journal-before-remove" },
			],
		] as const) {
			await put({
				database: projectsDatabase,
				store,
				value,
				operation: "remove-project",
				scope: projectScope(removeId),
			});
		}
		const postOpenProjectRemovalAborted = await postOpenAbortPreservesRows({
			database: projectsDatabase,
			identity,
			operation: "remove-project",
			scope: projectScope(removeId),
			rows: projectRows({
				projectId: removeId,
				maintenanceKey: removalJournalId,
			}),
			run: (signal) =>
				(
					idbCommitProjectRemoval as (
						args: Parameters<typeof idbCommitProjectRemoval>[0] & {
							signal?: AbortSignal;
						},
					) => Promise<void>
				)({
					database: projectsDatabase,
					projectStore,
					authorityStore,
					maintenanceStore,
					projectId: removeId,
					tombstone: { id: removalJournalId, marker: "after-remove" },
					context: mechanismContext({
						operation: "remove-project",
						scope: projectScope(removeId),
					}),
					signal,
				}),
		});

		const projectsClearId = `${identity}-post-open-projects-clear`;
		const projectsClearJournalId = `${projectsClearId}-journal`;
		for (const [store, value] of [
			[projectStore, { id: projectsClearId, marker: "public-before-clear" }],
			[
				authorityStore,
				{ id: projectsClearId, marker: "authority-before-clear" },
			],
			[
				maintenanceStore,
				{ id: projectsClearJournalId, marker: "journal-before-clear" },
			],
		] as const) {
			await put({
				database: projectsDatabase,
				store,
				value,
				operation: "clear",
				scope: { kind: "store" },
			});
		}
		const postOpenProjectsClearAborted = await postOpenAbortPreservesRows({
			database: projectsDatabase,
			identity,
			operation: "clear",
			scope: { kind: "store" },
			rows: projectRows({
				projectId: projectsClearId,
				maintenanceKey: projectsClearJournalId,
			}),
			run: (signal) =>
				(
					idbCommitProjectsClear as (
						args: Parameters<typeof idbCommitProjectsClear>[0] & {
							signal?: AbortSignal;
						},
					) => Promise<void>
				)({
					database: projectsDatabase,
					projectStore,
					authorityStore,
					maintenanceStore,
					maintenanceValues: [
						{ id: projectsClearJournalId, marker: "journal-after-clear" },
					],
					context: mechanismContext({
						operation: "clear",
						scope: { kind: "store" },
					}),
					signal,
				}),
		});

		const allClearId = `${identity}-post-open-all-clear`;
		const allClearJournalId = `${allClearId}-journal`;
		const bindingId = `${allClearId}-binding`;
		for (const [store, value] of [
			[projectStore, { id: allClearId, marker: "public-before-all-clear" }],
			[
				authorityStore,
				{ id: allClearId, marker: "authority-before-all-clear" },
			],
			[
				maintenanceStore,
				{ id: allClearJournalId, marker: "journal-before-all-clear" },
			],
			[bindingStore, { id: bindingId, marker: "binding-before-all-clear" }],
		] as const) {
			await put({
				database: projectsDatabase,
				store,
				value,
				operation: "clear",
				scope: { kind: "store" },
			});
		}
		const allClearRows = [
			...projectRows({
				projectId: allClearId,
				maintenanceKey: allClearJournalId,
			}),
			{
				database: projectsDatabase,
				store: bindingStore,
				key: bindingId,
				operation: "load-project" as const,
				projectId: allClearId,
			},
		];
		const postOpenAllClearAborted = await postOpenAbortPreservesRows({
			database: projectsDatabase,
			identity,
			operation: "clear",
			scope: { kind: "store" },
			rows: allClearRows,
			run: (signal) =>
				(
					idbCommitProjectsClearWithLibraryBinding as (
						args: Parameters<
							typeof idbCommitProjectsClearWithLibraryBinding
						>[0] & { signal?: AbortSignal },
					) => Promise<void>
				)({
					database: projectsDatabase,
					projectStore,
					authorityStore,
					maintenanceStore,
					bindingStore,
					maintenanceValues: [
						{ id: allClearJournalId, marker: "journal-after-all-clear" },
					],
					bindingDescriptor: {
						id: bindingId,
						marker: "binding-before-all-clear",
					},
					context: mechanismContext({
						operation: "clear",
						scope: { kind: "store" },
					}),
					signal,
				}),
		});

		const attachmentProjectId = `${identity}-post-open-attachment-project`;
		const mediaDatabase = mediaDatabaseName({
			identity: storageIdentity,
			projectId: attachmentProjectId,
		});
		const mediaStore = storageIdentity.mediaStore;
		const mediaAuthorityStore = attachmentAuthorityStoreName(mediaStore);
		const attachmentRows = (key: string) => [
			{
				database: mediaDatabase,
				store: mediaStore,
				key,
				operation: "load-attachment" as const,
				projectId: attachmentProjectId,
			},
			{
				database: mediaDatabase,
				store: mediaAuthorityStore,
				key,
				operation: "load-attachment" as const,
				projectId: attachmentProjectId,
			},
		];
		const attachmentSaveKey = "post-open-attachment-save";
		for (const [store, value] of [
			[mediaStore, { id: attachmentSaveKey, marker: "public-before-save" }],
			[
				mediaAuthorityStore,
				{ id: attachmentSaveKey, marker: "authority-before-save" },
			],
		] as const) {
			await put({
				database: mediaDatabase,
				store,
				value,
				operation: "save-attachment",
				scope: attachmentScope({
					projectId: attachmentProjectId,
					key: attachmentSaveKey,
				}),
			});
		}
		const postOpenAttachmentSaveAborted = await postOpenAbortPreservesRows({
			database: mediaDatabase,
			identity,
			operation: "save-attachment",
			scope: attachmentScope({
				projectId: attachmentProjectId,
				key: attachmentSaveKey,
			}),
			rows: attachmentRows(attachmentSaveKey),
			run: (signal) =>
				(
					idbCommitAttachment as (
						args: Parameters<typeof idbCommitAttachment>[0] & {
							signal?: AbortSignal;
						},
					) => Promise<void>
				)({
					database: mediaDatabase,
					mediaStore,
					authorityStore: mediaAuthorityStore,
					metadata: { id: attachmentSaveKey, marker: "public-after-save" },
					authority: {
						id: attachmentSaveKey,
						marker: "authority-after-save",
					},
					context: mechanismContext({
						operation: "save-attachment",
						scope: attachmentScope({
							projectId: attachmentProjectId,
							key: attachmentSaveKey,
						}),
					}),
					signal,
				}),
		});

		const attachmentRemoveKey = "post-open-attachment-remove";
		for (const [store, value] of [
			[mediaStore, { id: attachmentRemoveKey, marker: "public-before-remove" }],
			[
				mediaAuthorityStore,
				{ id: attachmentRemoveKey, marker: "authority-before-remove" },
			],
		] as const) {
			await put({
				database: mediaDatabase,
				store,
				value,
				operation: "remove-attachment",
				scope: attachmentScope({
					projectId: attachmentProjectId,
					key: attachmentRemoveKey,
				}),
			});
		}
		const postOpenAttachmentRemovalAborted = await postOpenAbortPreservesRows({
			database: mediaDatabase,
			identity,
			operation: "remove-attachment",
			scope: attachmentScope({
				projectId: attachmentProjectId,
				key: attachmentRemoveKey,
			}),
			rows: attachmentRows(attachmentRemoveKey),
			run: (signal) =>
				(
					idbCommitAttachmentRemoval as (
						args: Parameters<typeof idbCommitAttachmentRemoval>[0] & {
							signal?: AbortSignal;
						},
					) => Promise<void>
				)({
					database: mediaDatabase,
					mediaStore,
					authorityStore: mediaAuthorityStore,
					key: attachmentRemoveKey,
					deletionAuthority: {
						id: attachmentRemoveKey,
						marker: "authority-after-remove",
					},
					context: mechanismContext({
						operation: "remove-attachment",
						scope: attachmentScope({
							projectId: attachmentProjectId,
							key: attachmentRemoveKey,
						}),
					}),
					signal,
				}),
		});
		return {
			postOpenProjectSaveAborted,
			postOpenProjectRemovalAborted,
			postOpenProjectsClearAborted,
			postOpenAllClearAborted,
			postOpenAttachmentSaveAborted,
			postOpenAttachmentRemovalAborted,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

function equalStructured(args: { left: unknown; right: unknown }): boolean {
	const { left, right } = args;
	if (Object.is(left, right)) return true;
	if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
		return equalBytes({ left, right });
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) =>
				equalStructured({ left: value, right: right[index] }),
			)
		);
	}
	if (!isRecord(left) || !isRecord(right)) return false;
	const leftRecord = left;
	const rightRecord = right;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] &&
				equalStructured({ left: leftRecord[key], right: rightRecord[key] }),
		)
	);
}

function equalBytes(args: { left: ArrayBuffer; right: ArrayBuffer }): boolean {
	const { left, right } = args;
	return (
		left.byteLength === right.byteLength &&
		new Uint8Array(left).every(
			(byte, index) => byte === new Uint8Array(right)[index],
		)
	);
}

async function probeOrdinaryPairs(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "projectPairCommitIsAtomic"
		| "projectRemovalPairCommitIsAtomic"
		| "attachmentPairCommitIsAtomic"
		| "exactCurrentPublicRows"
		| "authorityStateIsPrivate"
		| "legacyRowsReadWithoutRewrite"
		| "legacyRowsConvertOnNormalSave"
		| "providerOwnedEnvelopeFieldsSurvive"
		| "replaceCleanupIntentSurvivesReopen"
		| "deleteCleanupIntentSurvivesReopen"
		| "staleCleanupCannotEraseLaterSave"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const reopened = disposableStore({ identity, prefix: args.prefix });
	const projectAuthorityStore = projectAuthorityStoreName(
		storageIdentity.projectsStore,
	);
	const projectId = `${identity}-current-project`;
	const mediaDatabase = mediaDatabaseName({
		identity: storageIdentity,
		projectId,
	});
	const attachmentAuthorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const summary = {
		id: projectId,
		name: "Current project",
		createdAt: "2026-08-02T00:00:00.000Z",
		updatedAt: "2026-08-02T00:00:01.000Z",
	};
	const providerProjectField = {
		revision: "provider-owned",
		nested: { keep: true },
	};
	const projectData = {
		version: store.schemaVersion,
		metadata: { ...summary },
		scenes: [],
		[PROJECT_ENVELOPE_KEY]: providerProjectField,
	};
	const attachmentKey = "current-media";
	const providerAttachmentField = {
		revision: "provider-owned",
		nested: { keep: true },
	};
	const metadata = {
		id: attachmentKey,
		name: "Current media",
		type: "video" as const,
		lastModified: 123,
		width: 1920,
		height: 1080,
		duration: 2,
		mimeType: "video/test",
		fps: 30,
		hasAudio: true,
		[ATTACHMENT_ENVELOPE_KEY]: providerAttachmentField,
	};
	const initialBody = new Uint8Array([1, 2, 3, 4]).buffer;
	try {
		await Promise.all([
			store.prepareForSession(),
			reopened.prepareForSession(),
		]);
		await store.save({
			record: {
				id: projectId,
				schemaVersion: store.schemaVersion,
				data: projectData,
			},
			summary,
		});
		await store.saveAttachment({
			projectId,
			key: attachmentKey,
			metadata,
			body: initialBody,
		});

		const projectPublic = await rawRow({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			operation: "load-project",
			projectId,
		});
		const projectAuthority = await rawRow({
			database: storageIdentity.projectsDatabase,
			store: projectAuthorityStore,
			key: projectId,
			operation: "load-project",
			projectId,
		});
		const attachmentPublic = await rawRow({
			database: mediaDatabase,
			store: storageIdentity.mediaStore,
			key: attachmentKey,
			operation: "load-attachment",
			projectId,
		});
		const attachmentAuthority = await rawRow({
			database: mediaDatabase,
			store: attachmentAuthorityStore,
			key: attachmentKey,
			operation: "load-attachment",
			projectId,
		});
		const expectedProjectPublic = { ...projectData, id: projectId };
		const expectedAttachmentPublic = {
			id: attachmentKey,
			name: metadata.name,
			type: metadata.type,
			size: initialBody.byteLength,
			lastModified: metadata.lastModified,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			thumbnailUrl: undefined,
			ephemeral: undefined,
		};
		const exactCurrentPublicRows =
			equalStructured({ left: projectPublic, right: expectedProjectPublic }) &&
			equalStructured({
				left: attachmentPublic,
				right: expectedAttachmentPublic,
			});
		const authorityStateIsPrivate =
			projectAuthority !== null &&
			attachmentAuthority !== null &&
			typeof attachmentAuthority === "object" &&
			attachmentAuthority !== null &&
			"bodyKey" in attachmentAuthority &&
			isRecord(attachmentPublic) &&
			!("bodyKey" in attachmentPublic) &&
			!("mimeType" in attachmentPublic);

		const projectBeforeFailure = { projectPublic, projectAuthority };
		const projectFailure = await withStorePutFailure({
			store: projectAuthorityStore,
			run: () =>
				store.save({
					record: {
						id: projectId,
						schemaVersion: store.schemaVersion,
						data: { ...projectData, failureReplacement: true },
					},
					summary: { ...summary, name: "Must not commit" },
				}),
		});
		const projectAfterFailure = {
			projectPublic: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: storageIdentity.projectsStore,
				key: projectId,
				operation: "load-project",
				projectId,
			}),
			projectAuthority: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: projectId,
				operation: "load-project",
				projectId,
			}),
		};
		const projectPairCommitIsAtomic =
			projectFailure.rejected &&
			equalStructured({
				left: projectBeforeFailure,
				right: projectAfterFailure,
			});

		const removalProjectId = `${identity}-atomic-remove-project`;
		const removalSummary = {
			...summary,
			id: removalProjectId,
			name: "Atomic remove project",
		};
		await store.save({
			record: {
				id: removalProjectId,
				schemaVersion: store.schemaVersion,
				data: { version: store.schemaVersion, scenes: [], marker: "before" },
			},
			summary: removalSummary,
		});
		const removalBefore = {
			projectPublic: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: storageIdentity.projectsStore,
				key: removalProjectId,
				operation: "load-project",
				projectId: removalProjectId,
			}),
			projectAuthority: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: removalProjectId,
				operation: "load-project",
				projectId: removalProjectId,
			}),
		};
		const removalFailure = await withStorePutFailure({
			store: cascadeMaintenanceStoreName(storageIdentity.projectsStore),
			run: () => store.remove({ id: removalProjectId }),
		});
		const removalAfterFailure = {
			projectPublic: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: storageIdentity.projectsStore,
				key: removalProjectId,
				operation: "load-project",
				projectId: removalProjectId,
			}),
			projectAuthority: await rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: removalProjectId,
				operation: "load-project",
				projectId: removalProjectId,
			}),
		};
		const removalVisibleAfterFailure = await store.load({
			id: removalProjectId,
		});
		await store.remove({ id: removalProjectId });
		const [removalPublicAfterSuccess, removalAuthorityAfterSuccess] =
			await Promise.all([
				rawRow({
					database: storageIdentity.projectsDatabase,
					store: storageIdentity.projectsStore,
					key: removalProjectId,
					operation: "load-project",
					projectId: removalProjectId,
				}),
				rawRow({
					database: storageIdentity.projectsDatabase,
					store: projectAuthorityStore,
					key: removalProjectId,
					operation: "load-project",
					projectId: removalProjectId,
				}),
			]);
		const projectRemovalPairCommitIsAtomic =
			removalFailure.rejected &&
			equalStructured({
				left: removalBefore,
				right: removalAfterFailure,
			}) &&
			removalVisibleAfterFailure !== null &&
			removalPublicAfterSuccess === null &&
			removalAuthorityAfterSuccess === null &&
			(await store.load({ id: removalProjectId })) === null;

		const attachmentBeforeFailure = { attachmentPublic, attachmentAuthority };
		const attachmentFailure = await withStorePutFailure({
			store: attachmentAuthorityStore,
			run: () =>
				store.saveAttachment({
					projectId,
					key: attachmentKey,
					metadata: { ...metadata, replacement: true },
					body: new Uint8Array([9, 8, 7]).buffer,
				}),
		});
		const attachmentAfterFailure = {
			attachmentPublic: await rawRow({
				database: mediaDatabase,
				store: storageIdentity.mediaStore,
				key: attachmentKey,
				operation: "load-attachment",
				projectId,
			}),
			attachmentAuthority: await rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: attachmentKey,
				operation: "load-attachment",
				projectId,
			}),
		};
		const attachmentAfterFailureLogical = await store.loadAttachment({
			projectId,
			key: attachmentKey,
		});
		const attachmentPairCommitIsAtomic =
			attachmentFailure.rejected &&
			equalStructured({
				left: attachmentBeforeFailure,
				right: attachmentAfterFailure,
			}) &&
			attachmentAfterFailureLogical !== null &&
			equalBytes({
				left: attachmentAfterFailureLogical.body,
				right: initialBody,
			});

		const loadedProject = await store.load({ id: projectId });
		const loadedAttachment = await store.loadAttachment({
			projectId,
			key: attachmentKey,
		});
		const providerOwnedEnvelopeFieldsSurvive =
			isRecord(loadedProject?.data) &&
			equalStructured({
				left: loadedProject.data[PROJECT_ENVELOPE_KEY],
				right: providerProjectField,
			}) &&
			isRecord(loadedAttachment?.metadata) &&
			equalStructured({
				left: loadedAttachment.metadata[ATTACHMENT_ENVELOPE_KEY],
				right: providerAttachmentField,
			});

		const cleanupKey = "cleanup-media";
		const arbitraryBodyKey = "provider-arbitrary-cleanup-body";
		const arbitraryBody = new Uint8Array([10, 11, 12]).buffer;
		await opfsWrite({
			directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
			key: arbitraryBodyKey,
			body: arbitraryBody,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: cleanupKey },
			},
		});
		await idbPut({
			database: mediaDatabase,
			store: storageIdentity.mediaStore,
			value: createStoredAttachment({
				projectId,
				key: cleanupKey,
				metadata: { id: cleanupKey, marker: "arbitrary-inline" },
				bodyKey: arbitraryBodyKey,
				mutationId: ".c5-attachment-mutation-arbitrary-inline",
				bodyDigest: await digestAttachmentBody(arbitraryBody),
				byteLength: arbitraryBody.byteLength,
			}),
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: cleanupKey },
			},
		});
		const replaceWithCleanupFailure = await withOpfsRemoveFailure({
			key: arbitraryBodyKey,
			run: () =>
				store.saveAttachment({
					projectId,
					key: cleanupKey,
					metadata: { id: cleanupKey, marker: "replacement" },
					body: new Uint8Array([20, 21, 22]).buffer,
				}),
		});
		const replacementAuthority = await rawRow({
			database: mediaDatabase,
			store: attachmentAuthorityStore,
			key: cleanupKey,
			operation: "load-attachment",
			projectId,
		});
		const replacementRetiredBodyKeys = isRecord(replacementAuthority)
			? replacementAuthority.retiredBodyKeys
			: null;
		const replacementRetainedIntent =
			Array.isArray(replacementRetiredBodyKeys) &&
			replacementRetiredBodyKeys.includes(arbitraryBodyKey);
		await reopened.saveAttachment({
			projectId,
			key: cleanupKey,
			metadata: { id: cleanupKey, marker: "reopened-replacement" },
			body: new Uint8Array([30, 31, 32]).buffer,
		});
		const authorityAfterReopenReplace = await rawRow({
			database: mediaDatabase,
			store: attachmentAuthorityStore,
			key: cleanupKey,
			operation: "load-attachment",
			projectId,
		});
		const arbitraryBodyAfterRetry = await opfsRead({
			directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
			key: arbitraryBodyKey,
			context: {
				operation: "load-attachment",
				scope: { kind: "attachment", projectId, key: cleanupKey },
			},
		});
		const replaceCleanupIntentSurvivesReopen =
			replaceWithCleanupFailure.completed &&
			replacementRetainedIntent &&
			arbitraryBodyAfterRetry === null &&
			isRecord(authorityAfterReopenReplace) &&
			Array.isArray(authorityAfterReopenReplace.retiredBodyKeys) &&
			authorityAfterReopenReplace.retiredBodyKeys.length === 0;
		let staleCleanupCannotEraseLaterSave = false;
		if (
			isRecord(replacementAuthority) &&
			isRecord(authorityAfterReopenReplace)
		) {
			const staleResolved = await idbResolveAttachmentBodyCleanup({
				database: mediaDatabase,
				mediaStore: storageIdentity.mediaStore,
				authorityStore: attachmentAuthorityStore,
				key: cleanupKey,
				expectedAuthority: replacementAuthority,
				replacementAuthority: {
					...replacementAuthority,
					retiredBodyKeys: [],
				},
				context: {
					operation: "remove-attachment",
					scope: { kind: "attachment", projectId, key: cleanupKey },
				},
			});
			const authorityAfterStaleCleanup = await rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: cleanupKey,
				operation: "load-attachment",
				projectId,
			});
			const logicalAfterStaleCleanup = await store.loadAttachment({
				projectId,
				key: cleanupKey,
			});
			staleCleanupCannotEraseLaterSave =
				!staleResolved &&
				equalStructured({
					left: authorityAfterStaleCleanup,
					right: authorityAfterReopenReplace,
				}) &&
				isRecord(logicalAfterStaleCleanup?.metadata) &&
				logicalAfterStaleCleanup.metadata.marker === "reopened-replacement";
		}

		const deleteBodyKey =
			isRecord(authorityAfterReopenReplace) &&
			typeof authorityAfterReopenReplace.bodyKey === "string"
				? authorityAfterReopenReplace.bodyKey
				: "";
		const deleteWithCleanupFailure = await withOpfsRemoveFailure({
			key: deleteBodyKey,
			run: () => reopened.removeAttachment({ projectId, key: cleanupKey }),
		});
		const deletionAuthority = await rawRow({
			database: mediaDatabase,
			store: attachmentAuthorityStore,
			key: cleanupKey,
			operation: "load-attachment",
			projectId,
		});
		const logicallyDeleted =
			(await store.loadAttachment({ projectId, key: cleanupKey })) === null;
		await store.removeAttachment({ projectId, key: cleanupKey });
		const [
			publicAfterDeleteRetry,
			authorityAfterDeleteRetry,
			bodyAfterDeleteRetry,
		] = await Promise.all([
			rawRow({
				database: mediaDatabase,
				store: storageIdentity.mediaStore,
				key: cleanupKey,
				operation: "load-attachment",
				projectId,
			}),
			rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: cleanupKey,
				operation: "load-attachment",
				projectId,
			}),
			opfsRead({
				directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
				key: deleteBodyKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "attachment", projectId, key: cleanupKey },
				},
			}),
		]);
		const deleteCleanupIntentSurvivesReopen =
			deleteBodyKey.length > 0 &&
			deleteWithCleanupFailure.completed &&
			logicallyDeleted &&
			isRecord(deletionAuthority) &&
			deletionAuthority.kind === "deleted" &&
			publicAfterDeleteRetry === null &&
			authorityAfterDeleteRetry === null &&
			bodyAfterDeleteRetry === null;

		const rawProjectId = `${identity}-raw-project`;
		const inlineProjectId = `${identity}-inline-project`;
		const rawProject = {
			id: rawProjectId,
			version: 4,
			metadata: {
				id: rawProjectId,
				name: "Raw project",
				createdAt: summary.createdAt,
				updatedAt: summary.updatedAt,
			},
			scenes: [],
		};
		const inlineSummary = { ...summary, id: inlineProjectId, name: "Inline" };
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: rawProject,
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId: rawProjectId },
			},
		});
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: createStoredProject({
				record: {
					id: inlineProjectId,
					schemaVersion: store.schemaVersion,
					data: { version: 4, scenes: [], marker: "inline" },
				},
				summary: inlineSummary,
			}),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId: inlineProjectId },
			},
		});
		const legacyProjectLoads = await Promise.all([
			store.load({ id: rawProjectId }),
			store.load({ id: inlineProjectId }),
		]);
		const legacyProjectAuthoritiesBefore = await Promise.all([
			rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: rawProjectId,
				operation: "load-project",
				projectId: rawProjectId,
			}),
			rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: inlineProjectId,
				operation: "load-project",
				projectId: inlineProjectId,
			}),
		]);

		const rawAttachmentKey = "raw-media";
		const inlineAttachmentKey = "inline-media";
		const rawAttachment = {
			id: rawAttachmentKey,
			name: "Raw media",
			type: "audio",
			size: 3,
			lastModified: 1,
		};
		const inlineBodyKey = ".legacy-inline-body";
		const inlineBody = new Uint8Array([6, 7, 8]).buffer;
		await idbPut({
			database: mediaDatabase,
			store: storageIdentity.mediaStore,
			value: rawAttachment,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: rawAttachmentKey },
			},
		});
		await opfsWrite({
			directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
			key: rawAttachmentKey,
			body: new Uint8Array([3, 2, 1]).buffer,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: rawAttachmentKey },
			},
		});
		await opfsWrite({
			directory: mediaDirectoryName({ identity: storageIdentity, projectId }),
			key: inlineBodyKey,
			body: inlineBody,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: inlineAttachmentKey },
			},
		});
		await idbPut({
			database: mediaDatabase,
			store: storageIdentity.mediaStore,
			value: createStoredAttachment({
				projectId,
				key: inlineAttachmentKey,
				metadata: { id: inlineAttachmentKey, marker: "inline" },
				bodyKey: inlineBodyKey,
				mutationId: ".c5-attachment-mutation-inline",
				bodyDigest: await digestAttachmentBody(inlineBody),
				byteLength: inlineBody.byteLength,
			}),
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: inlineAttachmentKey },
			},
		});
		const legacyAttachmentLoads = await Promise.all([
			store.loadAttachment({ projectId, key: rawAttachmentKey }),
			store.loadAttachment({ projectId, key: inlineAttachmentKey }),
		]);
		const legacyAttachmentAuthoritiesBefore = await Promise.all([
			rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: rawAttachmentKey,
				operation: "load-attachment",
				projectId,
			}),
			rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: inlineAttachmentKey,
				operation: "load-attachment",
				projectId,
			}),
		]);
		const legacyRowsReadWithoutRewrite =
			legacyProjectLoads.every((value) => value !== null) &&
			legacyAttachmentLoads.every((value) => value !== null) &&
			legacyProjectAuthoritiesBefore.every((value) => value === null) &&
			legacyAttachmentAuthoritiesBefore.every((value) => value === null);

		const rawLoadedProject = legacyProjectLoads[0];
		if (rawLoadedProject) {
			await store.save({
				record: rawLoadedProject,
				summary: {
					...summary,
					id: rawLoadedProject.id,
					name: "Raw project",
				},
			});
		}
		const inlineLoadedProject = legacyProjectLoads[1];
		if (inlineLoadedProject) {
			await store.save({ record: inlineLoadedProject, summary: inlineSummary });
		}
		for (const attachment of legacyAttachmentLoads) {
			if (!attachment) continue;
			await store.saveAttachment(attachment);
		}
		const convertedRows = await Promise.all([
			rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: rawProjectId,
				operation: "load-project",
				projectId: rawProjectId,
			}),
			rawRow({
				database: storageIdentity.projectsDatabase,
				store: projectAuthorityStore,
				key: inlineProjectId,
				operation: "load-project",
				projectId: inlineProjectId,
			}),
			rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: rawAttachmentKey,
				operation: "load-attachment",
				projectId,
			}),
			rawRow({
				database: mediaDatabase,
				store: attachmentAuthorityStore,
				key: inlineAttachmentKey,
				operation: "load-attachment",
				projectId,
			}),
		]);
		const legacyRowsConvertOnNormalSave = convertedRows.every(
			(value) => value !== null,
		);

		return {
			projectPairCommitIsAtomic,
			projectRemovalPairCommitIsAtomic,
			attachmentPairCommitIsAtomic,
			exactCurrentPublicRows,
			authorityStateIsPrivate,
			legacyRowsReadWithoutRewrite,
			legacyRowsConvertOnNormalSave,
			providerOwnedEnvelopeFieldsSurvive,
			replaceCleanupIntentSurvivesReopen,
			deleteCleanupIntentSurvivesReopen,
			staleCleanupCannotEraseLaterSave,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeProjectClearPairs(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		"projectsClearPairCommitIsAtomic" | "allClearPairCommitIsAtomic"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const authorityStore = projectAuthorityStoreName(
		storageIdentity.projectsStore,
	);
	const maintenanceStore = cascadeMaintenanceStoreName(
		storageIdentity.projectsStore,
	);
	const seedProject = async (projectId: string): Promise<void> => {
		await store.save({
			record: {
				id: projectId,
				schemaVersion: store.schemaVersion,
				data: { version: store.schemaVersion, scenes: [], marker: projectId },
			},
			summary: {
				id: projectId,
				name: projectId,
				createdAt: "2026-08-02T00:00:00.000Z",
				updatedAt: "2026-08-02T00:00:01.000Z",
			},
		});
	};
	const readPair = async (projectId: string) => ({
		projectPublic: await rawRow({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			operation: "load-project",
			projectId,
		}),
		projectAuthority: await rawRow({
			database: storageIdentity.projectsDatabase,
			store: authorityStore,
			key: projectId,
			operation: "load-project",
			projectId,
		}),
	});
	try {
		await store.prepareForSession();
		const projectsClearId = `${identity}-projects-clear`;
		await seedProject(projectsClearId);
		const projectsBefore = await readPair(projectsClearId);
		const projectsFailure = await withStorePutFailure({
			store: maintenanceStore,
			run: () => store.clear({ scope: { kind: "projects" } }),
		});
		const projectsAfterFailure = await readPair(projectsClearId);
		const projectsStillVisible = await store.load({ id: projectsClearId });
		await store.clear({ scope: { kind: "projects" } });
		const projectsAfterSuccess = await readPair(projectsClearId);
		const projectsClearPairCommitIsAtomic =
			projectsFailure.rejected &&
			equalStructured({
				left: projectsBefore,
				right: projectsAfterFailure,
			}) &&
			projectsStillVisible !== null &&
			projectsAfterSuccess.projectPublic === null &&
			projectsAfterSuccess.projectAuthority === null &&
			(await store.list()).length === 0;

		const allClearId = `${identity}-all-clear`;
		const libraryNamespace = "sidecar-clear";
		const libraryKey = "retained-on-failure";
		await seedProject(allClearId);
		await store.saveLibraryRecord({
			namespace: libraryNamespace,
			key: libraryKey,
			schemaVersion: 1,
			data: { marker: "before-all-clear" },
		});
		const allBefore = await readPair(allClearId);
		const allFailure = await withStorePutFailure({
			store: maintenanceStore,
			run: () => store.clear({ scope: { kind: "all" } }),
		});
		const allAfterFailure = await readPair(allClearId);
		const libraryAfterFailure = await store.loadLibraryRecord({
			namespace: libraryNamespace,
			key: libraryKey,
		});
		await store.clear({ scope: { kind: "all" } });
		const allAfterSuccess = await readPair(allClearId);
		const allClearPairCommitIsAtomic =
			allFailure.rejected &&
			equalStructured({ left: allBefore, right: allAfterFailure }) &&
			libraryAfterFailure !== null &&
			allAfterSuccess.projectPublic === null &&
			allAfterSuccess.projectAuthority === null &&
			(await store.list()).length === 0 &&
			(await store.loadLibraryRecord({
				namespace: libraryNamespace,
				key: libraryKey,
			})) === null;
		return { projectsClearPairCommitIsAtomic, allClearPairCommitIsAtomic };
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probePartialDeletionCleanup(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "partialDeletionCleanupShrinksIntent"
		| "partialDeletionCleanupRetryConverges"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-partial-delete-project`;
	const key = "partial-delete-media";
	const cleanedBodyKey = ".c5-partial-delete-cleaned";
	const failedBodyKey = ".c5-partial-delete-failed";
	const database = mediaDatabaseName({ identity: storageIdentity, projectId });
	const authorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const scope = { kind: "attachment", projectId, key } as const;
	try {
		await store.prepareForSession();
		await store.listAttachments({ projectId });
		for (const [bodyKey, byte] of [
			[cleanedBodyKey, 81],
			[failedBodyKey, 82],
		] as const) {
			await opfsWrite({
				directory,
				key: bodyKey,
				body: new Uint8Array([byte]).buffer,
				context: { operation: "save-attachment", scope },
			});
		}
		const seeded = createCurrentStoredAttachmentTombstone({
			projectId,
			key,
			mutationId: ".c5-partial-delete-seed",
			retiredBodyKeys: [cleanedBodyKey, failedBodyKey],
		});
		await idbPut({
			database,
			store: authorityStore,
			value: seeded.authorityRow,
			context: { operation: "remove-attachment", scope },
		});
		const firstCleanup = await withOpfsRemoveFailure({
			key: failedBodyKey,
			run: () => store.removeAttachment({ projectId, key }),
		});
		const [publicAfterPartial, authorityAfterPartial, cleanedBody, failedBody] =
			await Promise.all([
				rawRow({
					database,
					store: storageIdentity.mediaStore,
					key,
					operation: "load-attachment",
					projectId,
				}),
				rawRow({
					database,
					store: authorityStore,
					key,
					operation: "load-attachment",
					projectId,
				}),
				opfsRead({
					directory,
					key: cleanedBodyKey,
					context: { operation: "load-attachment", scope },
				}),
				opfsRead({
					directory,
					key: failedBodyKey,
					context: { operation: "load-attachment", scope },
				}),
			]);
		const partialDeletionCleanupShrinksIntent =
			firstCleanup.completed &&
			publicAfterPartial === null &&
			isRecord(authorityAfterPartial) &&
			authorityAfterPartial.kind === "deleted" &&
			Array.isArray(authorityAfterPartial.retiredBodyKeys) &&
			equalStructured({
				left: authorityAfterPartial.retiredBodyKeys,
				right: [failedBodyKey],
			}) &&
			cleanedBody === null &&
			failedBody !== null;

		await store.removeAttachment({ projectId, key });
		const [publicAfterRetry, authorityAfterRetry, failedBodyAfterRetry] =
			await Promise.all([
				rawRow({
					database,
					store: storageIdentity.mediaStore,
					key,
					operation: "load-attachment",
					projectId,
				}),
				rawRow({
					database,
					store: authorityStore,
					key,
					operation: "load-attachment",
					projectId,
				}),
				opfsRead({
					directory,
					key: failedBodyKey,
					context: { operation: "load-attachment", scope },
				}),
			]);
		const partialDeletionCleanupRetryConverges =
			publicAfterRetry === null &&
			authorityAfterRetry === null &&
			failedBodyAfterRetry === null &&
			(await store.loadAttachment({ projectId, key })) === null;
		return {
			partialDeletionCleanupShrinksIntent,
			partialDeletionCleanupRetryConverges,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeCompleteOrphanLiveSet(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "orphanLiveSetPreservesAllGenerations"
		| "orphanUnreferencedCandidatesDeletedAfterValidation"
		| "orphanUnknownLegacyFilePreserved"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-orphan-live-set-project`;
	const database = mediaDatabaseName({ identity: storageIdentity, projectId });
	const authorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const currentKey = "current-sidecar";
	const currentBodyKey = ".c5-body-current-live";
	const inlineKey = "inline-envelope";
	const inlineBodyKey = ".c5-stage-inline-live";
	const rawKey = ".c5-body-raw-live";
	const stageCandidate = ".c5-stage-unreferenced";
	const bodyCandidate = ".c5-body-unreferenced";
	const unknownLegacyFile = "provider-unknown-file";
	const scope = { kind: "project", projectId } as const;
	const bodies = new Map<string, ArrayBuffer>([
		[currentBodyKey, new Uint8Array([91]).buffer],
		[inlineBodyKey, new Uint8Array([92]).buffer],
		[rawKey, new Uint8Array([93]).buffer],
		[stageCandidate, new Uint8Array([94]).buffer],
		[bodyCandidate, new Uint8Array([95]).buffer],
		[unknownLegacyFile, new Uint8Array([96]).buffer],
	]);
	try {
		await store.prepareForSession();
		await store.listAttachments({ projectId });
		const currentBody = bodies.get(currentBodyKey)!;
		const current = createCurrentStoredAttachment({
			projectId,
			key: currentKey,
			metadata: { id: currentKey, generation: "current" },
			bodyKey: currentBodyKey,
			mutationId: ".c5-orphan-current-mutation",
			bodyDigest: await digestAttachmentBody(currentBody),
			byteLength: currentBody.byteLength,
		});
		if (current.publicRow === null)
			return {
				orphanLiveSetPreservesAllGenerations: false,
				orphanUnreferencedCandidatesDeletedAfterValidation: false,
				orphanUnknownLegacyFilePreserved: false,
			};
		await idbPut({
			database,
			store: storageIdentity.mediaStore,
			value: current.publicRow,
			context: { operation: "save-attachment", scope },
		});
		await idbPut({
			database,
			store: authorityStore,
			value: current.authorityRow,
			context: { operation: "save-attachment", scope },
		});
		const inlineBody = bodies.get(inlineBodyKey)!;
		await idbPut({
			database,
			store: storageIdentity.mediaStore,
			value: createStoredAttachment({
				projectId,
				key: inlineKey,
				metadata: { id: inlineKey, generation: "inline" },
				bodyKey: inlineBodyKey,
				mutationId: ".c5-orphan-inline-mutation",
				bodyDigest: await digestAttachmentBody(inlineBody),
				byteLength: inlineBody.byteLength,
			}),
			context: { operation: "save-attachment", scope },
		});
		await idbPut({
			database,
			store: storageIdentity.mediaStore,
			value: { id: rawKey, generation: "raw" },
			context: { operation: "save-attachment", scope },
		});
		for (const [key, body] of bodies) {
			await opfsWrite({
				directory,
				key,
				body,
				context: { operation: "save-attachment", scope },
			});
		}

		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({ identity, prefix: args.prefix });
		await reopened.prepareForSession();
		const listed = await reopened.listAttachments({ projectId });
		const files = await Promise.all(
			[
				currentBodyKey,
				inlineBodyKey,
				rawKey,
				stageCandidate,
				bodyCandidate,
				unknownLegacyFile,
			].map(
				async (key) =>
					[
						key,
						await opfsRead({
							directory,
							key,
							context: { operation: "load-attachment", scope },
						}),
					] as const,
			),
		);
		const byKey = new Map(files);
		const listedKeys = listed.map((attachment) => attachment.key).sort();
		const orphanLiveSetPreservesAllGenerations =
			equalStructured({
				left: listedKeys,
				right: [currentKey, inlineKey, rawKey].sort(),
			}) &&
			[currentBodyKey, inlineBodyKey, rawKey].every(
				(key) => byKey.get(key) !== null,
			);
		return {
			orphanLiveSetPreservesAllGenerations,
			orphanUnreferencedCandidatesDeletedAfterValidation:
				byKey.get(stageCandidate) === null && byKey.get(bodyCandidate) === null,
			orphanUnknownLegacyFilePreserved: byKey.get(unknownLegacyFile) !== null,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeOrphanRetiredIntent(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "orphanLiveRetiredIntentShrinksOnReopen"
		| "orphanDeletionRetiredIntentShrinksOnReopen"
		| "orphanRetiredIntentRetryConverges"
	>
> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-retired-intent-project`;
	const database = mediaDatabaseName({ identity: storageIdentity, projectId });
	const authorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const liveKey = "live-retired-intent";
	const liveBodyKey = ".c5-body-live-retired-intent";
	const liveCleanedKey = "provider-live-retired-cleaned";
	const liveFailedKey = "provider-live-retired-failed";
	const deletedKey = "deleted-retired-intent";
	const deletedCleanedKey = "provider-deleted-retired-cleaned";
	const deletedFailedKey = "provider-deleted-retired-failed";
	const scope = { kind: "project", projectId } as const;
	try {
		await store.prepareForSession();
		await store.listAttachments({ projectId });
		const liveBody = new Uint8Array([101, 102]).buffer;
		const live = createCurrentStoredAttachment({
			projectId,
			key: liveKey,
			metadata: { id: liveKey, marker: "live-retired" },
			bodyKey: liveBodyKey,
			mutationId: ".c5-live-retired-mutation",
			bodyDigest: await digestAttachmentBody(liveBody),
			byteLength: liveBody.byteLength,
			retiredBodyKeys: [liveCleanedKey, liveFailedKey],
		});
		if (live.publicRow === null) {
			return {
				orphanLiveRetiredIntentShrinksOnReopen: false,
				orphanDeletionRetiredIntentShrinksOnReopen: false,
				orphanRetiredIntentRetryConverges: false,
			};
		}
		await idbPut({
			database,
			store: storageIdentity.mediaStore,
			value: live.publicRow,
			context: { operation: "save-attachment", scope },
		});
		await idbPut({
			database,
			store: authorityStore,
			value: live.authorityRow,
			context: { operation: "save-attachment", scope },
		});
		const deleted = createCurrentStoredAttachmentTombstone({
			projectId,
			key: deletedKey,
			mutationId: ".c5-deleted-retired-mutation",
			retiredBodyKeys: [deletedCleanedKey, deletedFailedKey],
		});
		await idbPut({
			database,
			store: authorityStore,
			value: deleted.authorityRow,
			context: { operation: "remove-attachment", scope },
		});
		for (const [key, byte] of [
			[liveBodyKey, 103],
			[liveCleanedKey, 104],
			[liveFailedKey, 105],
			[deletedCleanedKey, 106],
			[deletedFailedKey, 107],
		] as const) {
			await opfsWrite({
				directory,
				key,
				body: key === liveBodyKey ? liveBody : new Uint8Array([byte]).buffer,
				context: { operation: "save-attachment", scope },
			});
		}

		resetBrowserProjectStoreRuntimeForTests();
		const firstReopen = await withOpfsRemoveFailure({
			key: [liveFailedKey, deletedFailedKey],
			run: async () => {
				const reopened = disposableStore({ identity, prefix: args.prefix });
				await reopened.prepareForSession();
			},
		});
		const [
			liveAfterPartial,
			deletedAfterPartial,
			liveCleanedBody,
			deletedCleanedBody,
		] = await Promise.all([
			rawRow({
				database,
				store: authorityStore,
				key: liveKey,
				operation: "load-attachment",
				projectId,
			}),
			rawRow({
				database,
				store: authorityStore,
				key: deletedKey,
				operation: "load-attachment",
				projectId,
			}),
			opfsRead({
				directory,
				key: liveCleanedKey,
				context: { operation: "load-attachment", scope },
			}),
			opfsRead({
				directory,
				key: deletedCleanedKey,
				context: { operation: "load-attachment", scope },
			}),
		]);
		const orphanLiveRetiredIntentShrinksOnReopen =
			firstReopen.completed &&
			isRecord(liveAfterPartial) &&
			equalStructured({
				left: liveAfterPartial.retiredBodyKeys,
				right: [liveFailedKey],
			}) &&
			liveCleanedBody === null;
		const orphanDeletionRetiredIntentShrinksOnReopen =
			firstReopen.completed &&
			isRecord(deletedAfterPartial) &&
			deletedAfterPartial.kind === "deleted" &&
			equalStructured({
				left: deletedAfterPartial.retiredBodyKeys,
				right: [deletedFailedKey],
			}) &&
			deletedCleanedBody === null;

		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({ identity, prefix: args.prefix });
		await reopened.prepareForSession();
		const [
			liveAfterRetry,
			deletedAfterRetry,
			liveFailedBodyAfterRetry,
			deletedFailedBodyAfterRetry,
			logicalLive,
			logicalDeleted,
		] = await Promise.all([
			rawRow({
				database,
				store: authorityStore,
				key: liveKey,
				operation: "load-attachment",
				projectId,
			}),
			rawRow({
				database,
				store: authorityStore,
				key: deletedKey,
				operation: "load-attachment",
				projectId,
			}),
			opfsRead({
				directory,
				key: liveFailedKey,
				context: { operation: "load-attachment", scope },
			}),
			opfsRead({
				directory,
				key: deletedFailedKey,
				context: { operation: "load-attachment", scope },
			}),
			reopened.loadAttachment({ projectId, key: liveKey }),
			reopened.loadAttachment({ projectId, key: deletedKey }),
		]);
		const orphanRetiredIntentRetryConverges =
			isRecord(liveAfterRetry) &&
			Array.isArray(liveAfterRetry.retiredBodyKeys) &&
			liveAfterRetry.retiredBodyKeys.length === 0 &&
			deletedAfterRetry === null &&
			liveFailedBodyAfterRetry === null &&
			deletedFailedBodyAfterRetry === null &&
			logicalLive !== null &&
			logicalDeleted === null;
		return {
			orphanLiveRetiredIntentShrinksOnReopen,
			orphanDeletionRetiredIntentShrinksOnReopen,
			orphanRetiredIntentRetryConverges,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeOrphanDatabaseIsolation(args: {
	prefix: string;
}): Promise<
	Pick<
		BrowserResidualProbeResult,
		| "orphanMalformedPairsFailClosedPerDatabase"
		| "orphanCorruptDiagnosticIsMechanismNeutral"
		| "orphanIndependentDatabaseStillCleans"
		| "orphanLegacyOnlyDatabaseCompatible"
	>
> {
	type Diagnostic = Parameters<
		NonNullable<BrowserProjectStoreOptions["diagnostic"]>
	>[0];
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const authorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const invalidProjects = {
		malformed: `${identity}-orphan-malformed`,
		half: `${identity}-orphan-half`,
		mismatched: `${identity}-orphan-mismatched`,
	} as const;
	const validProjectId = `${identity}-orphan-valid`;
	const legacyProjectId = `${identity}-orphan-legacy-only`;
	const allProjectIds = [
		...Object.values(invalidProjects),
		validProjectId,
		legacyProjectId,
	];
	const database = (projectId: string) =>
		mediaDatabaseName({ identity: storageIdentity, projectId });
	const directory = (projectId: string) =>
		mediaDirectoryName({ identity: storageIdentity, projectId });
	const context = (projectId: string) => ({
		operation: "save-attachment" as const,
		scope: { kind: "project" as const, projectId },
	});
	const writeCurrentPair = async (args: {
		projectId: string;
		key: string;
		bodyKey: string;
		authorityTransform?(
			value: Record<string, unknown>,
		): Record<string, unknown>;
		publicPresent?: boolean;
	}): Promise<void> => {
		const body = new Uint8Array([111]).buffer;
		const current = createCurrentStoredAttachment({
			projectId: args.projectId,
			key: args.key,
			metadata: { id: args.key, marker: args.projectId },
			bodyKey: args.bodyKey,
			mutationId: `.c5-${args.key}-mutation`,
			bodyDigest: await digestAttachmentBody(body),
			byteLength: body.byteLength,
		});
		if (current.publicRow === null)
			throw new Error("fixture public row missing");
		if (args.publicPresent !== false) {
			await idbPut({
				database: database(args.projectId),
				store: storageIdentity.mediaStore,
				value: current.publicRow,
				context: context(args.projectId),
			});
		}
		await idbPut({
			database: database(args.projectId),
			store: authorityStore,
			value: args.authorityTransform
				? args.authorityTransform(current.authorityRow)
				: current.authorityRow,
			context: context(args.projectId),
		});
		await opfsWrite({
			directory: directory(args.projectId),
			key: args.bodyKey,
			body,
			context: context(args.projectId),
		});
	};
	const invalidFiles = new Map<string, readonly string[]>();
	try {
		await store.prepareForSession();
		for (const projectId of allProjectIds) {
			await store.listAttachments({ projectId });
		}

		await writeCurrentPair({
			projectId: invalidProjects.malformed,
			key: "malformed-current",
			bodyKey: ".c5-body-malformed-live",
			authorityTransform: (value) => ({ ...value, unexpected: true }),
		});
		await writeCurrentPair({
			projectId: invalidProjects.half,
			key: "authority-only-current",
			bodyKey: ".c5-body-half-live",
			publicPresent: false,
		});
		await writeCurrentPair({
			projectId: invalidProjects.mismatched,
			key: "mismatched-current",
			bodyKey: ".c5-body-mismatched-live",
			authorityTransform: (value) => ({
				...value,
				projectId: `${invalidProjects.mismatched}-other`,
			}),
		});
		for (const projectId of Object.values(invalidProjects)) {
			const files = [
				`.c5-stage-${projectId.slice(-10)}-must-survive`,
				`.c5-body-${projectId.slice(-10)}-must-survive`,
			] as const;
			invalidFiles.set(projectId, files);
			for (const [index, key] of files.entries()) {
				await opfsWrite({
					directory: directory(projectId),
					key,
					body: new Uint8Array([112 + index]).buffer,
					context: context(projectId),
				});
			}
		}

		const validBodyKey = ".c5-body-independent-live";
		const validCandidate = ".c5-stage-independent-orphan";
		await writeCurrentPair({
			projectId: validProjectId,
			key: "independent-current",
			bodyKey: validBodyKey,
		});
		await opfsWrite({
			directory: directory(validProjectId),
			key: validCandidate,
			body: new Uint8Array([114]).buffer,
			context: context(validProjectId),
		});

		const legacyLiveKey = ".c5-stage-legacy-live";
		const legacyCandidate = ".c5-body-legacy-orphan";
		const legacyUnknown = "legacy-provider-unknown";
		await idbPut({
			database: database(legacyProjectId),
			store: storageIdentity.mediaStore,
			value: { id: legacyLiveKey, marker: "legacy-only" },
			context: context(legacyProjectId),
		});
		for (const [key, byte] of [
			[legacyLiveKey, 115],
			[legacyCandidate, 116],
			[legacyUnknown, 117],
		] as const) {
			await opfsWrite({
				directory: directory(legacyProjectId),
				key,
				body: new Uint8Array([byte]).buffer,
				context: context(legacyProjectId),
			});
		}

		const diagnostics: Diagnostic[] = [];
		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({
			identity,
			prefix: args.prefix,
			diagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		await reopened.prepareForSession();
		const invalidFileStates = await Promise.all(
			[...invalidFiles].flatMap(([projectId, files]) =>
				files.map(async (key) =>
					opfsRead({
						directory: directory(projectId),
						key,
						context: {
							operation: "load-attachment",
							scope: { kind: "project", projectId },
						},
					}),
				),
			),
		);
		const [
			validLive,
			validOrphan,
			legacyLive,
			legacyOrphan,
			legacyUnknownBody,
		] = await Promise.all([
			opfsRead({
				directory: directory(validProjectId),
				key: validBodyKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "project", projectId: validProjectId },
				},
			}),
			opfsRead({
				directory: directory(validProjectId),
				key: validCandidate,
				context: {
					operation: "load-attachment",
					scope: { kind: "project", projectId: validProjectId },
				},
			}),
			opfsRead({
				directory: directory(legacyProjectId),
				key: legacyLiveKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "project", projectId: legacyProjectId },
				},
			}),
			opfsRead({
				directory: directory(legacyProjectId),
				key: legacyCandidate,
				context: {
					operation: "load-attachment",
					scope: { kind: "project", projectId: legacyProjectId },
				},
			}),
			opfsRead({
				directory: directory(legacyProjectId),
				key: legacyUnknown,
				context: {
					operation: "load-attachment",
					scope: { kind: "project", projectId: legacyProjectId },
				},
			}),
		]);
		const corruptDiagnostics = diagnostics.filter(
			(diagnostic) =>
				diagnostic.phase === "attachment-orphan-scan" &&
				diagnostic.code === "corrupt",
		);
		const forbiddenPhysicalNames = [
			storageIdentity.projectsDatabase,
			storageIdentity.libraryDatabase,
			storageIdentity.mediaDatabasePrefix,
			storageIdentity.mediaDirectoryPrefix,
			storageIdentity.mediaStore,
			authorityStore,
			...[...invalidFiles.values()].flatMap((files) => [...files]),
		];
		return {
			orphanMalformedPairsFailClosedPerDatabase: invalidFileStates.every(
				(body) => body !== null,
			),
			orphanCorruptDiagnosticIsMechanismNeutral:
				corruptDiagnostics.length === 3 &&
				corruptDiagnostics.every((diagnostic) => {
					const encoded = JSON.stringify(diagnostic);
					return (
						diagnostic.operation === "list-attachments" &&
						diagnostic.retryable === true &&
						forbiddenPhysicalNames.every((name) => !encoded.includes(name))
					);
				}),
			orphanIndependentDatabaseStillCleans:
				validLive !== null && validOrphan === null,
			orphanLegacyOnlyDatabaseCompatible:
				legacyLive !== null &&
				legacyOrphan === null &&
				legacyUnknownBody !== null &&
				(await reopened.loadAttachment({
					projectId: legacyProjectId,
					key: legacyLiveKey,
				})) !== null,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

async function probeFailClosedOrphanBridge(args: {
	prefix: string;
	malformed: boolean;
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const store = disposableStore({ identity, prefix: args.prefix });
	const projectId = `${identity}-project`;
	const key = "current-media";
	const body = new Uint8Array([41, 42, 43]).buffer;
	const database = mediaDatabaseName({ identity: storageIdentity, projectId });
	const authorityStore = attachmentAuthorityStoreName(
		storageIdentity.mediaStore,
	);
	const directory = mediaDirectoryName({
		identity: storageIdentity,
		projectId,
	});
	const orphanKey = ".c5-body-malformed-authority-must-survive";
	try {
		await store.prepareForSession();
		await store.save({
			record: {
				id: projectId,
				schemaVersion: store.schemaVersion,
				data: { version: store.schemaVersion, scenes: [] },
			},
			summary: {
				id: projectId,
				name: "Orphan bridge",
				createdAt: "2026-08-02T00:00:00.000Z",
				updatedAt: "2026-08-02T00:00:01.000Z",
			},
		});
		await store.saveAttachment({
			projectId,
			key,
			metadata: { id: key, marker: "current" },
			body,
		});
		const authority = await rawRow({
			database,
			store: authorityStore,
			key,
			operation: "load-attachment",
			projectId,
		});
		if (!isRecord(authority) || typeof authority.bodyKey !== "string") {
			return false;
		}
		const bodyKey = authority.bodyKey;
		if (args.malformed) {
			await idbPut({
				database,
				store: authorityStore,
				value: { ...authority, malformed: true },
				context: {
					operation: "save-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
			await opfsWrite({
				directory,
				key: orphanKey,
				body: new Uint8Array([51]).buffer,
				context: {
					operation: "save-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
		}
		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({ identity, prefix: args.prefix });
		await reopened.prepareForSession();
		const currentBody = await opfsRead({
			directory,
			key: bodyKey,
			context: {
				operation: "load-attachment",
				scope: { kind: "attachment", projectId, key },
			},
		});
		if (args.malformed) {
			const orphanBody = await opfsRead({
				directory,
				key: orphanKey,
				context: {
					operation: "load-attachment",
					scope: { kind: "attachment", projectId, key },
				},
			});
			return currentBody !== null && orphanBody !== null;
		}
		const logical = await reopened.loadAttachment({ projectId, key });
		return (
			currentBody !== null &&
			logical !== null &&
			equalBytes({ left: logical.body, right: body })
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
	}
}

export async function runBrowserProjectStoreResidualProbes(): Promise<BrowserResidualProbeResult> {
	const prefix = `opencut-c5-residual-${crypto.randomUUID()}-`;
	const corrupt = await probeCorruptRows({ prefix });
	const authorityOnlyLiveAttachment = await probeAuthorityOnlyLiveAttachment({
		prefix,
	});
	const midFlightReadAbortCount = await probeMidFlightReadAbort({ prefix });
	const postOpenCommitAborts = await probePostOpenCommitAborts({ prefix });
	const ordinaryPairs = await probeOrdinaryPairs({ prefix });
	const projectClearPairs = await probeProjectClearPairs({ prefix });
	const partialDeletionCleanup = await probePartialDeletionCleanup({ prefix });
	const completeOrphanLiveSet = await probeCompleteOrphanLiveSet({ prefix });
	const orphanRetiredIntent = await probeOrphanRetiredIntent({ prefix });
	const orphanDatabaseIsolation = await probeOrphanDatabaseIsolation({
		prefix,
	});
	const reopenPreservesCurrentBody = await probeFailClosedOrphanBridge({
		prefix,
		malformed: false,
	});
	const malformedAuthoritySkipsOrphanDeletion =
		await probeFailClosedOrphanBridge({ prefix, malformed: true });
	return {
		...corrupt,
		...authorityOnlyLiveAttachment,
		midFlightReadAbortCount,
		midFlightReadsAborted: midFlightReadAbortCount === 7,
		...postOpenCommitAborts,
		...ordinaryPairs,
		...projectClearPairs,
		...partialDeletionCleanup,
		...completeOrphanLiveSet,
		...orphanRetiredIntent,
		...orphanDatabaseIsolation,
		reopenPreservesCurrentBody,
		malformedAuthoritySkipsOrphanDeletion,
	};
}
