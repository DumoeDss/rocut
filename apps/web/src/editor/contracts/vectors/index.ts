/**
 * The published transaction-vector surface (S03 T4).
 *
 * Deliberately **not** re-exported from `@/editor/contracts`: the corpus is
 * data no editor module imports, and the runner enters a distributable graph
 * only if a Host chooses to import it. Consumers reach it by this path.
 */
export { TRANSACTION_VECTOR_SCHEMA, TransactionVectorError } from "./schema";
export type {
	DocumentVector,
	ScenarioStep,
	ScenarioVector,
	TransactionVector,
	TransactionVectorCorpus,
	VectorBatch,
	VectorExpectation,
	VectorFamily,
	VectorManifest,
	VectorManifestEntry,
	VectorRequirement,
	VectorSeedDocument,
} from "./schema";
export { isDocumentVector, isScenarioVector } from "./schema";

export { sha256Hex } from "./sha256";

export { parseContractSurface } from "./contract-surface";
export type { ContractSurface, ContractSurfaceSources } from "./contract-surface";

export {
	corpusDigestOf,
	declaredAssertionCount,
	loadTransactionVectorCorpus,
} from "./loader";
export type { LoadTransactionVectorsArgs } from "./loader";

export { computeVectorCoverage, formatCoverageFailures } from "./coverage";
export type {
	CoverageDimension,
	CoverageMember,
	VectorCoverageReport,
} from "./coverage";

export {
	deriveFailureCodes,
	executeVectorStep,
	PROJECT_PLACEHOLDER,
	runTransactionVectors,
} from "./runner";
export type {
	FailureCodeSubject,
	FamilyVerdict,
	RunTransactionVectorsArgs,
	VectorResult,
	VectorRunReport,
	VectorStatus,
	VectorStepResult,
	VectorTarget,
	VectorTargetFactory,
	VectorTargetHandle,
} from "./runner";

export {
	AGENT_LEDGER_SCHEMA,
	AGENT_SCENARIO,
	AGENT_SCENARIO_ID,
	AGENT_SCENARIO_TITLE,
	agentLedgerFailureCodes,
	agentScenarioCreatedIds,
	captureAgentCommitment,
	runAgentScenario,
	verifyAgentReopen,
} from "./agent-scenario";
export type {
	AgentCommitment,
	AgentLedger,
	AgentLedgerStep,
	AgentReopenResult,
	RunAgentScenarioArgs,
} from "./agent-scenario";
