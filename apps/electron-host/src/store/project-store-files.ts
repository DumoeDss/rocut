/**
 * s05-second-host — the store bridge interface (design E4).
 *
 * `FilesystemProjectStore` (the `ProjectStore` implementation the renderer
 * composes) owns no file I/O: every byte it moves crosses this interface. Two
 * implementations exist deliberately:
 *
 * - `IpcStoreBridge` — the production path. The preload exposes exactly this
 *   surface as the single `opencutStore` object; Electron IPC forwards each
 *   operation to the main process, which owns the storage root and does the
 *   `node:fs` work.
 * - `NodeFsStoreBridge` — direct `node:fs` against a caller-supplied root,
 *   used by `bun test` (where there is no Electron) so the conformance and
 *   migration evidence runs on the same store class the renderer uses.
 *
 * The interface is store-shaped and keyed by identifiers only — project ids,
 * namespaces, keys. No method accepts or returns a filesystem path: the
 * renderer never learns where bytes live (spec: "no renderer-accessible
 * surface accepts or returns an absolute path").
 *
 * Values crossing the bridge are structured-clone values. Opaque payloads
 * (`record.data`, attachment metadata, library `data`) may carry Dates, Maps,
 * Sets and buffers — the same lattice the port's provider-private round-trip
 * requirement protects — so each implementation serializes with
 * structured-clone fidelity on its side of the seam. Electron's IPC is a
 * structured clone; `NodeFsStoreBridge` serializes to disk with `node:v8`.
 */

import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectStoreClearScope,
	ProjectStoreInspection,
	ProjectSummary,
} from "@opencut/editor-ports";

/** The persisted record plus the summary beside it, as one durable unit. */
export interface BridgeStoredRecord {
	readonly record: {
		readonly id: ProjectId;
		readonly schemaVersion: number;
		readonly data: unknown;
	};
	readonly summary: ProjectSummary;
}

/** `listRecords` without the payloads: summaries and envelope versions only. */
export interface BridgeRecordListing {
	readonly id: ProjectId;
	/** The envelope's persisted version — `persistedSchemaVersion()` reads these. */
	readonly schemaVersion: number;
	readonly summary: ProjectSummary;
}

/** Bridge-level I/O failure with a sanitized message (never a filesystem path). */
export class StoreBridgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StoreBridgeError";
	}
}

/**
 * Identifiers only, never paths (design E4). The operations mirror the
 * `ProjectStore` surface one-to-one so the preload can expose this object
 * verbatim as `opencutStore`.
 */
export interface ProjectStoreFiles {
	listRecords(): Promise<readonly BridgeRecordListing[]>;
	loadRecord(id: ProjectId): Promise<BridgeStoredRecord | null>;
	saveRecord(stored: BridgeStoredRecord): Promise<void>;
	removeRecord(id: ProjectId): Promise<void>;

	listAttachments(projectId: ProjectId): Promise<readonly ProjectAttachment[]>;
	loadAttachment(
		projectId: ProjectId,
		key: string,
	): Promise<ProjectAttachment | null>;
	saveAttachment(
		projectId: ProjectId,
		key: string,
		metadata: unknown,
		body: ArrayBuffer,
	): Promise<void>;
	removeAttachment(projectId: ProjectId, key: string): Promise<void>;

	listLibraryRecords(namespace: string): Promise<readonly LibraryRecord[]>;
	loadLibraryRecord(
		namespace: string,
		key: string,
	): Promise<LibraryRecord | null>;
	saveLibraryRecord(record: LibraryRecord): Promise<void>;
	removeLibraryRecord(namespace: string, key: string): Promise<void>;

	/** Real usage facts the bridge can compute; never a typed availability claim. */
	inspectFiles(): Promise<{ readonly usedBytes: number }>;
	clearFiles(scope: ProjectStoreClearScope): Promise<void>;
}
