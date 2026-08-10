import type {
	Asset,
	AssetId,
	Clip,
	Marker,
	OperationKind,
	Project,
	Revision,
	Track,
	TransactionBatch,
	TransactionOperation,
	TransactionResult,
} from "..";
import type {
	TransactionEngine,
	TransactionEngineDocument,
	TransactionEngineIssue,
	TransactionPlacementPolicy,
} from "../engine";

declare const __draftIdBrand: unique symbol;

export type DraftId = string & { readonly [__draftIdBrand]: true };

export type DraftApprovalMode = "manual" | "auto";

export type DraftLifecycleState =
	| "editing"
	| "applying"
	| "applied"
	| "rejected"
	| "conflicted";

export type DraftSafeOperation = TransactionOperation;

export interface DraftContentSnapshot {
	readonly project: Project | null;
	readonly tracks: readonly Track[];
	readonly clips: readonly Clip[];
	readonly assets: readonly Asset[];
	readonly markers: readonly Marker[];
	readonly revision: Revision;
}

export interface DraftSnapshot {
	readonly id: DraftId;
	readonly approvalMode: DraftApprovalMode;
	readonly state: DraftLifecycleState;
	readonly baseRevision: Revision;
	readonly base: DraftContentSnapshot;
	readonly working: DraftContentSnapshot;
	readonly acceptedCallCount: number;
	readonly acceptedOperationCount: number;
}

export interface DraftToolCall {
	readonly operations: readonly DraftSafeOperation[];
}

export interface DraftReviewEntry {
	readonly callIndex: number;
	readonly operationIndex: number;
	readonly kind: OperationKind;
	readonly affectedEntityIds: readonly string[];
}

export interface DraftReviewSummary {
	readonly entries: readonly DraftReviewEntry[];
	readonly affectedEntityIds: readonly string[];
	readonly counts: {
		readonly calls: number;
		readonly operations: number;
		readonly byKind: Readonly<Record<OperationKind, number>>;
	};
}

export interface DraftRetainedAssetEvidence {
	readonly assetId: AssetId;
	readonly projectOwned: true;
}

export interface DraftResourceRetentionEvidence {
	readonly candidateAssetIds: readonly AssetId[];
	readonly retainedAssets: readonly DraftRetainedAssetEvidence[];
	readonly missingAssetIds: readonly AssetId[];
}

export type DraftRetentionPreflightOutcome =
	| {
			readonly retained: true;
			readonly evidence: DraftResourceRetentionEvidence;
	  }
	| {
			readonly retained: false;
			readonly reason: "missing-assets" | "policy-failed";
			readonly message: string;
			readonly evidence: DraftResourceRetentionEvidence;
	  };

export interface DraftResourceRetentionPolicy {
	preflight(args: {
		readonly draftId: DraftId;
		readonly candidate: DraftContentSnapshot;
		readonly referencedAssetIds: readonly AssetId[];
	}): Promise<DraftRetentionPreflightOutcome>;
}

/**
 * Explicit provider port for an exact, detached committed-state capture.
 * Public TransactionEngine wrappers do not acquire this capability implicitly.
 */
export interface DraftCommittedStateCapture {
	readonly capture: () =>
		| TransactionEngineDocument
		| Promise<TransactionEngineDocument>;
}

export interface DraftCommittedStateError {
	readonly kind: "committed-state-unavailable";
	readonly reason: "missing-capability" | "capture-failed" | "state-mismatch";
	readonly message: string;
}

export interface DraftUndoPlan {
	readonly kind: "compensating-transaction";
	readonly batch: TransactionBatch;
}

export interface DraftApplicationReceipt {
	readonly origin: { readonly kind: "draft"; readonly draftId: DraftId };
	readonly approvalMode: DraftApprovalMode;
	readonly baseRevision: Revision;
	readonly appliedRevision: Revision;
	readonly review: DraftReviewSummary;
	readonly forwardBatch: TransactionBatch;
	readonly forwardResult: TransactionResult;
	readonly retentionEvidence: DraftResourceRetentionEvidence;
	readonly undoPlan: DraftUndoPlan;
}

export type DraftOpenError =
	| {
			readonly kind: "invalid-draft-id";
			readonly message: string;
	  }
	| {
			readonly kind: "invalid-approval-mode";
			readonly approvalMode: string;
			readonly message: string;
	  }
	| {
			readonly kind: "duplicate-draft-id";
			readonly draftId: string;
			readonly message: string;
	  }
	| {
			readonly kind: "snapshot-busy";
			readonly attempts: number;
			readonly expectedRevision: Revision;
			readonly actualRevision: Revision;
			readonly message: string;
	  }
	| {
			readonly kind: "snapshot-read-failed";
			readonly message: string;
	  }
	| DraftCommittedStateError;

