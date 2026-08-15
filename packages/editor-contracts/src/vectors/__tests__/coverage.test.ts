import { describe, expect, test } from "bun:test";

import { OPERATION_KINDS } from "../..";
import { parseContractSurface } from "../contract-surface";
import { computeVectorCoverage, formatCoverageFailures } from "../coverage";
import {
	loadPublishedCorpus,
	readContractSources,
	readContractSurface,
} from "./corpus-fixture";

const corpus = loadPublishedCorpus();
const contract = readContractSurface();

describe("coverage of the frozen contract", () => {
	test("every exported member is covered, and the covering vectors are named", () => {
		const report = computeVectorCoverage({ corpus, contract });
		expect(formatCoverageFailures(report)).toEqual([]);
		expect(report.complete).toBe(true);
		for (const dimension of report.dimensions) {
			expect(dimension.members.length).toBeGreaterThan(0);
			for (const member of dimension.members) {
				expect(
					member.coveredBy.length,
					`${dimension.name}:${member.member} has no covering vector`,
				).toBeGreaterThan(0);
			}
		}
	});

	test("the corpus advertises all twelve operation kinds by measurement", () => {
		const report = computeVectorCoverage({ corpus, contract });
		const kinds = report.dimensions.find(
			(dimension) => dimension.name === "operationKind",
		);
		expect(kinds?.members.length).toBe(OPERATION_KINDS.length);
		expect(OPERATION_KINDS.length).toBe(12);
		expect(kinds?.uncovered).toEqual([]);
		expect(
			kinds?.members.find((member) => member.member === "update-project")
				?.coveredBy,
		).toContain("scenario/agent-transaction-walk");
	});

	test("removing every vector for one kind fails the gate, naming that kind", () => {
		const stripped = {
			...corpus,
			documentVectors: corpus.documentVectors.filter(
				(vector) =>
					!vector.batch.operations.some(
						(operation) => operation.kind === "delete-marker",
					),
			),
			scenarioVectors: corpus.scenarioVectors.filter(
				(vector) =>
					!vector.steps.some((step) =>
						step.batch.operations.some(
							(operation) => operation.kind === "delete-marker",
						),
					),
			),
		};
		expect(stripped.documentVectors.length).toBeLessThan(
			corpus.documentVectors.length,
		);
		const report = computeVectorCoverage({ corpus: stripped, contract });
		expect(report.complete).toBe(false);
		expect(report.uncovered).toEqual(["operationKind:delete-marker"]);
	});

	test("the gate reads the contract: a synthetic exported member fails it", () => {
		const sources = readContractSources();
		const withSynthetic = parseContractSurface({
			...sources,
			transaction: sources.transaction.replace(
				'| "unsupported";',
				'| "unsupported"\n\t| "synthetic-code";',
			),
			engineTypes: sources.engineTypes.replace(
				'| "source-out-of-bounds";',
				'| "source-out-of-bounds"\n\t| "synthetic-issue";',
			),
		});
		const report = computeVectorCoverage({ corpus, contract: withSynthetic });
		expect(report.complete).toBe(false);
		expect(report.uncovered).toEqual([
			"errorCode:synthetic-code",
			"issueCode:synthetic-issue",
		]);
	});

	test("a redundant extra vector does not fail the gate", () => {
		const redundant = {
			...corpus,
			documentVectors: [
				...corpus.documentVectors,
				{
					...corpus.documentVectors[0],
					id: `${corpus.documentVectors[0].id}#redundant`,
				},
			],
		};
		const report = computeVectorCoverage({ corpus: redundant, contract });
		expect(report.complete).toBe(true);
		const kinds = report.dimensions.find(
			(dimension) => dimension.name === "operationKind",
		);
		expect(
			kinds?.members.find((member) => member.member === "create-track")
				?.coveredBy.length,
		).toBeGreaterThan(1);
	});

	test("a member the corpus claims but the contract does not export is reported", () => {
		const narrowed = {
			...contract,
			errorCodes: contract.errorCodes.filter((code) => code !== "duplicate"),
		};
		const report = computeVectorCoverage({ corpus, contract: narrowed });
		expect(report.complete).toBe(false);
		expect(report.unknown).toContain("errorCode:duplicate");
	});
});
