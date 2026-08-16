import { describe, expect, test } from "bun:test";
import {
	ExportJobError,
	ExportJobStore,
	ExportJobTransitionError,
	InMemoryExportJobProvider,
} from "../export-jobs";
import type { ExportJobEvent, ExportJobRequest } from "../export-jobs";

function request(overrides: Partial<ExportJobRequest> = {}): ExportJobRequest {
	return { projectId: "p1", format: "mp4", ...overrides };
}

function openedStore(options: { jobId?: string; now?: number } = {}): ExportJobStore {
	return ExportJobStore.open({
		jobId: options.jobId ?? "job-x",
		request: request(),
		now: options.now,
	});
}

/**
 * A provider whose scheduler is a manual queue and whose clock is a counter —
 * the two seams the reference exposes for determinism. `drain` runs every
 * scheduled step (including steps scheduled by steps) until the queue empties.
 */
function manualProvider() {
	let tick = 0;
	const steps: Array<() => void> = [];
	const provider = new InMemoryExportJobProvider({
		clock: () => {
			tick += 1;
			return tick;
		},
		scheduler: (fn) => {
			steps.push(fn);
		},
	});
	const drain = () => {
		while (steps.length > 0) steps.shift()!();
	};
	const runSteps = (count: number) => {
		for (let i = 0; i < count; i += 1) steps.shift()!();
	};
	return { provider, drain, runSteps, pendingSteps: () => steps.length };
}

