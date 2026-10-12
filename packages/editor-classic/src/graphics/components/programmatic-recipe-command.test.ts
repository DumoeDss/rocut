import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { recipeSource, changedRecipe } from "./programmatic-recipe-fixture";

type MvPost = NonNullable<
	NonNullable<ProgrammaticSource["recipe"]>["post"]
>[number];

// Genuine Rust transaction/history harness; GPU/media collaborators only are
// stubbed by the existing harness. Root runs this with its private WASM preload.
const nativeTest = test.skipIf(
	process.env.ROCUT_RUN_RECIPE_COMMAND_TESTS !== "1",
);
async function setup(source: ProgrammaticSource = recipeSource) {
	const { commandHarness } =
		await import("../../core/managers/__tests__/command-test-harness");
	const { ProgrammaticRecipeCommand } =
		await import("./programmatic-recipe-command");
	const { InsertElementCommand } =
		await import("../../commands/timeline/element/insert-element");
	const { UpdateElementsCommand } =
		await import("../../commands/timeline/element/update-elements");
	const { mediaTime } = await import("../../wasm");
	const h = await commandHarness();
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			name: "Recipe",
			definitionId: "programmatic",
			params: { opacity: 0.75 },
			programmatic: source,
			startTime: mediaTime({ ticks: 0 }),
			duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 4000 }),
			trimEnd: mediaTime({ ticks: 0 }),
		},
		placement: { mode: "auto", trackType: "graphic" },
	});
	await h.command.execute({ command: insert });
	const trackId = insert.getTrackId(),
		elementId = insert.getElementId();
	if (!trackId) throw Error("Missing recipe track");
	const scope = {
		projectId: h.getProject().metadata.id,
		sceneId: h.getScenes()[0].id,
		trackId,
		elementId,
	};
	const current = () => {
		const element = h
			.getScenes()[0]
			.tracks.overlay.find((track) => track.id === trackId)
			?.elements.find((element) => element.id === elementId);
		if (element?.type !== "graphic" || !element.programmatic)
			throw Error("Missing recipe clip");
		return element;
	};
	const command = (
		patch: Partial<
			typeof scope & { baseline: ProgrammaticSource; text: string }
		> = {},
	) =>
		new ProgrammaticRecipeCommand({
			...scope,
			baseline: current().programmatic!,
			text: JSON.stringify(changedRecipe),
			...patch,
		});
	const external = (replacement: ProgrammaticSource) =>
		new UpdateElementsCommand({
			updates: [{ trackId, elementId, patch: { programmatic: replacement } }],
		});
	return { ...h, scope, current, recipeCommand: command, external };
}

nativeTest(
	"recipe Apply preserves source provenance and clip fields through durable undo/redo",
	async () => {
		const h = await setup(),
			before = structuredClone(h.current());
		await h.command.execute({ command: h.recipeCommand() });
		expect(h.current()).toEqual({
			...before,
			programmatic: { ...recipeSource, recipe: changedRecipe },
		});
		await h.command.undo();
		expect(h.current()).toEqual(before);
		await h.command.redo();
		expect(h.current().programmatic?.recipe).toEqual(changedRecipe);
		expect(h.fixture.getSaveCount()).toBe(4);
	},
);

