import { expect, test } from "bun:test";
import { projectId, revisionOf, trackId } from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import { projectFixture } from "../../../editor/transactions/opencut/__tests__/fixture";
import { UpdateProjectSettingsCommand } from "../../../commands/project/update-project-settings";
import { TracksSnapshotCommand } from "../../../commands/timeline/tracks-snapshot";
import { mediaTimeFromSeconds } from "../../../wasm";

test("background edits share transaction revision, rejection, and actual UI history", async () => {
	const h = await commandHarness();
	await h.command.execute({
		command: new UpdateProjectSettingsCommand({
			background: { type: "blur", blurIntensity: 200 },
		}),
	});
	expect(await h.transactions.revision()).toBe(1);
	expect((await h.transactions.project())?.background).toEqual({
		type: "blur",
		blurIntensity: 200,
	});
	await h.command.travelHistory({ direction: "undo", expectedRevision: 1 });
	expect(h.getProject().settings.background).toEqual({
		type: "color",
		color: "#000000",
	});
	await h.transactions.apply({
		expectedRevision: revisionOf(2),
		operations: [
			{
				kind: "update-project",
				projectId: projectId(h.getProject().metadata.id),
				patch: {
					background: {
						type: "color",
						color: "linear-gradient(90deg, #123456, #abcdef)",
					},
				},
			},
		],
	});
	const stored = await h.fixture.store.load({ id: h.getProject().metadata.id });
	await expect(
		h.transactions.apply({
			operations: [
				{
					kind: "update-project",
					projectId: projectId(h.getProject().metadata.id),
					patch: { background: { type: "blur", blurIntensity: -1 } },
				},
			],
		}),
	).rejects.toThrow();
	expect(
		await h.fixture.store.load({ id: h.getProject().metadata.id }),
	).toEqual(stored);
});

test("UI and Agent track ordering persists; undo preserves an unrelated Agent edit", async () => {
	const project = projectFixture();
	for (const id of ["top", "bottom"])
		project.scenes[0].tracks.overlay.push({
			id,
			name: id,
			type: "text",
			hidden: false,
			elements: [
				{
					id: `${id}-title`,
					name: id,
					type: "text",
					params: { content: id },
					startTime: mediaTimeFromSeconds({ seconds: 0 }),
					duration: mediaTimeFromSeconds({ seconds: 1 }),
					trimStart: mediaTimeFromSeconds({ seconds: 0 }),
					trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
				},
			],
		});
	const h = await commandHarness(project);
	const before = h.getScenes()[0].tracks;
	await h.command.execute({
		command: new TracksSnapshotCommand({
			before,
			after: { ...before, overlay: [...before.overlay].reverse() },
		}),
	});
	expect(h.getScenes()[0].tracks.overlay.map((track) => track.id)).toEqual([
		"bottom",
		"top",
	]);
	await h.transactions.apply({
		operations: [
			{
				kind: "update-track",
				trackId: trackId("top"),
				patch: { name: "Agent renamed" },
			},
		],
	});
	await h.command.travelHistory({ direction: "undo", expectedRevision: 2 });
	expect(h.getScenes()[0].tracks.overlay.map((track) => track.id)).toEqual([
		"top",
		"bottom",
	]);
	expect(h.getScenes()[0].tracks.overlay[0].name).toBe("Agent renamed");
	await h.transactions.apply({
		operations: [
			{
				kind: "reorder-tracks",
				trackIds: [trackId("bottom"), trackId("top"), trackId("main-track")],
			},
		],
	});
	expect(h.getScenes()[0].tracks.overlay.map((track) => track.id)).toEqual([
		"bottom",
		"top",
	]);
	const stored = await h.fixture.store.load({ id: project.metadata.id });
	for (const ids of [
		["bottom", "top"],
		["top", "top", "main-track"],
		["missing", "top", "main-track"],
	]) {
		await expect(
			h.transactions.apply({
				operations: [{ kind: "reorder-tracks", trackIds: ids.map(trackId) }],
			}),
		).rejects.toThrow();
	}
	expect(await h.fixture.store.load({ id: project.metadata.id })).toEqual(
		stored,
	);
	await h.transactions.open({ projectId: project.metadata.id, assets: [] });
	expect((await h.transactions.tracks()).map((track) => track.id)).toEqual([
		"bottom",
		"top",
		"main-track",
	]);
});
