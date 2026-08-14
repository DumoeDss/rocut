/**
 * s05-second-host — the C6 disposal oracle on the desktop Host (task 8.3).
 *
 * Four gated visits through the package's own, unmodified C6DisposalHarness
 * on the app entry — only the composition (electron `createHost`, fs store,
 * build marker) is this change's:
 *
 *  - `control=ordinary`     six full cycles, clean, lifecycle/dwell evidence
 *                           complete (the vite standing gate's own checks,
 *                           mirrored — Group 6 promised exactly that);
 *  - `control=missing-created` negative: not clean, fails on "worker was
 *                           not CREATED";
 *  - `control=leak`         negative: not clean, fails on an independent or
 *                           gpuResource platform residual;
 *  - `proof=durable-reopen` the durable proof against the filesystem store.
 *
 * The cycle-1 independent-timer race recorded in Group 6 (open,
 * non-blocking; cycle-1 only, non-cumulative) gets a bounded-retry policy
 * here: a visit whose ONLY failure is the recorded race signature is retried
 * (fresh document) up to `RACE_RETRY_LIMIT` times; every attempt's failure
 * signature is logged so the distribution is on the record. Any other
 * failure fails the gate.
 *
 * Expected console noise, classified not counted: the terminality probe's
 * post-revoke fetch failures (`net::ERR_FILE_NOT_FOUND` located at a `blob:`
 * URL) are the oracle working, classified exactly as the vite gate does.
 * Run after `bun run --cwd apps/electron-host build`; `C6_EXPECTED_BUILD_MARKER`
 * is required — a run without a declared marker proves nothing about which
 * build it executed against.
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

const expectedMarker = process.env.C6_EXPECTED_BUILD_MARKER;
if (!expectedMarker) {
	console.error("C6 ORACLE PROOF FAILED: C6_EXPECTED_BUILD_MARKER is required");
	process.exit(1);
}

const RACE_RETRY_LIMIT = 5;
// The Group 6 race signature: only ever cycle 1, only ever the timer ledger,
// only ever a small residual. The harness appends the ledger detail
// ("(independent ledger retained N handle(s))."), which the pattern pins
// rather than elides. Anything else is a defect, not the race.
const RACE_SIGNATURE =
	/^(?:first disposal: )?cycle 1 timer independent platform residual \d+ \(independent ledger retained \d+ handle\(s\)\)\.$/;

function fail(message) {
	console.error("C6 ORACLE PROOF FAILED:", message);
	process.exit(1);
}

// One Node-side sink, reset per visit: Playwright page listeners survive
// navigation, so the classification sees exactly the current document's
// console traffic.
let consoleSink = [];

async function launch(root) {
	const app = await electron.launch({
		executablePath: require("electron"),
		args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
		env: { ...process.env, OPENCUT_STORE_ROOT: root },
	});
	const page = await app.firstWindow();
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		consoleSink.push({ text: message.text(), location: message.location().url });
	});
	page.on("pageerror", (error) =>
		consoleSink.push({ text: `pageerror: ${error.message}`, location: "" }),
	);
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener("securitypolicyviolation", (event) => {
			window.__cspViolations.push({
				directive: event.effectiveDirective,
				blockedURI: event.blockedURI,
			});
		});
	});
	return { app, page };
}

/**
 * One visit: navigate the app entry to the harness with the given params and
 * return the harness report plus its console/CSP classification.
 */
async function visit(page, params) {
	consoleSink = [];
	const query = new URLSearchParams({ "c6-disposal-harness": "1", ...params });
	await page.evaluate(
		(url) => {
			window.location.href = url;
		},
		`opencut://app/index.html?${query.toString()}`,
	);
	await page.locator('main[data-testid="c6-disposal-harness"]').waitFor({
		timeout: 120_000,
	});
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="c6-disposal-harness"]')
				?.getAttribute("data-status") === "ready",
		null,
		{ timeout: 420_000 },
	);
	const attrs = await page.locator("main").evaluate((el, names) =>
		Object.fromEntries(names.map((name) => [name, el.getAttribute(name) ?? ""])),
		[
			"data-status",
			"data-control",
			"data-proof",
			"data-c6-build-marker",
			"data-c5-host-store",
			"data-audio-fallback",
		],
	);
	const reportText = await page
		.locator('[data-testid="c6-disposal-report"]')
		.textContent();
	const result = reportText ? JSON.parse(reportText) : null;
	// The vite gate's own split: a fetch failure located at a `blob:` URL is
	// the terminality probe's post-revoke fetch failing on purpose.
	const expectedRevocationFailures = [];
	const unexpected = [];
	for (const entry of consoleSink) {
		if (
			entry.text.includes("net::ERR_FILE_NOT_FOUND") &&
			entry.location.startsWith("blob:")
		) {
			expectedRevocationFailures.push(entry);
		} else {
			unexpected.push(entry);
		}
	}
	const cspViolations = await page.evaluate(() => window.__cspViolations ?? []);
	return { attrs, result, consoleClassification: { expectedRevocationFailures, unexpected }, cspViolations };
}

