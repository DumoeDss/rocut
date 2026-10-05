import {
	isDraftReviewDocument,
	isDraftReviewItem,
	type DraftReviewPort,
} from "@opencut/editor-contracts/draft";

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
function failure(code: unknown): Error {
	switch (code) {
		case "draft-review-changed":
			return new Error(
				"This draft changed after you opened it. Reload the review before deciding.",
			);
		case "unknown-draft":
			return new Error(
				"This draft is no longer available. Project edits or a host restart may have invalidated it. Ask for a fresh proposal.",
			);
		case "draft-expired":
			return new Error("This draft expired. Ask for a fresh proposal.");
		default:
			return new Error(
				"The draft could not be updated. Reload the review and check the project before trying again.",
			);
	}
}

/** Same-origin host adapter; the editor itself knows no HTTP routes or tokens. */
export function createHttpDraftReview({
	base = "api",
	fetchImpl = fetch,
}: {
	base?: string;
	fetchImpl?: typeof fetch;
} = {}): DraftReviewPort {
	const request = async ({
		route,
		body,
	}: {
		route: string;
		body?: unknown;
	}) => {
		const response = await fetchImpl(
			base.replace(/\/$/, "") + "/drafts" + route,
			{
				cache: "no-store",
				signal: AbortSignal.timeout(15000),
				...(body === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(body),
						}),
			},
		);
		const result: unknown = await response.json();
		if (!record(result))
			throw new Error(
				"Invalid draft response. Update the plugin and reopen the editor.",
			);
		if (!response.ok) throw failure(result.error);
		return result;
	};
	return {
		async list() {
			const result = await request({ route: "" });
			if (
				!Array.isArray(result.drafts) ||
				!result.drafts.every(isDraftReviewItem)
			)
				throw new Error(
					"This host does not support draft review. Update the plugin and reopen the editor.",
				);
			return result.drafts;
		},
		async read(id) {
			const result = await request({
				route: "/" + encodeURIComponent(id) + "/review",
			});
			if (!isDraftReviewDocument(result) || result.snapshot.id !== id)
				throw new Error(
					"Invalid draft review. Refresh the list before deciding.",
				);
			return result;
		},
		async decide({ id, token, decision }) {
			const result = await request({
				route: "/" + encodeURIComponent(id) + "/" + decision + "-reviewed",
				body: { expectedReviewToken: token },
			});
			if (
				decision === "approve"
					? result.applied !== true
					: result.rejected !== true
			) {
				const error = record(result.draftError)
					? result.draftError
					: record(result.error)
						? result.error
						: {};
				throw failure(error.kind);
			}
		},
	};
}
