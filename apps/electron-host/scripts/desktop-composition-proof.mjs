/**
 * s05-second-host — the desktop composition proof (tasks 5.2/5.3/5.4).
 *
 * One production launch proves the three live halves of the Group 5
 * composition against the real scheme, the real preload bridge and a
 * disposable `OPENCUT_STORE_ROOT`:
 *
 *  - 5.2 runtime assets: the booted editor (picker → project → interactive
 *    timeline) fetches `fonts/font-atlas.json` and a font chunk from the
 *    `opencut://app` origin — through the composition's resolver+loader, not
 *    an editor-built URL.
 *  - 5.3 worker construction: the C4 fixture round-trips through the Host's
 *    `runtimeResources` at the scheme origin (foreign `request.invalid` URL
 *    rewritten; ping-pong with a transferred buffer; created/released 1/1).
 *  - 5.4 boot gate: production renderer under the scheme, editor to the
 *    interactive timeline, ZERO CSP violation reports and ZERO console
 *    errors — both are failures here, not warnings.
 *
 * Run after `bun run --cwd apps/electron-host build`. Every outcome is
 * reported as JSON before the pass/fail lines so the evidence log carries the
 * observations, not just the verdict.
 */
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const HARNESS_URL = "opencut://app/index.html?c4-worker-harness=1";

const consoleErrors = [];
const schemeRequests = [];
const foreignRequests = [];

function fail(message) {
	console.error("DESKTOP COMPOSITION PROOF FAILED:", message);
	console.error("console errors:", JSON.stringify(consoleErrors, null, 2));
	console.error("foreign requests:", JSON.stringify(foreignRequests, null, 2));
	process.exit(1);
}

