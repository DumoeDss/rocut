/**
 * The alien ProjectStore (S05 P3, design E7).
 *
 * A third-party store whose internal representation is deliberately alien:
 * every record, summary, attachment, and library entry lives as ONE JSON
 * string in ONE flat Map, keyed by a JSON tuple. Nothing is held as a live
 * object; every read is a parse, every write a serialize. The opaque payload
 * crosses this boundary through the typed wire codec, so a payload field the
 * contract has never heard of survives exactly, and a value outside the
 * codec's subset is a typed corrupt failure rather than a silent coercion --
 * which is what makes the opaque-payload conformance case meaningful here.
 *
 * Mutation semantics (ordering, cascade, clear scopes, abort, capacity) are
 * this store's own implementation of the published port contract; the
 * scheduling controls are plumbing over the same single commit path.
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
	ProjectStoreInspection,
	ProjectStoreOperation,
	ProjectStoreErrorScope,
	ProjectSummary,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";

import { AlienCodecError, alienText, fromAlienText } from "./alien-codec";
import { AlienStoreControl } from "./alien-control";

export interface AlienProjectStoreOptions {
	/** The store's declared schema version; the legacy migrator sets the current one. */
	schemaVersion?: number;
	/** Supplied by the fixture when the published migration chain is loadable. */
	migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;
	control?: AlienStoreControl;
}

