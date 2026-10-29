import { describe, expect, test } from "bun:test";
import { runMusicGridCli } from "../music-grid-cli";
import { runCutPlanCli } from "../cut-plan-cli";
import {
	musicGridEditRequest,
	musicGridQueryRequest,
	musicGridCapability,
} from "../music-grid-route";

describe("music-grid formal transport", () => {
	test("hydrates reviewed anchors from actual separate UTF-8 file bytes and routes cut-plan reads", async () => {
		const calls: unknown[][] = [];
		const resource = {
			schema: "creator-music-anchors/1",
			clock: "source-audio-ticks",
			kind: "sections",
			source: { sha256: "a".repeat(64) },
			reviewReference: "review:file",
			anchors: [{ key: "verse", sourceTick: 12, endSourceTick: 24 }],
		};
		const invoke = (async (...args: unknown[]) => {
			calls.push(args);
			return { status: "unavailable" };
		}) as never;
		await runMusicGridCli(
			["project-anchors", "query", "resource"],
			{ secret: {} as never },
			{
				request: invoke,
				readSpec: async (path) =>
					new TextEncoder().encode(
						JSON.stringify(
							path === "query"
								? { bindingId: "binding", expectedNativeRevision: 4 }
								: resource,
						),
					),
			},
		);
		expect(calls[0]?.slice(1)).toMatchObject([
			"POST",
			"music-grid/query",
			{
				kind: "project-anchors",
				bindingId: "binding",
				expectedNativeRevision: 4,
				anchorSource: {
					sourceSha256: "a".repeat(64),
					resourceRevision: 1,
					reviewReference: "review:file",
					anchors: [
						{ key: "verse:start", sourceTick: 12 },
						{ key: "verse:end", sourceTick: 24 },
					],
				},
			},
		]);
		await runCutPlanCli(
			["validate", "cut"],
			{ secret: {} as never },
			{
				request: invoke,
				readSpec: async () =>
					new TextEncoder().encode('{"expectedNativeRevision":4}'),
			},
		);
		expect(calls[1]?.slice(1)).toEqual([
			"POST",
			"cut-plan/validate",
			{ expectedNativeRevision: 4 },
		]);
		expect(
			musicGridQueryRequest({
				kind: "project-anchors",
				bindingId: "binding",
				clock: "project-timeline-ticks",
				anchorSource: {},
			}).kind,
		).toBe("project-anchors");
		expect(
			musicGridEditRequest({
				expectedNativeRevision: 4,
				idempotencyKey: "bpm",
				operation: { kind: "create-manual-bpm" },
			}).operation.kind,
		).toBe("create-manual-bpm");
	});
	test("routes read-only verbs to the same native query endpoint", async () => {
		const calls: unknown[][] = [];
		const result = await runMusicGridCli(
			["snap", "request.json"],
			{ secret: {} as never },
			{
				readSpec: async () =>
					new TextEncoder().encode(
						JSON.stringify({ bindingId: "binding", maxDistanceTicks: 10 }),
					),
				request: (async (...args: unknown[]) => {
					calls.push(args);
					return { status: "unavailable" };
				}) as never,
			},
		);
		expect(calls[0]?.slice(1)).toEqual([
			"POST",
			"music-grid/query",
			{ bindingId: "binding", maxDistanceTicks: 10, kind: "snap" },
		]);
		expect(result).toEqual({ status: "unavailable" });
	});
	test("rejects mismatched verbs, malformed UTF-8 and write requests without CAS", async () => {
		await expect(
			runMusicGridCli(
				["list", "spec"],
				{ secret: {} as never },
				{ readSpec: async () => new TextEncoder().encode('{"kind":"snap"}') },
			),
		).rejects.toThrow("does not match");
		await expect(
			runMusicGridCli(
				["read", "spec"],
				{ secret: {} as never },
				{ readSpec: async () => new Uint8Array([255]) },
			),
		).rejects.toThrow();
		expect(() =>
			musicGridEditRequest({ operation: { kind: "remove" } }),
		).toThrow();
		expect(() =>
			musicGridQueryRequest({ kind: "list", bindingId: "b", guessedBpm: 120 }),
		).toThrow();
	});
	test("capability states live runtime availability explicitly", () => {
		expect(["available", "unavailable"]).toContain(
			musicGridCapability().status,
		);
		expect(musicGridCapability().queryReadOnly).toBe(true);
	});
});
