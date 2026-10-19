import { expect, test } from "bun:test";
import { createCreatorWorkspaceStore } from "./creator-workspace-store";
import type {
	CreatorWorkspaceBridge,
	CreatorWorkspaceSnapshot,
} from "./creator-workspace-types";

const snapshot = ({
	revision,
	projectId = "A",
}: {
	revision: string;
	projectId?: string;
}): CreatorWorkspaceSnapshot => ({
	projectId,
	revision,
	assets: [],
	documents: [],
});
function fixture() {
	let resolve!: (snapshot: CreatorWorkspaceSnapshot) => void;
	let reject!: (failure: Error) => void;
	const pending = new Promise<CreatorWorkspaceSnapshot>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const listeners = new Set<(snapshot: CreatorWorkspaceSnapshot) => void>();
	let reads = 0;
	const bridge: CreatorWorkspaceBridge = {
		getSnapshot: () => {
			reads++;
			return pending;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		execute: async () => ({ snapshot: snapshot({ revision: "1" }) }),
	};
	return {
		bridge,
		resolve,
		reject,
		reads: () => reads,
		listeners,
		emit: (next: CreatorWorkspaceSnapshot) => {
			for (const listener of listeners) listener(next);
		},
	};
}

test("one provider store shares a subscription and an initial read across consumers", async () => {
	const f = fixture();
	const store = createCreatorWorkspaceStore(f.bridge);
	let updates = 0;
	const first = store.subscribe(() => {
		updates++;
	});
	const second = store.subscribe(() => {
		updates++;
	});
	expect(f.reads()).toBe(1);
	expect(f.listeners.size).toBe(1);
	f.resolve(snapshot({ revision: "1" }));
	await Promise.resolve();
	expect(updates).toBe(2);
	first();
	f.emit(snapshot({ revision: "2" }));
	expect(updates).toBe(3);
	expect(store.getState().snapshot?.revision).toBe("2");
	second();
	expect(f.listeners.size).toBe(0);
});

test("broadcasts overtake a pending read and old or foreign revisions cannot regress data", async () => {
	const f = fixture();
	const store = createCreatorWorkspaceStore(f.bridge);
	const stop = store.subscribe(() => {});
	f.emit(snapshot({ revision: "5" }));
	f.resolve(snapshot({ revision: "1" }));
	await Promise.resolve();
	f.emit(snapshot({ revision: "3" }));
	f.emit(snapshot({ revision: "6", projectId: "other" }));
	expect(store.getState().snapshot).toEqual(snapshot({ revision: "5" }));
	stop();
});

test("disconnect ignores late responses and a replacement bridge has isolated state", async () => {
	const old = fixture();
	const next = fixture();
	const previousStore = createCreatorWorkspaceStore(old.bridge);
	const nextStore = createCreatorWorkspaceStore(next.bridge);
	const stop = previousStore.subscribe(() => {});
	stop();
	const stopNext = nextStore.subscribe(() => {});
	next.emit(snapshot({ revision: "1", projectId: "B" }));
	old.resolve(snapshot({ revision: "9" }));
	await Promise.resolve();
	expect(previousStore.getState().snapshot).toBeNull();
	expect(nextStore.getState().snapshot?.projectId).toBe("B");
	previousStore.setSnapshot(snapshot({ revision: "10" }));
	expect(nextStore.getState().snapshot?.projectId).toBe("B");
	stopNext();
});

test("read errors are visible and a successful broadcast clears the error", async () => {
	const f = fixture();
	const store = createCreatorWorkspaceStore(f.bridge);
	const stop = store.subscribe(() => {});
	f.reject(new Error("read failed"));
	await Promise.resolve();
	await Promise.resolve();
	expect(store.getState().error).toBe("read failed");
	f.emit(snapshot({ revision: "2" }));
	expect(store.getState()).toEqual({
		snapshot: snapshot({ revision: "2" }),
		error: null,
	});
	stop();
});
