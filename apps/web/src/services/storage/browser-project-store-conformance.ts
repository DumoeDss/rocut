import type { ProjectStoreConformanceFixture } from "@/editor/ports/conformance";
import type { EditorHost } from "@/editor/host/editor-host";
import {
	createInMemoryPorts,
	RecordingDiagnostics,
} from "@/editor/ports/in-memory";
import { createEditorSession } from "@/editor/session/create-session";
import {
	BrowserProjectStore,
	resetBrowserProjectStoreRuntimeForTests,
	type BrowserProjectStoreOptions,
} from "./browser-project-store";
import { BrowserProjectStoreControl } from "./browser-project-store-control";
import {
	assertDisposableIdentity,
	browserStoreDiagnosticLogRecord,
	createDisposableBrowserStorageIdentity,
	isRecord,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import { createStoredProject } from "./browser-project-store-records";
import {
	deleteDatabaseExact,
	idbGet,
	idbPut,
	inventoryForIdentity,
	listDatabaseNames,
	listRootEntries,
	opfsWrite,
	removeRootDirectoryExact,
} from "./browser-storage-mechanisms";

export interface DisposableBrowserStorageInventory {
	readonly databases: readonly string[];
	readonly directories: readonly string[];
}

export interface BrowserMigrationProbeResult {
	readonly currentVersionNoOp: boolean;
	readonly legacySuccess: boolean;
	readonly legacySavedSoundsClear: boolean;
	readonly sourcePreservedOnFailure: boolean;
	readonly retrySucceeded: boolean;
	readonly wrappersCoalesced: boolean;
	readonly missingOptInRefused: boolean;
	readonly postCommitCleanupDiagnosed: boolean;
	readonly postCommitCleanupRetried: boolean;
	readonly legacyPrivateFieldsReopened: boolean;
	readonly cleanupJournalRetriedByNextSession: boolean;
	readonly cleanupJournalRetriedAfterReload: boolean;
	readonly cleanupWarningWasMechanismNeutral: boolean;
	readonly oldEnvelopeMigrated: boolean;
	readonly disposableExternalTargetRefused: boolean;
	readonly noUndefinedNames: boolean;
	readonly beforeDatabases: readonly string[];
	readonly afterDatabases: readonly string[];
	readonly cleanupProof: readonly string[];
}

export async function createBrowserProjectStoreConformanceFixture(args: {
	identity: string;
	prefix: string;
}): Promise<ProjectStoreConformanceFixture> {
	assertDisposableIdentity(args);
	const storageIdentity = createDisposableBrowserStorageIdentity(args);
	const control = new BrowserProjectStoreControl();
	let seeded = false;
	const store = new BrowserProjectStore({
		storageIdentity,
		migrationPolicy: {
			kind: "disposable",
			identity: args.identity,
			prefix: args.prefix,
		},
		conformanceControl: control,
		migrationHooks: {
			onRun: async () => {
				if (seeded) return;
				seeded = true;
				await seedDisposableLegacyProject(storageIdentity);
			},
		},
	});
	const cleanup = {
		identity: args.identity,
		store,
		run: async () => {
			await cleanupDisposableBrowserStorage(args);
		},
	};
	return {
		store,
		control,
		disposableMigration: {
			identity: args.identity,
			prefix: args.prefix,
			store,
			cleanup,
		},
	};
}

export async function inspectDisposableBrowserStorage(args: {
	identity: string;
	prefix: string;
}): Promise<DisposableBrowserStorageInventory> {
	assertDisposableIdentity(args);
	const storageIdentity = createDisposableBrowserStorageIdentity(args);
	const inventory = await inventoryForIdentity(storageIdentity);
	const allDatabases = await listDatabaseNames();
	const stageDatabases = allDatabases.filter((name) =>
		name.startsWith(`${storageIdentity.projectsDatabase}-c5-`),
	);
	return {
		databases: [...new Set([...inventory.databases, ...stageDatabases])].sort(),
		directories: inventory.directories,
	};
}

export async function cleanupDisposableBrowserStorage(args: {
	identity: string;
	prefix: string;
}): Promise<void> {
	assertDisposableIdentity(args);
	const before = await inspectDisposableBrowserStorage(args);
	for (const database of before.databases) {
		assertResolvedTarget({
			target: database,
			identity: args.identity,
			prefix: args.prefix,
		});
		await deleteDatabaseExact(database);
	}
	for (const directory of before.directories) {
		assertResolvedTarget({
			target: directory,
			identity: args.identity,
			prefix: args.prefix,
		});
		await removeRootDirectoryExact(directory);
	}
	resetBrowserProjectStoreRuntimeForTests();
	const residual = await inspectDisposableBrowserStorage(args);
	if (residual.databases.length > 0 || residual.directories.length > 0) {
		throw new Error(
			"Disposable browser storage cleanup left a resolved target behind",
		);
	}
	const unrelatedDirectories = (await listRootEntries()).filter(
		(name) => name.startsWith(args.prefix) && !name.startsWith(args.identity),
	);
	if (unrelatedDirectories.some((name) => before.directories.includes(name))) {
		throw new Error("Disposable cleanup crossed its randomized identity");
	}
}

export async function runBrowserProjectStoreMigrationProbes(): Promise<BrowserMigrationProbeResult> {
	const prefix = "c5-disposable-";
	const beforeDatabases = (await listDatabaseNames()).sort();
	const cleanupProof: string[] = [];
	const currentVersionNoOp = await probeCurrentVersionNoOp({
		prefix,
		cleanupProof,
	});
	const legacySuccess = await probeLegacySuccess({ prefix, cleanupProof });
	const legacySavedSoundsClear = await probeLegacySavedSoundsClear({
		prefix,
		cleanupProof,
	});
	const failure = await probeFailureAndRetry({ prefix, cleanupProof });
	const wrappersCoalesced = await probeWrapperCoalescing({
		prefix,
		cleanupProof,
	});
	const missingOptInRefused = await probeMissingOptIn({ prefix, cleanupProof });
	const postCommitCleanup = await probePostCommitCleanupRetry({
		prefix,
		cleanupProof,
	});
	const oldEnvelopeMigrated = await probeOldSchemaCurrentEnvelope({
		prefix,
		cleanupProof,
	});
	const disposableExternalTargetRefused =
		await probeDisposableExternalTargetRefusal({ prefix, cleanupProof });
	const afterDatabases = (await listDatabaseNames()).sort();
	return {
		currentVersionNoOp,
		legacySuccess,
		legacySavedSoundsClear,
		sourcePreservedOnFailure: failure.sourcePreserved,
		retrySucceeded: failure.retrySucceeded,
		wrappersCoalesced,
		missingOptInRefused,
		postCommitCleanupDiagnosed: postCommitCleanup.diagnosed,
		postCommitCleanupRetried: postCommitCleanup.retried,
		legacyPrivateFieldsReopened: legacySuccess,
		cleanupJournalRetriedByNextSession: postCommitCleanup.nextSessionRetried,
		cleanupJournalRetriedAfterReload: postCommitCleanup.reloadRetried,
		cleanupWarningWasMechanismNeutral:
			postCommitCleanup.mechanismNeutralWarning,
		oldEnvelopeMigrated,
		disposableExternalTargetRefused,
		noUndefinedNames: ![...beforeDatabases, ...afterDatabases].some((name) =>
			name.includes("undefined"),
		),
		beforeDatabases,
		afterDatabases,
		cleanupProof,
	};
}

async function probeLegacySavedSoundsClear(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const legacy = {
		id: "user-sounds",
		sounds: [
			{
				id: 71,
				name: "legacy sound",
				providerPrivateLegacy: { keep: true },
			},
		],
		lastModified: "2026-08-02T00:00:00.000Z",
	};
	try {
		await idbPut({
			database: storageIdentity.libraryDatabase,
			store: storageIdentity.libraryStore,
			value: legacy,
			context: {
				operation: "save-library-record",
				scope: {
					kind: "library",
					namespace: "saved-sounds",
					key: "user-sounds",
				},
			},
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		await store.saveLibraryRecord({
			namespace: "graph-presets",
			key: "custom-preset",
			schemaVersion: 1,
			data: { presets: [{ id: "custom", providerPrivate: { keep: true } }] },
		});
		await store.saveLibraryRecord({
			namespace: "unrelated-library",
			key: "same-key",
			schemaVersion: 1,
			data: { value: "unrelated", providerPrivate: { keep: true } },
		});

		const before = await store.loadLibraryRecord({
			namespace: "saved-sounds",
			key: "user-sounds",
		});
		await store.clear({
			scope: { kind: "library", namespace: "saved-sounds" },
		});
		const [after, savedSounds, customPreset, unrelated, rawLegacy] =
			await Promise.all([
				store.loadLibraryRecord({
					namespace: "saved-sounds",
					key: "user-sounds",
				}),
				store.listLibraryRecords({ namespace: "saved-sounds" }),
				store.loadLibraryRecord({
					namespace: "graph-presets",
					key: "custom-preset",
				}),
				store.loadLibraryRecord({
					namespace: "unrelated-library",
					key: "same-key",
				}),
				idbGet<unknown>({
					database: storageIdentity.libraryDatabase,
					store: storageIdentity.libraryStore,
					key: "user-sounds",
					context: {
						operation: "load-library-record",
						scope: {
							kind: "library",
							namespace: "saved-sounds",
							key: "user-sounds",
						},
					},
				}),
			]);
		return (
			before !== null &&
			isRecord(before.data) &&
			Array.isArray(before.data.sounds) &&
			after === null &&
			savedSounds.length === 0 &&
			rawLegacy === null &&
			JSON.stringify(customPreset?.data) ===
				JSON.stringify({
					presets: [{ id: "custom", providerPrivate: { keep: true } }],
				}) &&
			JSON.stringify(unrelated?.data) ===
				JSON.stringify({
					value: "unrelated",
					providerPrivate: { keep: true },
				})
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probePostCommitCleanupRetry(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{
	diagnosed: boolean;
	retried: boolean;
	nextSessionRetried: boolean;
	reloadRetried: boolean;
	mechanismNeutralWarning: boolean;
}> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-cleanup-retry`;
	const sceneId = "scene-cleanup";
	const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
	const diagnostics = new RecordingDiagnostics();
	let failuresRemaining = 2;
	const reportDiagnostic = (diagnostic: BrowserStoreDiagnostic) => {
		diagnostics.log({
			record: browserStoreDiagnosticLogRecord(diagnostic),
		});
	};
	try {
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: legacyV1Project({ projectId, sceneId }),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		await idbPut({
			database: timelineDatabase,
			store: "timeline",
			value: {
				id: "timeline",
				tracks: [],
				lastModified: "2026-08-01T00:00:00.000Z",
			},
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		const store = new BrowserProjectStore({
			storageIdentity,
			migrationPolicy: { kind: "disposable", identity, prefix: args.prefix },
			diagnostic: reportDiagnostic,
			migrationHooks: {
				beforeCleanup: (databaseName) => {
					if (databaseName === timelineDatabase && failuresRemaining > 0) {
						failuresRemaining -= 1;
						throw new Error("fixture post-commit cleanup failure");
					}
				},
			},
		});
		const firstSession = await createEditorSession({
			host: migrationProbeHost({ store, diagnostics, projectId }),
		});
		await firstSession.dispose();
		const namesAfterCommit = await listDatabaseNames();
		const diagnosed =
			namesAfterCommit.includes(timelineDatabase) &&
			diagnostics.logs.some(
				(record) =>
					record.context?.phase === "migration-postcommit-cleanup" &&
					record.context.retryable === true,
			);
		await prepareStoreForSession(store);
		const secondSession = await createEditorSession({
			host: migrationProbeHost({ store, diagnostics, projectId }),
		});
		await secondSession.dispose();
		const namesAfterSecondSession = await listDatabaseNames();
		const nextSessionRetried =
			namesAfterSecondSession.includes(timelineDatabase) &&
			diagnostics.logs.some(
				(record) =>
					record.context?.phase === "migration-cleanup-retry" &&
					record.context.retryable === true,
			);

		resetBrowserProjectStoreRuntimeForTests();
		const reopenedStore = new BrowserProjectStore({
			storageIdentity,
			migrationPolicy: { kind: "disposable", identity, prefix: args.prefix },
			diagnostic: reportDiagnostic,
		});
		await prepareStoreForSession(reopenedStore);
		const reopenedSession = await createEditorSession({
			host: migrationProbeHost({
				store: reopenedStore,
				diagnostics,
				projectId,
			}),
		});
		await reopenedSession.dispose();
		const namesAfterReload = await listDatabaseNames();
		const serializedWarnings = JSON.stringify(diagnostics.logs);
		const mechanismNeutralWarning =
			diagnostics.logs.some((record) => record.level === "warn") &&
			!/(indexeddb|opfs|database|video-editor-timelines|target)/i.test(
				serializedWarnings,
			);
		return {
			diagnosed,
			retried: !namesAfterReload.includes(timelineDatabase),
			nextSessionRetried,
			reloadRetried: !namesAfterReload.includes(timelineDatabase),
			mechanismNeutralWarning,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		await deleteDatabaseExact(timelineDatabase);
		args.cleanupProof.push(identity, timelineDatabase);
	}
}

async function probeCurrentVersionNoOp(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-current`;
	const original = {
		id: projectId,
		metadata: {
			id: projectId,
			name: "current",
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
		},
		scenes: [],
		version: 31,
		providerPrivateSentinel: { keep: true },
	};
	try {
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: original,
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const outcome = await store.migrate(migrationContext());
		const after = await idbGet<unknown>({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId },
			},
		});
		return (
			outcome.status === "not-needed" &&
			JSON.stringify(after) === JSON.stringify(original)
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeOldSchemaCurrentEnvelope(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-old-envelope`;
	try {
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: createStoredProject({
				record: {
					id: projectId,
					schemaVersion: 30,
					data: {
						id: projectId,
						version: 30,
						metadata: {
							id: projectId,
							name: "old current envelope",
							createdAt: "2026-08-01T00:00:00.000Z",
							updatedAt: "2026-08-01T00:00:00.000Z",
						},
						scenes: [],
						providerPrivateEnvelope: { keep: true },
					},
				},
				summary: {
					id: projectId,
					name: "old current envelope",
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
				},
			}),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const outcome = await store.migrate(migrationContext());
		const reopened = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const project = await reopened.load({ id: projectId });
		return (
			outcome.status === "migrated" &&
			project?.schemaVersion === reopened.schemaVersion &&
			isRecord(project.data) &&
			project.data.version === reopened.schemaVersion &&
			isRecord(project.data.providerPrivateEnvelope) &&
			project.data.providerPrivateEnvelope.keep === true
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeDisposableExternalTargetRefusal(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `outside-${crypto.randomUUID()}`;
	const sceneId = "external-scene";
	const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
	const projectTimelineDatabase = `video-editor-timelines-${projectId}`;
	const mediaDatabase = `video-editor-media-${projectId}`;
	try {
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: legacyV1Project({ projectId, sceneId }),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		await idbPut({
			database: timelineDatabase,
			store: "timeline",
			value: legacyTimeline({ attachmentKey: "external-media" }),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const outcome = await store.migrate({
			from: 1,
			to: store.schemaVersion,
			report: () => undefined,
		});
		const names = await listDatabaseNames();
		const timelineSentinel = names.includes(timelineDatabase)
			? await idbGet<unknown>({
					database: timelineDatabase,
					store: "timeline",
					key: "timeline",
					context: {
						operation: "load-project",
						scope: { kind: "project", projectId },
					},
				})
			: null;
		const source = await idbGet<Record<string, unknown>>({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId },
			},
		});
		return (
			outcome.status === "failed" &&
			names.includes(timelineDatabase) &&
			!names.includes(projectTimelineDatabase) &&
			!names.includes(mediaDatabase) &&
			isRecord(timelineSentinel) &&
			timelineSentinel.id === "timeline" &&
			source?.version === 1
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		await deleteDatabaseExact(timelineDatabase);
		await deleteDatabaseExact(projectTimelineDatabase);
		await deleteDatabaseExact(mediaDatabase);
		args.cleanupProof.push(
			identity,
			timelineDatabase,
			projectTimelineDatabase,
			mediaDatabase,
		);
	}
}

async function probeLegacySuccess(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-legacy-v1`;
	const sceneId = "scene-main";
	const attachmentKey = "legacy-media";
	const timelineDatabase = `video-editor-timelines-${projectId}-${sceneId}`;
	const projectTimelineDatabase = `video-editor-timelines-${projectId}`;
	const legacyMediaDatabase = `video-editor-media-${projectId}`;
	const progress: Array<{ completed: number; total: number; label?: string }> =
		[];
	try {
		await idbPut({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			value: legacyV1Project({ projectId, sceneId }),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		await idbPut({
			database: timelineDatabase,
			store: "timeline",
			value: legacyTimeline({ attachmentKey }),
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		await idbPut({
			database: projectTimelineDatabase,
			store: "timeline",
			value: {
				id: "timeline",
				tracks: [],
				lastModified: "2026-08-01T00:00:00.000Z",
			},
			context: {
				operation: "save-project",
				scope: { kind: "project", projectId },
			},
		});
		const metadata = {
			id: attachmentKey,
			name: "legacy.png",
			type: "image",
			size: 4,
			lastModified: 1,
			providerPrivateAttachment: { keep: true },
		};
		for (const database of [
			legacyMediaDatabase,
			`${storageIdentity.mediaDatabasePrefix}${projectId}`,
		]) {
			await idbPut({
				database,
				store: storageIdentity.mediaStore,
				value: metadata,
				context: {
					operation: "save-attachment",
					scope: { kind: "attachment", projectId, key: attachmentKey },
				},
			});
		}
		await opfsWrite({
			directory: `${storageIdentity.mediaDirectoryPrefix}${projectId}`,
			key: attachmentKey,
			body: new Uint8Array([0, 1, 128, 255]).buffer,
			context: {
				operation: "save-attachment",
				scope: { kind: "attachment", projectId, key: attachmentKey },
			},
		});
		const store = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const outcome = await store.migrate({
			from: 1,
			to: store.schemaVersion,
			report: (item) => progress.push(item),
		});
		resetBrowserProjectStoreRuntimeForTests();
		const reopened = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const project = await reopened.load({ id: projectId });
		const attachment = await reopened.loadAttachment({
			projectId,
			key: attachmentKey,
		});
		const databaseNames = await listDatabaseNames();
		const projectData = isRecord(project?.data) ? project.data : null;
		const projectMetadata = isRecord(projectData?.metadata)
			? projectData.metadata
			: null;
		const firstScene = Array.isArray(projectData?.scenes)
			? projectData.scenes[0]
			: null;
		const currentTracks =
			isRecord(firstScene) && isRecord(firstScene.tracks)
				? firstScene.tracks
				: null;
		const firstTrack = isRecord(currentTracks?.main)
			? currentTracks.main
			: null;
		const firstClip =
			isRecord(firstTrack) && Array.isArray(firstTrack.elements)
				? firstTrack.elements[0]
				: null;
		return (
			outcome.status === "migrated" &&
			project?.schemaVersion === reopened.schemaVersion &&
			isRecord(projectData?.providerPrivateProject) &&
			projectData.providerPrivateProject.keep === "project" &&
			isRecord(projectMetadata?.providerPrivateMetadata) &&
			projectMetadata.providerPrivateMetadata.keep === "metadata" &&
			isRecord(firstScene) &&
			isRecord(firstScene.providerPrivateScene) &&
			firstScene.providerPrivateScene.keep === "scene" &&
			isRecord(firstTrack) &&
			isRecord(firstTrack.providerPrivateTrack) &&
			firstTrack.providerPrivateTrack.keep === "track" &&
			isRecord(firstClip) &&
			isRecord(firstClip.providerPrivateClip) &&
			firstClip.providerPrivateClip.keep === "clip" &&
			attachment !== null &&
			[...new Uint8Array(attachment.body)].join(",") === "0,1,128,255" &&
			isRecord(attachment.metadata) &&
			isRecord(attachment.metadata.providerPrivateAttachment) &&
			attachment.metadata.providerPrivateAttachment.keep === true &&
			progress.at(-1)?.completed === progress.at(-1)?.total &&
			!databaseNames.includes(timelineDatabase) &&
			!databaseNames.includes(projectTimelineDatabase)
		);
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		for (const database of [
			timelineDatabase,
			projectTimelineDatabase,
			legacyMediaDatabase,
		]) {
			await deleteDatabaseExact(database);
		}
		args.cleanupProof.push(
			identity,
			timelineDatabase,
			projectTimelineDatabase,
			legacyMediaDatabase,
		);
	}
}

async function probeFailureAndRetry(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<{ sourcePreserved: boolean; retrySucceeded: boolean }> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-failure`;
	try {
		await seedLegacyV30({ storageIdentity, projectId });
		const failing = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			hooks: {
				beforeValidation: () =>
					Promise.reject(new Error("fixture validation failure")),
			},
		});
		const first = await failing.migrate(migrationContext());
		const preserved = await idbGet<Record<string, unknown>>({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId },
			},
		});
		const sourcePreserved =
			first.status === "failed" && preserved?.version === 30;
		const retry = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
		});
		const second = await retry.migrate(migrationContext());
		const migrated = await retry.load({ id: projectId });
		return {
			sourcePreserved,
			retrySucceeded:
				second.status === "migrated" &&
				migrated?.schemaVersion === retry.schemaVersion,
		};
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeWrapperCoalescing(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-race`;
	let runs = 0;
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const hooks = {
		onRun: async () => {
			runs += 1;
			entered();
			await gate;
		},
	};
	try {
		await seedLegacyV30({ storageIdentity, projectId });
		const firstStore = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			hooks,
		});
		const secondStore = disposableStore({
			identity,
			prefix: args.prefix,
			storageIdentity,
			hooks,
		});
		const first = firstStore.migrate(migrationContext());
		await started;
		const second = secondStore.migrate(migrationContext());
		release();
		const outcomes = await Promise.all([first, second]);
		return (
			runs === 1 && outcomes.every((outcome) => outcome.status === "migrated")
		);
	} finally {
		release();
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function probeMissingOptIn(args: {
	prefix: string;
	cleanupProof: string[];
}): Promise<boolean> {
	const identity = `${args.prefix}${crypto.randomUUID()}`;
	const storageIdentity = createDisposableBrowserStorageIdentity({
		identity,
		prefix: args.prefix,
	});
	const projectId = `${identity}-no-opt-in`;
	try {
		await seedLegacyV30({ storageIdentity, projectId });
		const store = new BrowserProjectStore({ storageIdentity });
		const outcome = await store.migrate(migrationContext());
		const source = await idbGet<Record<string, unknown>>({
			database: storageIdentity.projectsDatabase,
			store: storageIdentity.projectsStore,
			key: projectId,
			context: {
				operation: "load-project",
				scope: { kind: "project", projectId },
			},
		});
		return outcome.status === "failed" && source?.version === 30;
	} finally {
		await cleanupDisposableBrowserStorage({ identity, prefix: args.prefix });
		args.cleanupProof.push(identity);
	}
}

async function prepareStoreForSession(
	store: BrowserProjectStore,
): Promise<void> {
	const candidate = store as BrowserProjectStore & {
		prepareForSession?: () => Promise<void>;
	};
	await candidate.prepareForSession?.();
}

function migrationProbeHost(args: {
	store: BrowserProjectStore;
	diagnostics: RecordingDiagnostics;
	projectId: string;
}): EditorHost {
	return {
		...createInMemoryPorts({ store: args.store }),
		projectId: args.projectId,
		navigation: {
			onProjectReplaced: () => undefined,
			onExitProject: () => undefined,
			onGoBack: () => undefined,
		},
		services: {},
		branding: { logoUrl: "/migration-probe.svg" },
		links: {
			discordUrl: "https://example.invalid/discord",
			roadmapUrl: "https://example.invalid/roadmap",
		},
		store: args.store,
		diagnostics: args.diagnostics,
	};
}

function disposableStore(args: {
	identity: string;
	prefix: string;
	storageIdentity: BrowserStorageIdentity;
	hooks?: BrowserProjectStoreOptions["migrationHooks"];
}): BrowserProjectStore {
	return new BrowserProjectStore({
		storageIdentity: args.storageIdentity,
		migrationPolicy: {
			kind: "disposable",
			identity: args.identity,
			prefix: args.prefix,
		},
		migrationHooks: args.hooks,
	});
}

function migrationContext() {
	return { from: 30, to: 31, report: () => undefined } as const;
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
			metadata: {
				id: args.projectId,
				name: "legacy v30",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
			},
			scenes: [],
			version: 30,
			providerPrivateSentinel: { keep: true },
		},
		context: {
			operation: "save-project",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
}

function legacyV1Project(args: { projectId: string; sceneId: string }) {
	return {
		id: args.projectId,
		version: 1,
		name: "legacy v1",
		metadata: {
			id: args.projectId,
			name: "legacy v1",
			createdAt: "2024-01-15T10:00:00.000Z",
			updatedAt: "2024-01-15T12:00:00.000Z",
			providerPrivateMetadata: { keep: "metadata" },
		},
		createdAt: "2024-01-15T10:00:00.000Z",
		updatedAt: "2024-01-15T12:00:00.000Z",
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		backgroundColor: "#000000",
		backgroundType: "color",
		currentSceneId: args.sceneId,
		scenes: [
			{
				id: args.sceneId,
				name: "main",
				isMain: true,
				tracks: [],
				bookmarks: [],
				createdAt: "2024-01-15T10:00:00.000Z",
				updatedAt: "2024-01-15T12:00:00.000Z",
				providerPrivateScene: { keep: "scene" },
			},
		],
		providerPrivateProject: { keep: "project" },
	};
}

function legacyTimeline(args: { attachmentKey: string }) {
	return {
		id: "timeline",
		lastModified: "2026-08-01T00:00:00.000Z",
		tracks: [
			{
				id: "legacy-track",
				name: "legacy track",
				type: "media",
				providerPrivateTrack: { keep: "track" },
				elements: [
					{
						id: "legacy-element",
						name: "legacy image",
						type: "media",
						mediaId: args.attachmentKey,
						duration: 1,
						startTime: 0,
						trimStart: 0,
						trimEnd: 0,
						providerPrivateClip: { keep: "clip" },
					},
				],
			},
		],
	};
}

function assertResolvedTarget(args: {
	target: string;
	identity: string;
	prefix: string;
}): void {
	if (
		!args.target.startsWith(args.identity) ||
		!args.target.startsWith(args.prefix) ||
		args.target.includes("undefined")
	) {
		throw new Error(
			"Refusing to clean browser storage outside the disposable identity",
		);
	}
}

async function seedDisposableLegacyProject(
	identity: BrowserStorageIdentity,
): Promise<void> {
	const projectId = `${identity.identity}-legacy-v30`;
	await idbPut({
		database: identity.projectsDatabase,
		store: identity.projectsStore,
		value: {
			id: projectId,
			metadata: {
				id: projectId,
				name: "C5 disposable legacy project",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				providerPrivateMetadata: { keep: "metadata" },
			},
			scenes: [],
			currentSceneId: "",
			settings: {},
			version: 30,
			providerPrivateProject: { keep: "project" },
		},
		context: {
			operation: "save-project",
			scope: { kind: "project", projectId },
		},
	});
}
