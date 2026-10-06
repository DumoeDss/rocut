import { expect, spyOn, test } from "bun:test";
import { commandHarness } from "./command-test-harness";
import * as projection from "../../../editor/transactions/opencut/projection";
import type { OpenCutProjectDraft } from "../../../editor/transactions/opencut/types";

await import("../../../editor/session/__tests__/wasm-test-mock");
const { UpdateProjectSettingsCommand } = await import("../../../commands");
const { mediaTime } = await import("../../../wasm/media-time");
const { projectFixture } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");

test("ordinary undo reuses the already isolated before snapshot without cloning it again", async () => {
	const harness = await commandHarness();
	const original = projection.cloneOpenCutDraft;
	const copies: {
		input: OpenCutProjectDraft;
		output: OpenCutProjectDraft;
		width: number;
	}[] = [];
	const clone = spyOn(projection, "cloneOpenCutDraft").mockImplementation(
		(input) => {
			const output = original(input);
			copies.push({
				input,
				output,
				width: input.project.settings.canvasSize.width,
			});
			return output;
		},
	);
	try {
		await harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 640, height: 360 },
			}),
		});
		const before = copies.find(
			(copy) => copy.input === copies[0].output && copy.width === 1920,
		);
		expect(before).toBeDefined();
		expect(copies.some((copy) => copy.input === before?.output)).toBe(false);
	} finally {
		clone.mockRestore();
	}
	try {
		await harness.command.undo();
		expect(harness.getProject().settings.canvasSize.width).toBe(1920);
		await harness.command.redo();
		expect(harness.getProject().settings.canvasSize.width).toBe(640);
	} finally {
		await harness.transactions.dispose();
	}
});

test("command capture borrows live data until the router isolates it", async () => {
	const project = projectFixture();
	project.scenes[0].bookmarks.push({
		time: mediaTime({ ticks: 0 }),
		note: "keep",
	});
	const harness = await commandHarness(project);
	const live = harness.getProject();
	const scenes = harness.getScenes();
	const before = structuredClone({ live, scenes });
	const clone = spyOn(globalThis, "structuredClone");
	try {
		await harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 1280, height: 720 },
			}),
		});
		expect(clone.mock.calls.some(([value]) => value === live)).toBe(false);
		expect(clone.mock.calls.some(([value]) => value === scenes)).toBe(false);
	} finally {
		clone.mockRestore();
	}
	expect({ live, scenes }).toEqual(before);
	const markers = await harness.transactions.markers();
	expect(markers).toHaveLength(1);
	await harness.command.undo();
	expect(harness.getProject().settings.canvasSize.width).toBe(1920);
	expect(await harness.transactions.markers()).toEqual(markers);
	await harness.command.redo();
	expect(harness.getProject().settings.canvasSize.width).toBe(1280);
	expect(await harness.transactions.markers()).toEqual(markers);
});

test("failed command preparation cannot mutate borrowed live state or marker IDs", async () => {
	const project = projectFixture();
	project.scenes[0].bookmarks.push({
		time: mediaTime({ ticks: 0 }),
		note: "keep",
	});
	const harness = await commandHarness(project);
	const before = structuredClone({
		project: harness.getProject(),
		scenes: harness.getScenes(),
	});
	harness.command.registerReactor(() => {
		throw new Error("reject after detached edits");
	});
	await expect(
		harness.command.execute({
			command: new UpdateProjectSettingsCommand({
				canvasSize: { width: 1280, height: 720 },
			}),
		}),
	).rejects.toThrow("reject after detached edits");
	expect({
		project: harness.getProject(),
		scenes: harness.getScenes(),
	}).toEqual(before);
	expect(harness.fixture.getSaveCount()).toBe(0);
	expect(harness.command.getHistoryCount()).toBe(0);
});
