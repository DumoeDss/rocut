"use strict";
/**
 * s05-second-host preload (design E2/E4) — the single exposed bridge.
 *
 * contextIsolation: true, sandbox: true, nodeIntegration: false — configured
 * in main.cjs. Exactly one object crosses the isolation boundary:
 * `window.opencutStore`, the `ProjectStoreFiles` surface (task 4.6). Every
 * method forwards its arguments over one `opencut-store:<operation>` IPC
 * channel; the main process does all `node:fs` work against a root it owns.
 *
 * The fourteen operation names mirror `STORE_IPC_OPERATIONS` in
 * `src/store/main-store-ipc.ts` exactly — a sandboxed preload cannot require
 * the compiled bundle, so the list lives here as data, and
 * `__tests__/store-bridge-surface.test.ts` fails if the two lists drift.
 *
 * No value that crosses this bridge is a filesystem path: identifiers and
 * structured-clone payloads only (the renderer-holds-no-paths guarantee).
 */
const { contextBridge, ipcRenderer } = require("electron");

const CHANNEL_PREFIX = "opencut-store:";

const opencutStore = {
	listRecords: () => ipcRenderer.invoke(CHANNEL_PREFIX + "listRecords"),
	loadRecord: (id) => ipcRenderer.invoke(CHANNEL_PREFIX + "loadRecord", id),
	saveRecord: (stored) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "saveRecord", stored),
	removeRecord: (id) => ipcRenderer.invoke(CHANNEL_PREFIX + "removeRecord", id),
	listAttachments: (projectId) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "listAttachments", projectId),
	loadAttachment: (projectId, key) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "loadAttachment", projectId, key),
	saveAttachment: (projectId, key, metadata, body) =>
		ipcRenderer.invoke(
			CHANNEL_PREFIX + "saveAttachment",
			projectId,
			key,
			metadata,
			body,
		),
	removeAttachment: (projectId, key) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "removeAttachment", projectId, key),
	listLibraryRecords: (namespace) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "listLibraryRecords", namespace),
	loadLibraryRecord: (namespace, key) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "loadLibraryRecord", namespace, key),
	saveLibraryRecord: (record) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "saveLibraryRecord", record),
	removeLibraryRecord: (namespace, key) =>
		ipcRenderer.invoke(CHANNEL_PREFIX + "removeLibraryRecord", namespace, key),
	inspectFiles: () => ipcRenderer.invoke(CHANNEL_PREFIX + "inspectFiles"),
	clearFiles: (scope) => ipcRenderer.invoke(CHANNEL_PREFIX + "clearFiles", scope),
};

contextBridge.exposeInMainWorld("opencutStore", opencutStore);
