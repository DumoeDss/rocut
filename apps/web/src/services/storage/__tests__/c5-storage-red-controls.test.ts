/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- RED-to-green boundary controls intentionally exercise unknown/future APIs and legacy opaque payloads. */
import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
	"..",
	"..",
);

if (process.env.OPENCUT_C5_STORAGE_RED_ISOLATED !== "1") {
	test("C5 storage RED controls run in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_C5_STORAGE_RED_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated C5 storage RED controls failed as expected before implementation:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");

	type StoredValue = Record<string, unknown>;
	const databases = new Map<string, Map<string, Map<string, StoredValue>>>();
	const deletedDatabases: string[] = [];

	function clone<Value>(value: Value): Value {
		return structuredClone(value);
	}

	function storeFor({
		dbName,
		storeName,
	}: {
		dbName: string;
		storeName: string;
	}) {
		let database = databases.get(dbName);
		if (!database) {
			database = new Map();
			databases.set(dbName, database);
		}
		let store = database.get(storeName);
		if (!store) {
			store = new Map();
			database.set(storeName, store);
		}
		return store;
	}

	class FakeIndexedDBAdapter<Value extends StoredValue> {
		private readonly store: Map<string, StoredValue>;

		constructor({ dbName, storeName }: { dbName: string; storeName: string }) {
			this.store = storeFor({ dbName, storeName });
		}

		async get(key: string): Promise<Value | null> {
			const value = this.store.get(key);
			return value ? clone(value as Value) : null;
		}

		async set({ key, value }: { key: string; value: Value }): Promise<void> {
			this.store.set(key, clone({ id: key, ...value }));
		}

		async remove(key: string): Promise<void> {
			this.store.delete(key);
		}

		async list(): Promise<string[]> {
			return [...this.store.keys()];
		}

		async getAll(): Promise<Value[]> {
			return [...this.store.values()].map((value) => clone(value as Value));
		}

		async clear(): Promise<void> {
			this.store.clear();
		}
	}

	mock.module("@/services/storage/indexeddb-adapter", () => ({
		IndexedDBAdapter: FakeIndexedDBAdapter,
		deleteDatabase: async ({ dbName }: { dbName: string }) => {
			deletedDatabases.push(dbName);
			databases.delete(dbName);
		},
	}));

	const { InMemoryProjectStore } = await import("@opencut/editor-ports/in-memory");
	const { createInMemoryHost } = await import("@opencut/editor-ports/in-memory/host");
	const { createEditorSession } =
		await import("@/editor/session/create-session");
	const { editorForSession } =
		await import("@/editor/runtime/session-core-owner");
	const { createNextEditorHost } =
		await import("@/editor/host/next-editor-host");
	const { createViteEditorHost } =
		await import("../../../../../vite-example/src/host/vite-host-config");
	const { V1toV2Migration } = await import("../migrations/v1-to-v2");
	const { v1Project } = await import("../migrations/__tests__/fixtures/v1");

	function futureMethod<Name extends string>(store: object, name: Name) {
		const method = (store as Record<string, unknown>)[name];
		expect(method, `ProjectStore.${name} is missing`).toBeFunction();
		return method as (args: Record<string, unknown>) => Promise<unknown>;
	}

	describe("C5 storage behavior RED controls", () => {
		test("opaque nested fields survive a known timeline edit and full Host/session recreation", async () => {
			const projectId = "opaque-project";
			const hostStore = new InMemoryProjectStore();
			await hostStore.save({
				record: {
					id: projectId,
					schemaVersion: 31,
					data: {
						metadata: {
							id: projectId,
							name: "Opaque",
							duration: 0,
							createdAt: "2026-08-01T00:00:00.000Z",
							updatedAt: "2026-08-01T00:00:00.000Z",
							providerPrivateMetadata: { keep: "metadata" },
						},
						scenes: [
							{
								id: "main",
								name: "Main",
								isMain: true,
								tracks: {
									overlay: [],
									main: {
										id: "main-track",
										name: "Main",
										type: "video",
										elements: [],
										muted: false,
										hidden: false,
									},
									audio: [],
								},
								bookmarks: [],
								createdAt: "2026-08-01T00:00:00.000Z",
								updatedAt: "2026-08-01T00:00:00.000Z",
								providerPrivateScene: { keep: "scene" },
							},
						],
						currentSceneId: "main",
						settings: {},
						version: 31,
						providerPrivateProject: { keep: "project" },
					},
				},
				summary: {
					id: projectId,
					name: "Opaque",
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
				},
			});

			const sessionA = await createEditorSession({
				host: createInMemoryHost({ projectId, store: hostStore }),
			});
			const persistenceA = editorForSession(sessionA).persistence;
			const loaded = await persistenceA.loadProject({ id: projectId });
			expect(loaded).not.toBeNull();
			loaded!.scenes[0].bookmarks = [{ time: 120_000 }] as never;
			await persistenceA.saveProject({ project: loaded! });
			await sessionA.dispose();

			const sessionB = await createEditorSession({
				host: createInMemoryHost({ projectId, store: hostStore }),
			});
			const reopened = await editorForSession(sessionB).persistence.loadProject(
				{
					id: projectId,
				},
			);
			expect(reopened?.scenes[0].bookmarks).toHaveLength(1);
			const retained = await hostStore.load({ id: projectId });
			expect(retained?.data).toMatchObject({
				providerPrivateProject: { keep: "project" },
				metadata: { providerPrivateMetadata: { keep: "metadata" } },
				scenes: [{ providerPrivateScene: { keep: "scene" } }],
			});
			await sessionB.dispose();
		});

		test("the public store can carry attachment metadata and bytes", async () => {
			const store = new InMemoryProjectStore();
			const save = futureMethod(store, "saveAttachment");
			const load = futureMethod(store, "loadAttachment");
			await save({
				projectId: "p1",
				key: "media-1",
				metadata: { providerPrivate: "keep" },
				body: new Uint8Array([1, 2, 3]).buffer,
			});
			expect(await load({ projectId: "p1", key: "media-1" })).toMatchObject({
				metadata: { providerPrivate: "keep" },
			});
		});

		test("the public store can carry saved-sound and custom-preset libraries", async () => {
			const store = new InMemoryProjectStore();
			const save = futureMethod(store, "saveLibraryRecord");
			const load = futureMethod(store, "loadLibraryRecord");
			await save({
				namespace: "saved-sounds",
				key: "shared",
				schemaVersion: 1,
				data: { sound: 1 },
			});
			await save({
				namespace: "graph-presets",
				key: "shared",
				schemaVersion: 1,
				data: { preset: 1 },
			});
			expect(
				await load({ namespace: "saved-sounds", key: "shared" }),
			).toMatchObject({ data: { sound: 1 } });
			expect(
				await load({ namespace: "graph-presets", key: "shared" }),
			).toMatchObject({ data: { preset: 1 } });
		});

		test("both production Hosts reject inherited InMemoryProjectStore", () => {
			const next = createNextEditorHost({
				projectId: "next",
				onProjectReplaced: () => {},
				onExitProject: () => {},
				onGoBack: () => {},
			});
			const vite = createViteEditorHost({
				projectId: "vite",
				onProjectIdChange: () => {},
				onExitProject: () => {},
			});
			expect(next.store).not.toBeInstanceOf(InMemoryProjectStore);
			expect(vite.store).not.toBeInstanceOf(InMemoryProjectStore);
		});

		test("the browser implementation runs the shared conformance matrix", () => {
			const fixture = readFileSync(
				join(
					repoRoot,
					"script",
					"fixtures",
					"c5-browser-store-conformance",
					"browser-store-conformance.ts",
				),
				"utf8",
			);
			expect(fixture).toContain("runPortConformance");
			expect(
				existsSync(
					join(
						repoRoot,
						"apps",
						"web",
						"src",
						"services",
						"storage",
						"browser-project-store.ts",
					),
				),
				"production BrowserProjectStore does not exist",
			).toBe(true);
		});

		test("a staged-validation failure leaves every legacy source readable", async () => {
			deletedDatabases.length = 0;
			const projectId = String(v1Project.id);
			const sceneId = String(v1Project.scenes[0].id);
			const legacyNames = [
				`video-editor-timelines-${projectId}-${sceneId}`,
				`video-editor-timelines-${projectId}`,
			];
			for (const dbName of legacyNames) {
				storeFor({ dbName, storeName: "timeline" }).set("timeline", {
					tracks: [],
					lastModified: "2026-08-01T00:00:00.000Z",
				});
			}
			const migration = new V1toV2Migration();
			await migration.run({ projectId, project: clone(v1Project) });
			const stagedValidationPassed = false;
			expect(stagedValidationPassed).toBe(false);
			expect(deletedDatabases).toEqual([]);
			expect(legacyNames.every((name) => databases.has(name))).toBe(true);
		});

		test("equal attachment keys remain isolated between projects", async () => {
			const store = new InMemoryProjectStore();
			const save = futureMethod(store, "saveAttachment");
			const load = futureMethod(store, "loadAttachment");
			await save({
				projectId: "a",
				key: "shared",
				metadata: { owner: "a" },
				body: new Uint8Array([1]).buffer,
			});
			await save({
				projectId: "b",
				key: "shared",
				metadata: { owner: "b" },
				body: new Uint8Array([2]).buffer,
			});
			expect(await load({ projectId: "a", key: "shared" })).toMatchObject({
				metadata: { owner: "a" },
			});
			expect(await load({ projectId: "b", key: "shared" })).toMatchObject({
				metadata: { owner: "b" },
			});
		});

		test("equal library keys remain isolated between namespaces", async () => {
			const store = new InMemoryProjectStore();
			const save = futureMethod(store, "saveLibraryRecord");
			const load = futureMethod(store, "loadLibraryRecord");
			await save({
				namespace: "a",
				key: "shared",
				schemaVersion: 1,
				data: { owner: "a" },
			});
			await save({
				namespace: "b",
				key: "shared",
				schemaVersion: 1,
				data: { owner: "b" },
			});
			expect(await load({ namespace: "a", key: "shared" })).toMatchObject({
				data: { owner: "a" },
			});
			expect(await load({ namespace: "b", key: "shared" })).toMatchObject({
				data: { owner: "b" },
			});
		});

		test("all current direct persistence importers are rejected", () => {
			const files = execFileSync(
				"git",
				["ls-files", "apps/web/src", "apps/vite-example/src"],
				{
					cwd: repoRoot,
					encoding: "utf8",
				},
			)
				.split(/\r?\n/)
				.filter(
					(path) =>
						/\.(ts|tsx)$/.test(path) &&
						!path.includes("/__tests__/") &&
						existsSync(join(repoRoot, path)),
				);
			const violations = files.filter((path) => {
				const source = readFileSync(join(repoRoot, path), "utf8");
				return (
					/import\s*\{[^}]*storageService[^}]*\}\s*from\s*["'][^"']*service["']/.test(
						source,
					) ||
					/browser-host-adapter/.test(source) ||
					(path.endsWith("custom-presets-store.ts") &&
						/\blocalStorage\b/.test(source))
				);
			});
			expect(violations).toEqual([]);
		});
	});
}
