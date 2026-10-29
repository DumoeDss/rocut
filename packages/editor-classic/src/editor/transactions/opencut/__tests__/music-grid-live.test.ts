import { expect, mock, test } from "bun:test";
import {
	projectId,
	revisionOf,
	type TransactionRead,
} from "@opencut/editor-contracts";
if (process.env.ROCUT_MUSIC_GRID_LIVE_CHILD !== "1") {
	test("live music grid transport checks run in an isolated native-module fixture", () => {
		const child = Bun.spawnSync({
			cmd: [process.execPath, "test", import.meta.path],
			env: { ...process.env, ROCUT_MUSIC_GRID_LIVE_CHILD: "1" },
		});
		if (child.exitCode !== 0)
			throw Error(new TextDecoder().decode(child.stderr));
		expect(child.exitCode).toBe(0);
	});
} else {
	mock.module("opencut-wasm", () => ({
		validateSceneStateJson: () => "[]",
		planSceneMutationJson: () => "{}",
		queryMusicGridJson: (input: string) => {
			const parsed: unknown = JSON.parse(input);
			if (
				!parsed ||
				typeof parsed !== "object" ||
				!("document" in parsed) ||
				!parsed.document ||
				typeof parsed.document !== "object" ||
				!("revision" in parsed.document) ||
				!("project" in parsed.document) ||
				!parsed.document.project ||
				typeof parsed.document.project !== "object" ||
				!("name" in parsed.document.project)
			)
				throw Error("Invalid native fixture request");
			return JSON.stringify({
				status: "ready",
				nativeRevision: parsed.document.revision,
				projectName: parsed.document.project.name,
				requiredSources: [
					{ assetId: "song-source", sourceSha256: "a".repeat(64) },
				],
			});
		},
	}));
	const { queryMusicGrid } = await import("../music-grid");
	function owner() {
		let revision = revisionOf(0);
		let name = "First";
		const engine: TransactionRead = {
			revision: async () => revision,
			project: async () => ({
				id: projectId("live"),
				name,
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 100,
				canvasHeight: 100,
			}),
			tracks: async () => [],
			clips: async () => [],
			assets: async () => [],
			markers: async () => [],
		};
		return {
			engine,
			move: () => {
				revision = revisionOf(revision + 1);
				name = "Second";
			},
		};
	}
	test("live wrapper captures each query and verifies the exact Rust-requested pin through the platform owner", async () => {
		const { engine, move } = owner();
		const probe = mock(async () => "available" as const);
		const request = { kind: "read" as const, bindingId: "binding" };
		expect(
			(await queryMusicGrid({ engine, request, sourceAvailability: probe }))
				.projectName,
		).toBe("First");
		move();
		expect(
			(await queryMusicGrid({ engine, request, sourceAvailability: probe }))
				.projectName,
		).toBe("Second");
		expect(probe).toHaveBeenLastCalledWith({
			assetId: "song-source",
			sourceSha256: "a".repeat(64),
		});
	});
	test("missing, offline and unknown sources cannot be returned as a live grid", async () => {
		const { engine } = owner();
		const request = { kind: "list" as const, bindingId: "binding" };
		expect((await queryMusicGrid({ engine, request })).status).toBe(
			"unavailable",
		);
		for (const state of ["unknown", "unavailable"] as const) {
			expect(
				(
					await queryMusicGrid({
						engine,
						request,
						sourceAvailability: async () => state,
					})
				).status,
			).toBe("unavailable");
		}
	});
	test("an async availability probe cannot publish a snapshot after its owner revision changed", async () => {
		const { engine, move } = owner();
		const result = await queryMusicGrid({
			engine,
			request: { kind: "snap", bindingId: "binding", maxDistanceTicks: 0 },
			sourceAvailability: async () => {
				move();
				return "available";
			},
		});
		expect(result.status).toBe("conflict");
	});
}
