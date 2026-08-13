import { describe, expect, test } from "bun:test";

import {
	createInMemoryVectorTargetFactory,
	createNonSeedableVectorTargetFactory,
} from "../drivers/in-memory";
import { createDurableVectorTargetFactory } from "../drivers/durable";
import { deriveFailureCodes, runTransactionVectors } from "../runner";
import type { VectorRunReport } from "../runner";
import { loadPublishedCorpus, readContractSurface } from "./corpus-fixture";

const corpus = loadPublishedCorpus();
const contract = readContractSurface();

function failuresOf(report: VectorRunReport): string[] {
	return report.results.flatMap((result) => result.failures);
}

describe("the runner against the reference implementations", () => {
	test("green against the in-memory transaction store", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
		});
		expect(failuresOf(report)).toEqual([]);
		expect(report.verdict).toBe("passed");
		expect(report.failureCodes).toEqual([]);
		// The verdict a report carries is reproducible from the report itself, so
		// a consumer of a published run can re-judge it under the shipped rules.
		expect(deriveFailureCodes(report)).toEqual([...report.failureCodes]);
		expect(report.executedVectorCount).toBe(report.applicableVectorCount);
		expect(report.executedVectorCount).toBeGreaterThan(0);
		expect(report.totalComparisons).toBeGreaterThan(
			report.executedVectorCount * 3,
		);
		for (const result of report.results) {
			if (result.status === "skipped") continue;
			expect(result.status).toBe("passed");
			expect(result.comparisons).toBeGreaterThan(0);
		}
		expect(report.families.document).toBe("passed");
		expect(report.families.scenario).toBe("passed");
	});

	test("the fake skips exactly the vectors whose capability it does not advertise", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
		});
		const skipped = report.results
			.filter((result) => result.status === "skipped")
			.map((result) => result.id)
			.sort();
		const expected = [
			...corpus.documentVectors,
			...corpus.scenarioVectors,
		]
			.filter((vector) => (vector.requires ?? []).length > 0)
			.map((vector) => vector.id)
			.sort();
		expect(expected.length).toBeGreaterThan(0);
		expect(skipped).toEqual(expected);
		expect(report.advertisedCapabilities).not.toContain("validation");
	});

	test("green against a durable engine over an in-memory project store", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createDurableVectorTargetFactory(),
		});
		expect(failuresOf(report)).toEqual([]);
		expect(report.verdict).toBe("passed");
		expect(report.executedVectorCount).toBe(corpus.declaredVectorCount);
		expect(
			report.results.filter((result) => result.status === "skipped"),
		).toEqual([]);
		expect(report.advertisedCapabilities).toContain("validation");
		expect(report.advertisedCapabilities).toContain("placement-policy");
		for (const result of report.results) {
			expect(result.comparisons).toBeGreaterThan(0);
		}
	});
});

