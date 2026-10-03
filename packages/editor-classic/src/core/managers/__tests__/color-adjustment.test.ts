import { describe, expect, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
const { InsertElementCommand } =
	await import("../../../commands/timeline/element/insert-element");
const { UpdateElementsCommand } =
	await import("../../../commands/timeline/element/update-elements");
const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");
const neutral = {
	exposure: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
};
const mono = { ...neutral, saturation: -100 };
async function setup() {
	const h = await commandHarness(projectFixture());
	const insert = new InsertElementCommand({
		element: {
			type: "effect",
			effectType: "color-adjustment",
			name: "Color adjustment",
			params: {},
			adjustment: neutral,
			startTime: mediaTime({ ticks: 120000 }),
			duration: mediaTime({ ticks: 240000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
		},
		placement: { mode: "auto", trackType: "effect" },
	});
	await h.command.execute({ command: insert });
	const trackId = insert.getTrackId();
	if (!trackId) throw new Error("No adjustment track");
	const elementId = insert.getElementId();
	return {
		...h,
		trackId,
		elementId,
		adjustment: () => {
			const element = h
				.getScenes()[0]
				.tracks.overlay.find((track) => track.id === trackId)
				?.elements.find((clip) => clip.id === elementId);
			if (element?.type !== "effect") throw new Error("Missing adjustment");
			return element;
		},
	};
}
describe("durable color adjustment", () => {
	test("insert, preview commit, reset, undo and redo preserve the layer on disk", async () => {
		const h = await setup();
		const original = structuredClone(h.adjustment());
		expect(h.fixture.getSaveCount()).toBe(1);
		h.timeline.previewElements({
			updates: [
				{
					trackId: h.trackId,
					elementId: h.elementId,
					updates: { adjustment: mono },
				},
			],
		});
		expect(h.adjustment()).toEqual(original);
		expect(await h.timeline.commitPreview()).toBe(true);
		expect(h.adjustment().adjustment).toEqual(mono);
		const stored = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		expect(
			decodeProject(stored?.data).scenes[0].tracks.overlay[0].elements[0],
		).toEqual(h.adjustment());
		await h.command.undo();
		expect(h.adjustment()).toEqual(original);
		await h.command.redo();
		expect(h.adjustment().adjustment).toEqual(mono);
		await h.command.execute({
			command: new UpdateElementsCommand({
				updates: [
					{
						trackId: h.trackId,
						elementId: h.elementId,
						patch: { adjustment: neutral },
					},
				],
			}),
		});
		expect(h.adjustment()).toEqual(original);
		await h.command.undo();
		expect(h.adjustment().adjustment).toEqual(mono);
	});
	test("failed preset save and failed preview commit leave committed state and history unchanged", async () => {
		const h = await setup();
		const count = h.command.getHistoryCount();
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({
				command: new UpdateElementsCommand({
					updates: [
						{
							trackId: h.trackId,
							elementId: h.elementId,
							patch: { adjustment: mono },
						},
					],
				}),
			}),
		).rejects.toBeDefined();
		expect(h.adjustment().adjustment).toEqual(neutral);
		expect(h.command.getHistoryCount()).toBe(count);
		h.timeline.previewElements({
			updates: [
				{
					trackId: h.trackId,
					elementId: h.elementId,
					updates: { adjustment: mono },
				},
			],
		});
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		expect(await h.timeline.commitPreview()).toBe(false);
		expect(h.adjustment().adjustment).toEqual(neutral);
		expect(h.command.getHistoryCount()).toBe(count);
		h.timeline.discardPreview();
		expect(h.timeline.getPreviewTracks()).toEqual(h.getScenes()[0].tracks);
	});
	test("split preserves parameters and creating another adjustment puts it above the existing one", async () => {
		const h = await setup();
		await h.timeline.splitElements({
			elements: [{ trackId: h.trackId, elementId: h.elementId }],
			splitTime: mediaTime({ ticks: 240000 }),
			retainSide: "both",
		});
		const track = h.getScenes()[0].tracks.overlay[0];
		expect(track.elements).toHaveLength(2);
		expect(
			track.elements.every(
				(element) =>
					element.type === "effect" && element.adjustment?.exposure === 0,
			),
		).toBe(true);
		const next = new InsertElementCommand({
			element: { ...h.adjustment(), startTime: mediaTime({ ticks: 480000 }) },
			placement: { mode: "auto", trackType: "effect" },
		});
		await h.command.execute({ command: next });
		expect(h.getScenes()[0].tracks.overlay[0].id).toBe(next.getTrackId());
	});
});
