// The agent-transaction example (S05 P6 task 3.2).
//
// The published AGENT_SCENARIO drives the published transaction engine over
// THIS example's own in-memory store (src/own-store.ts) through the frozen S03
// transaction API: every declared step executed and asserted by the published
// runner, the ledger written to ledger.json, and reload-reopen durability
// proven against a FRESH store instance over the same persisted data — the
// snapshot is serialized out of the first store and a new one is constructed
// from it, so the reopened engine decodes persisted bytes, not live objects.
// No browser, no React, no classic.
import { writeFileSync } from "node:fs";

import type { ProjectId } from "@opencut/editor-ports";
import { frameRate, projectId, type Project } from "@opencut/editor-contracts";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
	openTransactionEngine,
} from "@opencut/editor-contracts/engine";
import {
	AGENT_SCENARIO,
	runAgentScenario,
	verifyAgentReopen,
} from "@opencut/editor-contracts/vectors";

import { OwnInMemoryStore } from "./src/own-store";

const PROJECT: Project = {
	id: projectId("agent-example-project"),
	name: "Agent transaction example",
	frameRate: frameRate({ numerator: 30, denominator: 1 }),
	canvasWidth: 1920,
	canvasHeight: 1080,
};

const failures: string[] = [];
function check(ok: boolean, label: string): void {
	console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
	if (!ok) failures.push(label);
}

async function openEngine(store: OwnInMemoryStore) {
	return openTransactionEngine({
		store,
		projectId: PROJECT.id as ProjectId,
		documentAdapter: createTransactionNativeDocumentAdapter(),
	});
}

// (1) Seed the store the way an adopter would: one save of the native seed.
const store = new OwnInMemoryStore();
const seed = createTransactionNativeProjectSeed({
	projectId: PROJECT.id as ProjectId,
	project: PROJECT,
});
await store.save({ record: seed.record, summary: seed.summary });

// (2) Run the whole declared scenario through the engine over that store.
const engine = await openEngine(store);
const ledger = await runAgentScenario({
	target: engine,
	driver: "example/agent-transaction",
	host: "node",
	buildMarker: "s05-published-examples/agent-transaction",
	durableSaves: () => store.saveCount,
});

// (3) The ledger is the evidence: verdict, plan fidelity, per-step durability.
check(ledger.verdict === "passed", `ledger verdict ${ledger.verdict}`);
check(ledger.failureCodes.length === 0, `ledger failure codes: ${ledger.failureCodes.join(",") || "(none)"}`);
check(
	ledger.executedSteps.join("|") === AGENT_SCENARIO.steps.map((step) => step.id).join("|"),
	`executed exactly the declared plan (${ledger.executedSteps.length} step(s))`,
);
check(ledger.totalAssertions > 0, `ledger asserts ${ledger.totalAssertions} comparison(s)`);
check(ledger.commitment !== null, "ledger carries a commitment read back from the target");
for (const step of ledger.steps) {
	const declared = AGENT_SCENARIO.steps.find((entry) => entry.id === step.id);
	const expectedSaves = declared?.expect.outcome === "accepted" ? 1 : 0;
	check(
		step.durableSaves === expectedSaves,
		`step ${step.id}: verdict ${step.verdict}, ${step.assertionCount} assertion(s), ${step.durableSaves} durable save(s)`,
	);
}

// (4) The ledger is written, not just printed.
writeFileSync("ledger.json", `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger: written to ledger.json (schema ${ledger.schema}, revision ${ledger.commitment?.revision})`);

// (5) Reload-reopen durability: a FRESH store instance over the same persisted
// data, a fresh engine over that, and the published reopen verifier comparing
// field-for-field against what this run committed.
const persisted = store.exportSnapshot();
const reopenedStore = OwnInMemoryStore.fromSnapshot(persisted);
const reopenedEngine = await openEngine(reopenedStore);
const reopen = await verifyAgentReopen({
	target: reopenedEngine,
	commitment: ledger.commitment!,
});
check(reopen.verdict === "passed", `reopen verdict ${reopen.verdict} (${reopen.failures.join("; ") || "no failures"})`);
check(
	reopen.observedRevision === reopen.expectedRevision,
	`reopened revision ${reopen.observedRevision} == committed ${reopen.expectedRevision}`,
);
check(reopen.assertionCount > 0, `reopen asserted ${reopen.assertionCount} comparison(s)`);
check(reopenedStore !== store, "the reopened target is a fresh store instance, not the original");

if (failures.length > 0) {
	console.error(`agent-transaction: ${failures.length} assertion(s) failed`);
	process.exit(1);
}
console.log(
	`agent-transaction: scenario ${AGENT_SCENARIO.id} green end to end — ${ledger.totalAssertions} ledger assertion(s), reopen at revision ${reopen.observedRevision} over a fresh store from the persisted snapshot`,
);