describe("the export-job store", () => {
	test("open starts queued at progress zero", () => {
		const store = openedStore({ jobId: "job-a" });
		expect(store.snapshot()).toMatchObject({
			jobId: "job-a",
			phase: "queued",
			progress: 0,
			output: null,
			error: null,
			frames: null,
		});
		expect(store.events()).toEqual([
			{ type: "phase", phase: "queued", at: 0 },
		]);
	});

	test("render progress tracks accepted over total and never decreases", () => {
		const store = openedStore()
			.beginRendering({ totalFrames: 30 })
			.acceptFrames({ count: 10 })
			.acceptFrames({ count: 5 })
			.acceptFrames({ count: 15 });
		const seen: number[] = [];
		for (const event of store.events()) {
			if (event.type === "progress") seen.push(event.progress);
		}
		expect(seen).toEqual([10 / 30, 15 / 30, 1]);
		expect(store.snapshot()).toMatchObject({
			phase: "rendering",
			progress: 1,
			frames: { accepted: 30, total: 30 },
		});
	});

	test("acceptFrames throws on a frame overshoot rather than absorbing it", () => {
		const store = openedStore().beginRendering({ totalFrames: 3 }).acceptFrames({ count: 2 });
		expect(() => store.acceptFrames({ count: 2 })).toThrow(ExportJobTransitionError);
		expect(store.snapshot().frames).toEqual({ accepted: 2, total: 3 });
	});

	test("beginEncoding resets the progress scale and refuses a decrease", () => {
		const rendering = openedStore()
			.beginRendering({ totalFrames: 10 })
			.acceptFrames({ count: 10 });
		const encoding = rendering.beginEncoding();
		expect(encoding.snapshot()).toMatchObject({
			phase: "encoding",
			progress: 0,
			frames: { accepted: 10, total: 10 },
		});
		const half = encoding.setEncodeProgress({ progress: 0.5 });
		expect(half.snapshot().progress).toBe(0.5);
		expect(() => half.setEncodeProgress({ progress: 0.25 })).toThrow(ExportJobTransitionError);
		const clamped = half.setEncodeProgress({ progress: 7 });
		expect(clamped.snapshot().progress).toBe(1);
		expect(() => clamped.setEncodeProgress({ progress: 0.9 })).toThrow(ExportJobTransitionError);
	});

	test("encode progress clamps an out-of-range value into [0, 1]", () => {
		const encoding = openedStore()
			.beginRendering({ totalFrames: 4 })
			.acceptFrames({ count: 4 })
			.beginEncoding();
		expect(encoding.setEncodeProgress({ progress: -0.5 }).snapshot().progress).toBe(0);
		expect(encoding.setEncodeProgress({ progress: 2 }).snapshot().progress).toBe(1);
	});

	test("illegal transitions throw ExportJobTransitionError", () => {
		const completed = openedStore()
			.beginRendering({ totalFrames: 2 })
			.acceptFrames({ count: 2 })
			.beginEncoding()
			.setEncodeProgress({ progress: 1 })
			.complete({ output: { descriptor: "memory:job-x", bytes: 8 } });
		expect(() =>
			completed.complete({ output: { descriptor: "memory:job-x", bytes: 8 } }),
		).toThrow(ExportJobTransitionError);

		const failed = openedStore().fail({ reason: "encoder missing" });
		expect(() => failed.resume()).toThrow(ExportJobTransitionError);

		const encoding = openedStore()
			.beginRendering({ totalFrames: 2 })
			.acceptFrames({ count: 2 })
			.beginEncoding();
		expect(() => encoding.acceptFrames({ count: 1 })).toThrow(ExportJobTransitionError);

		const partialRender = openedStore()
			.beginRendering({ totalFrames: 2 })
			.acceptFrames({ count: 1 });
		expect(() => partialRender.beginEncoding()).toThrow(ExportJobTransitionError);

		expect(() => openedStore().confirmCancelled()).toThrow(
			ExportJobTransitionError,
		);
	});

	test("cancel is two-step: the request stops work, the confirm settles", () => {
		const store = openedStore().beginRendering({ totalFrames: 10 }).acceptFrames({ count: 4 });
		const requested = store.requestCancel();
		// The window between request and settle exists for resource cleanup; the
		// phase has not moved yet, but work must stop.
		expect(requested.snapshot().phase).toBe("rendering");
		expect(() => requested.acceptFrames({ count: 1 })).toThrow(ExportJobTransitionError);
		const cancelled = requested.confirmCancelled();
		expect(cancelled.snapshot()).toMatchObject({
			phase: "cancelled",
			progress: 0.4,
			frames: { accepted: 4, total: 10 },
		});
		expect(
			cancelled.events().some((event) => event.type === "settled"),
		).toBe(true);
	});

	test("a cancel requested in queued goes straight to cancelled via confirm", () => {
		const cancelled = openedStore().requestCancel().confirmCancelled();
		expect(cancelled.snapshot().phase).toBe("cancelled");
	});

	test("interrupt keeps frames, resume is frame-accurate to the original totals", () => {
		const interrupted = openedStore()
			.beginRendering({ totalFrames: 30 })
			.acceptFrames({ count: 17 })
			.interrupt();
		expect(interrupted.snapshot()).toMatchObject({
			phase: "interrupted",
			progress: 17 / 30,
			frames: { accepted: 17, total: 30 },
		});
		const completed = interrupted
			.resume()
			.acceptFrames({ count: 13 })
			.beginEncoding()
			.setEncodeProgress({ progress: 1 })
			.complete({ output: { descriptor: "memory:job-x", bytes: 8 } });
		// Frame accuracy: the resumed run's totals equal the never-interrupted run's.
		expect(completed.snapshot().frames).toEqual({ accepted: 30, total: 30 });
		expect(completed.snapshot().phase).toBe("completed");
	});

	test("transitions are immutable — the receiver keeps its own phase and events", () => {
		const first = openedStore();
		const second = first.beginRendering({ totalFrames: 5 });
		expect(first.snapshot().phase).toBe("queued");
		expect(second.snapshot().phase).toBe("rendering");
		expect(second.events().length).toBe(first.events().length + 1);
	});

	test("the reducer takes a caller-supplied clock and falls back to sequence ordinals", () => {
		const store = openedStore({ jobId: "job-c", now: 100 })
			.beginRendering({ totalFrames: 4, now: 150 })
			.acceptFrames({ count: 4 });
		const ats = store.events().map((event) => event.at);
		expect(ats).toEqual([100, 150, 151]);
	});

	test("discardable is false only inside the cancel window", () => {
		expect(openedStore().discardable()).toBe(true);
		const requested = openedStore().requestCancel();
		expect(requested.discardable()).toBe(false);
		const cancelled = requested.confirmCancelled();
		expect(cancelled.discardable()).toBe(true);
		const completed = openedStore()
			.beginRendering({ totalFrames: 1 })
			.acceptFrames({ count: 1 })
			.beginEncoding()
			.setEncodeProgress({ progress: 1 })
			.complete({ output: { descriptor: "memory:job-x", bytes: 1 } });
		expect(completed.discardable()).toBe(true);
		// A pending cancel that survived `fail` or `interrupt` would close the
		// window forever: discardable() false on a settled or dead job, and a
		// resumed job refusing all work. Both departures clear the flag.
		const failedPending = openedStore()
			.beginRendering({ totalFrames: 2 })
			.requestCancel()
			.fail({ reason: "boom" });
		expect(failedPending.discardable()).toBe(true);
		const interruptedPending = openedStore()
			.beginRendering({ totalFrames: 2 })
			.acceptFrames({ count: 1 })
			.requestCancel()
			.interrupt();
		expect(interruptedPending.discardable()).toBe(true);
		const resumed = interruptedPending.resume();
		expect(() => resumed.acceptFrames({ count: 1 })).not.toThrow();
	});
});

