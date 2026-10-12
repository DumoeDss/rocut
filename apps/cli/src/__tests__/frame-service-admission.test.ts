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

import { createServer, request as httpRequest } from "node:http";
import type { Socket } from "node:net";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { createProgrammaticFrameService } from "../programmatic/frame-service";
import type { FrameRouteClock } from "../programmatic/frame-service-deadline";
import { withHtmlCaptureCleanup } from "../programmatic/particle-capture";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const png = Buffer.from("fixture-png-bytes");
const frame = (id: number): ProgrammaticFrameRequest => ({
	source: {
		version: 1,
		runtime: "html-document",
		code: "",
		width: 320,
		height: 240,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 49,
		seed: 7391,
	},
	clipStart: 0,
	clipDuration: 196000,
	trimStart: 0,
	timelineTime: id,
});

function fakeClock() {
	let now = 1000;
	const timers = new Map<() => void, number>();
	const clock: FrameRouteClock = {
		now: () => now,
		schedule(callback, delayMs) {
			timers.set(callback, now + delayMs);
			return () => {
				timers.delete(callback);
			};
		},
	};
	return {
		clock,
		count: () => timers.size,
		advance(time: number) {
			now = time;
			for (const [callback, at] of [...timers]) if (at <= now) callback();
		},
	};
}

function renderControl() {
	const started = deferred<AbortSignal>();
	const aborted = deferred<void>();
	const work = deferred<Buffer>();
	const cleanup = deferred<void>();
	return {
		started: started.promise,
		aborted: aborted.promise,
		finish: () => work.resolve(png),
		fail: (reason: unknown) => work.reject(reason),
		releaseCleanup: () => cleanup.resolve(),
		failCleanup: (reason: unknown) => cleanup.reject(reason),
		async run(signal: AbortSignal) {
			const cancellation = deferred<never>();
			const abort = () => {
				aborted.resolve();
				cancellation.reject(signal.reason);
			};
			signal.addEventListener("abort", abort, { once: true });
			started.resolve(signal);
			try {
				return await withHtmlCaptureCleanup({
					run: async () => {
						if (signal.aborted) abort();
						return Promise.race([work.promise, cancellation.promise]);
					},
					cleanupPage: () => cleanup.promise,
					disposeBrokers: [],
					closeBrowser: async () => {},
				});
			} finally {
				signal.removeEventListener("abort", abort);
			}
		},
	};
}

/** Real HTTP and production route, with CPU render/cleanup fixtures only.
 * These bytes are not a rasterization oracle or Glass acceptance evidence.
 */
