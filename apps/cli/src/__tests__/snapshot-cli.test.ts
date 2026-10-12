import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEditorTaskRegistry } from "../host-editor-tasks";
import { handleEditorTaskRoute } from "../host-editor-task-routes";
import { runSnapshotCli } from "../snapshot-cli";
import { CliRequestError } from "../host-request";
import type { ResolvedTarget } from "../target-registry";

test("snapshot CLI uses fixed project/revision, uploads managed PNG, copies --out and reports no pane HTTP409", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-snapshot-cli-"));
	const registry = createEditorTaskRegistry({
		projectDir: root,
		currentRevision: async () => 3,
	});
	const png = new Uint8Array(
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			"base64",
		),
	);
	const server = createServer((req, res) => {
		const route = new URL(req.url!, "http://localhost").pathname
			.split("/")
			.slice(3);
		const respond = (status: number, value: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(value));
		};
		if (route[0] === "context")
			return respond(200, {
				revision: 3,
				project: {
					id: "exact-project",
					sceneState: { currentSceneId: "scene" },
				},
				editorTasks: { kinds: ["snapshot.png"] },
			});
		void handleEditorTaskRoute({
			request: req,
			route,
			registry,
			currentRevision: async () => 3,
			respond,
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const resolved = {
		entry: {
			id: "exact-target",
			port,
			pid: process.pid,
			projectPath: root,
			startedAt: Date.now(),
		},
		secret: { id: "exact-target", port, token: "fixture" },
	} satisfies ResolvedTarget;
	try {
		try {
			await runSnapshotCli({ resolved, tick: 60000 });
			throw Error("must refuse");
		} catch (error) {
			expect(error instanceof CliRequestError).toBe(true);
			expect((error as CliRequestError).status).toBe(409);
			expect((error as CliRequestError).response).toEqual({
				code: "no-task-surface",
				error: "no-task-surface",
			});
		}
		let captured: unknown;
		registry.attach("pane_one", {
			snapshotPng: true,
			send: (frame) => {
				const command = frame as {
					command: string;
					jobId: string;
					token: string;
					request: unknown;
				};
				if (command.command !== "editor-task.start") return;
				captured = command.request;
				queueMicrotask(() => {
					void fetch(
						`http://127.0.0.1:${port}/fixture/api/editor-tasks/${command.jobId}/output`,
						{
							method: "POST",
							headers: {
								"content-type": "image/png",
								"x-editor-task-token": command.token,
							},
							body: png,
						},
					);
				});
			},
		});
		const out = path.join(root, "requested.png");
		const result = await runSnapshotCli({
			resolved,
			tick: 60000,
			out,
			surfaceId: "pane_one",
		});
		expect(captured).toMatchObject({
			kind: "snapshot.png",
			projectId: "exact-project",
			sceneId: "scene",
			expectedRevision: 3,
			tick: 60000,
		});
		expect(result).toMatchObject({
			target: "exact-target",
			status: "complete",
			format: "png",
			tick: 60000,
			sourceRevision: 3,
			outputPath: out,
		});
		expect(path.dirname(result.managedOutputPath)).toBe(
			path.join(root, "exports"),
		);
		expect(new Uint8Array(await readFile(out))).toEqual(png);
		await expect(
			runSnapshotCli({ resolved, tick: 60000, expectedRevision: 2 }),
		).rejects.toThrow("revision-conflict");
		await expect(runSnapshotCli({ resolved, tick: -1 })).rejects.toThrow(
			"--tick",
		);
	} finally {
		registry.dispose();
		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		});
		await rm(root, { recursive: true, force: true });
	}
});
