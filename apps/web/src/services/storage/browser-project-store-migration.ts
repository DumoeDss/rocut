import type {
	MigrationContext,
	MigrationOutcome,
	ProjectSummary,
	ProjectStoreErrorScope,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import { migrations } from "./migrations";
import type { LegacyStorageTarget } from "./migrations/base";
import { getLegacyTimelineDbNames } from "./migrations/v1-to-v2";
import { transformProjectV0ToV1 } from "./migrations/transformers/v0-to-v1";
import type { ProjectRecord as LegacyProject } from "./migrations/transformers/types";
import {
	BROWSER_STORE_SCHEMA_VERSION,
	attachmentAuthorityStoreName,
	assertDisposableIdentity,
	cloneBrowserValue,
	isRecord,
	mediaDatabaseName,
	mediaDirectoryName,
	projectAuthorityStoreName,
	type BrowserStorageIdentity,
	type BrowserStoreDiagnostic,
} from "./browser-project-store-internals";
import {
	createStoredAttachment,
	createStoredProject,
	createCurrentStoredAttachment,
	createCurrentStoredProject,
	decodeStoredAttachment,
	decodeStoredAttachmentPair,
	decodeStoredAttachmentRecord,
	decodeStoredProject,
	decodeStoredProjectPair,
	digestAttachmentBody,
	isNonNegativeSafeInteger,
	projectIdFromStored,
	projectVersionFromStored,
} from "./browser-project-store-records";
import {
	cascadeMaintenanceStoreName,
	projectTombstoneKey,
} from "./browser-project-store-cascade";
import { readKnownLibraryPhysicalClaims } from "./browser-project-store-library-clear-bindings";
import {
	currentMediaPhysicalClaim,
	readKnownMediaPhysicalClaims,
	registerMediaOwner,
} from "./browser-project-store-media-ownership";
import {
	browserMigrationStageNames,
	browserProjectTopologyStoreNames,
	BrowserStorageTopologyConflict,
	createBrowserStorageTopology,
	isBrowserStorageTopologyConflict,
	type BrowserStorageTopologyPermit,
	type MediaPhysicalClaim,
	type MigrationDatabaseCleanupClaim,
	type MigrationDatabaseSourceClaim,
} from "./browser-project-store-topology";
import {
	deleteDatabaseExact,
	idbCommitAttachment,
	idbCommitProjectSave,
	idbDelete,
	idbGet,
	idbGetAll,
	idbGetAllAttachmentPairs,
	idbGetAllProjectPairs,
	idbGetAttachmentPair,
	idbGetProjectPair,
	idbPut,
	opfsRead,
} from "./browser-storage-mechanisms";

export type BrowserMigrationPolicy =
	| { readonly kind: "production" }
	| {
			readonly kind: "disposable";
			readonly identity: string;
			readonly prefix: string;
	  }
	| { readonly kind: "disabled" };

export interface BrowserMigrationHooks {
	beforeValidation?(projectId: string): Promise<void> | void;
	beforeCommit?(projectId: string): Promise<void> | void;
	beforeProjectCommit?(projectId: string): Promise<void> | void;
	beforeCommittedReadback?(projectId: string): Promise<void> | void;
	beforeCleanupIntentWrite?(): Promise<void> | void;
	beforeCleanup?(databaseName: string): Promise<void> | void;
	onRun?(): Promise<void> | void;
}

interface StagedAttachment {
	id: string;
	projectId: string;
	key: string;
	storedMetadata: Record<string, unknown>;
	body: ArrayBuffer;
	original: AttachmentFingerprint;
	staged: AttachmentFingerprint;
	migrationMutationId: string;
}

interface AttachmentFingerprint {
	readonly storedMetadata: Record<string, unknown>;
	readonly bodyDigest: string;
	readonly byteLength: number;
	readonly retiredBodyKeys: readonly string[];
}

interface MigrationRecoveryAttachment {
	readonly key: string;
	readonly original: AttachmentFingerprint | null;
	readonly staged: AttachmentFingerprint;
	readonly migrationMutationId: string;
}

interface StagedProject {
	id: string;
	label: string;
	originalVersion: number;
	originalProject: Record<string, unknown>;
	storedProject: Record<string, unknown>;
	attachments: StagedAttachment[];
	cleanupTargets: readonly CleanupTarget[];
}

interface MigrationProjectPlan {
	readonly id: string;
	readonly label: string;
	readonly originalVersion: number;
	readonly originalProject: Record<string, unknown>;
	readonly storedProject: Record<string, unknown>;
	readonly media: MediaPhysicalClaim;
	readonly mediaStore: string;
	readonly cleanupTargets: readonly CleanupTarget[];
}

interface MigrationProjectPreparation {
	readonly id: string;
	readonly label: string;
	readonly originalVersion: number;
	readonly originalProject: Record<string, unknown>;
	readonly summary: ProjectSummary;
	readonly migrationSource: LegacyProject;
	readonly transformFromVersion: number;
	readonly media: MediaPhysicalClaim;
	readonly mediaStore: string;
	readonly cleanupTargets: readonly CleanupTarget[];
	readonly sourceClaims: readonly MigrationDatabaseSourceClaim[];
}

interface CleanupTarget {
	readonly kind: "legacy-database" | "stage-database";
	readonly name: string;
	readonly projectId?: string;
}

interface CleanupRetryArgs {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	diagnostic?(diagnostic: BrowserStoreDiagnostic): void;
	hooks?: BrowserMigrationHooks;
}

type MigrationCleanupPermit = Extract<
	BrowserStorageTopologyPermit,
	{ kind: "migration-cleanup" }
>;

interface MigrationRecoveryProject {
	readonly id: string;
	readonly label: string;
	readonly originalVersion: number;
	readonly originalProject: Record<string, unknown>;
	readonly storedProject: Record<string, unknown>;
	readonly attachments: MigrationRecoveryAttachment[];
	readonly cleanupTargets: CleanupTarget[];
}

interface MigrationRecoveryRecord {
	readonly id: "migration-recovery";
	readonly revision: 2;
	readonly projects: MigrationRecoveryProject[];
	readonly cleanupTargets: CleanupTarget[];
}

function migrationScope(projectId?: string): ProjectStoreErrorScope {
	return projectId ? { kind: "project", projectId } : { kind: "store" };
}

function stageDatabase(args: {
	identity: BrowserStorageIdentity;
	kind: "projects" | "attachments";
}): string {
	return browserMigrationStageNames(args.identity.projectsDatabase)[args.kind]
		.database;
}

function stageStorage(args: {
	identity: BrowserStorageIdentity;
	kind: "projects" | "attachments";
}): { readonly database: string; readonly store: string } {
	return browserMigrationStageNames(args.identity.projectsDatabase)[args.kind];
}

function authorizeStaticMigrationIdentity(args: {
	identity: BrowserStorageIdentity;
	operation: "inspect" | "list-projects";
}): void {
	try {
		createBrowserStorageTopology(args.identity).authorize({
			kind: "static-identity",
			context: { operation: args.operation, scope: { kind: "store" } },
		});
	} catch (error) {
		if (!isBrowserStorageTopologyConflict(error)) throw error;
		throw new ProjectStoreError({
			code: "unavailable",
			operation: args.operation,
			scope: { kind: "store" },
		});
	}
}

function ensureMigrationAllowed(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
}): void {
	if (args.policy.kind === "disabled") {
		throw new Error(
			"Browser project migration is not enabled for this identity",
		);
	}
	if (args.policy.kind === "production") {
		if (args.identity.identity !== "opencut-browser-production") {
			throw new Error(
				"A custom browser identity requires disposable migration opt-in",
			);
		}
		return;
	}
	assertDisposableIdentity(args.policy);
	if (args.policy.identity !== args.identity.identity) {
		throw new Error(
			"Disposable migration policy is not bound to the durable identity",
		);
	}
}

function ensureDisposableProjectAllowed(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	projectId: string;
}): void {
	if (args.policy.kind !== "disposable") return;
	const expectedPrefix = `${args.identity.identity}-`;
	if (!args.projectId.startsWith(expectedPrefix)) {
		throw new Error(
			"Disposable migration project is outside its durable identity",
		);
	}
}

