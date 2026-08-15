/**
 * s05-second-host — the main-process half of the production bridge (task 4.6,
 * design E4).
 *
 * Compiled to `dist-main/main-store-ipc.cjs` by the package build (`bun
 * build`, node target — this module imports no Electron, only `node:`
 * builtins, so the bundle is pure) and required by `electron/main.cjs`, which
 * owns the Electron objects and passes its `ipcMain` in structurally.
 *
 * Given a root the main process owns, this installs the fourteen
 * `opencut-store:<operation>` IPC handlers over one `NodeFsStoreBridge` — the
 * same bridge class `bun test` exercises, which is the whole point: the
 * conformance evidence and the production path share one implementation.
 *
 * Channel discipline (the renderer-holds-no-paths guarantee): every handler's
 * arguments are identifiers and structured-clone values — project ids,
 * namespaces, keys, records, attachment bodies. No channel accepts or returns
 * a filesystem path; the bridge derives every path inside its root. The
 * structural test `__tests__/store-bridge-surface.test.ts` fails if the
 * preload's operation list drifts from this one.
 */
import type {
	LibraryRecord,
	ProjectAttachment,
	ProjectId,
	ProjectStoreClearScope,
} from "@opencut/editor-ports";
import { NodeFsStoreBridge } from "./node-fs-store-bridge";
import type {
	BridgeRecordListing,
	BridgeStoredRecord,
	ProjectStoreFiles,
} from "./project-store-files";

/** Every operation name below is mirrored verbatim in `electron/preload.cjs`. */
export const STORE_IPC_OPERATIONS = [
	"listRecords",
	"loadRecord",
	"saveRecord",
	"removeRecord",
	"listAttachments",
	"loadAttachment",
	"saveAttachment",
	"removeAttachment",
	"listLibraryRecords",
	"loadLibraryRecord",
	"saveLibraryRecord",
	"removeLibraryRecord",
	"inspectFiles",
	"clearFiles",
] as const;

export type StoreIpcOperation = (typeof STORE_IPC_OPERATIONS)[number];

export const STORE_IPC_CHANNEL_PREFIX = "opencut-store:";

/**
 * The slice of Electron's `ipcMain` this module needs, structurally. The
 * listener contract includes Electron's leading event parameter — forgetting
 * it passes the `IpcMainInvokeEvent` where the first payload argument belongs,
 * a failure only a production-path run can catch (the bun suites never
 * traverse IPC).
 */
export interface StoreIpcMain {
	handle<A extends unknown[]>(
		channel: string,
		listener: (event: unknown, ...args: A) => unknown,
	): void;
}

/**
 * Install the store's IPC handlers and return the bridge that backs them.
 * Electron erases error identity across IPC (only the message string
 * survives); the renderer's `IpcStoreBridge` re-wraps every failure, and
 * `FilesystemProjectStore.throughBridge` maps it to the port's typed taxonomy.
 */
export function installFilesystemStoreIpc(args: {
	ipcMain: StoreIpcMain;
	root: string;
	identity: string;
}): NodeFsStoreBridge {
	const bridge = new NodeFsStoreBridge({
		root: args.root,
		identity: args.identity,
	});
	const { ipcMain } = args;
	const channel = (operation: StoreIpcOperation): string =>
		`${STORE_IPC_CHANNEL_PREFIX}${operation}`;

	ipcMain.handle(channel("listRecords"), () => bridge.listRecords());
	ipcMain.handle(channel("loadRecord"), (_event, id: ProjectId) => bridge.loadRecord(id));
	ipcMain.handle(channel("saveRecord"), (_event, stored: BridgeStoredRecord) =>
		bridge.saveRecord(stored),
	);
	ipcMain.handle(channel("removeRecord"), (_event, id: ProjectId) => bridge.removeRecord(id));
	ipcMain.handle(channel("listAttachments"), (_event, projectId: ProjectId) =>
		bridge.listAttachments(projectId),
	);
	ipcMain.handle(
		channel("loadAttachment"),
		(_event, projectId: ProjectId, key: string) =>
			bridge.loadAttachment(projectId, key),
	);
	ipcMain.handle(
		channel("saveAttachment"),
		(
			_event,
			projectId: ProjectId,
			key: string,
			metadata: unknown,
			body: ArrayBuffer,
		) => bridge.saveAttachment(projectId, key, metadata, body),
	);
	ipcMain.handle(
		channel("removeAttachment"),
		(_event, projectId: ProjectId, key: string) =>
			bridge.removeAttachment(projectId, key),
	);
	ipcMain.handle(channel("listLibraryRecords"), (_event, namespace: string) =>
		bridge.listLibraryRecords(namespace),
	);
	ipcMain.handle(
		channel("loadLibraryRecord"),
		(_event, namespace: string, key: string) =>
			bridge.loadLibraryRecord(namespace, key),
	);
	ipcMain.handle(channel("saveLibraryRecord"), (_event, record: LibraryRecord) =>
		bridge.saveLibraryRecord(record),
	);
	ipcMain.handle(
		channel("removeLibraryRecord"),
		(_event, namespace: string, key: string) =>
			bridge.removeLibraryRecord(namespace, key),
	);
	ipcMain.handle(channel("inspectFiles"), () => bridge.inspectFiles());
	ipcMain.handle(channel("clearFiles"), (_event, scope: ProjectStoreClearScope) =>
		bridge.clearFiles(scope),
	);
	return bridge;
}
