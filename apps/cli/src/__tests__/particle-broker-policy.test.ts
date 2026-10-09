import { expect, spyOn, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { particleReservationBytes } from "../programmatic/particle-policy";
import {
	deferred,
	fakeBrowser,
	fixture,
	policy,
	sample,
} from "./particle-broker-test-support";

const sequential = {
	...policy,
	maxInFlight: 1,
	maxRequestsPerFrame: 2,
	process: { ...policy.process, maxPendingRequests: 1 },
};
test("sampling slots release before reply ack but full-frame reservations never refund", async () => {
	const ack = deferred<Record<string, unknown>>();
	const transport = fakeBrowser(async (method) =>
		method === "Runtime.callFunctionOn" ? ack.promise : {},
	);
	const f = await fixture({ policy: sequential }, transport);
	const bytes = particleReservationBytes(sequential);
	try {
		f.emit(sample(1));
		for (let tick = 0; f.replies().length < 1 && tick < 100; tick++)
			await delay(1);
		expect(f.broker.retainedPayloadBytes).toBe(
			bytes.process + bytes.perRequest,
		);
		f.emit(sample(2));
		for (let tick = 0; f.replies().length < 2 && tick < 100; tick++)
			await delay(1);
		expect(f.sampled).toHaveLength(2);
		expect(f.broker.retainedPayloadBytes).toBe(bytes.frame);
		ack.resolve({});
		await f.check();
		expect(f.broker.retainedPayloadBytes).toBe(bytes.frame);
		f.emit(sample(3));
		await expect(f.failure).rejects.toThrow("count limit");
		expect(f.sampled).toHaveLength(2);
	} finally {
		ack.resolve({});
		await f.dispose();
	}
	expect(f.broker.retainedPayloadBytes).toBe(0);
});

test("host request deadline includes a never-acknowledged reply and retains uncertain cleanup budget", async () => {
	const ack = deferred<Record<string, unknown>>();
	const f = await fixture(
		{ policy: { ...sequential, requestTimeoutMs: 20 }, cleanupTimeoutMs: 10 },
		fakeBrowser(async (method) =>
			method === "Runtime.callFunctionOn" ? ack.promise : {},
		),
	);
	f.emit(sample());
	await expect(f.failure).rejects.toThrow("host request timed out");
	await expect(f.dispose()).rejects.toThrow("cleanup deadline");
	expect(f.stops()).toBe(1);
	expect(f.broker.retainedPayloadBytes).toBeGreaterThan(0);
	ack.resolve({});
});

test("host frame deadline revokes idle grants and terminates the sampler without page cooperation", async () => {
	const f = await fixture({
		policy: {
			...sequential,
			requestTimeoutMs: 10,
			frameTimeoutMs: 20,
			process: { ...sequential.process, initTimeoutMs: 10 },
		},
	});
	await expect(f.failure).rejects.toThrow("host frame timed out");
	await f.dispose();
	expect(f.stops()).toBe(1);
	expect(f.listeners.size).toBe(0);
});

test("disposal clears request timers even if ignored abort makes cleanup uncertain", async () => {
	const scheduled = spyOn(globalThis, "setTimeout"),
		cleared = spyOn(globalThis, "clearTimeout");
	const pending = deferred<string>();
	try {
		const f = await fixture({
			policy: { ...sequential, requestTimeoutMs: 1234 },
			cleanupTimeoutMs: 10,
			sampler: () => pending.promise,
		});
		f.emit(sample());
		await delay(1);
		const index = scheduled.mock.calls.findIndex((args) => args[1] === 1234);
		expect(index).toBeGreaterThanOrEqual(0);
		const timer = scheduled.mock.results[index]?.value;
		await expect(f.dispose()).rejects.toThrow("cleanup deadline");
		expect(cleared.mock.calls.some((args) => args[0] === timer)).toBe(true);
		expect(f.broker.retainedPayloadBytes).toBeGreaterThan(0);
		pending.resolve("late");
	} finally {
		scheduled.mockRestore();
		cleared.mockRestore();
	}
});
