import { expect, test } from "bun:test";
import { createNativeFrameSlots } from "../programmatic/frame-job-slots";
import {
	createProgrammaticFrameDeadline,
	type FrameRouteClock,
} from "../programmatic/frame-service-deadline";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function occupyTwo(slots = createNativeFrameSlots()) {
	const a = new AbortController();
	const b = new AbortController();
	const releaseA = (await slots.acquire(a.signal))!;
	const releaseB = (await slots.acquire(b.signal))!;
	return { slots, a, b, releaseA, releaseB };
}

function recordSettlement<T>(promise: Promise<T>) {
	let settled = false;
	const result = promise.then(
		(value) => {
			settled = true;
			return value;
		},
		(reason: unknown) => {
			settled = true;
			throw reason;
		},
	);
	return { result, settled: () => settled };
}

/** CPU ownership fixture for the planned route integration, not an HTTP or
 * browser oracle. Native work must await its cleanup gate before releasing.
 */
function routeOwnershipFixture() {
	const slots = createNativeFrameSlots();
	const routes = new Map<AbortController, Promise<void>>();
	let disposed = false;
	let native = 0;
	let highWater = 0;
	const start = (
		controller: AbortController,
		render: (signal: AbortSignal) => Promise<void>,
	) => {
		const started = deferred<void>();
		const result = (async () => {
			if (disposed) return 503;
			const drain = deferred<void>();
			routes.set(controller, drain.promise);
			let release: (() => void) | null = null;
			let admitted = false;
			try {
				release = await slots.acquire(controller.signal);
				if (!release) return 429;
				controller.signal.throwIfAborted();
				admitted = true;
				native++;
				highWater = Math.max(highWater, native);
				started.resolve();
				await render(controller.signal);
				controller.signal.throwIfAborted();
				return 200;
			} catch {
				return controller.signal.aborted ? 408 : 422;
			} finally {
				if (admitted) native--;
				routes.delete(controller);
				drain.resolve();
				release?.();
			}
		})();
		return { result, started: started.promise };
	};
	return {
		start,
		counts: () => ({ native, highWater, routes: routes.size }),
		async dispose() {
			disposed = true;
			for (const controller of routes.keys()) controller.abort();
			await Promise.all(routes.values());
		},
	};
}

function cancelledNativeWork(cleanup: Promise<void>) {
	return async (signal: AbortSignal) => {
		try {
			await new Promise<never>((_resolve, reject) => {
				const abort = () => reject(signal.reason);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			});
		} finally {
			await cleanup;
		}
	};
}

test("1: two live native frames reject ordinary overload without starting a third", async () => {
	const h = await occupyTwo();
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.releaseA();
	const releaseC = await h.slots.acquire(new AbortController().signal);
	expect(releaseC).toBeInstanceOf(Function);
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.releaseB();
	releaseC!();
});

test("2: aborted jobs retain native capacity until their actual cleanup completes", async () => {
	const h = routeOwnershipFixture();
	const a = new AbortController(), b = new AbortController();
	const cleanupA = deferred<void>(), cleanupB = deferred<void>();
	const jobA = h.start(a, cancelledNativeWork(cleanupA.promise));
	const jobB = h.start(b, cancelledNativeWork(cleanupB.promise));
	await Promise.all([jobA.started, jobB.started]);
	a.abort(); b.abort();
	const finishC = deferred<void>();
	const jobC = h.start(new AbortController(), () => finishC.promise);
	const observed = recordSettlement(jobC.started);
	await Promise.resolve();
	expect(observed.settled()).toBe(false);
	expect(h.counts()).toEqual({ native: 2, highWater: 2, routes: 3 });
	cleanupA.resolve();
	expect(await jobA.result).toBe(408);
	await observed.result;
	expect(h.counts()).toEqual({ native: 2, highWater: 2, routes: 2 });
	cleanupB.resolve();
	expect(await jobB.result).toBe(408);
	finishC.resolve();
	expect(await jobC.result).toBe(200);
	expect(h.counts()).toEqual({ native: 0, highWater: 2, routes: 0 });
});

