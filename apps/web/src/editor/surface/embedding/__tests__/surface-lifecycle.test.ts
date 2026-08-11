/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import { describe, expect, test } from "bun:test";

import type {
	EditorSession,
	EditorSessionRootHandle,
	SessionState,
} from "@/editor/session";

import { createSurfaceLifecycleController } from "../surface-lifecycle";

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

class FakeSession {
	readonly mountTargets: Element[] = [];
	readonly readyRuns: Array<ReturnType<typeof deferred<void>>> = [];
	readonly suspendRuns: Array<ReturnType<typeof deferred<void>>> = [];
	readonly resumeRuns: Array<ReturnType<typeof deferred<void>>> = [];
	unmountCalls = 0;
	disposeCalls = 0;
	unmountFailure: Error | null = null;
	state: SessionState = "created";

	mount({ target }: { target: Element }): EditorSessionRootHandle {
		this.mountTargets.push(target);
		if (this.state !== "suspended") this.state = "mounted";
		const ready = deferred<void>();
		this.readyRuns.push(ready);
		return {
			sessionId:
				`fake-${this.mountTargets.length}` as EditorSessionRootHandle["sessionId"],
			container: target,
			ready: ready.promise,
			state: "mounting",
			unmount: async () => {},
		};
	}

	suspend(): Promise<void> {
		const run = deferred<void>();
		this.suspendRuns.push(run);
		return run.promise.then(() => {
			this.state = "suspended";
		});
	}

	resume(): Promise<void> {
		const run = deferred<void>();
		this.resumeRuns.push(run);
		return run.promise.then(() => {
			this.state = "mounted";
		});
	}

	async unmount(): Promise<void> {
		this.unmountCalls += 1;
		if (this.unmountFailure) throw this.unmountFailure;
		if (this.state !== "suspended") this.state = "created";
	}

	async dispose(): Promise<never> {
		this.disposeCalls += 1;
		throw new Error("Surface must never dispose a session");
	}
}

function asSession(session: FakeSession): EditorSession {
	return session as unknown as EditorSession;
}

