/**
 * s05-second-host — the Electron boot proof (task 3.3) and the launcher the
 * later boot gate (task 5.4) reuses.
 *
 * Launches the built app with the gate-1 launch config (executablePath =
 * require("electron") — the binary path, NOT require.resolve, which is the
 * package's index.js and dies on Windows; see evidence/gate-1-desktop-
 * substrate.md), drives the project picker, and proves the real editor boots
 * to an interactive timeline from the scheme origin.
 *
 * Selector policy is the parity harness's: no testid was added to the editor;
 * the proof keys off the main-track ARIA label and the timecode title the
 * editor already ships (tests/parity/driver.ts).
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const mainPath = join(appRoot, "electron", "main.cjs");
const evidenceDir = join(appRoot, "..", "..", "rasen", "changes", "s05-second-host", "evidence");

const MAIN_TRACK = 'button[aria-label="Select Main Track track"]';
const TIMECODE = 'button[title="Click to edit time"]';

const consoleErrors = [];
let cspViolations = [];

async function main() {
	const app = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	});
	const page = await app.firstWindow();
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

	await page.getByRole("button", { name: "New project" }).waitFor({ timeout: 120_000 });

	// Instrument for CSP violations, then reload so the whole load path (not
	// only what came after this script attached) is observed. addInitScript,
	// not evaluate: the listener must re-register on every navigation.
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.__cspViolations.push({
				directive: event.effectiveDirective,
				blockedURI: event.blockedURI,
			});
		});
	});
	await page.reload();
	await page.getByRole("button", { name: "New project" }).waitFor({ timeout: 120_000 });

	const origin = await page.evaluate(() => location.origin);

	// Create a project through the picker — the identity seam, exercised for
	// real rather than bypassed with a hand-crafted id.
	await page.getByRole("button", { name: "New project" }).click();
	const urlAfterCreate = await page.waitForFunction(
		() => window.location.search.includes("project="),
		null,
		{ timeout: 30_000 },
	).then((handle) => handle.evaluate(() => window.location.search));

	// The editor is on screen once its own main track exists (host-neutral).
	await page.locator(MAIN_TRACK).first().waitFor({ timeout: 300_000 });
	await page.locator(TIMECODE).first().waitFor({ timeout: 300_000 });

	// First-run onboarding dialog is editor source; dismiss and report it, the
	// parity harness's own policy.
	const dialog = page.locator('[role="dialog"]').first();
	const dialogTitle = (await dialog.isVisible().catch(() => false))
		? ((await dialog.textContent()) ?? "").trim().slice(0, 120)
		: null;
	if (dialogTitle !== null) {
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden", timeout: 30_000 });
	}

	await page.waitForTimeout(2_000);
	cspViolations = await page.evaluate(() => window.__cspViolations ?? []);

	mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
	await page.screenshot({
		path: join(evidenceDir, "screenshots", "group-3-boot-proof.png"),
		fullPage: false,
	});

	await app.close();

	const verdict = {
		origin,
		urlAfterCreate,
		onboardingDialog: dialogTitle,
		mainTrackVisible: true,
		cspViolations,
		consoleErrors,
	};
	console.log(JSON.stringify(verdict, null, 2));

	if (origin !== "opencut://app") {
		console.error("FAIL: renderer origin is not opencut://app");
		process.exit(1);
	}
	if (cspViolations.length > 0) {
		console.error("FAIL: CSP violations observed during boot");
		process.exit(1);
	}
	if (consoleErrors.length > 0) {
		console.error("FAIL: console errors observed during boot");
		process.exit(1);
	}
	console.log("BOOT PROOF PASSED");
	process.exit(0);
}

main().catch(async (err) => {
	console.error("BOOT PROOF FAILED:", err);
	console.error("console errors so far:", JSON.stringify(consoleErrors, null, 2));
	try {
		mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
	} catch {}
	process.exit(1);
});
