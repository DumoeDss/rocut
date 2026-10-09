import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { commandHarness } from "../../core/managers/__tests__/command-test-harness";
const { ProgrammaticSourceCommand } =
	await import("./programmatic-source-command");
const { InsertElementCommand } =
	await import("../../commands/timeline/element/insert-element");
const { UpdateElementsCommand } =
	await import("../../commands/timeline/element/update-elements");
const { mediaTime } = await import("../../wasm");

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "canvas.getContext('2d').fillRect(0,0,32,32)",
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 90,
	seed: 7,
	resources: [
		{
			id: "original.png",
			kind: "image",
			mimeType: "image/png",
			byteLength: 100,
			sha256: "a".repeat(64),
			attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		},
	],
};

async function setup() {
	const h = await commandHarness();
	const insert = new InsertElementCommand({
		element: {
			type: "graphic",
			name: "Source",
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
	const trackId = insert.getTrackId();
	if (!trackId) throw new Error("Missing source track");
	const elementId = insert.getElementId();
	const current = () => {
		const element = h
			.getScenes()[0]
			.tracks.overlay.find((track) => track.id === trackId)
			?.elements.find((element) => element.id === elementId);
		if (element?.type !== "graphic" || !element.programmatic)
			throw new Error("Missing source");
		return element;
	};
	const command = (
		patch: { code?: string; seed?: string; baseline?: ProgrammaticSource } = {},
	) =>
		new ProgrammaticSourceCommand({
			projectId: h.getProject().metadata.id,
			sceneId: h.getScenes()[0].id,
			trackId,
			elementId,
			baseline: patch.baseline ?? source,
			code: patch.code ?? "canvas.width = 48;",
			seed: patch.seed ?? "9",
		});
	return { ...h, trackId, elementId, current, sourceCommand: command };
}

test("Apply uses durable Rust-validated history and preserves unrelated source/clip fields", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	await h.command.execute({ command: h.sourceCommand() });
	expect(h.current()).toEqual({
		...before,
		programmatic: { ...source, code: "canvas.width = 48;", seed: 9 },
	});
	await h.command.undo();
	expect(h.current()).toEqual(before);
	await h.command.redo();
	expect(h.current().programmatic?.seed).toBe(9);
	expect(h.fixture.getSaveCount()).toBe(4);
});

test("Rust source rejection and failed storage leave source and history intact", async () => {
	const h = await setup();
	const before = structuredClone(h.current());
	const history = h.command.getHistoryCount();
	for (const patch of [{ code: "" }, { seed: "-1" }, { seed: "4294967296" }]) {
		await expect(
			h.command.execute({ command: h.sourceCommand(patch) }),
		).rejects.toBeDefined();
	}
	h.fixture.control.failNext({
		operation: "save-project",
		code: "unavailable",
	});
	await expect(
		h.command.execute({ command: h.sourceCommand() }),
	).rejects.toBeDefined();
	expect(h.current()).toEqual(before);
	expect(h.command.getHistoryCount()).toBe(history);
});

test("queued Apply rechecks baseline after the preceding source edit commits", async () => {
	const h = await setup();
	const paused = h.fixture.control.pauseNext({ operation: "save-project" });
	const external = h.command.execute({
		command: new UpdateElementsCommand({
			updates: [
				{
					trackId: h.trackId,
					elementId: h.elementId,
					patch: { programmatic: { ...source, code: "external" } },
				},
			],
		}),
	});
	await paused.entered;
	const pending = h.command.execute({ command: h.sourceCommand() });
	paused.release();
	await external;
	await expect(pending).rejects.toThrow("source changed outside this draft");
	expect(h.current().programmatic?.code).toBe("external");
	expect(h.command.getHistoryCount()).toBe(2);
});
