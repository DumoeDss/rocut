import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TargetRegistry } from "../target-registry";
import { startHost } from "../host";
import type { RunningHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-draft-"));
	tempRoots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of tempRoots)
		await rm(root, { recursive: true, force: true });
});

function createTrack(id: string) {
	return {
		kind: "create-track" as const,
		track: {
			id: id as never,
			kind: "graphic" as const,
			name: id,
			hidden: false,
		},
	};
}

async function openHost(): Promise<RunningHost> {
	return startHost({
		projectRoot: await tempRoot(),
		registry: new TargetRegistry(await tempRoot()),
	});
}

describe("host draft endpoints (S07 draft verbs)", () => {
	test("begin → stage → approve commits atomically and appears in reads", async () => {
		const host = await openHost();
		try {
			const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
			const begun = (await (
				await fetch(`${base}/drafts`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ approvalMode: "manual" }),
				})
			).json()) as { opened: boolean; draftId: string };
			expect(begun.opened).toBe(true);

			const staged = (await (
				await fetch(`${base}/drafts/${begun.draftId}/stage`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						operations: [createTrack("d-a"), createTrack("d-b")],
					}),
				})
			).json()) as { accepted: boolean };
			expect(staged.accepted).toBe(true);

			const before = (await (
				await fetch(`${base}/tracks`)
			).json()) as { name: string }[];
			expect(before.map((track) => track.name)).toEqual(["Main Track"]);
			const approved = (await (
				await fetch(`${base}/drafts/${begun.draftId}/approve`, {
					method: "POST",
				})
			).json()) as { applied: boolean };
			expect(approved.applied).toBe(true);

			const after = (await (await fetch(`${base}/tracks`)).json()) as {
				name: string;
			}[];
			expect(after.map((track) => track.name)).toEqual([
				"Main Track",
				"d-a",
				"d-b",
			]);
		} finally {
			await host.close();
		}
	});

	test("discard terminates a draft without applying anything", async () => {
		const host = await openHost();
		try {
			const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
			const begun = (await (
				await fetch(`${base}/drafts`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ approvalMode: "manual" }),
				})
			).json()) as { draftId: string };
			await fetch(`${base}/drafts/${begun.draftId}/stage`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ operations: [createTrack("gone")] }),
			});
			const discarded = (await (
				await fetch(`${base}/drafts/${begun.draftId}/discard`, {
					method: "POST",
				})
			).json()) as { rejected: boolean; reason: string };
			expect(discarded.rejected).toBe(true);
			expect(discarded.reason).toBe("discarded");
			const tracks = (await (
				await fetch(`${base}/tracks`)
			).json()) as { name: string }[];
			expect(tracks.map((track) => track.name)).toEqual(["Main Track"]);
			const snapshot = (await (
				await fetch(`${base}/drafts/${begun.draftId}`)
			).json()) as { state: string; rejectionReason?: string };
			expect(snapshot.state).toBe("rejected");
			expect(snapshot.rejectionReason).toBe("discarded");
		} finally {
			await host.close();
		}
	});

	test("unknown draft ids 404", async () => {
		const host = await openHost();
		try {
			const response = await fetch(
				`http://127.0.0.1:${host.port}/${host.token}/api/drafts/nope/stage`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ operations: [] }),
				},
			);
			expect(response.status).toBe(404);
		} finally {
			await host.close();
		}
	});
});
