import { describe, expect, test } from "bun:test";

import {
	createSessionResources,
	SessionActivityGenerationError,
	SessionResourceReleaseError,
} from "../session-resources";
import { createRafLoop } from "../../../hooks/use-raf-loop";

function waitForTwoSessionFrames(
	resources: ReturnType<typeof createSessionResources>,
): Promise<void> {
	const generation = resources.getActivityGeneration();
	return new Promise((resolve, reject) => {
		let firstFrame: ReturnType<typeof resources.requestAnimationFrame> | null =
			null;
		let secondFrame: ReturnType<typeof resources.requestAnimationFrame> | null =
			null;
		let settled = false;
		let unsubscribe = () => {};

		const finish = (error?: unknown) => {
			if (settled) return;
			settled = true;
			firstFrame?.cancel();
			secondFrame?.cancel();
			unsubscribe();
			if (error === undefined) resolve();
			else reject(error);
		};

		unsubscribe = resources.subscribeActivityLifecycle({
			onSuspend: ({ generation: actualGeneration }) => {
				finish(
					new SessionActivityGenerationError({
						expectedGeneration: generation,
						actualGeneration,
					}),
				);
			},
		});

		firstFrame = resources.requestAnimationFrame({
			handler: () => {
				firstFrame = null;
				try {
					resources.assertActivityGeneration({ generation });
					secondFrame = resources.requestAnimationFrame({
						handler: () => {
							secondFrame = null;
							try {
								resources.assertActivityGeneration({ generation });
								finish();
							} catch (error) {
								finish(error);
							}
						},
					});
				} catch (error) {
					finish(error);
				}
			},
		});
	});
}

function createFixture({
	objectUrlRevokeError,
}: {
	objectUrlRevokeError?: Error;
} = {}) {
	let sequence = 0;
	let resolveClose: (() => void) | undefined;
	let rejectClose: ((reason: unknown) => void) | undefined;
	let closeStarted = false;
	const liveGpu = new Set<number>();
	const calls: string[] = [];
	const runtimeResources = {
		workers: [] as Array<{
			terminated: boolean;
			messageListeners: Set<(event: { data: unknown }) => void>;
			errorListeners: Set<(event: { message: string }) => void>;
		}>,
		urls: [] as Array<{ revoked: boolean; revokeCalls: number }>,
		createWorker() {
			const state = {
				terminated: false,
				messageListeners: new Set<(event: { data: unknown }) => void>(),
				errorListeners: new Set<(event: { message: string }) => void>(),
			};
			runtimeResources.workers.push(state);
			return {
				id: "fixture-worker" as const,
				resourceId: `worker-${runtimeResources.workers.length}`,
				postMessage() {},
				onMessage: (listener: (event: { data: unknown }) => void) => {
					state.messageListeners.add(listener);
					return () => state.messageListeners.delete(listener);
				},
				onError: (listener: (event: { message: string }) => void) => {
					state.errorListeners.add(listener);
					return () => state.errorListeners.delete(listener);
				},
				terminate() {
					state.terminated = true;
					calls.push("worker");
				},
			};
		},
		createAudioContext() {
			return {
				resourceId: "audio-1",
				sampleRate: 48_000,
				state: "running" as const,
				context: null,
				close: () => {
					closeStarted = true;
					return new Promise<void>((resolve, reject) => {
						resolveClose = resolve;
						rejectClose = reject;
					});
				},
			};
		},
		createObjectUrl() {
			const state = { revoked: false, revokeCalls: 0 };
			runtimeResources.urls.push(state);
			return {
				resourceId: `url-${runtimeResources.urls.length}`,
				url: `blob:fixture-${runtimeResources.urls.length}`,
				revoke() {
					state.revoked = true;
					state.revokeCalls += 1;
					calls.push("url");
					if (objectUrlRevokeError) throw objectUrlRevokeError;
				},
			};
		},
	};
	const resources = createSessionResources({
		runtimeResources,
		runtimeGpu: {
			liveHandles: () => [...liveGpu],
			release: ({ handle }) => {
				liveGpu.delete(handle);
				calls.push(`gpu:${handle}`);
			},
		},
		nextId: ({ scope }) => `${scope}-${++sequence}`,
	});
	return {
		resources,
		runtimeResources,
		liveGpu,
		calls,
		get closeStarted() {
			return closeStarted;
		},
		resolveClose: () => resolveClose?.(),
		rejectClose: (reason: unknown) => rejectClose?.(reason),
	};
}