test("3: pending replacements are FIFO and bounded to two", async () => {
	const h = await occupyTwo();
	h.a.abort(); h.b.abort();
	const order: string[] = [];
	const c = h.slots.acquire(new AbortController().signal).then((release) => {
		order.push("c"); return release;
	});
	const d = h.slots.acquire(new AbortController().signal).then((release) => {
		order.push("d"); return release;
	});
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.releaseA();
	const releaseC = await c;
	expect(order).toEqual(["c"]);
	h.releaseB();
	const releaseD = await d;
	expect(order).toEqual(["c", "d"]);
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	releaseC!(); releaseD!();
});

test("4: duplicate release never frees a replacement's slot", async () => {
	const h = await occupyTwo();
	h.a.abort();
	const replacement = h.slots.acquire(new AbortController().signal);
	h.releaseA();
	const releaseC = await replacement;
	h.releaseA(); h.releaseA();
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.releaseB(); releaseC!();
});

test("5: waiting cancellation preserves reason and immediately reclaims queue capacity", async () => {
	const h = await occupyTwo();
	h.a.abort();
	const c = new AbortController();
	const reason = new Error("superseded queued frame");
	const cancelled = h.slots.acquire(c.signal).catch((error: unknown) => error);
	const d = h.slots.acquire(new AbortController().signal);
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	c.abort(reason);
	expect(await cancelled).toBe(reason);
	const e = h.slots.acquire(new AbortController().signal);
	h.releaseA(); const releaseD = await d;
	h.releaseB(); const releaseE = await e;
	expect(releaseD).toBeInstanceOf(Function);
	expect(releaseE).toBeInstanceOf(Function);
	releaseD!(); releaseE!();
});

test("6: already aborted callers never consume native or pending capacity", async () => {
	const slots = createNativeFrameSlots();
	const reason = new Error("already cancelled");
	expect(await slots.acquire(AbortSignal.abort(reason)).catch((error: unknown) => error)).toBe(reason);
	const h = await occupyTwo(slots);
	h.a.abort();
	expect(await slots.acquire(AbortSignal.abort(reason)).catch((error: unknown) => error)).toBe(reason);
	const c = slots.acquire(new AbortController().signal);
	const d = slots.acquire(new AbortController().signal);
	h.releaseA(); h.releaseB();
	(await c)!(); (await d)!();
});

test("7: cancellation before a grant skips the stale waiter and admits the latest one", async () => {
	const h = await occupyTwo();
	h.a.abort();
	const stale = new AbortController();
	const reason = new Error("newer frame");
	const cancelled = h.slots.acquire(stale.signal).catch((error: unknown) => error);
	const latest = h.slots.acquire(new AbortController().signal);
	stale.abort(reason);
	h.releaseA();
	expect(await cancelled).toBe(reason);
	const releaseLatest = await latest;
	expect(releaseLatest).toBeInstanceOf(Function);
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.releaseB(); releaseLatest!();
});

test("8: grant followed by abort before await continuation cannot launch native work", async () => {
	const h = await occupyTwo();
	h.a.abort();
	const waiting = new AbortController();
	let launched = false;
	const reason = new Error("cancelled just after grant");
	const result = (async () => {
		const release = await h.slots.acquire(waiting.signal);
		try {
			waiting.signal.throwIfAborted();
			launched = true;
		} finally {
			release?.();
		}
	})().catch((error: unknown) => error);
	h.releaseA();
	waiting.abort(reason);
	expect(await result).toBe(reason);
	expect(launched).toBe(false);
	const replacement = await h.slots.acquire(new AbortController().signal);
	expect(replacement).toBeInstanceOf(Function);
	h.releaseB(); replacement!();
});

test("9: render or cleanup failures release capacity without reporting success", async () => {
	const h = routeOwnershipFixture();
	const renderFailure = h.start(new AbortController(), async () => {
		throw new Error("render failed");
	});
	expect(await renderFailure.result).toBe(422);
	const cleanupGate = deferred<void>();
	const cleanupFailure = h.start(new AbortController(), async () => {
		try { throw new Error("primary failure"); }
		finally { await cleanupGate.promise; }
	});
	await cleanupFailure.started;
	expect(h.counts().native).toBe(1);
	cleanupGate.reject(new Error("cleanup failed"));
	expect(await cleanupFailure.result).toBe(422);
	const success = h.start(new AbortController(), async () => {});
	expect(await success.result).toBe(200);
	expect(h.counts()).toEqual({ native: 0, highWater: 1, routes: 0 });
});

