/**
 * Coverage derived from the contract, not from the corpus (design D3).
 *
 * The gate intersects what the corpus *does* — the operation kinds its batches
 * carry, the error codes its rejections name, the engine issue codes its
 * validation expectations require — with what the contract *exports*. A member
 * the contract exports with no covering vector fails the gate by name.
 *
 * Coverage is a lower bound, never an equality: a second vector covering the
 * same member is permitted, because an exact-count gate is a number a
 * contributor has to hand-maintain and will eventually maintain wrongly.
 */
import type { ContractSurface } from "./contract-surface";
import type {
	DocumentVector,
	ScenarioVector,
	TransactionVectorCorpus,
	VectorBatch,
	VectorExpectation,
} from "./schema";

export interface CoverageMember {
	readonly member: string;
	readonly coveredBy: readonly string[];
}

export interface CoverageDimension {
	readonly name: "operationKind" | "errorCode" | "issueCode";
	readonly members: readonly CoverageMember[];
	readonly uncovered: readonly string[];
}

export interface VectorCoverageReport {
	readonly complete: boolean;
	readonly dimensions: readonly CoverageDimension[];
	/** `dimension:member` for every contract member with no vector. */
	readonly uncovered: readonly string[];
	/** Members a vector claims that the contract does not export. */
	readonly unknown: readonly string[];
}

function addAll(args: {
	readonly index: Map<string, Set<string>>;
	readonly members: Iterable<string>;
	readonly vectorId: string;
}): void {
	for (const member of args.members) {
		const existing = args.index.get(member);
		if (existing) existing.add(args.vectorId);
		else args.index.set(member, new Set([args.vectorId]));
	}
}

function batchKinds(batch: VectorBatch): string[] {
	return batch.operations.map((operation) => operation.kind);
}

function expectationCodes(expect: VectorExpectation): {
	readonly errorCodes: string[];
	readonly issueCodes: string[];
} {
	return {
		errorCodes: expect.errorCode === undefined ? [] : [expect.errorCode],
		issueCodes: [...(expect.issueCodes ?? [])],
	};
}

function dimension(args: {
	readonly name: CoverageDimension["name"];
	readonly exported: readonly string[];
	readonly index: Map<string, Set<string>>;
}): CoverageDimension {
	const members = args.exported.map((member) => ({
		member,
		coveredBy: [...(args.index.get(member) ?? [])].sort(),
	}));
	return {
		name: args.name,
		members,
		uncovered: members
			.filter((entry) => entry.coveredBy.length === 0)
			.map((entry) => entry.member),
	};
}

/**
 * Compute coverage of `contract` by `corpus`.
 *
 * The corpus is read for what it exercises; the contract is read for what must
 * be exercised. Neither side restates the other.
 */
export function computeVectorCoverage(args: {
	readonly corpus: TransactionVectorCorpus;
	readonly contract: ContractSurface;
}): VectorCoverageReport {
	const kinds = new Map<string, Set<string>>();
	const errorCodes = new Map<string, Set<string>>();
	const issueCodes = new Map<string, Set<string>>();

	const collect = (args: {
		readonly vectorId: string;
		readonly batch: VectorBatch;
		readonly expect: VectorExpectation;
	}) => {
		const { vectorId } = args;
		addAll({ index: kinds, members: batchKinds(args.batch), vectorId });
		const codes = expectationCodes(args.expect);
		addAll({ index: errorCodes, members: codes.errorCodes, vectorId });
		addAll({ index: issueCodes, members: codes.issueCodes, vectorId });
	};

	for (const vector of args.corpus.documentVectors as readonly DocumentVector[]) {
		collect({
			vectorId: vector.id,
			batch: vector.batch,
			expect: vector.expect,
		});
	}
	for (const vector of args.corpus.scenarioVectors as readonly ScenarioVector[]) {
		for (const step of vector.steps) {
			collect({ vectorId: vector.id, batch: step.batch, expect: step.expect });
		}
	}

	const dimensions = [
		dimension({
			name: "operationKind",
			exported: args.contract.operationKinds,
			index: kinds,
		}),
		dimension({
			name: "errorCode",
			exported: args.contract.errorCodes,
			index: errorCodes,
		}),
		dimension({
			name: "issueCode",
			exported: args.contract.issueCodes,
			index: issueCodes,
		}),
	];

	const unknown = [
		...[...kinds.keys()]
			.filter((member) => !args.contract.operationKinds.includes(member))
			.map((member) => `operationKind:${member}`),
		...[...errorCodes.keys()]
			.filter((member) => !args.contract.errorCodes.includes(member))
			.map((member) => `errorCode:${member}`),
		...[...issueCodes.keys()]
			.filter((member) => !args.contract.issueCodes.includes(member))
			.map((member) => `issueCode:${member}`),
	].sort();

	const uncovered = dimensions
		.flatMap((entry) =>
			entry.uncovered.map((member) => `${entry.name}:${member}`),
		)
		.sort();

	return {
		complete: uncovered.length === 0 && unknown.length === 0,
		dimensions,
		uncovered,
		unknown,
	};
}

/** A one-line-per-failure summary for a CLI or an evidence file. */
export function formatCoverageFailures(
	report: VectorCoverageReport,
): readonly string[] {
	return [
		...report.uncovered.map((member) => `uncovered ${member}`),
		...report.unknown.map((member) => `unknown ${member}`),
	];
}
