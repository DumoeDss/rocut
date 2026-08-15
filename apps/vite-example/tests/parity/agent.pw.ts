/**
 * T4 — the Agent scenario on a production Host, across a real reload.
 *
 * Runs through the **existing** shared evidence entry (`/surface-evidence`,
 * `/surface-evidence.html`) with `?scenario=agent`, so no Host page, Host
 * composition root or Vite entry list changes. The same spec drives both Hosts,
 * selected by `PARITY_HOST`, and writes its own per-Host ledger, reopen result
 * and run result; `script/check-agent-evidence.mjs` then refuses a set in which
 * either Host did not execute.
 *
 * The build marker must be declared by the runner:
 *   AGENT_EXPECTED_BUILD_MARKER=<marker> (or R2_EXPECTED_BUILD_MARKER)
 * A run whose page reports a different marker is evidence about some other
 * build and fails here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

import {
	AGENT_LEDGER_SCHEMA,
	AGENT_SCENARIO,
	type AgentLedger,
	type AgentReopenResult,
} from "@opencut/editor-contracts/vectors";

import { evidenceDestination } from "./evidence-path";
import { acquireElectronPage, closeElectronPage } from "./electron-page";
import { HOST } from "./host-profile";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const EVIDENCE = evidenceDestination({
	repoRoot: REPO_ROOT,
	change: "s0304-agent-transaction-evidence",
	leaf: `browser-agent/${HOST}`,
});
const EVIDENCE_DIR = EVIDENCE.dir;
const COMMITMENT_KEY = "t4-agent-evidence-commitment";
// The desktop Host serves the entry from its own `opencut://` scheme — a full
// URL, not a path (task 7.1's rule); the browser hosts keep their paths.
const ENTRY =
	HOST === "next"
		? "/surface-evidence"
		: HOST === "electron"
			? "opencut://app/surface-evidence.html"
			: "/surface-evidence.html";
const APPLY_URL = `${ENTRY}?scenario=agent`;
const REOPEN_URL = `${ENTRY}?scenario=agent&phase=reopen`;
const DECLARED_STEPS = AGENT_SCENARIO.steps.map((step) => step.id);

interface AgentEvidenceOutcome {
	readonly schema: string;
	readonly host: string;
	readonly buildMarker: string;
	readonly phase: "apply" | "reopen";
	readonly projectId: string | null;
	readonly ledger: AgentLedger | null;
	readonly reopen: AgentReopenResult | null;
	readonly assetMetadata: readonly Record<string, unknown>[];
	readonly attachmentBytesClaimed: boolean;
	readonly error: string | null;
}

const steps: Array<{ id: string; asserted: string[]; error: string | null }> =
	[];

function begin(id: string) {
	const step = { id, asserted: [] as string[], error: null as string | null };
	steps.push(step);
	return step;
}

async function readOutcome(page: Page): Promise<AgentEvidenceOutcome> {
	const text = await page.getByTestId("agent-evidence-ledger").textContent();
	if (!text) throw new Error("The agent evidence ledger is missing or empty.");
	return JSON.parse(text) as AgentEvidenceOutcome;
}

async function waitForRun(page: Page, phase: "apply" | "reopen"): Promise<void> {
	const harness = page.getByTestId("surface-evidence-harness");
	// Settle first, then assert the verdict: waiting on "ready" alone would time
	// out on a failed run instead of reporting what failed.
	await expect
		.poll(async () => harness.getAttribute("data-status"), {
			timeout: 300_000,
		})
		.not.toBe("starting");
	await expect(harness).toHaveAttribute("data-status", "ready");
	await expect(harness).toHaveAttribute("data-scenario", "agent");
	await expect(harness).toHaveAttribute("data-phase", phase);
	await expect
		.poll(
			async () =>
				((await page.getByTestId("agent-evidence-ledger").textContent()) ?? "")
					.length,
			{ timeout: 60_000 },
		)
		.toBeGreaterThan(0);
}

/** Mark the document so the next navigation can be proven to be a new one. */
async function markDocument(page: Page): Promise<void> {
	await page.evaluate(() => {
		Reflect.set(window, "__t4AgentSameDocument", true);
	});
}

