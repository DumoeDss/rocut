import { describe, expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
import type { MediaAsset } from "../../../media/types";
import type { VideoElement } from "../../../timeline/types";
const { ToggleVideoFreezeCommand } =
	await import("../../../commands/timeline/element/toggle-video-freeze");
const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");
const { doesElementHaveEnabledAudio, canToggleSourceAudio } =
	await import("../../../timeline/audio-separation");

const asset: MediaAsset = {
	id: "video-media",
	name: "video.mp4",
	type: "video",
	duration: 5,
	hasAudio: true,
	file: new File([], "video.mp4", { type: "video/mp4" }),
};
async function setup() {
	const project = projectFixture();
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
		params: {},
	};
	project.scenes[0].tracks.main.elements.push(video);
	const harness = await commandHarness(project, [asset]);
	return {
		...harness,
		video: () => {
			const entry = harness.getScenes()[0].tracks.main.elements[0];
			if (entry.type !== "video") throw new Error("missing video");
			return entry;
		},
	};
}
const toggle = (playhead = 120_000) =>
	new ToggleVideoFreezeCommand({
		trackId: "main-track",
		elementId: "clip",
		playhead: mediaTime({ ticks: playhead }),
	});

describe("durable video frame hold", () => {
	test("freezes the retimed source, reopens, undoes and restores original source audio", async () => {
		const h = await setup();
		const original = structuredClone(h.video());
		await h.command.execute({ command: toggle() });
		expect(h.video()).toEqual({ ...original, freezeFrame: 300_000 });
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(
			doesElementHaveEnabledAudio({ element: h.video(), mediaAsset: asset }),
		).toBe(false);
		expect(canToggleSourceAudio(h.video(), asset)).toBe(false);
		const record = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			decodeProject(record?.data).scenes[0].tracks.main.elements[0],
		).toEqual(h.video());
		await h.command.undo();
		expect(h.video()).toEqual(original);
		expect(
			doesElementHaveEnabledAudio({ element: h.video(), mediaAsset: asset }),
		).toBe(true);
		await h.command.redo();
		expect(h.video().freezeFrame).toBe(300_000);
		await h.command.execute({ command: toggle(900_000) });
		expect(h.video().freezeFrame).toBeUndefined();
		expect(h.video().isSourceAudioEnabled).toBe(true);
		await h.command.undo();
		expect(h.video().freezeFrame).toBe(300_000);
		await h.command.redo();
		const final = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			decodeProject(final?.data).scenes[0].tracks.main.elements[0],
		).toEqual(original);
	});

	test("split and duplicate preserve the absolute held source frame", async () => {
		const h = await setup();
		await h.command.execute({ command: toggle() });
		const right = await h.timeline.splitElements({
			elements: [{ trackId: "main-track", elementId: "clip" }],
			splitTime: mediaTime({ ticks: 120_000 }),
			retainSide: "both",
		});
		const split = h.getScenes()[0].tracks.main.elements;
		expect(split).toHaveLength(2);
		expect(
			split.every(
				(element) =>
					element.type === "video" && element.freezeFrame === 300_000,
			),
		).toBe(true);
		const { DuplicateElementsCommand } = await import("../../../commands");
		await h.command.execute({
			command: new DuplicateElementsCommand({ elements: right }),
		});
		const tracks = h.getScenes()[0].tracks;
		const clips = [tracks.main, ...tracks.overlay].flatMap(
			(track) => track.elements,
		);
		expect(clips).toHaveLength(3);
		expect(
			clips.every(
				(element) =>
					element.type === "video" && element.freezeFrame === 300_000,
			),
		).toBe(true);
		await h.command.undo();
		await h.command.undo();
		expect(h.getScenes()[0].tracks.main.elements).toHaveLength(1);
		expect(h.video().freezeFrame).toBe(300_000);
	});

	test("invalid playhead and save failure never publish a partial hold", async () => {
		const h = await setup();
		const original = structuredClone(h.video());
		await expect(
			h.command.execute({ command: toggle(240_000) }),
		).rejects.toThrow("Move the playhead");
		expect(h.fixture.getSaveCount()).toBe(0);
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: toggle() }),
		).rejects.toBeDefined();
		expect(h.video()).toEqual(original);
		expect(h.command.getHistoryCount()).toBe(0);
		await h.command.execute({ command: toggle() });
		expect(h.video().freezeFrame).toBe(300_000);
	});
});
