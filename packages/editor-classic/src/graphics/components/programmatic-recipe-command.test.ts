import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { recipeSource, changedRecipe } from "./programmatic-recipe-fixture";

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
