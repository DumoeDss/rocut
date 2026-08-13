/**
 * The storage port.
 *
 * The store moves an **opaque document plus a typed summary**. It never sees an
 * OpenCut schema type, and it never learns what mechanism persists it.
 *
 * The opacity is not only the boundary rule. Target State §5.6 requires
 * provider-private round-trip, and "storage inversion cannot preserve
 * provider-private round-trip" is a Slice **stop condition** rather than a
 * deviation. An opaque payload round-trips fields nobody declared *by
 * construction*; a typed one loses them the first time the schema moves. A later
 * child must not widen `data` to typed project content to make its rewiring
 * easier — that would spend the stop condition silently.
 */
import type { AssetRef } from "./assets";
import type { ProjectId } from "./identity";

/**
 * The metadata projection a Host needs to render a project list without
 * deserializing every scene.
 *
 * Timestamps are ISO-8601 strings, not `Date`. The port is expected to cross a
 * process or serialization boundary in some Hosts, and `Date` does not survive
 * every such crossing intact; a string does, and the editor's own conversion
 * stays on the editor's side of the seam where it already is.
 */
export interface ProjectSummary {
	readonly id: ProjectId;
	readonly name: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly thumbnail?: AssetRef;
}

/**
 * A persisted project.
 *
 * `data` is opaque. The store persists and returns it unchanged, including
 * fields it does not understand. A store that inspects, normalizes or reshapes
 * `data` is not conforming.
 */
export interface ProjectRecord {
	readonly id: ProjectId;
	readonly schemaVersion: number;
	readonly data: unknown;
}

/** A project-owned opaque binary value. Neither metadata nor bytes are decoded. */
export interface ProjectAttachment {
	readonly projectId: ProjectId;
	readonly key: string;
	readonly metadata: unknown;
	readonly body: ArrayBuffer;
}

/** A durable opaque value in a caller-selected logical namespace. */
export interface LibraryRecord {
	readonly namespace: string;
	readonly key: string;
	readonly schemaVersion: number;
	readonly data: unknown;
}

/** Capacity is meaningful even when `remainingBytes` is exactly zero. */
export interface ProjectStoreCapacity {
	readonly usedBytes: number;
	readonly totalBytes: number;
	readonly remainingBytes: number;
}

/**
 * A mechanism-neutral availability report.
 *
 * `capacity: null` means the store is usable but cannot estimate bytes. It is
 * deliberately different from both a zero-byte estimate and an unavailable
 * store.
 */
export type ProjectStoreInspection =
	| {
			readonly availability: "available";
			readonly capacity: ProjectStoreCapacity | null;
	  }
	| {
			readonly availability: "unsupported" | "unavailable";
			readonly capacity: null;
			readonly reason: string;
	  };

export type ProjectStoreErrorCode =
	| "aborted"
	| "quota-exceeded"
	| "unavailable"
	| "corrupt"
	| "conflict";

export type ProjectStoreOperation =
	| "list-projects"
	| "load-project"
	| "save-project"
	| "remove-project"
	| "list-attachments"
	| "load-attachment"
	| "save-attachment"
	| "remove-attachment"
	| "list-library-records"
	| "load-library-record"
	| "save-library-record"
	| "remove-library-record"
	| "inspect"
	| "clear";

/** Logical context only: never a database name, path, or payload value. */
export type ProjectStoreErrorScope =
	| { readonly kind: "store" }
	| { readonly kind: "project"; readonly projectId: ProjectId }
	| {
			readonly kind: "attachment";
			readonly projectId: ProjectId;
			readonly key: string;
	  }
	| {
			readonly kind: "library";
			readonly namespace: string;
			readonly key?: string;
	  };

/** Stable failure shape shared by every Host implementation. */
export class ProjectStoreError extends Error {
	readonly code: ProjectStoreErrorCode;
	readonly operation: ProjectStoreOperation;
	readonly scope: ProjectStoreErrorScope;

	constructor(args: {
		code: ProjectStoreErrorCode;
		operation: ProjectStoreOperation;
		scope: ProjectStoreErrorScope;
		message?: string;
	}) {
		super(args.message ?? `Project store ${args.operation} failed: ${args.code}`);
		this.name = "ProjectStoreError";
		this.code = args.code;
		this.operation = args.operation;
		this.scope = args.scope;
	}
}

