import { beforeEach, describe, expect, test } from "bun:test";
import { createEditorSession } from "../create-session";
import { createInMemoryHost } from "@/editor/ports/in-memory/host";
import {
	InMemoryProjectStore,
	RecordingDiagnostics,
} from "@/editor/ports/in-memory";
import { resolveEditorHost } from "@/editor/host/editor-host";
import type { MigrationOutcome } from "@/editor/ports";

/**
 * A stand-in for a mounted container.
 *
 * `Element` is a DOM type and there is no DOM in the test runner. The session
 * does not render into the container — rendering is C2/C3's — so what the
 * lifecycle needs from it is identity, and an object cast to `Element` supplies
 * exactly that without pulling a DOM implementation into the gate.
 */
function fakeElement(name: string): Element {
	return { nodeName: name } as unknown as Element;
}

describe("session creation", () => {
	test("a session is created from an explicit dependency object", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		expect(session.id.length).toBeGreaterThan(0);
		expect(session.state).toBe("created");
	});

	test("two sessions with different dependencies are independent values", async () => {
		const a = await createEditorSession({
			host: createInMemoryHost({ projectId: "project-a" }),
		});
		const b = await createEditorSession({
			host: createInMemoryHost({ projectId: "project-b" }),
		});
		expect(a).not.toBe(b);
		expect(a.projectId).toBe("project-a");
		expect(b.projectId).toBe("project-b");
		expect(a.host).not.toBe(b.host);
		expect(a.resources).not.toBe(b.resources);
	});

	test("a host missing port roles is refused by name, not defaulted", () => {
		const host = createInMemoryHost();
		// Legal, because the port roles are `Partial` on `EditorHost` so that both
		// hosts keep compiling while they are wired one role at a time. The gate is
		// one level in: `resolveEditorHost` refuses, by name.
		delete host.store;
		expect(() => resolveEditorHost({ host })).toThrow(/store/);
	});
});

describe("mount returns a root handle synchronously", () => {
	test("the handle exists before mounting completes", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const container = fakeElement("DIV");
		const handle = session.mount({ target: container });
		// Synchronously, in the same turn: no await between mount and these reads.
		expect(handle.state).toBe("mounting");
		expect(handle.container).toBe(container);
		expect(handle.sessionId).toBe(session.id);
		expect(handle.ready).toBeInstanceOf(Promise);
		await handle.ready;
		expect(handle.state).toBe("mounted");
	});

	test("unmount is callable while mounting is still in progress", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		expect(handle.state).toBe("mounting");
		await handle.unmount();
		expect(handle.state).toBe("unmounted");
		expect(session.state).toBe("created");
	});

	test("ready REJECTS when the root is unmounted before mounting completes", async () => {
		// The guard a host puts in front of touching the root. If this resolved,
		// `await handle.ready; attach()` would walk straight onto a dead root —
		// which is the readiness half of the synchronous-mount decision failing to
		// do its job.
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.unmount();
		await expect(handle.ready).rejects.toThrow(/unmounted before mounting/);
	});

	test("ready resolves normally when mounting completes", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		expect(handle.state).toBe("mounted");
		// Unmounting an already-mounted root does not retroactively reject.
		await handle.unmount();
		await handle.ready;
	});

	test("unmount is idempotent", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		await handle.unmount();
		await handle.unmount();
		expect(handle.state).toBe("unmounted");
	});

	test("a session has at most one live root", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		session.mount({ target: fakeElement("DIV") });
		expect(() => session.mount({ target: fakeElement("SECTION") })).toThrow(
			/already has a live root/,
		);
	});

	test("after unmount, a session can be mounted again", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const first = session.mount({ target: fakeElement("DIV") });
		await first.ready;
		await session.unmount();
		const second = session.mount({ target: fakeElement("SECTION") });
		expect(second.state).toBe("mounting");
	});
});

