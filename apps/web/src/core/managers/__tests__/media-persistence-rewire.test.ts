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
		await import("@opencut/editor-ports/in-memory");

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

	test("media commands keep attachment adds coordinated and delegate atomic removal", async () => {
		const store = new InMemoryProjectStore();
		const persistence = new SessionPersistenceCoordinator(store);
		const removalRequests: Array<{ projectId: string; id: string }> = [];
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
				removeMediaAsset: async (request: {
					projectId: string;
					id: string;
				}) => {
					removalRequests.push(request);
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

		const command = new RemoveMediaAssetCommand({
			projectId: "project",
			assetId: "remove-me",
		});
		command.execute({ editor });
		await Promise.resolve();
		expect(removalRequests).toEqual([
			{ projectId: "project", id: "remove-me" },
		]);
	});
}
