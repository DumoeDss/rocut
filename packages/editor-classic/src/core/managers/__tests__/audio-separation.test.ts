import { describe, expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
import type { MediaAsset } from "../../../media/types";
import type { VideoElement } from "../../../timeline/types";
const { ToggleSourceAudioSeparationCommand } =
	await import("../../../commands/timeline/element/toggle-source-audio-separation");
const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");

async function setup() {
	const project = projectFixture();
	const asset: MediaAsset = {
		id: "video-media",
		name: "video.mp4",
		type: "video",
		duration: 5,
		hasAudio: true,
		file: new File([], "video.mp4", { type: "video/mp4" }),
	};
	const video: VideoElement = {
		id: "clip",
		name: "Video",
		type: "video",
		mediaId: asset.id,
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 240_000 }),
		trimStart: mediaTime({ ticks: 120_000 }),
		trimEnd: mediaTime({ ticks: 120_000 }),
		sourceDuration: mediaTime({ ticks: 600_000 }),
		retime: { rate: 1.5 },
		isSourceAudioEnabled: true,
		params: { volume: -6, muted: false },
	};
	project.scenes[0].tracks.main.elements.push(video);
	const h = await commandHarness(project, [asset]);
	return {
		...h,
		tracks: () => h.getScenes()[0].tracks,
		video: () => h.getScenes()[0].tracks.main.elements[0],
		audio: () => h.getScenes()[0].tracks.audio[0]?.elements[0],
	};
}
const toggle = () =>
	new ToggleSourceAudioSeparationCommand({
		trackId: "main-track",
		elementId: "clip",
	});

describe("durable source audio separation", () => {
	test("extracts one durable audio element with matching source span and gain", async () => {
		const h = await setup();
		const original = structuredClone(h.video());
		await h.command.execute({ command: toggle() });
		expect(h.video()).toEqual({ ...original, isSourceAudioEnabled: false });
		expect(h.audio()).toMatchObject({
			type: "audio",
			sourceType: "upload",
			mediaId: "video-media",
			duration: 240_000,
			startTime: 0,
			trimStart: 120_000,
			trimEnd: 120_000,
			sourceDuration: 600_000,
			retime: { rate: 1.5 },
			params: { volume: -6, muted: false },
		});
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(h.getDirtySignals()).toBe(0);
		const record = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(decodeProject(record?.data).scenes[0].tracks).toEqual(h.tracks());
	});

	test("undo/redo preserves audio identity and lets later edits replay", async () => {
		const h = await setup();
		await h.command.execute({ command: toggle() });
		const separated = structuredClone(h.tracks());
		const audio = h.audio();
		if (!audio) throw new Error("Missing extracted audio");
		h.timeline.previewElements({
			updates: [
				{
					trackId: h.tracks().audio[0].id,
					elementId: audio.id,
					updates: { params: { ...audio.params, volume: -12 } },
				},
			],
		});
		expect(await h.timeline.commitPreview()).toBe(true);
		const edited = structuredClone(h.tracks());
		await h.command.undo();
		expect(h.tracks()).toEqual(separated);
		await h.command.undo();
		expect(h.tracks().audio).toHaveLength(0);
		await h.command.redo();
		expect(h.tracks()).toEqual(separated);
		await h.command.redo();
		expect(h.tracks()).toEqual(edited);
		const record = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(decodeProject(record?.data).scenes[0].tracks).toEqual(edited);
	});

	test("recovery is durable and does not silently delete independent audio", async () => {
		const h = await setup();
		await h.command.execute({ command: toggle() });
		const audio = structuredClone(h.audio());
		const separated = structuredClone(h.tracks());
		await h.command.execute({ command: toggle() });
		expect(h.video()).toHaveProperty("isSourceAudioEnabled", true);
		expect(h.audio()).toEqual(audio);
		expect(h.fixture.getSaveCount()).toBe(2);
		await h.command.undo();
		expect(h.tracks()).toEqual(separated);
		await h.command.redo();
		expect(h.video()).toHaveProperty("isSourceAudioEnabled", true);
		const record = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(decodeProject(record?.data).scenes[0].tracks).toEqual(h.tracks());
	});

	test("failed extraction publishes neither a muted source nor an orphan audio clip", async () => {
		const h = await setup();
		const before = structuredClone(h.tracks());
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: toggle() }),
		).rejects.toBeDefined();
		expect(h.tracks()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(0);
		expect(h.fixture.getSaveCount()).toBe(1);
		const failedRecord = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(decodeProject(failedRecord?.data).scenes[0].tracks).toEqual(before);
		await h.command.execute({ command: toggle() });
		expect(h.tracks().audio).toHaveLength(1);
		expect(h.fixture.getSaveCount()).toBe(2);
	});

	test("failed recovery keeps both the source flag and the undo history intact", async () => {
		const h = await setup();
		await h.command.execute({ command: toggle() });
		const before = structuredClone(h.tracks());
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: toggle() }),
		).rejects.toBeDefined();
		expect(h.tracks()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(1);
		await h.command.execute({ command: toggle() });
		expect(h.video()).toHaveProperty("isSourceAudioEnabled", true);
	});
});
