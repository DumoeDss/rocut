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

/** Progress from a migration in flight, delivered on the diagnostics channel. */
export interface MigrationProgress {
	readonly completed: number;
	readonly total: number;
	readonly label?: string;
}

export interface MigrationContext {
	/** The version found on disk. */
	readonly from: number;
	/** The version the store declares. */
	readonly to: number;
	report(progress: MigrationProgress): void;
}

export type MigrationOutcome =
	| { readonly status: "not-needed" }
	| {
			readonly status: "migrated";
			readonly from: number;
			readonly to: number;
			readonly recordsMigrated: number;
	  }
	| {
			readonly status: "failed";
			readonly from: number;
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
	 * Bring persisted data forward. Absent means "no legacy data to migrate",
	 * which is a conforming answer, not an omission.
	 *
	 * Invoked by the session exactly once during `create`, before any project is
	 * loaded, and never again for the same store instance.
	 */
	migrate?(ctx: MigrationContext): Promise<MigrationOutcome>;

	list(): Promise<readonly ProjectSummary[]>;
	load(args: { id: ProjectId }): Promise<ProjectRecord | null>;
	save(args: {
		record: ProjectRecord;
		summary: ProjectSummary;
	}): Promise<void>;
	remove(args: { id: ProjectId }): Promise<void>;
}
