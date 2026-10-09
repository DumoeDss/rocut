import { expect, test } from "bun:test";
import { attachParticleBroker } from "../programmatic/particle-broker";
import {
	cancel,
	deferred,
	fakeBrowser,
	fixture,
	identity,
	policy,
	responseJson,
	sample,
} from "./particle-broker-test-support";

test("wire cancellation aborts only authorized capture work and cannot publish late success", async () => {
	const worker = deferred<string>();
	const f = await fixture({ sampler: async () => worker.promise });
	try {
		f.emit(sample());
		await Promise.resolve();
		f.emit(cancel(), 18);
		expect(f.sampled[0].signal.aborted).toBe(false);
		f.emit(cancel());
		await expect(f.check()).rejects.toThrow("cancelled");
		expect(f.sampled[0].signal.aborted).toBe(true);
		expect(f.replies()[0].reply).toMatchObject({
			id: 1,
			ok: false,
			error: { code: "cancelled" },
		});
		worker.resolve(responseJson);
	} finally {
		await f.dispose();
	}
	expect(f.replies()).toHaveLength(1);
	expect(f.stops()).toBe(1);
});

test("outer abort is frame-fatal and suppresses all post-abort replies", async () => {
	const f = await fixture({
		sampler: (_, signal) =>
			new Promise((_, reject) =>
				signal.addEventListener(
					"abort",
					() => reject(Error("worker aborted")),
					{ once: true },
				),
			),
	});
	try {
		f.emit(sample());
		await Promise.resolve();
		f.controller.abort();
		await expect(f.check()).rejects.toThrow("aborted");
		expect(f.sampled[0].signal.aborted).toBe(true);
		f.emit(sample(2));
		expect(f.sampled).toHaveLength(1);
		expect(f.replies()).toHaveLength(0);
	} finally {
		await f.dispose();
	}
});

test("dispose waits for actual worker termination and in-flight cleanup, and is idempotent", async () => {
	const worker = deferred<string>(),
		stopped = deferred<void>();
	const f = await fixture({
		sampler: async () => worker.promise,
		terminateSampler: async () => stopped.promise,
	});
	f.emit(sample());
	await Promise.resolve();
	let complete = false;
	const closing = f.dispose();
	void closing.then(() => {
		complete = true;
	});
	expect(f.dispose()).toBe(closing);
	expect(f.listeners.size).toBe(0);
	expect(f.sampled[0].signal.aborted).toBe(true);
	await Promise.resolve();
	expect(complete).toBe(false);
	expect(f.stops()).toBe(1);
	stopped.resolve();
	await Promise.resolve();
	expect(complete).toBe(false);
	worker.resolve(responseJson);
	await closing;
	expect(complete).toBe(true);
	expect(f.replies()).toHaveLength(0);
	f.emit(sample(2));
	expect(f.sampled).toHaveLength(1);
	await expect(f.check()).rejects.toThrow("disposed");
});

