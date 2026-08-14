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
	return new Response("not found", { status: 404 });
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
		return new Response("forbidden", { status: 403 });
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
 */
function installStore() {
	const { installFilesystemStoreIpc } = require("../dist-main/main-store-ipc.cjs");
	const bridge = installFilesystemStoreIpc({
		ipcMain,
		root: storeRoot(),
		identity: "opencut-fs-production",
	});
	bridge.inspectFiles().catch(() => {});
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
	installStore();
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
