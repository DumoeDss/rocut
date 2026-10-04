import { describe, expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";

const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");

async function setup() {
	const project = projectFixture();
	project.scenes[0].tracks.audio.push({
		id: "audio-track",
		name: "Audio",
		type: "audio",
		muted: false,
		elements: [
			{
				id: "audio-clip",
				name: "tone.wav",
				type: "audio",
				sourceType: "upload",
				mediaId: "tone",
				startTime: mediaTime({ ticks: 0 }),
				duration: mediaTime({ ticks: 240000 }),
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				params: { volume: 0, muted: false },
			},
		],
	});
	const h = await commandHarness(project, [
		{
			id: "tone",
			name: "tone.wav",
			type: "audio",
			duration: 2,
			file: new File(["fixture"], "tone.wav", { type: "audio/wav" }),
		},
	]);
	const current = () => h.getScenes()[0].tracks.audio[0].elements[0];
	const stored = async () =>
		decodeProject((await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data)
			.scenes[0].tracks.audio[0].elements[0];
	return { ...h, current, stored };
}

describe("staged donor-only UI commits", () => {
	test("volume and mute commit without synthetic geometry changes and survive history/reopen", async () => {
		const h = await setup();
		const initial = structuredClone(h.current());
		const publicBefore = await h.transactions.clips();
		h.timeline.previewElements({
			updates: [
				{
					trackId: "audio-track",
					elementId: "audio-clip",
					updates: { params: { volume: -6, muted: true } },
				},
			],
		});
		expect(await h.timeline.commitPreview()).toBe(true);
		expect(h.current().params).toEqual({ volume: -6, muted: true });
		expect(await h.stored()).toEqual(h.current());
		expect(await h.transactions.clips()).toEqual(publicBefore);
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(h.command.getHistoryCount()).toBe(1);
		expect(Number(await h.transactions.revision())).toBe(1);
		await h.command.undo();
		expect(h.current()).toEqual(initial);
		expect(await h.stored()).toEqual(initial);
		await h.command.redo();
		expect(h.current().params).toEqual({ volume: -6, muted: true });
		expect(await h.stored()).toEqual(h.current());
		expect(Number(await h.transactions.revision())).toBe(3);
	});
	test("failed private-parameter save publishes no state/history and retains preview for retry", async () => {
		const h = await setup();
		const initial = structuredClone(h.current());
		h.timeline.previewElements({
			updates: [
				{
					trackId: "audio-track",
					elementId: "audio-clip",
					updates: { params: { volume: -12, muted: false } },
				},
			],
		});
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		expect(await h.timeline.commitPreview()).toBe(false);
		expect(h.current()).toEqual(initial);
		expect(await h.stored()).toEqual(initial);
		expect(h.command.getHistoryCount()).toBe(0);
		expect(Number(await h.transactions.revision())).toBe(0);
		expect(h.timeline.isPreviewActive()).toBe(true);
		expect(await h.timeline.commitPreview()).toBe(true);
		expect(h.current().params.volume).toBe(-12);
		expect(h.command.getHistoryCount()).toBe(1);
	});
	test("track mute snapshots are durable without altering public geometry", async () => {
		const h = await setup();
		const before = structuredClone(h.getScenes()[0].tracks),
			after = structuredClone(before);
		after.audio[0].muted = true;
		const { TracksSnapshotCommand } =
			await import("../../../commands/timeline/tracks-snapshot");
		await h.command.execute({
			command: new TracksSnapshotCommand({ before, after }),
		});
		expect(
			decodeProject((await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data)
				.scenes[0].tracks.audio[0].muted,
		).toBe(true);
		await h.command.undo();
		expect(h.getScenes()[0].tracks.audio[0].muted).toBe(false);
	});
	test("private-property history preserves a disjoint automation commit", async () => {
		const h = await setup();
		h.timeline.previewElements({
			updates: [
				{
					trackId: "audio-track",
					elementId: "audio-clip",
					updates: { params: { volume: -6, muted: true } },
				},
			],
		});
		expect(await h.timeline.commitPreview()).toBe(true);
		await h.transactions.apply({
			operations: [
				{
					kind: "update-project",
					projectId: TEST_PROJECT_ID,
					patch: { name: "Automation rename" },
				},
			],
			idempotencyKey: "private-history-rename",
		});
		await h.command.undo();
		expect(h.current().params).toEqual({ volume: 0, muted: false });
		expect(h.getProject().metadata.name).toBe("Automation rename");
		await h.command.redo();
		expect(h.current().params).toEqual({ volume: -6, muted: true });
		expect(h.getProject().metadata.name).toBe("Automation rename");
		expect(await h.stored()).toEqual(h.current());
		expect(Number(await h.transactions.revision())).toBe(4);
	});
	test("true no-op commands are still rejected without creating a revision", async () => {
		const h = await setup();
		h.timeline.previewElements({
			updates: [
				{
					trackId: "audio-track",
					elementId: "audio-clip",
					updates: { params: { volume: 0, muted: false } },
				},
			],
		});
		expect(await h.timeline.commitPreview()).toBe(false);
		expect(h.fixture.getSaveCount()).toBe(0);
		expect(h.command.getHistoryCount()).toBe(0);
	});
	test("private text parameters do not require moving the clip to persist", async () => {
		const project = projectFixture();
		project.scenes[0].tracks.overlay.push({
			id: "text-track",
			name: "Text",
			type: "text",
			hidden: false,
			elements: [
				{
					id: "text-clip",
					name: "Text",
					type: "text",
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 240000 }),
					trimStart: mediaTime({ ticks: 0 }),
					trimEnd: mediaTime({ ticks: 0 }),
					params: { content: "before" },
				},
			],
		});
		const h = await commandHarness(project);
		h.timeline.previewElements({
			updates: [
				{
					trackId: "text-track",
					elementId: "text-clip",
					updates: { params: { content: "after", fontSize: 72 } },
				},
			],
		});
		expect(await h.timeline.commitPreview()).toBe(true);
		expect(h.getScenes()[0].tracks.overlay[0].elements[0].params).toEqual({
			content: "after",
			fontSize: 72,
		});
		expect(
			decodeProject((await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data)
				.scenes[0].tracks.overlay[0].elements[0].params,
		).toEqual({ content: "after", fontSize: 72 });
		await h.command.undo();
		expect(h.getScenes()[0].tracks.overlay[0].elements[0].params).toEqual({
			content: "before",
		});
	});
});
