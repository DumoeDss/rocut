/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Focused manager/command harnesses deliberately provide only the EditorCore collaborators each family uses. */
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { EditorCore } from "@/core";

if (process.env.OPENCUT_MEDIA_PERSISTENCE_TEST_ISOLATED !== "1") {
	test("media persistence rewiring runs with the wasm test double", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_MEDIA_PERSISTENCE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated media persistence suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@/editor/session/__tests__/wasm-test-mock");
	const { MediaManager } = await import("../media-manager");
	const { AddMediaAssetCommand, RemoveMediaAssetCommand } =
		await import("@/commands/media");
	const { SessionPersistenceCoordinator } =
		await import("@/editor/persistence");
	const { InMemoryProjectStore, InMemoryProjectStoreControl } =
		await import("@/editor/ports/in-memory");

	test("media manager commits before publication and preserves project isolation", async () => {
		const control = new InMemoryProjectStoreControl();
		const store = new InMemoryProjectStore({ control });
		const persistence = new SessionPersistenceCoordinator(store);
		let ratchetCalls = 0;
		const reportedFailures: string[] = [];
		const editor = {
			persistence,
			reportPersistenceFailure: ({ operation }: { operation: string }) => {
				reportedFailures.push(operation);
			},
			project: {
				ratchetFpsForImportedMedia: () => {
					ratchetCalls += 1;
				},
			},
		} as unknown as EditorCore;
		const manager = new MediaManager(editor);
		const failedFile = new File([new Uint8Array([1])], "failed.png", {
			type: "image/png",
		});
		control.failNext({
			operation: "save-attachment",
			code: "quota-exceeded",
		});

		expect(
			await manager.addMediaAsset({
				projectId: "project-a",
				asset: {
					name: failedFile.name,
					type: "image",
					file: failedFile,
				},
			}),
		).toBeNull();
		expect(manager.getAssets()).toEqual([]);
		expect(ratchetCalls).toBe(0);
		expect(reportedFailures).toEqual(["save-media-attachment"]);

		const goodFile = new File([new Uint8Array([2, 3])], "good.png", {
			type: "image/png",
		});
		const added = await manager.addMediaAsset({
			projectId: "project-a",
			asset: { name: goodFile.name, type: "image", file: goodFile },
		});
		expect(added).not.toBeNull();
		expect(manager.getAssets()).toHaveLength(1);
		expect(ratchetCalls).toBe(1);

		await store.saveAttachment({
			projectId: "project-b",
			key: added!.id,
			metadata: { owner: "project-b" },
			body: new Uint8Array([9]).buffer,
		});
		await manager.clearProjectMedia({ projectId: "project-a" });

		expect(manager.getAssets()).toEqual([]);
		expect(
			await store.loadAttachment({
				projectId: "project-a",
				key: added!.id,
			}),
		).toBeNull();
		expect(
			await store.loadAttachment({
				projectId: "project-b",
				key: added!.id,
			}),
		).toMatchObject({ metadata: { owner: "project-b" } });
	});

	test("media commands serialize execute and undo through the owning coordinator", async () => {
		const store = new InMemoryProjectStore();
		const persistence = new SessionPersistenceCoordinator(store);
		let assets = [] as Array<{
			id: string;
			name: string;
			type: "image";
			file: File;
			url?: string;
		}>;
		const tracks = {
			overlay: [],
			main: {
				id: "main",
				name: "Main",
				type: "video" as const,
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		};
		const editor = {
			persistence,
			reportPersistenceFailure: () => {},
			media: {
				getAssets: () => assets,
				setAssets: ({ assets: next }: { assets: typeof assets }) => {
					assets = next;
				},
			},
			project: {
				getActiveOrNull: () => null,
				ratchetFpsForImportedMedia: () => null,
			},
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				deleteElements: () => {},
				updateTracks: () => {},
			},
			command: { executeWithoutHistory: () => {} },
		} as unknown as EditorCore;

		const added = new AddMediaAssetCommand({
			projectId: "project",
			asset: {
				name: "asset.png",
				type: "image",
				file: new File([new Uint8Array([7])], "asset.png", {
					type: "image/png",
				}),
			},
		});
		const addedId = added.getAssetId();
		const removedAfterImmediateUndo = new Promise<void>((resolve) => {
			const unsubscribe = persistence.subscribe((event) => {
				if (event.kind !== "remove" || !event.key.endsWith(`\u0000${addedId}`))
					return;
				unsubscribe();
				resolve();
			});
		});
		added.execute({ editor });
		added.undo({ editor });
		await removedAfterImmediateUndo;
		expect(assets).toEqual([]);
		expect(
			await store.loadAttachment({ projectId: "project", key: addedId }),
		).toBeNull();

		const file = new File([new Uint8Array([8])], "remove.png", {
			type: "image/png",
		});
		assets = [
			{
				id: "remove-me",
				name: file.name,
				type: "image",
				file,
				url: URL.createObjectURL(file),
			},
		];
		await persistence.saveAttachment({
			projectId: "project",
			key: "remove-me",
			metadata: {
				id: "remove-me",
				name: file.name,
				type: "image",
				mimeType: file.type,
				lastModified: file.lastModified,
			},
			body: file.arrayBuffer(),
		});
		const command = new RemoveMediaAssetCommand({
			projectId: "project",
			assetId: "remove-me",
		});
		const restored = new Promise<void>((resolve) => {
			let removed = false;
			const unsubscribe = persistence.subscribe((event) => {
				if (!event.key.endsWith("\u0000remove-me")) return;
				if (event.kind === "remove") {
					removed = true;
					command.undo({ editor });
				} else if (removed && event.kind === "attachment") {
					unsubscribe();
					resolve();
				}
			});
		});
		command.execute({ editor });
		await restored;
		expect(assets).toHaveLength(1);
		expect(
			await store.loadAttachment({ projectId: "project", key: "remove-me" }),
		).not.toBeNull();
	});

	test("remove, undo, redo, and second undo transfer URL ownership exactly once", async () => {
		const file = new File([Uint8Array.of(1)], "owned.png", {
			type: "image/png",
		});
		const handles: Array<{ url: string; revokeCalls: number }> = [];
		const createObjectUrl = () => {
			const entry = {
				url: `blob:owned-${handles.length + 1}`,
				revokeCalls: 0,
			};
			handles.push(entry);
			return {
				resourceId: `owned-${handles.length}`,
				url: entry.url,
				revoke: () => {
					entry.revokeCalls += 1;
				},
			};
		};
		const initialHandle = createObjectUrl();
		let assets = [
			{
				id: "owned-media",
				name: file.name,
				type: "image" as const,
				file,
				url: initialHandle.url,
				urlHandle: initialHandle,
			},
		];
		const tracks = {
			overlay: [],
			main: {
				id: "main",
				name: "Main",
				type: "video" as const,
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		};
		const persistenceCalls: string[] = [];
		const editor = {
			resources: { createObjectUrl },
			persistence: {
				removeAttachment: async () => {
					persistenceCalls.push("remove");
				},
				saveAttachment: async () => {
					persistenceCalls.push("save");
				},
			},
			reportPersistenceFailure: () => {},
			media: {
				getAssets: () => assets,
				setAssets: ({ assets: next }: { assets: typeof assets }) => {
					assets = next;
				},
			},
			scenes: { getActiveScene: () => ({ tracks }) },
			timeline: {
				deleteElements: () => {},
				updateTracks: () => {},
			},
		} as unknown as EditorCore;
		const command = new RemoveMediaAssetCommand({
			projectId: "owned-project",
			assetId: "owned-media",
		});

		command.execute({ editor });
		await Promise.resolve();
		expect(assets).toEqual([]);
		expect(handles[0]?.revokeCalls).toBe(1);

		command.undo({ editor });
		await Promise.resolve();
		expect(assets[0]?.url).toBe("blob:owned-2");
		expect(handles[1]?.revokeCalls).toBe(0);

		command.execute({ editor });
		await Promise.resolve();
		expect(assets).toEqual([]);
		expect(handles[0]?.revokeCalls).toBe(1);
		expect(handles[1]?.revokeCalls).toBe(1);

		command.undo({ editor });
		await Promise.resolve();
		expect(assets[0]?.url).toBe("blob:owned-3");
		expect(handles[2]?.revokeCalls).toBe(0);
		expect(persistenceCalls).toEqual(["remove", "save", "remove", "save"]);
	});
}