describe("fail-closed rules", () => {
	test("an empty corpus is refused rather than passed", async () => {
		const report = await runTransactionVectors({
			corpus: { ...corpus, documentVectors: [], scenarioVectors: [] },
			contract,
			open: createInMemoryVectorTargetFactory(),
		});
		expect(report.verdict).toBe("failed");
		expect(report.failureCodes).toContain("refused-empty-scan");
		expect(report.executedVectorCount).toBe(0);
	});

	test("a filter matching nothing is refused", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
			filter: () => false,
		});
		expect(report.verdict).toBe("failed");
		expect(report.failureCodes).toContain("refused-empty-scan");
	});

	test("a filter matching exactly one vector runs exactly that vector and may pass", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
			filter: (id) => id === "document/create-track-and-clone",
		});
		expect(report.executedVectorCount).toBe(1);
		expect(report.results.map((result) => result.id)).toEqual([
			"document/create-track-and-clone",
		]);
		expect(report.results[0].status).toBe("passed");
		expect(report.results[0].comparisons).toBeGreaterThan(0);
		expect(report.failureCodes).toEqual([]);
	});

	test("a target that cannot be seeded reports the document family unsupported", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createNonSeedableVectorTargetFactory(),
		});
		expect(report.families.document).toBe("unsupported");
		expect(report.verdict).toBe("failed");
		expect(report.failureCodes).toContain("unsupported-family");
		const documentResults = report.results.filter(
			(result) => result.family === "document",
		);
		expect(documentResults.length).toBe(corpus.documentVectors.length);
		for (const result of documentResults) {
			expect(result.status).toBe("unsupported");
			expect(result.status).not.toBe("skipped");
			expect(result.status).not.toBe("passed");
		}
		// The scenario family still runs, so this is a family verdict rather than
		// a whole-run bail-out.
		expect(report.families.scenario).toBe("passed");
	});

	test("a vector that performed no comparison cannot be reported as passed", async () => {
		const silent = {
			...corpus,
			documentVectors: [
				{
					...corpus.documentVectors[0],
					id: "control/silent",
					expect: {
						outcome: "accepted" as const,
						revisionDelta: 1,
						watchDelta: 1,
					},
				},
			],
			scenarioVectors: [],
		};
		const report = await runTransactionVectors({
			corpus: silent,
			contract,
			open: createInMemoryVectorTargetFactory(),
			filter: (id) => id === "control/silent",
		});
		// The step still compares outcome, revision and watchers, so the minimal
		// expectation the schema allows does not reach zero.
		expect(report.results[0].comparisons).toBeGreaterThan(0);
		expect(deriveFailureCodes(report)).not.toContain("zero-comparison");
		// Judged through the shipped rule, not re-stated arithmetic: delete the
		// zero-comparison line in the runner and this fails.
		const zeroed: VectorRunReport = {
			...report,
			results: [{ ...report.results[0], comparisons: 0 }],
		};
		expect(deriveFailureCodes(zeroed)).toContain("zero-comparison");
	});

	test("a scenario that compares nothing fails the run despite passing itself", async () => {
		// The loader refuses a step-less vector, so the corpus is built here. The
		// runner rule fires live: the vector is recorded `passed` with zero
		// comparisons, and the run verdict is still `failed`.
		const stepless = {
			...corpus,
			documentVectors: [],
			scenarioVectors: [
				{ id: "control/no-steps", title: "compares nothing", steps: [] },
			],
		};
		const report = await runTransactionVectors({
			corpus: stepless,
			contract,
			open: createInMemoryVectorTargetFactory(),
		});
		expect(report.results.map((result) => result.id)).toEqual([
			"control/no-steps",
		]);
		expect(report.results[0].status).toBe("passed");
		expect(report.results[0].comparisons).toBe(0);
		expect(report.executedVectorCount).toBe(1);
		expect(report.failureCodes).toContain("zero-comparison");
		expect(report.verdict).toBe("failed");
	});

	test("executed fewer vectors than applicable is drift", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
			filter: (id) => id === "document/create-track-and-clone",
		});
		expect(report.executedVectorCount).toBe(report.applicableVectorCount);
		expect(deriveFailureCodes(report)).not.toContain("count-drift");
		const drifted: VectorRunReport = {
			...report,
			executedVectorCount: report.applicableVectorCount - 1,
		};
		expect(deriveFailureCodes(drifted)).toContain("count-drift");
	});

	test("a skip against a capability the target advertises is refused", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: createInMemoryVectorTargetFactory(),
		});
		const skipped = report.results.filter(
			(result) => result.status === "skipped",
		);
		expect(skipped.length).toBeGreaterThan(0);
		for (const result of skipped) {
			expect(result.reason ?? "").toStartWith("capability:");
		}
		expect(report.advertisedCapabilities).not.toContain("validation");
		expect(deriveFailureCodes(report)).not.toContain("false-skip");
		// `runTransactionVectors` decides the skip and this check against one
		// advertised set, so it cannot contradict itself in a single run. The rule
		// guards a published report and any future runner that reads capabilities
		// per target: the same real skips, against a target that claims what they
		// name, are a failure.
		const lying: VectorRunReport = {
			...report,
			advertisedCapabilities: [
				...report.advertisedCapabilities,
				"validation",
				"placement-policy",
			],
		};
		expect(deriveFailureCodes(lying)).toContain("false-skip");
	});

	test("a coverage shortfall fails the run even when every vector passes", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract: {
				...contract,
				operationKinds: [...contract.operationKinds, "create-effect"],
			},
			open: createDurableVectorTargetFactory(),
		});
		expect(failuresOf(report)).toEqual([]);
		expect(report.verdict).toBe("failed");
		expect(report.failureCodes).toContain("coverage-incomplete");
		expect(deriveFailureCodes(report)).toEqual([...report.failureCodes]);
		expect(report.coverage.uncovered).toEqual(["operationKind:create-effect"]);
	});
});
