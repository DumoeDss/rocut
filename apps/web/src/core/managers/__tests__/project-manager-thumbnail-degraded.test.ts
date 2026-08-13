/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The focused rasterizer boundary test uses branded media time and a deliberately partial EditorCore harness. */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorCore } from "@/core";
import type { TProject } from "@/project/types";
import type { MediaTime } from "@/wasm";

if (process.env.OPENCUT_PROJECT_THUMBNAIL_TEST_ISOLATED !== "1") {
	test("project thumbnail boundary suite runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PROJECT_THUMBNAIL_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated project thumbnail suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { ProjectManager } = await import("@/core/managers/project-manager");
	const { SessionPersistenceCoordinator } =
		await import("@/editor/persistence");
	const { InMemoryProjectStore } = await import("@opencut/editor-ports/in-memory");

	const mediaTime = (value: number) => value as MediaTime;

	function projectWithoutThumbnail(): TProject {
		const now = new Date("2026-08-01T00:00:00.000Z");
		return {
			metadata: {
				id: "thumbnail-project",
				name: "Thumbnail project",
				duration: mediaTime(1_000),
				createdAt: now,
				updatedAt: now,
			},
			scenes: [
				{
					id: "thumbnail-scene",
					name: "Main scene",
					isMain: true,
					tracks: {
						overlay: [],
						main: {
							id: "thumbnail-main-track",
							name: "Main",
							type: "video",
							elements: [],
							muted: false,
							hidden: false,
						},
						audio: [],
					},
					bookmarks: [],
					createdAt: now,
					updatedAt: now,
				},
			],
			currentSceneId: "thumbnail-scene",
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width: 64, height: 36 },
				background: { type: "color", color: "#123456" },
			},
			version: 31,
		};
	}

	function createHarness({ degraded }: { degraded: boolean }) {
		const project = projectWithoutThumbnail();
		const persistence = new SessionPersistenceCoordinator(
			new InMemoryProjectStore(),
		);
		const calls = {
			createCanvasRenderer: 0,
			flush: 0,
			markDirty: 0,
			renderToCanvas: 0,
			sceneReads: 0,
		};
		const renderer = {
			assetResolver: {
				resolve: ({ ref }: { ref: { path: string } }) => ref.path,
			},
			createCanvasRenderer: () => {
				calls.createCanvasRenderer += 1;
				return {
					renderToCanvas: async () => {
						calls.renderToCanvas += 1;
					},
				};
			},
			getCompositorHandle: () => null,
			isDegraded: degraded,
		};
		const editor = {
			drainProjectLiveState: async () => {},
			persistence,
			reportPersistenceFailure: () => {},
			media: {
				clearAllAssets: () => {},
				getAssets: () => [],
				loadProjectMedia: async () => {},
			},
			renderer,
			save: {
				flush: async () => {
					calls.flush += 1;
				},
				markDirty: () => {
					calls.markDirty += 1;
				},
				pause: () => {},
				resume: () => {},
			},
			scenes: {
				clearScenes: () => {},
				getActiveScene: () => {
					calls.sceneReads += 1;
					return project.scenes[0];
				},
				initializeScenes: () => {},
			},
			timeline: {
				getTotalDuration: () => mediaTime(1_000),
			},
		} as unknown as EditorCore;
		const manager = new ProjectManager(editor);
		return { calls, manager, persistence, project, renderer };
	}

	describe("project thumbnail rasterizer boundary", () => {
		test("degraded load and exit skip thumbnail work before scene or renderer acquisition", async () => {
			const { calls, manager, persistence, project, renderer } = createHarness({
				degraded: true,
			});
			await persistence.saveProject({ project });
			await manager.loadProject({ id: project.metadata.id });
			await manager.prepareExit();

			expect(manager.getActive().metadata.thumbnail).toBeUndefined();
			expect(calls).toEqual({
				createCanvasRenderer: 0,
				flush: 0,
				markDirty: 0,
				renderToCanvas: 0,
				sceneReads: 0,
			});
			expect(renderer.getCompositorHandle()).toBeNull();
		});

		test("normal exit still renders and saves a project thumbnail", async () => {
			const { calls, manager, project } = createHarness({ degraded: false });
			const originalDocument = Object.getOwnPropertyDescriptor(
				globalThis,
				"document",
			);
			Object.defineProperty(globalThis, "document", {
				configurable: true,
				value: {
					createElement: () => ({
						height: 0,
						toDataURL: () => "data:image/png;base64,dGh1bWJuYWls",
						width: 0,
					}),
				},
			});
			manager.setActiveProject({ project });

			try {
				await manager.prepareExit();
			} finally {
				if (originalDocument) {
					Object.defineProperty(globalThis, "document", originalDocument);
				} else {
					Reflect.deleteProperty(globalThis, "document");
				}
			}

			expect(manager.getActive().metadata.thumbnail).toBe(
				"data:image/png;base64,dGh1bWJuYWls",
			);
			expect(calls).toEqual({
				createCanvasRenderer: 1,
				flush: 1,
				markDirty: 1,
				renderToCanvas: 1,
				sceneReads: 1,
			});
		});
	});
}