function assertLegacyTargetAllowed(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	target: LegacyStorageTarget;
}): void {
	const allowed =
		args.target.kind === "database"
			? args.target.name ===
					`video-editor-timelines-${args.target.projectId}` ||
				args.target.name.startsWith(
					`video-editor-timelines-${args.target.projectId}-`,
				) ||
				args.target.name === `video-editor-media-${args.target.projectId}`
			: args.target.name === `media-files-${args.target.projectId}`;
	if (!allowed || args.target.name.includes("undefined")) {
		throw new Error(
			"Disposable migration target is outside its exact project identity",
		);
	}
	ensureDisposableProjectAllowed({
		identity: args.identity,
		policy: args.policy,
		projectId: args.target.projectId,
	});
}

export async function readPersistedBrowserSchemaVersion(
	identity: BrowserStorageIdentity,
): Promise<number | null> {
	authorizeStaticMigrationIdentity({
		identity,
		operation: "list-projects",
	});
	const pairs = await idbGetAllProjectPairs({
		database: identity.projectsDatabase,
		projectStore: identity.projectsStore,
		authorityStore: projectAuthorityStoreName(identity.projectsStore),
		context: { operation: "list-projects", scope: { kind: "store" } },
	});
	if (pairs.length === 0) return BROWSER_STORE_SCHEMA_VERSION;
	const decoded = pairs.map((pair) => {
		const project = decodeStoredProjectPair(pair);
		if (!project) throw new Error("Persisted project pair is invalid");
		return project;
	});
	return Math.min(...decoded.map((project) => project.record.schemaVersion));
}

export async function runBrowserProjectMigration(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	context: MigrationContext;
	diagnostic?(diagnostic: BrowserStoreDiagnostic): void;
	hooks?: BrowserMigrationHooks;
}): Promise<MigrationOutcome> {
	authorizeStaticMigrationIdentity({
		identity: args.identity,
		operation: "inspect",
	});
	let phase = "discovery";
	let recoveryPersisted = false;
	let migrationPermit: MigrationCleanupPermit | null = null;
	try {
		ensureMigrationAllowed(args);
		await args.hooks?.onRun?.();
		await retryPendingCleanup({
			args,
			phase: "migration-postcommit-cleanup",
		});
		const pairs = await idbGetAllProjectPairs({
			database: args.identity.projectsDatabase,
			projectStore: args.identity.projectsStore,
			authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
			context: { operation: "list-projects", scope: { kind: "store" } },
		});
		const discovered = pairs.map((pair) => {
			const decoded = decodeStoredProjectPair(pair);
			if (!decoded || !isRecord(pair.publicRow)) {
				throw new Error("Persisted project pair is invalid");
			}
			return { pair, decoded };
		});
		const candidates = discovered.filter(
			({ decoded }) =>
				decoded.record.schemaVersion < BROWSER_STORE_SCHEMA_VERSION,
		);
		if (candidates.length === 0) return { status: "not-needed" };

		phase = "planning";
		const prepared: MigrationProjectPreparation[] = [];
		for (const { pair, decoded } of candidates) {
			const row = pair.publicRow;
			const projectId = decoded.record.id;
			if (!isRecord(row)) {
				throw new Error("Legacy project has no durable identity");
			}
			ensureDisposableProjectAllowed({
				identity: args.identity,
				policy: args.policy,
				projectId,
			});
			const originalVersion = decoded.record.schemaVersion;
			const decodedSource = decoded.record.data;
			if (!isRecord(decodedSource)) {
				throw new Error("Persisted project payload is not migratable");
			}
			const migrationSource = cloneBrowserValue({
				value: { ...decodedSource, version: originalVersion },
				operation: "save-project",
				scope: migrationScope(projectId),
			});
			const transformPreparation = prepareMigrationTransformSource({
				project: migrationSource,
				fromVersion: originalVersion,
			});
			const media = await currentMediaPhysicalClaim({
				identity: args.identity,
				projectId,
				context: {
					operation: "list-attachments",
					scope: { kind: "project", projectId },
				},
			});
			const sourceClaims = legacySourceClaims({
				identity: args.identity,
				policy: args.policy,
				projectId,
				project: transformPreparation.project,
				fromVersion: transformPreparation.fromVersion,
				currentMedia: media,
			});
			const cleanupTargets = sourceClaims
				.filter((claim) => claim.kind === "legacy-timeline")
				.map(
					(claim): CleanupTarget =>
						Object.freeze({
							kind: "legacy-database",
							name: claim.database,
							projectId: claim.projectId,
						}),
				);
			const projectPreparation: MigrationProjectPreparation = Object.freeze({
				id: projectId,
				label: decoded.summary.name,
				originalVersion,
				originalProject: cloneBrowserValue({
					value: createStoredProject({
						record: decoded.record,
						summary: decoded.summary,
					}),
					operation: "save-project",
					scope: migrationScope(projectId),
				}),
				summary: Object.freeze({ ...decoded.summary }),
				migrationSource: transformPreparation.project,
				transformFromVersion: transformPreparation.fromVersion,
				media: Object.freeze({ ...media }),
				mediaStore: args.identity.mediaStore,
				cleanupTargets: Object.freeze(cleanupTargets),
				sourceClaims: Object.freeze(sourceClaims),
			});
			prepared.push(projectPreparation);
		}

		const existingCleanupTargets = await readCleanupJournal({
			identity: args.identity,
			policy: args.policy,
		});
		migrationPermit = await authorizeMigrationCleanup({
			identity: args.identity,
			targets: mergeCleanupTargets([
				...existingCleanupTargets,
				...cleanupTargetsForMigration({
					identity: args.identity,
					planned: prepared,
				}),
			]),
			currentMedia: prepared.map((project) => project.media),
			sources: prepared.flatMap((project) => project.sourceClaims),
		});

		phase = "staging";
		const planned: MigrationProjectPlan[] = [];
		for (const project of prepared) {
			const transformed = await transformLegacyProject({
				projectId: project.id,
				project: project.migrationSource,
				fromVersion: project.transformFromVersion,
				identity: args.identity,
				policy: args.policy,
				permit: migrationPermit,
			});
			planned.push(
				Object.freeze({
					id: project.id,
					label: project.label,
					originalVersion: project.originalVersion,
					originalProject: project.originalProject,
					storedProject: createStoredProject({
						record: {
							id: project.id,
							schemaVersion: BROWSER_STORE_SCHEMA_VERSION,
							data: transformed,
						},
						summary: project.summary,
					}),
					media: project.media,
					mediaStore: project.mediaStore,
					cleanupTargets: project.cleanupTargets,
				}),
			);
		}
		const staged: StagedProject[] = [];
		for (const project of planned) {
			const attachments = await stageLegacyAttachments({
				projectId: project.id,
				media: project.media,
				mediaStore: project.mediaStore,
			});
			staged.push({ ...project, attachments });
		}
		for (const project of staged) {
			await registerMediaOwner({
				identity: args.identity,
				projectId: project.id,
				context: {
					operation: "list-attachments",
					scope: { kind: "project", projectId: project.id },
				},
			});
		}
		for (const projectStage of staged) {
			await writeAndValidateStage({
				identity: args.identity,
				staged: projectStage,
			});
			await args.hooks?.beforeValidation?.(projectStage.id);
			await validateStage({ identity: args.identity, expected: projectStage });
		}

		phase = "recovery-intent";
		await writeRecoveryJournal({
			identity: args.identity,
			staged,
			permit: migrationPermit,
		});
		recoveryPersisted = true;
		phase = "cleanup-intent";
		await persistCleanupIntent({ args, permit: migrationPermit });

		for (let index = 0; index < staged.length; index += 1) {
			const project = staged[index];
			phase = "commit";
			await args.hooks?.beforeCommit?.(project.id);
			await commitStagedProject({
				identity: args.identity,
				staged: project,
				hooks: args.hooks,
			});
			phase = "commit-validation";
			await validateCommittedProject({
				identity: args.identity,
				expected: project,
				hooks: args.hooks,
			});
			args.context.report({
				completed: index + 1,
				total: staged.length,
				label: project.label,
			});
		}
		phase = "finalization";
		await deleteRecoveryJournal(args.identity);
		recoveryPersisted = false;
		await retryPendingCleanup({
			args,
			phase: "migration-postcommit-cleanup",
		});
		return {
			status: "migrated",
			from: Math.min(...staged.map((project) => project.originalVersion)),
			to: BROWSER_STORE_SCHEMA_VERSION,
			recordsMigrated: staged.length,
		};
	} catch (error) {
		if (!recoveryPersisted && migrationPermit) {
			await cleanupStageDatabases({
				identity: args.identity,
				permit: migrationPermit,
			}).catch(() => undefined);
		}
		if (isBrowserStorageTopologyConflict(error)) {
			reportMigrationTopologyConflict(args);
		} else {
			args.diagnostic?.({
				level: "warning",
				phase: `migration-${phase}`,
				code: "unavailable",
				retryable: true,
			});
		}
		return {
			status: "failed",
			from: args.context.from,
			to: BROWSER_STORE_SCHEMA_VERSION,
			reason: `Browser project migration paused during ${phase}; durable state will retry`,
		};
	}
}

