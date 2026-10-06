import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];
async function tempRoot() {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-agent-editing-"));
	roots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of roots) {
		if (
			path.dirname(root) !== path.resolve(tmpdir()) ||
			!path.basename(root).startsWith("rocut-agent-editing-")
		)
			throw new Error("Unexpected test cleanup target");
		await rm(root, { recursive: true, force: true });
	}
});

test("HTTP Agent discovers rich editing, plans scenes without mutation, applies/replays after restart", async () => {
	const projectRoot = await tempRoot();
	const registry = new TargetRegistry(await tempRoot());
	let host = await startHost({ projectRoot, registry });
	const url = (route: string) =>
		`http://127.0.0.1:${host.port}/${host.token}/api/${route}`;
	const post = (route: string, body: unknown) =>
		fetch(url(route), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	try {
		const tasks = await (await fetch(url("editor-tasks"))).json();
		expect(tasks).toEqual({ surfaces: [], jobs: [] });
		const refusedTask = await post("editor-tasks", {
			request: {
				kind: "history.status",
				expectedRevision: 0,
				idempotencyKey: "status",
			},
		});
		expect(refusedTask.status).toBe(409);
		expect((await refusedTask.json()).message).toBe("no-task-surface");
		expect((await fetch(url("editor-tasks/missing"))).status).toBe(404);
		const catalog = await (await fetch(url("editing/catalog"))).json();
		expect(catalog.version).toBe(1);
		expect(
			catalog.transcription.models.some(
				(model: { id: string }) =>
					model.id === catalog.transcription.defaultModelId,
			),
		).toBe(true);
		expect(
			catalog.transcription.languages.some(
				(language: { code: string }) => language.code === "en",
			),
		).toBe(true);
		expect(
			catalog.elements.text.some(
				(param: { key: string }) => param.key === "content",
			),
		).toBe(true);
		expect(Object.keys(catalog.graphics)).toContain("rectangle");
		const planResponse = await post("scenes/plan", {
			idempotencyKey: "scene-create-1",
			operation: {
				kind: "create",
				id: "second",
				name: "Second",
				mainTrackId: "second-main",
			},
		});
		expect(planResponse.status).toBe(200);
		const plan = await planResponse.json();
		expect(plan.expectedRevision).toBe(0);
		expect((await (await fetch(url("scenes"))).json()).scenes).toHaveLength(1);
		const applied = await post("apply", plan);
		expect(applied.status).toBe(200);
		const receipt = await applied.json();
		await host.close();
		host = await startHost({ projectRoot, registry });
		const replay = await post("apply", plan);
		expect(replay.status).toBe(200);
		expect(await replay.json()).toEqual(receipt);
		expect((await (await fetch(url("scenes"))).json()).scenes).toHaveLength(2);
		const invalid = await post("apply", {
			expectedRevision: 1,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "orphan",
						sceneId: "missing",
						kind: "text",
						name: "orphan",
						hidden: false,
					},
				},
			],
		});
		expect(invalid.status).toBe(409);
		expect((await (await fetch(url("context"))).json()).revision).toBe(1);
	} finally {
		await host.close();
	}
});
