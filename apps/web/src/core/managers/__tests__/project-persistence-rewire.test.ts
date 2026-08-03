/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The isolated focused test builds branded media time and a deliberately partial EditorCore harness. */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorCore as EditorCoreType } from "@/core";
import type { TProject } from "@/project/types";
import type { MediaTime } from "@/wasm";

if (process.env.OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED !== "1") {
	test("project persistence rewiring runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PROJECT_PERSISTENCE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated project persistence suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { EditorCore } = await import("@/core");
	const { ProjectManager } = await import("../project-manager");
	const { SessionPersistenceCoordinator } =
		await import("@/editor/persistence");
	const { ProjectStoreError } = await import("@/editor/ports");
	const { InMemoryProjectStore, InMemoryProjectStoreControl } =
		await import("@/editor/ports/in-memory");

	const mediaTime = (value: number) => value as MediaTime;
	function project(id: string): TProject {
		const now = new Date("2026-08-02T00:00:00.000Z");
		return {
			metadata: {
				id,
				name: `Project ${id}`,
				duration: mediaTime(42),
				createdAt: now,
				updatedAt: now,
			},
			scenes: [],
			currentSceneId: "",
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 1920, height: 1080 },
				background: { type: "color", color: "#000000" },
			},
			version: 31,
		};
	}

	test("duplicates raw attachments and project removal cascades only its scope", async () => {
		const store = new InMemoryProjectStore();
		const persistence = new SessionPersistenceCoordinator(store);
		await persistence.saveProject({ project: project("source") });
		await persistence.saveProject({ project: project("other") });
		await store.saveAttachment({
			projectId: "source",
			key: "shared",
			metadata: { providerPrivate: { keep: true } },
			body: new Uint8Array([1, 2, 3]).buffer,
		});
		await store.saveAttachment({
			projectId: "other",
			key: "shared",
			metadata: { owner: "other" },
			body: new Uint8Array([9]).buffer,
		});
		await store.saveLibraryRecord({
			namespace: "saved-sounds",
			key: "library",
			schemaVersion: 1,
			data: { keep: true },
		});
		const editor = {
			persistence,
			reportPersistenceFailure: () => {},
			media: { clearAllAssets: () => {} },
			scenes: { clearScenes: () => {} },
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		await manager.loadAllProjects();

		const [duplicateId] = await manager.duplicateProjects({ ids: ["source"] });
		const duplicateAttachment = await store.loadAttachment({
			projectId: duplicateId,
			key: "shared",
		});
		expect(duplicateAttachment).toMatchObject({
			metadata: { providerPrivate: { keep: true } },
		});
		expect([...new Uint8Array(duplicateAttachment!.body)]).toEqual([1, 2, 3]);

		await manager.deleteProjects({ ids: ["source"] });
		expect(await store.load({ id: "source" })).toBeNull();
		expect(
			await store.loadAttachment({ projectId: "source", key: "shared" }),
		).toBeNull();
		expect(await store.load({ id: duplicateId })).not.toBeNull();
		expect(
			await store.loadAttachment({ projectId: "other", key: "shared" }),
		).toMatchObject({ metadata: { owner: "other" } });
		expect(
			await store.loadLibraryRecord({
				namespace: "saved-sounds",
				key: "library",
			}),
		).toMatchObject({ data: { keep: true } });
	});

	test("create failure is reported and does not publish transient project state", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });
		const persistence = new SessionPersistenceCoordinator(store);
		const reportedFailures: string[] = [];
		let mediaClearCalls = 0;
		let sceneInitializationCalls = 0;
		const editor = {
			persistence,
			reportPersistenceFailure: ({ operation }: { operation: string }) => {
				reportedFailures.push(operation);
			},
			media: {
				clearAllAssets: () => {
					mediaClearCalls += 1;
				},
			},
			scenes: {
				initializeScenes: () => {
					sceneInitializationCalls += 1;
				},
			},
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		control.failNext({ operation: "save-project", code: "unavailable" });

		await expect(manager.createNewProject({ name: "Unsaved" })).rejects.toThrow(
			"unavailable",
		);

		expect(manager.getActiveOrNull()).toBeNull();
		expect(manager.getSavedProjects()).toEqual([]);
		expect(mediaClearCalls).toBe(0);
		expect(sceneInitializationCalls).toBe(0);
		expect(reportedFailures).toEqual(["create-project"]);
	});

	test("duplicate failure waits for late saves and removes every fulfilled duplicate", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });
		const persistence = new SessionPersistenceCoordinator(store);
		await persistence.saveProject({ project: project("source-a") });
		await persistence.saveProject({ project: project("source-b") });
		const reportedFailures: string[] = [];
		const editor = {
			persistence,
			reportPersistenceFailure: ({ operation }: { operation: string }) => {
				reportedFailures.push(operation);
			},
			media: { clearAllAssets: () => {} },
			scenes: { clearScenes: () => {} },
		} as unknown as EditorCoreType;
		const manager = new ProjectManager(editor);
		await manager.loadAllProjects();

		control.failNext({ operation: "save-project", code: "unavailable" });
		const lateSave = control.pauseNext({ operation: "save-project" });
		const duplication = manager.duplicateProjects({
			ids: ["source-a", "source-b"],
		});
		let settled = false;
		void duplication.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);

		await lateSave.entered;
		await Promise.resolve();
		expect(settled).toBeFalse();
		lateSave.release();
		await expect(duplication).rejects.toThrow("unavailable");

		expect((await store.list()).map((summary) => summary.id).sort()).toEqual([
			"source-a",
			"source-b",
		]);
		expect(reportedFailures).toEqual(["duplicate-projects"]);
	});

	test("session diagnostics expose stable failure identity without raw payload", () => {
		const rawSentinel = "provider-private-payload-must-not-leak";
		const logs: unknown[] = [];
		const editor = {
			sessionDiagnostics: {
				log: ({ record }: { record: unknown }) => logs.push(record),
			},
		} as unknown as EditorCoreType;
		const error = new ProjectStoreError({
			code: "unavailable",
			operation: "save-project",
			scope: { kind: "project", projectId: rawSentinel },
			message: rawSentinel,
		});

		EditorCore.prototype.reportPersistenceFailure.call(editor, {
			operation: "save-project",
			error,
		});

		expect(logs).toEqual([
			{
				level: "error",
				message: "Durable editor operation failed",
				context: { operation: "save-project", code: "unavailable" },
			},
		]);
		expect(JSON.stringify(logs)).not.toContain(rawSentinel);
	});
}
