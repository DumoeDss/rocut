import { expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
import { projectFixture } from "../../../editor/transactions/opencut/__tests__/fixture";
import { ReorderClipEffectsCommand } from "../../../commands/timeline/element/effects/reorder-effect";
import { ToggleTrackMuteCommand } from "../../../commands/timeline/track/toggle-track-mute";
import { clipId } from "@opencut/editor-contracts";
import { mediaTimeFromSeconds } from "../../../wasm";
import { CreateSceneCommand } from "../../../commands/scene/create-scene";
import { SwitchSceneCommand } from "../../../commands/scene/switch-scene";

test("effect order undo/redo preserves an unrelated Agent text edit", async () => {
	const project = projectFixture();
	project.scenes[0].tracks.overlay.push({
		id: "text",
		name: "Text",
		type: "text",
		hidden: false,
		elements: [
			{
				id: "title",
				name: "Title",
				type: "text",
				startTime: mediaTimeFromSeconds({ seconds: 0 }),
				duration: mediaTimeFromSeconds({ seconds: 1 }),
				trimStart: mediaTimeFromSeconds({ seconds: 0 }),
				trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
				params: { content: "original" },
				effects: [
					{
						id: "blur-a",
						type: "blur",
						enabled: true,
						params: { intensity: 10 },
					},
					{
						id: "blur-b",
						type: "blur",
						enabled: true,
						params: { intensity: 20 },
					},
				],
			},
		],
	});
	const h = await commandHarness(project);
	await h.command.execute({
		command: new ReorderClipEffectsCommand({
			trackId: "text",
			elementId: "title",
			fromIndex: 0,
			toIndex: 1,
		}),
	});
	const clip = (await h.transactions.clips())[0];
	await h.transactions.apply({
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("title"),
				patch: {
					editing: { ...clip.editing!, params: { content: "Agent text" } },
				},
			},
		],
	});
	await h.command.travelHistory({ direction: "undo", expectedRevision: 2 });
	let edited = (await h.transactions.clips())[0].editing!;
	expect(edited.effects?.map((effect) => effect.id)).toEqual([
		"blur-a",
		"blur-b",
	]);
	expect(edited.params.content).toBe("Agent text");
	await h.command.travelHistory({ direction: "redo", expectedRevision: 3 });
	edited = (await h.transactions.clips())[0].editing!;
	expect(edited.effects?.map((effect) => effect.id)).toEqual([
		"blur-b",
		"blur-a",
	]);
	expect(edited.params.content).toBe("Agent text");
});

test("UI mute publishes one revision and is undone through the same Agent history", async () => {
	const h = await commandHarness();
	await h.command.execute({
		command: new ToggleTrackMuteCommand("main-track"),
	});
	expect(await h.transactions.revision()).toBe(1);
	expect((await h.transactions.tracks())[0].muted).toBe(true);
	await h.command.travelHistory({ direction: "undo", expectedRevision: 1 });
	expect((await h.transactions.tracks())[0].muted).toBe(false);
});

test("UI scene create/switch publish topology visible to Agents and undo on the real stack", async () => {
	const h = await commandHarness();
	const create = new CreateSceneCommand({ name: "Second" });
	await h.command.execute({ command: create });
	const id = create.getSceneId();
	expect((await h.transactions.project())?.sceneState?.scenes).toHaveLength(2);
	await h.command.execute({ command: new SwitchSceneCommand(id) });
	expect((await h.transactions.project())?.sceneState?.currentSceneId).toBe(id);
	await h.command.travelHistory({ direction: "undo", expectedRevision: 2 });
	expect((await h.transactions.project())?.sceneState?.currentSceneId).toBe(
		"scene-main",
	);
	await h.command.travelHistory({ direction: "undo", expectedRevision: 3 });
	expect((await h.transactions.project())?.sceneState?.scenes).toHaveLength(1);
});