async function transformLegacyProject(args: {
	projectId: string;
	project: LegacyProject;
	fromVersion: number;
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	permit: MigrationCleanupPermit;
}): Promise<LegacyProject> {
	let current = args.fromVersion;
	let project = args.project;
	for (const migration of [...migrations].sort(
		(left, right) => left.from - right.from,
	)) {
		if (migration.from !== current) continue;
		const result = await migration.run({
			projectId: args.projectId,
			project,
			assertLegacyTarget: (target) =>
				assertLegacySourceAuthorized({
					identity: args.identity,
					policy: args.policy,
					target,
					permit: args.permit,
				}),
		});
		if (result.skipped) {
			throw new Error("Legacy transformation refused a required schema step");
		}
		project = result.project;
		current = migration.to;
	}
	if (current !== BROWSER_STORE_SCHEMA_VERSION) {
		throw new Error("Legacy transformation did not reach the current schema");
	}
	return project;
}

function prepareMigrationTransformSource(args: {
	project: LegacyProject;
	fromVersion: number;
}): { readonly project: LegacyProject; readonly fromVersion: number } {
	if (args.fromVersion !== 0) return args;
	const result = transformProjectV0ToV1({ project: args.project });
	if (result.skipped) {
		throw new Error("Legacy transformation refused a required schema step");
	}
	return { project: result.project, fromVersion: 1 };
}

function legacySourceClaims(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	projectId: string;
	project: LegacyProject;
	fromVersion: number;
	currentMedia: MediaPhysicalClaim;
}): MigrationDatabaseSourceClaim[] {
	if (args.fromVersion > 1) return [];
	const claims: MigrationDatabaseSourceClaim[] = [
		...getLegacyTimelineDbNames({
			projectId: args.projectId,
			project: args.project,
		}).map(
			(database): MigrationDatabaseSourceClaim => ({
				kind: "legacy-timeline",
				projectId: args.projectId,
				database,
			}),
		),
		{
			kind: "legacy-media",
			projectId: args.projectId,
			database: `video-editor-media-${args.projectId}`,
			...(`video-editor-media-${args.projectId}` === args.currentMedia.database
				? { mediaOwnerFingerprint: args.currentMedia.fingerprint }
				: {}),
		},
	];
	const unique = new Map<string, MigrationDatabaseSourceClaim>();
	for (const claim of claims) {
		assertLegacyTargetAllowed({
			identity: args.identity,
			policy: args.policy,
			target: {
				kind: "database",
				name: claim.database,
				projectId: claim.projectId,
			},
		});
		unique.set(
			JSON.stringify([claim.kind, claim.projectId, claim.database]),
			Object.freeze({ ...claim }),
		);
	}
	return [...unique.values()];
}

function assertLegacySourceAuthorized(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	target: LegacyStorageTarget;
	permit: MigrationCleanupPermit;
}): void {
	assertLegacyTargetAllowed(args);
	if (
		args.target.kind !== "database" ||
		!args.permit.sources.some(
			(source) =>
				source.kind ===
					(args.target.name === `video-editor-media-${args.target.projectId}`
						? "legacy-media"
						: "legacy-timeline") &&
				source.projectId === args.target.projectId &&
				source.database === args.target.name,
		)
	) {
		throw new BrowserStorageTopologyConflict("ambiguous-physical-owner");
	}
}

async function stageLegacyAttachments(args: {
	projectId: string;
	media: MediaPhysicalClaim;
	mediaStore: string;
}): Promise<StagedAttachment[]> {
	if (args.media.projectId !== args.projectId) {
		throw new Error("Migration media plan has an invalid project identity");
	}
	const pairs = await idbGetAllAttachmentPairs({
		database: args.media.database,
		mediaStore: args.mediaStore,
		authorityStore: attachmentAuthorityStoreName(args.mediaStore),
		context: {
			operation: "list-attachments",
			scope: { kind: "project", projectId: args.projectId },
		},
	});
	const staged: StagedAttachment[] = [];
	for (const pair of pairs) {
		const decoded = decodeStoredAttachmentPair({
			projectId: args.projectId,
			publicRow: pair.publicRow,
			authorityRow: pair.authorityRow,
		});
		if (!decoded) throw new Error("Legacy attachment metadata is invalid");
		if (decoded.kind === "tombstone") continue;
		const body = await opfsRead({
			directory: args.media.directory,
			key: decoded.bodyKey,
			context: {
				operation: "load-attachment",
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: decoded.key,
				},
			},
		});
		if (!body) throw new Error("Legacy attachment body is missing");
		const bodyDigest = await digestAttachmentBody(body);
		if (
			(decoded.revision === 2 || decoded.revision === "current") &&
			(decoded.byteLength !== body.byteLength ||
				decoded.bodyDigest !== bodyDigest)
		) {
			throw new Error("Legacy attachment body fingerprint is invalid");
		}
		const migrationMutationId =
			decoded.mutationId ?? `migration:${crypto.randomUUID()}`;
		const storedMetadata = createStoredAttachment({
			projectId: args.projectId,
			key: decoded.key,
			metadata: decoded.metadata,
			bodyKey: decoded.bodyKey,
			mutationId: migrationMutationId,
			bodyDigest,
			byteLength: body.byteLength,
		});
		const originalStoredMetadata =
			decoded.revision === "current"
				? createStoredAttachment({
						projectId: args.projectId,
						key: decoded.key,
						metadata: decoded.metadata,
						bodyKey: decoded.bodyKey,
						mutationId: migrationMutationId,
						bodyDigest,
						byteLength: body.byteLength,
					})
				: cloneBrowserValue({
						value: pair.publicRow,
						operation: "save-attachment",
						scope: {
							kind: "attachment",
							projectId: args.projectId,
							key: decoded.key,
						},
					});
		if (!isRecord(originalStoredMetadata)) {
			throw new Error("Legacy attachment metadata is invalid");
		}
		staged.push({
			id: `${encodeURIComponent(args.projectId)}:${encodeURIComponent(decoded.key)}`,
			projectId: args.projectId,
			key: decoded.key,
			storedMetadata,
			body,
			original: {
				storedMetadata: originalStoredMetadata,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: decoded.retiredBodyKeys,
			},
			staged: {
				storedMetadata,
				bodyDigest,
				byteLength: body.byteLength,
				retiredBodyKeys: decoded.retiredBodyKeys,
			},
			migrationMutationId,
		});
	}
	return staged;
}

async function writeAndValidateStage(args: {
	identity: BrowserStorageIdentity;
	staged: StagedProject;
}): Promise<void> {
	await idbPut({
		...stageStorage({ identity: args.identity, kind: "projects" }),
		value: { id: args.staged.id, value: args.staged.storedProject },
		context: {
			operation: "save-project",
			scope: migrationScope(args.staged.id),
		},
	});
	for (const attachment of args.staged.attachments) {
		await idbPut({
			...stageStorage({ identity: args.identity, kind: "attachments" }),
			value: { ...attachment },
			context: {
				operation: "save-attachment",
				scope: {
					kind: "attachment",
					projectId: attachment.projectId,
					key: attachment.key,
				},
			},
		});
	}
}