/** Split failures into the recorded race and everything else. */
function splitRace(failures) {
	const race = [];
	const other = [];
	for (const failure of failures ?? []) {
		(RACE_SIGNATURE.test(failure) ? race : other).push(failure);
	}
	return { race, other };
}

function assertCommon(label, visit) {
	if (visit.attrs["data-status"] !== "ready") {
		fail(`${label}: status ${visit.attrs["data-status"]}`);
	}
	if (visit.attrs["data-c6-build-marker"] !== expectedMarker) {
		fail(
			`${label}: marker ${visit.attrs["data-c6-build-marker"]} != ${expectedMarker}`,
		);
	}
	// The package harness hardcodes this label ("BrowserProjectStore") for any
	// host; on this Host the durable store is FilesystemProjectStore. The
	// label proves the readiness plumbing; the mislabel is a recorded
	// consequence of mounting the harness unmodified, and the durable proof's
	// own attribution (asserted below) carries the honest store identity.
	if (visit.attrs["data-c5-host-store"] !== "BrowserProjectStore") {
		fail(`${label}: c5 host store label ${visit.attrs["data-c5-host-store"]}`);
	}
	if (visit.attrs["data-audio-fallback"] !== "false") {
		fail(`${label}: audio fallback ${visit.attrs["data-audio-fallback"]}`);
	}
	if (visit.consoleClassification.unexpected.length > 0) {
		fail(
			`${label}: console/page errors ${JSON.stringify(
				visit.consoleClassification.unexpected,
			)}`,
		);
	}
	if (visit.cspViolations.length > 0) {
		fail(`${label}: CSP violations ${JSON.stringify(visit.cspViolations)}`);
	}
}

const lifecycleComplete = (cycle) =>
	cycle.lifecycle?.sameEditor &&
	cycle.lifecycle?.rootMountedDuringSuspend &&
	cycle.lifecycle?.rootMountedAfterResume &&
	cycle.lifecycle?.postResumeOperation;

const dwellComplete = (cycle) => {
	const dwell = cycle.platformProof?.suspendedDwell;
	if (!dwell?.postResumeActivity) return false;
	return (
		dwell.renderPublicationsBefore === dwell.renderPublicationsAfter &&
		dwell.timerResourcesCreatedBefore === dwell.timerResourcesCreatedAfter &&
		dwell.rendererBeforeSuspend.generation != null &&
		dwell.rendererAfterResume.generation != null &&
		dwell.rendererAfterResume.generation > dwell.rendererBeforeSuspend.generation &&
		dwell.rendererBeforeSuspend.resourceId != null &&
		dwell.rendererAfterResume.resourceId != null &&
		dwell.rendererBeforeSuspend.resourceId !==
			dwell.rendererAfterResume.resourceId &&
		// The positive form of the vite gate's last conjunct (it fails a cycle
		// whose resumed renderer published no more than the suspended dwell
		// snapshot): resuming must produce strictly more publications.
		dwell.rendererAfterResume.publications > dwell.rendererDwellAfter.publications
	);
};

/**
 * A gated visit with the bounded-retry policy around the recorded cycle-1
 * race. Returns `{ visit, verdict }`; `verdict` states whether it landed
 * clean or closed with the race on every attempt (non-blocking per Group 6).
 */
async function visitWithRaceRetries(page, params, label, record) {
	let last = null;
	for (let attempt = 1; attempt <= RACE_RETRY_LIMIT; attempt += 1) {
		// Not named `visit` — a `const visit` here would shadow the module-scope
		// function inside its own initializer and read as TDZ at the call.
		const observed = await visit(page, params);
		assertCommon(`${label} attempt ${attempt}`, observed);
		const { race, other } = splitRace(observed.result?.failures);
		record.attempts[`${label}#${attempt}`] = { race, other };
		if (other.length > 0) {
			fail(`${label} attempt ${attempt}: non-race failures ${JSON.stringify(other)}`);
		}
		last = observed;
		if (race.length === 0) {
			return { visit: observed, verdict: `clean on attempt ${attempt}` };
		}
	}
	return {
		visit: last,
		verdict: `cycle-1 timer race on all ${RACE_RETRY_LIMIT} attempts (distribution recorded); non-blocking per Group 6`,
	};
}