test("cleanup deadline rejects uncooperative workers and observes late rejection without reuse of uncertain session", async () => {
	const worker = deferred<string>(),
		unhandled: unknown[] = [];
	const notice = (reason: unknown) => {
		unhandled.push(reason);
	};
	process.on("unhandledRejection", notice);
	const f = await fixture({
		sampler: async () => worker.promise,
		cleanupTimeoutMs: 10,
	});
	try {
		f.emit(sample());
		await Promise.resolve();
		const closing = f.dispose();
		await expect(closing).rejects.toThrow("cleanup deadline");
		await expect(f.failure).rejects.toThrow("cleanup deadline");
		expect(f.dispose()).toBe(closing);
		expect(f.stops()).toBe(1);
		expect(f.listeners.size).toBe(0);
		await expect(fixture({}, f)).rejects.toThrow("already has an owner");
		worker.reject(Error("late worker rejection"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(unhandled).toHaveLength(0);
		expect(f.replies()).toHaveLength(0);
	} finally {
		worker.resolve(responseJson);
		process.off("unhandledRejection", notice);
	}
});

test("termination callback failures and never-settling callbacks are not swallowed by dispose", async () => {
	for (const hangs of [false, true]) {
		const stopped = deferred<void>();
		const terminateSampler = async () => {
			if (hangs) return stopped.promise;
			throw Error("termination fixture failure");
		};
		const f = await fixture({ terminateSampler, cleanupTimeoutMs: 10 });
		try {
			await expect(f.dispose()).rejects.toThrow("cleanup");
			await expect(f.check()).rejects.toThrow("cleanup");
			expect(f.stops()).toBe(1);
		} finally {
			stopped.resolve();
		}
	}
});

test("reply transport or context exceptions fail the frame even if page ignores errors", async () => {
	for (const exception of [false, true]) {
		const transport = fakeBrowser(async (method) => {
			if (method !== "Runtime.callFunctionOn") return {};
			if (exception)
				return { exceptionDetails: { text: "missing reply handler" } };
			throw Error("CDP reply failed");
		});
		const f = await fixture({}, transport);
		try {
			f.emit(sample());
			await expect(f.check()).rejects.toThrow();
			expect(f.replies()).toHaveLength(1);
		} finally {
			await f.dispose();
		}
	}
});

test("context destruction revokes the grant without accepting a replacement context", async () => {
	const worker = deferred<string>();
	const f = await fixture({ sampler: async () => worker.promise });
	try {
		f.emit(sample());
		await Promise.resolve();
		f.emitEvent({
			sessionId: "cdp-session",
			method: "Runtime.executionContextDestroyed",
			params: { executionContextId: 18 },
		});
		expect(f.sampled[0].signal.aborted).toBe(false);
		f.emitEvent({
			sessionId: "cdp-session",
			method: "Runtime.executionContextDestroyed",
			params: { executionContextId: 17 },
		});
		await expect(f.check()).rejects.toThrow("context was destroyed");
		f.emit(sample(2), 18);
		expect(f.sampled).toHaveLength(1);
		expect(f.sampled[0].signal.aborted).toBe(true);
		worker.resolve(responseJson);
	} finally {
		await f.dispose();
	}
	expect(f.replies()).toHaveLength(0);
});

test("binding setup failure and pre-aborted setup terminate worker ownership and leave no subscription", async () => {
	for (const preAborted of [false, true]) {
		let stops = 0;
		const transport = fakeBrowser(async () => {
			throw Error("binding fixture failure");
		});
		await expect(
			attachParticleBroker({
				browser: transport.browser,
				session: "cdp-session",
				executionContextId: 17,
				identity,
				policy,
				signal: preAborted ? AbortSignal.abort() : new AbortController().signal,
				sampler: async () => responseJson,
				terminateSampler: async () => {
					stops++;
				},
				cleanupTimeoutMs: 100,
			}),
		).rejects.toThrow();
		expect(stops).toBe(1);
		expect(transport.listeners.size).toBe(0);
		expect(transport.calls).toHaveLength(preAborted ? 0 : 1);
	}
});

test("only successfully cleaned sessions can acquire a later explicit grant", async () => {
	const transport = fakeBrowser(),
		first = await fixture({}, transport);
	await expect(fixture({}, transport)).rejects.toThrow("already has an owner");
	await first.dispose();
	const next = await fixture(
		{
			identity: { ...identity, captureId: "capture-b" },
			executionContextId: 31,
		},
		transport,
	);
	try {
		next.emit(sample());
		await next.check();
		expect(next.sampled).toHaveLength(0);
		next.emit(sample(1, { captureId: "capture-b" }), 31);
		await next.check();
		expect(next.sampled).toHaveLength(1);
	} finally {
		await next.dispose();
	}
});

test("binding cleanup rejection fails disposal and cannot be reported as success", async () => {
	const transport = fakeBrowser(async (method) => {
		if (method === "Runtime.removeBinding")
			throw Error("binding removal failed");
		return {};
	});
	const f = await fixture({}, transport);
	await expect(f.dispose()).rejects.toThrow("cleanup failed");
	expect(f.stops()).toBe(1);
	expect(f.listeners.size).toBe(0);
});

test("a check already waiting when disposal starts cannot later report a successful frame", async () => {
	const worker = deferred<string>();
	const f = await fixture({
		sampler: async () => worker.promise,
		terminateSampler: async () => {
			worker.resolve(responseJson);
		},
	});
	f.emit(sample());
	await Promise.resolve();
	const checking = f.check();
	const closing = f.dispose();
	await expect(checking).rejects.toThrow("disposed");
	await closing;
	expect(f.replies()).toHaveLength(0);
});

test("abort during a stalled binding setup still terminates ownership within the cleanup deadline", async () => {
	const binding = deferred<Record<string, unknown>>(),
		controller = new AbortController();
	let stops = 0;
	const transport = fakeBrowser(async (method) =>
		method === "Runtime.addBinding" ? binding.promise : {},
	);
	const attaching = attachParticleBroker({
		browser: transport.browser,
		session: "cdp-session",
		executionContextId: 17,
		identity,
		policy,
		signal: controller.signal,
		sampler: async () => responseJson,
		terminateSampler: async () => {
			stops++;
		},
		cleanupTimeoutMs: 10,
	});
	await Promise.resolve();
	controller.abort();
	await expect(attaching).rejects.toThrow("cleanup deadline");
	expect(stops).toBe(1);
	expect(transport.listeners.size).toBe(0);
	binding.resolve({});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(
		transport.calls.some((call) => call.method === "Runtime.removeBinding"),
	).toBe(true);
});
