import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { InMemoryRuntimeResourceHost } from "@opencut/editor-ports/in-memory";
import { createSessionResources } from "../session-resources";

type ScheduledKind = "timeout" | "interval" | "animationFrame";

interface ScheduledCallback {
	readonly kind: ScheduledKind;
	readonly callback: () => void;
	cancelled: boolean;
}

class FakePlatformClock {
	private nextId = 0;
	private readonly scheduled = new Map<number, ScheduledCallback>();
	private readonly previous = new Map<string, PropertyDescriptor | undefined>();

	install(): void {
		this.replace({
			name: "setTimeout",
			value: (handler: TimerHandler) =>
				this.schedule({
					kind: "timeout",
					callback: () => this.invoke(handler),
				}),
		});
		this.replace({
			name: "clearTimeout",
			value: (id: number) => {
				this.cancel(id);
			},
		});
		this.replace({
			name: "setInterval",
			value: (handler: TimerHandler) =>
				this.schedule({
					kind: "interval",
					callback: () => this.invoke(handler),
				}),
		});
		this.replace({
			name: "clearInterval",
			value: (id: number) => {
				this.cancel(id);
			},
		});
		this.replace({
			name: "requestAnimationFrame",
			value: (callback: FrameRequestCallback) =>
				this.schedule({
					kind: "animationFrame",
					callback: () => callback(16),
				}),
		});
		this.replace({
			name: "cancelAnimationFrame",
			value: (id: number) => {
				this.cancel(id);
			},
		});
	}

	restore(): void {
		for (const [name, descriptor] of this.previous) {
			if (descriptor) {
				Object.defineProperty(globalThis, name, descriptor);
			} else {
				Reflect.deleteProperty(globalThis, name);
			}
		}
	}

	private replace({ name, value }: { name: string; value: unknown }): void {
		this.previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	}

	ids(kind: ScheduledKind): number[] {
		return [...this.scheduled]
			.filter(([, scheduled]) => scheduled.kind === kind)
			.map(([id]) => id);
	}

	isCancelled(id: number): boolean {
		return this.require(id).cancelled;
	}

	fire({ id, stale = false }: { id: number; stale?: boolean }): void {
		const scheduled = this.require(id);
		if (scheduled.cancelled && !stale) {
			throw new Error(`Scheduled callback ${id} was cancelled.`);
		}
		if (scheduled.kind !== "interval") scheduled.cancelled = true;
		scheduled.callback();
	}

	private schedule({
		kind,
		callback,
	}: {
		kind: ScheduledKind;
		callback: () => void;
	}): number {
		const id = ++this.nextId;
		this.scheduled.set(id, { kind, callback, cancelled: false });
		return id;
	}

	private cancel(id: number): void {
		const scheduled = this.scheduled.get(id);
		if (scheduled) scheduled.cancelled = true;
	}

	private require(id: number): ScheduledCallback {
		const scheduled = this.scheduled.get(id);
		if (!scheduled) throw new Error(`Unknown scheduled callback ${id}.`);
		return scheduled;
	}

	private invoke(handler: TimerHandler): void {
		if (typeof handler === "function") handler();
	}
}

function createFixture() {
	let sequence = 0;
	return createSessionResources({
		runtimeResources: new InMemoryRuntimeResourceHost(),
		runtimeGpu: {
			liveHandles: () => [],
			release: () => {},
		},
		nextId: ({ scope }) => `${scope}-${++sequence}`,
	});
}

describe("session timer fake-clock matrix", () => {
	let clock: FakePlatformClock;

	beforeEach(() => {
		clock = new FakePlatformClock();
		clock.install();
	});

	afterEach(() => {
		clock.restore();
	});

	test("timeout fires before disposal once and an early-cancel race cannot publish", async () => {
		const resources = createFixture();
		let fired = 0;
		const firedHandle = resources.setTimeout({
			handler: () => {
				fired += 1;
			},
			ms: 10,
		});
		const firedId = clock.ids("timeout")[0];
		clock.fire({ id: firedId });
		firedHandle.cancel();
		clock.fire({ id: firedId, stale: true });
		expect(fired).toBe(1);

		const cancelledHandle = resources.setTimeout({
			handler: () => {
				fired += 1;
			},
			ms: 10,
		});
		const cancelledId = clock.ids("timeout")[1];
		cancelledHandle.cancel();
		cancelledHandle.cancel();
		expect(clock.isCancelled(cancelledId)).toBe(true);
		clock.fire({ id: cancelledId, stale: true });
		await Promise.resolve();
		expect(fired).toBe(1);
		expect(resources.inspect().timer).toEqual({ created: 2, released: 2 });

		await resources.disposeAll();
		expect(resources.inspect().timer).toEqual({ created: 2, released: 2 });
	});

	test("interval cancellation is idempotent and suppresses an already-queued tick", async () => {
		const resources = createFixture();
		let ticks = 0;
		const interval = resources.setInterval({
			handler: () => {
				ticks += 1;
			},
			ms: 5,
		});
		const intervalId = clock.ids("interval")[0];
		clock.fire({ id: intervalId });
		expect(ticks).toBe(1);
		interval.cancel();
		interval.cancel();
		clock.fire({ id: intervalId, stale: true });
		await Promise.resolve();
		expect(ticks).toBe(1);
		expect(resources.inspect().timer).toEqual({ created: 1, released: 1 });
		await resources.disposeAll();
	});

	test("RAF self-release and cancellation races each publish at most once", async () => {
		const resources = createFixture();
		let frames = 0;
		const firedFrame = resources.requestAnimationFrame({
			handler: () => {
				frames += 1;
			},
		});
		const firedId = clock.ids("animationFrame")[0];
		clock.fire({ id: firedId });
		firedFrame.cancel();
		clock.fire({ id: firedId, stale: true });
		expect(frames).toBe(1);

		const cancelledFrame = resources.requestAnimationFrame({
			handler: () => {
				frames += 1;
			},
		});
		const cancelledId = clock.ids("animationFrame")[1];
		cancelledFrame.cancel();
		clock.fire({ id: cancelledId, stale: true });
		await Promise.resolve();
		expect(frames).toBe(1);
		expect(resources.inspect().timer).toEqual({ created: 2, released: 2 });
		await resources.disposeAll();
	});

	test("suspend quiescence cancels every timer kind and blocks stale publication", async () => {
		const resources = createFixture();
		const publications: string[] = [];
		resources.setTimeout({
			handler: () => publications.push("timeout"),
			ms: 10,
		});
		resources.setInterval({
			handler: () => publications.push("interval"),
			ms: 10,
		});
		resources.requestAnimationFrame({
			handler: () => publications.push("animationFrame"),
		});
		const scheduledIds = [
			...clock.ids("timeout"),
			...clock.ids("interval"),
			...clock.ids("animationFrame"),
		];

		resources.beginActivitySuspend();
		await resources.drainActivityResources();
		for (const id of scheduledIds) {
			expect(clock.isCancelled(id)).toBe(true);
			clock.fire({ id, stale: true });
		}
		expect(publications).toEqual([]);
		expect(resources.inspect().timer).toEqual({ created: 3, released: 3 });
		await resources.disposeAll();
	});
});