test("10: dispose cancels active and queued owners but awaits true native cleanup", async () => {
	const h = routeOwnershipFixture();
	const a = new AbortController(), b = new AbortController();
	const cleanupA = deferred<void>(), cleanupB = deferred<void>();
	const jobA = h.start(a, cancelledNativeWork(cleanupA.promise));
	const jobB = h.start(b, cancelledNativeWork(cleanupB.promise));
	await Promise.all([jobA.started, jobB.started]);
	a.abort();
	let queuedLaunches = 0;
	const queuedRender = async () => { queuedLaunches++; };
	const jobC = h.start(new AbortController(), queuedRender);
	const jobD = h.start(new AbortController(), queuedRender);
	const disposal = recordSettlement(h.dispose());
	expect(await jobC.result).toBe(408);
	expect(await jobD.result).toBe(408);
	expect(disposal.settled()).toBe(false);
	expect(await h.start(new AbortController(), queuedRender).result).toBe(503);
	cleanupA.resolve(); expect(await jobA.result).toBe(408);
	expect(disposal.settled()).toBe(false);
	cleanupB.resolve(); expect(await jobB.result).toBe(408);
	await disposal.result;
	expect(queuedLaunches).toBe(0);
	expect(h.counts()).toEqual({ native: 0, highWater: 2, routes: 0 });
});

test("11: original 15 second arrival deadline cancels a queued Glass frame without revival", async () => {
	const h = await occupyTwo();
	h.a.abort();
	let now = 1000;
	const timers = new Map<() => void, number>();
	const clock: FrameRouteClock = {
		now: () => now,
		schedule(callback, delayMs) {
			timers.set(callback, now + delayMs);
			return () => { timers.delete(callback); };
		},
	};
	const controller = new AbortController();
	const deadline = createProgrammaticFrameDeadline({ controller, startedAt: now, clock });
	const result = h.slots.acquire(controller.signal).catch((error: unknown) => error);
	now = 15999;
	expect(controller.signal.aborted).toBe(false);
	now = 16000;
	for (const [callback, at] of [...timers]) if (at <= now) callback();
	expect(controller.signal.aborted).toBe(true);
	expect(await result).toBe(controller.signal.reason);
	expect(timers.size).toBe(0);
	h.releaseA(); h.releaseB();
	const release = await h.slots.acquire(new AbortController().signal);
	expect(release).toBeInstanceOf(Function);
	release!(); deadline.dispose();
});

test("12: replacement before Host observes cancellation stays ordinary live-overload busy", async () => {
	const h = await occupyTwo();
	// Client supersession alone does not mark the Host controllers aborted.
	expect(await h.slots.acquire(new AbortController().signal)).toBeNull();
	h.a.abort();
	const replacement = recordSettlement(h.slots.acquire(new AbortController().signal));
	await Promise.resolve();
	expect(replacement.settled()).toBe(false);
	h.releaseA();
	const release = await replacement.result;
	expect(release).toBeInstanceOf(Function);
	h.releaseB(); release!();
});

test("13: sharing an AbortSignal never merges two independent native leases", async () => {
	const slots = createNativeFrameSlots();
	const controller = new AbortController();
	const releaseA = (await slots.acquire(controller.signal))!;
	const releaseB = (await slots.acquire(controller.signal))!;
	expect(await slots.acquire(new AbortController().signal)).toBeNull();
	controller.abort();
	const replacement = slots.acquire(new AbortController().signal);
	releaseA();
	const releaseC = await replacement;
	releaseA();
	const next = recordSettlement(slots.acquire(new AbortController().signal));
	await Promise.resolve(); expect(next.settled()).toBe(false);
	releaseB(); const releaseD = await next.result;
	expect(await slots.acquire(new AbortController().signal)).toBeNull();
	releaseC!(); releaseD!();
});
