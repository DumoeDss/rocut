import assert from "node:assert/strict";

const REQUIRED_SECTIONS = [
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
];

export function validateInstalledWorkflow({
	linked,
	legacy,
	initialInventory,
	finalInventory,
}) {
	assert.equal(linked.kind, "real-elftia");
	assert.equal(linked.acceptanceEligible, true);
	assert.equal(linked.passed, true);
	assert.deepEqual(linked.errors, []);
	assert.equal(legacy.kind, "real-elftia-historical-plugin");
	assert.equal(legacy.passed, true);
	assert.equal(legacy.replacementAttempted, true);
	assert.equal(legacy.restored, true);
	assert.deepEqual(legacy.errors, []);
	assert.equal(legacy.legacyVersion, "0.4.0");
	assert.match(legacy.legacySourceCommit, /^[a-f0-9]{40}$/);
	assert.equal(legacy.currentInventory, initialInventory);
	assert.equal(finalInventory, initialInventory);
	assert.match(initialInventory, /^[a-f0-9]{64}$/);
	assert.match(legacy.originalProjectHash, /^[a-f0-9]{64}$/);
	assert.deepEqual(linked.linkedWorkflow.pendingSections, [
		"12-actual-legacy-plugin",
	]);
	for (const section of REQUIRED_SECTIONS)
		assert(
			linked.linkedWorkflow.completedSections.includes(section),
			`missing section ${section}`,
		);
	assert(linked.checks.length >= 35 && legacy.checks.length >= 5);
	const checks = [...linked.checks, ...legacy.checks];
	assert(checks.every((check) => check.pass === true));
	return {
		checks,
		coveredWorkflow: {
			completedSections: [
				...linked.linkedWorkflow.completedSections,
				"12-actual-legacy-plugin",
			],
			pendingSections: [],
		},
		// Deliberately not a complete editor/plan acceptance gate.
		remainingScope: [
			"F04 300ms performance",
			"fresh SDK consumer",
			"broader resource release",
			"external Sounds configuration",
			"full plan completion audit",
		],
	};
}
