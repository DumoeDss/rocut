import { expect, test } from "bun:test";
import {
	MediaPreviewResources,
	PREVIEW_PROFILE,
	previewPersistentKey,
	type MediaPreviewResult,
} from "../preview-resource";

function cache() {
	const values = new Map<string, string>();
	const deleted: string[] = [];
	return {
		values,
		deleted,
		storage: {
			read: async (key: string) => values.get(key),
			write: async ({ key, value }: { key: string; value: string }) => {
				values.set(key, value);
			},
			delete: async (key: string) => {
				deleted.push(key);
				values.delete(key);
			},
			validate: async (value: string) => value === "valid-frame",
		},
	};
}

test("corrupt persistent frame is deleted, decoded once, and reusable after restart", async () => {
	const stored = cache();
	const key = previewPersistentKey({
		projectId: "project",
		sha: "sha",
		time: 0,
	});
	stored.values.set(key, "data:image/jpeg;base64,broken");
	let decodes = 0;
	const decode = async (): Promise<MediaPreviewResult> => {
		decodes++;
		return { status: "ready", url: "valid-frame" };
	};
	const args = {
		file: new File(["video"], "a.mp4"),
		time: 0,
		projectId: "project",
		sourceSha256: "sha",
	};
	const resources = new MediaPreviewResources({
		decode,
		storage: stored.storage,
	});
	const first = resources.acquire(args);
	expect(await first.promise).toEqual({ status: "ready", url: "valid-frame" });
	expect(stored.deleted).toEqual([key]);
	expect(decodes).toBe(1);
	first.release();
	resources.clearAll();
	const reopened = new MediaPreviewResources({
		decode,
		storage: stored.storage,
	}).acquire(args);
	expect(await reopened.promise).toEqual({
		status: "ready",
		url: "valid-frame",
	});
	expect(decodes).toBe(1);
	reopened.release();
});

test("a corrupt cache plus failed decode stops until explicit retry invalidates it", async () => {
	const stored = cache();
	const args = {
		file: new File(["video"], "a.mp4"),
		time: 0,
		projectId: "p",
		sourceSha256: "sha",
	};
	stored.values.set(
		previewPersistentKey({ projectId: "p", sha: "sha", time: 0 }),
		"broken",
	);
	let decodes = 0;
	const resources = new MediaPreviewResources({
		decode: async () => {
			decodes++;
			return decodes === 1
				? { status: "failed" }
				: { status: "ready", url: "valid-frame" };
		},
		storage: stored.storage,
	});
	const first = resources.acquire(args);
	expect((await first.promise).status).toBe("failed");
	const again = resources.acquire(args);
	expect((await again.promise).status).toBe("failed");
	expect(decodes).toBe(1);
	const retried = resources.acquire({ ...args, retry: true });
	expect(await retried.promise).toEqual({
		status: "ready",
		url: "valid-frame",
	});
	expect(decodes).toBe(2);
	first.release();
	again.release();
	retried.release();
});

test("known SHA deduplicates distinct File instances without hashing their bytes", async () => {
	let decodes = 0;
	const resources = new MediaPreviewResources(async () => {
		decodes++;
		return { status: "ready", url: "frame" };
	});
	const first = resources.acquire({
		file: new File(["same"], "a.mp4"),
		time: 2,
		sourceSha256: "same-sha",
		projectId: "p",
	});
	const second = resources.acquire({
		file: new File(["same"], "renamed.mp4"),
		time: 2,
		sourceSha256: "same-sha",
		projectId: "p",
	});
	expect(first.promise).toBe(second.promise);
	await first.promise;
	expect(decodes).toBe(1);
	first.release();
	second.release();
});

test("persistent identity includes the entire explicit rendering policy", () => {
	const key = JSON.parse(
		previewPersistentKey({ projectId: "p", sha: "sha", time: 2 }),
	);
	expect(key).toEqual([PREVIEW_PROFILE, "p", "sha", 2]);
	expect(PREVIEW_PROFILE).toMatchObject({
		maxWidth: 240,
		maxHeight: 720,
		version: "frame-v2",
	});
	expect(PREVIEW_PROFILE.orientation).toContain("v1");
	expect(PREVIEW_PROFILE.color).toContain("v1");
});