async function httpFixture() {
	const time = fakeClock();
	const controls = new Map<number, ReturnType<typeof renderControl>>();
	const sockets = new Set<Socket>();
	const handled: Promise<void>[] = [];
	const failures: unknown[] = [];
	const arrivals: { count: number; resolve(): void }[] = [];
	const completions: { count: number; resolve(): void }[] = [];
	const starts: number[] = [];
	let arrivalCount = 0,
		completionCount = 0,
		native = 0,
		highWater = 0;
	const notify = (waiters: typeof arrivals, count: number) => {
		for (const waiter of [...waiters])
			if (waiter.count <= count) {
				waiters.splice(waiters.indexOf(waiter), 1);
				waiter.resolve();
			}
	};
	const service = createProgrammaticFrameService(
		process.execPath,
		"",
		undefined,
		undefined,
		{
			clock: time.clock,
			renderFrame: async ({ request, signal }) => {
				const control = controls.get(request.timelineTime);
				if (!control) throw new Error("Unexpected fixture frame");
				starts.push(request.timelineTime);
				native++;
				highWater = Math.max(highWater, native);
				try {
					return await control.run(signal);
				} finally {
					native--;
				}
			},
		},
	);
	const server = createServer((request, response) => {
		arrivalCount++;
		notify(arrivals, arrivalCount);
		const operation = service
			.handle(request, response)
			.catch((error: unknown) => {
				failures.push(error);
				response.destroy();
			})
			.finally(() => {
				completionCount++;
				notify(completions, completionCount);
			});
		handled.push(operation);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing fixture address");
	const url = `http://127.0.0.1:${address.port}/api/programmatic/frame`;
	return {
		service,
		time,
		starts,
		failures,
		counts: () => ({
			native,
			highWater,
			arrivals: arrivalCount,
			completions: completionCount,
		}),
		control(id: number) {
			const control = renderControl();
			controls.set(id, control);
			return control;
		},
		waitForArrivals(count: number) {
			return count <= arrivalCount
				? Promise.resolve()
				: new Promise<void>((resolve) => arrivals.push({ count, resolve }));
		},
		waitForCompletions(count: number) {
			return count <= completionCount
				? Promise.resolve()
				: new Promise<void>((resolve) => completions.push({ count, resolve }));
		},
		post(body: string, partial = false) {
			let settled = false;
			const reply = deferred<{
				status: number;
				body: Buffer;
				contentType: string | undefined;
			}>();
			const request = httpRequest(
				url,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body) + (partial ? 100 : 0),
					},
				},
				(response) => {
					const chunks: Buffer[] = [];
					response.on("data", (chunk: Buffer) => chunks.push(chunk));
					response.on("error", reply.reject);
					response.on("end", () =>
						reply.resolve({
							status: response.statusCode!,
							body: Buffer.concat(chunks),
							contentType: response.headers["content-type"],
						}),
					);
				},
			);
			request.on("error", reply.reject);
			const result = reply.promise.finally(() => {
				settled = true;
			});
			// Intentional client closes are asserted by each test, never unhandled.
			void result.catch(() => {});
			if (partial) request.write(body);
			else request.end(body);
			return {
				result,
				settled: () => settled,
				abort: () => request.destroy(new Error("fixture client cancelled")),
			};
		},
		async close() {
			for (const control of controls.values()) {
				control.finish();
				control.releaseCleanup();
			}
			await service.dispose();
			await Promise.all(handled);
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}

test("HTTP: ordinary two-live overload stays 429 and succeeds only after actual releases", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0),
			b = h.control(1);
		const clientA = h.post(JSON.stringify(frame(0))),
			clientB = h.post(JSON.stringify(frame(1)));
		await Promise.all([a.started, b.started]);
		const busy = await h.post(JSON.stringify(frame(2))).result;
		expect(busy.status).toBe(429);
		expect(JSON.parse(busy.body.toString()).error).toBe(
			"HTML rasterizer busy; retry after the active frame finishes",
		);
		expect(h.counts().native).toBe(2);
		a.finish();
		a.releaseCleanup();
		b.finish();
		b.releaseCleanup();
		for (const reply of await Promise.all([clientA.result, clientB.result])) {
			expect(reply.status).toBe(200);
			expect(reply.contentType).toBe("image/png");
			expect(reply.body).toEqual(png);
		}
		await h.waitForCompletions(3);
		expect(h.counts().highWater).toBe(2);
		expect(h.time.count()).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: real client closes let replacements wait through cancelled native cleanup", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0),
			b = h.control(1),
			c = h.control(2);
		const clientA = h.post(JSON.stringify(frame(0))),
			clientB = h.post(JSON.stringify(frame(1)));
		await Promise.all([a.started, b.started]);
		clientA.abort();
		clientB.abort();
		await Promise.all([a.aborted, b.aborted]);
		const clientC = h.post(JSON.stringify(frame(2)));
		await h.waitForArrivals(3);
		expect(clientC.settled()).toBe(false);
		expect(h.starts).toEqual([0, 1]);
		expect(h.counts().native).toBe(2);
		a.releaseCleanup();
		await c.started;
		expect(h.counts().highWater).toBe(2);
		expect(h.counts().native).toBe(2);
		b.releaseCleanup();
		c.finish();
		c.releaseCleanup();
		expect((await clientC.result).status).toBe(200);
		await h.waitForCompletions(3);
		expect(h.starts).toEqual([0, 1, 2]);
		expect(h.counts().native).toBe(0);
		expect(h.time.count()).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: pending overflow stays 429; cancelled queued frame never launches", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0),
			b = h.control(1),
			d = h.control(3),
			f = h.control(5);
		h.control(2);
		const clientA = h.post(JSON.stringify(frame(0))),
			clientB = h.post(JSON.stringify(frame(1)));
		await Promise.all([a.started, b.started]);
		clientA.abort();
		await a.aborted;
		const clientC = h.post(JSON.stringify(frame(2))),
			clientD = h.post(JSON.stringify(frame(3)));
		await h.waitForArrivals(4);
		expect((await h.post(JSON.stringify(frame(4))).result).status).toBe(429);
		clientC.abort();
		await h.waitForCompletions(2);
		const clientF = h.post(JSON.stringify(frame(5)));
		await h.waitForArrivals(6);
		a.releaseCleanup();
		await d.started;
		expect(h.starts).toEqual([0, 1, 3]);
		d.finish();
		d.releaseCleanup();
		expect((await clientD.result).status).toBe(200);
		await f.started;
		f.finish();
		f.releaseCleanup();
		b.finish();
		b.releaseCleanup();
		expect((await clientF.result).status).toBe(200);
		expect((await clientB.result).status).toBe(200);
		await h.waitForCompletions(6);
		expect(h.starts).toEqual([0, 1, 3, 5]);
		expect(h.counts().highWater).toBe(2);
		expect(h.time.count()).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: dispose aborts queued routes and awaits both active native cleanups", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0),
			b = h.control(1);
		h.control(2);
		h.control(3);
		const clientA = h.post(JSON.stringify(frame(0))),
			clientB = h.post(JSON.stringify(frame(1)));
		await Promise.all([a.started, b.started]);
		clientA.abort();
		await a.aborted;
		const clientC = h.post(JSON.stringify(frame(2))),
			clientD = h.post(JSON.stringify(frame(3)));
		await h.waitForArrivals(4);
		let disposed = false;
		const disposal = h.service.dispose().then(() => {
			disposed = true;
		});
		await b.aborted;
		await h.waitForCompletions(2);
		for (const client of [clientC, clientD]) {
			const status = await client.result.then(
				(reply) => reply.status,
				() => "closed",
			);
			expect([408, "closed"]).toContain(status);
		}
		expect(disposed).toBe(false);
		expect(h.starts).toEqual([0, 1]);
		expect(h.time.count()).toBe(0);
		expect((await h.post(JSON.stringify(frame(4))).result).status).toBe(503);
		a.releaseCleanup();
		await h.waitForCompletions(4);
		expect(disposed).toBe(false);
		b.releaseCleanup();
		await disposal;
		expect((await clientB.result).status).toBe(408);
		expect(h.counts().native).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: queued frame expires at its original arrival deadline without starting", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0),
			b = h.control(1);
		h.control(2);
		const clientA = h.post(JSON.stringify(frame(0))),
			clientB = h.post(JSON.stringify(frame(1)));
		await Promise.all([a.started, b.started]);
		clientA.abort();
		await a.aborted;
		h.time.advance(5000);
		const clientC = h.post(JSON.stringify(frame(2)));
		await h.waitForArrivals(3);
		h.time.advance(19999);
		expect(clientC.settled()).toBe(false);
		expect(h.starts).toEqual([0, 1]);
		h.time.advance(20000);
		await h.waitForCompletions(1);
		expect(
			await clientC.result.then(
				(reply) => reply.status,
				() => "closed",
			),
		).toBeOneOf([408, "closed"]);
		expect(h.starts).toEqual([0, 1]);
		expect(h.time.count()).toBe(0);
		a.releaseCleanup();
		b.releaseCleanup();
		expect((await clientB.result).status).toBe(408);
		await h.waitForCompletions(3);
		expect(h.counts().native).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: malformed and oversized bodies release admission and preserve error statuses", async () => {
	const h = await httpFixture();
	try {
		expect((await h.post("{").result).status).toBe(422);
		expect((await h.post("x".repeat(2_000_001)).result).status).toBe(413);
		expect(h.starts).toEqual([]);
		expect(h.time.count()).toBe(0);
		const c = h.control(2);
		const clientC = h.post(JSON.stringify(frame(2)));
		await c.started;
		c.finish();
		c.releaseCleanup();
		expect((await clientC.result).status).toBe(200);
		await h.waitForCompletions(3);
		expect(h.time.count()).toBe(0);
		expect(h.counts().native).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: partial body timeout interrupts the iterator and leaves later admission usable", async () => {
	const h = await httpFixture();
	try {
		const partial = h.post("{", true);
		await h.waitForArrivals(1);
		h.time.advance(16000);
		await h.waitForCompletions(1);
		expect(
			await partial.result.then(
				(reply) => reply.status,
				() => "closed",
			),
		).toBeOneOf([408, "closed"]);
		expect(h.time.count()).toBe(0);
		expect(h.starts).toEqual([]);
		const c = h.control(2);
		const clientC = h.post(JSON.stringify(frame(2)));
		await c.started;
		c.finish();
		c.releaseCleanup();
		expect((await clientC.result).status).toBe(200);
		await h.waitForCompletions(2);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});

test("HTTP: render and cleanup failures remain failures and free slots only after cleanup", async () => {
	const h = await httpFixture();
	try {
		const a = h.control(0);
		const clientA = h.post(JSON.stringify(frame(0)));
		await a.started;
		a.fail(new Error("primary fixture failure"));
		expect(clientA.settled()).toBe(false);
		expect(h.counts().native).toBe(1);
		a.failCleanup(new Error("cleanup fixture failure"));
		const failed = await clientA.result;
		expect(failed.status).toBe(422);
		expect(JSON.parse(failed.body.toString()).error).toBe(
			"HTML capture and cleanup failed",
		);
		const b = h.control(1);
		const clientB = h.post(JSON.stringify(frame(1)));
		await b.started;
		b.finish();
		b.releaseCleanup();
		expect((await clientB.result).status).toBe(200);
		await h.waitForCompletions(2);
		expect(h.counts().native).toBe(0);
		expect(h.time.count()).toBe(0);
		expect(h.failures).toEqual([]);
	} finally {
		await h.close();
	}
});