async function validateStage(args: {
	identity: BrowserStorageIdentity;
	expected: StagedProject;
}): Promise<void> {
	const stored = await idbGet<{ id: string; value: unknown }>({
		...stageStorage({ identity: args.identity, kind: "projects" }),
		key: args.expected.id,
		context: {
			operation: "load-project",
			scope: migrationScope(args.expected.id),
		},
	});
	if (
		!stored ||
		!deepEqual({ left: stored.value, right: args.expected.storedProject })
	) {
		throw new Error("Staged project readback differs from transformed project");
	}
	const decodedProject = decodeStoredProject(stored.value);
	if (
		decodedProject?.record.id !== args.expected.id ||
		decodedProject.record.schemaVersion !== BROWSER_STORE_SCHEMA_VERSION
	) {
		throw new Error("Staged project identity or schema version is invalid");
	}
	const attachments = await idbGetAll<StagedAttachment>({
		...stageStorage({ identity: args.identity, kind: "attachments" }),
		context: {
			operation: "list-attachments",
			scope: migrationScope(args.expected.id),
		},
	});
	const own = attachments.filter((item) => item.projectId === args.expected.id);
	if (
		!deepEqual({ left: own, right: args.expected.attachments }) ||
		own.some(
			(item) =>
				decodeStoredAttachment({
					projectId: args.expected.id,
					value: item.storedMetadata,
				})?.key !== item.key,
		)
	) {
		throw new Error("Staged attachment count, metadata, or body differs");
	}
}

async function commitStagedProject(args: {
	identity: BrowserStorageIdentity;
	staged: StagedProject;
	hooks?: BrowserMigrationHooks;
}): Promise<void> {
	for (const attachment of args.staged.attachments) {
		const stored = currentAttachmentPairFromStage(attachment);
		if (stored.publicRow === null) {
			throw new Error("Staged attachment unexpectedly decoded as deleted");
		}
		await idbCommitAttachment({
			database: mediaDatabaseName({
				identity: args.identity,
				projectId: attachment.projectId,
			}),
			mediaStore: args.identity.mediaStore,
			authorityStore: attachmentAuthorityStoreName(args.identity.mediaStore),
			metadata: stored.publicRow,
			authority: stored.authorityRow,
			context: {
				operation: "save-attachment",
				scope: {
					kind: "attachment",
					projectId: attachment.projectId,
					key: attachment.key,
				},
			},
		});
	}
	await args.hooks?.beforeProjectCommit?.(args.staged.id);
	const project = currentProjectPairFromStage(args.staged);
	if (project.publicRow === null) {
		throw new Error("Staged project unexpectedly decoded as deleted");
	}
	await idbCommitProjectSave({
		database: args.identity.projectsDatabase,
		projectStore: args.identity.projectsStore,
		authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
		maintenanceStore: cascadeMaintenanceStoreName(args.identity.projectsStore),
		maintenanceKey: projectTombstoneKey(args.staged.id),
		project: project.publicRow,
		projectAuthority: project.authorityRow,
		context: {
			operation: "save-project",
			scope: migrationScope(args.staged.id),
		},
	});
}

async function validateCommittedProject(args: {
	identity: BrowserStorageIdentity;
	expected: StagedProject;
	hooks?: BrowserMigrationHooks;
}): Promise<void> {
	await args.hooks?.beforeCommittedReadback?.(args.expected.id);
	const projectPair = await idbGetProjectPair({
		database: args.identity.projectsDatabase,
		projectStore: args.identity.projectsStore,
		authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
		key: args.expected.id,
		context: {
			operation: "load-project",
			scope: migrationScope(args.expected.id),
		},
	});
	const project = decodeStoredProjectPair(projectPair);
	const expectedProject = decodeStoredProject(args.expected.storedProject);
	if (
		!project ||
		!expectedProject ||
		!deepEqual({ left: project, right: expectedProject })
	) {
		throw new Error(
			"Committed project readback did not match its staged value",
		);
	}
	for (const attachment of args.expected.attachments) {
		const pair = await idbGetAttachmentPair({
			database: mediaDatabaseName({
				identity: args.identity,
				projectId: attachment.projectId,
			}),
			mediaStore: args.identity.mediaStore,
			authorityStore: attachmentAuthorityStoreName(args.identity.mediaStore),
			key: attachment.key,
			context: {
				operation: "load-attachment",
				scope: {
					kind: "attachment",
					projectId: attachment.projectId,
					key: attachment.key,
				},
			},
		});
		const decoded = decodeStoredAttachmentPair({
			projectId: attachment.projectId,
			publicRow: pair.publicRow,
			authorityRow: pair.authorityRow,
		});
		if (decoded?.kind !== "attachment") {
			throw new Error(
				"Committed attachment metadata readback did not validate",
			);
		}
		const committed = await fingerprintCurrentAttachment({
			identity: args.identity,
			projectId: attachment.projectId,
			storedMetadata: attachment.storedMetadata,
			decoded,
		});
		if (
			!attachmentFingerprintsEqual({
				projectId: attachment.projectId,
				key: attachment.key,
				left: committed,
				right: attachment.staged,
			})
		) {
			throw new Error(
				"Committed attachment metadata readback did not validate",
			);
		}
		const body = await opfsRead({
			directory: mediaDirectoryName({
				identity: args.identity,
				projectId: attachment.projectId,
			}),
			key: decoded.bodyKey,
			context: {
				operation: "load-attachment",
				scope: {
					kind: "attachment",
					projectId: attachment.projectId,
					key: attachment.key,
				},
			},
		});
		if (!body || !deepEqual({ left: body, right: attachment.body })) {
			throw new Error("Committed attachment body readback did not validate");
		}
	}
}

function currentProjectPairFromStage(staged: StagedProject) {
	const decoded = decodeStoredProject(staged.storedProject);
	if (!decoded) throw new Error("Staged project is invalid");
	return createCurrentStoredProject(decoded);
}

function currentAttachmentPairFromStage(staged: StagedAttachment) {
	const decoded = decodeStoredAttachment({
		projectId: staged.projectId,
		value: staged.storedMetadata,
	});
	if (!decoded || decoded.mutationId === null) {
		throw new Error("Staged attachment is invalid");
	}
	return createCurrentStoredAttachment({
		projectId: staged.projectId,
		key: staged.key,
		metadata: decoded.metadata,
		bodyKey: decoded.bodyKey,
		mutationId: decoded.mutationId,
		bodyDigest: staged.staged.bodyDigest,
		byteLength: staged.staged.byteLength,
		retiredBodyKeys: staged.staged.retiredBodyKeys,
	});
}

async function authorizeMigrationCleanup(args: {
	identity: BrowserStorageIdentity;
	targets: readonly CleanupTarget[];
	projectIds?: readonly string[];
	currentMedia?: readonly MediaPhysicalClaim[];
	sources?: readonly MigrationDatabaseSourceClaim[];
}): Promise<MigrationCleanupPermit> {
	const context = {
		operation: "inspect" as const,
		scope: { kind: "store" } as const,
	};
	const knownMedia = await readKnownMediaPhysicalClaims({
		identity: args.identity,
		context,
	});
	const currentMedia: MediaPhysicalClaim[] = [...(args.currentMedia ?? [])];
	for (const projectId of args.projectIds ?? []) {
		currentMedia.push(
			await currentMediaPhysicalClaim({
				identity: args.identity,
				projectId,
				context,
			}),
		);
	}
	const knownLibraries = await readKnownLibraryPhysicalClaims({
		identity: args.identity,
		context,
	});
	return createBrowserStorageTopology(args.identity).authorize({
		kind: "migration-cleanup",
		databases: args.targets.map((target) =>
			migrationDatabaseClaim({ identity: args.identity, target }),
		),
		directories: [],
		sources: args.sources ?? [],
		knownMedia: [...knownMedia, ...currentMedia],
		knownLibraries,
		context,
	});
}

function migrationDatabaseClaim(args: {
	identity: BrowserStorageIdentity;
	target: CleanupTarget;
}): MigrationDatabaseCleanupClaim {
	if (args.target.kind === "legacy-database") {
		if (!args.target.projectId) {
			throw new Error("Legacy cleanup target has no project identity");
		}
		return {
			kind: "legacy-database",
			projectId: args.target.projectId,
			database: args.target.name,
		};
	}
	const stages = browserMigrationStageNames(args.identity.projectsDatabase);
	if (args.target.name === stages.projects.database) {
		return {
			kind: "stage-database",
			stage: "projects",
			database: args.target.name,
		};
	}
	if (args.target.name === stages.attachments.database) {
		return {
			kind: "stage-database",
			stage: "attachments",
			database: args.target.name,
		};
	}
	throw new Error("Migration cleanup stage target is outside its identity");
}

