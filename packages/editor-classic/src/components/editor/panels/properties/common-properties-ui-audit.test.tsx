/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated shallow React event inspection exercises the real durable command boundary. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.COMMON_PROPERTIES_UI_AUDIT !== "1") {
	test("common property UI reaches durable batch history", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, COMMON_PROPERTIES_UI_AUDIT: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	const React = await import("react");
	mock.module("react", () => ({ ...React, useState: () => [{}, () => {}] }));
	const { commandHarness } =
		await import("../../../../core/managers/__tests__/command-test-harness");
	const { projectFixture } =
		await import("../../../../editor/transactions/opencut/__tests__/fixture");
	const { mediaTime } = await import("@opencut/editor-contracts");
	let editor: Awaited<ReturnType<typeof commandHarness>>["editor"];
	mock.module("../../../../editor/use-editor", () => ({
		useEditor: (select: (core: typeof editor) => unknown) => select(editor),
		useEditorInstance: () => editor,
	}));
	const { getEditorMessages } =
		await import("../../../../editor/host/editor-messages");
	mock.module("../../../../editor/host/editor-host-context", () => ({
		useEditorMessages: () => getEditorMessages("en"),
	}));
	const { CommonProperties } = await import("./common-properties");
	function findOpacity(node: any): any {
		if (!node || typeof node !== "object") return undefined;
		if (node.type === "input" && node.props.min === 0 && node.props.max === 1)
			return node;
		for (const child of React.Children.toArray(node.props?.children)) {
			const found = findOpacity(child);
			if (found) return found;
		}
	}
	async function setup(locked = false) {
		const project = projectFixture();
		project.scenes[0].tracks.overlay.push({
			id: "text-track",
			name: "Text",
			type: "text",
			hidden: false,
			elements: [0, 1].map((index) => ({
				id: `text-${index}`,
				name: `Text ${index}`,
				type: "text" as const,
				startTime: mediaTime({ ticks: index * 8000 }),
				duration: mediaTime({ ticks: 8000 }),
				trimStart: mediaTime({ ticks: 0 }),
				trimEnd: mediaTime({ ticks: 0 }),
				params: { content: `Text ${index}`, opacity: 1 },
			})),
		});
		const harness = await commandHarness(project);
		// The installed WASM fixture predates native track-lock admission. Set the
		// live UI collaborator only; this test makes no claim about native lock rules.
		if (locked) harness.getScenes()[0].tracks.overlay[0].locked = true;
		editor = harness.editor;
		editor.selection.setSelectedElements({
			elements: [0, 1].map((index) => ({
				trackId: "text-track",
				elementId: `text-${index}`,
			})),
		});
		return harness;
	}
	test("onBlur persists both selections as one undoable transaction", async () => {
		const harness = await setup();
		const input = findOpacity(CommonProperties());
		expect(input.props.disabled).toBe(false);
		input.props.onBlur({ target: { value: "0.4" } });
		await harness.command.whenIdle();
		expect(harness.failures).toEqual([]);
		expect(
			harness
				.getProject()
				.scenes[0].tracks.overlay[0].elements.map(
					(element) => element.params.opacity,
				),
		).toEqual([0.4, 0.4]);
		expect(harness.fixture.getSaveCount()).toBe(1);
		expect(harness.command.getHistoryCount()).toBe(1);
		harness.command.undo();
		await harness.command.whenIdle();
		expect(
			harness
				.getProject()
				.scenes[0].tracks.overlay[0].elements.map(
					(element) => element.params.opacity,
				),
		).toEqual([1, 1]);
	});
	test("locked selection disables UI and rejects a synthetic blur", async () => {
		const harness = await setup(true);
		const input = findOpacity(CommonProperties());
		expect(input.props.disabled).toBe(true);
		input.props.onBlur({ target: { value: "0.4" } });
		await harness.command.whenIdle();
		expect(harness.command.getHistoryCount()).toBe(0);
		expect(harness.fixture.getSaveCount()).toBe(0);
	});
	test("native keyframe transaction makes the batch field read-only", async () => {
		const harness = await setup();
		await harness.timeline.upsertKeyframes({
			keyframes: [
				{
					trackId: "text-track",
					elementId: "text-0",
					propertyPath: "opacity",
					time: mediaTime({ ticks: 2000 }),
					value: 0.25,
					keyframeId: "opacity-audit",
				},
			],
		});
		const saveCount = harness.fixture.getSaveCount();
		const input = findOpacity(CommonProperties());
		expect(input.props.disabled).toBe(true);
		input.props.onBlur({ target: { value: "0.4" } });
		await harness.command.whenIdle();
		expect(harness.command.getHistoryCount()).toBe(1);
		expect(harness.fixture.getSaveCount()).toBe(saveCount);
		expect(
			harness
				.getProject()
				.scenes[0].tracks.overlay[0].elements.map(
					(element) => element.params.opacity,
				),
		).toEqual([1, 1]);
	});
}
