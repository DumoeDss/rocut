import {
	mapBrowserStoreError,
	throwIfBrowserStoreAborted,
	type BrowserStorageIdentity,
} from "./browser-project-store-internals";
import type {
	ProjectStoreErrorScope,
	ProjectStoreOperation,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";

interface MechanismContext {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
}

export interface IdbStoredRowPair {
	readonly key: IDBValidKey;
	readonly publicRow: unknown | null;
	readonly authorityRow: unknown | null;
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error);
		transaction.onerror = () => reject(transaction.error);
	});
}

async function openDatabase(args: {
	database: string;
	store: string;
}): Promise<IDBDatabase> {
	return openDatabaseStores({ database: args.database, stores: [args.store] });
}

async function openDatabaseStores(args: {
	database: string;
	stores: readonly string[];
}): Promise<IDBDatabase> {
	const open = (version?: number): Promise<IDBDatabase> =>
		new Promise((resolve, reject) => {
			let blocked = false;
			const request =
				version === undefined
					? indexedDB.open(args.database)
					: indexedDB.open(args.database, version);
			request.onupgradeneeded = () => {
				const db = request.result;
				for (const store of args.stores) {
					if (!db.objectStoreNames.contains(store)) {
						db.createObjectStore(store, { keyPath: "id" });
					}
				}
			};
			request.onsuccess = () => {
				if (blocked) {
					request.result.close();
					return;
				}
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => {
				blocked = true;
				reject(new DOMException("blocked", "InvalidStateError"));
			};
		});

	let database = await open();
	if (args.stores.every((store) => database.objectStoreNames.contains(store))) {
		return database;
	}
	const nextVersion = database.version + 1;
	database.close();
	try {
		database = await open(nextVersion);
	} catch (error) {
		if (error instanceof DOMException && error.name === "VersionError") {
			database = await open();
		} else {
			throw error;
		}
	}
	if (args.stores.some((store) => !database.objectStoreNames.contains(store))) {
		database.close();
		throw new DOMException("object store unavailable", "InvalidStateError");
	}
	return database;
}

async function withStore<Result>(args: {
	database: string;
	store: string;
	mode: IDBTransactionMode;
	run(store: IDBObjectStore): IDBRequest<Result> | Result;
}): Promise<Result> {
	const database = await openDatabase(args);
	try {
		const transaction = database.transaction(args.store, args.mode);
		const result = args.run(transaction.objectStore(args.store));
		const value =
			result instanceof IDBRequest ? await requestResult(result) : result;
		await transactionDone(transaction);
		return value;
	} finally {
		database.close();
	}
}

async function mechanism<Result>(args: {
	context: MechanismContext;
	run(): Promise<Result>;
}): Promise<Result> {
	try {
		return await args.run();
	} catch (error) {
		throw mapBrowserStoreError({ error, ...args.context });
	}
}

export async function idbGet<Value>(args: {
	database: string;
	store: string;
	key: string;
	context: MechanismContext;
}): Promise<Value | null> {
	return mechanism({
		context: args.context,
		run: async () =>
			(await withStore<Value | undefined>({
				database: args.database,
				store: args.store,
				mode: "readonly",
				run: (store) => store.get(args.key),
			})) ?? null,
	});
}

export async function idbGetAll<Value>(args: {
	database: string;
	store: string;
	context: MechanismContext;
}): Promise<Value[]> {
	return mechanism({
		context: args.context,
		run: () =>
			withStore<Value[]>({
				database: args.database,
				store: args.store,
				mode: "readonly",
				run: (store) => store.getAll(),
			}),
	});
}

export async function idbGetProjectPair(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	key: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair> {
	return getStoredRowPair({
		database: args.database,
		publicStore: args.projectStore,
		authorityStore: args.authorityStore,
		key: args.key,
		context: args.context,
	});
}

export async function idbGetAllProjectPairs(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair[]> {
	return getAllStoredRowPairs({
		database: args.database,
		publicStore: args.projectStore,
		authorityStore: args.authorityStore,
		context: args.context,
	});
}

export async function idbGetAttachmentPair(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	key: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair> {
	return getStoredRowPair({
		database: args.database,
		publicStore: args.mediaStore,
		authorityStore: args.authorityStore,
		key: args.key,
		context: args.context,
	});
}

export async function idbGetAllAttachmentPairs(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair[]> {
	return getAllStoredRowPairs({
		database: args.database,
		publicStore: args.mediaStore,
		authorityStore: args.authorityStore,
		context: args.context,
	});
}

async function getStoredRowPair(args: {
	database: string;
	publicStore: string;
	authorityStore: string;
	key: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair> {
	return mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.publicStore, args.authorityStore],
			});
			try {
				const transaction = database.transaction(
					[args.publicStore, args.authorityStore],
					"readonly",
				);
				const completion = transactionDone(transaction);
				try {
					const [publicRow, authorityRow] = await Promise.all([
						requestResult<unknown>(
							transaction.objectStore(args.publicStore).get(args.key),
						),
						requestResult<unknown>(
							transaction.objectStore(args.authorityStore).get(args.key),
						),
					]);
					await completion;
					return {
						key: args.key,
						publicRow: publicRow ?? null,
						authorityRow: authorityRow ?? null,
					};
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

async function getAllStoredRowPairs(args: {
	database: string;
	publicStore: string;
	authorityStore: string;
	context: MechanismContext;
}): Promise<IdbStoredRowPair[]> {
	return mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.publicStore, args.authorityStore],
			});
			try {
				const transaction = database.transaction(
					[args.publicStore, args.authorityStore],
					"readonly",
				);
				const completion = transactionDone(transaction);
				try {
					const publicStore = transaction.objectStore(args.publicStore);
					const authorityStore = transaction.objectStore(args.authorityStore);
					const [publicRows, publicKeys, authorityRows, authorityKeys] =
						await Promise.all([
							requestResult<unknown[]>(publicStore.getAll()),
							requestResult<IDBValidKey[]>(publicStore.getAllKeys()),
							requestResult<unknown[]>(authorityStore.getAll()),
							requestResult<IDBValidKey[]>(authorityStore.getAllKeys()),
						]);
					await completion;
					return pairStoredRows({
						publicRows,
						publicKeys,
						authorityRows,
						authorityKeys,
					});
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

function pairStoredRows(args: {
	publicRows: readonly unknown[];
	publicKeys: readonly IDBValidKey[];
	authorityRows: readonly unknown[];
	authorityKeys: readonly IDBValidKey[];
}): IdbStoredRowPair[] {
	const authorityUsed = new Set<number>();
	const pairs = args.publicRows.map((publicRow, publicIndex) => {
		const authorityIndex = args.authorityKeys.findIndex(
			(key, index) =>
				!authorityUsed.has(index) &&
				indexedDB.cmp(key, args.publicKeys[publicIndex]) === 0,
		);
		if (authorityIndex < 0) {
			return {
				key: args.publicKeys[publicIndex],
				publicRow,
				authorityRow: null,
			};
		}
		authorityUsed.add(authorityIndex);
		return {
			key: args.publicKeys[publicIndex],
			publicRow,
			authorityRow: args.authorityRows[authorityIndex],
		};
	});
	for (let index = 0; index < args.authorityRows.length; index += 1) {
		if (authorityUsed.has(index)) continue;
		pairs.push({
			key: args.authorityKeys[index],
			publicRow: null,
			authorityRow: args.authorityRows[index],
		});
	}
	return pairs;
}

async function commitStoredRowPair(args: {
	database: string;
	publicStore: string;
	authorityStore: string;
	publicMutation:
		| { readonly kind: "put"; readonly value: Record<string, unknown> }
		| { readonly kind: "delete"; readonly key: string };
	authority: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.publicStore, args.authorityStore],
			});
			try {
				throwIfBrowserStoreAborted({
					...args.context,
					signal: args.signal,
				});
				const transaction = database.transaction(
					[args.publicStore, args.authorityStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				try {
					const publicStore = transaction.objectStore(args.publicStore);
					if (args.publicMutation.kind === "put") {
						publicStore.put(args.publicMutation.value);
					} else {
						publicStore.delete(args.publicMutation.key);
					}
					transaction.objectStore(args.authorityStore).put(args.authority);
					await completion;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

function abortTransaction(transaction: IDBTransaction): void {
	try {
		transaction.abort();
	} catch {
		// The transaction may already have completed or aborted.
	}
}

export async function idbPut(args: {
	database: string;
	store: string;
	value: Record<string, unknown>;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			await withStore<IDBValidKey>({
				database: args.database,
				store: args.store,
				mode: "readwrite",
				run: (store) => store.put(args.value),
			});
		},
	});
}

export async function idbPutMany(args: {
	database: string;
	store: string;
	values: readonly Record<string, unknown>[];
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			await withStore<void>({
				database: args.database,
				store: args.store,
				mode: "readwrite",
				run: (store) => {
					for (const value of args.values) store.put(value);
				},
			});
		},
	});
}

export async function idbDelete(args: {
	database: string;
	store: string;
	key: string;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			await withStore<undefined>({
				database: args.database,
				store: args.store,
				mode: "readwrite",
				run: (store) => store.delete(args.key),
			});
		},
	});
}

export async function idbClear(args: {
	database: string;
	store: string;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			await withStore<undefined>({
				database: args.database,
				store: args.store,
				mode: "readwrite",
				run: (store) => store.clear(),
			});
		},
	});
}

export async function idbCommitProjectSave(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	maintenanceStore: string;
	maintenanceKey: string;
	project: Record<string, unknown>;
	projectAuthority: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.projectStore, args.authorityStore, args.maintenanceStore],
			});
			try {
				throwIfBrowserStoreAborted({
					...args.context,
					signal: args.signal,
				});
				const transaction = database.transaction(
					[args.projectStore, args.authorityStore, args.maintenanceStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				try {
					transaction.objectStore(args.projectStore).put(args.project);
					transaction
						.objectStore(args.authorityStore)
						.put(args.projectAuthority);
					transaction
						.objectStore(args.maintenanceStore)
						.delete(args.maintenanceKey);
					await completion;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

export async function idbCommitAttachment(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	metadata: Record<string, unknown>;
	authority: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await commitStoredRowPair({
		database: args.database,
		publicStore: args.mediaStore,
		authorityStore: args.authorityStore,
		publicMutation: { kind: "put", value: args.metadata },
		authority: args.authority,
		context: args.context,
		signal: args.signal,
	});
}

export async function idbCommitAttachmentRemoval(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	key: string;
	deletionAuthority: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await commitStoredRowPair({
		database: args.database,
		publicStore: args.mediaStore,
		authorityStore: args.authorityStore,
		publicMutation: { kind: "delete", key: args.key },
		authority: args.deletionAuthority,
		context: args.context,
		signal: args.signal,
	});
}

export async function idbResolveAttachmentBodyCleanup(args: {
	database: string;
	mediaStore: string;
	authorityStore: string;
	key: string;
	expectedAuthority: Record<string, unknown>;
	replacementAuthority: Record<string, unknown> | null;
	context: MechanismContext;
}): Promise<boolean> {
	return mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.mediaStore, args.authorityStore],
			});
			try {
				const transaction = database.transaction(
					[args.mediaStore, args.authorityStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				try {
					const mediaStore = transaction.objectStore(args.mediaStore);
					const authorityStore = transaction.objectStore(args.authorityStore);
					const [publicRow, authorityRow] = await Promise.all([
						requestResult<unknown>(mediaStore.get(args.key)),
						requestResult<unknown>(authorityStore.get(args.key)),
					]);
					const expectedKind = isPlainStructuredRecord(args.expectedAuthority)
						? args.expectedAuthority.kind
						: null;
					const publicPresenceMatches =
						expectedKind === "attachment"
							? publicRow !== undefined
							: expectedKind === "deleted"
								? publicRow === undefined
								: false;
					if (
						!publicPresenceMatches ||
						!equalStructuredValues({
							left: authorityRow,
							right: args.expectedAuthority,
						})
					) {
						await completion;
						return false;
					}
					if (args.replacementAuthority === null) {
						authorityStore.delete(args.key);
					} else {
						authorityStore.put(args.replacementAuthority);
					}
					await completion;
					return true;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

export async function idbCommitProjectRemoval(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	maintenanceStore: string;
	projectId: string;
	tombstone: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.projectStore, args.authorityStore, args.maintenanceStore],
			});
			try {
				throwIfBrowserStoreAborted({
					...args.context,
					signal: args.signal,
				});
				const transaction = database.transaction(
					[args.projectStore, args.authorityStore, args.maintenanceStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				try {
					transaction.objectStore(args.projectStore).delete(args.projectId);
					transaction.objectStore(args.authorityStore).delete(args.projectId);
					transaction.objectStore(args.maintenanceStore).put(args.tombstone);
					await completion;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

export async function idbCommitProjectsClear(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	maintenanceStore: string;
	maintenanceValues: readonly Record<string, unknown>[];
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	await withProjectMaintenanceTransaction({
		...args,
		signal: args.signal,
		run: ({ projectStore, authorityStore, maintenanceStore }) => {
			projectStore.clear();
			authorityStore.clear();
			maintenanceStore.clear();
			for (const value of args.maintenanceValues) {
				maintenanceStore.put(value);
			}
		},
	});
}

export async function idbCommitProjectsClearWithLibraryBinding(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	maintenanceStore: string;
	bindingStore: string;
	maintenanceValues: readonly Record<string, unknown>[];
	bindingDescriptor: Record<string, unknown>;
	context: MechanismContext;
	signal?: AbortSignal;
}): Promise<void> {
	const descriptorId = args.bindingDescriptor.id;
	if (typeof descriptorId !== "string") {
		throw new ProjectStoreError({ code: "corrupt", ...args.context });
	}
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [
					args.projectStore,
					args.authorityStore,
					args.maintenanceStore,
					args.bindingStore,
				],
			});
			try {
				throwIfBrowserStoreAborted({
					...args.context,
					signal: args.signal,
				});
				const transaction = database.transaction(
					[
						args.projectStore,
						args.authorityStore,
						args.maintenanceStore,
						args.bindingStore,
					],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				const projectStore = transaction.objectStore(args.projectStore);
				const authorityStore = transaction.objectStore(args.authorityStore);
				const maintenanceStore = transaction.objectStore(args.maintenanceStore);
				const bindingStore = transaction.objectStore(args.bindingStore);
				try {
					const currentDescriptor = await requestResult<unknown>(
						bindingStore.get(descriptorId),
					);
					if (
						currentDescriptor !== undefined &&
						!equalStructuredValues({
							left: currentDescriptor,
							right: args.bindingDescriptor,
						})
					) {
						throw new DOMException(
							"library clear binding changed",
							"ConstraintError",
						);
					}
					projectStore.clear();
					authorityStore.clear();
					maintenanceStore.clear();
					for (const value of args.maintenanceValues) {
						maintenanceStore.put(value);
					}
					bindingStore.put(args.bindingDescriptor);
					await completion;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

export async function idbUpgradeCascadeJournalWithLibraryBinding(args: {
	database: string;
	maintenanceStore: string;
	bindingStore: string;
	journalId: string;
	expectedJournal: Record<string, unknown>;
	upgradedJournal: Record<string, unknown>;
	bindingDescriptor: Record<string, unknown>;
	context: MechanismContext;
}): Promise<void> {
	const descriptorId = args.bindingDescriptor.id;
	if (typeof descriptorId !== "string") {
		throw new ProjectStoreError({ code: "corrupt", ...args.context });
	}
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.maintenanceStore, args.bindingStore],
			});
			try {
				const transaction = database.transaction(
					[args.maintenanceStore, args.bindingStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				const maintenanceStore = transaction.objectStore(args.maintenanceStore);
				const bindingStore = transaction.objectStore(args.bindingStore);
				const [currentJournal, currentDescriptor] = await Promise.all([
					requestResult<unknown>(maintenanceStore.get(args.journalId)),
					requestResult<unknown>(bindingStore.get(descriptorId)),
				]);
				if (
					!equalStructuredValues({
						left: currentJournal,
						right: args.expectedJournal,
					}) ||
					(currentDescriptor !== undefined &&
						!equalStructuredValues({
							left: currentDescriptor,
							right: args.bindingDescriptor,
						}))
				) {
					transaction.abort();
					await completion.catch(() => undefined);
					throw new DOMException(
						"cascade journal or binding changed",
						"ConstraintError",
					);
				}
				bindingStore.put(args.bindingDescriptor);
				maintenanceStore.put(args.upgradedJournal);
				await completion;
			} finally {
				database.close();
			}
		},
	});
}

function equalStructuredValues(args: {
	left: unknown;
	right: unknown;
}): boolean {
	if (Object.is(args.left, args.right)) return true;
	if (Array.isArray(args.left) && Array.isArray(args.right)) {
		const left = args.left;
		const right = args.right;
		return (
			left.length === right.length &&
			left.every((value, index) =>
				equalStructuredValues({ left: value, right: right[index] }),
			)
		);
	}
	if (
		!isPlainStructuredRecord(args.left) ||
		!isPlainStructuredRecord(args.right)
	) {
		return false;
	}
	const left = args.left;
	const right = args.right;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] &&
				equalStructuredValues({
					left: left[key],
					right: right[key],
				}),
		)
	);
}

function isPlainStructuredRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function idbDeleteByStringKeyPrefix(args: {
	database: string;
	store: string;
	prefix: string;
	additionalKeys?: readonly string[];
	afterDelete?(deletedKeys: number): void;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabase(args);
			try {
				const transaction = database.transaction(args.store, "readwrite");
				const completion = transactionDone(transaction);
				const additionalKeys = new Set(args.additionalKeys ?? []);
				try {
					await deleteMatchingKeys({
						store: transaction.objectStore(args.store),
						matches: (key) =>
							key.startsWith(args.prefix) || additionalKeys.has(key),
						afterDelete: args.afterDelete,
					});
				} catch (error) {
					transaction.abort();
					await completion.catch(() => undefined);
					throw error;
				}
				await completion;
			} finally {
				database.close();
			}
		},
	});
}

