"use strict";
/**
 * s05-second-host — the Electron main process (design E2).
 *
 * Three processes: this main (owns all serving; no node:fs crosses into the
 * renderer at this stage), a fully sandboxed preload (contextIsolation on,
 * nodeIntegration off, nothing exposed until the Group 4 store bridge), and
 * the Vite-built renderer served from the registered `opencut://` scheme —
 * never `file://`, whose null origin degrades workers, wasm and fetch, the
 * exact failure class this host exists to exercise properly.
 *
 * The privileged-scheme registration + `protocol.handle` + CSP-header shape is
 * the one the gate-1 spike proved against Electron 43.4.0
 * (evidence/gate-1-desktop-substrate.md).
 */
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const DIST_ROOT = path.join(__dirname, "..", "dist");
const SCHEME = "opencut";
const APP_HOST = "app";

/**
 * Design E7's starting set — a hypothesis, not a decision. The boot gate
 * (task 5.4) treats any CSP violation report as a failure; any relaxation
 * names the feature that forced it, here and in the evidence. The identical
 * policy rides along in index.html as a <meta> so it is visible in the
 * artifact.
 *
 * One attributed relaxation from the starting set (Group 6, task 5.4's own
 * mechanism): `connect-src` gains `blob:` — forced by the C6 disposal
 * oracle's object-URL terminality probe, which fetches the `blob:` URL it
 * created to prove revoke semantics (`URL.createObjectURL` → fetch →
 * revoke → fetch must fail). Under `connect-src 'self'` alone the probe's
 * first fetch is blocked, the terminality is "not proven", and the oracle
 * fails all six cycles. Recorded in the Group 6 evidence with the violation
 * reports that demonstrated it.
 */
const CSP = [
	"default-src 'none'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"worker-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"media-src 'self' blob: data:",
	"font-src 'self' data:",
	"connect-src 'self' blob:",
].join("; ");

const MIME_BY_EXTENSION = {
	".avif": "image/avif",
	".css": "text/css",
	".htm": "text/html",
	".html": "text/html",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript",
	".json": "application/json",
	".mjs": "text/javascript",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

// Must run before app ready (Electron raises otherwise). `standard` gives the
// scheme a real origin and URL semantics; `secure` keeps mixed-content rules;
// `supportFetchAPI` + `stream` let the renderer fetch scheme-served assets.
protocol.registerSchemesAsPrivileged([
	{
		scheme: SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
	},
]);

/**
 * The start entry: `--opencut-entry=<name>` (Playwright passes it after the
 * app path, the argv equivalent of the Vite example's separate HTML files) or
 * `OPENCUT_ENTRY`. The name selects `<dist>/<name>.html`. Validated, because
 * it is interpolated into a URL this process loads.
 */
function selectedEntry() {
	const flag = `--${SCHEME}-entry=`;
	const fromArg = process.argv.find((arg) => arg.startsWith(flag));
	const name = fromArg ? fromArg.slice(flag.length) : process.env.OPENCUT_ENTRY;
	if (name === undefined || name === "") return "index";
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		throw new Error(`opencut: refusing unvalidated entry name "${name}"`);
	}
	return name;
}

function notFound() {
	// Every scheme response carries the committed policy, including errors
	// (spec: "every response under that scheme SHALL carry...").
	return new Response("not found", {
		status: 404,
		headers: { "Content-Security-Policy": CSP },
	});
}

/** `opencut://app/<path>` → the built renderer output (design E2/E5). */
function schemeHandler(request) {
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return notFound();
	}
	if (url.host !== APP_HOST) return notFound();

	let relative;
	try {
		relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	} catch {
		return notFound();
	}
	const target = relative === "" ? "index.html" : relative;
	const resolved = path.resolve(DIST_ROOT, target);
	if (resolved !== DIST_ROOT && !resolved.startsWith(DIST_ROOT + path.sep)) {
		return new Response("forbidden", {
			status: 403,
			headers: { "Content-Security-Policy": CSP },
		});
	}

	let stat;
	try {
		stat = statSync(resolved);
	} catch {
		return notFound();
	}
	if (!stat.isFile()) return notFound();

	const body = readFileSync(resolved);
	const mime = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": mime,
			"Content-Security-Policy": CSP,
		},
	});
}

/**
 * The store's durable root (design E4): a directory this process owns and the
 * renderer never learns. `app.getPath("userData")/projects` in production;
 * `OPENCUT_STORE_ROOT` overrides it for parity/disposal/evidence runs, which
 * need throwaway roots.
 */
function storeRoot() {
	return process.env.OPENCUT_STORE_ROOT || path.join(app.getPath("userData"), "projects");
}

/**
 * Task 4.6: install the fourteen `opencut-store:<operation>` IPC handlers over
 * one `NodeFsStoreBridge` (the compiled store seam — same bridge class the bun
 * conformance/probe evidence runs), then write the boot bookkeeping: the
 * design-E4 `<root>/store.json` carrying the store identity and a fresh usage
 * inspection. Advisory only — a failed refresh must never block boot.
 *
 * Returns the bridge: sdk-export-capability's export installer reads project
 * meta (name + updatedAt) through it for the output name and the
 * stale-timeline guard.
 */
