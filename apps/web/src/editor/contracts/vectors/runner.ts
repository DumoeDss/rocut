/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Wire-safe published data becomes branded contract values at this seam, and the comparison helpers are two-argument predicates by nature. */
/**
 * `runTransactionVectors` — the published runner (design D4).
 *
 * A plain async function: no React, no Electron, no Host port, no test
 * framework, no file-system access. The caller supplies the parsed corpus, the
 * contract surface the coverage gate measures against, and a factory that opens
 * the implementation under test.
 *
 * Every rule below is fail-closed. The report-level ones live in
 * `deriveFailureCodes`, a pure function over a finished report, so each has a
 * control in `__tests__/runner.test.ts` even where no valid corpus and no
 * conforming target can reach the state it guards:
 *
 * - an empty corpus, or a filter matching nothing, is `refused-empty-scan`;
 * - fewer executed vectors than applicable ones is `count-drift`;
 * - a vector that performed no comparison is a failure, never a pass;
 * - a target that cannot be opened over a supplied document reports the whole
 *   document family `unsupported`, and the run verdict is not `passed`;
 * - a `skipped` verdict is only admissible when the target genuinely does not
 *   advertise the capability the vector requires — a skip against an advertised
 *   capability is itself a failure.
 */
import type {
	TransactionApply,
	TransactionBatch,
	TransactionGetContext,
	TransactionOperation,
	TransactionRead,
	TransactionWatch,
} from "..";
import { revisionOf, TransactionError } from "..";
import type { TransactionValidationOutcome } from "../engine";
import type { ContractSurface } from "./contract-surface";
import type { VectorCoverageReport } from "./coverage";
import { computeVectorCoverage } from "./coverage";
import type {
	DocumentVector,
	ScenarioVector,
	TransactionVectorCorpus,
	VectorBatch,
	VectorExpectation,
	VectorFamily,
	VectorSeedDocument,
} from "./schema";
import { TRANSACTION_VECTOR_SCHEMA } from "./schema";

/** The implementation under test: the four frozen interfaces, plus optional `validate`. */
export interface VectorTarget
	extends TransactionRead,
		TransactionApply,
		TransactionGetContext,
		TransactionWatch {
	validate?(batch: TransactionBatch): Promise<TransactionValidationOutcome>;
}

export interface VectorTargetHandle {
	readonly target: VectorTarget;
	readonly close?: () => Promise<void> | void;
}

export interface VectorTargetFactory {
	readonly name: string;
	/**
	 * Open a target holding exactly the supplied document. Omitted by an
	 * implementation whose document is whatever it already holds — which is what
	 * makes the document family `unsupported` rather than silently skipped.
	 */
	readonly openSeeded?: (args: {
		readonly document: VectorSeedDocument;
		readonly vectorId: string;
	}) => Promise<VectorTargetHandle>;
	/** Open a target over its own starting document. */
	readonly openRelative: (args: {
		readonly vectorId: string;
	}) => Promise<VectorTargetHandle>;
}

export type VectorStatus = "passed" | "failed" | "skipped" | "unsupported";

export interface VectorStepResult {
	readonly id: string;
	readonly baseRevision: number;
	readonly resultRevision: number | null;
	readonly revisionDelta: number;
	readonly watchDelta: number;
	readonly comparisons: number;
	readonly failures: readonly string[];
}

export interface VectorResult {
	readonly id: string;
	readonly family: VectorFamily;
	readonly status: VectorStatus;
	readonly comparisons: number;
	readonly reason?: string;
	readonly failures: readonly string[];
	readonly steps: readonly VectorStepResult[];
}

export type FamilyVerdict = "passed" | "failed" | "unsupported" | "empty";

