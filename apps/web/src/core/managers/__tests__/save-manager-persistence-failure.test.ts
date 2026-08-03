/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Focused SaveManager harness supplies only persistence-adjacent ProjectManager state. */
import { expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import { SaveManager } from "../save-manager";

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
