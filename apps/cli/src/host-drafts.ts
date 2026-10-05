import { createHash } from "node:crypto";
import type { AutomationApi } from "@opencut/editor-automation";
import type {
	DraftEditingSession,
	DraftToolCall,
} from "@opencut/editor-contracts/draft";
import type { DraftReviewDocument } from "@opencut/editor-ports/host";

interface DraftPlane {
	readonly draftSessions: Map<string, DraftEditingSession>;
	automation(): AutomationApi;
	enqueue<T>(operation: () => Promise<T>): Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reviewDocument(session: DraftEditingSession): DraftReviewDocument {
	const snapshot = session.snapshot();
	const review = session.review();
	// HTTP review precondition, not a second implementation of draft policy.
	const token = createHash("sha256")
		.update(JSON.stringify({ snapshot, review }))
		.digest("hex");
	return { snapshot, review, token };
}

/** All review reads and decisions share the same queue as editor saves/stages. */
export async function handleDraftRoute({
	method,
	route,
	plane,
	readBody,
	respond,
}: {
	method: string | undefined;
	route: readonly string[];
	plane: DraftPlane;
	readBody: () => Promise<unknown>;
	respond: (status: number, body: unknown) => void;
}): Promise<void> {
	if (method === "POST" && route.length === 1) {
		const body = await readBody();
		if (!isRecord(body)) {
			respond(400, { error: "invalid-draft-body" });
			return;
		}
		await plane.enqueue(async () => {
			const opened = await plane.automation().openDraft({
				approvalMode: body.approvalMode === "auto" ? "auto" : "manual",
			});
			if (!opened.opened) {
				respond(409, { opened: false, error: opened.error });
				return;
			}
			plane.draftSessions.set(String(opened.session.id), opened.session);
			respond(200, { opened: true, draftId: opened.session.id });
		});
		return;
	}
	if (method === "GET" && route.length === 1) {
		await plane.enqueue(async () => {
			const drafts = [...plane.draftSessions.values()].map((session) => {
				const {
					id,
					state,
					approvalMode,
					baseRevision,
					acceptedCallCount,
					acceptedOperationCount,
				} = session.snapshot();
				return {
					id,
					state,
					approvalMode,
					baseRevision,
					acceptedCallCount,
					acceptedOperationCount,
				};
			});
			respond(200, { drafts });
		});
		return;
	}
	const action = route[2];
	const isDecision =
		action === "approve-reviewed" || action === "reject-reviewed";
	const body =
		method === "POST" && (action === "stage" || isDecision)
			? await readBody()
			: {};
	if (!isRecord(body)) {
		respond(400, { error: "invalid-draft-body" });
		return;
	}
	await plane.enqueue(async () => {
		const session = plane.draftSessions.get(route[1]);
		if (!session) {
			respond(404, { error: "unknown-draft" });
			return;
		}
		if (method === "GET" && route.length === 2) {
			respond(200, session.snapshot());
			return;
		}
		if (method === "GET" && route.length === 3 && action === "review") {
			respond(200, reviewDocument(session));
			return;
		}
		if (method !== "POST" || route.length !== 3) {
			respond(404, { error: "unknown-draft-action" });
			return;
		}
		if (isDecision) {
			if (
				typeof body.expectedReviewToken !== "string" ||
				!/^[a-f0-9]{64}$/.test(body.expectedReviewToken)
			) {
				respond(400, { error: "review-token-required" });
				return;
			}
			if (body.expectedReviewToken !== reviewDocument(session).token) {
				respond(409, { error: "draft-review-changed" });
				return;
			}
			respond(
				200,
				action === "approve-reviewed"
					? await session.approve()
					: await session.reject(),
			);
			return;
		}
		switch (action) {
			case "open":
				respond(409, { error: "draft-already-open" });
				break;
			case "stage":
				respond(
					200,
					await session.stage({
						operations: body.operations as DraftToolCall["operations"],
					}),
				);
				break;
			case "approve":
				respond(200, await session.approve());
				break;
			case "reject":
				respond(200, await session.reject());
				break;
			case "discard":
				respond(200, await session.discard());
				break;
			default:
				respond(404, { error: "unknown-draft-action" });
		}
	});
}