describe("suspend and resume are distinguishable from unmount", () => {
	test("suspend retains identity and project state", async () => {
		const session = await createEditorSession({
			host: createInMemoryHost({ projectId: "kept" }),
		});
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		await session.suspend();
		expect(session.state).toBe("suspended");
		expect(session.projectId).toBe("kept");
		expect(handle.state).toBe("mounted");
		await session.resume();
		expect(session.state).toBe("mounted");
	});

	test("unmount releases the mounted root", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		await session.unmount();
		expect(handle.state).toBe("unmounted");
		expect(session.state).toBe("created");
	});

	test("suspend twice and resume from a non-suspended state are no-ops", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		await session.resume();
		expect(session.state).toBe("created");
		session.mount({ target: fakeElement("DIV") });
		await session.suspend();
		await session.suspend();
		expect(session.state).toBe("suspended");
	});
});

describe("disposal", () => {
	test("disposal implies unmount", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		await session.dispose();
		expect(handle.state).toBe("unmounted");
		expect(session.state).toBe("disposed");
	});

	test("dispose is idempotent", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const first = await session.dispose();
		const second = await session.dispose();
		expect(second.timer.created).toBe(first.timer.created);
		expect(session.state).toBe("disposed");
	});

	test("every class is reported, and an untouched class reports zero", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const report = await session.dispose();
		for (const cls of [
			"timer",
			"worker",
			"audioContext",
			"objectUrl",
			"gpuResource",
		] as const) {
			// Present, not absent — "created zero" and "never measured" must be
			// distinguishable, which is the failure E0's numbers had.
			expect(report[cls]).toEqual({ created: 0, released: 0 });
		}
	});

	test("the report gives created as well as released, per class", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		session.resources.setInterval({ handler: () => {}, ms: 10_000 });
		session.resources.createWorker({
			request: {
				id: "w",
				url: new URL("https://example.invalid/w.js"),
				type: "module",
			},
		});
		session.resources.createAudioContext({});
		session.resources.createObjectUrl({ blob: new Blob(["x"]) });
		session.resources.trackGpuResource({ handle: 1, label: "texture" });

		const before = session.resources.inspect();
		expect(before.worker).toEqual({ created: 1, released: 0 });

		const report = await session.dispose();
		expect(report.timer).toEqual({ created: 1, released: 1 });
		expect(report.worker).toEqual({ created: 1, released: 1 });
		expect(report.audioContext).toEqual({ created: 1, released: 1 });
		expect(report.objectUrl).toEqual({ created: 1, released: 1 });
		expect(report.gpuResource).toEqual({ created: 1, released: 1 });
	});

	test("resources are released in reverse acquisition order", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const first = session.resources.trackGpuResource({
			handle: 1,
			label: "first",
		});
		const second = session.resources.trackGpuResource({
			handle: 2,
			label: "second",
		});
		const report = await session.dispose();
		const ids = report.releaseOrder.map((r) => r.resourceId);
		expect(ids.indexOf(second.resourceId)).toBeLessThan(
			ids.indexOf(first.resourceId),
		);
	});

	test("acquiring after disposal is refused rather than leaked", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		await session.dispose();
		expect(() =>
			session.resources.trackGpuResource({ handle: 9, label: "late" }),
		).toThrow(/disposed/);
	});

	test("the underlying host resource is actually released", async () => {
		const host = createInMemoryHost();
		const session = await createEditorSession({ host });
		const runtime = host.runtimeResources;
		session.resources.createWorker({
			request: {
				id: "w",
				url: new URL("https://example.invalid/w.js"),
				type: "module",
			},
		});
		session.resources.createObjectUrl({ blob: new Blob(["x"]) });
		await session.dispose();
		// Not merely counted as released — the host object's own state changed.
		const asMemory = runtime as unknown as {
			workers: { isTerminated: boolean }[];
			objectUrls: { revoked: boolean }[];
			audioContexts: { closed: boolean }[];
		};
		expect(asMemory.workers.every((w) => w.isTerminated)).toBe(true);
		expect(asMemory.objectUrls.every((u) => u.revoked)).toBe(true);
	});
});

