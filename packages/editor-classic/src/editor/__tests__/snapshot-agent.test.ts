/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Narrow renderer seam fixtures. */
import { expect, test } from "bun:test";
import { commandHarness } from "../../core/managers/__tests__/command-test-harness";
import { createEditorTaskRunner } from "../agent-tasks";
const { RendererManager } =
	await import("../../core/managers/renderer-manager");

test("agent snapshot uses committed graph at exact ticks without moving preview and passes cancellation", async () => {
	const h = await commandHarness();
	Object.assign(h.editor.timeline, {
		getTotalDuration: () => 120000,
		getLastFrameTime: () => 116000,
	});
	Object.assign(h.editor, {
		media: { getAssets: () => [] },
		playback: {
			getCurrentTime: () => {
				throw Error("preview must not be read or moved");
			},
		},
	});
	const blob = new Blob(["native PNG seam"], { type: "image/png" });
	const cachedPreview = {};
	const calls: { node: unknown; time: number; signal?: AbortSignal }[] = [];
	const renderer = Object.assign(
		Object.create(RendererManager.prototype) as InstanceType<
			typeof RendererManager
		>,
		{
			editor: h.editor,
			renderTree: cachedPreview,
			_isDegraded: false,
			capturePublication: () => ({ guard: { assertCurrent() {} }, token: {} }),
			createCanvasRenderer: () => ({
				renderSnapshotPng: async (args: {
					node: unknown;
					time: number;
					signal?: AbortSignal;
				}) => {
					calls.push(args);
					return blob;
				},
			}),
		},
	);
	Object.assign(h.editor, { renderer });
	const runner = createEditorTaskRunner({ editor: h.editor });
	const controller = new AbortController();
	const request = {
		kind: "snapshot.png" as const,
		projectId: h.getProject().metadata.id,
		sceneId: h.editor.scenes.getActiveScene().id,
		expectedRevision: 0,
		idempotencyKey: "snapshot",
		tick: 60000,
	};
	const result = await runner.run({ request, signal: controller.signal });
	expect("blob" in result && result.blob).toBe(blob);
	expect(calls).toHaveLength(1);
	expect(calls[0].time).toBe(60000);
	expect(calls[0].signal).toBe(controller.signal);
	expect(calls[0].node).not.toBe(cachedPreview);
	expect(renderer.getRenderTree()).toBe(cachedPreview);
	expect(await h.transactions.revision()).toBe(0);
	await expect(
		runner.run({
			request: { ...request, projectId: "wrong" },
			signal: controller.signal,
		}),
	).rejects.toThrow("project-conflict");
	await expect(
		runner.run({
			request: { ...request, sceneId: "wrong" },
			signal: controller.signal,
		}),
	).rejects.toThrow("scene-conflict");
	await expect(
		runner.run({
			request: { ...request, expectedRevision: 1 },
			signal: controller.signal,
		}),
	).rejects.toThrow("revision-conflict");
	await expect(
		runner.run({
			request: { ...request, tick: 120000 },
			signal: controller.signal,
		}),
	).rejects.toThrow("out-of-range");
	controller.abort();
	await expect(
		runner.run({ request, signal: controller.signal }),
	).rejects.toThrow();
	expect(calls).toHaveLength(1);
});