describe("C6 session resource drain", () => {
	test("early and repeated object-URL revoke reaches the platform exactly once", async () => {
		const fixture = createFixture();
		const handle = fixture.resources.createObjectUrl({
			blob: new Blob(["early-revoke"]),
		});
		handle.revoke();
		handle.revoke();
		await Promise.resolve();
		expect(fixture.runtimeResources.urls[0]).toEqual({
			revoked: true,
			revokeCalls: 1,
		});
		expect(fixture.resources.inspect().objectUrl).toEqual({
			created: 1,
			released: 1,
		});

		await fixture.resources.disposeAll();
		expect(fixture.runtimeResources.urls[0]?.revokeCalls).toBe(1);
	});

	test("equal object URLs owned by two sessions revoke independently", async () => {
		const fixtureA = createFixture();
		const fixtureB = createFixture();
		const blob = new Blob(["equal-logical-media"]);
		const handleA = fixtureA.resources.createObjectUrl({ blob });
		fixtureB.resources.createObjectUrl({ blob });

		handleA.revoke();
		await Promise.resolve();
		expect(fixtureA.runtimeResources.urls[0]?.revokeCalls).toBe(1);
		expect(fixtureB.runtimeResources.urls[0]?.revokeCalls).toBe(0);
		await fixtureA.resources.disposeAll();
		expect(fixtureB.resources.inspect().objectUrl).toEqual({
			created: 1,
			released: 0,
		});

		await fixtureB.resources.disposeAll();
		expect(fixtureB.runtimeResources.urls[0]?.revokeCalls).toBe(1);
	});

	test("awaits delayed audio close and reports terminal release counts", async () => {
		const fixture = createFixture();
		fixture.resources.setTimeout({ handler: () => {}, ms: 60_000 });
		fixture.resources.createWorker({
			request: {
				id: "fixture-worker",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		fixture.resources.createAudioContext({});
		fixture.resources.createObjectUrl({ blob: new Blob(["fixture"]) });
		fixture.resources.trackGpuResource({ handle: 7, label: "fixture" });

		const pending = fixture.resources.disposeAll();
		for (let index = 0; index < 8 && !fixture.closeStarted; index += 1) {
			await Promise.resolve();
		}
		expect(fixture.closeStarted).toBe(true);
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});
		fixture.resolveClose?.();
		const report = await pending;
		expect(report.audioContext).toEqual({ created: 1, released: 1 });
		expect(report.worker).toEqual({ created: 1, released: 1 });
		expect(report.objectUrl).toEqual({ created: 1, released: 1 });
		expect(report.gpuResource).toEqual({ created: 1, released: 1 });
		expect(fixture.runtimeResources.workers[0]?.terminated).toBe(true);
		expect(fixture.runtimeResources.urls[0]?.revoked).toBe(true);
	});

	test("continues after one rejected release and preserves a stable failed outcome", async () => {
		const fixture = createFixture();
		fixture.resources.createWorker({
			request: {
				id: "fixture-worker",
				url: new URL("https://example.invalid/worker.js"),
				type: "module",
			},
		});
		fixture.resources.createAudioContext({});
		fixture.resources.createObjectUrl({ blob: new Blob(["fixture"]) });
		const first = fixture.resources.disposeAll();
		for (let index = 0; index < 8 && !fixture.closeStarted; index += 1) {
			await Promise.resolve();
		}
		fixture.rejectClose?.(new Error("close failed"));
		let firstError: unknown;
		try {
			await first;
		} catch (error) {
			firstError = error;
		}
		expect(firstError).toBeInstanceOf(Error);
		expect(fixture.runtimeResources.workers[0]?.terminated).toBe(true);
		expect(fixture.runtimeResources.urls[0]?.revoked).toBe(true);
		expect(fixture.resources.inspect().audioContext).toEqual({
			created: 1,
			released: 0,
		});
		let secondError: unknown;
		try {
			await fixture.resources.disposeAll();
		} catch (error) {
			secondError = error;
		}
		expect(secondError).toBe(firstError);
	});

	test("preserves multiple release failures in exact reverse-acquisition order", async () => {
		const revokeError = new Error("revoke failed");
		const closeError = new Error("close failed");
		const fixture = createFixture({ objectUrlRevokeError: revokeError });
		fixture.resources.createAudioContext({});
		fixture.resources.createObjectUrl({ blob: new Blob(["fixture"]) });

		const pending = fixture.resources.disposeAll();
		for (let index = 0; index < 8 && !fixture.closeStarted; index += 1) {
			await Promise.resolve();
		}
		expect(fixture.closeStarted).toBe(true);
		fixture.rejectClose(closeError);

		let caught: unknown;
		try {
			await pending;
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AggregateError);
		if (!(caught instanceof AggregateError)) {
			throw new Error("Expected aggregate release failure");
		}
		const errors = caught.errors;
		expect(errors).toHaveLength(2);
		expect(
			errors.map((error) =>
				error instanceof SessionResourceReleaseError
					? error.resourceClass
					: "unattributed",
			),
		).toEqual(["objectUrl", "audioContext"]);
		expect(
			errors.map((error) =>
				error instanceof SessionResourceReleaseError ? error.cause : null,
			),
		).toEqual([revokeError, closeError]);
		expect(fixture.calls).toEqual(["url"]);
	});

	test("terminally drains the old interval and reacquires only through the resume hook", async () => {
		const fixture = createFixture();
		let ticks = 0;
		let interval = fixture.resources.setInterval({
			handler: () => {
				ticks += 1;
			},
			ms: 2,
		});
		const oldInterval = interval;
		const unsubscribe = fixture.resources.subscribeActivityLifecycle({
			onResume: () => {
				interval = fixture.resources.setInterval({
					handler: () => {
						ticks += 1;
					},
					ms: 2,
				});
			},
		});
		const generationBefore = fixture.resources.getActivityGeneration();
		await new Promise((resolve) => setTimeout(resolve, 12));
		const ticksBeforeSuspend = ticks;

		fixture.resources.setActivityAdmission(false);
		expect(fixture.resources.isActivityAdmitted()).toBe(false);
		expect(() =>
			fixture.resources.setTimeout({ handler: () => {}, ms: 1 }),
		).toThrow(/admission is closed/i);
		expect(() =>
			fixture.resources.createWorker({
				request: {
					id: "suspended-worker",
					url: new URL("https://example.invalid/suspended.js"),
					type: "module",
				},
			}),
		).toThrow(/admission is closed/i);
		await new Promise((resolve) => setTimeout(resolve, 12));
		expect(ticks).toBe(ticksBeforeSuspend);
		expect(fixture.resources.inspect().timer).toEqual({
			created: 1,
			released: 1,
		});

		fixture.resources.setActivityAdmission(true);
		expect(fixture.resources.isActivityAdmitted()).toBe(true);
		expect(fixture.resources.getActivityGeneration()).toBe(
			generationBefore + 1,
		);
		await new Promise((resolve) => setTimeout(resolve, 12));
		expect(ticks).toBeGreaterThan(ticksBeforeSuspend);
		expect(fixture.resources.inspect().timer.created).toBe(2);

		oldInterval.cancel();
		interval.cancel();
		unsubscribe();
		await fixture.resources.disposeAll();
	});

	test("worker termination detaches host listeners and a resumed generation subscribes freshly", async () => {
		const fixture = createFixture();
		let oldMessages = 0;
		let oldErrors = 0;
		const oldWorker = fixture.resources.createWorker({
			request: {
				id: "old-worker",
				url: new URL("https://example.invalid/old.js"),
				type: "module",
			},
		});
		oldWorker.onMessage(() => {
			oldMessages += 1;
		});
		oldWorker.onError(() => {
			oldErrors += 1;
		});
		const oldHostHandle = fixture.runtimeResources.workers[0];
		expect(oldHostHandle.messageListeners.size).toBe(1);
		expect(oldHostHandle.errorListeners.size).toBe(1);

		fixture.resources.beginActivitySuspend();
		await fixture.resources.drainActivityResources();
		expect(oldHostHandle.terminated).toBe(true);
		expect(oldHostHandle.messageListeners.size).toBe(0);
		expect(oldHostHandle.errorListeners.size).toBe(0);
		expect(oldMessages).toBe(0);
		expect(oldErrors).toBe(0);

		fixture.resources.prepareActivityResume();
		fixture.resources.publishActivityResume();
		let freshMessages = 0;
		let freshErrors = 0;
		const freshWorker = fixture.resources.createWorker({
			request: {
				id: "fresh-worker",
				url: new URL("https://example.invalid/fresh.js"),
				type: "module",
			},
		});
		freshWorker.onMessage(() => {
			freshMessages += 1;
		});
		freshWorker.onError(() => {
			freshErrors += 1;
		});
		const freshHostHandle = fixture.runtimeResources.workers[1];
		for (const listener of freshHostHandle.messageListeners) {
			listener({ data: "fresh" });
		}
		for (const listener of freshHostHandle.errorListeners) {
			listener({ message: "fresh" });
		}
		expect(freshMessages).toBe(1);
		expect(freshErrors).toBe(1);

		freshWorker.terminate();
		await Promise.resolve();
		expect(freshHostHandle.messageListeners.size).toBe(0);
		expect(freshHostHandle.errorListeners.size).toBe(0);
		await fixture.resources.disposeAll();
	});

	test("suspend terminally cancels a due RAF instead of suppressing a live handle", async () => {
		const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
		const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
		let nextFrameId = 0;
		const scheduled = new Map<number, FrameRequestCallback>();
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
			const frameId = ++nextFrameId;
			scheduled.set(frameId, callback);
			return frameId;
		};
		globalThis.cancelAnimationFrame = (frameId: number) => {
			scheduled.delete(frameId);
		};

		try {
			const fixture = createFixture();
			let callbackCount = 0;
			fixture.resources.requestAnimationFrame({
				handler: () => {
					callbackCount += 1;
				},
			});
			expect(scheduled.size).toBe(1);

			fixture.resources.setActivityAdmission(false);
			await Promise.resolve();
			expect(scheduled.size).toBe(0);
			expect(callbackCount).toBe(0);
			expect(fixture.resources.inspect().timer).toEqual({
				created: 1,
				released: 1,
			});

			fixture.resources.setActivityAdmission(true);
			expect(scheduled.size).toBe(0);
			await fixture.resources.disposeAll();
		} finally {
			globalThis.requestAnimationFrame = previousRequestAnimationFrame;
			globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
		}
	});

	test("a fired RAF self-releases exactly once", async () => {
		const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
		const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
		const scheduled: { callback: FrameRequestCallback | null } = {
			callback: null,
		};
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
			scheduled.callback = callback;
			return 1;
		};
		globalThis.cancelAnimationFrame = () => {
			scheduled.callback = null;
		};

		try {
			const fixture = createFixture();
			let callbackCount = 0;
			fixture.resources.requestAnimationFrame({
				handler: () => {
					callbackCount += 1;
				},
			});
			const callback = scheduled.callback;
			expect(callback).not.toBeNull();
			callback?.(16);
			await Promise.resolve();

			expect(callbackCount).toBe(1);
			expect(fixture.resources.inspect().timer).toEqual({
				created: 1,
				released: 1,
			});
			await fixture.resources.disposeAll();
			expect(fixture.resources.inspect().timer).toEqual({
				created: 1,
				released: 1,
			});
		} finally {
			globalThis.requestAnimationFrame = previousRequestAnimationFrame;
			globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
		}
	});

	test("suspend between nested paint frames settles the waiter and releases both frames", async () => {
		const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
		const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
		let nextFrameId = 0;
		const scheduled = new Map<number, FrameRequestCallback>();
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
			const frameId = ++nextFrameId;
			scheduled.set(frameId, callback);
			return frameId;
		};
		globalThis.cancelAnimationFrame = (frameId: number) => {
			scheduled.delete(frameId);
		};

		try {
			const fixture = createFixture();
			const pendingPaint = waitForTwoSessionFrames(fixture.resources);
			const firstEntry = [...scheduled.entries()][0];
			expect(firstEntry).toBeDefined();
			if (!firstEntry) throw new Error("Expected the first paint frame.");
			scheduled.delete(firstEntry[0]);
			firstEntry[1](16);
			expect(scheduled.size).toBe(1);

			fixture.resources.beginActivitySuspend();
			await expect(pendingPaint).rejects.toThrow(/generation .* is stale/i);
			expect(scheduled.size).toBe(0);
			expect(fixture.resources.inspect().timer).toEqual({
				created: 2,
				released: 2,
			});
			await fixture.resources.disposeAll();
		} finally {
			globalThis.requestAnimationFrame = previousRequestAnimationFrame;
			globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
		}
	});

	test("the retained RAF-loop owner reacquires a fresh chain only after resume publication", async () => {
		const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
		const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;
		let nextFrameId = 0;
		const scheduled = new Map<number, FrameRequestCallback>();
		globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
			const frameId = ++nextFrameId;
			scheduled.set(frameId, callback);
			return frameId;
		};
		globalThis.cancelAnimationFrame = (frameId: number) => {
			scheduled.delete(frameId);
		};

		try {
			const fixture = createFixture();
			const deltas: number[] = [];
			const requests: Array<{ resourceId: string; generation: number }> = [];
			const stop = createRafLoop({
				callback: ({ time }) => deltas.push(time),
				resources: fixture.resources,
				onRequest: ({ resourceId, generation }) => {
					requests.push({ resourceId, generation });
				},
			});
			const fireNext = (time: number) => {
				const entry = [...scheduled.entries()][0];
				if (!entry) throw new Error("Expected a scheduled RAF.");
				scheduled.delete(entry[0]);
				entry[1](time);
			};

			expect(requests).toHaveLength(1);
			const oldGenerationResourceId = requests[0]?.resourceId;
			fireNext(10);
			expect(scheduled.size).toBe(1);
			fixture.resources.beginActivitySuspend();
			await fixture.resources.drainActivityResources();
			expect(scheduled.size).toBe(0);
			expect(deltas).toEqual([]);
			const requestCountDuringDwell = requests.length;

			fixture.resources.prepareActivityResume();
			expect(scheduled.size).toBe(0);
			expect(requests).toHaveLength(requestCountDuringDwell);
			fixture.resources.publishActivityResume();
			expect(scheduled.size).toBe(1);
			expect(requests).toHaveLength(requestCountDuringDwell + 1);
			expect(requests.at(-1)).toMatchObject({ generation: 1 });
			expect(requests.at(-1)?.resourceId).not.toBe(oldGenerationResourceId);
			fireNext(30);
			fireNext(42);
			expect(deltas).toEqual([12]);

			stop();
			await fixture.resources.disposeAll();
			expect(fixture.resources.inspect().timer).toEqual({
				created: 5,
				released: 5,
			});
		} finally {
			globalThis.requestAnimationFrame = previousRequestAnimationFrame;
			globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
		}
	});
});