export interface VectorRunReport {
	readonly schema: typeof TRANSACTION_VECTOR_SCHEMA;
	readonly target: string;
	readonly verdict: "passed" | "failed";
	readonly failureCodes: readonly string[];
	readonly declaredVectorCount: number;
	readonly applicableVectorCount: number;
	readonly executedVectorCount: number;
	readonly totalComparisons: number;
	readonly advertisedCapabilities: readonly string[];
	readonly families: Readonly<Record<VectorFamily, FamilyVerdict>>;
	readonly results: readonly VectorResult[];
	readonly coverage: VectorCoverageReport;
}

/**
 * The fields the report-level rules read. `VectorRunReport` satisfies it, so a
 * finished report — including one decoded from a published artifact — can be
 * re-judged by the same rules that produced its verdict.
 */
export interface FailureCodeSubject {
	readonly results: readonly VectorResult[];
	readonly advertisedCapabilities: readonly string[];
	readonly applicableVectorCount: number;
	readonly executedVectorCount: number;
	readonly coverage: Pick<VectorCoverageReport, "complete">;
}

export interface RunTransactionVectorsArgs {
	readonly corpus: TransactionVectorCorpus;
	/**
	 * The contract's exported members. Required rather than imported, because
	 * two of the three sets are type-only unions with no runtime representation
	 * and the runner may not read the file system to recover them.
	 */
	readonly contract: ContractSurface;
	readonly open: VectorTargetFactory;
	/** Restrict the run to the vector ids this predicate accepts. */
	readonly filter?: (vectorId: string) => boolean;
}

