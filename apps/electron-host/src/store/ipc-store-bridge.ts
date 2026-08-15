/**
 * s05-second-host — `IpcStoreBridge` (design E4): the renderer-side
 * `ProjectStoreFiles` over the preload's single `opencutStore` exposure.
 *
 * This is the production bridge `FilesystemProjectStore` composes inside the
 * Electron renderer (Group 5 wires the composition): identifiers and
 * structured-clone values cross the contextBridge, Electron IPC forwards them
 * to the main process, and main does every `node:fs` byte against a root the
 * renderer never learns. No renderer-accessible surface here accepts or
 * returns an absolute path.
 *
 * The class exists for two reasons beyond the pass-through: it types the
 * preload surface (`window.opencutStore`) once, and it normalizes failures —
 * Electron IPC erases error identity (only the message string crosses), so
 * every rejection is re-thrown as a `StoreBridgeError`, which
 * `FilesystemProjectStore.throughBridge` maps to the port's typed taxonomy.
 */
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectStoreClearScope,
} from "@opencut/editor-ports";
import {
	StoreBridgeError,
	type BridgeRecordListing,
	type BridgeStoredRecord,
	type ProjectStoreFiles,
} from "./project-store-files";

/** The preload exposes exactly this surface via `contextBridge` (one object). */
declare global {
	interface Window {
		readonly opencutStore?: ProjectStoreFiles;
	}
}

async function settle<T>(operation: string, run: Promise<T>): Promise<T> {
	try {
		return await run;
	} catch (error) {
		throw new StoreBridgeError(
			`Store bridge ${operation} failed over IPC (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

/** Fail loudly and early when the store is composed outside Electron. */
export function opencutStoreFiles(): ProjectStoreFiles {
	const exposed = typeof window === "object" ? window.opencutStore : undefined;
	if (!exposed) {
		throw new StoreBridgeError(
			"The Electron preload bridge (window.opencutStore) is not available in this context",
		);
	}
	return exposed;
}

export class IpcStoreBridge implements ProjectStoreFiles {
	private readonly files: ProjectStoreFiles;

	constructor(files: ProjectStoreFiles = opencutStoreFiles()) {
		this.files = files;
	}

	listRecords(): Promise<readonly BridgeRecordListing[]> {
		return settle("listRecords", this.files.listRecords());
	}

	loadRecord(id: ProjectId): Promise<BridgeStoredRecord | null> {
		return settle("loadRecord", this.files.loadRecord(id));
	}

	saveRecord(stored: BridgeStoredRecord): Promise<void> {
		return settle("saveRecord", this.files.saveRecord(stored));
	}

	removeRecord(id: ProjectId): Promise<void> {
		return settle("removeRecord", this.files.removeRecord(id));
	}

	listAttachments(projectId: ProjectId): Promise<readonly ProjectAttachment[]> {
		return settle("listAttachments", this.files.listAttachments(projectId));
	}

	loadAttachment(
		projectId: ProjectId,
		key: string,
	): Promise<ProjectAttachment | null> {
		return settle("loadAttachment", this.files.loadAttachment(projectId, key));
	}

	saveAttachment(
		projectId: ProjectId,
		key: string,
		metadata: unknown,
		body: ArrayBuffer,
	): Promise<void> {
		return settle(
			"saveAttachment",
			this.files.saveAttachment(projectId, key, metadata, body),
		);
	}

	removeAttachment(projectId: ProjectId, key: string): Promise<void> {
		return settle("removeAttachment", this.files.removeAttachment(projectId, key));
	}

	listLibraryRecords(namespace: string): Promise<readonly LibraryRecord[]> {
		return settle("listLibraryRecords", this.files.listLibraryRecords(namespace));
	}

	loadLibraryRecord(
		namespace: string,
		key: string,
	): Promise<LibraryRecord | null> {
		return settle("loadLibraryRecord", this.files.loadLibraryRecord(namespace, key));
	}

	saveLibraryRecord(record: LibraryRecord): Promise<void> {
		return settle("saveLibraryRecord", this.files.saveLibraryRecord(record));
	}

	removeLibraryRecord(namespace: string, key: string): Promise<void> {
		return settle(
			"removeLibraryRecord",
			this.files.removeLibraryRecord(namespace, key),
		);
	}

	inspectFiles(): Promise<{ readonly usedBytes: number }> {
		return settle("inspectFiles", this.files.inspectFiles());
	}

	clearFiles(scope: ProjectStoreClearScope): Promise<void> {
		return settle("clearFiles", this.files.clearFiles(scope));
	}
}
