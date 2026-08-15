/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The session transaction facade satisfies the vector target structurally, and the donor fixture builds branded times. */
import { describe, expect, test } from "bun:test";

import { SessionPersistenceCoordinator } from "../../../persistence";
import {
	SessionOpenCutTransactions,
	type OpenCutProjectDraft,
} from "..";
import {
	projectFixture,
	storeFixture,
	TEST_PROJECT_ID,
} from "./fixture";

import {
	AGENT_SCENARIO,
	runAgentScenario,
	verifyAgentReopen,
	type VectorTarget,
} from "@opencut/editor-contracts/vectors";

/**
 * The Node-observable half of driver 3.
 *
 * The browser driver runs this same scenario against `EditorCore.transactions`
 * — `SessionOpenCutTransactions` over a real project store — and the part of
 * that path most likely to reject the scenario is the donor projection: every
 * accepted batch is re-projected into a donor draft, encoded, and decoded again
 * on reopen. That machinery needs no React, no Electron and no browser, so it
 * is exercised here rather than discovered in a fifteen-minute browser cycle.
 *
 * It does not replace the browser evidence: a page reload, a fresh session and
 * a real durable store are what Slice §3.5 asks for, and only the Hosts have
 * those.
 */
describe("the agent scenario over the donor projection", () => {
	async function openFacade() {
		const { store } = await storeFixture(projectFixture());
		const persistence = new SessionPersistenceCoordinator(store);
		const published: OpenCutProjectDraft[] = [];
		const transactions = new SessionOpenCutTransactions({
			persistence,
			arbiter: persistence.projectMutationArbiter,
			publish: (draft) => published.push(draft),
		});
		let durableSaves = 0;
		persistence.subscribeProjectRecords((record) => {
			if (record.id === TEST_PROJECT_ID) durableSaves += 1;
		});
		await transactions.open({ projectId: TEST_PROJECT_ID, assets: [] });
		return {
			transactions,
			published,
			durableSaves: () => durableSaves,
			target: transactions as unknown as VectorTarget,
		};
	}

	test("runs the declared plan through the canonical facade", async () => {
		const facade = await openFacade();
		const ledger = await runAgentScenario({
			target: facade.target,
			driver: "node/session-transactions",
			host: "node",
			buildMarker: "projection-preflight",
			durableSaves: facade.durableSaves,
		});
		expect(ledger.steps.flatMap((step) => step.failures)).toEqual([]);
		expect(ledger.failureCodes).toEqual([]);
		expect(ledger.verdict).toBe("passed");
		expect(ledger.executedSteps).toEqual(
			AGENT_SCENARIO.steps.map((step) => step.id),
		);
		for (const step of ledger.steps) {
			const declared = AGENT_SCENARIO.steps.find(
				(entry) => entry.id === step.id,
			);
			expect(step.assertionCount).toBeGreaterThan(0);
			expect(step.durableSaves).toBe(
				declared?.expect.outcome === "accepted" ? 1 : 0,
			);
		}
		// The donor draft is republished once per durable commit, which is what
		// keeps the Host's own view in step with the engine.
		expect(facade.published.length).toBe(
			AGENT_SCENARIO.steps.filter((step) => step.expect.outcome === "accepted")
				.length,
		);
	});

	test("reopening the project from the store observes the committed revision", async () => {
		const facade = await openFacade();
		const ledger = await runAgentScenario({
			target: facade.target,
			driver: "node/session-transactions",
			host: "node",
			buildMarker: "projection-preflight",
			durableSaves: facade.durableSaves,
		});
		const commitment = ledger.commitment;
		expect(commitment).not.toBeNull();
		if (!commitment) return;

		// Retire and reopen: the router loads the record from the store again and
		// decodes it, so this is a real round trip through the donor encoding.
		await facade.transactions.retire();
		await facade.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: [],
		});
		const reopened = await verifyAgentReopen({
			target: facade.target,
			commitment,
		});
		expect(reopened.failures).toEqual([]);
		expect(reopened.verdict).toBe("passed");
		expect(reopened.observedRevision).toBe(commitment.revision);
		expect(reopened.assertionCount).toBeGreaterThan(10);

		const stale = await verifyAgentReopen({
			target: facade.target,
			commitment: { ...commitment, revision: commitment.revision - 1 },
		});
		expect(stale.verdict).toBe("failed");
		expect(stale.failures.join(" ")).toContain("reopened revision");
	});
});