async function withProjectMaintenanceTransaction(args: {
	database: string;
	projectStore: string;
	authorityStore: string;
	maintenanceStore: string;
	context: MechanismContext;
	signal?: AbortSignal;
	run(stores: {
		projectStore: IDBObjectStore;
		authorityStore: IDBObjectStore;
		maintenanceStore: IDBObjectStore;
	}): void;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const database = await openDatabaseStores({
				database: args.database,
				stores: [args.projectStore, args.authorityStore, args.maintenanceStore],
			});
			try {
				throwIfBrowserStoreAborted({
					...args.context,
					signal: args.signal,
				});
				const transaction = database.transaction(
					[args.projectStore, args.authorityStore, args.maintenanceStore],
					"readwrite",
				);
				const completion = transactionDone(transaction);
				try {
					args.run({
						projectStore: transaction.objectStore(args.projectStore),
						authorityStore: transaction.objectStore(args.authorityStore),
						maintenanceStore: transaction.objectStore(args.maintenanceStore),
					});
					await completion;
				} catch (error) {
					abortTransaction(transaction);
					await completion.catch(() => undefined);
					throw error;
				}
			} finally {
				database.close();
			}
		},
	});
}

async function deleteMatchingKeys(args: {
	store: IDBObjectStore;
	matches(key: string): boolean;
	afterDelete?(deletedKeys: number): void;
}): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		let deletedKeys = 0;
		const request = args.store.openCursor();
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve();
				return;
			}
			const key = cursor.primaryKey;
			if (typeof key === "string" && args.matches(key)) {
				let deletion: IDBRequest<undefined>;
				try {
					deletion = cursor.delete();
				} catch (error) {
					reject(error);
					return;
				}
				deletion.onerror = () => reject(deletion.error);
				deletion.onsuccess = () => {
					deletedKeys += 1;
					try {
						args.afterDelete?.(deletedKeys);
						cursor.continue();
					} catch (error) {
						reject(error);
					}
				};
				return;
			}
			cursor.continue();
		};
	});
}

