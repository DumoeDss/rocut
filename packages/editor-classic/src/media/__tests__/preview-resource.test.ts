import { describe, expect, test } from "bun:test";
import {
	MediaPreviewResources,
	type MediaPreviewResult,
} from "../preview-resource";

describe("media preview resources", () => {
	test("cancelled non-settling decoders cannot starve rapid zoom and reverse requests", async () => {
		const signals: AbortSignal[] = [];
		const resources = new MediaPreviewResources(async ({ time, signal }) => {
			signals.push(signal);
			if (time < 2) return await new Promise<MediaPreviewResult>(() => {});
			return { status: "ready", url: `frame:${time}` };
		});
		const file = new File(["video"], "zoom.mp4");
		const old = [0, 1].map((time) => resources.acquire({ file, time }));
		const queued = Array.from({ length: 8 }, (_, index) =>
			resources.acquire({ file, time: index + 2 }),
		);
		[...old, ...queued].forEach((request) => request.release());
		const reverse = Array.from({ length: 10 }, (_, index) =>
			resources.acquire({ file, time: 20 - index }),
		);
		expect(
			(await Promise.all(old.map((request) => request.promise))).every(
				(result) => result.status === "failed",
			),
		).toBe(true);
		expect(
			await Promise.all(reverse.map((request) => request.promise)),
		).toEqual(
			Array.from({ length: 10 }, (_, index) => ({
				status: "ready",
				url: `frame:${20 - index}`,
			})),
		);
		expect(signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
		reverse.forEach((request) => request.release());
	});
	test("clear and reacquire survive old leases releasing after the new identity", async () => {
		const calls: number[] = [];
		let complete!: (result: MediaPreviewResult) => void;
		const resources = new MediaPreviewResources(({ time }) => {
			calls.push(time);
			return new Promise((resolve) => {
				complete = resolve;
			});
		});
		const file = new File(["video"], "same.mp4");
		const old = resources.acquire({ file, time: 1 });
		resources.clearAll();
		const next = resources.acquire({ file, time: 1 });
		old.release();
		const duplicate = resources.acquire({ file, time: 1 });
		expect(duplicate.promise).toBe(next.promise);
		expect(calls).toEqual([1, 1]);
		complete({ status: "ready", url: "current" });
		expect(await next.promise).toEqual({ status: "ready", url: "current" });
		next.release();
		duplicate.release();
	});
	test("deduplicates exact source time without sharing another file's results", async () => {
		const calls: string[] = [];
		const resources = new MediaPreviewResources(async ({ file, time }) => {
			calls.push(`${file.name}:${time}`);
			return { status: "ready", url: `${file.name}:${time}` };
		});
		const a = new File(["a"], "a.mp4");
		const b = new File(["b"], "b.mp4");
		const first = resources.acquire({ file: a, time: 2 });
		const duplicate = resources.acquire({ file: a, time: 2 });
		const differentTime = resources.acquire({ file: a, time: 3 });
		const differentFile = resources.acquire({ file: b, time: 2 });
		expect(first.promise).toBe(duplicate.promise);
		expect(await differentTime.promise).toEqual({
			status: "ready",
			url: "a.mp4:3",
		});
		expect(await differentFile.promise).toEqual({
			status: "ready",
			url: "b.mp4:2",
		});
		expect(calls).toEqual(["a.mp4:2", "a.mp4:3", "b.mp4:2"]);
		[first, duplicate, differentTime, differentFile].forEach((request) =>
			request.release(),
		);
	});

	test("a cancelled project's late frame cannot populate a new project's request", async () => {
		const pending: ((value: MediaPreviewResult) => void)[] = [];
		const resources = new MediaPreviewResources(
			() => new Promise((resolve) => pending.push(resolve)),
		);
		const file = new File(["video"], "same.mp4");
		const old = resources.acquire({ file, time: 2, projectId: "old" });
		old.release();
		const next = resources.acquire({ file, time: 2, projectId: "next" });
		pending[0]({ status: "ready", url: "old-frame" });
		pending[1]({ status: "ready", url: "next-frame" });
		expect((await old.promise).status).toBe("failed");
		expect(await next.promise).toEqual({ status: "ready", url: "next-frame" });
		next.release();
	});

	test("limits decoders and removes cancelled queued work", async () => {
		const running: {
			resolve: (value: MediaPreviewResult) => void;
			signal: AbortSignal;
		}[] = [];
		const resources = new MediaPreviewResources(
			({ signal }) =>
				new Promise((resolve) => running.push({ resolve, signal })),
		);
		const file = new File(["video"], "video.mp4");
		const first = resources.acquire({ file, time: 1 });
		const second = resources.acquire({ file, time: 2 });
		const third = resources.acquire({ file, time: 3 });
		expect(running).toHaveLength(2);
		third.release();
		expect((await third.promise).status).toBe("failed");
		first.release();
		expect(running[0].signal.aborted).toBe(true);
		running.forEach(({ resolve }) =>
			resolve({ status: "ready", url: "frame" }),
		);
		await Promise.all([first.promise, second.promise]);
		await Promise.resolve();
		expect(running).toHaveLength(2);
		second.release();
	});

	test("bounds queued work and clears pending requests when a session retires", async () => {
		const running: {
			resolve: (value: MediaPreviewResult) => void;
			signal: AbortSignal;
		}[] = [];
		const resources = new MediaPreviewResources(
			({ signal }) =>
				new Promise((resolve) => running.push({ resolve, signal })),
		);
		const file = new File(["video"], "video.mp4");
		const requests = Array.from({ length: 130 }, (_, time) =>
			resources.acquire({ file, time }),
		);
		const overflow = resources.acquire({ file, time: 131 });
		expect(await overflow.promise).toMatchObject({
			status: "failed",
			error: "Preview queue is full. Scroll to retry.",
		});
		expect(running).toHaveLength(2);
		resources.clearAll();
		expect(running.every(({ signal }) => signal.aborted)).toBe(true);
		expect(
			(await Promise.all(requests.map((request) => request.promise))).every(
				(result) => result.status === "failed",
			),
		).toBe(true);
		running.forEach(({ resolve }) =>
			resolve({ status: "ready", url: "stale" }),
		);
		requests.forEach((request) => request.release());
		overflow.release();
	});
});
