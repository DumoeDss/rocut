import { expect, test } from "bun:test";
import {
	getRecipeDraft,
	ProgrammaticRecipeDraft,
	parseRecipeDraft,
	recipeReadOnlyReason,
} from "./programmatic-recipe-draft";
import { recipeSource, changedRecipe } from "./programmatic-recipe-fixture";

test("invalid JSON and failed async native/storage commits retain the draft", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	let calls = 0;
	for (const text of ["{broken", "null", "[]"]) {
		draft.edit(text);
		await draft.apply(async () => {
			calls++;
			return recipeSource;
		});
		expect(draft.getSnapshot()).toMatchObject({
			text,
			dirty: true,
			pending: false,
		});
		expect(draft.getSnapshot().error).toBeTruthy();
	}
	expect(calls).toBe(0);
	draft.edit(JSON.stringify(changedRecipe));
	await draft.apply(async () => {
		throw Error("Rust rejected recipe");
	});
	expect(draft.getSnapshot()).toMatchObject({
		text: JSON.stringify(changedRecipe),
		dirty: true,
		pending: false,
		error: "Rust rejected recipe",
	});
	// Parsing does not invent a second schema; invalid recipe objects reach Rust.
	expect(JSON.stringify(parseRecipeDraft('{"unknown":true}'))).toBe(
		'{"unknown":true}',
	);
});

test("selection retention is clip/session scoped and clean drafts are released", () => {
	const owner = {},
		key = "project/scene/track/clip";
	const a = getRecipeDraft({ owner, key, source: recipeSource });
	const stop = a.subscribe(() => {});
	a.edit("unsaved JSON");
	stop();
	expect(getRecipeDraft({ owner, key, source: recipeSource })).toBe(a);
	expect(
		getRecipeDraft({ owner, key: "other", source: recipeSource }),
	).not.toBe(a);
	expect(getRecipeDraft({ owner: {}, key, source: recipeSource })).not.toBe(a);
	a.discard();
	expect(getRecipeDraft({ owner, key, source: recipeSource })).not.toBe(a);
});

test("external source updates conflict without dropping edits; Discard follows latest source", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	draft.edit(JSON.stringify(changedRecipe));
	const latest = { ...recipeSource, seed: 8 };
	draft.refresh(latest);
	let calls = 0;
	await draft.apply(async () => {
		calls++;
		return latest;
	});
	expect(calls).toBe(0);
	expect(draft.getSnapshot().conflict).toBe(true);
	expect(draft.getSnapshot().text).toBe(JSON.stringify(changedRecipe));
	draft.discard();
	expect(draft.getSnapshot().baseline).toBe(latest);
	expect(draft.getSnapshot().dirty).toBe(false);
});

test("pending edits cannot overwrite a late external update or be discarded mid-commit", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource);
	const text = JSON.stringify(changedRecipe);
	draft.edit(text);
	let finish!: (source: typeof recipeSource) => void;
	const pending = draft.apply(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	draft.edit("lost");
	draft.discard();
	expect(draft.getSnapshot().text).toBe(text);
	const latest = { ...recipeSource, seed: 9 };
	draft.refresh(latest);
	finish({ ...recipeSource, recipe: changedRecipe });
	await pending;
	expect(draft.getSnapshot()).toMatchObject({
		text,
		dirty: true,
		conflict: true,
		pending: false,
	});
	draft.discard();
	expect(draft.getSnapshot().baseline).toBe(latest);
});

test("own successful publication and undo/redo update clean drafts; lost recipe is not editable", async () => {
	const draft = new ProgrammaticRecipeDraft(recipeSource),
		result = { ...recipeSource, recipe: changedRecipe };
	draft.edit(JSON.stringify(changedRecipe));
	await draft.apply(async () => {
		draft.refresh(result);
		return result;
	});
	expect(draft.getSnapshot()).toMatchObject({
		dirty: false,
		pending: false,
		baseline: result,
	});
	draft.refresh(recipeSource);
	expect(draft.getSnapshot().text).toBe(
		JSON.stringify(recipeSource.recipe, null, 2),
	);
	draft.refresh(result);
	expect(draft.getSnapshot().baseline).toBe(result);
	expect(
		recipeReadOnlyReason({ ...recipeSource, recipe: undefined }),
	).toContain("no longer");
});

test("recipe becoming inline or compiled retains old dirty text and never submits it", async () => {
	const input = {
		id: "index.tsx",
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 1,
		sha256: "b".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"b".repeat(64)}`,
	};
	const inline = {
		...recipeSource,
		recipe: undefined,
		code: "external inline",
	};
	const compiled = {
		...inline,
		runtime: "html-document" as const,
		code: "",
		documentId: "compiled.html",
		build: {
			version: 1 as const,
			engine: "remotion" as const,
			engineVersion: "4.0.440",
			entryFile: "index.tsx",
			compositionId: "Fixture",
			inputs: [input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
	for (const latest of [inline, compiled]) {
		const draft = new ProgrammaticRecipeDraft(recipeSource),
			text = JSON.stringify(changedRecipe);
		draft.edit(text);
		draft.refresh(latest);
		let commits = 0;
		await draft.apply(async () => {
			commits++;
			return latest;
		});
		expect(commits).toBe(0);
		expect(draft.getSnapshot()).toMatchObject({
			text,
			dirty: true,
			conflict: true,
			pending: false,
		});
		expect(recipeReadOnlyReason(latest)).toBeTruthy();
		draft.discard();
		expect(draft.getSnapshot().baseline).toBe(latest);
	}
});