function cleanupTargetsFromPermit(
	permit: MigrationCleanupPermit,
): CleanupTarget[] {
	return permit.databases.map((target) =>
		target.kind === "stage-database"
			? { kind: "stage-database", name: target.database }
			: {
					kind: "legacy-database",
					name: target.database,
					projectId: target.projectId,
				},
	);
}

function reportMigrationTopologyConflict(args: {
	diagnostic?(diagnostic: BrowserStoreDiagnostic): void;
}): void {
	args.diagnostic?.({
		level: "warning",
		phase: "migration-cleanup-topology-conflict",
		operation: "inspect",
		scope: { kind: "store" },
		code: "unavailable",
		retryable: false,
	});
}

function cleanupTargetsForMigration(args: {
	identity: BrowserStorageIdentity;
	planned: readonly Pick<MigrationProjectPlan, "cleanupTargets">[];
}): CleanupTarget[] {
	return [
		...args.planned.flatMap((project) => project.cleanupTargets),
		{
			kind: "stage-database",
			name: stageDatabase({ identity: args.identity, kind: "projects" }),
		},
		{
			kind: "stage-database",
			name: stageDatabase({ identity: args.identity, kind: "attachments" }),
		},
	];
}

async function persistCleanupIntent(input: {
	args: Parameters<typeof runBrowserProjectMigration>[0];
	permit: MigrationCleanupPermit;
}): Promise<void> {
	const { args, permit } = input;
	await args.hooks?.beforeCleanupIntentWrite?.();
	await writeCleanupJournal({
		identity: args.identity,
		targets: cleanupTargetsFromPermit(permit),
	});
}

async function writeRecoveryJournal(args: {
	identity: BrowserStorageIdentity;
	staged: StagedProject[];
	permit: MigrationCleanupPermit;
}): Promise<void> {
	const cleanupTargets = cleanupTargetsFromPermit(args.permit);
	await idbPut({
		database: args.identity.projectsDatabase,
		store: cleanupJournalStore(args.identity),
		value: {
			id: "migration-recovery",
			revision: 2,
			projects: args.staged.map((project) => ({
				id: project.id,
				label: project.label,
				originalVersion: project.originalVersion,
				originalProject: project.originalProject,
				storedProject: project.storedProject,
				attachments: project.attachments.map((attachment) => ({
					key: attachment.key,
					original: attachment.original,
					staged: attachment.staged,
					migrationMutationId: attachment.migrationMutationId,
				})),
				cleanupTargets: project.cleanupTargets,
			})),
			cleanupTargets,
		},
		context: { operation: "save-project", scope: { kind: "store" } },
	});
}

