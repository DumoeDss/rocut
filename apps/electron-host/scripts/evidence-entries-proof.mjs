/**
 * s05-second-host — the evidence-entries confirmation (tasks 6.1/6.2/6.3).
 *
 * Group 6 authorship check, both entries in one script against disposable
 * `OPENCUT_STORE_ROOT`s (task 6.3: no evidence run writes toward `userData`):
 *
 *  - 6.1: launch with `--opencut-entry=surface-evidence`; the shared,
 *    unmodified `SurfaceEvidenceHarness` must render with
 *    `data-host="electron"` and reach `data-status="ready"`, its ledger
 *    element present.
 *  - 6.2: launch the app entry with `?c6-disposal-harness=1`; the package's
 *    own `C6DisposalHarness` must reach `data-status="ready"` with its
 *    ordinary control having completed cycles (the full oracle verdict,
 *    negatives and durable-reopen are Group 8's gate).
 *
 * Every launch records console errors and CSP violations; the surface entry
 * gates on zero of both, the C6 entry records them for the Group 8 record.
 * Run after `bun run --cwd apps/electron-host build`.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const mainPath = join(appRoot, "electron", "main.cjs");

function fail(message) {
	console.error("EVIDENCE ENTRIES PROOF FAILED:", message);
	process.exit(1);
}

async function launch(root, args) {
	const app = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, ...args, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		env: { ...process.env, OPENCUT_STORE_ROOT: root },
	});
	const page = await app.firstWindow();
	const consoleErrors = [];
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
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
	return { app, page, consoleErrors };
}

async function readAttrs(page, selector, names) {
	return page.locator(selector).evaluate(
		(el, attributeNames) =>
			Object.fromEntries(
				attributeNames.map((name) => [name, el.getAttribute(name) ?? ""]),
			),
		names,
	);
}

async function main() {
	// --- 6.1: the surface-evidence entry ---
	const surfaceRoot = mkdtempSync(join(tmpdir(), "opencut-g6-surface-"));
	const surface = await launch(surfaceRoot, ["--opencut-entry=surface-evidence"]);
	const surfaceHarness = surface.page.locator(
		'main[data-testid="surface-evidence-harness"]',
	);
	await surfaceHarness.waitFor({ timeout: 120_000 });
	await surface.page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="surface-evidence-harness"]')
				?.getAttribute("data-status") === "ready",
		null,
		{ timeout: 120_000 },
	);
	const surfaceAttrs = await readAttrs(surface.page, "main", [
		"data-host",
		"data-status",
	]);
	const surfaceLedgerPresent = await surface.page
		.locator('[data-testid="surface-evidence-ledger"]')
		.count();
	const surfaceViolations = await surface.page.evaluate(
		() => window.__cspViolations ?? [],
	);
	const surfaceOrigin = await surface.page.evaluate(() => location.origin);
	const surfaceUrl = surface.page.url();
	await surface.app.close();
	rmSync(surfaceRoot, { recursive: true, force: true });

	// --- 6.2: the C6 disposal dispatch on the app entry ---
	const disposalRoot = mkdtempSync(join(tmpdir(), "opencut-g6-disposal-"));
	const disposal = await launch(disposalRoot, []);
	await disposal.page.evaluate(() => {
		window.location.href = "opencut://app/index.html?c6-disposal-harness=1";
	});
	const disposalHarness = disposal.page.locator(
		'main[data-testid="c6-disposal-harness"]',
	);
	await disposalHarness.waitFor({ timeout: 120_000 });
	await disposal.page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="c6-disposal-harness"]')
				?.getAttribute("data-status") === "ready",
		null,
		{ timeout: 420_000 },
	);
	const disposalAttrs = await readAttrs(disposal.page, "main", [
		"data-status",
		"data-control",
		"data-proof",
		"data-c6-build-marker",
	]);
	const reportText = await disposal.page
		.locator('[data-testid="c6-disposal-report"]')
		.textContent();
	let disposalReport = null;
	try {
		disposalReport = JSON.parse(reportText ?? "");
	} catch {
		disposalReport = null;
	}
	const disposalViolations = await disposal.page.evaluate(
		() => window.__cspViolations ?? [],
	);
	await disposal.app.close();
	rmSync(disposalRoot, { recursive: true, force: true });

	const verdict = {
		surface: {
			origin: surfaceOrigin,
			url: surfaceUrl,
			attrs: surfaceAttrs,
			ledgerPresent: surfaceLedgerPresent > 0,
			cspViolations: surfaceViolations,
			consoleErrors: surface.consoleErrors,
		},
		disposal: {
			attrs: disposalAttrs,
			cycles: disposalReport?.cycles?.length ?? 0,
			failures: disposalReport?.failures ?? null,
			cspViolations: disposalViolations,
			consoleErrors: disposal.consoleErrors,
		},
	};
	console.log(JSON.stringify(verdict, null, 2));

	if (surfaceOrigin !== "opencut://app") fail(`surface origin is ${surfaceOrigin}`);
	if (surfaceAttrs["data-host"] !== "electron") {
		fail(`surface harness data-host is ${surfaceAttrs["data-host"]}`);
	}
	if (surfaceAttrs["data-status"] !== "ready") {
		fail(`surface harness status is ${surfaceAttrs["data-status"]}`);
	}
	if (surfaceLedgerPresent === 0) fail("surface-evidence ledger element is absent");
	if (surfaceViolations.length > 0) fail("CSP violations on the surface entry");
	if (surface.consoleErrors.length > 0) {
		fail(`console errors on the surface entry: ${JSON.stringify(surface.consoleErrors)}`);
	}
	if (disposalAttrs["data-status"] !== "ready") {
		fail(`disposal harness status is ${disposalAttrs["data-status"]}`);
	}
	if (disposalAttrs["data-control"] !== "ordinary") {
		fail(`disposal control is ${disposalAttrs["data-control"]}`);
	}
	if (!disposalReport) fail("disposal report did not parse as JSON");
	if ((disposalReport?.cycles?.length ?? 0) < 1) {
		fail("disposal ordinary control completed no cycles");
	}
	console.log("EVIDENCE ENTRIES PROOF PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("EVIDENCE ENTRIES PROOF FAILED:", err);
	process.exit(1);
});