export type DatabaseNameInventory =
	| { readonly kind: "available"; readonly names: readonly string[] }
	| { readonly kind: "unsupported" };

export async function inspectDatabaseNames(): Promise<DatabaseNameInventory> {
	if (typeof indexedDB.databases !== "function") return { kind: "unsupported" };
	return {
		kind: "available",
		names: (await indexedDB.databases())
			.map((database) => database.name)
			.filter((name): name is string => typeof name === "string"),
	};
}

export async function listDatabaseNames(): Promise<string[]> {
	const inventory = await inspectDatabaseNames();
	if (inventory.kind === "unsupported") {
		throw new DOMException(
			"database enumeration unsupported",
			"NotSupportedError",
		);
	}
	return [...inventory.names];
}

export async function deleteDatabaseExact(name: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () =>
			reject(new DOMException("blocked", "InvalidStateError"));
	});
}

async function rootDirectory(): Promise<FileSystemDirectoryHandle> {
	if (
		!navigator.storage ||
		typeof navigator.storage.getDirectory !== "function"
	) {
		throw new DOMException(
			"origin private storage unavailable",
			"NotSupportedError",
		);
	}
	return navigator.storage.getDirectory();
}

async function mediaDirectory(args: {
	directory: string;
	create: boolean;
}): Promise<FileSystemDirectoryHandle | null> {
	try {
		return await (
			await rootDirectory()
		).getDirectoryHandle(args.directory, {
			create: args.create,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "NotFoundError")
			return null;
		throw error;
	}
}

export async function opfsWrite(args: {
	directory: string;
	key: string;
	body: ArrayBuffer;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const directory = await mediaDirectory({
				directory: args.directory,
				create: true,
			});
			if (!directory)
				throw new DOMException("directory unavailable", "NotFoundError");
			const handle = await directory.getFileHandle(args.key, { create: true });
			const writable = await handle.createWritable();
			try {
				await writable.write(args.body);
				await writable.close();
			} catch (error) {
				await writable.abort().catch(() => undefined);
				throw error;
			}
		},
	});
}

