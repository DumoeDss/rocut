import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEditorTaskRegistry } from "../host-editor-tasks";
import { isEditorTaskRequest } from "@opencut/editor-contracts";

// Protocol fixture, not a raster oracle: native PNG rendering has its own tests.
const png = new Uint8Array(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	),
);
const request = {
	kind: "snapshot.png" as const,
	expectedRevision: 0,
	idempotencyKey: "png-1",
	projectId: "p",
	sceneId: "s",
	tick: 60000,
};

test("snapshot schema admits only safe integer ticks and closed fields", () => {
	for (const tick of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])
		expect(isEditorTaskRequest({ ...request, tick })).toBe(false);
	expect(isEditorTaskRequest(request)).toBe(true);
	expect(isEditorTaskRequest({ ...request, outputPath: "outside.png" })).toBe(
		false,
	);
});

test("snapshot targets one capable pane; token, revision, busy, cancellation and managed output are enforced", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-snapshot-"));
	let revision = 0;
	const registry = createEditorTaskRegistry({
		projectDir: root,
		currentRevision: async () => revision,
	});
	const frames: { token: string }[] = [];
	try {
		expect(() => registry.start({ request }, 0)).toThrow("no-task-surface");
		registry.attach("old_pane", { send() {} });
		expect(() => registry.start({ surfaceId: "old_pane", request }, 0)).toThrow(
			"no-snapshot-surface",
		);
		registry.attach("pane_one", {
			snapshotPng: true,
			send: (frame) => frames.push(frame as { token: string }),
		});
		registry.attach("pane_two", {
			snapshotPng: true,
			send() {
				throw Error("wrong target");
			},
		});
		expect(() => registry.start({ request }, 0)).toThrow("ambiguous");
		expect(() => registry.start({ surfaceId: "pane_one", request }, 1)).toThrow(
			"revision-conflict",
		);
		const start = () =>
			registry.start(
				{
					surfaceId: "pane_one",
					request: { ...request, idempotencyKey: crypto.randomUUID() },
				},
				revision,
			);
		const first = start(),
			token = frames.at(-1)!.token;
		expect(() => start()).toThrow("busy");
		await expect(
			registry.completeOutput(first.id, "wrong", png),
		).rejects.toThrow("owner");
		await expect(
			registry.completeOutput(first.id, token, new Uint8Array()),
		).rejects.toThrow("invalid-snapshot-png");
		expect(() => registry.report(first.id, { token, result: {} })).toThrow(
			"requires-png-upload",
		);
		const [a, b] = await Promise.all([
			registry.completeOutput(first.id, token, png),
			registry.completeOutput(first.id, token, png),
		]);
		expect(a.status).toBe("complete");
		expect(b.status).toBe("complete");
		const result = a.result as {
			outputPath: string;
			tick: number;
			sourceRevision: number;
		};
		expect(path.dirname(result.outputPath)).toBe(path.join(root, "exports"));
		expect(result.outputPath.endsWith(".png")).toBe(true);
		expect(result.tick).toBe(request.tick);
		expect(result.sourceRevision).toBe(0);
		expect(new Uint8Array(await readFile(result.outputPath))).toEqual(png);
		const second = start(),
			secondToken = frames.at(-1)!.token;
		const writing = registry.completeOutput(second.id, secondToken, png);
		registry.cancel(second.id);
		expect((await writing).status).toBe("cancelled");
		expect(
			(await registry.completeOutput(second.id, secondToken, png)).result,
		).toBeUndefined();
		const third = start(),
			thirdToken = frames.at(-1)!.token;
		revision = 1;
		expect(
			(await registry.completeOutput(third.id, thirdToken, png)).error,
		).toBe("revision-conflict");
		expect(await readdir(path.join(root, "exports"))).toEqual([
			first.id + ".png",
		]);
	} finally {
		registry.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