function installStore() {
	const { installFilesystemStoreIpc } = require("../dist-main/main-store-ipc.cjs");
	const bridge = installFilesystemStoreIpc({
		ipcMain,
		root: storeRoot(),
		identity: "opencut-fs-production",
	});
	bridge.inspectFiles().catch(() => {});
	return bridge;
}

/**
 * The export jobs' durable root (design D3): a directory this process owns
 * and the renderer never learns. `app.getPath("userData")/exports` in
 * production; `OPENCUT_EXPORT_ROOT` overrides it for evidence runs (E: scratch
 * in the recorded runs — a full drive was the constraint, not a choice).
 */
function exportsRoot() {
	return process.env.OPENCUT_EXPORT_ROOT || path.join(app.getPath("userData"), "exports");
}

let mainWindow = null;
/** Hidden producer windows by jobId (design D3's two-window architecture). */
const exportWindows = new Map();

/**
 * Fan every job event out to the windows that listen: the interactive window
 * (the job panel) and every live producer window. A `settled` event also
 * destroys that job's producer window — the belt-and-braces half of the
 * window's own `jobDone` signal, and the only cleanup for a window that
 * hung after its job settled.
 */
function forwardJobEvent(event) {
	const targets = [];
	if (mainWindow !== null && !mainWindow.isDestroyed()) targets.push(mainWindow);
	for (const win of exportWindows.values()) {
		if (!win.isDestroyed()) targets.push(win);
	}
	for (const win of targets) {
		if (event.channel === "jobEvent") {
			win.webContents.send("opencut-export:jobEvent", event.payload);
		} else if (event.channel === "jobsChanged") {
			win.webContents.send("opencut-export:jobsChanged");
		}
	}
	if (
		event.channel === "jobEvent" &&
		event.payload.event.type === "settled"
	) {
		destroyExportWindow(event.payload.jobId);
	}
}

/** Create (or return the existing) hidden producer window for a job. */
function openExportRenderer(manager, jobId) {
	const existing = exportWindows.get(jobId);
	if (existing !== undefined && !existing.isDestroyed()) return existing;
	const job = manager.getJob({ jobId });
	if (job === null) return null;
	const win = new BrowserWindow({
		show: false,
		// Same isolation posture as the interactive window; GPU switches
		// (swiftshader) are process-wide argv, so the hidden window inherits
		// whatever the app booted with.
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	exportWindows.set(jobId, win);
	win.on("closed", () => exportWindows.delete(jobId));
	const query =
		"project=" + encodeURIComponent(job.request.projectId) +
		"&job=" + encodeURIComponent(jobId);
	win.loadURL(`${SCHEME}://${APP_HOST}/export-renderer.html?${query}`);
	return win;
}

function destroyExportWindow(jobId) {
	const win = exportWindows.get(jobId);
	if (win !== undefined && !win.isDestroyed()) win.close();
}

/**
 * sdk-export-capability (design D3/D4): install the thirteen
 * `opencut-export:<operation>` IPC handlers over one `ExportJobManager` (the
 * compiled export seam — same manager class the bun suite runs against real
 * FFmpeg), discover FFmpeg (env `OPENCUT_FFMPEG_PATH` → `<exe dir>/bin` →
 * `PATH`; never bundled), then run the boot-time interrupt scan: every record
 * left live by a previous process becomes `interrupted` BEFORE any window
 * exists, so the panel that boots next sees a resumable list, never a lie.
 */
function installExport(storeBridge) {
	const { installExportIpc, resolveFfmpegPath, projectContentDigest, projectTimelineDigest } =
		require("../dist-main/main-export-ipc.cjs");
	const { mkdirSync } = require("node:fs");
	const root = exportsRoot();
	mkdirSync(root, { recursive: true });
	const ffmpegPath = resolveFfmpegPath({
		envValue: process.env.OPENCUT_FFMPEG_PATH,
		configuredRoot: path.dirname(app.getPath("exe")),
	});
	const manager = installExportIpc({
		ipcMain,
		exportsRoot: root,
		ffmpegPath,
		onJobEvent: forwardJobEvent,
		openExportRenderer: ({ jobId }) => openExportRenderer(manager, jobId),
		// The digest rides the bundle's own recipe (projectContentDigest in
		// the contract module) so main and the producer window compare like
		// with like — metadata (summary.updatedAt) must NOT feed the guard:
		// reopening a project bumps it via the thumbnail save, which used to
		// invalidate every interrupted job the moment its project was
		// reopened to reach Resume (the D2 recovery finding).
		getProjectMeta: ({ projectId }) =>
			storeBridge
				.loadRecord(projectId)
				.then(async (stored) =>
					stored === null
						? null
						: {
								name: stored.summary.name,
								contentDigest: await projectTimelineDigest(
									stored.record.data,
								),
							},
				)
				.catch(() => null),
		onJobDone: ({ jobId }) => destroyExportWindow(jobId),
	});
	manager.interruptAllLive();
	return manager;
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
		},
	});
	const entry = selectedEntry();
	win.loadURL(`${SCHEME}://${APP_HOST}/${entry}.html`);
	return win;
}

app.whenReady().then(() => {
	protocol.handle(SCHEME, schemeHandler);
	const storeBridge = installStore();
	installExport(storeBridge);
	mainWindow = createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