async function readRecoveryJournal(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
}): Promise<MigrationRecoveryRecord | null> {
	const value = await idbGet<unknown>({
		database: args.identity.projectsDatabase,
		store: cleanupJournalStore(args.identity),
		key: "migration-recovery",
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	if (value === null) return null;
	if (
		!isRecord(value) ||
		value.id !== "migration-recovery" ||
		value.revision !== 2 ||
		!Array.isArray(value.projects) ||
		!Array.isArray(value.cleanupTargets)
	) {
		throw new Error("Migration recovery journal is invalid");
	}
	const cleanupTargets = value.cleanupTargets.map((target) =>
		decodeCleanupTarget({ ...args, target }),
	);
	const projects = value.projects.map((project): MigrationRecoveryProject => {
		if (
			!isRecord(project) ||
			typeof project.id !== "string" ||
			typeof project.label !== "string" ||
			typeof project.originalVersion !== "number" ||
			!isRecord(project.originalProject) ||
			!isRecord(project.storedProject) ||
			!Array.isArray(project.attachments) ||
			!Array.isArray(project.cleanupTargets)
		) {
			throw new Error("Migration recovery project is invalid");
		}
		const projectId = project.id;
		ensureDisposableProjectAllowed({
			identity: args.identity,
			policy: args.policy,
			projectId,
		});
		if (
			projectIdFromStored(project.originalProject) !== projectId ||
			decodeStoredProject(project.storedProject)?.record.id !== projectId ||
			projectVersionFromStored(project.storedProject) !==
				BROWSER_STORE_SCHEMA_VERSION
		) {
			throw new Error("Migration recovery project identity is invalid");
		}
		return {
			id: projectId,
			label: project.label,
			originalVersion: project.originalVersion,
			originalProject: project.originalProject,
			storedProject: project.storedProject,
			attachments: project.attachments.map((attachment) =>
				decodeRecoveryAttachment({
					projectId,
					attachment,
				}),
			),
			cleanupTargets: project.cleanupTargets.map((target) =>
				decodeCleanupTarget({ ...args, target }),
			),
		};
	});
	if (new Set(projects.map((project) => project.id)).size !== projects.length) {
		throw new Error("Migration recovery contains duplicate projects");
	}
	return {
		id: "migration-recovery",
		revision: 2,
		projects,
		cleanupTargets: mergeCleanupTargets(cleanupTargets),
	};
}

export async function hasPendingBrowserProjectMigrationAttachmentRecovery(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	projectId: string;
	key: string;
}): Promise<boolean> {
	authorizeStaticMigrationIdentity({
		identity: args.identity,
		operation: "inspect",
	});
	const recovery = await readRecoveryJournal(args);
	return (
		recovery?.projects.some(
			(project) =>
				project.id === args.projectId &&
				project.attachments.some((attachment) => attachment.key === args.key),
		) ?? false
	);
}

function decodeRecoveryAttachment(args: {
	projectId: string;
	attachment: unknown;
}): MigrationRecoveryAttachment {
	if (
		!isRecord(args.attachment) ||
		typeof args.attachment.key !== "string" ||
		args.attachment.key.length === 0 ||
		typeof args.attachment.migrationMutationId !== "string" ||
		args.attachment.migrationMutationId.length === 0
	) {
		throw new Error("Migration recovery attachment is invalid");
	}
	const original =
		args.attachment.original === null
			? null
			: decodeAttachmentFingerprint({
					projectId: args.projectId,
					key: args.attachment.key,
					value: args.attachment.original,
				});
	const staged = decodeAttachmentFingerprint({
		projectId: args.projectId,
		key: args.attachment.key,
		value: args.attachment.staged,
	});
	const decodedOriginal = original
		? decodeStoredAttachmentRecord({
				projectId: args.projectId,
				value: original.storedMetadata,
			})
		: null;
	const decoded = decodeStoredAttachment({
		projectId: args.projectId,
		value: staged.storedMetadata,
	});
	if (
		(original !== null &&
			(decodedOriginal?.kind !== "attachment" ||
				decodedOriginal.key !== args.attachment.key)) ||
		decoded?.revision !== 2 ||
		decoded.key !== args.attachment.key ||
		decoded.mutationId !== args.attachment.migrationMutationId ||
		decoded.bodyDigest !== staged.bodyDigest ||
		decoded.byteLength !== staged.byteLength
	) {
		throw new Error("Migration recovery staged attachment identity is invalid");
	}
	return {
		key: args.attachment.key,
		original,
		staged,
		migrationMutationId: args.attachment.migrationMutationId,
	};
}

function decodeAttachmentFingerprint(args: {
	projectId: string;
	key: string;
	value: unknown;
}): AttachmentFingerprint {
	const value = args.value;
	if (
		!isRecord(value) ||
		!isRecord(value.storedMetadata) ||
		typeof value.bodyDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(value.bodyDigest) ||
		!isNonNegativeSafeInteger(value.byteLength)
	) {
		throw new Error("Migration recovery attachment fingerprint is invalid");
	}
	const decoded = decodeStoredAttachmentRecord({
		projectId: args.projectId,
		value: value.storedMetadata,
	});
	const retiredBodyKeys = decodeRecoveryRetiredBodyKeys({
		value: value.retiredBodyKeys,
		bodyKey: decoded?.kind === "attachment" ? decoded.bodyKey : null,
	});
	if (decoded?.key !== args.key) {
		throw new Error("Migration recovery attachment fingerprint is invalid");
	}
	return {
		storedMetadata: value.storedMetadata,
		bodyDigest: value.bodyDigest,
		byteLength: value.byteLength,
		retiredBodyKeys,
	};
}

function decodeRecoveryRetiredBodyKeys(args: {
	value: unknown;
	bodyKey: string | null;
}): readonly string[] {
	if (args.value === undefined) return [];
	if (
		!Array.isArray(args.value) ||
		args.value.some((key) => typeof key !== "string" || key.length === 0) ||
		new Set(args.value).size !== args.value.length ||
		(args.bodyKey !== null && args.value.includes(args.bodyKey))
	) {
		throw new Error("Migration recovery retired body keys are invalid");
	}
	return [...args.value];
}

async function deleteRecoveryJournal(
	identity: BrowserStorageIdentity,
): Promise<void> {
	await idbDelete({
		database: identity.projectsDatabase,
		store: cleanupJournalStore(identity),
		key: "migration-recovery",
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

export async function retryBrowserProjectMigrationRecovery(
	args: CleanupRetryArgs,
): Promise<void> {
	authorizeStaticMigrationIdentity({
		identity: args.identity,
		operation: "inspect",
	});
	let recovery: MigrationRecoveryRecord | null;
	try {
		recovery = await readRecoveryJournal(args);
		if (!recovery) return;
		ensureMigrationAllowed(args);
		const existing = await readCleanupJournal(args);
		const permit = await authorizeMigrationCleanup({
			identity: args.identity,
			targets: mergeCleanupTargets([
				...existing,
				...recovery.cleanupTargets,
				...recovery.projects.flatMap((project) => project.cleanupTargets),
			]),
			projectIds: recovery.projects.map((project) => project.id),
		});
		await args.hooks?.beforeCleanupIntentWrite?.();
		await writeCleanupJournal({
			identity: args.identity,
			targets: cleanupTargetsFromPermit(permit),
		});
		for (const project of recovery.projects) {
			const staged = await readRecoveryStage({
				identity: args.identity,
				project,
			});
			const destinationPair = await idbGetProjectPair({
				database: args.identity.projectsDatabase,
				projectStore: args.identity.projectsStore,
				authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
				key: project.id,
				context: {
					operation: "load-project",
					scope: migrationScope(project.id),
				},
			});
			if (
				destinationPair.publicRow === null &&
				destinationPair.authorityRow === null
			) {
				throw new Error("Migration recovery project is physically absent");
			}
			const destination = decodeStoredProjectPair(destinationPair);
			const original = decodeStoredProject(project.originalProject);
			const expected = decodeStoredProject(project.storedProject);
			if (!destination || !original || !expected) {
				throw new Error("Migration recovery found an invalid project pair");
			}
			const projectState = deepEqual({
				left: destination,
				right: original,
			})
				? "original"
				: deepEqual({ left: destination, right: expected })
					? "staged"
					: null;
			if (projectState) {
				await registerMediaOwner({
					identity: args.identity,
					projectId: project.id,
					context: {
						operation: "list-attachments",
						scope: { kind: "project", projectId: project.id },
					},
				});
				await reconcileRecoveryAttachments({
					identity: args.identity,
					project,
					staged,
					projectState,
				});
				if (projectState === "original") {
					await commitStagedProjectRow({
						identity: args.identity,
						staged,
					});
				}
				await validateCommittedProjectRow({
					identity: args.identity,
					expected: staged,
				});
				continue;
			}
			if (destination.record.schemaVersion !== BROWSER_STORE_SCHEMA_VERSION) {
				throw new Error("Migration recovery found an ambiguous destination");
			}
		}
		await deleteRecoveryJournal(args.identity);
		await retryPendingCleanup({
			args,
			phase: "migration-recovery-cleanup",
		});
	} catch (error) {
		if (isBrowserStorageTopologyConflict(error)) {
			reportMigrationTopologyConflict(args);
			throw new ProjectStoreError({
				code: "unavailable",
				operation: "inspect",
				scope: { kind: "store" },
			});
		}
		args.diagnostic?.({
			level: "warning",
			phase: "migration-recovery",
			operation: "inspect",
			scope: { kind: "store" },
			code: "unavailable",
			retryable: true,
		});
		throw error;
	}
}

async function reconcileRecoveryAttachments(args: {
	identity: BrowserStorageIdentity;
	project: MigrationRecoveryProject;
	staged: StagedProject;
	projectState: "original" | "staged";
}): Promise<void> {
	if (args.project.attachments.length !== args.staged.attachments.length) {
		throw new Error("Migration recovery attachment journal differs from stage");
	}
	for (const recovery of args.project.attachments) {
		const staged = args.staged.attachments.find(
			(attachment) => attachment.key === recovery.key,
		);
		if (
			!staged ||
			staged.migrationMutationId !== recovery.migrationMutationId ||
			!deepEqual({ left: staged.original, right: recovery.original }) ||
			!deepEqual({ left: staged.staged, right: recovery.staged })
		) {
			throw new Error("Migration recovery attachment stage is inconsistent");
		}
		const database = mediaDatabaseName({
			identity: args.identity,
			projectId: args.project.id,
		});
		const scope = {
			kind: "attachment",
			projectId: args.project.id,
			key: recovery.key,
		} as const;
		const pair = await idbGetAttachmentPair({
			database,
			mediaStore: args.identity.mediaStore,
			authorityStore: attachmentAuthorityStoreName(args.identity.mediaStore),
			key: recovery.key,
			context: { operation: "load-attachment", scope },
		});
		if (pair.publicRow === null && pair.authorityRow === null) {
			throw new Error("Migration recovery attachment is physically absent");
		}
		const decoded = decodeStoredAttachmentPair({
			projectId: args.project.id,
			publicRow: pair.publicRow,
			authorityRow: pair.authorityRow,
		});
		if (!decoded) {
			throw new Error("Migration recovery attachment metadata is invalid");
		}
		if (decoded.kind === "tombstone") {
			if (decoded.mutationId === recovery.migrationMutationId) {
				throw new Error("Migration recovery attachment tombstone is ambiguous");
			}
			continue;
		}
		if (
			(decoded.revision === 2 || decoded.revision === "current") &&
			decoded.mutationId !== recovery.migrationMutationId
		) {
			// A different authenticated mutation is a later ordinary save. Recovery
			// must not compare its contents to, or overwrite it with, migration state.
			continue;
		}
		const current = await fingerprintCurrentAttachment({
			identity: args.identity,
			projectId: args.project.id,
			storedMetadata:
				decoded.revision === "current"
					? recovery.staged.storedMetadata
					: pair.publicRow,
			decoded,
		});
		if (decoded.revision === "current") {
			if (
				decoded.mutationId === recovery.migrationMutationId &&
				(await attachmentFingerprintMatchesMigrationCleanupProgress({
					identity: args.identity,
					projectId: args.project.id,
					key: recovery.key,
					current,
					expected: recovery.staged,
				}))
			) {
				continue;
			}
			throw new Error("Migration recovery attachment state is ambiguous");
		}
		const isOriginal =
			recovery.original !== null &&
			attachmentFingerprintsEqual({
				projectId: args.project.id,
				key: recovery.key,
				left: current,
				right: recovery.original,
			});
		if (isOriginal) {
			if (args.projectState === "staged") {
				throw new Error(
					"Migration recovery found original attachment under staged project",
				);
			}
			const stored = currentAttachmentPairFromStage(staged);
			if (stored.publicRow === null) {
				throw new Error("Staged attachment unexpectedly decoded as deleted");
			}
			await idbCommitAttachment({
				database,
				mediaStore: args.identity.mediaStore,
				authorityStore: attachmentAuthorityStoreName(args.identity.mediaStore),
				metadata: stored.publicRow,
				authority: stored.authorityRow,
				context: { operation: "save-attachment", scope },
			});
			const committed = await fingerprintCurrentAttachment({
				identity: args.identity,
				projectId: args.project.id,
				storedMetadata: staged.storedMetadata,
				decoded: decodeStoredAttachment({
					projectId: args.project.id,
					value: staged.storedMetadata,
				})!,
			});
			if (
				!attachmentFingerprintsEqual({
					projectId: args.project.id,
					key: recovery.key,
					left: committed,
					right: recovery.staged,
				})
			) {
				throw new Error(
					"Migration recovery staged attachment did not validate",
				);
			}
			continue;
		}
		if (
			attachmentFingerprintsEqual({
				projectId: args.project.id,
				key: recovery.key,
				left: current,
				right: recovery.staged,
			}) &&
			decoded.mutationId === recovery.migrationMutationId
		) {
			continue;
		}
		throw new Error("Migration recovery attachment state is ambiguous");
	}
}

async function attachmentFingerprintMatchesMigrationCleanupProgress(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	key: string;
	current: AttachmentFingerprint;
	expected: AttachmentFingerprint;
}): Promise<boolean> {
	const currentLogical = attachmentFingerprintLogical({
		projectId: args.projectId,
		key: args.key,
		fingerprint: args.current,
	});
	const expectedLogical = attachmentFingerprintLogical({
		projectId: args.projectId,
		key: args.key,
		fingerprint: args.expected,
	});
	if (!currentLogical || !expectedLogical) return false;
	const {
		retiredBodyKeys: _currentRetiredBodyKeys,
		...currentWithoutCleanupIntent
	} = currentLogical;
	const {
		retiredBodyKeys: _expectedRetiredBodyKeys,
		...expectedWithoutCleanupIntent
	} = expectedLogical;
	if (
		!deepEqual({
			left: currentWithoutCleanupIntent,
			right: expectedWithoutCleanupIntent,
		})
	) {
		return false;
	}

	const currentKeys = new Set(args.current.retiredBodyKeys);
	const expectedKeys = new Set(args.expected.retiredBodyKeys);
	if ([...currentKeys].some((key) => !expectedKeys.has(key))) return false;
	const expectedRemainingOrder = args.expected.retiredBodyKeys.filter((key) =>
		currentKeys.has(key),
	);
	if (
		!deepEqual({
			left: args.current.retiredBodyKeys,
			right: expectedRemainingOrder,
		})
	) {
		return false;
	}

	const removedKeys = args.expected.retiredBodyKeys.filter(
		(key) => !currentKeys.has(key),
	);
	for (const key of removedKeys) {
		const body = await opfsRead({
			directory: mediaDirectoryName({
				identity: args.identity,
				projectId: args.projectId,
			}),
			key,
			context: {
				operation: "load-attachment",
				scope: {
					kind: "attachment",
					projectId: args.projectId,
					key: args.key,
				},
			},
		});
		if (body !== null) return false;
	}
	return true;
}

async function fingerprintCurrentAttachment(args: {
	identity: BrowserStorageIdentity;
	projectId: string;
	storedMetadata: unknown;
	decoded: NonNullable<ReturnType<typeof decodeStoredAttachment>>;
}): Promise<AttachmentFingerprint> {
	if (!isRecord(args.storedMetadata)) {
		throw new Error("Migration recovery attachment metadata is invalid");
	}
	const body = await opfsRead({
		directory: mediaDirectoryName({
			identity: args.identity,
			projectId: args.projectId,
		}),
		key: args.decoded.bodyKey,
		context: {
			operation: "load-attachment",
			scope: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.decoded.key,
			},
		},
	});
	if (!body) throw new Error("Migration recovery attachment body is missing");
	const bodyDigest = await digestAttachmentBody(body);
	if (
		(args.decoded.revision === 2 || args.decoded.revision === "current") &&
		(args.decoded.byteLength !== body.byteLength ||
			args.decoded.bodyDigest !== bodyDigest)
	) {
		throw new Error(
			"Migration recovery attachment body fingerprint is invalid",
		);
	}
	const mutationId = args.decoded.mutationId;
	let storedMetadata = args.storedMetadata;
	if (args.decoded.revision === "current") {
		if (mutationId === null) {
			throw new Error("Migration recovery attachment mutation is invalid");
		}
		storedMetadata = createStoredAttachment({
			projectId: args.projectId,
			key: args.decoded.key,
			metadata: args.decoded.metadata,
			bodyKey: args.decoded.bodyKey,
			mutationId,
			bodyDigest,
			byteLength: body.byteLength,
		});
	}
	return {
		storedMetadata,
		bodyDigest,
		byteLength: body.byteLength,
		retiredBodyKeys: args.decoded.retiredBodyKeys,
	};
}

function attachmentFingerprintsEqual(args: {
	projectId: string;
	key: string;
	left: AttachmentFingerprint;
	right: AttachmentFingerprint;
}): boolean {
	const left = attachmentFingerprintLogical({
		projectId: args.projectId,
		key: args.key,
		fingerprint: args.left,
	});
	const right = attachmentFingerprintLogical({
		projectId: args.projectId,
		key: args.key,
		fingerprint: args.right,
	});
	return left !== null && right !== null && deepEqual({ left, right });
}

function attachmentFingerprintLogical(args: {
	projectId: string;
	key: string;
	fingerprint: AttachmentFingerprint;
}): Record<string, unknown> | null {
	const decoded = decodeStoredAttachmentRecord({
		projectId: args.projectId,
		value: args.fingerprint.storedMetadata,
	});
	if (
		decoded?.kind !== "attachment" ||
		decoded.key !== args.key ||
		(decoded.bodyDigest !== null &&
			decoded.bodyDigest !== args.fingerprint.bodyDigest) ||
		(decoded.byteLength !== null &&
			decoded.byteLength !== args.fingerprint.byteLength) ||
		args.fingerprint.retiredBodyKeys.includes(decoded.bodyKey)
	) {
		return null;
	}
	return {
		projectId: decoded.projectId,
		key: decoded.key,
		metadata: decoded.metadata,
		bodyKey: decoded.bodyKey,
		mutationId: decoded.mutationId,
		bodyDigest: args.fingerprint.bodyDigest,
		byteLength: args.fingerprint.byteLength,
		retiredBodyKeys: [...args.fingerprint.retiredBodyKeys],
	};
}

async function commitStagedProjectRow(args: {
	identity: BrowserStorageIdentity;
	staged: StagedProject;
}): Promise<void> {
	const project = currentProjectPairFromStage(args.staged);
	if (project.publicRow === null) {
		throw new Error("Staged project unexpectedly decoded as deleted");
	}
	await idbCommitProjectSave({
		database: args.identity.projectsDatabase,
		projectStore: args.identity.projectsStore,
		authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
		maintenanceStore: cascadeMaintenanceStoreName(args.identity.projectsStore),
		maintenanceKey: projectTombstoneKey(args.staged.id),
		project: project.publicRow,
		projectAuthority: project.authorityRow,
		context: {
			operation: "save-project",
			scope: migrationScope(args.staged.id),
		},
	});
}

async function validateCommittedProjectRow(args: {
	identity: BrowserStorageIdentity;
	expected: StagedProject;
}): Promise<void> {
	const pair = await idbGetProjectPair({
		database: args.identity.projectsDatabase,
		projectStore: args.identity.projectsStore,
		authorityStore: projectAuthorityStoreName(args.identity.projectsStore),
		key: args.expected.id,
		context: {
			operation: "load-project",
			scope: migrationScope(args.expected.id),
		},
	});
	const project = decodeStoredProjectPair(pair);
	const expected = decodeStoredProject(args.expected.storedProject);
	if (!project || !expected || !deepEqual({ left: project, right: expected })) {
		throw new Error(
			"Committed project readback did not match its staged value",
		);
	}
}

async function readRecoveryStage(args: {
	identity: BrowserStorageIdentity;
	project: MigrationRecoveryProject;
}): Promise<StagedProject> {
	const stored = await idbGet<{ id: string; value: unknown }>({
		...stageStorage({ identity: args.identity, kind: "projects" }),
		key: args.project.id,
		context: {
			operation: "load-project",
			scope: migrationScope(args.project.id),
		},
	});
	if (
		!stored ||
		!deepEqual({ left: stored.value, right: args.project.storedProject })
	) {
		throw new Error("Migration recovery project stage is unavailable");
	}
	const rows = await idbGetAll<unknown>({
		...stageStorage({ identity: args.identity, kind: "attachments" }),
		context: {
			operation: "list-attachments",
			scope: migrationScope(args.project.id),
		},
	});
	const attachments = rows
		.filter(
			(row): row is Record<string, unknown> =>
				isRecord(row) && row.projectId === args.project.id,
		)
		.map((row): StagedAttachment => {
			if (
				typeof row.id !== "string" ||
				typeof row.projectId !== "string" ||
				typeof row.key !== "string" ||
				!isRecord(row.storedMetadata) ||
				!(row.body instanceof ArrayBuffer) ||
				!isRecord(row.original) ||
				!isRecord(row.staged) ||
				typeof row.migrationMutationId !== "string"
			) {
				throw new Error("Migration recovery attachment stage is invalid");
			}
			const decodedRecovery = decodeRecoveryAttachment({
				projectId: row.projectId,
				attachment: {
					key: row.key,
					original: row.original,
					staged: row.staged,
					migrationMutationId: row.migrationMutationId,
				},
			});
			if (!decodedRecovery.original) {
				throw new Error("Migration recovery stage lost original fingerprint");
			}
			if (
				!deepEqual({
					left: row.storedMetadata,
					right: decodedRecovery.staged.storedMetadata,
				})
			) {
				throw new Error("Migration recovery stage metadata is inconsistent");
			}
			return {
				id: row.id,
				projectId: row.projectId,
				key: row.key,
				storedMetadata: row.storedMetadata,
				body: row.body,
				original: decodedRecovery.original,
				staged: decodedRecovery.staged,
				migrationMutationId: decodedRecovery.migrationMutationId,
			};
		});
	for (const attachment of attachments) {
		if (
			attachment.body.byteLength !== attachment.staged.byteLength ||
			(await digestAttachmentBody(attachment.body)) !==
				attachment.staged.bodyDigest
		) {
			throw new Error("Migration recovery stage body is inconsistent");
		}
	}
	if (
		new Set(attachments.map((attachment) => attachment.key)).size !==
		attachments.length
	) {
		throw new Error("Migration recovery stage contains duplicate attachments");
	}
	const staged: StagedProject = {
		...args.project,
		attachments,
	};
	await validateStage({ identity: args.identity, expected: staged });
	return staged;
}

export async function retryBrowserProjectMigrationCleanup(
	args: CleanupRetryArgs,
): Promise<void> {
	authorizeStaticMigrationIdentity({
		identity: args.identity,
		operation: "inspect",
	});
	await retryPendingCleanup({ args });
}

async function retryPendingCleanup({
	args,
	phase = "migration-cleanup-retry",
}: {
	args: CleanupRetryArgs;
	phase?: string;
}): Promise<void> {
	let targets: CleanupTarget[];
	let permit: MigrationCleanupPermit;
	try {
		targets = await readCleanupJournal(args);
		if (targets.length === 0) return;
		permit = await authorizeMigrationCleanup({
			identity: args.identity,
			targets,
			projectIds: [],
		});
	} catch (error) {
		if (isBrowserStorageTopologyConflict(error)) {
			reportMigrationTopologyConflict(args);
			return;
		}
		args.diagnostic?.({
			level: "warning",
			phase,
			code: "unavailable",
			retryable: true,
		});
		return;
	}
	targets = cleanupTargetsFromPermit(permit);
	for (const target of [...targets]) {
		try {
			await args.hooks?.beforeCleanup?.(target.name);
			await deleteDatabaseExact(target.name);
			targets = targets.filter(
				(candidate) => cleanupTargetKey(candidate) !== cleanupTargetKey(target),
			);
			await writeCleanupJournal({ identity: args.identity, targets });
		} catch {
			args.diagnostic?.({
				level: "warning",
				phase,
				code: "unavailable",
				retryable: true,
			});
		}
	}
}

function cleanupJournalStore(identity: BrowserStorageIdentity): string {
	return browserProjectTopologyStoreNames(identity.projectsStore)
		.migrationMaintenance;
}

async function readCleanupJournal(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
}): Promise<CleanupTarget[]> {
	const value = await idbGet<unknown>({
		database: args.identity.projectsDatabase,
		store: cleanupJournalStore(args.identity),
		key: "postcommit-cleanup",
		context: { operation: "inspect", scope: { kind: "store" } },
	});
	if (value === null) return [];
	if (
		!isRecord(value) ||
		value.id !== "postcommit-cleanup" ||
		value.revision !== 1 ||
		!Array.isArray(value.targets)
	) {
		throw new Error("Migration cleanup journal is invalid");
	}
	const targets = value.targets.map((target) =>
		decodeCleanupTarget({ ...args, target }),
	);
	return mergeCleanupTargets(targets);
}

function decodeCleanupTarget(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	target: unknown;
}): CleanupTarget {
	if (
		!isRecord(args.target) ||
		(args.target.kind !== "legacy-database" &&
			args.target.kind !== "stage-database") ||
		typeof args.target.name !== "string" ||
		(args.target.projectId !== undefined &&
			typeof args.target.projectId !== "string")
	) {
		throw new Error("Migration cleanup target is invalid");
	}
	const decoded: CleanupTarget = {
		kind: args.target.kind,
		name: args.target.name,
		...(typeof args.target.projectId === "string"
			? { projectId: args.target.projectId }
			: {}),
	};
	assertCleanupTargetAllowed({ ...args, target: decoded });
	return decoded;
}

