/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Focused SaveManager harness supplies only persistence-adjacent ProjectManager state. */
import { expect, test } from "bun:test";
import type { EditorCore } from "../..";
import { SaveManager } from "../save-manager";

test("flush publishes transient state and joins an in-flight write plus its successor", async () => {
	const releases: Array<() => void> = [];
	const snapshots: number[] = [];
	let view = 0;
	const editor = { project: {
		getActive: () => ({ metadata: { id: "project" } }),
		getIsLoading: () => false,
		getMigrationState: () => ({ isMigrating: false }),
		saveCurrentProject: () => {
			snapshots.push(view);
			return new Promise<void>((resolve) => releases.push(resolve));
		},
	} } as unknown as EditorCore;
	const manager = new SaveManager({ editor });
	manager.markDirty();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const remove = manager.beforeFlush(() => { view = 8; });
	let finished = false;
	const flush = manager.flush().then(() => { finished = true; });
	expect(finished).toBe(false);
	expect(snapshots).toEqual([0]);
	releases.shift()!();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(snapshots).toEqual([0, 8]);
	expect(finished).toBe(false);
	releases.shift()!();
	await flush;
	expect(manager.getIsDirty()).toBe(false);
	remove(); manager.stop();
});

test("flush rejects a paused manager instead of claiming durability", async () => {
	const manager = new SaveManager({ editor: {} as EditorCore });
	manager.pause();
	await expect(manager.flush()).rejects.toThrow("not ready to flush");
});

test("failed background save remains dirty without retrying in a tight loop", async () => {
	const durableFailure = new Error("controlled durable failure");
	let attempts = 0;
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: async () => {
				attempts += 1;
				throw durableFailure;
			},
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor, debounceMs: 0 });

	manager.markDirty();
	await new Promise((resolve) => setTimeout(resolve, 20));

	expect(attempts).toBe(1);
	expect(manager.getIsDirty()).toBe(true);
	manager.stop();
});

test("explicit flush propagates durable failure and retains dirty state", async () => {
	const durableFailure = new Error("controlled durable failure");
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: async () => {
				throw durableFailure;
			},
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor });

	await expect(manager.flush()).rejects.toBe(durableFailure);
	expect(manager.getIsDirty()).toBe(true);
});
