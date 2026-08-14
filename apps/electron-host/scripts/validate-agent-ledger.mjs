/**
 * s05-second-host — validate an agent ledger against the nine predicates
 * `script/check-agent-evidence.mjs` applies (task 8.2).
 *
 * The checker itself still reads the archived original pair and is NOT
 * repointed; this script applies the same nine predicates, rule bodies copied
 * verbatim from the checker, to a ledger path given as the first argument —
 * the hand-validation P1 performed for its regression runs, made repeatable
 * for the desktop Host's ledger.
 *
 * Usage: node apps/electron-host/scripts/validate-agent-ledger.mjs <ledger.json>
 */
import { readFileSync } from "node:fs";

// Verbatim from check-agent-evidence.mjs: the Node drivers' per-step
// comparison counts, pinned identically in
// packages/editor-contracts/src/vectors/__tests__/agent-drivers.test.ts.
const NODE_DRIVER_ASSERTIONS = {
	"build-structure": 23,
	"move-clip": 8,
	"trim-clip": 9,
	"split-clip": 12,
	"patch-project": 9,
	"keyed-commit": 8,
	"keyed-replay": 6,
	"keyed-reuse-different-payload": 5,
	"stale-expected-revision": 7,
};
const NODE_STEP_IDS = Object.keys(NODE_DRIVER_ASSERTIONS);
const NODE_TOTAL_ASSERTIONS = Object.values(NODE_DRIVER_ASSERTIONS).reduce(
	(total, count) => total + count,
	0,
);

// The checker's RULES, bodies verbatim, unchanged in meaning.
const RULES = [
	{
		id: "ledger-present",
		description: "the Host emitted an apply ledger with the agent schema",
		test: (a) =>
			a?.apply?.ledger?.schema === "t4-agent-evidence-v1" &&
			Array.isArray(a.apply.ledger.steps) &&
			a.apply.ledger.steps.length > 0,
	},
	{
		id: "plan-executed",
		description: "the executed plan is the declared plan, step for step",
		test: (a) =>
			Array.isArray(a?.declaredSteps) &&
			a.declaredSteps.length > 0 &&
			JSON.stringify(a.apply.ledger.executedSteps) ===
				JSON.stringify(a.declaredSteps) &&
			JSON.stringify(a.apply.ledger.declaredSteps) ===
				JSON.stringify(a.declaredSteps),
	},
	{
		id: "every-step-asserted",
		description: "no step reached a verdict without asserting something",
		test: (a) =>
			a.apply.ledger.steps.every(
				(step) => Number(step.assertionCount) > 0 && step.verdict === "passed",
			),
	},
	{
		id: "apply-passed",
		description: "the apply phase reported no failure code",
		test: (a) =>
			a.apply.ledger.verdict === "passed" &&
			(a.apply.ledger.failureCodes ?? []).length === 0 &&
			a.apply.error === null,
	},
	{
		id: "reopen-bound-to-commit",
		description:
			"a fresh session reported the exact revision committed before the reload",
		test: (a) =>
			a?.reopen?.reopen?.verdict === "passed" &&
			Number(a.reopen.reopen.assertionCount) > 0 &&
			a.reopen.reopen.observedRevision === a.apply.ledger.commitment.revision &&
			a.reopen.reopen.expectedRevision === a.apply.ledger.commitment.revision &&
			a.reopen.projectId === a.apply.projectId,
	},
	{
		id: "stale-control-failed",
		description:
			"the stale-reopen control failed its step, proving the assertion can fail",
		test: (a) =>
			a?.staleControl?.reopen?.verdict === "failed" &&
			a.staleControl.reopen.observedRevision ===
				a.apply.ledger.commitment.revision &&
			a.staleControl.reopen.expectedRevision ===
				a.apply.ledger.commitment.revision - 1,
	},
	{
		id: "assertions-match-node",
		description:
			"every step asserted exactly what the Node drivers assert, step for step",
		test: (a) =>
			a.apply.ledger.steps.length === NODE_STEP_IDS.length &&
			a.apply.ledger.steps.every(
				(step) =>
					Number(step.assertionCount) === NODE_DRIVER_ASSERTIONS[step.id],
			) &&
			Number(a.apply.ledger.totalAssertions) === NODE_TOTAL_ASSERTIONS,
	},
	{
		id: "no-console-error",
		description: "the run produced no browser console or page error",
		test: (a) => (a.consoleErrors ?? []).length === 0,
	},
	{
		id: "metadata-only",
		description: "the run claims asset metadata only, never attachment bytes",
		test: (a) =>
			a.apply.attachmentBytesClaimed === false &&
			Array.isArray(a.apply.assetMetadata) &&
			a.apply.assetMetadata.length > 0,
	},
];

const [ledgerPath] = process.argv.slice(2);
if (!ledgerPath) {
	console.error("usage: validate-agent-ledger.mjs <ledger.json>");
	process.exit(2);
}

const artifact = JSON.parse(readFileSync(ledgerPath, "utf8"));
let failures = 0;
for (const rule of RULES) {
	const pass = rule.test(artifact);
	if (!pass) failures += 1;
	console.log(
		`  ${pass ? "PASS" : "FAIL"}  ${artifact.host} ${rule.id}: ${rule.description}`,
	);
}
const ledger = artifact.apply?.ledger;
console.log(
	`        ${artifact.host} committed revision ${ledger?.commitment?.revision} over ${ledger?.steps?.length} step(s), ${ledger?.totalAssertions} assertion(s), build marker ${artifact.apply?.buildMarker}`,
);
if (failures > 0) {
	console.error(`AGENT LEDGER VALIDATION FAILED: ${failures} predicate(s) failed`);
	process.exit(1);
}
console.log("AGENT LEDGER VALIDATION PASSED: all nine predicates");
