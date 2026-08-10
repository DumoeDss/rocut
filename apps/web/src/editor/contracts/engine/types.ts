import type {
	Asset,
	Clip,
	Marker,
	OperationKind,
	Project,
	Revision,
	Track,
	TransactionApply,
	TransactionBatch,
	TransactionGetContext,
	TransactionRead,
	TransactionResult,
	TransactionWatch,
} from "..";

export const TRANSACTION_ENGINE_BASE_FEATURES = [
	"atomic-batch",
	"expected-revision",
	"durable-revision",
	"durable-idempotency",
	"validation",
	"dry-run",
	"placement-policy",
	"cross-engine-cas",
] as const;

export type TransactionEngineBaseFeature =
	(typeof TRANSACTION_ENGINE_BASE_FEATURES)[number];

export type TransactionEngineOptionalFeatures<
	FeatureName extends string = string,
> = Readonly<
	Record<FeatureName, boolean> &
		Partial<Record<TransactionEngineBaseFeature, never>>
>;

export type TransactionEngineCapabilities<FeatureName extends string = never> =
	Readonly<
		Record<TransactionEngineBaseFeature, boolean> & Record<FeatureName, boolean>
	>;

export type TransactionEngineIssueCode =
	| "empty-batch"
	| "duplicate-id"
	| "missing-relation"
	| "not-found"
	| "unsupported-operation"
	| "expected-revision-conflict"
	| "idempotency-conflict"
	| "invalid-entity"
	| "non-positive-duration"
	| "timebase-misaligned"
	| "collision"
	| "lane-incompatible"
	| "source-out-of-bounds";

export interface TransactionEngineIssue {
	readonly code: TransactionEngineIssueCode | `provider:${string}`;
	readonly message: string;
	readonly operationIndex?: number;
	readonly entityIds?: readonly string[];
	readonly expectedRevision?: Revision;
	readonly actualRevision?: Revision;
}

export type TransactionValidationOutcome =
	| {
			readonly valid: true;
			readonly baseRevision: Revision;
			readonly issues: readonly [];
	  }
	| {
			readonly valid: false;
			readonly baseRevision: Revision;
			readonly issues: readonly TransactionEngineIssue[];
	  };

export type TransactionDryRunOutcome =
	| {
			readonly accepted: true;
			readonly baseRevision: Revision;
			readonly result: TransactionResult;
			readonly replayed: boolean;
	  }
	| {
			readonly accepted: false;
			readonly baseRevision: Revision;
			readonly issues: readonly TransactionEngineIssue[];
	  };

export interface TransactionIdempotencyEntry {
	readonly key: string;
	readonly fingerprint: string;
	readonly result: TransactionResult;
}

export interface TransactionEngineDocument {
	readonly project: Project | null;
	readonly tracks: readonly Track[];
	readonly clips: readonly Clip[];
	readonly assets: readonly Asset[];
	readonly markers: readonly Marker[];
	readonly revision: Revision;
	readonly idempotency: readonly TransactionIdempotencyEntry[];
}

export interface PlacementPolicyContext {
	readonly document: TransactionEngineDocument;
	readonly batch: TransactionBatch;
	readonly operationIndexByEntityId: ReadonlyMap<string, number>;
}

export interface TransactionPlacementPolicy {
	evaluate(
		context: PlacementPolicyContext,
	):
		| readonly TransactionEngineIssue[]
		| Promise<readonly TransactionEngineIssue[]>;
}

export interface TransactionEngine<FeatureName extends string = never>
	extends
		TransactionRead,
		TransactionApply,
		TransactionGetContext,
		TransactionWatch {
	validate(batch: TransactionBatch): Promise<TransactionValidationOutcome>;
	dryRun(batch: TransactionBatch): Promise<TransactionDryRunOutcome>;
	capabilities(): Promise<TransactionEngineCapabilities<FeatureName>>;
	supportedOperations(): Promise<readonly OperationKind[]>;
}