async function documentIsNew(page: Page): Promise<boolean> {
	return page.evaluate(
		() => Reflect.get(window, "__t4AgentSameDocument") === undefined,
	);
}

test.describe.configure({ mode: "serial" });

test.afterEach(async () => {
	// The same seam teardown as the parity spec (task 7.2): the desktop
	// Host's app process and its disposable store root live for exactly this
	// run.
	await closeElectronPage();
});

test(`Agent transaction evidence — ${HOST} host`, async ({ page: fixturePage }) => {
	mkdirSync(EVIDENCE_DIR, { recursive: true });
	if (EVIDENCE.archived) {
		console.log(
			`[agent] the change has shipped; this run is regression output at ${EVIDENCE_DIR}, ` +
				"not evidence for the archived change.",
		);
	}
	steps.length = 0;
	// Task 7.2's page-acquisition seam, the same minimal branch the parity
	// spec gained: on the desktop Host the page is a window of the launched
	// app; on the browser hosts it is the fixture page, unchanged, and every
	// assertion below addresses `page` either way.
	const page: Page = HOST === "electron" ? await acquireElectronPage() : fixturePage;
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) =>
		consoleErrors.push(`pageerror: ${error.message}`),
	);
	await page.addInitScript(() => {
		localStorage.setItem("hasSeenOnboarding", "true");
	});

	const expectedMarker =
		process.env.AGENT_EXPECTED_BUILD_MARKER ??
		process.env.R2_EXPECTED_BUILD_MARKER;
	expect(
		expectedMarker,
		"the agent run must declare the build marker it is evidence for",
	).toBeTruthy();

	let applyOutcome: AgentEvidenceOutcome | null = null;
	let reopenOutcome: AgentEvidenceOutcome | null = null;
	let staleOutcome: AgentEvidenceOutcome | null = null;

	try {
		const apply = begin("apply-phase");
		await page.goto(APPLY_URL);
		await waitForRun(page, "apply");
		applyOutcome = await readOutcome(page);
		expect(applyOutcome.error).toBeNull();
		expect(applyOutcome.buildMarker).toBe(expectedMarker as string);
		expect(applyOutcome.host).toBe(HOST);
		const ledger = applyOutcome.ledger;
		expect(ledger, "the apply phase must emit a ledger").not.toBeNull();
		if (!ledger) throw new Error("no ledger");
		expect(ledger.schema).toBe(AGENT_LEDGER_SCHEMA);
		expect(ledger.driver).toBe("browser/session-transactions");
		expect(ledger.declaredSteps).toEqual(DECLARED_STEPS);
		expect(ledger.executedSteps).toEqual(DECLARED_STEPS);
		expect(ledger.steps.flatMap((step) => step.failures)).toEqual([]);
		expect(ledger.failureCodes).toEqual([]);
		expect(ledger.verdict).toBe("passed");
		for (const step of ledger.steps) {
			const declared = AGENT_SCENARIO.steps.find(
				(entry) => entry.id === step.id,
			);
			expect(
				step.assertionCount,
				`${step.id} asserted nothing`,
			).toBeGreaterThan(0);
			expect(step.applyCount).toBe(1);
			expect(step.revisionDelta).toBe(declared?.expect.revisionDelta ?? -1);
			expect(step.watcherCount).toBe(declared?.expect.watchDelta ?? -1);
			expect(step.durableSaves).toBe(
				declared?.expect.outcome === "accepted" ? 1 : 0,
			);
		}
		expect(ledger.totalAssertions).toBeGreaterThan(ledger.steps.length);
		expect(ledger.commitment).not.toBeNull();
		expect(ledger.commitment?.revision).toBeGreaterThan(0);
		expect(applyOutcome.attachmentBytesClaimed).toBe(false);
		expect(applyOutcome.assetMetadata.length).toBeGreaterThan(0);
		for (const asset of applyOutcome.assetMetadata) {
			// Catalog metadata only. No attachment byte is written by the scenario
			// and none is claimed to commit atomically with the project record.
			expect(Object.keys(asset).sort()).toEqual(
				["duration", "id", "kind", "name"].filter((key) => key in asset).sort(),
			);
			expect(asset).not.toHaveProperty("bytes");
		}
		apply.asserted.push(
			`apply phase committed revision ${ledger.commitment?.revision} across ${ledger.steps.length} declared steps with ${ledger.totalAssertions} assertions`,
		);
		await page.screenshot({
			path: resolve(EVIDENCE_DIR, "01-agent-apply.png"),
			fullPage: true,
		});

		const reopen = begin("reload-and-reopen");
		const committedRevision = ledger.commitment?.revision ?? -1;
		await markDocument(page);
		await page.goto(REOPEN_URL);
		expect(
			await documentIsNew(page),
			"the reopen phase must run in a new document, not the same one",
		).toBe(true);
		await waitForRun(page, "reopen");
		reopenOutcome = await readOutcome(page);
		expect(reopenOutcome.error).toBeNull();
		expect(reopenOutcome.projectId).toBe(applyOutcome.projectId);
		const reopenResult = reopenOutcome.reopen;
		expect(reopenResult).not.toBeNull();
		expect(reopenResult?.failures).toEqual([]);
		expect(reopenResult?.verdict).toBe("passed");
		expect(reopenResult?.observedRevision).toBe(committedRevision);
		expect(reopenResult?.expectedRevision).toBe(committedRevision);
		expect(reopenResult?.assertionCount).toBeGreaterThan(
			(ledger.commitment?.tracks.length ?? 0) +
				(ledger.commitment?.clips.length ?? 0),
		);
		reopen.asserted.push(
			`a fresh session over the same durable store reported revision ${reopenResult?.observedRevision} and matched ${reopenResult?.assertionCount} committed values`,
		);
		await page.screenshot({
			path: resolve(EVIDENCE_DIR, "02-agent-reopen.png"),
			fullPage: true,
		});

		const stale = begin("stale-reopen-control");
		await page.evaluate(
			({ key, revision }) => {
				const raw = localStorage.getItem(key);
				if (!raw) throw new Error("the control found no commitment to stale");
				const commitment = JSON.parse(raw) as { revision: number };
				commitment.revision = revision - 1;
				localStorage.setItem(key, JSON.stringify(commitment));
			},
			{ key: COMMITMENT_KEY, revision: committedRevision },
		);
		await page.goto(REOPEN_URL);
		await waitForRun(page, "reopen");
		staleOutcome = await readOutcome(page);
		expect(staleOutcome.reopen?.verdict).toBe("failed");
		expect(staleOutcome.reopen?.expectedRevision).toBe(committedRevision - 1);
		expect(staleOutcome.reopen?.observedRevision).toBe(committedRevision);
		expect(staleOutcome.reopen?.failures.join(" ")).toContain(
			"reopened revision",
		);
		stale.asserted.push(
			"asserting one revision lower than committed failed the reopen step, so the assertion is bound to the observed value",
		);
	} catch (error) {
		const current = steps.at(-1);
		if (current) {
			current.error = error instanceof Error ? error.message : String(error);
		}
		throw error;
	} finally {
		writeFileSync(
			resolve(EVIDENCE_DIR, `ledger-${HOST}.json`),
			`${JSON.stringify(
				{
					host: HOST,
					generatedAt: new Date().toISOString(),
					declaredSteps: DECLARED_STEPS,
					apply: applyOutcome,
					reopen: reopenOutcome,
					staleControl: staleOutcome,
					steps,
					consoleErrors,
				},
				null,
				2,
			)}\n`,
		);
	}

	const unevidenced = steps.filter((step) => step.asserted.length === 0);
	expect(
		unevidenced.map((step) => step.id),
		"every agent step must carry an assertion",
	).toEqual([]);
	expect(
		steps.filter((step) => step.error !== null).map((step) => step.id),
		"no agent step may fail",
	).toEqual([]);
	expect(
		consoleErrors,
		"no browser console or page error may survive the agent run",
	).toEqual([]);
});