export type DraftInvalidStateError = {
	readonly kind: "invalid-state";
	readonly action: "stage" | "approve" | "reject";
	readonly state: DraftLifecycleState;
	readonly message: string;
};

export type DraftCallError =
	| DraftInvalidStateError
	| { readonly kind: "empty-call"; readonly message: string }
	| {
			readonly kind: "immediate-operation-required";
			readonly operationIndex: number;
			readonly immediateKind: ImmediateOperationKind;
			readonly message: string;
	  }
	| {
			readonly kind: "unsupported-draft-operation";
			readonly operationIndex: number;
			readonly operationKind: string;
			readonly message: string;
	  }
	| {
			readonly kind: "evaluation-rejected";
			readonly issues: readonly TransactionEngineIssue[];
			readonly message: string;
	  }
	| {
			readonly kind: "evaluation-failed";
			readonly message: string;
	  };

export type DraftApprovalError =
	| DraftInvalidStateError
	| DraftCommittedStateError
	| { readonly kind: "empty-draft"; readonly message: string }
	| {
			readonly kind: "mode-incompatible";
			readonly expectedMode: "manual";
			readonly actualMode: DraftApprovalMode;
			readonly message: string;
	  }
	| {
			readonly kind: "retention-failed";
			readonly reason: "missing-assets" | "policy-failed";
			readonly message: string;
			readonly evidence: DraftResourceRetentionEvidence;
	  }
	| {
			readonly kind: "unexpected-applied-revision";
			readonly expectedRevision: Revision;
			readonly actualRevision: Revision;
			readonly message: string;
	  }
	| {
			readonly kind: "compensation-rejected";
			readonly issues: readonly TransactionEngineIssue[];
			readonly message: string;
	  }
	| {
			readonly kind: "compensation-failed";
			readonly message: string;
	  };

export type DraftApprovalOutcome =
	| {
			readonly applied: true;
			readonly state: "applied";
			readonly receipt: DraftApplicationReceipt;
	  }
	| {
			readonly applied: false;
			readonly state: DraftLifecycleState;
			readonly draftError: DraftApprovalError;
	  }
	| {
			readonly applied: false;
			readonly state: "conflicted";
			/**
			 * An immutable evidence snapshot of the parent-engine error. Known T1
			 * error prototypes are retained; generic executable/accessor evidence is
			 * sanitized and standard built-ins are represented as tagged data.
			 */
			readonly engineError: unknown;
	  };

export type DraftCallOutcome =
	| {
			readonly accepted: true;
			readonly snapshot: DraftSnapshot;
			readonly review: DraftReviewSummary;
			readonly application?: DraftApprovalOutcome;
	  }
	| {
			readonly accepted: false;
			readonly snapshot: DraftSnapshot;
			readonly error: DraftCallError;
	  };

export type DraftRejectionOutcome =
	| {
			readonly rejected: true;
			readonly snapshot: DraftSnapshot;
	  }
	| {
			readonly rejected: false;
			readonly snapshot: DraftSnapshot;
			readonly error: DraftInvalidStateError;
	  };

export interface DraftEditingSession {
	readonly id: DraftId;
	readonly approvalMode: DraftApprovalMode;
	snapshot(): DraftSnapshot;
	stage(call: DraftToolCall): Promise<DraftCallOutcome>;
	review(): DraftReviewSummary;
	approve(): Promise<DraftApprovalOutcome>;
	reject(): Promise<DraftRejectionOutcome>;
}

export type DraftOpenOutcome =
	| { readonly opened: true; readonly session: DraftEditingSession }
	| { readonly opened: false; readonly error: DraftOpenError };

export interface DraftEditingManager {
	open(input: {
		readonly id: string;
		readonly approvalMode: DraftApprovalMode;
	}): Promise<DraftOpenOutcome>;
}

export interface CreateDraftEditingManagerOptions<
	FeatureName extends string = never,
> {
	readonly engine: TransactionEngine<FeatureName>;
	readonly committedState?: DraftCommittedStateCapture;
	readonly retentionPolicy: DraftResourceRetentionPolicy;
	readonly placementPolicies?: readonly TransactionPlacementPolicy[];
	readonly snapshotAttempts?: number;
}

export const IMMEDIATE_OPERATION_KINDS = [
	"media-generation",
	"project-export",
	"source-package-removal",
	"external-resource-deletion",
	"external-side-effect",
] as const;

export type ImmediateOperationKind = (typeof IMMEDIATE_OPERATION_KINDS)[number];

export interface ImmediateOperationDescriptor {
	readonly kind: ImmediateOperationKind;
	readonly handling: "immediate";
}