nativeTest(
	"structured transition and post edits share one durable recipe transaction",
	async () => {
		const { getMvRecipeCatalog } =
			await import("../../editor/transactions/opencut/mv-recipe-catalog");
		const { editRecipeTransitionParameter } =
			await import("./programmatic-recipe-transition-data");
		const { changePostCurves } =
			await import("./programmatic-recipe-post-automation-data");
		const { editPostDraft } = await import("./programmatic-recipe-post-data");
		const catalog = getMvRecipeCatalog();
		expect(catalog.post.length).toBe(15);
		expect(new Set(catalog.post).size).toBe(15);
		const source: ProgrammaticSource = {
			...recipeSource,
			recipe: {
				...recipeSource.recipe!,
				nodes: [
					{
						id: "a",
						scene: { kind: "solid", role: "background", color: [1, 0, 0, 1] },
					},
					{
						id: "b",
						scene: { kind: "solid", role: "background", color: [0, 0, 1, 1] },
					},
					{
						id: "root",
						scene: {
							kind: "transition",
							from: "a",
							to: "b",
							span: { startFrame: 0, durationFrames: 90 },
							easing: "linear",
							style: {
								kind: "peel",
								direction: "left",
								curl: 0.17,
								segments: 16,
								shading: 0.5,
								perspective: 0.5,
							},
						},
					},
				],
				post: [
					{
						roles: ["background"],
						effects: [{ kind: "vignette", amount: 0.2 }],
					},
				],
			},
		};
		const h = await setup(source),
			before = structuredClone(h.current());
		const text = editRecipeTransitionParameter({
			text: JSON.stringify(source.recipe),
			transitionParameters: catalog.extensions.transitionParameters,
			index: 2,
			key: "curl",
			value: 0.25,
		});
		if (!text) throw Error("Real catalog did not admit Peel field editing");
		const recipe = JSON.parse(text);
		const post = changePostCurves(
			recipe.post[0],
			[
				{
					effect: 0,
					keyframes: [
						{ frame: 0, value: 0.1, easing: "linear" },
						{ frame: 90, value: 0.8, easing: "inOutSine" },
					],
				},
			],
			source.durationFrames,
			catalog.finishing.effects,
			catalog.postAutomation,
			false,
		);
		if (!post) throw Error("Real catalog did not admit amount authoring");
		const edited = editPostDraft(text, 0, post, false);
		if (!edited) throw Error("Post edit did not produce a recipe draft");
		const history = h.command.getHistoryCount();
		await h.command.execute({ command: h.recipeCommand({ text: edited }) });
		expect(h.command.getHistoryCount()).toBe(history + 1);
		expect(h.current()).toEqual({
			...before,
			programmatic: { ...source, recipe: JSON.parse(edited) },
		});
		await h.command.undo();
		expect(h.current()).toEqual(before);
		await h.command.redo();
		expect(h.current().programmatic?.recipe).toEqual(JSON.parse(edited));
		expect(h.fixture.getSaveCount()).toBe(4);
		const rejected = JSON.parse(edited);
		rejected.post[0].automation[0].keyframes[1].value = 1.1;
		const after = structuredClone(h.current()),
			afterHistory = h.command.getHistoryCount();
		await expect(
			h.command.execute({
				command: h.recipeCommand({ text: JSON.stringify(rejected) }),
			}),
		).rejects.toBeDefined();
		expect(h.current()).toEqual(after);
		expect(h.command.getHistoryCount()).toBe(afterHistory);
	},
);

nativeTest(
	"post group creation and binding-safe effect order share real admission and history",
	async () => {
		const { getMvRecipeCatalog } =
			await import("../../editor/transactions/opencut/mv-recipe-catalog");
		const {
			editPostCollection,
			newPostEffect,
			newPostGroup,
			postRoleChoices,
			remapPostEffects,
		} = await import("./programmatic-recipe-post-collection-data");
		const catalog = getMvRecipeCatalog();
		const effect = newPostEffect(
			"vignette",
			{ amount: 0.3 },
			catalog.finishing.effects,
		);
		if (!effect) throw Error("Actual catalog refused new vignette");
		const group = newPostGroup({
			stage: "role",
			roles: ["background"],
			effect,
			postStages: catalog.postStages,
			roleChoices: postRoleChoices(catalog.extensions.sceneParameters ?? {}),
		});
		if (!group) throw Error("Actual catalog refused new role post");
		const expectedGroup: MvPost = {
			stage: "role",
			roles: ["background"],
			effects: [{ kind: "vignette", amount: 0.3 }],
		};
		expect(group).toEqual(expectedGroup);
		const h = await setup(),
			before = structuredClone(h.current());
		const text = editPostCollection(
			JSON.stringify(recipeSource.recipe),
			[group],
			false,
		)!;
		await h.command.execute({ command: h.recipeCommand({ text }) });
		expect(h.current().programmatic?.recipe?.post).toEqual([expectedGroup]);
		const grain = newPostEffect(
			"grain",
			{ amount: 0.5, fps: 24 },
			catalog.finishing.effects,
		);
		if (!grain) throw Error("Actual catalog refused new grain");
		const post = {
			...group,
			effects: [effect, grain],
			automation: [
				{ effect: 0, keyframes: [{ frame: 0, value: 0.1, easing: "linear" }] },
			],
		};
		const moved = remapPostEffects(post, [1, 0], false)!;
		const expectedMoved: MvPost = {
			stage: "role",
			roles: ["background"],
			effects: [
				{ kind: "grain", amount: 0.5, fps: 24 },
				{ kind: "vignette", amount: 0.3 },
			],
			automation: [
				{ effect: 1, keyframes: [{ frame: 0, value: 0.1, easing: "linear" }] },
			],
		};
		expect(moved).toEqual(expectedMoved);
		const edited = editPostCollection(text, [moved], false)!;
		await h.command.execute({ command: h.recipeCommand({ text: edited }) });
		expect(h.current().programmatic?.recipe?.post).toEqual([expectedMoved]);
		expect(
			h.current().programmatic?.recipe?.post?.[0]?.automation?.[0]?.effect,
		).toBe(1);
		await h.command.undo();
		expect(h.current().programmatic?.recipe?.post).toEqual([expectedGroup]);
		await h.command.undo();
		expect(h.current()).toEqual(before);
		await h.command.redo();
		await h.command.redo();
		expect(h.current().programmatic?.recipe?.post).toEqual([expectedMoved]);
		const after = structuredClone(h.current()),
			history = h.command.getHistoryCount();
		const oversize = editPostCollection(
			edited,
			Array.from({ length: 9 }, () => group),
			false,
		)!;
		await expect(
			h.command.execute({ command: h.recipeCommand({ text: oversize }) }),
		).rejects.toBeDefined();
		expect(h.current()).toEqual(after);
		expect(h.command.getHistoryCount()).toBe(history);
	},
);