describe("GPU disposal is reconciled against the runtime, not merely tracked", () => {
	test("a handle the runtime holds but the session never tracked is reported", async () => {
		// The blind spot this reconciliation exists to close: a forgotten
		// trackGpuResource is invisible to a registry that only sees what it was
		// handed. Here handle 7 is never tracked.
		const session = await createEditorSession({
			host: createInMemoryHost(),
			runtimeGpu: { liveHandles: () => [7], release: () => {} },
		});
		session.resources.trackGpuResource({ handle: 1, label: "tracked" });
		const report = await session.dispose();
		expect(report.gpuReconciliation.untracked).toEqual([7]);
		expect(report.gpuReconciliation.source).toBe("runtime");
	});

	test("a tracked handle the runtime still holds after release is reported as leaked", async () => {
		const stillLive = [1];
		const session = await createEditorSession({
			host: createInMemoryHost(),
			// A teardown that does not take: release is a no-op, so the handle stays
			// live. Without reconciliation the report would call this fully released.
			runtimeGpu: { liveHandles: () => stillLive, release: () => {} },
		});
		session.resources.trackGpuResource({ handle: 1, label: "texture" });
		const report = await session.dispose();
		expect(report.gpuResource).toEqual({ created: 1, released: 1 });
		expect(report.gpuReconciliation.leaked).toEqual([1]);
	});

	test("release goes through the runtime's teardown, keyed by the handle", async () => {
		const released: number[] = [];
		const live = new Set([4]);
		const session = await createEditorSession({
			host: createInMemoryHost(),
			runtimeGpu: {
				liveHandles: () => [...live],
				release: ({ handle }) => {
					released.push(handle);
					live.delete(handle);
				},
			},
		});
		session.resources.trackGpuResource({ handle: 4, label: "buffer" });
		const report = await session.dispose();
		expect(released).toEqual([4]);
		expect(report.gpuReconciliation.leaked).toEqual([]);
		expect(report.gpuReconciliation.untracked).toEqual([]);
	});

	test("an un-replaced runtime is visibly unimplemented, not a clean zero", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const report = await session.dispose();
		expect(report.gpuReconciliation.source).toBe("unimplemented");
	});
});

