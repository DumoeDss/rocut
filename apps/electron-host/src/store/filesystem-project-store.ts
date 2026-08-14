/**
 * s05-second-host — `FilesystemProjectStore` (design E4): the `ProjectStore`
 * the desktop Host composes, over a `ProjectStoreFiles` bridge.
 *
 * The store owns no file I/O and no schema logic:
 *
 * - Every byte movement is the bridge's (`IpcStoreBridge` in production,
 *   `NodeFsStoreBridge` under `bun test` — the same store class in both).
 * - `schemaVersion` is `CURRENT_PROJECT_VERSION` from
 *   `@opencut/editor-classic/storage`; `migrate()` walks the published
 *   `migrations` transform list, the same per-record chain
 *   `runStorageMigrations` applies in the legacy browser runner and
 *   `runBrowserProjectMigration.transformLegacyProject` applies in the port
 *   browser store. The transforms and the version constant are the published
 *   artifacts; this class sequences them and nothing more.
 *
 * Migration policy mirrors the browser store's: the production identity
 * migrates by default, any other identity refuses unless the constructor is
 * handed an explicit disposable opt-in, and `disabled` always refuses — the
 * "no opt-in" refusal the C5 analog probes exercise.
 */
import type {
	LibraryRecord,
	MigrationContext,
	MigrationOutcome,
	ProjectAttachment,
	ProjectId,
	ProjectRecord,
	ProjectStore,
	ProjectStoreClearScope,
	ProjectStoreErrorScope,
	ProjectStoreErrorCode,
	ProjectStoreInspection,
	ProjectStoreOperation,
	ProjectSummary,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import {
	CURRENT_PROJECT_VERSION,
	migrations as publishedMigrations,
	type StorageMigration,
} from "@opencut/editor-classic/storage";
import type { ProjectStoreFiles } from "./project-store-files";

export const FILESYSTEM_STORE_SCHEMA_VERSION = CURRENT_PROJECT_VERSION;

/** The identity the Electron main process binds to `userData/projects`. */
export const DEFAULT_FILESYSTEM_STORE_IDENTITY = "opencut-fs-production";

export type FilesystemMigrationPolicy =
	| { readonly kind: "production" }
	| {
			readonly kind: "disposable";
			readonly identity: string;
			readonly prefix: string;
	  }
	| { readonly kind: "disabled" };

/** Sanitize a clone failure into the port's typed taxonomy (no raw cause). */
function clonePayload<Value>(value: Value, failure: {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
}): Value {
	try {
		if (typeof structuredClone !== "function") {
			throw new Error("This Host does not provide structured cloning");
		}
		return structuredClone(value);
	} catch {
		throw new ProjectStoreError({
			code: "corrupt",
			operation: failure.operation,
			scope: failure.scope,
			message: `Project store ${failure.operation} received an invalid opaque value`,
		});
	}
}

function throwIfAborted(args: {
	operation: ProjectStoreOperation;
	scope: ProjectStoreErrorScope;
	signal?: AbortSignal;
}): void {
	if (!args.signal?.aborted) return;
	throw new ProjectStoreError({
		code: "aborted",
		operation: args.operation,
		scope: args.scope,
	});
}

export interface FilesystemMutationPause {
	readonly entered: Promise<void>;
	release(): void;
}

interface PendingMutationPause {
	readonly operation: ProjectStoreOperation;
	readonly entered: () => void;
	readonly wait: Promise<void>;
}

/**
 * Fault and scheduling control for the conformance matrix — the in-memory
 * reference control's shape, instrumenting this store's commit seam. Test and
 * evidence plumbing only; never visible through `ProjectStore`.
 */
export class FilesystemProjectStoreControl {
	private inspection: ProjectStoreInspection = {
		availability: "available",
		capacity: null,
	};
	private readonly failures: Array<{
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}> = [];
	private readonly pauses: PendingMutationPause[] = [];

	setInspection(inspection: ProjectStoreInspection): void {
		this.inspection = clonePayload(inspection, {
			operation: "inspect",
			scope: { kind: "store" },
		});
	}

	readInspection(): ProjectStoreInspection {
		return clonePayload(this.inspection, {
			operation: "inspect",
			scope: { kind: "store" },
		});
	}

	failNext(args: {
		operation: ProjectStoreOperation;
		code: ProjectStoreErrorCode;
	}): void {
		this.failures.push(args);
	}

	pauseNext(args: {
		operation: ProjectStoreOperation;
	}): FilesystemMutationPause {
		let markEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		let release!: () => void;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.pauses.push({ operation: args.operation, entered: markEntered, wait });
		return { entered, release };
	}

	async beforeCommit(args: {
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
		signal?: AbortSignal;
	}): Promise<void> {
		throwIfAborted(args);
		const failureIndex = this.failures.findIndex(
			(item) => item.operation === args.operation,
		);
		if (failureIndex >= 0) {
			const [failure] = this.failures.splice(failureIndex, 1);
			throw new ProjectStoreError({
				code: failure.code,
				operation: args.operation,
				scope: args.scope,
			});
		}
		const pauseIndex = this.pauses.findIndex(
			(item) => item.operation === args.operation,
		);
		if (pauseIndex >= 0) {
			const [pause] = this.pauses.splice(pauseIndex, 1);
			pause.entered();
			await pause.wait;
			throwIfAborted(args);
		}
	}
}

type MutationIdentity =
	| { readonly kind: "project-record"; readonly projectId: ProjectId }
	| {
			readonly kind: "attachment";
			readonly projectId: ProjectId;
			readonly key: string;
	  }
	| { readonly kind: "project-tree"; readonly projectId: ProjectId }
	| { readonly kind: "all-projects" }
	| {
			readonly kind: "library-record";
			readonly namespace: string;
			readonly key: string;
	  }
	| { readonly kind: "library-namespace"; readonly namespace: string }
	| { readonly kind: "all" };

interface PendingMutation {
	readonly identity: MutationIdentity;
	readonly completion: Promise<void>;
}

function mutationsConflict(
	left: MutationIdentity,
	right: MutationIdentity,
): boolean {
	if (left.kind === "all" || right.kind === "all") return true;
	if (left.kind === "all-projects" || right.kind === "all-projects") {
		const projectKinds = ["project-record", "attachment", "project-tree", "all-projects"];
		return (
			projectKinds.includes(left.kind) && projectKinds.includes(right.kind)
		);
	}
	if (left.kind === "project-tree") {
		return (
			(right.kind === "project-record" ||
				right.kind === "attachment" ||
				right.kind === "project-tree") &&
			right.projectId === left.projectId
		);
	}
	if (right.kind === "project-tree") {
		return (
			(left.kind === "project-record" || left.kind === "attachment") &&
			left.projectId === right.projectId
		);
	}
	if (left.kind === "project-record" && right.kind === "project-record") {
		return left.projectId === right.projectId;
	}
	if (left.kind === "attachment" && right.kind === "attachment") {
		return left.projectId === right.projectId && left.key === right.key;
	}
	if (left.kind === "library-namespace") {
		return isLibraryMutation(right) && left.namespace === right.namespace;
	}
	if (right.kind === "library-namespace") {
		return isLibraryMutation(left) && right.namespace === left.namespace;
	}
	if (left.kind === "library-record" && right.kind === "library-record") {
		return left.namespace === right.namespace && left.key === right.key;
	}
	return false;
}

function isLibraryMutation(
	identity: MutationIdentity,
): identity is Extract<
	MutationIdentity,
	{ kind: "library-record" } | { kind: "library-namespace" }
> {
	return identity.kind === "library-record" || identity.kind === "library-namespace";
}

interface MigrationState {
	completed: boolean;
	inFlight: Promise<MigrationOutcome> | null;
}

export interface FilesystemProjectStoreOptions {
	readonly migrationPolicy?: FilesystemMigrationPolicy;
	/** Test/adapter conformance control; never visible through `ProjectStore`. */
	readonly control?: FilesystemProjectStoreControl;
	/**
	 * Migration probe plumbing, never used by a production Host: the transform
	 * list defaults to the published `migrations`; a probe may substitute its
	 * own to stage a deliberately failing or refusing transform.
	 */
	readonly migrations?: readonly StorageMigration[];
}

export class FilesystemProjectStore implements ProjectStore {
	readonly schemaVersion = FILESYSTEM_STORE_SCHEMA_VERSION;

	private readonly bridge: ProjectStoreFiles;
	private readonly bridgeIdentity: string;
	private readonly migrationPolicy: FilesystemMigrationPolicy;
	private readonly migrations: readonly StorageMigration[];
	private readonly control: FilesystemProjectStoreControl;
	private readonly pendingMutations = new Set<PendingMutation>();
	private readonly migrationState: MigrationState = {
		completed: false,
		inFlight: null,
	};

	constructor(
		bridge: ProjectStoreFiles,
		options: FilesystemProjectStoreOptions & {
			readonly identity: string;
		},
	) {
		this.bridge = bridge;
		this.bridgeIdentity = options.identity;
		this.migrationPolicy =
			options.migrationPolicy ??
			(this.bridgeIdentity === DEFAULT_FILESYSTEM_STORE_IDENTITY
				? { kind: "production" }
				: { kind: "disabled" });
		this.migrations = options.migrations ?? publishedMigrations;
		this.control = options.control ?? new FilesystemProjectStoreControl();
	}

	/** Map any bridge-level failure into the port's typed taxonomy. */
	private async throughBridge<Result>(
		operation: ProjectStoreOperation,
		scope: ProjectStoreErrorScope,
		run: () => Promise<Result>,
	): Promise<Result> {
		try {
			return await run();
		} catch (error) {
			if (error instanceof ProjectStoreError) throw error;
			// The bridge's own error class (and any unexpected failure) carries
			// implementation detail; only the typed code crosses this seam.
			throw new ProjectStoreError({
				code: "unavailable",
				operation,
				scope,
			});
		}
	}

	private async enqueue<Result>({
		identity,
		operation,
	}: {
		identity: MutationIdentity;
		operation: () => Promise<Result>;
	}): Promise<Result> {
		const blockers = [...this.pendingMutations]
			.filter((pending) => mutationsConflict(pending.identity, identity))
			.map((pending) => pending.completion);
		let complete!: () => void;
		const completion = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const pending: PendingMutation = { identity, completion };
		this.pendingMutations.add(pending);
		try {
			await Promise.all(blockers);
			return await operation();
		} finally {
			this.pendingMutations.delete(pending);
			complete();
		}
	}

	async list(
		args: { signal?: AbortSignal } = {},
	): Promise<readonly ProjectSummary[]> {
		const scope = { kind: "store" } as const;
		throwIfAborted({ operation: "list-projects", scope, signal: args.signal });
		const listings = await this.throughBridge(
			"list-projects",
			scope,
			() => this.bridge.listRecords(),
		);
		return listings.map((listing) =>
			clonePayload(listing.summary, { operation: "list-projects", scope }),
		);
	}

	async load(args: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<ProjectRecord | null> {
		const scope = { kind: "project", projectId: args.id } as const;
		throwIfAborted({ operation: "load-project", scope, signal: args.signal });
		const stored = await this.throughBridge("load-project", scope, () =>
			this.bridge.loadRecord(args.id),
		);
		if (!stored) return null;
		return clonePayload(stored.record, {
			operation: "load-project",
			scope,
		});
	}

	async save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: args.record.id } as const;
		throwIfAborted({ operation: "save-project", scope, signal: args.signal });
		if (args.record.id !== args.summary.id) {
			throw new ProjectStoreError({
				code: "conflict",
				operation: "save-project",
				scope,
				message: "Project record and summary identities do not match",
			});
		}
		const record = clonePayload(args.record, {
			operation: "save-project",
			scope,
		});
		const summary = clonePayload(args.summary, {
			operation: "save-project",
			scope,
		});
		await this.enqueue({
			identity: { kind: "project-record", projectId: args.record.id },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-project",
					scope,
					signal: args.signal,
				});
				await this.throughBridge("save-project", scope, () =>
					this.bridge.saveRecord({ record, summary }),
				);
			},
		});
	}

	async remove(args: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: args.id } as const;
		throwIfAborted({ operation: "remove-project", scope, signal: args.signal });
		await this.enqueue({
			identity: { kind: "project-tree", projectId: args.id },
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-project",
					scope,
					signal: args.signal,
				});
				await this.throughBridge("remove-project", scope, () =>
					this.bridge.removeRecord(args.id),
				);
			},
		});
	}

	async listAttachments(args: {
		projectId: ProjectId;
		signal?: AbortSignal;
	}): Promise<readonly ProjectAttachment[]> {
		const scope = { kind: "project", projectId: args.projectId } as const;
		throwIfAborted({
			operation: "list-attachments",
			scope,
			signal: args.signal,
		});
		// Bridge results are freshly deserialized per call — no caller can alias
		// durable state through them.
		return this.throughBridge("list-attachments", scope, () =>
			this.bridge.listAttachments(args.projectId),
		);
	}

	async loadAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment | null> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "load-attachment",
			scope,
			signal: args.signal,
		});
		return this.throughBridge("load-attachment", scope, () =>
			this.bridge.loadAttachment(args.projectId, args.key),
		);
	}

	async saveAttachment(args: {
		projectId: ProjectId;
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
		throwIfAborted({
			operation: "save-attachment",
			scope,
			signal: args.signal,
		});
		const metadata = clonePayload(args.metadata, {
			operation: "save-attachment",
			scope,
		});
		const body = clonePayload(args.body, {
			operation: "save-attachment",
			scope,
		});
		await this.enqueue({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "save-attachment",
					scope,
					signal: args.signal,
				});
				const inspection = this.control.readInspection();
				if (
					inspection.availability === "available" &&
					inspection.capacity !== null &&
					body.byteLength > inspection.capacity.remainingBytes
				) {
					throw new ProjectStoreError({
						code: "quota-exceeded",
						operation: "save-attachment",
						scope,
					});
				}
				await this.throughBridge("save-attachment", scope, () =>
					this.bridge.saveAttachment(args.projectId, args.key, metadata, body),
				);
			},
		});
	}

	async removeAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = {
			kind: "attachment",
			projectId: args.projectId,
			key: args.key,
		} as const;
		throwIfAborted({
			operation: "remove-attachment",
			scope,
			signal: args.signal,
		});
		await this.enqueue({
			identity: {
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			operation: async () => {
				await this.control.beforeCommit({
					operation: "remove-attachment",
					scope,
					signal: args.signal,
				});
				await this.throughBridge("remove-attachment", scope, () =>
					this.bridge.removeAttachment(args.projectId, args.key),
				);
			},
		});
	}

	async listLibraryRecords(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<readonly LibraryRecord[]> {
		const scope = { kind: "library", namespace: args.namespace } as const;
		throwIfAborted({
			operation: "list-library-records",
			scope,
			signal: args.signal,
		});
		return this.throughBridge("list-library-records", scope, () =>
			this.bridge.listLibraryRecords(args.namespace),
		);
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
		throwIfAborted({
			operation: "load-library-record",
			scope,
			signal: args.signal,
		});
		return this.throughBridge("load-library-record", scope, () =>
			this.bridge.loadLibraryRecord(args.namespace, args.key),
		);
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
		throwIfAborted({
			operation: "save-library-record",
			scope,
			signal: args.signal,
		});
		const record = clonePayload(
			{
				namespace: args.namespace,
				key: args.key,
				schemaVersion: args.schemaVersion,
				data: args.data,
			},
			{ operation: "save-library-record", scope },
		);
		await this.enqueue({
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
				await this.throughBridge("save-library-record", scope, () =>
					this.bridge.saveLibraryRecord(record),
				);
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
		throwIfAborted({
			operation: "remove-library-record",
			scope,
			signal: args.signal,
		});
		await this.enqueue({
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
				await this.throughBridge("remove-library-record", scope, () =>
					this.bridge.removeLibraryRecord(args.namespace, args.key),
				);
			},
		});
	}

	async inspect(
		args: { signal?: AbortSignal } = {},
	): Promise<ProjectStoreInspection> {
		throwIfAborted({
			operation: "inspect",
			scope: { kind: "store" },
			signal: args.signal,
		});
		return this.control.readInspection();
	}

	async clear(args: {
		scope: ProjectStoreClearScope;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope =
			args.scope.kind === "library"
				? ({ kind: "library", namespace: args.scope.namespace } as const)
				: ({ kind: "store" } as const);
		throwIfAborted({ operation: "clear", scope, signal: args.signal });
		const identity: MutationIdentity =
			args.scope.kind === "projects"
				? { kind: "all-projects" }
				: args.scope.kind === "library"
					? { kind: "library-namespace", namespace: args.scope.namespace }
					: { kind: "all" };
		await this.enqueue({
			identity,
			operation: async () => {
				await this.control.beforeCommit({
					operation: "clear",
					scope,
					signal: args.signal,
				});
				await this.throughBridge("clear", scope, () =>
					this.bridge.clearFiles(args.scope),
				);
			},
		});
	}

	async persistedSchemaVersion(): Promise<number | null> {
		const listings = await this.throughBridge(
			"inspect",
			{ kind: "store" },
			() => this.bridge.listRecords(),
		);
		if (listings.length === 0) return this.schemaVersion;
		return Math.min(...listings.map((listing) => listing.schemaVersion));
	}

	/**
	 * Bring on-disk records forward through the published transform chain.
	 *
	 * Every candidate is transformed in memory first and only then written, so
	 * a failing or refusing transform leaves every source record byte-identical
	 * and reports `failed` — the failure-preservation contract the migration
	 * probes assert.
	 */
	async migrate(context: MigrationContext): Promise<MigrationOutcome> {
		if (this.migrationState.completed) return { status: "not-needed" };
		if (this.migrationState.inFlight) return this.migrationState.inFlight;
		const run = this.runMigration(context);
		this.migrationState.inFlight = run;
		const outcome = await run;
		if (outcome.status === "failed") {
			this.migrationState.inFlight = null;
		} else {
			this.migrationState.completed = true;
			this.migrationState.inFlight = null;
		}
		return outcome;
	}

	private async runMigration(
		context: MigrationContext,
	): Promise<MigrationOutcome> {
		const to = this.schemaVersion;
		const refuse = (reason: string): MigrationOutcome => ({
			status: "failed",
			from: context.from,
			to,
			reason,
		});

		if (this.migrationPolicy.kind === "disabled") {
			return refuse(
				"Filesystem project migration is not enabled for this identity",
			);
		}
		if (this.migrationPolicy.kind === "production") {
			if (this.bridgeIdentity !== DEFAULT_FILESYSTEM_STORE_IDENTITY) {
				return refuse(
					"A non-default filesystem identity requires disposable migration opt-in",
				);
			}
		} else {
			const policy = this.migrationPolicy;
			if (policy.identity !== this.bridgeIdentity) {
				return refuse(
					"Disposable migration policy is not bound to the durable identity",
				);
			}
			if (
				!policy.identity.startsWith(policy.prefix) ||
				policy.identity.length <= policy.prefix.length
			) {
				return refuse(
					"Disposable migration identity is outside its disposable prefix",
				);
			}
		}

		try {
			const listings = await this.bridge.listRecords();
			const candidates = listings.filter(
				(listing) => listing.schemaVersion < to,
			);
			if (candidates.length === 0) return { status: "not-needed" };

			// Transform every candidate before writing any: a failure below
			// leaves all source records untouched.
			const planned: Array<{
				id: ProjectId;
				originalVersion: number;
				summary: ProjectSummary;
				data: unknown;
			}> = [];
			const ordered = [...this.migrations].sort((a, b) => a.from - b.from);
			for (const candidate of candidates) {
				const stored = await this.bridge.loadRecord(candidate.id);
				if (!stored) continue;
				if (typeof stored.record.data !== "object" || stored.record.data === null) {
					return refuse("A persisted project payload is not migratable");
				}
				// The envelope version is authoritative; the legacy transform chain
				// reads it from the payload's own `version` field, exactly as the
				// browser migration prepares its transform source.
				let current = stored.record.schemaVersion;
				let project = clonePayload(
					{ ...stored.record.data, version: current },
					{ operation: "inspect", scope: { kind: "store" } },
				) as Record<string, unknown>;
				for (const migration of ordered) {
					if (migration.from !== current) continue;
					const result = await migration.run({
						projectId: stored.record.id,
						project,
					});
					if (result.skipped) {
						return refuse(
							"A published transform refused a required schema step",
						);
					}
					project = result.project;
					current = migration.to;
				}
				if (current !== to) {
					return refuse(
						"The published transform chain did not reach the current schema",
					);
				}
				planned.push({
					id: stored.record.id,
					originalVersion: stored.record.schemaVersion,
					summary: stored.summary,
					data: project,
				});
			}
			if (planned.length === 0) return { status: "not-needed" };

			for (let index = 0; index < planned.length; index += 1) {
				const entry = planned[index];
				await this.bridge.saveRecord({
					record: { id: entry.id, schemaVersion: to, data: entry.data },
					summary: entry.summary,
				});
				context.report({
					completed: index + 1,
					total: planned.length,
					label: entry.summary.name,
				});
			}
			return {
				status: "migrated",
				from: Math.min(...planned.map((entry) => entry.originalVersion)),
				to,
				recordsMigrated: planned.length,
			};
		} catch (error) {
			void error;
			return refuse(
				"Filesystem project migration failed before commit; durable records are unchanged",
			);
		}
	}
}