async function main() {
	const root = mkdtempSync(join(tmpdir(), "opencut-g5-composition-"));
	const app = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		env: { ...process.env, OPENCUT_STORE_ROOT: root },
	});
	const page = await app.firstWindow();
	page.on("console", (msg) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	});
	page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
	page.on("request", (request) => {
		const url = request.url();
		if (url.startsWith("opencut://")) schemeRequests.push(url);
		else if (/^https?:/.test(url)) foreignRequests.push(url);
	});

	// CSP instrumentation must cover the whole load path: register before the
	// first paint we judge, then reload (addInitScript, not evaluate — the
	// listener has to re-register on every navigation, including the harness
	// navigation later).
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

	// --- 5.2 + 5.4: real editor boot through the picker (identity seam) ---
	await page.getByRole("button", { name: "New project" }).click();
	await page.waitForFunction(
		() => window.location.search.includes("project="),
		null,
		{ timeout: 30_000 },
	);
	await page.locator(MAIN_TRACK).first().waitFor({ timeout: 300_000 });
	await page.locator(TIMECODE).first().waitFor({ timeout: 300_000 });

	const dialog = page.locator('[role="dialog"]').first();
	if (await dialog.isVisible().catch(() => false)) {
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden", timeout: 30_000 });
	}
	// Settle so late atlas/chunk fetches and late errors are observed too.
	await page.waitForTimeout(3_000);

	const bootViolations = await page.evaluate(() => window.__cspViolations ?? []);
	mkdirSync(join(evidenceDir, "screenshots"), { recursive: true });
	await page.screenshot({
		path: join(evidenceDir, "screenshots", "group-5-boot-gate.png"),
		fullPage: false,
	});

	const atlasFetched = schemeRequests.some((url) =>
		url.includes("/fonts/font-atlas.json"),
	);
	const chunkFetched = schemeRequests.some((url) =>
		/font-chunk-\d+\.avif/.test(url),
	);

	// --- 5.3: the C4 worker harness at the scheme origin ---
	await page.evaluate((url) => {
		window.location.href = url;
	}, HARNESS_URL);
	const harness = page.locator('main[data-testid="c4-worker-harness"]');
	await harness.waitFor({ timeout: 120_000 });
	await page.waitForFunction(
		() =>
			document
				.querySelector('main[data-testid="c4-worker-harness"]')
				?.getAttribute("data-status") === "ready",
		null,
		{ timeout: 120_000 },
	);
	const attrs = await harness.evaluate((el) => {
		const get = (name) => el.getAttribute(name) ?? "";
		return {
			status: get("data-status"),
			requestId: get("data-request-id"),
			requestUrl: get("data-request-url"),
			requestType: get("data-request-type"),
			requestName: get("data-request-name"),
			rewrittenUrl: get("data-rewritten-url"),
			created: get("data-created"),
			released: get("data-released"),
			result: get("data-result"),
			buildMarker: get("data-c4-build-marker"),
		};
	});
	const harnessViolations = await page.evaluate(() => window.__cspViolations ?? []);
	await page.screenshot({
		path: join(evidenceDir, "screenshots", "group-5-worker-harness.png"),
		fullPage: false,
	});

	await app.close();
	rmSync(root, { recursive: true, force: true });

	const verdict = {
		origin,
		boot: {
			atlasFetched,
			chunkFetched,
			atlasUrls: schemeRequests.filter((u) => u.includes("font-atlas")),
			chunkUrls: schemeRequests.filter((u) => /font-chunk-\d+\.avif/.test(u)),
			cspViolations: bootViolations,
			consoleErrors: [...consoleErrors],
		},
		harness: {
			attrs,
			cspViolations: harnessViolations,
			requestInvalidNeverRequested: !foreignRequests.some((u) =>
				u.includes("request.invalid"),
			),
		},
		foreignRequests,
		schemeRequestCount: schemeRequests.length,
	};
	console.log(JSON.stringify(verdict, null, 2));

	// 5.4 — the boot gate. Violations and console errors are failures.
	if (origin !== "opencut://app") fail(`renderer origin is ${origin}`);
	if (bootViolations.length > 0) fail(`CSP violations during boot: ${JSON.stringify(bootViolations)}`);
	if (consoleErrors.length > 0) fail(`console errors: ${JSON.stringify(consoleErrors)}`);
	// 5.2 — runtime assets through the scheme.
	if (!atlasFetched) fail("fonts/font-atlas.json was never fetched from the scheme origin");
	if (!chunkFetched) fail("no font chunk (font-chunk-N.avif) was fetched from the scheme origin");
	// 5.3 — the worker fixture round trip.
	if (attrs.status !== "ready") fail(`harness status is ${attrs.status}`);
	if (attrs.requestId !== "c4-round-trip") fail(`request id is ${attrs.requestId}`);
	if (attrs.requestUrl !== "https://request.invalid/original-worker.js") {
		fail(`request url is ${attrs.requestUrl}`);
	}
	if (attrs.requestType !== "module") fail(`request type is ${attrs.requestType}`);
	if (attrs.requestName !== "OpenCut C4 Worker fixture") fail(`request name is ${attrs.requestName}`);
	if (attrs.rewrittenUrl !== "opencut://app/workers/c4-worker-fixture.js") {
		fail(`rewritten url is ${attrs.rewrittenUrl}`);
	}
	if (attrs.created !== "1" || attrs.released !== "1") {
		fail(`created/released is ${attrs.created}/${attrs.released}`);
	}
	if (attrs.result !== '{"kind":"pong","byteLength":4}') fail(`result is ${attrs.result}`);
	if (harnessViolations.length > 0) {
		fail(`CSP violations during the worker harness: ${JSON.stringify(harnessViolations)}`);
	}
	if (!verdict.harness.requestInvalidNeverRequested) {
		fail("request.invalid leaked to the network — the rewrite did not take");
	}
	console.log("DESKTOP COMPOSITION PROOF PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("DESKTOP COMPOSITION PROOF FAILED:", err);
	console.error("console errors so far:", JSON.stringify(consoleErrors, null, 2));
	process.exit(1);
});
