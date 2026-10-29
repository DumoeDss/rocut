import { expect, test } from "bun:test";
import {
	projectId,
	revisionOf,
	type MusicGridState,
} from "@opencut/editor-contracts";
import {
	openTransactionEngine,
	type TransactionEngine,
} from "@opencut/editor-contracts/engine";
import { planDraftCompensatingOperations } from "@opencut/editor-contracts/draft";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";
import {
	decodeProject,
	encodeProject,
} from "../../../persistence/project-codec";
import { projectFixture } from "./fixture";
import { isMusicGridAvailable, queryMusicGrid } from "../music-grid";

// Fixed reviewed state checks transport/save/undo. Rust integration tests own musical legality.
const gridState: MusicGridState = {
	version: 1,
	grids: [
		{
			id: "grid-fixture",
			revision: 1,
			mode: "manual",
			assetId: "song-source",
			sourceSha256: "a".repeat(64),
			sourceDurationTick: 240000,
			reviewReference: "fixture reviewed",
			analysisProvenance: null,
			points: [{ id: "beat-0", sourceTick: 0 }],
			meterSegments: [
				{
					id: "meter-six",
					sourceStartTick: 0,
					sourceEndTick: 240000,
					meter: { numerator: 6, denominator: 8 },
					beatUnit: { numerator: 1, denominator: 8 },
					phaseQuarterNotes: { numerator: 5, denominator: 2 },
					barNumber: 0,
					confidence: 0.9,
				},
			],
		},
	],
	bindings: [
		{
			id: "binding-fixture",
			gridId: "grid-fixture",
			clipId: "song-clip",
			assetId: "song-source",
			sceneId: "scene-main",
		},
	],
};
async function snapshot(engine: TransactionEngine) {
	return {
		project: await engine.project(),
		tracks: await engine.tracks(),
		clips: await engine.clips(),
		assets: await engine.assets(),
		markers: await engine.markers(),
		motionTextSequences: await engine.motionTextSequences?.(),
		revision: await engine.revision(),
	};
}
test("music grid enters existing save, reopen and compensating undo without touching existing sequences", async () => {
	const { store } = await storeFixture();
	const open = async () => {
		const record = await store.load({ id: TEST_PROJECT_ID });
		if (!record) throw Error("Missing fixture");
		return openTransactionEngine({
			store,
			projectId: TEST_PROJECT_ID,
			placementPolicies: [{ validatesMusicGrids: true, evaluate: () => [] }],
			documentAdapter: createOpenCutTransactionDocumentAdapter({
				initialRecord: record,
				initialAssets: [],
				validateEditing: () => [],
			}),
		});
	};
	const engine = await open();
	const before = await snapshot(engine);
	const operation = {
		kind: "update-project" as const,
		projectId: projectId(TEST_PROJECT_ID),
		patch: { musicGridState: gridState },
	};
	await engine.apply({
		expectedRevision: revisionOf(0),
		operations: [operation],
	});
	const persisted = await store.load({ id: TEST_PROJECT_ID });
	expect(decodeProject(persisted?.data).musicGridState).toEqual(gridState);
	const reopened = await open();
	expect((await reopened.project())?.musicGridState).toEqual(gridState);
	const after = await snapshot(reopened);
	expect(after.motionTextSequences).toEqual(before.motionTextSequences);
	const inverse = planDraftCompensatingOperations({
		base: before,
		candidate: after,
		operations: [operation],
	});
	expect(inverse).toEqual([
		{
			kind: "update-project",
			projectId: projectId(TEST_PROJECT_ID),
			patch: { musicGridState: null },
		},
	]);
	await reopened.apply({
		expectedRevision: after.revision,
		operations: inverse,
	});
	expect((await reopened.project())?.musicGridState).toBeUndefined();
	expect(
		decodeProject((await store.load({ id: TEST_PROJECT_ID }))?.data)
			.musicGridState,
	).toBeUndefined();
	await expect(
		reopened.apply({
			expectedRevision: after.revision,
			operations: [operation],
		}),
	).rejects.toThrow();
});
test("raw grid transactions require the native host policy before persistence", async () => {
	const { store } = await storeFixture();
	const record = await store.load({ id: TEST_PROJECT_ID });
	if (!record) throw Error("Missing fixture");
	const engine = await openTransactionEngine({
		store,
		projectId: TEST_PROJECT_ID,
		documentAdapter: createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: [],
			validateEditing: () => [],
		}),
	});
	await expect(
		engine.apply({
			expectedRevision: revisionOf(0),
			operations: [
				{
					kind: "update-project",
					projectId: projectId(TEST_PROJECT_ID),
					patch: { musicGridState: gridState },
				},
			],
		}),
	).rejects.toThrow();
	expect(await engine.revision()).toBe(revisionOf(0));
	expect((await engine.project())?.musicGridState).toBeUndefined();
	expect(
		decodeProject((await store.load({ id: TEST_PROJECT_ID }))?.data)
			.musicGridState,
	).toBeUndefined();
});
test("codec replaces retained grid state, detaches data and preserves legacy omission", () => {
	const project = projectFixture();
	const legacy = encodeProject({ project, retained: {} });
	expect(decodeProject(legacy).musicGridState).toBeUndefined();
	project.musicGridState = structuredClone(gridState);
	const retained = encodeProject({ project, retained: legacy });
	project.musicGridState = { version: 1, grids: [], bindings: [] };
	const empty = encodeProject({ project, retained });
	expect(decodeProject(empty).musicGridState).toEqual(project.musicGridState);
	expect(decodeProject(retained).musicGridState).toEqual(gridState);
	delete project.musicGridState;
	expect(
		decodeProject(encodeProject({ project, retained })).musicGridState,
	).toBeUndefined();
});
test("older WASM explicitly exposes unavailable music grid rather than guessing in TypeScript", async () => {
	if (isMusicGridAvailable()) return;
	const result = await queryMusicGrid({
		engine: {
			project: async () => null,
			tracks: async () => [],
			clips: async () => [],
			assets: async () => [],
			markers: async () => [],
			revision: async () => revisionOf(0),
		},
		request: { kind: "read", bindingId: "binding" },
	});
	expect(result.status).toBe("unavailable");
});
