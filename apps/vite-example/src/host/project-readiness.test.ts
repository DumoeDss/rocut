import { expect, test } from "bun:test";
import { createProjectReadiness } from "./project-readiness";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture() {
	let preview: (() => void) | undefined;
	const loads: ReturnType<typeof deferred>[] = [];
	const readiness = createProjectReadiness({
		reload: () => {
			const load = deferred();
			loads.push(load);
			return load.promise;
		},
		schedule: (run) => {
			preview = run;
			return () => {
				preview = undefined;
			};
		},
	});
	return {
		readiness,
		loads,
		preview: () => preview?.(),
		scheduled: () => !!preview,
	};
}

test("immediate export flushes pending preview debounce and waits for hydration", async () => {
	const f = fixture();
	let exports = 0;
	f.readiness.changed();
	expect(f.scheduled()).toBe(true);
	const request = f.readiness.whenReady().then(() => {
		exports++;
	});
	expect(f.scheduled()).toBe(false);
	await Promise.resolve();
	expect(f.loads).toHaveLength(1);
	expect(exports).toBe(0);
	f.loads[0].resolve();
	await request;
	expect(exports).toBe(1);
	expect(f.loads).toHaveLength(1);
});

test("inflight reload and another revision serialize before waiting export starts", async () => {
	const f = fixture();
	let exports = 0;
	f.readiness.changed();
	f.preview();
	await Promise.resolve();
	const one = f.readiness.whenReady().then(() => {
		exports++;
	});
	const two = f.readiness.whenReady();
	f.readiness.changed();
	f.readiness.changed();
	expect(f.loads).toHaveLength(1);
	f.loads[0].resolve();
	await Promise.resolve();
	await Promise.resolve();
	expect(f.loads).toHaveLength(2);
	expect(exports).toBe(0);
	f.loads[1].resolve();
	await Promise.all([one, two]);
	expect(exports).toBe(1);
	expect(f.loads).toHaveLength(2);
});

test("failed hydration rejects export and is not silently retried", async () => {
	const f = fixture();
	let exports = 0;
	f.readiness.changed();
	const request = f.readiness.whenReady().then(() => {
		exports++;
	});
	const rejected = request.catch((error: unknown) => error);
	await Promise.resolve();
	f.loads[0].reject(Error("hydrate failed"));
	expect(await rejected).toMatchObject({ message: "hydrate failed" });
	await expect(f.readiness.whenReady()).rejects.toThrow("hydrate failed");
	expect(exports).toBe(0);
	expect(f.loads).toHaveLength(1);
	// A genuinely new revision may hydrate again; no retry of the failed event.
	f.readiness.changed();
	const next = f.readiness.whenReady();
	await Promise.resolve();
	f.loads[1].resolve();
	await next;
	expect(f.loads).toHaveLength(2);
});

test("a revision after export admission is not blocked by the running request", async () => {
	const f = fixture();
	const exported = deferred();
	const admitted = deferred();
	let started = false;
	const request = f.readiness.whenReady().then(() => {
		started = true;
		admitted.resolve();
		return exported.promise;
	});
	await admitted.promise;
	expect(started).toBe(true);
	f.readiness.changed();
	f.preview();
	await Promise.resolve();
	expect(f.loads).toHaveLength(1);
	// Real renderer publication guards still invalidate this already-started
	// request when reload drains live state; readiness never retries the export.
	f.loads[0].resolve();
	await f.readiness.whenReady();
	exported.reject(Error("stale publication"));
	await expect(request).rejects.toThrow("stale publication");
});

test("disconnect cancels only queued preview hydration", async () => {
	const f = fixture();
	f.readiness.changed();
	f.readiness.cancelPending();
	f.preview();
	await f.readiness.whenReady();
	expect(f.scheduled()).toBe(false);
	expect(f.loads).toHaveLength(0);
});

test("cancelled readiness waiter settles promptly without cancelling shared hydration", async () => {
	const f = fixture();
	const controller = new AbortController();
	f.readiness.changed();
	const wait = f.readiness.whenReady(controller.signal);
	const outcome = wait.catch((error: unknown) => error);
	const other = f.readiness.whenReady();
	await Promise.resolve();
	controller.abort(Error("caller cancelled"));
	expect(await outcome).toMatchObject({ message: "caller cancelled" });
	expect(f.loads).toHaveLength(1);
	f.loads[0].resolve();
	await other;
	await f.readiness.whenReady();
});

test("a revision arriving in flight settlement is also hydrated before admission", async () => {
	const f = fixture();
	let started = false;
	f.readiness.changed();
	const request = f.readiness.whenReady().then(() => {
		started = true;
	});
	await Promise.resolve();
	// Enqueue after the async reload continuation, at its settlement boundary.
	f.loads[0].promise.then(() => {
		queueMicrotask(() => f.readiness.changed());
	});
	f.loads[0].resolve();
	for (let step = 0; step < 8; step++) await Promise.resolve();
	expect(started).toBe(false);
	expect(f.loads).toHaveLength(2);
	f.loads[1].resolve();
	await request;
	expect(started).toBe(true);
});