async function writeCleanupJournal(args: {
	identity: BrowserStorageIdentity;
	targets: CleanupTarget[];
}): Promise<void> {
	if (args.targets.length === 0) {
		await idbDelete({
			database: args.identity.projectsDatabase,
			store: cleanupJournalStore(args.identity),
			key: "postcommit-cleanup",
			context: { operation: "clear", scope: { kind: "store" } },
		});
		return;
	}
	await idbPut({
		database: args.identity.projectsDatabase,
		store: cleanupJournalStore(args.identity),
		value: {
			id: "postcommit-cleanup",
			revision: 1,
			targets: mergeCleanupTargets(args.targets),
		},
		context: { operation: "clear", scope: { kind: "store" } },
	});
}

function mergeCleanupTargets(targets: CleanupTarget[]): CleanupTarget[] {
	return [
		...new Map(
			targets.map((target) => [cleanupTargetKey(target), target]),
		).values(),
	];
}

function cleanupTargetKey(target: CleanupTarget): string {
	return JSON.stringify([target.kind, target.name, target.projectId ?? null]);
}

function assertCleanupTargetAllowed(args: {
	identity: BrowserStorageIdentity;
	policy: BrowserMigrationPolicy;
	target: CleanupTarget;
}): void {
	if (args.target.kind === "stage-database") {
		const allowed = new Set([
			stageDatabase({ identity: args.identity, kind: "projects" }),
			stageDatabase({ identity: args.identity, kind: "attachments" }),
		]);
		if (!allowed.has(args.target.name)) {
			throw new Error("Migration cleanup stage target is outside its identity");
		}
		return;
	}
	if (!args.target.projectId) {
		throw new Error("Legacy cleanup target has no project identity");
	}
	assertLegacyTargetAllowed({
		identity: args.identity,
		policy: args.policy,
		target: {
			kind: "database",
			name: args.target.name,
			projectId: args.target.projectId,
		},
	});
}