function canonical(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
			.join(",")}}`;
	}
	if (typeof value === "number" && Object.is(value, -0)) return "-0";
	return JSON.stringify(value) ?? String(value);
}

function sameValue(left: unknown, right: unknown): boolean {
	return canonical(left) === canonical(right);
}

function sameSet(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		[...left].sort().join("|") === [...right].sort().join("|")
	);
}

/** A per-step assertion tally that cannot be inflated by an unexecuted check. */
class Comparisons {
	count = 0;
	readonly failures: string[] = [];

	check(args: { readonly passed: boolean; readonly detail: string }): void {
		this.count += 1;
		if (!args.passed) this.failures.push(args.detail);
	}
}

/**
 * The one placeholder published vectors may carry. A scenario vector runs
 * against a project it did not create — the real Host's project id is a runtime
 * identity — so `$project` stands for "whatever Project this target holds".
 */
export const PROJECT_PLACEHOLDER = "$project";

function resolvePlaceholders<Value>(value: Value, projectId: string): Value {
	if (typeof value === "string") {
		return (value === PROJECT_PLACEHOLDER ? projectId : value) as Value;
	}
	if (Array.isArray(value)) {
		return value.map((entry) =>
			resolvePlaceholders(entry, projectId),
		) as unknown as Value;
	}
	if (value !== null && typeof value === "object") {
		const source = value as Record<string, unknown>;
		const resolved: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(source)) {
			resolved[key] = resolvePlaceholders(entry, projectId);
		}
		return resolved as Value;
	}
	return value;
}

function toOperations(batch: VectorBatch): readonly TransactionOperation[] {
	const declared = batch.operations as readonly unknown[];
	const probe =
		batch.unknownKindProbe === undefined
			? []
			: [{ kind: batch.unknownKindProbe }];
	return [...declared, ...probe] as readonly TransactionOperation[];
}

function toBatch(args: {
	readonly batch: VectorBatch;
	readonly baseRevision: number;
}): TransactionBatch {
	return {
		operations: toOperations(args.batch),
		...(args.batch.expectedRevisionOffset !== undefined && {
			expectedRevision: revisionOf(
				args.baseRevision + args.batch.expectedRevisionOffset,
			),
		}),
		...(args.batch.idempotencyKey !== undefined && {
			idempotencyKey: args.batch.idempotencyKey,
		}),
	};
}

async function readEntity(args: {
	readonly target: VectorTarget;
	readonly entity: string;
	readonly id: string;
}): Promise<Record<string, unknown> | null> {
	const { target, entity, id } = args;
	const found =
		entity === "track"
			? (await target.tracks()).find((value) => String(value.id) === id)
			: entity === "clip"
				? (await target.clips()).find((value) => String(value.id) === id)
				: entity === "asset"
					? (await target.assets()).find((value) => String(value.id) === id)
					: entity === "marker"
						? (await target.markers()).find((value) => String(value.id) === id)
						: ((await target.project()) ?? undefined);
	if (!found) return null;
	if (entity === "project" && String(found.id) !== id) return null;
	return found as unknown as Record<string, unknown>;
}

async function assertReads(args: {
	readonly target: VectorTarget;
	readonly expect: VectorExpectation;
	readonly comparisons: Comparisons;
	readonly stepId: string;
}): Promise<void> {
	for (const read of args.expect.reads ?? []) {
		const found = await readEntity({
			target: args.target,
			entity: read.entity,
			id: read.id,
		});
		if (read.absent === true) {
			args.comparisons.check({
				passed: found === null,
				detail: `${args.stepId}: ${read.entity} ${read.id} must be absent`,
			});
			continue;
		}
		if (!found) {
			args.comparisons.check({
				passed: false,
				detail: `${args.stepId}: ${read.entity} ${read.id} is missing`,
			});
			continue;
		}
		for (const [field, expected] of Object.entries(read.fields ?? {})) {
			args.comparisons.check({
				passed: sameValue(found[field], expected),
				detail:
					`${args.stepId}: ${read.entity} ${read.id}.${field} is ` +
					`${canonical(found[field])}, expected ${canonical(expected)}`,
			});
		}
	}
}

async function assertClones(args: {
	readonly target: VectorTarget;
	readonly expect: VectorExpectation;
	readonly comparisons: Comparisons;
	readonly stepId: string;
}): Promise<void> {
	for (const probe of args.expect.clones ?? []) {
		const first = await readEntity({
			target: args.target,
			entity: probe.entity,
			id: probe.id,
		});
		if (!first) {
			args.comparisons.check({
				passed: false,
				detail: `${args.stepId}: clone probe target ${probe.id} is missing`,
			});
			continue;
		}
		const before = canonical(first[probe.field]);
		try {
			first[probe.field] = probe.mutateTo;
		} catch {
			// A frozen read is at least as defensive as a cloned one.
		}
		const second = await readEntity({
			target: args.target,
			entity: probe.entity,
			id: probe.id,
		});
		args.comparisons.check({
			passed: second !== null && canonical(second[probe.field]) === before,
			detail:
				`${args.stepId}: mutating the returned ${probe.entity} ${probe.id}.${probe.field} ` +
				`changed the next read (${canonical(second?.[probe.field])} vs ${before})`,
		});
	}
}

/**
 * Execute one step against one target and report exactly the comparisons it
 * performed. Exported because the agent scenario runs the same step semantics
 * and adds its own ledger accounting on top — two implementations of "what a
 * step means" would be two places to drift.
 */
export async function executeVectorStep(args: {
	readonly target: VectorTarget;
	readonly stepId: string;
	readonly batch: VectorBatch;
	readonly expect: VectorExpectation;
}): Promise<VectorStepResult> {
	const { target } = args;
	const comparisons = new Comparisons();
	const project = await target.project();
	const projectId = project === null ? PROJECT_PLACEHOLDER : String(project.id);
	const expect = resolvePlaceholders(args.expect, projectId);
	const resolvedBatch = resolvePlaceholders(args.batch, projectId);
	const baseRevision = Number(await target.revision());
	let watchDelta = 0;
	const unwatch = target.watch(() => {
		watchDelta += 1;
	});
	let resultRevision: number | null = null;

	try {
		const batch = toBatch({ batch: resolvedBatch, baseRevision });

		if (expect.issueCodes !== undefined || expect.valid !== undefined) {
			if (typeof target.validate !== "function") {
				comparisons.check({
					passed: false,
					detail: `${args.stepId}: the target advertises validation but exposes no validate()`,
				});
			} else {
				const outcome = await target.validate(batch);
				if (expect.valid !== undefined) {
					comparisons.check({
						passed: outcome.valid === expect.valid,
						detail: `${args.stepId}: validate reported valid=${outcome.valid}, expected ${expect.valid}`,
					});
				}
				const reported = outcome.issues.map((issue) => String(issue.code));
				for (const code of expect.issueCodes ?? []) {
					comparisons.check({
						passed: reported.includes(code),
						detail:
							`${args.stepId}: validate did not report issue ${code} ` +
							`(reported ${reported.join(", ") || "nothing"})`,
					});
				}
			}
		}

		try {
			const result = await target.apply(batch);
			resultRevision = Number(result.revision);
			comparisons.check({
				passed: expect.outcome !== "rejected",
				detail: `${args.stepId}: apply was accepted, expected rejection with ${expect.errorCode}`,
			});
			if (expect.createdIds !== undefined) {
				comparisons.check({
					passed: sameSet(
						result.createdIds.map(String),
						expect.createdIds.map(String),
					),
					detail:
						`${args.stepId}: createdIds ${canonical([...result.createdIds].sort())} ` +
						`!= ${canonical([...expect.createdIds].sort())}`,
				});
			}
			if (expect.changedIds !== undefined) {
				comparisons.check({
					passed: sameSet(
						result.changedIds.map(String),
						expect.changedIds.map(String),
					),
					detail:
						`${args.stepId}: changedIds ${canonical([...result.changedIds].sort())} ` +
						`!= ${canonical([...expect.changedIds].sort())}`,
				});
			}
		} catch (error) {
			if (!(error instanceof TransactionError)) throw error;
			comparisons.check({
				passed: expect.outcome === "rejected",
				detail: `${args.stepId}: apply was rejected (${error.code}: ${error.message})`,
			});
			if (expect.errorCode !== undefined) {
				comparisons.check({
					passed: error.code === expect.errorCode,
					detail: `${args.stepId}: rejection code ${error.code}, expected ${expect.errorCode}`,
				});
			}
			if (error.code === "conflict") {
				comparisons.check({
					passed:
						error.expectedRevision !== undefined &&
						error.actualRevision !== undefined,
					detail: `${args.stepId}: a conflict must carry its expected and actual revisions`,
				});
			}
		}

		const observed = Number(await target.revision());
		comparisons.check({
			passed: observed - baseRevision === expect.revisionDelta,
			detail:
				`${args.stepId}: revision moved ${observed - baseRevision}, ` +
				`expected ${expect.revisionDelta}`,
		});
		if (resultRevision !== null) {
			comparisons.check({
				passed: resultRevision === observed,
				detail:
					`${args.stepId}: apply returned revision ${resultRevision} but the target ` +
					`reports ${observed}`,
			});
		}
		comparisons.check({
			passed: watchDelta === expect.watchDelta,
			detail: `${args.stepId}: ${watchDelta} watcher notification(s), expected ${expect.watchDelta}`,
		});

		await assertReads({
			target,
			expect,
			comparisons,
			stepId: args.stepId,
		});
		await assertClones({
			target,
			expect,
			comparisons,
			stepId: args.stepId,
		});

		return {
			id: args.stepId,
			baseRevision,
			resultRevision,
			revisionDelta: observed - baseRevision,
			watchDelta,
			comparisons: comparisons.count,
			failures: comparisons.failures,
		};
	} finally {
		unwatch();
	}
}

function requirementsOf(
	vector: DocumentVector | ScenarioVector,
): readonly string[] {
	return vector.requires ?? [];
}

function missingRequirement(args: {
	readonly vector: DocumentVector | ScenarioVector;
	readonly advertised: ReadonlySet<string>;
}): string | null {
	for (const requirement of requirementsOf(args.vector)) {
		if (!args.advertised.has(requirement)) return requirement;
	}
	return null;
}

async function seedDocumentTarget(args: {
	readonly open: VectorTargetFactory;
	readonly vector: DocumentVector;
}): Promise<VectorTargetHandle> {
	const openSeeded = args.open.openSeeded;
	if (!openSeeded) throw new Error("This target cannot be seeded");
	return openSeeded({
		document: args.vector.initialDocument,
		vectorId: args.vector.id,
	});
}

async function closeHandle(handle: VectorTargetHandle | null): Promise<void> {
	if (handle?.close) await handle.close();
}

/**
 * Every report-level rule, as one pure function over a finished report.
 *
 * Extracted so each rule can be asserted directly. Three of them —
 * `false-skip`, `count-drift` and `zero-comparison` — guard states no valid
 * corpus and no conforming target can reach, so a control that only calls
 * `runTransactionVectors` cannot observe them, and the arithmetic controls that
 * stood in for two of them would have passed with the rules deleted. Judging a
 * constructed report through the shipped rule fixes that: delete a line below
 * and a control in `__tests__/runner.test.ts` fails.
 */
export function deriveFailureCodes(
	report: FailureCodeSubject,
): readonly string[] {
	const codes = new Set<string>();
	const advertised = new Set(report.advertisedCapabilities);
	for (const result of report.results) {
		if (result.status === "failed") codes.add("vector-failed");
		// A pass that compared nothing is a failure, never a pass.
		if (result.status === "passed" && result.comparisons === 0) {
			codes.add("zero-comparison");
		}
		// A skip is only admissible against a capability the target does not have.
		if (result.status === "skipped") {
			const capability = (result.reason ?? "").replace(/^capability:/, "");
			if (advertised.has(capability)) codes.add("false-skip");
		}
		if (result.status === "unsupported") codes.add("unsupported-family");
	}
	if (report.applicableVectorCount === 0) codes.add("refused-empty-scan");
	if (report.executedVectorCount !== report.applicableVectorCount) {
		codes.add("count-drift");
	}
	if (!report.coverage.complete) codes.add("coverage-incomplete");
	return [...codes].sort();
}

export async function runTransactionVectors(
	args: RunTransactionVectorsArgs,
): Promise<VectorRunReport> {
	const coverage = computeVectorCoverage({
		corpus: args.corpus,
		contract: args.contract,
	});
	const results: VectorResult[] = [];

	const probe = await args.open.openRelative({
		vectorId: "capability-probe",
	});
	let advertised: ReadonlySet<string>;
	try {
		advertised = new Set(
			Object.entries(await probe.target.capabilities())
				.filter(([, enabled]) => enabled === true)
				.map(([name]) => name),
		);
	} finally {
		await closeHandle(probe);
	}

	const filter = args.filter ?? (() => true);
	const documentVectors = args.corpus.documentVectors.filter((vector) =>
		filter(vector.id),
	);
	const scenarioVectors = args.corpus.scenarioVectors.filter((vector) =>
		filter(vector.id),
	);
	const seedable = typeof args.open.openSeeded === "function";

	const applicable = [
		...documentVectors.filter(
			(vector) => missingRequirement({ vector, advertised }) === null,
		),
		...scenarioVectors.filter(
			(vector) => missingRequirement({ vector, advertised }) === null,
		),
	];
	const executable = applicable.filter(
		(vector) => seedable || !("initialDocument" in vector),
	);

	let executed = 0;

	const record = (result: VectorResult) => {
		results.push(result);
	};

	for (const vector of documentVectors) {
		// Family support is decided before capability, so a non-seedable target
		// reports the whole family `unsupported` instead of reporting some of it
		// as a capability skip — the silent-partial-pass hazard D2 rejects.
		if (!seedable) {
			record({
				id: vector.id,
				family: "document",
				status: "unsupported",
				comparisons: 0,
				reason: "target cannot be opened over a supplied document",
				failures: [],
				steps: [],
			});
			continue;
		}
		const missing = missingRequirement({ vector, advertised });
		if (missing !== null) {
			record({
				id: vector.id,
				family: "document",
				status: "skipped",
				comparisons: 0,
				reason: `capability:${missing}`,
				failures: [],
				steps: [],
			});
			continue;
		}
		let handle: VectorTargetHandle | null = null;
		try {
			handle = await seedDocumentTarget({ open: args.open, vector });
			const step = await executeVectorStep({
				target: handle.target,
				stepId: vector.id,
				batch: vector.batch,
				expect: vector.expect,
			});
			executed += 1;
			record({
				id: vector.id,
				family: "document",
				status: step.failures.length === 0 ? "passed" : "failed",
				comparisons: step.comparisons,
				failures: step.failures,
				steps: [step],
			});
		} catch (error) {
			executed += 1;
			record({
				id: vector.id,
				family: "document",
				status: "failed",
				comparisons: 0,
				failures: [
					`${vector.id}: threw ${error instanceof Error ? error.message : String(error)}`,
				],
				steps: [],
			});
		} finally {
			await closeHandle(handle);
		}
	}

	for (const vector of scenarioVectors) {
		const missing = missingRequirement({ vector, advertised });
		if (missing !== null) {
			record({
				id: vector.id,
				family: "scenario",
				status: "skipped",
				comparisons: 0,
				reason: `capability:${missing}`,
				failures: [],
				steps: [],
			});
			continue;
		}
		let handle: VectorTargetHandle | null = null;
		const steps: VectorStepResult[] = [];
		try {
			handle = await args.open.openRelative({ vectorId: vector.id });
			for (const step of vector.steps) {
				steps.push(
					await executeVectorStep({
						target: handle.target,
						stepId: `${vector.id}/${step.id}`,
						batch: step.batch,
						expect: step.expect,
					}),
				);
			}
			executed += 1;
			const failures = steps.flatMap((step) => step.failures);
			record({
				id: vector.id,
				family: "scenario",
				status: failures.length === 0 ? "passed" : "failed",
				comparisons: steps.reduce((total, step) => total + step.comparisons, 0),
				failures,
				steps,
			});
		} catch (error) {
			executed += 1;
			record({
				id: vector.id,
				family: "scenario",
				status: "failed",
				comparisons: steps.reduce((total, step) => total + step.comparisons, 0),
				failures: [
					...steps.flatMap((step) => step.failures),
					`${vector.id}: threw ${error instanceof Error ? error.message : String(error)}`,
				],
				steps,
			});
		} finally {
			await closeHandle(handle);
		}
	}

	const advertisedCapabilities = [...advertised].sort();
	const failureCodes = deriveFailureCodes({
		results,
		advertisedCapabilities,
		applicableVectorCount: executable.length,
		executedVectorCount: executed,
		coverage,
	});

	const familyVerdict = (family: VectorFamily): FamilyVerdict => {
		const scoped = results.filter((result) => result.family === family);
		if (scoped.some((result) => result.status === "unsupported")) {
			return "unsupported";
		}
		const ran = scoped.filter((result) => result.status !== "skipped");
		if (ran.length === 0) return "empty";
		return ran.every(
			(result) => result.status === "passed" && result.comparisons > 0,
		)
			? "passed"
			: "failed";
	};

	return {
		schema: TRANSACTION_VECTOR_SCHEMA,
		target: args.open.name,
		verdict: failureCodes.length === 0 ? "passed" : "failed",
		failureCodes,
		declaredVectorCount: args.corpus.declaredVectorCount,
		applicableVectorCount: executable.length,
		executedVectorCount: executed,
		totalComparisons: results.reduce(
			(total, result) => total + result.comparisons,
			0,
		),
		advertisedCapabilities,
		families: {
			document: familyVerdict("document"),
			scenario: familyVerdict("scenario"),
		},
		results,
		coverage,
	};
}
