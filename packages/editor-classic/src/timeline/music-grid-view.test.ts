import { expect, test } from "bun:test";
import { revisionOf, type TransactionRead } from "@opencut/editor-contracts";
import {
	readTimelineMusicGrid,
	snapTimelineMusicGrid,
} from "./music-grid-view";

function fixtureEngine(): TransactionRead {
	return {
		revision: async () => revisionOf(0),
		project: async () => null,
		tracks: async () => [],
		clips: async () => [],
		assets: async () => [],
		markers: async () => [],
	};
}

test("ruler displays native frame points verbatim and forwards source verification", async () => {
	const engine = fixtureEngine();
	const request = { kind: "list", bindingId: "song" } as const;
	const probe = async () => "available" as const;
	let received: unknown;
	const query = async (input: unknown) => {
		received = input;
		return {
			status: "ready",
			clock: "scene-timeline-ticks",
			nativeRevision: 8,
			gridRevision: 2,
			mappingHash: "mapping",
			mode: "manual",
			downbeatsKnown: false,
			points: [{ id: "point", tick: 321, frameTick: 400 }],
		};
	};
	const view = await readTimelineMusicGrid(engine, request, query, probe);
	expect(received).toEqual({ engine, request, sourceAvailability: probe });
	expect(view.points).toEqual([{ id: "point", tick: 321, frameTick: 400 }]);
	expect(view.downbeatsKnown).toBe(false);
});

test("unavailable or stale queries cannot produce visual points or snapped positions", async () => {
	const engine = fixtureEngine();
	const query = async () => ({
		status: "conflict",
		reason: "native revision changed",
		points: [{ id: "stale", tick: 10, frameTick: 10 }],
	});
	expect(
		(
			await readTimelineMusicGrid(
				engine,
				{ kind: "read", bindingId: "song" },
				query,
			)
		).points,
	).toEqual([]);
	expect(
		await snapTimelineMusicGrid(
			engine,
			{ kind: "snap", bindingId: "song" },
			query,
		),
	).toEqual({ status: "conflict", reason: "native revision changed" });
});

test("playhead uses the Rust snapped tick without local beat or frame calculation", async () => {
	const query = async () => ({
		status: "ready",
		nativeRevision: 4,
		gridRevision: 3,
		mappingHash: "hash",
		results: [{ key: "playhead", status: "matched", snappedTick: 867 }],
	});
	expect(
		await snapTimelineMusicGrid(
			fixtureEngine(),
			{ kind: "snap", bindingId: "song" },
			query,
		),
	).toEqual({
		status: "matched",
		tick: 867,
		nativeRevision: 4,
		gridRevision: 3,
		mappingHash: "hash",
	});
});