test("visible posters jump queued filmstrip work; released queued leases never decode", async () => {
	const calls: number[] = [];
	const pending: ((result: MediaPreviewResult) => void)[] = [];
	const resources = new MediaPreviewResources(({ time }) => {
		calls.push(time);
		return new Promise((resolve) => pending.push(resolve));
	});
	const file = new File(["video"], "a.mp4");
	const running = [0, 1].map((time) => resources.acquire({ file, time }));
	const film = resources.acquire({ file, time: 2 });
	const cancelled = resources.acquire({ file, time: 3, priority: 2 });
	const poster = resources.acquire({ file, time: 4, priority: 1 });
	cancelled.release();
	expect((await cancelled.promise).status).toBe("failed");
	pending[0]({ status: "ready", url: "frame" });
	await running[0].promise;
	for (let index = 0; index < 8; index++) await Promise.resolve();
	expect(calls).toEqual([0, 1, 4]);
	resources.clearAll();
	[...running, film, poster].forEach((request) => request.release());
});

test("memory byte budget evicts cached large results without breaking existing leases", async () => {
	let decodes = 0;
	const resources = new MediaPreviewResources(async () => {
		decodes++;
		return { status: "ready", url: "x".repeat(128 * 1024) };
	});
	const file = new File(["video"], "a.mp4");
	const requests = [];
	for (let time = 0; time < 34; time++) {
		const request = resources.acquire({ file, time });
		requests.push(request);
		await request.promise;
	}
	const reacquired = resources.acquire({ file, time: 0 });
	await reacquired.promise;
	expect(decodes).toBe(35);
	expect((await requests[0].promise).status).toBe("ready");
	[...requests, reacquired].forEach((request) => request.release());
});

test("native fallback runs once only for eligible browser failures, never offline or ready", async () => {
	for (const status of ["failed", "unsupported", "offline", "ready"] as const) {
		const calls: {
			mediaId: string;
			sourceSha256: string;
			timeSeconds: number;
			signal: AbortSignal;
		}[] = [];
		const resources = new MediaPreviewResources({
			decode: async () =>
				status === "ready" ? { status, url: "frame" } : { status },
			nativeProvider: {
				renderFrame: async (request) => {
					calls.push(request);
					return null;
				},
			},
		});
		const request = resources.acquire({
			file: new File(["video"], "a.mp4"),
			time: 2,
			mediaId: "imported",
			sourceSha256: "sha",
			projectId: "p",
		});
		expect((await request.promise).status).toBe(status);
		expect(calls.length).toBe(
			status === "failed" || status === "unsupported" ? 1 : 0,
		);
		if (calls[0])
			expect(calls[0]).toMatchObject({
				mediaId: "imported",
				sourceSha256: "sha",
				timeSeconds: 2,
			});
		request.release();
	}
});

test("native fallback requires imported identity and SHA; abort never falls through", async () => {
	let calls = 0;
	const resources = new MediaPreviewResources({
		decode: async () => ({ status: "unsupported" }),
		nativeProvider: {
			renderFrame: async () => {
				calls++;
				return null;
			},
		},
	});
	const file = new File(["video"], "a.mp4");
	for (const args of [{ mediaId: "a" }, { sourceSha256: "sha" }, {}]) {
		const request = resources.acquire({ file, time: calls, ...args });
		await request.promise;
		request.release();
	}
	expect(calls).toBe(0);
	const aborted = new MediaPreviewResources({
		decode: ({ signal }) =>
			new Promise((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(new Error("aborted")), {
					once: true,
				}),
			),
		nativeProvider: {
			renderFrame: async () => {
				calls++;
				return null;
			},
		},
	});
	const request = aborted.acquire({
		file,
		time: 0,
		mediaId: "a",
		sourceSha256: "sha",
	});
	request.release();
	expect((await request.promise).status).toBe("failed");
	expect(calls).toBe(0);
});
