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
		// A host awaiting readiness on a root that no longer exists must not hang.
		await handle.ready;
		expect(session.state).toBe("created");
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
		session.resources.trackGpuResource({ label: "texture", release: () => {} });

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
			label: "first",
			release: () => {},
		});
		const second = session.resources.trackGpuResource({
			label: "second",
			release: () => {},
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
			session.resources.trackGpuResource({ label: "late", release: () => {} }),
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