describe("migration is owned by the store and run once per store", () => {
	let calls: number;

	beforeEach(() => {
		calls = 0;
	});

	function migratingStore(): InMemoryProjectStore {
		return new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx): Promise<MigrationOutcome> => {
				calls += 1;
				ctx.report({ completed: 1, total: 2, label: "projects" });
				ctx.report({ completed: 2, total: 2, label: "projects" });
				return {
					status: "migrated",
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 2,
				};
			},
		});
	}

	test("migration runs once during create", async () => {
		const store = migratingStore();
		await createEditorSession({ host: createInMemoryHost({ store }) });
		expect(calls).toBe(1);
	});

	test("a second session against the same store does not run it again", async () => {
		const store = migratingStore();
		await createEditorSession({ host: createInMemoryHost({ store }) });
		await createEditorSession({ host: createInMemoryHost({ store }) });
		expect(calls).toBe(1);
	});

	test("progress is observable on the session's diagnostics channel", async () => {
		const store = migratingStore();
		const host = createInMemoryHost({ store });
		const session = await createEditorSession({ host });
		const recorded = host.diagnostics as RecordingDiagnostics;
		const kinds = recorded.events.map((e) => e.event.kind);
		expect(kinds).toContain("migration-started");
		expect(kinds).toContain("migration-progress");
		expect(kinds).toContain("migration-finished");
		// Session-scoped, not global: two sessions sharing a host stay
		// distinguishable in its output.
		expect(recorded.events.every((e) => e.sessionId === session.id)).toBe(true);
	});

	test("a store with no legacy data is not required to migrate", async () => {
		const host = createInMemoryHost();
		const session = await createEditorSession({ host });
		const recorded = host.diagnostics as RecordingDiagnostics;
		expect(recorded.events).toEqual([]);
		expect(session.state).toBe("created");
	});

	test("two CONCURRENT creations against one store run migration once, and the second waits", async () => {
		// The race a "started" flag misses: marking before the await lets the
		// second caller return while migration is still running, which violates
		// "before any project is loaded" in exactly the two-sessions-in-one-page
		// case the Slice requires.
		let running = false;
		let overlapped = false;
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const store = new InMemoryProjectStore({
			schemaVersion: 2,
			migrate: async (ctx): Promise<MigrationOutcome> => {
				calls += 1;
				if (running) overlapped = true;
				running = true;
				await gate;
				running = false;
				return {
					status: "migrated",
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 1,
				};
			},
		});

		let secondFinishedWhileMigrating = false;
		const first = createEditorSession({ host: createInMemoryHost({ store }) });
		const second = createEditorSession({
			host: createInMemoryHost({ store }),
		}).then((s) => {
			secondFinishedWhileMigrating = running;
			return s;
		});

		release();
		await Promise.all([first, second]);
		expect(calls).toBe(1);
		expect(overlapped).toBe(false);
		expect(secondFinishedWhileMigrating).toBe(false);
	});

	test("`from` carries the persisted version, not a copy of `to`", async () => {
		const store = new InMemoryProjectStore({
			schemaVersion: 5,
			migrate: async (ctx): Promise<MigrationOutcome> => ({
				status: "migrated",
				from: ctx.from,
				to: ctx.to,
				recordsMigrated: 3,
			}),
		});
		// The store can report its on-disk version, so `from` must be it.
		(store as InMemoryProjectStore & {
			persistedSchemaVersion?: () => Promise<number | null>;
		}).persistedSchemaVersion = async () => 2;

		const host = createInMemoryHost({ store });
		await createEditorSession({ host });
		const recorded = host.diagnostics as RecordingDiagnostics;
		const started = recorded.events.find(
			(e) => e.event.kind === "migration-started",
		)?.event;
		expect(started).toMatchObject({ from: 2, to: 5 });
		const finished = recorded.events.find(
			(e) => e.event.kind === "migration-finished",
		)?.event;
		expect(finished).toMatchObject({ from: 2, to: 5, recordsMigrated: 3 });
	});

	test("`from` is null, not a fabricated number, when the store cannot report it", async () => {
		const store = migratingStore();
		const host = createInMemoryHost({ store });
		await createEditorSession({ host });
		const recorded = host.diagnostics as RecordingDiagnostics;
		const started = recorded.events.find(
			(e) => e.event.kind === "migration-started",
		)?.event;
		expect(started).toMatchObject({ from: null, to: 2 });
	});

	test("a FAILED migration fails session creation rather than proceeding", async () => {
		const store = new InMemoryProjectStore({
			schemaVersion: 3,
			migrate: async (ctx): Promise<MigrationOutcome> => {
				calls += 1;
				return {
					status: "failed",
					from: ctx.from,
					to: ctx.to,
					reason: "disk full",
				};
			},
		});
		await expect(
			createEditorSession({ host: createInMemoryHost({ store }) }),
		).rejects.toThrow(/migration failed/i);
	});

	test("BOTH concurrent creations reject when the shared migration fails, and the memo is evicted", async () => {
		// The eviction happens inside the memoised promise's own `.catch`, so the
		// second concurrent awaiter takes a different code path from the sequential
		// retry below: it is awaiting the *already-stored* promise when that
		// promise rejects. Both must reject, and the store must still be retryable
		// afterwards rather than left holding a settled rejected promise.
		let attempts = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const store = new InMemoryProjectStore({
			schemaVersion: 4,
			migrate: async (ctx): Promise<MigrationOutcome> => {
				attempts += 1;
				if (attempts === 1) {
					await gate;
					return {
						status: "failed",
						from: ctx.from,
						to: ctx.to,
						reason: "transient",
					};
				}
				return {
					status: "migrated",
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 0,
				};
			},
		});

		const a = createEditorSession({ host: createInMemoryHost({ store }) });
		const b = createEditorSession({ host: createInMemoryHost({ store }) });
		release();
		const settled = await Promise.allSettled([a, b]);
		expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected"]);
		expect(attempts).toBe(1);

		// Evicted, so a later session retries and succeeds.
		const third = await createEditorSession({
			host: createInMemoryHost({ store }),
		});
		expect(attempts).toBe(2);
		expect(third.state).toBe("created");
	});

	test("a failed migration is retried by a later session, not poisoned forever", async () => {
		let attempts = 0;
		const store = new InMemoryProjectStore({
			schemaVersion: 3,
			migrate: async (ctx): Promise<MigrationOutcome> => {
				attempts += 1;
				if (attempts === 1) {
					return {
						status: "failed",
						from: ctx.from,
						to: ctx.to,
						reason: "transient",
					};
				}
				return {
					status: "migrated",
					from: ctx.from,
					to: ctx.to,
					recordsMigrated: 0,
				};
			},
		});
		await expect(
			createEditorSession({ host: createInMemoryHost({ store }) }),
		).rejects.toThrow();
		const session = await createEditorSession({
			host: createInMemoryHost({ store }),
		});
		expect(attempts).toBe(2);
		expect(session.state).toBe("created");
	});
});

