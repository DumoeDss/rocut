import { describe, expect, test } from "bun:test";
import {
	AGENT_SCENARIO,
	runAgentScenario,
	verifyAgentReopen,
} from "@opencut/editor-contracts/vectors";
import type { AgentLedger } from "@opencut/editor-contracts/vectors";
import { revisionOf } from "@opencut/editor-contracts";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { openEditorPlaneAutomation } from "../editor-plane";
import { FileProjectStore } from "../file-store";
import { HttpVectorTarget } from "../host-vector-driver";

const DECLARED = AGENT_SCENARIO.steps.map((step) => step.id);

/**
 * The host-http driver must hold the SAME pinned numbers the Node drivers
 * hold (the "Hosts assert exactly what the Node drivers assert" gate): every
 * step asserts, applies once, and moves the revision/watch exactly as
 * declared.
 */
function assertLedgerIsSound(ledger: AgentLedger): void {
	expect(ledger.steps.flatMap((step) => step.failures)).toEqual([]);
	expect(ledger.failureCodes).toEqual([]);
	expect(ledger.verdict).toBe("passed");
	expect(ledger.executedSteps).toEqual(DECLARED);
	expect(ledger.declaredSteps).toEqual(DECLARED);
	for (const step of ledger.steps) {
		expect(step.assertionCount, `${step.id} asserted nothing`).toBeGreaterThan(
			0,
		);
		expect(step.applyCount).toBe(1);
		const declared = AGENT_SCENARIO.steps.find((entry) => entry.id === step.id);
		expect(step.revisionDelta).toBe(declared?.expect.revisionDelta ?? -1);
		expect(step.watcherCount).toBe(declared?.expect.watchDelta ?? -1);
	}
}

describe("host-http-start conformance driver (S06 C4)", () => {
	test("the frozen agent scenario passes against a live host", async () => {
		const target = await HttpVectorTarget.open();
		try {
			const ledger = await runAgentScenario({
				target,
				driver: "host-http-start",
				host: `bun test ${process.version}`,
				buildMarker: "local",
			});
			assertLedgerIsSound(ledger);
			expect(ledger.totalAssertions).toBeGreaterThan(0);
		} finally {
			await target.closeKeepingProject();
		}
	}, 120_000);

	test("reopen over the file SSOT verifies the commitment through the full HTTP stack", async () => {
		const target = await HttpVectorTarget.open();
		const projectIdValue = (await target.project())?.id;
		expect(projectIdValue).toBeDefined();
		const commitment = await (async () => {
			const ledger = await runAgentScenario({
				target,
				driver: "host-http-start",
				host: `bun test ${process.version}`,
				buildMarker: "local",
			});
			expect(ledger.verdict).toBe("passed");
			return ledger.commitment;
		})();
		expect(commitment).not.toBeNull();
		const projectRoot = await target.closeKeepingProject(); // host "dies"

		const automation = (
			await openEditorPlaneAutomation({
				baseStore: new FileProjectStore({
					root: projectRoot,
					schemaVersion: CURRENT_PROJECT_VERSION,
				}),
				projectId: projectIdValue as never,
			})
		).automation;
		const reopen = await verifyAgentReopen({ target: automation, commitment });
		expect(reopen.failures).toEqual([]);
		expect(reopen.assertionCount).toBeGreaterThan(0);
		expect(await automation.revision()).toBe(revisionOf(commitment.revision));
	}, 120_000);
});
