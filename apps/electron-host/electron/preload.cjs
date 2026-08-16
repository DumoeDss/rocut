"use strict";
/**
 * s05-second-host preload (design E2/E4) + sdk-export-capability export bridge
 * (design D3/D4).
 *
 * contextIsolation: true, sandbox: true, nodeIntegration: false — configured
 * in main.cjs. Exactly two objects cross the isolation boundary:
 *
 * - `window.opencutStore`, the `ProjectStoreFiles` surface (task 4.6). Every
 *   method forwards its arguments over one `opencut-store:<operation>` IPC
 *   channel; the main process does all `node:fs` work against a root it owns.
 * - `window.opencutExport`, the export job surface (design D3): the same
 *   store-bridge discipline over `opencut-export:<operation>` channels, plus
 *   the three main→renderer event channels (`jobEvent`, `frameAck`,
 *   `jobsChanged`) subscribed via the on* methods (each returns its own
 *   removal function).
 *
 * Both operation lists are mirrored as data — a sandboxed preload cannot
 * require the compiled bundles — and `__tests__/store-bridge-surface.test.ts`
 * / `src/export/__tests__/export-bridge-surface.test.ts` fail if either list
 * drifts from its main-process counterpart. The store list concatenates on
 * `CHANNEL_PREFIX`; the export list on `EXPORT_OP_PREFIX`; the export event
 * channels are full literals so the drift regexes cannot conflate the two.
 *
 * No value that crosses either bridge is a filesystem path: identifiers and
 * structured-clone payloads only (the renderer-holds-no-paths guarantee). A
 * completed export is named by its opaque `file:<name>` descriptor.
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

const EXPORT_OP_PREFIX = "opencut-export:";
const EXPORT_JOB_EVENT_CHANNEL = "opencut-export:jobEvent";
const EXPORT_FRAME_ACK_CHANNEL = "opencut-export:frameAck";
const EXPORT_JOBS_CHANGED_CHANNEL = "opencut-export:jobsChanged";

const opencutExport = {
	startJob: (args) => ipcRenderer.invoke(EXPORT_OP_PREFIX + "startJob", args),
	beginExport: (args) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "beginExport", args),
	// The one non-invoke operation: frame batches are high-volume, so they
	// travel ipcRenderer.send and main answers each batch with a frameAck
	// event (see onFrameAck) — the acknowledged backpressure.
	sendFrame: (message) => ipcRenderer.send(EXPORT_OP_PREFIX + "frame", message),
	audio: (args) => ipcRenderer.invoke(EXPORT_OP_PREFIX + "audio", args),
	finalize: (jobId) => ipcRenderer.invoke(EXPORT_OP_PREFIX + "finalize", { jobId }),
	failJob: (jobId, reason) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "failJob", { jobId, reason }),
	listJobs: () => ipcRenderer.invoke(EXPORT_OP_PREFIX + "listJobs"),
	getJob: (jobId) => ipcRenderer.invoke(EXPORT_OP_PREFIX + "getJob", { jobId }),
	cancelJob: (jobId) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "cancelJob", { jobId }),
	resumeJob: (jobId) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "resumeJob", { jobId }),
	discardJob: (jobId) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "discardJob", { jobId }),
	readJobOutputBytes: (jobId) =>
		ipcRenderer.invoke(EXPORT_OP_PREFIX + "readJobOutputBytes", { jobId }),
	jobDone: (jobId) => ipcRenderer.invoke(EXPORT_OP_PREFIX + "jobDone", { jobId }),
	// The capability probe (Group C): whether main's boot-time discovery found
	// an FFmpeg binary — backs canExport BEFORE any job exists.
	canExport: () => ipcRenderer.invoke(EXPORT_OP_PREFIX + "canExport"),
	// Main→renderer events. Every subscription returns its removal function.
	onJobEvent: (handler) => {
		const listener = (_event, payload) => handler(payload);
		ipcRenderer.on(EXPORT_JOB_EVENT_CHANNEL, listener);
		return () => ipcRenderer.removeListener(EXPORT_JOB_EVENT_CHANNEL, listener);
	},
	onFrameAck: (handler) => {
		const listener = (_event, payload) => handler(payload);
		ipcRenderer.on(EXPORT_FRAME_ACK_CHANNEL, listener);
		return () => ipcRenderer.removeListener(EXPORT_FRAME_ACK_CHANNEL, listener);
	},
	onJobsChanged: (handler) => {
		const listener = () => handler();
		ipcRenderer.on(EXPORT_JOBS_CHANGED_CHANNEL, listener);
		return () =>
			ipcRenderer.removeListener(EXPORT_JOBS_CHANGED_CHANNEL, listener);
	},
};

contextBridge.exposeInMainWorld("opencutStore", opencutStore);
contextBridge.exposeInMainWorld("opencutExport", opencutExport);
