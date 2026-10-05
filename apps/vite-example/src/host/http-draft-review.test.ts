import { describe, expect, test } from "bun:test";
import { createHttpDraftReview } from "./http-draft-review";

function adapter({
	payload,
	status = 200,
}: {
	payload: unknown;
	status?: number;
}) {
	const requests: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = Object.assign(
		async (url: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ url: String(url), init });
			return Response.json(payload, { status });
		},
		{ preconnect: () => undefined },
	);
	return { port: createHttpDraftReview({ base: "api/", fetchImpl }), requests };
}
describe("HTTP draft review adapter", () => {
	test("sends an exact guarded decision without fallback or retries", async () => {
		const { port, requests } = adapter({ payload: { applied: true } });
		await port.decide({
			id: "draft:one",
			token: "a".repeat(64),
			decision: "approve",
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("api/drafts/draft%3Aone/approve-reviewed");
		expect(JSON.parse(String(requests[0].init?.body))).toEqual({
			expectedReviewToken: "a".repeat(64),
		});
		expect(requests[0].init?.cache).toBe("no-store");
	});
	test("changed or invalidated reviews fail visibly and never fall back to unguarded approval", async () => {
		for (const error of ["draft-review-changed", "unknown-draft"]) {
			const { port, requests } = adapter({ payload: { error }, status: 409 });
			await expect(
				port.decide({ id: "test", token: "a".repeat(64), decision: "approve" }),
			).rejects.toThrow(/draft/i);
			expect(requests).toHaveLength(1);
		}
	});
	test("HTTP success is not approval success, and malformed review responses are rejected", async () => {
		const { port } = adapter({
			payload: { applied: false, draftError: { kind: "draft-expired" } },
		});
		await expect(
			port.decide({ id: "test", token: "a".repeat(64), decision: "approve" }),
		).rejects.toThrow("expired");
		await expect(
			adapter({ payload: { snapshot: {} } }).port.read("test"),
		).rejects.toThrow("Invalid draft review");
		await expect(
			adapter({ payload: { drafts: [{}] } }).port.list(),
		).rejects.toThrow("does not support draft review");
	});
});