async function cleanupStageDatabases(args: {
	identity: BrowserStorageIdentity;
	permit: MigrationCleanupPermit;
}): Promise<void> {
	await Promise.all(
		args.permit.databases
			.filter((target) => target.kind === "stage-database")
			.map((target) => deleteDatabaseExact(target.database)),
	);
}

function deepEqual(args: { left: unknown; right: unknown }): boolean {
	const { left, right } = args;
	if (Object.is(left, right)) return true;
	if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
		return deepEqual({
			left: [...new Uint8Array(left)],
			right: [...new Uint8Array(right)],
		});
	}
	if (left instanceof Date && right instanceof Date)
		return left.getTime() === right.getTime();
	if (left instanceof Map && right instanceof Map) {
		return deepEqual({
			left: [...left.entries()],
			right: [...right.entries()],
		});
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((item, index) =>
				deepEqual({ left: item, right: right[index] }),
			)
		);
	}
	if (!isRecord(left) || !isRecord(right)) return false;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		deepEqual({ left: leftKeys, right: rightKeys }) &&
		leftKeys.every((key) => deepEqual({ left: left[key], right: right[key] }))
	);
}

export function resetBrowserMigrationStateForTests(): void {
	// Durable cleanup state lives in the identity's journal. Runtime reset must
	// not erase it: the reload/reopen probe depends on that distinction.
}
