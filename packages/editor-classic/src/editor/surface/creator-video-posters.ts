import type { CreatorWorkspaceBridge, CreatorWorkspaceCommandResult } from "./creator-workspace-types";

type Poster = NonNullable<CreatorWorkspaceCommandResult["poster"]>;
export type VideoPosterState = Poster | { status: "idle" | "loading" };
export const idlePoster: VideoPosterState = { status: "idle" };
type Resource = ReturnType<typeof createResource>;
type Pool = { entries: Map<string, Resource>; queue: (() => Promise<void>)[]; active: number };
const pools = new WeakMap<CreatorWorkspaceBridge, Pool>();

function createResource(pool: Pool, bridge: CreatorWorkspaceBridge,
	projectId: string, assetId: string, versionId: string, sha256: string) {
	let state = idlePoster;
	const listeners = new Set<() => void>();
	const publish = (value: VideoPosterState) => { state = value; for (const listener of listeners) listener(); };
	const pump = () => {
		while (pool.active < 2 && pool.queue.length) {
			pool.active++;
			void pool.queue.shift()!().finally(() => { pool.active--; pump(); });
		}
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		request(retry = false) {
			if (state.status === "loading" || (!retry && state.status !== "idle")) return;
			if (pool.queue.length >= 128) { publish({ status: "unavailable", reason: "Video poster queue is full" }); return; }
			publish({ status: "loading" });
			pool.queue.push(async () => {
				try {
					if ((await bridge.getSnapshot()).projectId !== projectId) throw new Error("Video poster project changed");
					const { poster } = await bridge.execute({ type: "asset.ensure-poster", projectId, assetId, versionId, sha256 });
					if (!poster || (poster.status === "available" && !poster.url)) throw new Error("Video poster is unavailable");
					publish(poster);
				} catch (error) {
					publish({ status: "unavailable", reason: error instanceof Error ? error.message : String(error) });
				}
			});
			pump();
		},
		fail: (reason: string) => publish({ status: "unavailable", reason }),
	};
}

/** Bounded by bridge/project/content identity, independent of selection and timeline revisions. */
export function creatorVideoPoster(bridge: CreatorWorkspaceBridge, projectId: string,
	assetId: string, versionId: string, sha256: string) {
	let pool = pools.get(bridge);
	if (!pool) { pool = { entries: new Map(), queue: [], active: 0 }; pools.set(bridge, pool); }
	const key = JSON.stringify([projectId, assetId, versionId, sha256]);
	let resource = pool.entries.get(key);
	if (!resource) {
		if (pool.entries.size >= 128) {
			for (const [id, entry] of pool.entries) {
				if (entry.getSnapshot().status !== "loading") { pool.entries.delete(id); break; }
			}
		}
		resource = createResource(pool, bridge, projectId, assetId, versionId, sha256);
		if (pool.entries.size < 128) pool.entries.set(key, resource);
		else resource.fail("Video poster queue is full");
	}
	return resource;
}