describe("the read surface cannot yield a never-updating snapshot", () => {
	test("watch delivers the current value and then every change", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const seen: (string | null)[] = [];
		const subscription = session.watch({
			select: (s) => s.lifecycle,
			onChange: (value) => {
				seen.push(value);
			},
		});
		expect(seen).toEqual(["created"]);
		const handle = session.mount({ target: fakeElement("DIV") });
		await handle.ready;
		expect(seen).toContain("mounted");
		subscription.unsubscribe();
		await session.dispose();
		expect(seen).not.toContain("disposed");
	});

	test("there is no read that does not subscribe", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		// The contract's read surface is `watch` alone. This asserts on the shipped
		// object rather than on the type, so removing the type would not hide it.
		const surface = session as unknown as Record<string, unknown>;
		for (const forbidden of [
			"getSnapshot",
			"getState",
			"snapshot",
			"read",
			"peek",
		]) {
			expect(surface[forbidden]).toBeUndefined();
		}
		expect(typeof session.watch).toBe("function");
	});
});

describe("capabilities", () => {
	test("a no-rasterizer host is constructible and still creates a session", async () => {
		const session = await createEditorSession({
			host: createInMemoryHost({
				graphics: { mode: "force", rasterizer: "none" },
			}),
		});
		const report = await session.capabilities.graphics();
		expect(report.rasterizer).toBe("none");
		expect(report.livePreviewLimit).toBe(0);
		expect(session.state).toBe("created");
	});

	test("the report is produced by the runtime, not asserted by the host", async () => {
		const session = await createEditorSession({
			host: createInMemoryHost(),
			runtimeGraphics: {
				selectedBackend: () => "webgpu",
				concurrentCompositorInstances: () => 2,
			},
		});
		const report = await session.capabilities.graphics();
		expect(report.backend).toBe("webgpu");
		expect(report.livePreviewLimit).toBe(2);
	});

	test("nothing in the session signature requires a process-global editor", async () => {
		const session = await createEditorSession({ host: createInMemoryHost() });
		const surface = session as unknown as Record<string, unknown>;
		for (const forbidden of ["getInstance", "instance", "core", "editor"]) {
			expect(surface[forbidden]).toBeUndefined();
		}
	});
});
