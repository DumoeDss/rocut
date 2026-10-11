import { expect, test } from "bun:test";
import {
	createFrameServiceAdmission,
	FrameAdmissionBusyError,
} from "../programmatic/frame-service-admission";

test("two active frames and eight queued frames form a bounded FIFO", async () => {
	const admission = createFrameServiceAdmission();
	const signal = new AbortController().signal;
	const first = await admission.acquire(signal),
		second = await admission.acquire(signal);
	const order: number[] = [];
	const pending = Array.from({ length: 8 }, (_, index) =>
		admission.acquire(signal).then((release) => {
			order.push(index);
			return release;
		}),
	);
	await expect(admission.acquire(signal)).rejects.toBeInstanceOf(
		FrameAdmissionBusyError,
	);
	expect(order).toEqual([]);
	first();
	for (let index = 0; index < pending.length; index++) {
		const release = await pending[index]!;
		expect(order).toEqual(
			Array.from({ length: index + 1 }, (_, value) => value),
		);
		release();
	}
	second();
	(await admission.acquire(signal))();
});

test("queued cancellation preserves its reason and frees queue capacity without granting a lease", async () => {
	const admission = createFrameServiceAdmission(),
		controller = new AbortController();
	const signal = new AbortController().signal;
	const first = await admission.acquire(signal),
		second = await admission.acquire(signal);
	const abandoned = admission.acquire(controller.signal);
	const reason = Error("obsolete frame");
	controller.abort(reason);
	await expect(abandoned).rejects.toBe(reason);
	const next = admission.acquire(signal);
	first();
	(await next)();
	second();
	await expect(admission.acquire(controller.signal)).rejects.toBe(reason);
});

test("active abort and double release cannot grant more than two active leases", async () => {
	const admission = createFrameServiceAdmission(),
		controller = new AbortController();
	const signal = new AbortController().signal;
	const first = await admission.acquire(controller.signal),
		second = await admission.acquire(signal);
	let started = 0;
	const third = admission.acquire(signal).then((release) => {
		started++;
		return release;
	});
	const fourth = admission.acquire(signal).then((release) => {
		started++;
		return release;
	});
	controller.abort();
	await Promise.resolve();
	expect(started).toBe(0);
	first();
	first();
	const releaseThird = await third;
	expect(started).toBe(1);
	second();
	const releaseFourth = await fourth;
	expect(started).toBe(2);
	releaseThird();
	releaseFourth();
});
