/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Focused SaveManager harness supplies only persistence-adjacent ProjectManager state. */
import { expect, test } from "bun:test";
import type { EditorCore } from "../..";
import { SaveManager } from "../save-manager";
import { ProjectStoreError } from "@opencut/editor-ports";

test("flush publishes transient state and joins an in-flight write plus its successor", async () => {
	const releases: Array<() => void> = [];
	const snapshots: number[] = [];
	let view = 0;
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: () => {
				snapshots.push(view);
				return new Promise<void>((resolve) => releases.push(resolve));
			},
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor });
	manager.markDirty();
	await new Promise((resolve) => setTimeout(resolve, 0));
	const remove = manager.beforeFlush(() => {
		view = 8;
	});
	let finished = false;
	const flush = manager.flush().then(() => {
		finished = true;
	});
	expect(finished).toBe(false);
	expect(snapshots).toEqual([0]);
	releases.shift()!();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(snapshots).toEqual([0, 8]);
	expect(finished).toBe(false);
	releases.shift()!();
	await flush;
	expect(manager.getIsDirty()).toBe(false);
	remove();
	manager.stop();
});

test("flush rejects a paused manager instead of claiming durability", async () => {
	const manager = new SaveManager({ editor: {} as EditorCore });
	manager.pause();
	await expect(manager.flush()).rejects.toThrow("not ready to flush");
	expect(manager.getState().isReadOnly).not.toBe(true);
});

test("only an explicit readonly code is readonly and retry clears it after durability", async () => {
	let failure: Error | null = new Error("EPERM readonly unavailable");
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: async () => {
				if (failure) throw failure;
			},
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor });
	await expect(manager.flush()).rejects.toBe(failure);
	expect(manager.getState().isReadOnly).not.toBe(true);
	failure = new ProjectStoreError({
		code: "unavailable",
		operation: "save-project",
		scope: { kind: "store" },
	});
	await expect(manager.flush()).rejects.toBe(failure);
	expect(manager.getState().isReadOnly).not.toBe(true);
	failure = new ProjectStoreError({
		code: "readonly",
		operation: "save-project",
		scope: { kind: "store" },
	});
	await expect(manager.flush()).rejects.toBe(failure);
	expect(manager.getState().isReadOnly).toBe(true);
	expect(manager.getState().isDirty).toBe(true);
	failure = null;
	await manager.flush();
	expect(manager.getState().isReadOnly).not.toBe(true);
	expect(manager.getState().isDirty).toBe(false);
	manager.stop();
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

test("save state observes background failure and explicit retry without masking persistence", async () => {
	let fail = true;
	let attempts = 0;
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: async () => {
				attempts += 1;
				if (fail) throw new Error("disk unavailable");
			},
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor });
	const initial = manager.getState();
	expect(manager.getState()).toBe(initial);
	const states: ReturnType<SaveManager["getState"]>[] = [];
	const unsubscribe = manager.subscribe(() => {
		states.push(manager.getState());
	});
	manager.subscribe(() => {
		throw new Error("observer failure");
	});
	manager.markDirty();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(attempts).toBe(1);
	expect(
		states.map(({ isDirty, isSaving, error }) => [isDirty, isSaving, error]),
	).toEqual([
		[true, false, null],
		[true, true, null],
		[true, false, "disk unavailable"],
	]);
	fail = false;
	await manager.flush();
	expect(manager.getState()).toEqual({
		isDirty: false,
		isSaving: false,
		isPaused: false,
		error: null,
	});
	expect(attempts).toBe(2);
	unsubscribe();
	const length = states.length;
	manager.pause();
	expect(states).toHaveLength(length);
	expect(manager.getState().isPaused).toBe(true);
	manager.resume();
	manager.stop();
});

test("a successor edit never publishes saved state before its own durable write", async () => {
	const releases: Array<() => void> = [];
	const editor = {
		project: {
			getActive: () => ({ metadata: { id: "project" } }),
			getIsLoading: () => false,
			getMigrationState: () => ({ isMigrating: false }),
			saveCurrentProject: () =>
				new Promise<void>((resolve) => releases.push(resolve)),
		},
	} as unknown as EditorCore;
	const manager = new SaveManager({ editor });
	const states: boolean[] = [];
	manager.subscribe(() => {
		states.push(manager.getState().isDirty);
	});
	manager.markDirty();
	await new Promise((resolve) => setTimeout(resolve, 0));
	manager.markDirty();
	releases.shift()!();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(states.every(Boolean)).toBe(true);
	expect(manager.getState().isSaving).toBe(true);
	releases.shift()!();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(states.at(-1)).toBe(false);
	manager.stop();
});