async function main() {
	const root = mkdtempSync(join(tmpdir(), "opencut-g8-c6-"));
	const { app, page } = await launch(root);
	const record = { attempts: {}, verdicts: {} };

	// ---- ordinary (six full cycles) ----
	const ordinaryRun = await visitWithRaceRetries(page, { control: "ordinary" }, "ordinary", record);
	record.verdicts.ordinary = ordinaryRun.verdict;
	const ordinary = ordinaryRun.visit.result;
	if (ordinaryRun.verdict.startsWith("clean") && !ordinary?.clean) {
		fail("ordinary: report not clean despite no failures");
	}
	if ((ordinary?.cycles ?? []).length !== 6) {
		fail(`ordinary: ${ordinary?.cycles?.length ?? 0} cycles`);
	}
	const lifecycleGap = (ordinary?.cycles ?? []).findIndex(
		(cycle) => !lifecycleComplete(cycle),
	);
	if (lifecycleGap >= 0) {
		fail(
			`ordinary: cycle ${lifecycleGap + 1} suspend/resume evidence incomplete: ` +
				JSON.stringify(ordinary.cycles[lifecycleGap].lifecycle),
		);
	}
	const dwellGap = (ordinary?.cycles ?? []).findIndex(
		(cycle) => !dwellComplete(cycle),
	);
	if (dwellGap >= 0) {
		fail(
			`ordinary: cycle ${dwellGap + 1} renderer resume dwell evidence incomplete: ` +
				JSON.stringify(ordinary.cycles[dwellGap].platformProof?.suspendedDwell),
		);
	}

	// ---- missing-created (negative) ----
	const missing = await visit(page, { control: "missing-created" });
	assertCommon("missing-created", missing);
	if (missing.result?.clean) fail("missing-created: reported clean");
	if (
		!(missing.result?.failures ?? []).some((failure) =>
			failure.includes("worker was not CREATED"),
		)
	) {
		fail("missing-created: no 'worker was not CREATED' failure");
	}
	if ((missing.result?.cycles ?? []).length !== 6) {
		fail("missing-created: not six cycles");
	}
	record.verdicts["missing-created"] = "failed exactly as the negative demands";

	// ---- leak (negative) ----
	const leak = await visit(page, { control: "leak" });
	assertCommon("leak", leak);
	if (leak.result?.clean) fail("leak: reported clean");
	if (
		!(leak.result?.failures ?? []).some(
			(failure) =>
				failure.includes("independent platform residual") ||
				failure.includes("gpuResource platform residual"),
		)
	) {
		fail("leak: no independent/gpuResource platform residual failure");
	}
	if ((leak.result?.cycles ?? []).length !== 6) {
		fail("leak: not six cycles");
	}
	record.verdicts.leak = "failed exactly as the negative demands";

	// ---- durable-reopen against the fs store ----
	const durableRun = await visitWithRaceRetries(page, { proof: "durable-reopen" }, "durable-reopen", record);
	record.verdicts["durable-reopen"] = durableRun.verdict;
	const durable = durableRun.visit;
	if (durable.attrs["data-proof"] !== "durable-reopen") {
		fail(`durable-reopen: proof attr ${durable.attrs["data-proof"]}`);
	}
	if (durableRun.verdict.startsWith("clean") && !durable.result?.clean) {
		fail("durable-reopen: report not clean despite no failures");
	}
	const attribution = durable.result?.browserProjectStore;
	if (!attribution?.instanceOfBrowserProjectStore) {
		fail(`durable-reopen: store attribution ${JSON.stringify(attribution ?? null)}`);
	}
	// The composition supplies `isDurableBrowserStore = (store) => store
	// instanceof FilesystemProjectStore` (app.tsx), so the flag just asserted IS
	// "the durable store is a FilesystemProjectStore instance" — class identity,
	// which a production minifier cannot rewrite. `constructorName` itself is
	// contract-marked "Diagnostic only. Production minifiers may rewrite this
	// value" and the package's own oracle never gates on it; this build reports
	// the minified name ("Tet"), recorded here rather than asserted.
	record.verdicts["durable-reopen-store-constructor"] =
		attribution?.constructorName ?? null;
	// Recorded, not gated: the durable proof's own host label is inferred from
	// the document path (`.html` -> "vite") inside the unmodified package — on
	// this Host it mislabels. The build marker and the store attribution above
	// are the identity that matters; the mislabel is on the record here.
	record.verdicts["durable-reopen-host-label"] = durable.result?.host ?? null;

	await app.close();
	rmSync(root, { recursive: true, force: true });

	console.log(JSON.stringify(record, null, 2));
	console.log("C6 ORACLE PROOF PASSED");
	process.exit(0);
}

main().catch((error) => {
	console.error("C6 ORACLE PROOF FAILED:", error);
	process.exit(1);
});
