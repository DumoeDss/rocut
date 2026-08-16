/**
 * sdk-export-capability — structural guarantees for the export bridge (design
 * D4/D6), the store-bridge pattern applied to the export seam. Source-shape
 * assertions, not behavior: the behavior lives in `job-manager.test.ts` (real
 * FFmpeg) and Group D's E2E. What only a structural check can catch is drift
 * between the four artifacts that make up the bridge —
 *
 *  1. the preload's exposed operation list must equal `EXPORT_IPC_OPERATIONS`
 *     (a sandboxed preload cannot require the compiled bundle, so the list is
 *     duplicated as data in `electron/preload.cjs`);
 *  2. the bridge-facing modules carry no filesystem path (identifiers and
 *     structured-clone values only), and the preload exposes exactly the two
 *     frozen globals;
 *  3. `main.cjs` wires the design-D3 root (`userData/exports`,
 *     `OPENCUT_EXPORT_ROOT` override), the compiled seam, the boot-time
 *     interrupt scan, and the hidden producer window;
 *  4. the committed CSP is byte-identical — IPC traffic is not `connect-src`,
 *     so the export bridge must not have forced a policy change (D4).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { EXPORT_IPC_OPERATIONS } from "../export-ipc-contract";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..", "..");
const read = (relative: string): string =>
	readFileSync(join(appRoot, relative), "utf8");

const preload = read("electron/preload.cjs");
const mainCjs = read("electron/main.cjs");
const mainExportIpc = read("src/export/main-export-ipc.ts");
const contract = read("src/export/export-ipc-contract.ts");

test("the preload's operation list equals EXPORT_IPC_OPERATIONS exactly", () => {
	const invoked = [...preload.matchAll(/EXPORT_OP_PREFIX \+ "([A-Za-z]+)"/g)].map(
		(match) => match[1],
	);
	expect(invoked.length).toBe(EXPORT_IPC_OPERATIONS.length);
	expect([...invoked].sort()).toEqual([...EXPORT_IPC_OPERATIONS].sort());
	expect(new Set(invoked).size).toBe(invoked.length);
});

test("the preload's event channels are the contract's, built without the op prefix", () => {
	// The three main→renderer channels are full literals in the preload so
	// the drift regex above cannot conflate them with operations; each must
	// still match the contract's exported name.
	expect(preload).toContain('const EXPORT_JOB_EVENT_CHANNEL = "opencut-export:jobEvent"');
	expect(preload).toContain('const EXPORT_FRAME_ACK_CHANNEL = "opencut-export:frameAck"');
	expect(preload).toContain(
		'const EXPORT_JOBS_CHANGED_CHANNEL = "opencut-export:jobsChanged"',
	);
	expect(contract).toContain('EXPORT_JOB_EVENT_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}jobEvent`');
	expect(contract).toContain('EXPORT_FRAME_ACK_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}frameAck`');
	expect(contract).toContain(
		'EXPORT_JOBS_CHANGED_CHANNEL = `${EXPORT_IPC_CHANNEL_PREFIX}jobsChanged`',
	);
});

test("the preload exposes exactly the two frozen globals and touches no node module", () => {
	const exposures = [...preload.matchAll(/exposeInMainWorld\(/g)];
	expect(exposures.length).toBe(2);
	expect(preload).toContain('exposeInMainWorld("opencutStore"');
	expect(preload).toContain('exposeInMainWorld("opencutExport"');
	expect(preload).toContain('require("electron")');
	expect(preload).not.toMatch(/require\("node:/);
});

test("no bridge-facing module crosses a filesystem path", () => {
	// The manager derives every path inside the exports root main hands it;
	// the contract and the IPC installer are path-free modules by the same
	// argument as the store's bridge modules.
	expect(mainExportIpc).not.toMatch(/from "node:(fs|path)"/);
	expect(contract).not.toMatch(/from "node:/);
	const absolutePathLiteral = /(?:[A-Za-z]:\\\\|"(?:\/(?:Users|home|tmp|var)\/))/;
	for (const [name, source] of [
		["electron/preload.cjs", preload],
		["src/export/main-export-ipc.ts", mainExportIpc],
		["src/export/export-ipc-contract.ts", contract],
	] as const) {
		expect(absolutePathLiteral.test(source), name).toBe(false);
	}
});

test("the frame channel is fire-and-forget with a sender-directed ack", () => {
	expect(mainExportIpc).toContain('ipcMain.on(channel("frame")');
	expect(mainExportIpc).not.toContain('ipcMain.handle(channel("frame")');
	expect(mainExportIpc).toContain("event.sender.send(EXPORT_FRAME_ACK_CHANNEL");
});

test("main.cjs wires the D3 root, compiled seam, boot interrupt, and hidden window", () => {
	expect(mainCjs).toContain("OPENCUT_EXPORT_ROOT");
	expect(mainCjs).toContain('app.getPath("userData")');
	expect(mainCjs).toContain('path.join(app.getPath("userData"), "exports")');
	expect(mainCjs).toContain('require("../dist-main/main-export-ipc.cjs")');
	expect(mainCjs).toContain("installExportIpc");
	expect(mainCjs).toContain("interruptAllLive");
	expect(mainCjs).toContain("export-renderer.html");
	expect(mainCjs).toContain("show: false");
	// The interrupt scan lives in installExport and the boot body runs it
	// BEFORE createWindow — the job list the first panel sees cannot be a
	// lie. (Each needle is unique in main.cjs, so index order is call order.)
	const interruptAt = mainCjs.indexOf("manager.interruptAllLive()");
	const bootExportAt = mainCjs.indexOf("installExport(storeBridge)");
	const bootWindowAt = mainCjs.indexOf("mainWindow = createWindow()");
	expect(interruptAt).toBeGreaterThan(-1);
	expect(bootExportAt).toBeGreaterThan(-1);
	expect(bootWindowAt).toBeGreaterThan(bootExportAt);
});

test("the committed CSP is byte-identical (the export bridge forced no change)", () => {
	const expectedCspBlock = [
		'const CSP = [',
		'\t"default-src \'none\'",',
		'\t"script-src \'self\' \'wasm-unsafe-eval\'",',
		'\t"worker-src \'self\' blob:",',
		'\t"style-src \'self\' \'unsafe-inline\'",',
		'\t"img-src \'self\' data: blob:",',
		'\t"media-src \'self\' blob: data:",',
		'\t"font-src \'self\' data:",',
		'\t"connect-src \'self\' blob:",',
		'].join("; ")',
	].join("\n");
	expect(mainCjs).toContain(expectedCspBlock);
});