describe("the in-memory reference provider", () => {
	test("start returns an identity immediately with a zero-progress snapshot", async () => {
		const { provider } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		expect(typeof jobId).toBe("string");
		expect(jobId.length).toBeGreaterThan(0);
		const snapshot = provider.getJob({ jobId });
		expect(snapshot).toMatchObject({ jobId, phase: "queued", progress: 0 });
		expect(provider.listJobs().map((job) => job.jobId)).toEqual([jobId]);
	});

	test("a run completes with an opaque output descriptor, never a path", async () => {
		const { provider, drain } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		drain();
		const snapshot = provider.getJob({ jobId });
		expect(snapshot).toMatchObject({
			phase: "completed",
			progress: 1,
			frames: { accepted: 30, total: 30 },
		});
		// The type contract is opacity (see ExportJobOutput); at the provider
		// level that means the reference's own descriptor scheme and no path.
		expect(snapshot?.output?.descriptor).toBe(`memory:${jobId}`);
		expect(snapshot?.output?.descriptor).not.toContain("/");
		expect(snapshot?.output?.descriptor).not.toContain("\\");
		expect(snapshot?.output?.bytes).toBeGreaterThan(0);
	});

	test("subscribers receive phase, progress, and settled events in order", async () => {
		const { provider, drain } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		const received: ExportJobEvent[] = [];
		provider.onJobEvent({
			jobId,
			handler: (event) => {
				received.push(event);
			},
		});
		drain();
		const types = received.map((event) => event.type);
		expect(types).toContain("phase");
		expect(types).toContain("progress");
		expect(types[types.length - 1]).toBe("settled");
		// The provider supplies the clock at its boundary; `at` values move.
		const ats = received.map((event) => event.at);
		expect([...ats].sort((a, b) => a - b)).toEqual(ats);

		const renderProgress = received.filter(
			(event) => event.type === "progress" && event.frames !== undefined,
		);
		expect(renderProgress.map((event) => event.progress)).toEqual([
			10 / 30,
			20 / 30,
			1,
		]);
	});

	test("unsubscribed handlers receive nothing further", async () => {
		const { provider, drain, runSteps } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		const received: ExportJobEvent[] = [];
		const { unsubscribe } = provider.onJobEvent({
			jobId,
			handler: (event) => {
				received.push(event);
			},
		});
		runSteps(1);
		const countAtUnsubscribe = received.length;
		unsubscribe();
		drain();
		expect(received.length).toBe(countAtUnsubscribe);
	});

	test("readJobOutputBytes returns an ArrayBuffer matching the output byte count, defensively copied", async () => {
		const { provider, drain } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		drain();
		const snapshot = provider.getJob({ jobId });
		const bytes = await provider.readJobOutputBytes({ jobId });
		expect(bytes).toBeInstanceOf(ArrayBuffer);
		expect(bytes.byteLength).toBe(snapshot?.output?.bytes);
		new Uint8Array(bytes).fill(255);
		const again = await provider.readJobOutputBytes({ jobId });
		expect(new Uint8Array(again)[0]).toBe(0);
	});

	test("cancel stops the synthetic run, settles cancelled, and is idempotent", async () => {
		const { provider, drain, runSteps, pendingSteps } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		runSteps(2); // beginRendering + first frame batch
		const cancelled = await provider.cancelJob({ jobId });
		expect(cancelled.phase).toBe("cancelled");
		drain(); // any already-scheduled step must not revive the job
		expect(provider.getJob({ jobId })?.phase).toBe("cancelled");
		expect(pendingSteps()).toBe(0);
		const again = await provider.cancelJob({ jobId });
		expect(again.phase).toBe("cancelled");
	});

	test("cancel after completion reports the settled state without error", async () => {
		const { provider, drain } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		drain();
		const snapshot = await provider.cancelJob({ jobId });
		expect(snapshot.phase).toBe("completed");
	});

	test("an interrupted provider job resumes and completes with the original totals", async () => {
		const { provider, drain, runSteps } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		runSteps(2); // rendering, 10/30 accepted
		provider.__interrupt(jobId); // test-only stand-in for a dead producer
		expect(provider.getJob({ jobId })).toMatchObject({
			phase: "interrupted",
			frames: { accepted: 10, total: 30 },
		});
		const resumed = await provider.resumeJob({ jobId });
		expect(resumed.jobId).toBe(jobId);
		expect(provider.getJob({ jobId })?.phase).toBe("rendering");
		drain();
		const snapshot = provider.getJob({ jobId });
		expect(snapshot).toMatchObject({
			phase: "completed",
			frames: { accepted: 30, total: 30 },
		});
		const bytes = await provider.readJobOutputBytes({ jobId });
		expect(bytes.byteLength).toBe(snapshot?.output?.bytes);
	});

	test("discard removes the job from lookups and listings", async () => {
		const { provider, drain, runSteps } = manualProvider();
		const { jobId } = await provider.startJob({ request: request() });
		runSteps(1);
		await provider.discardJob({ jobId });
		expect(provider.getJob({ jobId })).toBeNull();
		expect(provider.listJobs()).toEqual([]);

		const { jobId: finished } = await provider.startJob({ request: request() });
		drain();
		expect(provider.getJob({ jobId: finished })?.phase).toBe("completed");
		await provider.discardJob({ jobId: finished }); // settled jobs are discardable
		expect(provider.listJobs()).toEqual([]);
	});

	test("invalid start requests throw ExportJobError and canStartJob answers honestly", async () => {
		const { provider } = manualProvider();
		const invalid = request({ projectId: "" });
		expect(provider.canStartJob({ request: invalid })).toBe(false);
		await expect(provider.startJob({ request: invalid })).rejects.toThrow(
			ExportJobError,
		);
		// F7: the format set stays open — any non-empty string starts (S08 closes it).
		const exotic = request({ format: "mov" });
		expect(provider.canStartJob({ request: exotic })).toBe(true);
		const { jobId } = await provider.startJob({ request: exotic });
		expect(provider.getJob({ jobId })?.request.format).toBe("mov");
	});

	test("unknown job ids and premature byte reads throw ExportJobError", async () => {
		const { provider } = manualProvider();
		await expect(provider.cancelJob({ jobId: "nope" })).rejects.toThrow(
			ExportJobError,
		);
		await expect(provider.discardJob({ jobId: "nope" })).rejects.toThrow(
			ExportJobError,
		);
		expect(provider.getJob({ jobId: "nope" })).toBeNull();
		const { jobId } = await provider.startJob({ request: request() });
		await expect(provider.readJobOutputBytes({ jobId })).rejects.toThrow(
			ExportJobError,
		);
	});

	test("the default scheduler and clock drive a run to completion", async () => {
		// The seams above are for determinism; this leg proves the defaults a
		// headless Host actually gets (queueMicrotask, Date.now) also settle a
		// run. See ProviderOptions.scheduler for why the default is a microtask
		// and not a timer: this source sits inside the C6 resource boundary.
		const provider = new InMemoryExportJobProvider();
		const { jobId } = await provider.startJob({ request: request() });
		for (let i = 0; i < 40 && provider.getJob({ jobId })?.phase !== "completed"; i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(provider.getJob({ jobId })?.phase).toBe("completed");
	});
});
