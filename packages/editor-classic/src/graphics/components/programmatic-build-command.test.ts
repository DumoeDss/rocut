import { expect, test } from "bun:test";
import {
	isProgrammaticSource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import { commandHarness } from "../../core/managers/__tests__/command-test-harness";
const { ProgrammaticBuildCommand } =
	await import("./programmatic-build-command");
const { InsertElementCommand } =
	await import("../../commands/timeline/element/insert-element");
const { UpdateElementsCommand } =
	await import("../../commands/timeline/element/update-elements");
const { mediaTime } = await import("../../wasm");

// Command-only descriptors: no compiler, attachment bytes, or archive-integrity
// acceptance is claimed. The harness stubs GPU/media, not the Rust validator.
function compiledSource(label: "old" | "new" | "external"): ProgrammaticSource {
	const sha256 = { old: "a", new: "b", external: "c" }[label].repeat(64);
	const input = {
		id: "index.tsx",
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 1,
		sha256,
		attachmentKey: `programmatic-source-sha256-${sha256}`,
	};
	return {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "compiled.html",
		width: 64,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 90,
		seed: 7,
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
			inputProps: { title: label },
			inputs: [input],
			toolchainLock: { ...input, id: "_rocut/toolchain-lock.json" },
		},
	};
}

async function setup() {
	const h = await commandHarness();
	const source = compiledSource("old");
	const replacement = compiledSource("new");
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			name: "Compiled fixture",
			definitionId: "programmatic",
			params: { opacity: 0.75 },
			programmatic: source,
			startTime: mediaTime({ ticks: 120000 }),
			duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 4000 }),
			trimEnd: mediaTime({ ticks: 8000 }),
			effects: [
				{
					id: "clip-blur",
					type: "blur",
					params: { intensity: 12 },
					enabled: true,
				},
			],
		},
		placement: { mode: "auto", trackType: "graphic" },
	});
	await h.command.execute({ command: insert });
	const trackId = insert.getTrackId();
	if (!trackId) throw Error("Missing compiled fixture track");
	const elementId = insert.getElementId();
	const current = () => {
		const element = h
			.getScenes()[0]
			.tracks.overlay.find((track) => track.id === trackId)
			?.elements.find((element) => element.id === elementId);
		if (element?.type !== "graphic" || !element.programmatic)
			throw Error("Missing compiled fixture clip");
		return element;
	};
	const options = {
		projectId: h.getProject().metadata.id,
		sceneId: h.getScenes()[0].id,
		trackId,
		elementId,
		baseline: source,
		replacement,
	};
	const buildCommand = (patch: Partial<typeof options> = {}) =>
		new ProgrammaticBuildCommand({ ...options, ...patch });
	const record = () => h.fixture.store.load({ id: options.projectId });
	return {
		...h,
		source,
		replacement,
		trackId,
		elementId,
		current,
		buildCommand,
		record,
	};
}

test("compiled replacement is a durable undo/redo edit preserving all non-source clip fields", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	await h.command.execute({ command: h.buildCommand() });
	expect(h.current()).toEqual({ ...before, programmatic: h.replacement });
	expect(h.command.getHistoryCount()).toBe(2);
	expect(Number(await h.transactions.revision())).toBe(2);
	const committed = await h.record();
	expect(JSON.stringify(committed)).toContain(
		h.replacement.resources![0].sha256,
	);
	expect(JSON.stringify(committed)).not.toContain(
		h.source.resources![0].sha256,
	);
	await h.command.undo();
	expect(h.current()).toEqual(before);
	expect(h.command.canRedo()).toBe(true);
	expect(JSON.stringify(await h.record())).toContain(
		h.source.resources![0].sha256,
	);
	await h.command.redo();
	expect(h.current()).toEqual({ ...before, programmatic: h.replacement });
	expect(h.command.canRedo()).toBe(false);
	expect(h.fixture.getSaveCount()).toBe(4);
	expect(Number(await h.transactions.revision())).toBe(4);
});

