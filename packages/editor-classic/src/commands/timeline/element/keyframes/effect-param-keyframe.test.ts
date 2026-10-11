/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Narrow command collaborators and branded CPU fixture times. */
import { expect, test } from "bun:test";
import { effectsRegistry, registerDefaultEffects } from "../../../../effects";
import type { EditorCommandContext } from "../../../base-command";
import type { EffectElement, SceneTracks } from "../../../../timeline";
import { UpsertEffectParamKeyframeCommand } from "./upsert-effect-param-keyframe";
import { RemoveEffectParamKeyframeCommand } from "./remove-effect-param-keyframe";

registerDefaultEffects();
const definition = effectsRegistry
	.getAll()
	.find((effect) =>
		effect.params.some(
			(param) =>
				param.key === "amount" &&
				param.type === "number" &&
				param.keyframable !== false,
		),
	)!;
function effectFixture(): EffectElement {
	return {
		id: "standalone",
		type: "effect",
		name: "Effect",
		effectType: definition.type,
		startTime: 0 as never,
		duration: 120000 as never,
		trimStart: 0 as never,
		trimEnd: 0 as never,
		params: {
			...Object.fromEntries(
				definition.params.map((param) => [param.key, param.default]),
			),
			amount: 0.25,
		},
	};
}
function tracksFixture(): SceneTracks {
	return {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [
			{
				id: "fx",
				name: "FX",
				type: "effect",
				elements: [effectFixture()],
				hidden: false,
			},
		],
		audio: [],
	};
}
function upsert(effectId = "standalone", paramKey = "amount", value = 0.5) {
	return new UpsertEffectParamKeyframeCommand({
		trackId: "fx",
		elementId: "standalone",
		effectId,
		paramKey,
		time: 60000 as never,
		value,
		keyframeId: "key",
	});
}
function remove(effectId = "standalone", paramKey = "amount") {
	return new RemoveEffectParamKeyframeCommand({
		trackId: "fx",
		elementId: "standalone",
		effectId,
		paramKey,
		keyframeId: "key",
	});
}
test("named standalone commands create, modify, remove and undo the canonical channel", () => {
	let tracks = tracksFixture();
	const context = {
		editor: {
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				updateTracks: (next: SceneTracks) => {
					tracks = next;
				},
			},
		},
	} as unknown as EditorCommandContext;
	const current = () => tracks.overlay[0].elements[0] as EffectElement;
	const before = structuredClone(current());
	const create = upsert();
	create.execute(context);
	expect(Object.keys(current().animations!)).toEqual(["params.amount"]);
	expect(current().animations!["params.amount"].keys[0]).toMatchObject({
		id: "key",
		value: 0.5,
	});
	upsert("standalone", "amount", 0.75).execute(context);
	expect(current().animations!["params.amount"].keys).toHaveLength(1);
	expect(current().animations!["params.amount"].keys[0].value).toBe(0.75);
	const populated = structuredClone(current());
	remove("wrong-id").execute(context);
	expect(current()).toEqual(populated);
	const deletion = remove();
	deletion.execute(context);
	expect(current().animations?.["params.amount"]).toBeUndefined();
	deletion.undo(context);
	expect(current()).toEqual(populated);
	create.undo(context);
	expect(current()).toEqual(before);
	create.redo(context);
	expect(current().animations!["params.amount"].keys[0].value).toBe(0.5);
});
test("named standalone upsert rejects wrong ids and catalog static fields", () => {
	let tracks = tracksFixture();
	const before = structuredClone(tracks);
	const context = {
		editor: {
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				updateTracks: (next: SceneTracks) => {
					tracks = next;
				},
			},
		},
	} as unknown as EditorCommandContext;
	upsert("wrong-id").execute(context);
	upsert("standalone", "unknown").execute(context);
	for (const param of definition.params.filter(
		(param) => param.type !== "number" || param.keyframable === false,
	))
		upsert("standalone", param.key).execute(context);
	expect(tracks).toEqual(before);
});

test("named visual commands retain the effect-id-qualified channel", () => {
	let tracks = tracksFixture();
	tracks.overlay = [
		{
			id: "fx",
			name: "Graphic",
			type: "graphic",
			hidden: false,
			elements: [
				{
					...effectFixture(),
					type: "graphic",
					definitionId: "fixture",
					effects: [
						{
							id: "visual-effect",
							type: definition.type,
							enabled: true,
							params: { amount: 0.25 },
						},
					],
				},
			],
		},
	];
	const context = {
		editor: {
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				updateTracks: (next: SceneTracks) => {
					tracks = next;
				},
			},
		},
	} as unknown as EditorCommandContext;
	upsert("visual-effect").execute(context);
	expect(Object.keys(tracks.overlay[0].elements[0].animations!)).toEqual([
		"effects.visual-effect.params.amount",
	]);
	remove("visual-effect").execute(context);
	expect(
		tracks.overlay[0].elements[0].animations?.[
			"effects.visual-effect.params.amount"
		],
	).toBeUndefined();
});

const nativeTest = test.skipIf(
	process.env.ROCUT_RUN_RECIPE_COMMAND_TESTS !== "1",
);
nativeTest(
	"named standalone keyframes project through durable history and storage failure atomically",
	async () => {
		const { commandHarness } =
			await import("../../../../core/managers/__tests__/command-test-harness");
		const { projectFixture } =
			await import("../../../../editor/transactions/opencut/__tests__/fixture");
		const project = projectFixture();
		project.scenes[0].tracks = tracksFixture();
		const h = await commandHarness(project);
		const current = () =>
			h.getScenes()[0].tracks.overlay[0].elements[0] as EffectElement;
		const before = structuredClone(current());
		await h.command.execute({ command: upsert() });
		expect(current().animations!["params.amount"].keys[0].value).toBe(0.5);
		await h.command.undo();
		expect(current()).toEqual(before);
		await h.command.redo();
		expect(current().animations!["params.amount"].keys[0].value).toBe(0.5);
		await h.command.execute({ command: remove() });
		expect(current().animations?.["params.amount"]).toBeUndefined();
		await h.command.undo();
		const populated = structuredClone(current()),
			history = h.command.getHistoryCount();
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: remove() }),
		).rejects.toBeDefined();
		expect(current()).toEqual(populated);
		expect(h.command.getHistoryCount()).toBe(history);
		expect(h.fixture.getSaveCount()).toBeGreaterThanOrEqual(5);
	},
);
