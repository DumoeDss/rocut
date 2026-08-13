#!/usr/bin/env node
/**
 * Dual-Host agent-evidence gate (S03 T4, tasks 6.4 / 7.x).
 *
 * The browser spec proves one Host at a time. This check reads the per-Host
 * artifacts afterwards and refuses the set unless **both** production Hosts
 * executed the same declared plan, reopened on the exact committed revision,
 * and demonstrated the stale-reopen control failing. A missing Host file is a
 * failure, not an absence: "no evidence" and "clean" must never look alike.
 *
 *   node script/check-agent-evidence.mjs
 *   node script/check-agent-evidence.mjs --negative-control
 *   node script/check-agent-evidence.mjs --converse-control
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGE = "s0304-agent-transaction-evidence";

/**
 * The evidence this gate judges moves when the change ships.
 *
 * While the change is active it lives under `rasen/changes/<change>/`; after
 * `rasen archive` the committed record is under
 * `rasen/changes/archive/<date>-<change>/`. Reading only the active path made
 * this gate go red the instant its own change archived — and red for the wrong
 * reason, because "the evidence moved" would have been reported as "no Host
 * executed". The rule that a missing Host is a failure is right; it must fire
 * on missing evidence, not on a stale path.
 */
function resolveEvidenceDir() {
	const active = join(REPO_ROOT, "rasen/changes", CHANGE, "evidence/browser-agent");
	if (existsSync(active)) return { dir: active, source: "active change" };
	const archiveRoot = join(REPO_ROOT, "rasen/changes/archive");
	const matches = existsSync(archiveRoot)
		? readdirSync(archiveRoot)
				.filter((entry) => entry.endsWith(`-${CHANGE}`))
				.sort()
		: [];
	// Newest wins if a change were ever archived twice; naming is date-prefixed.
	const newest = matches.at(-1);
	if (newest !== undefined) {
		return {
			dir: join(archiveRoot, newest, "evidence/browser-agent"),
			source: `archive ${newest}`,
		};
	}
	return { dir: active, source: "active change (absent)" };
}

const { dir: EVIDENCE_DIR, source: EVIDENCE_SOURCE } = resolveEvidenceDir();
const HOSTS = ["next", "vite"];

/**
 * The Node drivers' per-step comparison counts, pinned identically in
 * `apps/web/src/editor/contracts/vectors/__tests__/agent-drivers.test.ts` as
 * `NODE_DRIVER_ASSERTIONS`, where a live Node run must reproduce them.
 *
 * The implementation report's claim that the Hosts assert "exactly" what the
 * Node drivers assert was otherwise unenforced: this file compares Host to
 * Host, and the browser verifies itself internally, but nothing compared a
 * Host to Node. These two pins are that comparison. They are coupled by
 * convention rather than by a shared file, and a scenario change fails both.
 */
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

/**
 * Every rule, as a pure predicate over one Host's artifact, so the negative
 * control can drive each of them with a synthetic artifact.
 */
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

function artifactPath(host) {
	return join(EVIDENCE_DIR, host, `ledger-${host}.json`);
}