test("queued compiled replacement rechecks the baseline after a preceding source commit", async () => {
	const h = await setup();
	const planned = h.buildCommand();
	const externalSource = compiledSource("external");
	const paused = h.fixture.control.pauseNext({ operation: "save-project" });
	const external = h.command.execute({
		command: new UpdateElementsCommand({
			updates: [
				{
					trackId: h.trackId,
					elementId: h.elementId,
					patch: { programmatic: externalSource },
				},
			],
		}),
	});
	await paused.entered;
	const pending = h.command.execute({ command: planned });
	paused.release();
	await external;
	await expect(pending).rejects.toThrow("source changed outside this draft");
	expect(h.current().programmatic).toEqual(externalSource);
	expect(h.command.getHistoryCount()).toBe(2);
	expect(h.fixture.getSaveCount()).toBe(2);
	expect(Number(await h.transactions.revision())).toBe(2);
	await h.command.undo();
	expect(h.current().programmatic).toEqual(h.source);
});

test("wrong project/scene or missing target refuses compiled replacement without a save/history entry", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	const persisted = await h.record();
	for (const [patch, message] of [
		[{ projectId: "other-project" }, "project or scene changed"],
		[{ sceneId: "other-scene" }, "project or scene changed"],
		[{ trackId: "missing-track" }, "compiled clip is no longer available"],
		[{ elementId: "missing-clip" }, "compiled clip is no longer available"],
	] as const) {
		await expect(
			h.command.execute({ command: h.buildCommand(patch) }),
		).rejects.toThrow(message);
		expect(h.current()).toEqual(before);
		expect(await h.record()).toEqual(persisted);
		expect(h.command.getHistoryCount()).toBe(1);
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(Number(await h.transactions.revision())).toBe(1);
	}
});

test("compiled replacement refuses a changed or missing authoring engine", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	const build = h.replacement.build!;
	const { compositionId: _compositionId, ...threeBuild } = build;
	for (const replacement of [
		{ ...h.replacement, build: { ...threeBuild, engine: "three" as const } },
		{ ...h.replacement, build: undefined },
	]) {
		await expect(
			h.command.execute({ command: h.buildCommand({ replacement }) }),
		).rejects.toThrow("retain its authoring engine");
		expect(h.current()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(1);
		expect(h.fixture.getSaveCount()).toBe(1);
	}
});

test("real Rust rejects structurally typed but semantically invalid rebuilt sources before saving/history", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	const persisted = await h.record();
	for (const replacement of [
		{ ...h.replacement, width: 0 },
		{ ...h.replacement, durationFrames: 1 },
		{ ...h.replacement, seed: -1 },
		{ ...h.replacement, resources: [] },
		{
			...h.replacement,
			build: { ...h.replacement.build!, entryFile: "missing.tsx" },
		},
	]) {
		expect(isProgrammaticSource(replacement)).toBe(true);
		await expect(
			h.command.execute({ command: h.buildCommand({ replacement }) }),
		).rejects.toBeDefined();
		expect(h.current()).toEqual(before);
		expect(await h.record()).toEqual(persisted);
		expect(h.command.getHistoryCount()).toBe(1);
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(Number(await h.transactions.revision())).toBe(1);
	}
});

test("failed save preserves old source and existing redo rather than publishing the rejected replacement", async () => {
	const h = await setup();
	await h.command.execute({ command: h.buildCommand() });
	await h.command.undo();
	const before = structuredClone(h.current());
	const persisted = await h.record();
	const revision = await h.transactions.revision();
	const history = h.command.getHistoryCount();
	expect(h.command.canRedo()).toBe(true);
	h.fixture.control.failNext({
		operation: "save-project",
		code: "unavailable",
	});
	await expect(
		h.command.execute({
			command: h.buildCommand({ replacement: compiledSource("external") }),
		}),
	).rejects.toBeDefined();
	expect(h.current()).toEqual(before);
	expect(await h.record()).toEqual(persisted);
	expect(await h.transactions.revision()).toBe(revision);
	expect(h.command.getHistoryCount()).toBe(history);
	expect(h.command.canRedo()).toBe(true);
	await h.command.redo();
	expect(h.current()).toEqual({ ...before, programmatic: h.replacement });
	expect(h.command.canRedo()).toBe(false);
});
