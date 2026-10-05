import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];
async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-review-"));
	roots.push(root);
	const host = await startHost({
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "targets")),
	});
	const base = "http://127.0.0.1:" + host.port + "/" + host.token + "/api";
	const call = async (route: string, body?: unknown) => {
		const response = await fetch(
			base + route,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					},
		);
		return { status: response.status, body: await response.json() };
	};
	const open = async () =>
		(await call("/drafts", { approvalMode: "manual" })).body.draftId as string;
	const stage = (id: string, name: string) =>
		call("/drafts/" + id + "/stage", {
			operations: [
				{
					kind: "create-track",
					track: { id: name, kind: "graphic", name, hidden: false },
				},
			],
		});
	return { host, call, open, stage };
}
afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("review-bound host draft decisions", () => {
	test("view-only and redundant saves preserve an exact review and its latest persisted view", async () => {
		const f = await fixture();
		try {
			const id = await f.open();
			await f.stage(id, "review-survives-view");
			const review = (await f.call("/drafts/" + id + "/review")).body;
			const saved = (await f.call("/record")).body;
			for (const changed of [false, true]) {
				if (changed) {
					saved.record.data.timelineViewState = { zoomLevel: 2, scrollLeft: 135, playheadTime: 240000 };
					saved.record.data.metadata.updatedAt = "2026-10-05T00:00:00.000Z";
				}
				const response = await fetch("http://127.0.0.1:" + f.host.port + "/" + f.host.token + "/api/record", {
					method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(saved),
				});
				expect(response.status).toBe(200);
				await response.text();
				expect((await f.call("/drafts/" + id + "/review")).body.token).toBe(review.token);
			}
			expect((await f.call("/drafts/" + id + "/approve-reviewed", { expectedReviewToken: review.token })).body.applied).toBe(true);
			const committed = (await f.call("/record")).body.record;
			expect(committed.data.timelineViewState).toEqual(saved.record.data.timelineViewState);
			expect((await f.call("/tracks")).body).toHaveLength(2);
		} finally { await f.host.close(); }
	});
	test("lists proposals without content, returns stable exact reviews, and approves only the reviewed state", async () => {
		const f = await fixture();
		try {
			const id = await f.open();
			expect((await f.stage(id, "reviewed-track")).body.accepted).toBe(true);
			const items = (await f.call("/drafts")).body.drafts;
			expect(items).toEqual([
				{
					id,
					state: "editing",
					approvalMode: "manual",
					baseRevision: 0,
					acceptedCallCount: 1,
					acceptedOperationCount: 1,
				},
			]);
			const review = (await f.call("/drafts/" + id + "/review")).body;
			expect(review.token).toMatch(/^[a-f0-9]{64}$/);
			expect(review.snapshot.base.tracks).toHaveLength(1);
			expect(review.snapshot.working.tracks).toHaveLength(2);
			expect(review.review.entries[0].kind).toBe("create-track");
			expect((await f.call("/drafts/" + id + "/review")).body.token).toBe(
				review.token,
			);
			expect((await f.call("/tracks")).body).toHaveLength(1);
			expect(
				(await f.call("/drafts/" + id + "/approve-reviewed", {})).status,
			).toBe(400);
			const result = await f.call("/drafts/" + id + "/approve-reviewed", {
				expectedReviewToken: review.token,
			});
			expect(result.body.applied).toBe(true);
			expect((await f.call("/tracks")).body).toHaveLength(2);
			expect(
				(
					await f.call("/drafts/" + id + "/approve-reviewed", {
						expectedReviewToken: review.token,
					})
				).status,
			).toBe(409);
		} finally {
			await f.host.close();
		}
	});
	test("new stages invalidate old approval AND rejection without changing the committed project", async () => {
		const f = await fixture();
		try {
			const id = await f.open();
			await f.stage(id, "first");
			const old = (await f.call("/drafts/" + id + "/review")).body;
			await f.stage(id, "unseen");
			for (const action of ["approve", "reject"]) {
				const result = await f.call(
					"/drafts/" + id + "/" + action + "-reviewed",
					{ expectedReviewToken: old.token },
				);
				expect(result).toEqual({
					status: 409,
					body: { error: "draft-review-changed" },
				});
			}
			expect((await f.call("/tracks")).body).toHaveLength(1);
			const fresh = (await f.call("/drafts/" + id + "/review")).body;
			expect(fresh.token).not.toBe(old.token);
			expect(fresh.snapshot.acceptedOperationCount).toBe(2);
			expect(
				(
					await f.call("/drafts/" + id + "/reject-reviewed", {
						expectedReviewToken: fresh.token,
					})
				).body.rejected,
			).toBe(true);
			expect((await f.call("/tracks")).body).toHaveLength(1);
		} finally {
			await f.host.close();
		}
	});
	test("does not apply a removed draft or reuse another draft's review token", async () => {
		const f = await fixture();
		try {
			const first = await f.open();
			const second = await f.open();
			await f.stage(first, "first");
			await f.stage(second, "second");
			const review = (await f.call("/drafts/" + first + "/review")).body;
			expect(
				(
					await f.call("/drafts/" + second + "/approve-reviewed", {
						expectedReviewToken: review.token,
					})
				).status,
			).toBe(409);
			const record = (await f.call("/record")).body;
			// A content edit at the same revision must still retire old drafts.
			record.record.data.metadata.name = "User renamed project";
			const base =
				"http://127.0.0.1:" + f.host.port + "/" + f.host.token + "/api/record";
			const saved = await fetch(base, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(record),
			});
			expect(saved.status).toBe(200);
			await saved.text();
			expect(
				(
					await f.call("/drafts/" + first + "/approve-reviewed", {
						expectedReviewToken: review.token,
					})
				).status,
			).toBe(404);
			expect((await f.call("/tracks")).body).toHaveLength(1);
		} finally {
			await f.host.close();
		}
	});
});