nativeTest(
	"invalid JSON, native recipe rejection and storage failure never publish or add history",
	async () => {
		const h = await setup(),
			before = structuredClone(h.current()),
			history = h.command.getHistoryCount();
		for (const text of [
			"{invalid",
			"{}",
			JSON.stringify({ ...changedRecipe, root: "missing" }),
		])
			await expect(
				h.command.execute({ command: h.recipeCommand({ text }) }),
			).rejects.toBeDefined();
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: h.recipeCommand() }),
		).rejects.toBeDefined();
		expect(h.current()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(history);
	},
);

nativeTest(
	"queued recipe Apply rechecks current source after a preceding external transaction",
	async () => {
		const h = await setup(),
			paused = h.fixture.control.pauseNext({ operation: "save-project" });
		const external = h.command.execute({
			command: h.external({ ...recipeSource, seed: 8 }),
		});
		await paused.entered;
		const apply = h.command.execute({ command: h.recipeCommand() });
		paused.release();
		await external;
		await expect(apply).rejects.toThrow("source changed outside this draft");
		expect(h.current().programmatic?.seed).toBe(8);
		expect(h.command.getHistoryCount()).toBe(2);
	},
);

nativeTest(
	"transaction scope checks reject a different project, scene or clip",
	async () => {
		const h = await setup(),
			before = structuredClone(h.current()),
			history = h.command.getHistoryCount();
		for (const patch of [
			{ projectId: "other-project" },
			{ sceneId: "other-scene" },
			{ trackId: "other-track" },
			{ elementId: "other-clip" },
		])
			await expect(
				h.command.execute({ command: h.recipeCommand(patch) }),
			).rejects.toBeDefined();
		expect(h.current()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(history);
	},
);

nativeTest(
	"compiled source cannot be changed into a recipe by this command",
	async () => {
		const sha256 = "b".repeat(64),
			input = {
				id: "index.tsx",
				kind: "source" as const,
				mimeType: "application/octet-stream",
				byteLength: 1,
				sha256,
				attachmentKey: `programmatic-source-sha256-${sha256}`,
			};
		const source: ProgrammaticSource = {
			...recipeSource,
			recipe: undefined,
			runtime: "html-document",
			code: "",
			documentId: "compiled.html",
			resources: [
				{
					id: "compiled.html",
					kind: "document",
					mimeType: "text/html",
					byteLength: 1,
					sha256,
					attachmentKey: `programmatic-sha256-${sha256}`,
				},
			],
			build: {
				version: 1,
				engine: "remotion",
				engineVersion: "4.0.440",
				compositionId: "Fixture",
				entryFile: "index.tsx",
				inputs: [input],
				toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
			},
		};
		const h = await setup(source),
			before = structuredClone(h.current());
		await expect(
			h.command.execute({ command: h.recipeCommand() }),
		).rejects.toThrow("Compiled sources");
		expect(h.current()).toEqual(before);
	},
);
