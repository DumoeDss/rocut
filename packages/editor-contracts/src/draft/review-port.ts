import type {
	DraftReviewDocument as TransportDocument,
	DraftReviewItem as TransportItem,
	DraftReviewPort as TransportPort,
} from "@opencut/editor-ports/host";
import type {
	DraftLifecycleState,
	DraftReviewSummary,
	DraftSnapshot,
} from "./types";

export type DraftReviewItem = TransportItem<DraftLifecycleState>;
export type DraftReviewDocument = TransportDocument<
	DraftSnapshot,
	DraftReviewSummary
>;
export type DraftReviewPort = TransportPort<
	DraftSnapshot,
	DraftReviewSummary,
	DraftLifecycleState
>;

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export function isDraftReviewItem(value: unknown): value is DraftReviewItem {
	return (
		record(value) &&
		typeof value.id === "string" &&
		value.id.length > 0 &&
		["editing", "applying", "applied", "rejected", "conflicted"].includes(
			String(value.state),
		) &&
		(value.approvalMode === "manual" || value.approvalMode === "auto") &&
		count(value.baseRevision) &&
		count(value.acceptedCallCount) &&
		count(value.acceptedOperationCount)
	);
}
export function isDraftReviewDocument(
	value: unknown,
): value is DraftReviewDocument {
	if (
		!record(value) ||
		typeof value.token !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.token) ||
		!isDraftReviewItem(value.snapshot) ||
		!record(value.snapshot) ||
		!record(value.review)
	)
		return false;
	const snapshot = value.snapshot;
	const content = (data: unknown) =>
		record(data) &&
		count(data.revision) &&
		["tracks", "clips", "assets", "markers"].every((key) =>
			Array.isArray(data[key]),
		) &&
		(data.motionTextSequences === undefined ||
			Array.isArray(data.motionTextSequences));
	return (
		content(snapshot.base) &&
		content(snapshot.working) &&
		Array.isArray(value.review.entries) &&
		value.review.entries.every(
			(entry) => record(entry) && typeof entry.kind === "string",
		)
	);
}

/** Refine opaque host responses before a UI may display or decide a draft. */
export function createValidatedDraftReviewPort(
	transport: TransportPort,
): DraftReviewPort {
	return {
		async list() {
			const drafts = await transport.list();
			if (!Array.isArray(drafts) || !drafts.every(isDraftReviewItem))
				throw new Error(
					"This host does not support draft review. Update the plugin and reopen the editor.",
				);
			return drafts;
		},
		async read(id) {
			const reviewed = await transport.read(id);
			if (!isDraftReviewDocument(reviewed) || reviewed.snapshot.id !== id)
				throw new Error(
					"Invalid draft review. Refresh the list before deciding.",
				);
			return reviewed;
		},
		decide(args) {
			return transport.decide(args);
		},
	};
}