export type ProjectStoreClearScope =
	| { readonly kind: "projects" }
	| { readonly kind: "library"; readonly namespace: string }
	| { readonly kind: "all" };

/** Progress from a migration in flight, delivered on the diagnostics channel. */
export interface MigrationProgress {
	readonly completed: number;
	readonly total: number;
	readonly label?: string;
}

export interface MigrationContext {
	/**
	 * The version found on disk, or `null` when the store cannot determine it
	 * before migrating.
	 *
	 * Nullable rather than defaulted to the target version. A `from` that always
	 * equalled `to` would be structurally incapable of carrying its meaning, and
	 * a later child has to render exactly this pair in a migration dialog — a
	 * frozen field that can never be right is worse than an absent one.
	 */
	readonly from: number | null;
	/** The version the store declares. */
	readonly to: number;
	report(progress: MigrationProgress): void;
}

/**
 * `from` is `number | null` throughout, matching `MigrationContext.from`: a
 * store that could not determine its on-disk version before migrating cannot
 * invent one afterwards either.
 */
export type MigrationOutcome =
	| { readonly status: "not-needed" }
	| {
			readonly status: "migrated";
			readonly from: number | null;
			readonly to: number;
			readonly recordsMigrated: number;
	  }
	| {
			readonly status: "failed";
			readonly from: number | null;
			readonly to: number;
			readonly reason: string;
	  };

export interface ProjectStore {
	/**
	 * The schema version this store holds.
	 *
	 * Declared by the store because only the store knows its own on-disk shape.
	 * A second, non-browser implementation (C5) has different legacy data, or
	 * none at all.
	 */
	readonly schemaVersion: number;

	/**
	 * The version currently on disk, when the store can determine it without
	 * migrating. Absent means it cannot, and `MigrationContext.from` is `null`.
	 *
	 * This exists so `from` carries a real value. A store that can cheaply read
	 * its own on-disk version should implement it.
	 */
	persistedSchemaVersion?(): Promise<number | null>;

	/**
	 * Bring persisted data forward. Absent means "no legacy data to migrate",
	 * which is a conforming answer, not an omission.
	 *
	 * Invoked by the session exactly once during `create`, before any project is
	 * loaded, and never again for the same store instance. Concurrent creations
	 * against the same store await the same run rather than starting a second.
	 *
	 * A `failed` outcome **fails session creation**; see `DECISIONS.md` §4.
	 */
	migrate?(ctx: MigrationContext): Promise<MigrationOutcome>;

	list(args?: { signal?: AbortSignal }): Promise<readonly ProjectSummary[]>;
	load(args: {
		id: ProjectId;
		signal?: AbortSignal;
	}): Promise<ProjectRecord | null>;
	/** `record.id` and `summary.id` must match; mismatch is a pre-commit conflict. */
	save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
		signal?: AbortSignal;
	}): Promise<void>;
	remove(args: { id: ProjectId; signal?: AbortSignal }): Promise<void>;

	listAttachments(args: {
		projectId: ProjectId;
		signal?: AbortSignal;
	}): Promise<readonly ProjectAttachment[]>;
	loadAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<ProjectAttachment | null>;
	saveAttachment(args: {
		projectId: ProjectId;
		key: string;
		metadata: unknown;
		body: ArrayBuffer;
		signal?: AbortSignal;
	}): Promise<void>;
	removeAttachment(args: {
		projectId: ProjectId;
		key: string;
		signal?: AbortSignal;
	}): Promise<void>;

	listLibraryRecords(args: {
		namespace: string;
		signal?: AbortSignal;
	}): Promise<readonly LibraryRecord[]>;
	loadLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<LibraryRecord | null>;
	saveLibraryRecord(args: {
		namespace: string;
		key: string;
		schemaVersion: number;
		data: unknown;
		signal?: AbortSignal;
	}): Promise<void>;
	removeLibraryRecord(args: {
		namespace: string;
		key: string;
		signal?: AbortSignal;
	}): Promise<void>;

	inspect(args?: { signal?: AbortSignal }): Promise<ProjectStoreInspection>;
	clear(args: {
		scope: ProjectStoreClearScope;
		signal?: AbortSignal;
	}): Promise<void>;
}
