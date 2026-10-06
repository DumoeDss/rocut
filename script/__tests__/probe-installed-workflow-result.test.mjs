import assert from "node:assert/strict";
import { test } from "node:test";
import { validateInstalledWorkflow } from "../probe-installed-workflow-result.mjs";

function fixture() {
	return {
		initialInventory: "a".repeat(64),
		finalInventory: "a".repeat(64),
		linked: {
			kind: "real-elftia",
			acceptanceEligible: true,
			passed: true,
			errors: [],
			checks: Array.from({ length: 35 }, () => ({ pass: true })),
			linkedWorkflow: {
				completedSections: [
					1,
					2,
					3,
					4,
					5,
					6,
					7,
					8,
					9,
					11,
					"10-full",
					"10-range",
					"10-final-full",
					"12-font-retry",
					"12-unknown-preset",
				],
				pendingSections: ["12-actual-legacy-plugin"],
			},
		},
		legacy: {
			kind: "real-elftia-historical-plugin",
			passed: true,
			replacementAttempted: true,
			restored: true,
			errors: [],
			legacyVersion: "0.4.0",
			legacySourceCommit: "b".repeat(40),
			currentInventory: "a".repeat(64),
			originalProjectHash: "c".repeat(64),
			checks: Array.from({ length: 5 }, () => ({ pass: true })),
		},
	};
}

test("aggregate closes only the covered workflow, retaining full-goal gaps", () => {
	const result = validateInstalledWorkflow(fixture());
	assert.equal(result.checks.length, 40);
	assert.deepEqual(result.coveredWorkflow.pendingSections, []);
	assert(result.remainingScope.includes("F04 300ms performance"));
});

test("aggregate rejects diagnostic, failed and incomplete child runs", () => {
	for (const mutate of [
		(f) => {
			f.linked.acceptanceEligible = false;
		},
		(f) => {
			f.linked.passed = false;
		},
		(f) => {
			f.legacy.passed = false;
		},
		(f) => {
			f.linked.linkedWorkflow.completedSections.pop();
		},
		(f) => {
			f.linked.linkedWorkflow.pendingSections.push("other gap");
		},
		(f) => {
			f.legacy.checks[0].pass = false;
		},
		(f) => {
			f.legacy.checks.pop();
		},
		(f) => {
			f.linked.errors.push("uncaught");
		},
		(f) => {
			f.legacy.errors.push("restore error");
		},
	]) {
		const value = fixture();
		mutate(value);
		assert.throws(() => validateInstalledWorkflow(value));
	}
});

test("aggregate refuses missing historical identity and incomplete restoration", () => {
	for (const mutate of [
		(f) => {
			f.legacy.replacementAttempted = false;
		},
		(f) => {
			f.legacy.restored = false;
		},
		(f) => {
			f.finalInventory = "d".repeat(64);
		},
		(f) => {
			f.legacy.currentInventory = "d".repeat(64);
		},
		(f) => {
			f.legacy.legacySourceCommit = "";
		},
		(f) => {
			f.legacy.legacyVersion = "0.5.0";
		},
		(f) => {
			f.legacy.originalProjectHash = "";
		},
	]) {
		const value = fixture();
		mutate(value);
		assert.throws(() => validateInstalledWorkflow(value));
	}
});