/** A decoded legacy entry as the migration walk sees it. */
export interface AlienLegacyEntry {
	readonly id: ProjectId;
	readonly schemaVersion: number;
	readonly data: unknown;
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

function identitiesConflict(
	left: MutationIdentity,
	right: MutationIdentity,
): boolean {
	if (left.kind === "all" || right.kind === "all") return true;
	const isProject = (identity: MutationIdentity) =>
		identity.kind === "project-record" ||
		identity.kind === "attachment" ||
		identity.kind === "project-tree" ||
		identity.kind === "all-projects";
	if (left.kind === "all-projects" || right.kind === "all-projects") {
		return isProject(left) && isProject(right);
	}
	if (left.kind === "project-tree") {
		return (
			right.kind !== "library-record" &&
			right.kind !== "library-namespace" &&
			right.projectId === left.projectId
		);
	}
	if (right.kind === "project-tree") {
		return (
			left.kind !== "library-record" &&
			left.kind !== "library-namespace" &&
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
		return (
			(right.kind === "library-record" ||
				right.kind === "library-namespace") &&
			right.namespace === left.namespace
		);
	}
	if (right.kind === "library-namespace") {
		return (
			(left.kind === "library-record" ||
				left.kind === "library-namespace") &&
			left.namespace === right.namespace
		);
	}
	if (left.kind === "library-record" && right.kind === "library-record") {
		return left.namespace === right.namespace && left.key === right.key;
	}
	return false;
}

/** JSON-tuple keys: collision-free across every hierarchical shape. */
const keyOf = {
	project: (id: ProjectId) => JSON.stringify(["project", id]),
	summary: (id: ProjectId) => JSON.stringify(["summary", id]),
	attachment: (projectId: ProjectId, key: string) =>
		JSON.stringify(["attachment", projectId, key]),
	library: (namespace: string, key: string) =>
		JSON.stringify(["library", namespace, key]),
};

function isAttachmentKeyOf(key: string, projectId: ProjectId): boolean {
	const tuple = JSON.parse(key) as [string, string, ...string[]];
	return tuple[0] === "attachment" && tuple[1] === projectId;
}

export class AlienProjectStore implements ProjectStore {
	readonly schemaVersion: number;
	/** Assigned by the fixture once the published migration chain is loaded. */
	migrate?: (ctx: MigrationContext) => Promise<MigrationOutcome>;

	/** The whole durable state: JSON tuple key -> wire text. */
	private readonly entries = new Map<string, string>();
	private readonly pendingMutations = new Set<PendingMutation>();
	private readonly control: AlienStoreControl;

	constructor(options: AlienProjectStoreOptions = {}) {
		this.schemaVersion = options.schemaVersion ?? 1;
		if (options.migrate) this.migrate = options.migrate;
		this.control = options.control ?? new AlienStoreControl();
	}

	/** Fixture access to the fault/scheduling controls. */
	get fixtureControl(): AlienStoreControl {
		return this.control;
	}

	// -- reads ----------------------------------------------------------------

	async list(
		args: { signal?: AbortSignal } = {},
	): Promise<readonly ProjectSummary[]> {
		this.throwIfAborted("list-projects", { kind: "store" }, args.signal);
		const summaries: ProjectSummary[] = [];
		for (const [key, text] of this.entries) {
			const tuple = JSON.parse(key) as [string, ...unknown[]];
			if (tuple[0] !== "summary") continue;
			summaries.push(this.decode("list-projects", text) as ProjectSummary);
		}
		summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
		return summaries;
	}

	async load({
		id,
		signal,
	}: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<ProjectRecord | null> {
		const scope = { kind: "project", projectId: id } as const;
		this.throwIfAborted("load-project", scope, signal);
		const text = this.entries.get(keyOf.project(id));
		return text === undefined
			? null
			: (this.decode("load-project", text) as ProjectRecord);
	}

	async listAttachments(args: {
		projectId: ProjectId;
		signal?: AbortSignal;
	}): Promise<readonly ProjectAttachment[]> {
		const scope = { kind: "project", projectId: args.projectId } as const;
		this.throwIfAborted("list-attachments", scope, args.signal);
		const found: ProjectAttachment[] = [];
		for (const [key, text] of this.entries) {
			if (!isAttachmentKeyOf(key, args.projectId)) continue;
			found.push(this.decode("list-attachments", text) as ProjectAttachment);
		}
		found.sort((a, b) => a.key.localeCompare(b.key));
		return found;
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
		this.throwIfAborted("load-attachment", scope, args.signal);
		const text = this.entries.get(
			keyOf.attachment(args.projectId, args.key),
		);
		return text === undefined
			? null
			: (this.decode("load-attachment", text) as ProjectAttachment);
	}

	async listLibraryRecords(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<readonly LibraryRecord[]> {
		const scope = { kind: "library", namespace: args.namespace } as const;
		this.throwIfAborted("list-library-records", scope, args.signal);
		const found: LibraryRecord[] = [];
		for (const [key, text] of this.entries) {
			const tuple = JSON.parse(key) as [string, ...unknown[]];
			if (tuple[0] !== "library" || tuple[1] !== args.namespace) continue;
			found.push(
				this.decode("list-library-records", text) as LibraryRecord,
			);
		}
		found.sort((a, b) => a.key.localeCompare(b.key));
		return found;
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
		this.throwIfAborted("load-library-record", scope, args.signal);
		const text = this.entries.get(keyOf.library(args.namespace, args.key));
		return text === undefined
			? null
			: (this.decode("load-library-record", text) as LibraryRecord);
	}

	async inspect(
		args: { signal?: AbortSignal } = {},
	): Promise<ProjectStoreInspection> {
		this.throwIfAborted("inspect", { kind: "store" }, args.signal);
		return this.control.readInspection();
	}

	// -- writes ---------------------------------------------------------------

	async save({
		record,
		summary,
		signal,
	}: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: record.id } as const;
		this.throwIfAborted("save-project", scope, signal);
		if (record.id !== summary.id) {
			throw new ProjectStoreError({
				code: "conflict",
				operation: "save-project",
				scope,
				message: "Record and summary identities do not match",
			});
		}
		const recordText = this.encode("save-project", record);
		const summaryText = this.encode("save-project", summary);
		await this.enqueue(
			{ kind: "project-record", projectId: record.id },
			async () => {
				await this.control.beforeCommit({
					operation: "save-project",
					scope,
					signal,
				});
				this.entries.set(keyOf.project(record.id), recordText);
				this.entries.set(keyOf.summary(summary.id), summaryText);
			},
		);
	}

	async remove({
		id,
		signal,
	}: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope = { kind: "project", projectId: id } as const;
		this.throwIfAborted("remove-project", scope, signal);
		await this.enqueue({ kind: "project-tree", projectId: id }, async () => {
			await this.control.beforeCommit({
				operation: "remove-project",
				scope,
				signal,
			});
			this.entries.delete(keyOf.project(id));
			this.entries.delete(keyOf.summary(id));
			for (const key of [...this.entries.keys()]) {
				if (isAttachmentKeyOf(key, id)) this.entries.delete(key);
			}
		});
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
		this.throwIfAborted("save-attachment", scope, args.signal);
		const text = this.encode("save-attachment", {
			projectId: args.projectId,
			key: args.key,
			metadata: args.metadata,
			body: args.body,
		});
		await this.enqueue(
			{
				kind: "attachment",
				projectId: args.projectId,
				key: args.key,
			},
			async () => {
				await this.control.beforeCommit({
					operation: "save-attachment",
					scope,
					signal: args.signal,
				});
				const inspection = this.control.readInspection();
				if (
					inspection.availability === "available" &&
					inspection.capacity !== null &&
					args.body.byteLength > inspection.capacity.remainingBytes
				) {
					throw new ProjectStoreError({
						code: "quota-exceeded",
						operation: "save-attachment",
						scope,
					});
				}
				this.entries.set(
					keyOf.attachment(args.projectId, args.key),
					text,
				);
			},
		);
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
		this.throwIfAborted("remove-attachment", scope, args.signal);
		await this.enqueue(
			{ kind: "attachment", projectId: args.projectId, key: args.key },
			async () => {
				await this.control.beforeCommit({
					operation: "remove-attachment",
					scope,
					signal: args.signal,
				});
				this.entries.delete(
					keyOf.attachment(args.projectId, args.key),
				);
			},
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
		this.throwIfAborted("save-library-record", scope, args.signal);
		const text = this.encode("save-library-record", {
			namespace: args.namespace,
			key: args.key,
			schemaVersion: args.schemaVersion,
			data: args.data,
		});
		await this.enqueue(
			{ kind: "library-record", namespace: args.namespace, key: args.key },
			async () => {
				await this.control.beforeCommit({
					operation: "save-library-record",
					scope,
					signal: args.signal,
				});
				this.entries.set(keyOf.library(args.namespace, args.key), text);
			},
		);
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
		this.throwIfAborted("remove-library-record", scope, args.signal);
		await this.enqueue(
			{ kind: "library-record", namespace: args.namespace, key: args.key },
			async () => {
				await this.control.beforeCommit({
					operation: "remove-library-record",
					scope,
					signal: args.signal,
				});
				this.entries.delete(keyOf.library(args.namespace, args.key));
			},
		);
	}

	async clear(args: {
		scope: ProjectStoreClearScope;
		signal?: AbortSignal;
	}): Promise<void> {
		const scope =
			args.scope.kind === "library"
				? ({ kind: "library", namespace: args.scope.namespace } as const)
				: ({ kind: "store" } as const);
		this.throwIfAborted("clear", scope, args.signal);
		const identity: MutationIdentity =
			args.scope.kind === "projects"
				? { kind: "all-projects" }
				: args.scope.kind === "library"
					? { kind: "library-namespace", namespace: args.scope.namespace }
					: { kind: "all" };
		await this.enqueue(identity, async () => {
			await this.control.beforeCommit({
				operation: "clear",
				scope,
				signal: args.signal,
			});
			for (const key of [...this.entries.keys()]) {
				const tuple = JSON.parse(key) as [string, ...unknown[]];
				const isProjectData =
					tuple[0] === "project" ||
					tuple[0] === "summary" ||
					tuple[0] === "attachment";
				if (args.scope.kind === "all") {
					this.entries.delete(key);
				} else if (args.scope.kind === "projects" && isProjectData) {
					this.entries.delete(key);
				} else if (
					args.scope.kind === "library" &&
					tuple[0] === "library" &&
					tuple[1] === args.scope.namespace
				) {
					this.entries.delete(key);
				}
			}
		});
	}

	// -- legacy migration plumbing (consumed by migrate.ts) -------------------

	/** Every project entry, decoded, in key order. */
	legacySnapshot(): AlienLegacyEntry[] {
		const records: AlienLegacyEntry[] = [];
		for (const [key, text] of this.entries) {
			const tuple = JSON.parse(key) as [string, ...unknown[]];
			if (tuple[0] !== "project") continue;
			const record = this.decode("inspect", text) as ProjectRecord;
			records.push({
				id: record.id,
				schemaVersion: record.schemaVersion,
				data: record.data,
			});
		}
		return records;
	}

	/** Atomically replace every project entry's versioned payload. */
	legacyReplace(updated: readonly AlienLegacyEntry[]): void {
		for (const entry of updated) {
			this.entries.set(
				keyOf.project(entry.id),
				this.encode("save-project", {
					id: entry.id,
					schemaVersion: entry.schemaVersion,
					data: entry.data,
				}),
			);
		}
	}

	/** Seed one legacy-shaped record (the disposable migration fixture). */
	async seedLegacy(args: {
		id: ProjectId;
		schemaVersion: number;
		data: unknown;
	}): Promise<void> {
		await this.save({
			record: {
				id: args.id,
				schemaVersion: args.schemaVersion,
				data: args.data,
			},
			summary: {
				id: args.id,
				name: "Legacy disposable",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
	}

	// -- internals --------------------------------------------------------------

	private encode(operation: ProjectStoreOperation, value: unknown): string {
		try {
			return alienText(value);
		} catch (error) {
			if (error instanceof AlienCodecError) {
				throw new ProjectStoreError({
					code: "corrupt",
					operation,
					scope: { kind: "store" },
					message: "The store cannot serialize this value",
				});
			}
			throw error;
		}
	}

	private decode(operation: ProjectStoreOperation, text: string): unknown {
		try {
			return fromAlienText(text);
		} catch (error) {
			if (error instanceof AlienCodecError) {
				throw new ProjectStoreError({
					code: "corrupt",
					operation,
					scope: { kind: "store" },
					message: "A stored record could not be decoded",
				});
			}
			throw error;
		}
	}

	private throwIfAborted(
		operation: ProjectStoreOperation,
		scope: ProjectStoreErrorScope,
		signal?: AbortSignal,
	): void {
		if (signal?.aborted) {
			throw new ProjectStoreError({ code: "aborted", operation, scope });
		}
	}

	private async enqueue<Result>(
		identity: MutationIdentity,
		operation: () => Promise<Result>,
	): Promise<Result> {
		const blockers = [...this.pendingMutations]
			.filter((pending) => identitiesConflict(pending.identity, identity))
			.map((pending) => pending.completion);
		let complete!: () => void;
		const completion = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const pending = { identity, completion };
		this.pendingMutations.add(pending);
		try {
			await Promise.all(blockers);
			return await operation();
		} finally {
			this.pendingMutations.delete(pending);
			complete();
		}
	}
}
