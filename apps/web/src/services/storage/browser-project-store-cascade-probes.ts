import { ProjectStoreError } from "@/editor/ports";

import type { BrowserStoreDiagnostic } from "./browser-project-store-internals";
import {
	createDisposableBrowserStorageIdentity,
	type BrowserStorageIdentity,
} from "./browser-project-store-internals";
import {
	BrowserProjectStore,
	resetBrowserProjectStoreRuntimeForTests,
} from "./browser-project-store";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
import {
	cleanupDisposableBrowserStorage,
	inspectDisposableBrowserStorage,
} from "./browser-project-store-conformance";

export interface BrowserCascadeProbeResult {
	readonly removeCommitRecoverable: boolean;
	readonly clearCommitRecoverable: boolean;
	readonly retryAcrossRuntimeReset: boolean;
	readonly diagnosticPayloadFree: boolean;
	readonly wrappersSerializeSameKeySave: boolean;
	readonly wrappersSerializeReplaceRemove: boolean;
	readonly wrappersSerializeProjectRemove: boolean;
	readonly wrappersSerializeProjectsClear: boolean;
	readonly wrappersSerializeAllClear: boolean;
	readonly cleanupProof: readonly string[];
}

export async function runBrowserProjectStoreCascadeProbes(): Promise<BrowserCascadeProbeResult> {
	const prefix = "c5-cascade-";
	const cleanupProof: string[] = [];
	const remove = await probeRecoverableRemove({ prefix, cleanupProof });
	const clear = await probeRecoverableClear({ prefix, cleanupProof });
	const wrappersSerializeSameKeySave = await probeSameKeySave({
		prefix,
		cleanupProof,
	});
	const wrappersSerializeReplaceRemove = await probeReplaceRemove({
		prefix,
		cleanupProof,
	});
	const wrappersSerializeProjectRemove = await probeProjectRemove({
		prefix,
		cleanupProof,
	});
	const wrappersSerializeProjectsClear = await probeClearRace({
		prefix,
		cleanupProof,
		scope: "projects",
	});
	const wrappersSerializeAllClear = await probeClearRace({
		prefix,
		cleanupProof,
		scope: "all",
	});
	return {
		removeCommitRecoverable: remove.commitRecoverable,
		clearCommitRecoverable: clear.commitRecoverable,
		retryAcrossRuntimeReset: remove.retried && clear.retried,
		diagnosticPayloadFree: remove.diagnosticSafe && clear.diagnosticSafe,
		wrappersSerializeSameKeySave,
		wrappersSerializeReplaceRemove,
		wrappersSerializeProjectRemove,
		wrappersSerializeProjectsClear,
		wrappersSerializeAllClear,
		cleanupProof,
	};
}

