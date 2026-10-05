import type {
	DraftLifecycleState,
	DraftReviewSummary,
	DraftSnapshot,
} from "@opencut/editor-contracts/draft";

export interface DraftReviewItem {
	readonly id: string;
	readonly state: DraftLifecycleState;
	readonly approvalMode: "manual" | "auto";
	readonly baseRevision: number;
	readonly acceptedCallCount: number;
	readonly acceptedOperationCount: number;
}

export interface DraftReviewDocument {
	readonly snapshot: DraftSnapshot;
	readonly review: DraftReviewSummary;
	/** Opaque host fingerprint of exactly the snapshot shown to the reviewer. */
	readonly token: string;
}

/** Platform adapter; lifecycle and approval remain owned by the host engine. */
export interface DraftReviewPort {
	list(): Promise<readonly DraftReviewItem[]>;
	read(id: string): Promise<DraftReviewDocument>;
	decide(args: {
		id: string;
		token: string;
		decision: "approve" | "reject";
	}): Promise<void>;
}