export async function opfsRead(args: {
	directory: string;
	key: string;
	context: MechanismContext;
}): Promise<ArrayBuffer | null> {
	return mechanism({
		context: args.context,
		run: async () => {
			const directory = await mediaDirectory({
				directory: args.directory,
				create: false,
			});
			if (!directory) return null;
			try {
				const handle = await directory.getFileHandle(args.key);
				return await (await handle.getFile()).arrayBuffer();
			} catch (error) {
				if (error instanceof DOMException && error.name === "NotFoundError")
					return null;
				throw error;
			}
		},
	});
}

export async function opfsRemove(args: {
	directory: string;
	key: string;
	context: MechanismContext;
}): Promise<void> {
	await mechanism({
		context: args.context,
		run: async () => {
			const directory = await mediaDirectory({
				directory: args.directory,
				create: false,
			});
			if (!directory) return;
			try {
				await directory.removeEntry(args.key);
			} catch (error) {
				if (!(error instanceof DOMException) || error.name !== "NotFoundError")
					throw error;
			}
		},
	});
}

export async function listRootEntries(): Promise<string[]> {
	const names: string[] = [];
	for await (const name of (await rootDirectory()).keys()) names.push(name);
	return names;
}

export async function listOpfsFiles(directoryName: string): Promise<string[]> {
	const directory = await mediaDirectory({
		directory: directoryName,
		create: false,
	});
	if (!directory) return [];
	const names: string[] = [];
	for await (const name of directory.keys()) names.push(name);
	return names;
}

export async function removeRootDirectoryExact(name: string): Promise<void> {
	try {
		await (await rootDirectory()).removeEntry(name, { recursive: true });
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "NotFoundError")
			throw error;
	}
}

export async function inventoryForIdentity(
	identity: BrowserStorageIdentity,
): Promise<{
	databases: string[];
	directories: string[];
}> {
	const databases = (await listDatabaseNames()).filter(
		(name) =>
			name === identity.projectsDatabase ||
			name === identity.libraryDatabase ||
			name.startsWith(identity.mediaDatabasePrefix),
	);
	const directories = (await listRootEntries()).filter((name) =>
		name.startsWith(identity.mediaDirectoryPrefix),
	);
	return { databases: databases.sort(), directories: directories.sort() };
}