const target = {} as Element;

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("Surface lifecycle controller", () => {
	test("publishes ready only after the live handle settles", async () => {
		const session = new FakeSession();
		const ready: string[] = [];
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => ready.push("ready"),
			onError: (error) => errors.push(error),
		});
		const cleanup = controller.mount({ session: asSession(session), target });

		expect(session.mountTargets).toEqual([target]);
		expect(ready).toEqual([]);
		session.readyRuns[0]!.resolve();
		await flush();
		expect(ready).toEqual(["ready"]);
		expect(errors).toEqual([]);
		cleanup();
		await controller.whenIdle();
		expect(session.unmountCalls).toBe(1);
		expect(session.disposeCalls).toBe(0);
	});

	test("suppresses stale readiness resolution and rejection after unmount", async () => {
		for (const settle of ["resolve", "reject"] as const) {
			const session = new FakeSession();
			const ready: string[] = [];
			const errors: Error[] = [];
			const controller = createSurfaceLifecycleController({
				onReady: () => ready.push("ready"),
				onError: (error) => errors.push(error),
			});
			const cleanup = controller.mount({ session: asSession(session), target });
			cleanup();
			if (settle === "resolve") session.readyRuns[0]!.resolve();
			else session.readyRuns[0]!.reject(new Error("stale ready"));
			await controller.whenIdle();
			await flush();
			expect(ready).toEqual([]);
			expect(errors).toEqual([]);
			expect(session.unmountCalls).toBe(1);
			expect(session.disposeCalls).toBe(0);
		}
	});

	test("reports a live ready rejection exactly once", async () => {
		const session = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {
				throw new Error("unexpected ready");
			},
			onError: (error) => errors.push(error),
		});
		const cleanup = controller.mount({ session: asSession(session), target });
		session.readyRuns[0]!.reject(new Error("ready failed"));
		await flush();
		expect(errors.map((error) => error.message)).toEqual(["ready failed"]);
		cleanup();
		await controller.whenIdle();
	});

	test("serializes latest visibility, coalesces redundant values, and delegates only", async () => {
		const session = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: (error) => errors.push(error),
		});
		const cleanup = controller.mount({ session: asSession(session), target });
		controller.setVisibility("hidden");
		controller.setVisibility("hidden");
		await flush();
		expect(session.suspendRuns).toHaveLength(1);
		expect(session.resumeRuns).toHaveLength(0);

		controller.setVisibility("visible");
		controller.setVisibility("visible");
		expect(session.resumeRuns).toHaveLength(0);
		session.suspendRuns[0]!.resolve();
		await flush();
		expect(session.resumeRuns).toHaveLength(1);
		session.resumeRuns[0]!.resolve();
		await controller.whenIdle();
		expect(errors).toEqual([]);
		cleanup();
		await controller.whenIdle();
	});

	test("rapid hidden-visible-hidden converges without a stale resume", async () => {
		const session = new FakeSession();
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: () => {},
		});
		const cleanup = controller.mount({ session: asSession(session), target });
		controller.setVisibility("hidden");
		await flush();
		controller.setVisibility("visible");
		controller.setVisibility("hidden");
		session.suspendRuns[0]!.resolve();
		await controller.whenIdle();
		expect(session.suspendRuns).toHaveLength(1);
		expect(session.resumeRuns).toHaveLength(0);
		cleanup();
		await controller.whenIdle();
	});

	test("reports a live suspend rejection once without success, retry, or cleanup drift", async () => {
		const session = new FakeSession();
		const ready: string[] = [];
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => ready.push("ready"),
			onError: (error) => errors.push(error),
		});
		const cleanup = controller.mount({ session: asSession(session), target });
		controller.setVisibility("hidden");
		await flush();
		expect(session.suspendRuns).toHaveLength(1);
		const failure = new Error("suspend failed");
		session.suspendRuns[0]!.reject(failure);
		await controller.whenIdle();
		expect(errors).toEqual([failure]);
		expect(ready).toEqual([]);
		expect(session.suspendRuns).toHaveLength(1);
		expect(session.resumeRuns).toHaveLength(0);
		cleanup();
		await controller.whenIdle();
		expect(session.unmountCalls).toBe(1);
		expect(session.disposeCalls).toBe(0);
	});

	test("reports a live resume rejection once without success, retry, or cleanup drift", async () => {
		const session = new FakeSession();
		const ready: string[] = [];
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => ready.push("ready"),
			onError: (error) => errors.push(error),
		});
		const cleanup = controller.mount({ session: asSession(session), target });
		controller.setVisibility("hidden");
		await flush();
		session.suspendRuns[0]!.resolve();
		await controller.whenIdle();
		expect(session.state).toBe("suspended");

		controller.setVisibility("visible");
		await flush();
		expect(session.resumeRuns).toHaveLength(1);
		const failure = new Error("resume failed");
		session.resumeRuns[0]!.reject(failure);
		await controller.whenIdle();
		expect(errors).toEqual([failure]);
		expect(ready).toEqual([]);
		expect(session.resumeRuns).toHaveLength(1);
		expect(session.suspendRuns).toHaveLength(1);
		cleanup();
		await controller.whenIdle();
		expect(session.unmountCalls).toBe(1);
		expect(session.disposeCalls).toBe(0);
	});

	test("visible remount resumes one retained suspended session", async () => {
		const session = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: (error) => errors.push(error),
		});
		const firstCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		controller.setVisibility("hidden");
		await flush();
		session.suspendRuns[0]!.resolve();
		await controller.whenIdle();
		expect(session.state).toBe("suspended");
		firstCleanup();
		await controller.whenIdle();
		expect(session.state).toBe("suspended");

		const secondCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		controller.setVisibility("visible");
		await flush();
		expect(session.resumeRuns).toHaveLength(1);
		session.resumeRuns[0]!.resolve();
		await controller.whenIdle();
		expect(session.state).toBe("mounted");
		expect(session.resumeRuns).toHaveLength(1);
		expect(errors).toEqual([]);
		secondCleanup();
		await controller.whenIdle();
		expect(session.unmountCalls).toBe(2);
		expect(session.disposeCalls).toBe(0);
	});

	test("visible remount queues one resume behind an in-flight suspend", async () => {
		const session = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: (error) => errors.push(error),
		});
		const firstCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		controller.setVisibility("hidden");
		await flush();
		expect(session.suspendRuns).toHaveLength(1);

		firstCleanup();
		const secondCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		controller.setVisibility("visible");
		await flush();
		expect(session.resumeRuns).toHaveLength(1);
		expect(session.suspendRuns[0]!.promise).not.toBeUndefined();

		session.suspendRuns[0]!.resolve();
		await flush();
		expect(session.state).toBe("suspended");
		session.resumeRuns[0]!.resolve();
		await controller.whenIdle();
		expect(session.state).toBe("mounted");
		expect(session.suspendRuns).toHaveLength(1);
		expect(session.resumeRuns).toHaveLength(1);
		expect(session.unmountCalls).toBe(1);
		expect(session.disposeCalls).toBe(0);
		expect(errors).toEqual([]);

		secondCleanup();
		await controller.whenIdle();
		expect(session.unmountCalls).toBe(2);
		expect(session.disposeCalls).toBe(0);
	});

	test("session replacement invalidates old work and keeps the new generation live", async () => {
		const oldSession = new FakeSession();
		const newSession = new FakeSession();
		const ready: string[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => ready.push("ready"),
			onError: () => {},
		});
		const cleanupOld = controller.mount({
			session: asSession(oldSession),
			target,
		});
		cleanupOld();
		const cleanupNew = controller.mount({
			session: asSession(newSession),
			target,
		});
		oldSession.readyRuns[0]!.resolve();
		newSession.readyRuns[0]!.resolve();
		await flush();
		expect(ready).toEqual(["ready"]);
		expect(oldSession.unmountCalls).toBe(1);
		expect(newSession.unmountCalls).toBe(0);
		cleanupNew();
		await controller.whenIdle();
		expect(newSession.unmountCalls).toBe(1);
	});

	test("Strict-Mode-shaped remount is reversible and cleanup failure is attributable", async () => {
		const session = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: (error) => errors.push(error),
		});
		const firstCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		firstCleanup();
		await controller.whenIdle();
		const secondCleanup = controller.mount({
			session: asSession(session),
			target,
		});
		session.readyRuns[1]!.resolve();
		await flush();
		session.unmountFailure = new Error("unmount failed");
		secondCleanup();
		secondCleanup();
		await controller.whenIdle();
		expect(session.mountTargets).toHaveLength(2);
		expect(session.unmountCalls).toBe(2);
		expect(session.disposeCalls).toBe(0);
		expect(errors.map((error) => error.message)).toEqual(["unmount failed"]);
	});

	test("stale visibility failures do not publish into a replacement", async () => {
		const oldSession = new FakeSession();
		const newSession = new FakeSession();
		const errors: Error[] = [];
		const controller = createSurfaceLifecycleController({
			onReady: () => {},
			onError: (error) => errors.push(error),
		});
		const oldCleanup = controller.mount({
			session: asSession(oldSession),
			target,
		});
		controller.setVisibility("hidden");
		await flush();
		oldCleanup();
		const newCleanup = controller.mount({
			session: asSession(newSession),
			target,
		});
		oldSession.suspendRuns[0]!.reject(new Error("stale suspend"));
		await flush();
		expect(errors).toEqual([]);
		newCleanup();
		await controller.whenIdle();
	});
});
