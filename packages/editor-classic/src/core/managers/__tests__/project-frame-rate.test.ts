import { expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";

await import("../../../editor/session/__tests__/wasm-test-mock");
const { UpdateProjectSettingsCommand } = await import("../../../commands");
const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");
import type { MediaAsset } from "../../../media/types";
import type { VideoElement } from "../../../timeline/types";

const t = (ticks: number) => mediaTime({ ticks });
const source: MediaAsset = {
	id: "source",
	name: "source",
	type: "video",
	file: new File([], "source.mp4"),
	duration: 4,
};
function clip({
	id,
	start = 0,
	duration = 120000,
}: {
	id: string;
	start?: number;
	duration?: number;
}): VideoElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: source.id,
		startTime: t(start),
		duration: t(duration),
		trimStart: t(0),
		trimEnd: t(0),
		params: { opacity: 1 },
	};
}

test("existing clips and markers across scenes commit on the new grid with exact undo/redo", async () => {
	const project = projectFixture();
	project.scenes[0].tracks.main.elements = [
		clip({ id: "left" }),
		clip({ id: "right", start: 120000 }),
	];
	project.scenes[0].bookmarks = [{ time: t(120000), note: "keep marker" }];
	project.scenes.push({
		...structuredClone(project.scenes[0]),
		id: "inactive",
		isMain: false,
		tracks: {
			main: {
				...project.scenes[0].tracks.main,
				id: "inactive-track",
				elements: [clip({ id: "other", duration: 240000 })],
			},
			overlay: [],
			audio: [],
		},
	});
	const h = await commandHarness(project, [source]);
	const original = structuredClone(h.getProject().scenes);
	for (const scene of original)
		scene.bookmarks.forEach((marker, index) =>
			Object.assign(marker, {
				__opencutTransactionMarkerId: `${scene.id}:marker:${index}`,
			}),
		);
	await h.command.execute({
		command: new UpdateProjectSettingsCommand({
			fps: { numerator: 30000, denominator: 1001 },
		}),
	});
	const aligned = structuredClone(h.getProject().scenes);
	expect(
		aligned[0].tracks.main.elements.map((c) => [c.startTime, c.duration]),
	).toEqual([
		[0, 116116],
		[116116, 120120],
	]);
	expect(aligned[0].bookmarks[0]).toMatchObject({
		time: 116116,
		note: "keep marker",
	});
	expect(aligned[1].tracks.main.elements[0].duration).toBe(236236);
	const persisted = decodeProject(
		(await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data,
	);
	expect(persisted.scenes).toEqual(aligned);
	await h.command.undo();
	expect(h.getProject().scenes).toEqual(original);
	await h.command.redo();
	expect(h.getProject().scenes).toEqual(aligned);
});

test("a collapsing clip rejects the entire operation without saving or adding history", async () => {
	const project = projectFixture();
	project.scenes[0].tracks.main.elements = [
		clip({ id: "one-frame", duration: 4000 }),
	];
	const h = await commandHarness(project, [source]);
	const before = structuredClone(h.getProject());
	await expect(
		h.command.execute({
			command: new UpdateProjectSettingsCommand({
				fps: { numerator: 24, denominator: 1 },
			}),
		}),
	).rejects.toThrow();
	expect(h.getProject()).toEqual(before);
	expect(h.fixture.getSaveCount()).toBe(0);
	expect(h.command.canUndo()).toBe(false);
});

test("save failure leaves all timing and frame rate unchanged", async () => {
	const project = projectFixture();
	project.scenes[0].tracks.main.elements = [
		clip({ id: "saved", duration: 240000 }),
	];
	const h = await commandHarness(project, [source]);
	h.fixture.control.failNext({
		operation: "save-project",
		code: "unavailable",
	});
	await expect(
		h.command.execute({
			command: new UpdateProjectSettingsCommand({
				fps: { numerator: 30000, denominator: 1001 },
			}),
		}),
	).rejects.toBeDefined();
	expect(h.getProject()).toEqual(project);
	expect(h.command.canUndo()).toBe(false);
	expect(
		decodeProject((await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data)
			.scenes,
	).toEqual(project.scenes);
});

test("valid incoming transitions remain contiguous and undo restores their timing", async () => {
	const project = projectFixture();
	const left = clip({ id: "left", duration: 240000 });
	const right = clip({ id: "right", start: 240000, duration: 240000 });
	right.trimStart = t(120000);
	right.transitionIn = {
		kind: "cross-dissolve",
		outgoingClipId: "left",
		durationFrames: 10,
	};
	project.scenes[0].tracks.main.elements = [left, right];
	const h = await commandHarness(project, [source]);
	await h.command.execute({
		command: new UpdateProjectSettingsCommand({
			fps: { numerator: 30000, denominator: 1001 },
		}),
	});
	const clips = h.getProject().scenes[0].tracks.main.elements;
	expect(clips[0].startTime + clips[0].duration).toBe(clips[1].startTime);
	expect(clips[1].transitionIn).toEqual(right.transitionIn);
	await h.command.undo();
	expect(h.getProject().scenes).toEqual(project.scenes);
});

test("fractional project frame rates commit and survive undo/redo", async () => {
	const harness = await commandHarness();
	const fps = { numerator: 30000, denominator: 1001 };
	await harness.command.execute({
		command: new UpdateProjectSettingsCommand({ fps }),
	});
	expect(harness.getProject().settings.fps).toEqual(fps);
	await harness.command.undo();
	expect(harness.getProject().settings.fps).toEqual({
		numerator: 30,
		denominator: 1,
	});
	await harness.command.redo();
	expect(harness.getProject().settings.fps).toEqual(fps);
});
