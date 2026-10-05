/** Platform transport is independent of the domain schema it carries. */
export interface DraftReviewItem<State extends string = string> {
	readonly id: string;
	readonly state: State;
	readonly approvalMode: "manual" | "auto";
	readonly baseRevision: number;
	readonly acceptedCallCount: number;
	readonly acceptedOperationCount: number;
}

export interface DraftReviewDocument<Snapshot = unknown, Review = unknown> {
	readonly snapshot: Snapshot;
	readonly review: Review;
	/** Opaque host fingerprint of exactly the snapshot shown to the reviewer. */
	readonly token: string;
}

/** Platform adapter; lifecycle and approval remain owned by the host engine. */
export interface DraftReviewPort<
	Snapshot = unknown,
	Review = unknown,
	State extends string = string,
> {
	list(): Promise<readonly DraftReviewItem<State>[]>;
	read(id: string): Promise<DraftReviewDocument<Snapshot, Review>>;
	decide(args: {
		id: string;
		token: string;
		decision: "approve" | "reject";
	}): Promise<void>;
}
