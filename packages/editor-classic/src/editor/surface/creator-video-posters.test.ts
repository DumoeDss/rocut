import { expect, test } from "bun:test";
import { creatorVideoPoster } from "./creator-video-posters";
import type { CreatorWorkspaceBridge, CreatorWorkspaceCommand, CreatorWorkspaceCommandResult } from "./creator-workspace-types";

function fixture(execute: (command: CreatorWorkspaceCommand) => Promise<CreatorWorkspaceCommandResult>) {
	return { getSnapshot: async () => ({ projectId: "project", revision: "1", documents: [], assets: [] }),
		subscribe: () => () => {}, execute } satisfies CreatorWorkspaceBridge;
}
async function settled(resource: ReturnType<typeof creatorVideoPoster>) {
	if (resource.getSnapshot().status !== "loading") return;
	await new Promise<void>((resolve) => {
		const stop = resource.subscribe(() => { if (resource.getSnapshot().status !== "loading") { stop(); resolve(); } });
	});
}
const sha = "a".repeat(64);

test("cards and the detail view share one automatic request and reuse its result", async () => {
	let calls = 0;
	const bridge = fixture(async () => { calls++; return { poster: { status: "available", url: "poster:video" } }; });
	const card = creatorVideoPoster(bridge, "project", "video", "v1", sha);
	const detail = creatorVideoPoster(bridge, "project", "video", "v1", sha);
	expect(card).toBe(detail);
	card.request(); detail.request();
	await settled(card);
	detail.request();
	expect(calls).toBe(1);
	expect(detail.getSnapshot()).toEqual({ status: "available", url: "poster:video" });
});

test("bounds simultaneous requests and refuses a queued request after project changes", async () => {
	let active = 0, maximum = 0, calls = 0;
	const finish: (() => void)[] = [];
	let projectId = "project";
	const bridge = fixture(async () => {
		calls++; maximum = Math.max(maximum, ++active);
		await new Promise<void>((resolve) => finish.push(resolve)); active--;
		return { poster: { status: "available", url: "poster:video" } };
	});
	bridge.getSnapshot = async () => ({ projectId, revision: "1", documents: [], assets: [] });
	const resources = [0, 1, 2].map((i) => creatorVideoPoster(bridge, "project", `video-${i}`, "v1", sha));
	resources.forEach((resource) => resource.request());
	await Promise.resolve(); await Promise.resolve();
	expect(maximum).toBe(2);
	projectId = "other"; finish.forEach((resolve) => resolve());
	await Promise.all(resources.map(settled));
	expect(calls).toBe(2);
	expect(resources[2].getSnapshot().status).toBe("unavailable");
});

test("failures do not auto-loop and an explicit retry can recover", async () => {
	let calls = 0;
	const bridge = fixture(async () => {
		if (++calls === 1) throw new Error("decoder failed");
		return { poster: { status: "available", url: "poster:recovered" } };
	});
	const resource = creatorVideoPoster(bridge, "project", "video", "v1", sha);
	resource.request(); await settled(resource);
	resource.request(); expect(calls).toBe(1);
	resource.request(true); await settled(resource);
	expect(calls).toBe(2);
	expect(resource.getSnapshot().status).toBe("available");
});
