/**
 * A deterministic requirement-first failure demonstration.
 *
 * The target delegates every operation to a real transaction store but reports
 * a frozen read revision. That single author-seam defect makes the published
 * suite produce a stable attributable set; the formatter, not a stack trace,
 * is the debugging interface.
 */
import {
	createInMemoryTransactionStore,
	revisionOf,
} from "@opencut/editor-contracts";
import { runTransactionConformance } from "@opencut/editor-contracts/conformance";
import {
	formatConformanceFailures,
	requirementOf,
} from "@opencut/editor-contracts/conformance/requirements";

const EXPECTED_FAILURES = [
	"apply creates entities and increments revision monotonically",
	"expected revision match succeeds",
	"expected revision mismatch rejects with conflict",
	"an apply without a key is never deduplicated",
	"watch fires on successful apply",
	"getContext reports the current revision",
] as const;

function fail(message: string): never {
	console.error(`failure-demo: ${message}`);
	console.log("REAL_EXIT_CODE[failure-demo]:1");
	process.exit(1);
}

const real = createInMemoryTransactionStore();
const staleRevisionTarget: typeof real = {
	...real,
	revision: async () => revisionOf(0),
};
const report = await runTransactionConformance({
	target: {
		read: staleRevisionTarget,
		apply: real,
		getContext: real,
		watch: real,
	},
	label: "adapter-author stale-revision demonstration",
});
if (report.passed) fail("the deliberately stale revision target passed");

const failures = report.results.filter((result) => result.status === "failed");
if (
	JSON.stringify(failures.map((result) => result.name)) !==
	JSON.stringify(EXPECTED_FAILURES)
) {
	fail(
		`failure population drifted: ${failures.map((result) => result.name).join(" | ")}`,
	);
}

const rendered = formatConformanceFailures(report);
for (const failure of failures) {
	const entry = requirementOf(failure.name);
	if (entry === undefined || failure.detail === undefined) {
		fail(`missing requirement or detail for ${failure.name}`);
	}
	const requirementAt = rendered.indexOf(`[${entry.requirement}]`);
	const caseAt = rendered.indexOf(`case: ${failure.name}`, requirementAt);
	const detailAt = rendered.indexOf(`detail: ${failure.detail}`, caseAt);
	if (!(requirementAt >= 0 && caseAt > requirementAt && detailAt > caseAt)) {
		fail(`formatter order is not requirement -> case -> detail for ${failure.name}`);
	}
}
if (/\n\s*at\s|    at /.test(rendered)) {
	fail("formatter emitted an internal stack frame");
}

console.log(rendered);
console.log(
	`failure-demo: PASS (${failures.length} expected failures, each requirement -> case -> detail, no stack frames)`,
);
console.log("REAL_EXIT_CODE[failure-demo]:0");
