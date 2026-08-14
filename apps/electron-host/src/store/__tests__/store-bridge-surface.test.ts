/**
 * s05-second-host — structural guarantees for the production store bridge
 * (task 4.6). These are source-shape assertions, not behavior tests: the
 * behavior lives in the conformance and migration-probe suites over
 * `NodeFsStoreBridge`; what only a structural check can catch is drift between
 * the three artifacts that make up the IPC bridge —
 *
 *  1. the preload's exposed operation list must equal
 *     `STORE_IPC_OPERATIONS` (a sandboxed preload cannot require the compiled
 *     bundle, so the list is duplicated as data in `electron/preload.cjs`);
 *  2. no bridge-facing module may accept or return a filesystem path, and the
 *     preload must expose exactly one global;
 *  3. `main.cjs` must resolve the store root the design names
 *     (`userData/projects`, `OPENCUT_STORE_ROOT` override) and require the
 *     compiled seam from `dist-main/`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { STORE_IPC_OPERATIONS } from "../main-store-ipc";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..", "..");
const read = (relative: string): string =>
	readFileSync(join(appRoot, relative), "utf8");

const preload = read("electron/preload.cjs");
const mainCjs = read("electron/main.cjs");
const mainStoreIpc = read("src/store/main-store-ipc.ts");
const ipcStoreBridge = read("src/store/ipc-store-bridge.ts");

test("the preload's operation list equals STORE_IPC_OPERATIONS exactly", () => {
	const invoked = [...preload.matchAll(/CHANNEL_PREFIX \+ "([A-Za-z]+)"/g)].map(
		(match) => match[1],
	);
	expect([...invoked].sort()).toEqual([...STORE_IPC_OPERATIONS].sort());
	expect(invoked.length).toBe(STORE_IPC_OPERATIONS.length);
});

test("the preload exposes exactly one global and touches no node module", () => {
	const exposures = [...preload.matchAll(/exposeInMainWorld\(/g)];
	expect(exposures.length).toBe(1);
	expect(preload).toContain('exposeInMainWorld("opencutStore"');
	expect(preload).toContain('require("electron")');
	expect(preload).not.toMatch(/require\("node:/);
});

test("no bridge-facing module crosses a filesystem path", () => {
	// The renderer adapter is a pure module; the IPC seam derives paths only
	// inside the bridge, which main.cjs feeds a root — neither signature
	// carries one.
	expect(ipcStoreBridge).not.toMatch(/from "node:/);
	expect(mainStoreIpc).not.toMatch(/from "node:path/);
	const absolutePathLiteral = /(?:[A-Za-z]:\\\\|"(?:\/(?:Users|home|tmp|var)\/))/;
	for (const [name, source] of [
		["electron/preload.cjs", preload],
		["src/store/main-store-ipc.ts", mainStoreIpc],
		["src/store/ipc-store-bridge.ts", ipcStoreBridge],
	] as const) {
		expect(absolutePathLiteral.test(source), name).toBe(false);
	}
});

test("main.cjs resolves the design-E4 root and requires the compiled seam", () => {
	expect(mainCjs).toContain('OPENCUT_STORE_ROOT');
	expect(mainCjs).toContain('app.getPath("userData")');
	expect(mainCjs).toContain('path.join(app.getPath("userData"), "projects")');
	expect(mainCjs).toContain('require("../dist-main/main-store-ipc.cjs")');
	expect(mainCjs).toContain("installFilesystemStoreIpc");
});