function readArtifact(host) {
	const path = artifactPath(host);
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function evaluate(artifact) {
	return RULES.map((rule) => {
		let passed = false;
		try {
			passed = rule.test(artifact) === true;
		} catch {
			passed = false;
		}
		return { id: rule.id, description: rule.description, passed };
	});
}

function runCheck() {
	console.log(
		`check-agent-evidence: dual-Host agent transaction evidence (${EVIDENCE_SOURCE})`,
	);
	let ok = true;
	const plans = new Map();
	let executed = 0;
	for (const host of HOSTS) {
		const artifact = readArtifact(host);
		if (!artifact) {
			ok = false;
			console.log(`  FAIL  ${host}: no artifact at ${artifactPath(host)}`);
			continue;
		}
		executed += 1;
		plans.set(host, JSON.stringify(artifact.declaredSteps ?? null));
		for (const result of evaluate(artifact)) {
			if (!result.passed) ok = false;
			console.log(
				`  ${result.passed ? "PASS" : "FAIL"}  ${host} ${result.id}: ${result.description}`,
			);
		}
		console.log(
			`        ${host} committed revision ` +
				`${artifact.apply?.ledger?.commitment?.revision ?? "none"} over ` +
				`${artifact.apply?.ledger?.steps?.length ?? 0} step(s), ` +
				`${artifact.apply?.ledger?.totalAssertions ?? 0} assertion(s), ` +
				`build marker ${artifact.apply?.buildMarker ?? "none"}`,
		);
	}

	if (executed < HOSTS.length) {
		ok = false;
		console.log(
			`  FAIL  only ${executed} of ${HOSTS.length} Hosts executed; a missing Host is a failure, not a skip`,
		);
	}
	const distinctPlans = new Set(plans.values());
	if (distinctPlans.size !== 1) {
		ok = false;
		console.log(
			`  FAIL  the Hosts did not execute one identical declared plan (${distinctPlans.size} distinct)`,
		);
	} else {
		console.log("  PASS  both Hosts executed one identical declared plan");
	}

	if (!ok) process.exit(1);
	console.log("\nclean — both Hosts executed, reopened and failed the control.");
}

/**
 * One artifact that satisfies every rule. Used twice: as the converse control
 * on its own, and as the base each negative fixture breaks in exactly one way.
 */
function soundArtifactFixture() {
	return {
		declaredSteps: NODE_STEP_IDS,
		consoleErrors: [],
		apply: {
			projectId: "p",
			buildMarker: "marker",
			error: null,
			attachmentBytesClaimed: false,
			assetMetadata: [{ id: "asset" }],
			ledger: {
				schema: "t4-agent-evidence-v1",
				verdict: "passed",
				failureCodes: [],
				declaredSteps: NODE_STEP_IDS,
				executedSteps: NODE_STEP_IDS,
				totalAssertions: NODE_TOTAL_ASSERTIONS,
				steps: NODE_STEP_IDS.map((id) => ({
					id,
					assertionCount: NODE_DRIVER_ASSERTIONS[id],
					verdict: "passed",
				})),
				commitment: { revision: 7 },
			},
		},
		reopen: {
			projectId: "p",
			reopen: {
				verdict: "passed",
				assertionCount: 9,
				observedRevision: 7,
				expectedRevision: 7,
			},
		},
		staleControl: {
			reopen: { verdict: "failed", observedRevision: 7, expectedRevision: 6 },
		},
	};
}

/**
 * The converse control: a sound artifact must trip no rule.
 *
 * A gate that fires on evidence it was built to accept is unusable, and it
 * would be indistinguishable from a gate that works until the day a real run
 * lands on it.
 */
function runConverseControl() {
	console.log("check-agent-evidence: converse control");
	const results = evaluate(soundArtifactFixture());
	let allAsExpected = true;
	for (const result of results) {
		if (!result.passed) allAsExpected = false;
		console.log(
			`  ${result.passed ? "PASS" : "FAIL"}  a sound artifact does not trip ${result.id}`,
		);
	}
	if (results.length !== RULES.length) {
		allAsExpected = false;
		console.log(
			`  FAIL  evaluated ${results.length} of ${RULES.length} rule(s); a converse control that skipped a rule proves nothing`,
		);
	} else {
		console.log(
			`  PASS  all ${RULES.length} rule(s) were evaluated against the fixture`,
		);
	}
	if (!allAsExpected) process.exit(1);
	console.log("\nconverse control clean — no rule fires on sound evidence.");
}

/** Each rule proven able to fail, and proven not to fail a sound artifact. */
function runNegativeControl() {
	console.log("check-agent-evidence: negative control");
	const sound = soundArtifactFixture();

	const breakers = {
		"ledger-present": (a) => {
			a.apply.ledger.steps = [];
		},
		"plan-executed": (a) => {
			a.apply.ledger.executedSteps = [];
		},
		"every-step-asserted": (a) => {
			a.apply.ledger.steps[0].assertionCount = 0;
		},
		"apply-passed": (a) => {
			a.apply.ledger.failureCodes = ["step-failed"];
		},
		"reopen-bound-to-commit": (a) => {
			a.reopen.reopen.observedRevision = 6;
		},
		"stale-control-failed": (a) => {
			a.staleControl.reopen.verdict = "passed";
		},
		"assertions-match-node": (a) => {
			// Still non-zero, so this breaks the Node comparison and nothing else.
			a.apply.ledger.steps[0].assertionCount += 1;
			a.apply.ledger.totalAssertions += 1;
		},
		"no-console-error": (a) => {
			a.consoleErrors = ["boom"];
		},
		"metadata-only": (a) => {
			a.apply.attachmentBytesClaimed = true;
		},
	};

	let allAsExpected = true;
	const clean = evaluate(sound);
	for (const result of clean) {
		if (!result.passed) allAsExpected = false;
		console.log(
			`  ${result.passed ? "PASS" : "FAIL"}  sound artifact satisfies ${result.id}`,
		);
	}
	for (const rule of RULES) {
		const broken = JSON.parse(JSON.stringify(sound));
		breakers[rule.id](broken);
		const results = evaluate(broken);
		const failed = results.find((entry) => entry.id === rule.id);
		const ok = failed !== undefined && !failed.passed;
		if (!ok) allAsExpected = false;
		console.log(
			`  ${ok ? "PASS" : "FAIL"}  ${rule.id} is proven able to fail`,
		);
	}
	if (!allAsExpected) process.exit(1);
	console.log("\nnegative control clean — a passing result is not vacuous.");
}

/**
 * An unrecognised flag must not silently fall through to the normal path: a
 * caller who mistypes a control would read a clean scan as though the control
 * had run.
 */
const KNOWN_FLAGS = new Set(["--negative-control", "--converse-control"]);
const unknown = process.argv.slice(2).filter((flag) => !KNOWN_FLAGS.has(flag));
if (unknown.length > 0) {
	console.error(
		`check-agent-evidence: unknown flag(s) ${unknown.join(", ")}. ` +
			`Known: ${[...KNOWN_FLAGS].join(", ")}.`,
	);
	process.exit(2);
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else if (process.argv.includes("--converse-control")) runConverseControl();
else runCheck();
