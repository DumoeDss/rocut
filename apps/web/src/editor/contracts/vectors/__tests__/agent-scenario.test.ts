import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	AGENT_SCENARIO,
	AGENT_SCENARIO_ID,
	agentLedgerFailureCodes,
	agentScenarioCreatedIds,
} from "../agent-scenario";
import type { AgentLedgerStep } from "../agent-scenario";
import { OPERATION_KINDS } from "../..";
import { loadPublishedCorpus } from "./corpus-fixture";

const corpus = loadPublishedCorpus();
const published = corpus.scenarioVectors.find(
	(vector) => vector.id === AGENT_SCENARIO_ID,
);
const SCENARIO_MODULE = join(
	dirname(fileURLToPath(import.meta.url)),
	"../agent-scenario.ts",
);

function ledgerStep(overrides: Partial<AgentLedgerStep>): AgentLedgerStep {
	return {
		id: "step",
		intent: "intent",
		baseRevision: 0,
		resultRevision: 1,
		revisionDelta: 1,
		applyCount: 1,
		durableSaves: 1,
		watcherCount: 1,
		assertionCount: 4,
		verdict: "passed",
		failures: [],
		...overrides,
	};
}

describe("the Host-neutral agent scenario", () => {
	test("the module mirrors the published corpus vector exactly", () => {
		expect(published).toBeDefined();
		expect(AGENT_SCENARIO.steps.length).toBeGreaterThan(0);
		expect(JSON.parse(JSON.stringify(AGENT_SCENARIO.steps))).toEqual(
			JSON.parse(JSON.stringify(published?.steps)),
		);
		expect(AGENT_SCENARIO.title).toBe(published?.title ?? "");
	});

	test("it performs every element the canonical requirement names", () => {
		const kinds = new Set(
			AGENT_SCENARIO.steps.flatMap((step) =>
				step.batch.operations.map((operation) => operation.kind),
			),
		);
		for (const kind of [
			"create-track",
			"create-asset",
			"create-clip",
			"update-clip",
			"update-project",
			"create-marker",
		]) {
			expect([...kinds], `the agent scenario must exercise ${kind}`).toContain(
				kind,
			);
		}
		const exported: readonly string[] = OPERATION_KINDS;
		for (const kind of kinds) expect(exported).toContain(kind);

		const intents = AGENT_SCENARIO.steps.map((step) => step.id);
		expect(intents).toContain("move-clip");
		expect(intents).toContain("trim-clip");
		expect(intents).toContain("split-clip");
		expect(
			AGENT_SCENARIO.steps.some((step) => step.expect.outcome === "replayed"),
		).toBe(true);
		expect(
			AGENT_SCENARIO.steps.some(
				(step) => step.expect.errorCode === "duplicate",
			),
		).toBe(true);
		expect(
			AGENT_SCENARIO.steps.some((step) => step.expect.errorCode === "conflict"),
		).toBe(true);
		expect(agentScenarioCreatedIds().length).toBeGreaterThan(4);
	});

	test("every declared step asserts something", () => {
		for (const step of AGENT_SCENARIO.steps) {
			const declared =
				3 +
				(step.expect.errorCode ? 1 : 0) +
				(step.expect.createdIds ? 1 : 0) +
				(step.expect.changedIds ? 1 : 0) +
				(step.expect.reads?.length ?? 0);
			expect(declared, `${step.id} asserts nothing`).toBeGreaterThan(3);
		}
	});

	test("the scenario module imports only the frozen public surface", () => {
		const source = readFileSync(SCENARIO_MODULE, "utf8");
		const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(specifiers.length).toBeGreaterThan(0);
		for (const specifier of specifiers) {
			expect(
				["./schema", "./runner"],
				`the agent scenario must not import ${specifier}`,
			).toContain(specifier);
		}
		// A donor module, a command class, a store or a direct persistence call
		// would each be one of these words. Comments are stripped first: a comment
		// that names a rule is not a violation of it, and a check that cannot tell
		// the difference would be unusable.
		const code = source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, "");
		expect(code.length).toBeGreaterThan(0);
		expect(code).toContain("executeVectorStep");
		for (const forbidden of [
			"@/commands",
			"@/project",
			"@/timeline",
			"@/stores",
			"@/media",
			"@/services/storage",
			"saveProject",
			"persistence",
			"Command",
		]) {
			expect(code.includes(forbidden), `${forbidden} appears`).toBe(false);
		}
	});
});

describe("ledger accounting controls", () => {
	test("a step that asserted nothing fails the run", () => {
		const codes = agentLedgerFailureCodes({
			declaredSteps: ["step"],
			steps: [ledgerStep({ assertionCount: 0 })],
		});
		expect(codes).toContain("zero-assertion-step");
	});

	test("an executed plan that differs from the declared plan fails the run", () => {
		const codes = agentLedgerFailureCodes({
			declaredSteps: ["step", "second"],
			steps: [ledgerStep({})],
		});
		expect(codes).toContain("step-plan-drift");
	});

	test("a run with no step at all fails", () => {
		const codes = agentLedgerFailureCodes({ declaredSteps: [], steps: [] });
		expect(codes).toContain("empty-run");
	});

	test("a failed step fails the run", () => {
		const codes = agentLedgerFailureCodes({
			declaredSteps: ["step"],
			steps: [ledgerStep({ verdict: "failed", failures: ["boom"] })],
		});
		expect(codes).toContain("step-failed");
	});

	test("a well-formed run reports no failure code", () => {
		expect(
			agentLedgerFailureCodes({
				declaredSteps: ["step"],
				steps: [ledgerStep({})],
			}),
		).toEqual([]);
	});
});
