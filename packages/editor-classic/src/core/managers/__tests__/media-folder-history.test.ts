/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Narrow harness calls the real manager method without constructing unrelated media services. */
import { expect, test } from "bun:test";
import type { MediaFolderMutation } from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import {
	TEST_PROJECT_ID,
	projectFixture,
} from "../../../editor/transactions/opencut/__tests__/fixture";
const { MutateMediaFoldersCommand } =
	await import("../../../commands/project/mutate-media-folders");
const { MediaManager } = await import("../media-manager");

test("folder gestures each save one history entry and persist through undo/redo, including absent legacy metadata", async () => {
	const h = await commandHarness(projectFixture(), [
		{
			id: "asset",
			name: "shot.mp4",
			type: "video",
			duration: 2,
			hasAudio: false,
			file: new File([], "shot.mp4", { type: "video/mp4" }),
		},
	]);
	const mutate = (operation: MediaFolderMutation) =>
		MediaManager.prototype.mutateFolders.call(
			{ editor: h.editor, notify() {} } as unknown as InstanceType<
				typeof MediaManager
			>,
			operation,
		);
	const durable = async () =>
		(await h.editor.persistence.loadProject({ id: TEST_PROJECT_ID }))
			?.mediaFolders;
	try {
		const states = [
			undefined as ReturnType<typeof h.getProject>["mediaFolders"],
		];
		const operations: MediaFolderMutation[] = [
			{ kind: "create", id: "parent", name: "Parent" },
			{ kind: "create", id: "child", name: "Child", parentId: "parent" },
			{ kind: "rename", id: "child", name: "Renamed" },
			{ kind: "move-assets", assetIds: ["asset"], folderId: "child" },
			{ kind: "dissolve", id: "child" },
		];
		for (const operation of operations) {
			const saves = h.fixture.getSaveCount();
			await mutate(operation);
			states.push(structuredClone(h.getProject().mediaFolders));
			expect(h.fixture.getSaveCount()).toBe(saves + 1);
			expect(h.command.getHistoryCount()).toBe(states.length - 1);
			expect(await durable()).toEqual(states.at(-1));
		}
		expect(states[3]?.folders[1]?.name).toBe("Renamed");
		expect(states[4]?.assignments).toEqual([
			{ assetId: "asset", folderId: "child" },
		]);
		for (let index = operations.length - 1; index >= 0; index--) {
			await h.command.undo();
			expect(h.getProject().mediaFolders).toEqual(states[index]);
			expect(await durable()).toEqual(states[index]);
		}
		expect(h.command.canUndo()).toBe(false);
		for (let index = 1; index < states.length; index++) {
			await h.command.redo();
			expect(h.getProject().mediaFolders).toEqual(states[index]);
			expect(await durable()).toEqual(states[index]);
		}
	} finally {
		await h.transactions.dispose();
	}
});

test("queued folder work composes, failed saves preserve history, and a wrong project is rejected", async () => {
	const h = await commandHarness();
	const execute = (
		operation: MediaFolderMutation,
		projectId = TEST_PROJECT_ID,
	) =>
		h.command.execute({
			command: new MutateMediaFoldersCommand({ projectId, operation }),
		});
	try {
		await Promise.all([
			execute({ kind: "create", id: "f", name: "Folder" }),
			execute({ kind: "rename", id: "f", name: "Queued" }),
		]);
		expect(h.getProject().mediaFolders?.folders[0]?.name).toBe("Queued");
		expect(h.command.getHistoryCount()).toBe(2);
		await h.command.undo();
		const revision = await h.transactions.revision();
		const saved = structuredClone(h.getProject().mediaFolders);
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			execute({ kind: "rename", id: "f", name: "Failed" }),
		).rejects.toMatchObject({ code: "unavailable" });
		expect(h.command.getHistoryCount()).toBe(1);
		expect(h.command.canRedo()).toBe(true);
		expect(h.getProject().mediaFolders).toEqual(saved);
		expect(await h.transactions.revision()).toBe(revision);
		await expect(
			execute({ kind: "rename", id: "f", name: "Wrong" }, "other-project"),
		).rejects.toThrow("no longer active");
		expect(h.command.getHistoryCount()).toBe(1);
		await execute({ kind: "rename", id: "f", name: "Success" });
		expect(h.command.canRedo()).toBe(false);
	} finally {
		await h.transactions.dispose();
	}
});

test("folder state and history publish only after durable save completes", async () => {
	const h = await commandHarness();
	const originalSave = h.fixture.store.save.bind(h.fixture.store);
	let release!: () => void;
	let entered!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const saving = new Promise<void>((resolve) => {
		entered = resolve;
	});
	h.fixture.store.save = async (args) => {
		entered();
		await gate;
		return originalSave(args);
	};
	try {
		const pending = h.command.execute({
			command: new MutateMediaFoldersCommand({
				projectId: TEST_PROJECT_ID,
				operation: { kind: "create", id: "f", name: "Folder" },
			}),
		});
		await saving;
		expect(h.getProject().mediaFolders).toBeUndefined();
		expect(h.command.canUndo()).toBe(false);
		expect(h.command.getHistoryCount()).toBe(0);
		release();
		await pending;
		expect(h.command.getHistoryCount()).toBe(1);
		expect(h.getProject().mediaFolders?.folders[0]?.id).toBe("f");
	} finally {
		release();
		await h.transactions.dispose();
	}
});