async function probeRecoverableRemove(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{
	commitRecoverable: boolean;
	retried: boolean;
	diagnosticSafe: boolean;
}> {
	const fixture = createFixture(args.prefix);
	const projectId = `${fixture.identity}-remove`;
	const control = new BrowserProjectStoreControl();
	const diagnostics: BrowserStoreDiagnostic[] = [];
	const store = createStore({
		storageIdentity: fixture.storageIdentity,
		control,
		diagnostics,
	});
	try {
		await seedProjectTree({ store, projectId, byte: 1 });
		control.failCascadeCleanupAfter({
			operation: "remove-project",
			afterCompletedTargets: 1,
			code: "unavailable",
		});
		let rejected = false;
		try {
			await store.remove({ id: projectId });
		} catch {
			rejected = true;
		}
		const projectAfterCommit = await store.load({ id: projectId });
		const cleanupDiagnostic = diagnostics.find(
			(item) => item.phase === "project-cascade-postcommit-cleanup",
		);
		const commitRecoverable =
			!rejected &&
			projectAfterCommit === null &&
			cleanupDiagnostic !== undefined;
		const diagnosticSafe =
			cleanupDiagnostic?.retryable === true &&
			diagnosticIsMechanismNeutral({
				diagnostic: cleanupDiagnostic,
				expectedScope: { kind: "project", projectId },
			});

		resetBrowserProjectStoreRuntimeForTests();
		const reopened = createStore({ storageIdentity: fixture.storageIdentity });
		await reopened.list();
		const inventory = await inspectDisposableBrowserStorage({
			identity: fixture.identity,
			prefix: args.prefix,
		});
		return {
			commitRecoverable,
			diagnosticSafe,
			retried:
				(await reopened.load({ id: projectId })) === null &&
				inventory.databases.every(
					(name) =>
						!name.startsWith(fixture.storageIdentity.mediaDatabasePrefix),
				) &&
				inventory.directories.length === 0,
		};
	} finally {
		await cleanupFixture({ ...fixture, prefix: args.prefix });
		args.cleanupProof.push(fixture.identity);
	}
}

async function probeRecoverableClear(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{
	commitRecoverable: boolean;
	retried: boolean;
	diagnosticSafe: boolean;
}> {
	const fixture = createFixture(args.prefix);
	const projectA = `${fixture.identity}-clear-a`;
	const projectB = `${fixture.identity}-clear-b`;
	const control = new BrowserProjectStoreControl();
	const diagnostics: BrowserStoreDiagnostic[] = [];
	const store = createStore({
		storageIdentity: fixture.storageIdentity,
		control,
		diagnostics,
	});
	try {
		await seedProjectTree({ store, projectId: projectA, byte: 2 });
		await seedProjectTree({ store, projectId: projectB, byte: 3 });
		control.failCascadeCleanupAfter({
			operation: "clear",
			afterCompletedTargets: 1,
			code: "unavailable",
		});
		let rejected = false;
		try {
			await store.clear({ scope: { kind: "projects" } });
		} catch {
			rejected = true;
		}
		const projectsAfterCommit = await Promise.all([
			store.load({ id: projectA }),
			store.load({ id: projectB }),
		]);
		const cleanupDiagnostic = diagnostics.find(
			(item) => item.phase === "project-cascade-postcommit-cleanup",
		);
		const commitRecoverable =
			!rejected &&
			projectsAfterCommit.every((project) => project === null) &&
			cleanupDiagnostic !== undefined;
		const diagnosticSafe =
			cleanupDiagnostic?.retryable === true &&
			diagnosticIsMechanismNeutral({
				diagnostic: cleanupDiagnostic,
				expectedScope: { kind: "store" },
			});

		resetBrowserProjectStoreRuntimeForTests();
		const reopened = createStore({ storageIdentity: fixture.storageIdentity });
		await reopened.list();
		const inventory = await inspectDisposableBrowserStorage({
			identity: fixture.identity,
			prefix: args.prefix,
		});
		return {
			commitRecoverable,
			diagnosticSafe,
			retried:
				(await reopened.list()).length === 0 &&
				inventory.databases.every(
					(name) =>
						!name.startsWith(fixture.storageIdentity.mediaDatabasePrefix),
				) &&
				inventory.directories.length === 0,
		};
	} finally {
		await cleanupFixture({ ...fixture, prefix: args.prefix });
		args.cleanupProof.push(fixture.identity);
	}
}

async function probeSameKeySave(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withWrapperFixture({
		...args,
		run: async ({ first, second, firstControl, secondControl, projectId }) => {
			const firstGate = firstControl.pauseNext({
				operation: "save-attachment",
			});
			const earlier = first.saveAttachment({
				projectId,
				key: "same",
				metadata: { order: 1 },
				body: new Uint8Array([1]).buffer,
			});
			await firstGate.entered;
			const secondGate = secondControl.pauseNext({
				operation: "save-attachment",
			});
			const later = second.saveAttachment({
				projectId,
				key: "same",
				metadata: { order: 2 },
				body: new Uint8Array([2]).buffer,
			});
			const overtook = await enteredWithin(secondGate.entered);
			if (overtook) secondGate.release();
			firstGate.release();
			if (!overtook) {
				await secondGate.entered;
				secondGate.release();
			}
			await Promise.all([earlier, later]);
			const stored = await first.loadAttachment({ projectId, key: "same" });
			return !overtook && byteString(stored?.body) === "2";
		},
	});
}

async function probeReplaceRemove(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withWrapperFixture({
		...args,
		run: async ({ first, second, firstControl, secondControl, projectId }) => {
			const firstGate = firstControl.pauseNext({
				operation: "save-attachment",
			});
			const replacing = first.saveAttachment({
				projectId,
				key: "replace-remove",
				metadata: { value: "replacement" },
				body: new Uint8Array([4]).buffer,
			});
			await firstGate.entered;
			const secondGate = secondControl.pauseNext({
				operation: "remove-attachment",
			});
			const removing = second.removeAttachment({
				projectId,
				key: "replace-remove",
			});
			const overtook = await enteredWithin(secondGate.entered);
			if (overtook) secondGate.release();
			firstGate.release();
			if (!overtook) {
				await secondGate.entered;
				secondGate.release();
			}
			await Promise.all([replacing, removing]);
			return (
				!overtook &&
				(await first.loadAttachment({
					projectId,
					key: "replace-remove",
				})) === null
			);
		},
	});
}

async function probeProjectRemove(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	return withWrapperFixture({
		...args,
		run: async ({ first, second, firstControl, secondControl, projectId }) => {
			const firstGate = firstControl.pauseNext({
				operation: "save-attachment",
			});
			const writing = first.saveAttachment({
				projectId,
				key: "remove-race",
				metadata: {},
				body: new Uint8Array([5]).buffer,
			});
			await firstGate.entered;
			const secondGate = secondControl.pauseNext({
				operation: "remove-project",
			});
			const removing = second.remove({ id: projectId });
			const overtook = await enteredWithin(secondGate.entered);
			if (overtook) secondGate.release();
			firstGate.release();
			if (!overtook) {
				await secondGate.entered;
				secondGate.release();
			}
			await Promise.all([writing, removing]);
			const earlierWriteRemoved =
				!overtook &&
				(await first.load({ id: projectId })) === null &&
				(await first.loadAttachment({
					projectId,
					key: "remove-race",
				})) === null;

			await seedProject({ store: first, projectId });
			const removeFirstGate = secondControl.pauseNext({
				operation: "remove-project",
			});
			const removeFirst = second.remove({ id: projectId });
			await removeFirstGate.entered;
			const laterWrite = first
				.saveAttachment({
					projectId,
					key: "after-remove",
					metadata: {},
					body: new Uint8Array([7]).buffer,
				})
				.then(
					() => false,
					(error: unknown) =>
						error instanceof ProjectStoreError && error.code === "conflict",
				);
			const settledBeforeRemove = await enteredWithin(
				laterWrite.then(() => undefined),
			);
			removeFirstGate.release();
			const [, laterWriteRejected] = await Promise.all([
				removeFirst,
				laterWrite,
			]);
			return (
				earlierWriteRemoved &&
				!settledBeforeRemove &&
				laterWriteRejected &&
				(await first.load({ id: projectId })) === null &&
				(await first.loadAttachment({ projectId, key: "after-remove" })) ===
					null
			);
		},
	});
}

async function probeClearRace(args: {
	prefix: string;
	cleanupProof: string[];
	scope: "projects" | "all";
}): Promise<boolean> {
	return withWrapperFixture({
		...args,
		run: async ({ first, second, firstControl, secondControl, projectId }) => {
			const firstGate = firstControl.pauseNext({
				operation: "save-attachment",
			});
			const writing = first.saveAttachment({
				projectId,
				key: `${args.scope}-clear-race`,
				metadata: {},
				body: new Uint8Array([6]).buffer,
			});
			await firstGate.entered;
			const secondGate = secondControl.pauseNext({ operation: "clear" });
			const clearing = second.clear({ scope: { kind: args.scope } });
			const overtook = await enteredWithin(secondGate.entered);
			if (overtook) secondGate.release();
			firstGate.release();
			if (!overtook) {
				await secondGate.entered;
				secondGate.release();
			}
			await Promise.all([writing, clearing]);
			const earlierWriteCleared =
				!overtook &&
				(await first.load({ id: projectId })) === null &&
				(await first.loadAttachment({
					projectId,
					key: `${args.scope}-clear-race`,
				})) === null;

			await seedProject({ store: first, projectId });
			const clearFirstGate = secondControl.pauseNext({ operation: "clear" });
			const clearFirst = second.clear({ scope: { kind: args.scope } });
			await clearFirstGate.entered;
			const laterWrite = first
				.saveAttachment({
					projectId,
					key: `${args.scope}-after-clear`,
					metadata: {},
					body: new Uint8Array([8]).buffer,
				})
				.then(
					() => false,
					(error: unknown) =>
						error instanceof ProjectStoreError && error.code === "conflict",
				);
			const settledBeforeClear = await enteredWithin(
				laterWrite.then(() => undefined),
			);
			clearFirstGate.release();
			const [, laterWriteRejected] = await Promise.all([
				clearFirst,
				laterWrite,
			]);
			return (
				earlierWriteCleared &&
				!settledBeforeClear &&
				laterWriteRejected &&
				(await first.load({ id: projectId })) === null &&
				(await first.loadAttachment({
					projectId,
					key: `${args.scope}-after-clear`,
				})) === null
			);
		},
	});
}

async function withWrapperFixture(args: {
	prefix: string;
	cleanupProof: string[];
	run: (fixture: {
		first: BrowserProjectStore;
		second: BrowserProjectStore;
		firstControl: BrowserProjectStoreControl;
		secondControl: BrowserProjectStoreControl;
		projectId: string;
	}) => Promise<boolean>;
}): Promise<boolean> {
	const fixture = createFixture(args.prefix);
	const firstControl = new BrowserProjectStoreControl();
	const secondControl = new BrowserProjectStoreControl();
	const first = createStore({
		storageIdentity: fixture.storageIdentity,
		control: firstControl,
	});
	const second = createStore({
		storageIdentity: fixture.storageIdentity,
		control: secondControl,
	});
	const projectId = `${fixture.identity}-project`;
	try {
		await Promise.all([first.list(), second.list()]);
		await seedProject({ store: first, projectId });
		return await args.run({
			first,
			second,
			firstControl,
			secondControl,
			projectId,
		});
	} finally {
		await cleanupFixture({ ...fixture, prefix: args.prefix });
		args.cleanupProof.push(fixture.identity);
	}
}

function createFixture(prefix: string): {
	identity: string;
	storageIdentity: BrowserStorageIdentity;
} {
	const identity = `${prefix}${crypto.randomUUID()}`;
	return {
		identity,
		storageIdentity: createDisposableBrowserStorageIdentity({
			identity,
			prefix,
		}),
	};
}

function createStore(args: {
	storageIdentity: BrowserStorageIdentity;
	control?: BrowserProjectStoreControl;
	diagnostics?: BrowserStoreDiagnostic[];
}): BrowserProjectStore {
	return new BrowserProjectStore({
		storageIdentity: args.storageIdentity,
		conformanceControl: args.control,
		diagnostic: args.diagnostics
			? (diagnostic) => args.diagnostics?.push(diagnostic)
			: undefined,
	});
}

async function seedProject(args: {
	store: BrowserProjectStore;
	projectId: string;
}): Promise<void> {
	const now = "2026-08-02T00:00:00.000Z";
	await args.store.save({
		record: {
			id: args.projectId,
			schemaVersion: args.store.schemaVersion,
			data: { id: args.projectId, version: args.store.schemaVersion },
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
		metadata: { byte: args.byte },
		body: new Uint8Array([args.byte]).buffer,
	});
}

async function enteredWithin(entered: Promise<void>): Promise<boolean> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<false>((resolve) => {
		timeoutId = setTimeout(() => resolve(false), 150);
	});
	const result = await Promise.race([
		entered.then(() => true as const),
		timeout,
	]);
	if (timeoutId !== undefined) clearTimeout(timeoutId);
	return result;
}

function byteString(body: ArrayBuffer | undefined): string {
	return body ? [...new Uint8Array(body)].join(",") : "";
}

function diagnosticIsMechanismNeutral(args: {
	diagnostic: BrowserStoreDiagnostic;
	expectedScope: BrowserStoreDiagnostic["scope"];
}): boolean {
	const keys = Object.keys(args.diagnostic);
	const allowedKeys = new Set([
		"level",
		"phase",
		"operation",
		"scope",
		"code",
		"retryable",
	]);
	const withoutLogicalScope = { ...args.diagnostic, scope: undefined };
	return (
		keys.every((key) => allowedKeys.has(key)) &&
		JSON.stringify(args.diagnostic.scope) ===
			JSON.stringify(args.expectedScope) &&
		!/(database|directory|opfs|indexeddb|media-files)/i.test(
			JSON.stringify(withoutLogicalScope),
		)
	);
}

async function cleanupFixture(args: {
	identity: string;
	prefix: string;
	storageIdentity: BrowserStorageIdentity;
}): Promise<void> {
	await cleanupDisposableBrowserStorage({
		identity: args.identity,
		prefix: args.prefix,
	});
}
