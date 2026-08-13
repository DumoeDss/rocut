/* eslint-disable opencut/prefer-object-params -- The expected-set predicate takes a vector plus one option object. */
import { describe, expect, test } from "bun:test";

import { runTransactionVectors } from "../runner";
import type { VectorTargetFactory } from "../runner";
import type {
	DocumentVector,
	ScenarioVector,
	VectorExpectation,
} from "../schema";
import {
	conformingVariantTarget,
	idempotencyIgnoringTarget,
	nonAtomicBatchTarget,
	placementWaivingTarget,
	staleRevisionTarget,
	unclonedReadTarget,
	watcherOnRejectionTarget,
} from "./mutation-targets";
import { loadPublishedCorpus, readContractSurface } from "./corpus-fixture";

const corpus = loadPublishedCorpus();
const contract = readContractSurface();

type AnyVector = DocumentVector | ScenarioVector;

function allVectors(): readonly AnyVector[] {
	return [...corpus.documentVectors, ...corpus.scenarioVectors];
}

function expectationsOf(vector: AnyVector): readonly VectorExpectation[] {
	return "steps" in vector
		? vector.steps.map((step) => step.expect)
		: [vector.expect];
}

function batchesOf(vector: AnyVector) {
	return "steps" in vector
		? vector.steps.map((step) => step.batch)
		: [vector.batch];
}

/**
 * The expected failing set for each wrapper is derived from a property of the
 * corpus, never typed out. A vector added later that exercises the same promise
 * therefore joins the set automatically instead of silently weakening it.
 */
function idsWhere(
	predicate: (vector: AnyVector) => boolean,
	options: { readonly requiring?: boolean } = {},
): string[] {
	return allVectors()
		.filter((vector) =>
			options.requiring === false ? (vector.requires ?? []).length === 0 : true,
		)
		.filter(predicate)
		.map((vector) => vector.id)
		.sort();
}

async function failingIds(open: VectorTargetFactory): Promise<string[]> {
	const report = await runTransactionVectors({ corpus, contract, open });
	expect(report.verdict).toBe("failed");
	for (const result of report.results) {
		if (result.status !== "failed") continue;
		expect(
			result.failures.length,
			`${result.id} failed without a detail string`,
		).toBeGreaterThan(0);
	}
	return report.results
		.filter((result) => result.status === "failed")
		.map((result) => result.id)
		.sort();
}

describe("mutation matrix", () => {
	test("a stale revision fails exactly the vectors with an accepted step", async () => {
		const expected = idsWhere(
			(vector) =>
				expectationsOf(vector).some(
					(expect_) => expect_.outcome === "accepted",
				),
			{ requiring: false },
		);
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(staleRevisionTarget())).toEqual(expected);
	});

	test("a non-atomic batch fails exactly the multi-operation vectors", async () => {
		const expected = idsWhere(
			(vector) => batchesOf(vector).some((batch) => batch.operations.length > 1),
			{ requiring: false },
		);
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(nonAtomicBatchTarget())).toEqual(expected);
	});

	test("ignoring the idempotency key fails exactly the keyed replay/reuse vectors", async () => {
		const expected = idsWhere(
			(vector) =>
				expectationsOf(vector).some(
					(expect_) =>
						expect_.outcome === "replayed" || expect_.errorCode === "duplicate",
				),
			{ requiring: false },
		);
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(idempotencyIgnoringTarget())).toEqual(expected);
	});

	test("notifying on rejection fails exactly the vectors asserting a silent rejection", async () => {
		const expected = idsWhere(
			(vector) =>
				expectationsOf(vector).some(
					(expect_) =>
						expect_.outcome === "rejected" && expect_.watchDelta === 0,
				),
			{ requiring: false },
		);
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(watcherOnRejectionTarget())).toEqual(expected);
	});

	test("an uncloned read fails exactly the vectors that probe cloning", async () => {
		const expected = idsWhere(
			(vector) =>
				expectationsOf(vector).some(
					(expect_) => (expect_.clones ?? []).length > 0,
				),
			{ requiring: false },
		);
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(unclonedReadTarget())).toEqual(expected);
	});

	test("waiving placement fails exactly the vectors asserting a placement issue", async () => {
		const placement = new Set([
			"collision",
			"lane-incompatible",
			"non-positive-duration",
			"timebase-misaligned",
			"source-out-of-bounds",
		]);
		const expected = idsWhere((vector) =>
			expectationsOf(vector).some((expect_) =>
				(expect_.issueCodes ?? []).some((code) => placement.has(code)),
			),
		);
		// Non-empty, not a pinned count: a later placement vector must join this
		// set automatically, the same as the five wrappers above. Pinning it would
		// make a new vector fail the control instead of widening it.
		expect(expected.length).toBeGreaterThan(0);
		expect(await failingIds(placementWaivingTarget())).toEqual(expected);
	});
});

describe("specificity", () => {
	test("a conforming implementation of a different shape passes every vector", async () => {
		const report = await runTransactionVectors({
			corpus,
			contract,
			open: conformingVariantTarget(),
		});
		expect(report.results.flatMap((result) => result.failures)).toEqual([]);
		expect(report.verdict).toBe("passed");
		expect(report.executedVectorCount).toBeGreaterThan(0);
		expect(report.totalComparisons).toBeGreaterThan(0);
	});
});
