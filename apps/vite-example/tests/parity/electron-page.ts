import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron, type ElectronApplication, type Page } from "@playwright/test";

/**
 * Task 7.2 — the page-acquisition seam for the desktop Host.
 *
 * The parity scenario's page is a browser-context page on the Vite and Next
 * hosts and a window of the launched desktop app on the Electron host. This
 * module is the whole difference: it launches the production app with the
 * gate-1 launch config against the built renderer and hands back the window's
 * `Page`. Nothing else about the scenario changes — the interaction bodies
 * address the returned page exactly as they address the fixture page.
 *
 * The app must already be built (`bun run --cwd apps/electron-host build`):
 * the main process serves `dist/` and installs `dist-main/`'s store IPC at
 * boot, so an unbuilt tree fails fast here rather than half-booting.
 *
 * The store root is a fresh temp directory per run (task 7.3: the parity run
 * must start from empty, and nothing in an evidence run writes toward
 * `userData`). `main.cjs`'s `storeRoot()` honors `OPENCUT_STORE_ROOT`; the
 * root is removed when the app closes.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const APP_ROOT = join(REPO_ROOT, "apps", "electron-host");

let opened: {
	readonly app: ElectronApplication;
	readonly page: Page;
	readonly storeRoot: string;
} | null = null;

/** Launch the desktop Host once per run and return its window page. */
export async function acquireElectronPage(): Promise<Page> {
	if (opened) return opened.page;

	if (
		!existsSync(join(APP_ROOT, "dist", "index.html")) ||
		!existsSync(join(APP_ROOT, "dist", "surface-evidence.html"))
	) {
		throw new Error(
			"the Electron host is not built — run `bun run --cwd apps/electron-host build` before the parity run",
		);
	}

	// Electron is a dependency of apps/electron-host, not of this package, so
	// the binary is resolved from there (the proof scripts do the same).
	const requireFromApp = createRequire(join(APP_ROOT, "package.json"));
	const storeRoot = mkdtempSync(join(tmpdir(), "opencut-parity-"));
	const app = await _electron.launch({
		executablePath: requireFromApp("electron"),
		args: [
			join(APP_ROOT, "electron", "main.cjs"),
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
		],
		env: { ...process.env, OPENCUT_STORE_ROOT: storeRoot },
	});
	const page = await app.firstWindow();
	opened = { app, page, storeRoot };
	return page;
}

/** Close the app and remove the run's disposable store root. */
export async function closeElectronPage(): Promise<void> {
	const current = opened;
	opened = null;
	if (!current) return;
	await current.app.close().catch(() => {});
	rmSync(current.storeRoot, { recursive: true, force: true });
}
