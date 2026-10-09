import { expect, test } from "bun:test";
import { enableParticleRootContext } from "../programmatic/particle-capture-context";
import { fakeBrowser } from "./particle-broker-test-support";

const created = (
	id: number,
	frameId = "root",
	isDefault = true,
	sessionId = "session",
) => ({
	sessionId,
	method: "Runtime.executionContextCreated",
	params: { context: { id, auxData: { frameId, isDefault } } },
});

test("context is discovered from root default realm during Runtime.enable, not page requests", async () => {
	const f = fakeBrowser(async (method) => {
		if (method === "Page.getFrameTree")
			return { frameTree: { frame: { id: "root" } } };
		if (method === "Runtime.enable") {
			expect(f.listeners.size).toBe(1);
			f.emitEvent(created(2, "child"));
			f.emitEvent(created(3, "root", false));
			f.emitEvent(created(4, "root", true, "other"));
			f.emit("{}", 9, "session");
			f.emitEvent(created(17));
		}
		return {};
	});
	const context = await enableParticleRootContext({
		browser: f.browser,
		session: "session",
		signal: new AbortController().signal,
		timeoutMs: 100,
	});
	expect(context.executionContextId).toBe(17);
	expect(f.listeners.size).toBe(1);
	context.check();
	f.emitEvent({
		sessionId: "session",
		method: "Runtime.executionContextDestroyed",
		params: { executionContextId: 2 },
	});
	context.check();
	f.emitEvent({
		sessionId: "session",
		method: "Runtime.executionContextDestroyed",
		params: { executionContextId: 17 },
	});
	await expect(context.failure).rejects.toThrow("destroyed");
	expect(context.check).toThrow("destroyed");
	context.dispose();
	expect(f.listeners.size).toBe(0);
});

test("root context replacement, outer navigation, clear and abort fail the retained monitor", async () => {
	for (const cause of ["replacement", "navigation", "clear", "abort"]) {
		const controller = new AbortController();
		const f = fakeBrowser(async (method) => {
			if (method === "Page.getFrameTree")
				return { frameTree: { frame: { id: "root" } } };
			if (method === "Runtime.enable") f.emitEvent(created(17));
			return {};
		});
		const context = await enableParticleRootContext({
			browser: f.browser,
			session: "session",
			signal: controller.signal,
			timeoutMs: 100,
		});
		if (cause === "replacement") f.emitEvent(created(18));
		if (cause === "navigation")
			f.emitEvent({
				sessionId: "session",
				method: "Page.frameNavigated",
				params: { frame: { id: "root" } },
			});
		if (cause === "clear")
			f.emitEvent({
				sessionId: "session",
				method: "Runtime.executionContextsCleared",
				params: {},
			});
		if (cause === "abort") controller.abort();
		await expect(context.failure).rejects.toThrow();
		expect(context.check).toThrow();
		context.dispose();
		expect(f.listeners.size).toBe(0);
	}
});

test("missing root context and uncertain CDP enable time out and release listeners", async () => {
	for (const stuck of ["context", "enable", "tree"]) {
		const never = new Promise<Record<string, unknown>>(() => {});
		const f = fakeBrowser(async (method) => {
			if (method === "Page.getFrameTree")
				return stuck === "tree"
					? never
					: { frameTree: { frame: { id: "root" } } };
			return stuck === "enable" ? never : {};
		});
		await expect(
			enableParticleRootContext({
				browser: f.browser,
				session: "session",
				signal: new AbortController().signal,
				timeoutMs: 15,
			}),
		).rejects.toThrow("timed out");
		expect(f.listeners.size).toBe(0);
	}
});

test("discovery cleanup also covers malformed root, rejected enable and already aborted capture", async () => {
	for (const mode of ["root", "enable", "abort"]) {
		const controller = new AbortController();
		if (mode === "abort") controller.abort();
		const f = fakeBrowser(async (method) => {
			if (method === "Page.getFrameTree")
				return mode === "root" ? {} : { frameTree: { frame: { id: "root" } } };
			throw Error("enable failed");
		});
		await expect(
			enableParticleRootContext({
				browser: f.browser,
				session: "session",
				signal: controller.signal,
				timeoutMs: 100,
			}),
		).rejects.toThrow();
		expect(f.listeners.size).toBe(0);
		if (mode === "abort") expect(f.calls).toHaveLength(0);
	}
});
