import { expect, test } from "bun:test";
import {
	createHyperframesFxTarget,
	HYPERFRAMES_FX_TARGET_POLICY,
} from "../programmatic/hyperframes-fx-target";
import { HYPERFRAMES_FX_WORKLET_BINDING } from "../programmatic/hyperframes-fx-worklet-gate";

test("private FX target fulfils only its fixed document and refuses external/author worklet requests", async () => {
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const listeners = new Set<(event: any) => void>();
	const emit = (method: string, params = {}) => {
		for (const listener of listeners)
			listener({ method, params, sessionId: "private-session" });
	};
	const browser = {
		onEvent(listener: (event: any) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async send(method: string, params: Record<string, unknown> = {}) {
			calls.push({ method, params });
			if (method === "Target.createTarget")
				return { targetId: "private-target" };
			if (method === "Target.attachToTarget")
				return { sessionId: "private-session" };
			if (method === "Page.navigate")
				emit("Fetch.requestPaused", {
					requestId: "document",
					resourceType: "Document",
					request: { url: params.url },
				});
			if (method === "Fetch.fulfillRequest") emit("Page.loadEventFired");
			return {};
		},
	} as unknown as Parameters<typeof createHyperframesFxTarget>[0];
	const target = await createHyperframesFxTarget(
		browser,
		new AbortController().signal,
		(error) => {
			throw error;
		},
	);
	expect(
		calls.filter((call) => call.method === "Fetch.fulfillRequest"),
	).toHaveLength(1);
	for (const url of [
		"https://example.com/evil.js",
		"http://127.0.0.1:9361/",
		"file:///C:/private.txt",
		"ws://example.com/",
		"blob:https://rocut-native-fx.invalid/author-code",
		"data:text/javascript;base64,YXV0aG9yLWNvZGU=",
		HYPERFRAMES_FX_TARGET_POLICY.origin,
		HYPERFRAMES_FX_TARGET_POLICY.moduleUrl,
	])
		emit("Fetch.requestPaused", { requestId: url, request: { url } });
	expect(
		calls.filter((call) => call.method === "Fetch.failRequest"),
	).toHaveLength(8);
	expect(
		calls.filter((call) => call.method === "Fetch.continueRequest"),
	).toHaveLength(0);
	expect(
		calls.filter((call) => call.method === "Fetch.fulfillRequest"),
	).toHaveLength(1);
	expect(HYPERFRAMES_FX_TARGET_POLICY.document).not.toContain("data:");
	expect(HYPERFRAMES_FX_TARGET_POLICY.document).not.toContain("blob:");
	expect(calls.some((call) => call.method === "Runtime.addBinding")).toBe(true);
	expect(
		calls.some(
			(call) =>
				call.method === "Runtime.evaluate" &&
				call.params.expression === HYPERFRAMES_FX_TARGET_POLICY.workletGate,
		),
	).toBe(true);
	await target.close();
	expect(listeners.size).toBe(0);
	expect(calls.at(-1)).toEqual({
		method: "Target.closeTarget",
		params: { targetId: "private-target" },
	});
});

test("unknown binding bytes never authorize the fixed module and malformed admission fails closed", async () => {
	const calls: { method: string; params: Record<string, unknown> }[] = [];
	const errors: Error[] = [];
	let listener: ((event: any) => void) | undefined;
	const emit = (
		method: string,
		params: Record<string, unknown>,
		sessionId = "session",
	) => listener?.({ method, params, sessionId });
	const browser = {
		onEvent(next: (event: any) => void) {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
		async send(method: string, params: Record<string, unknown> = {}) {
			calls.push({ method, params });
			if (method === "Target.createTarget") return { targetId: "target" };
			if (method === "Target.attachToTarget") return { sessionId: "session" };
			if (method === "Page.navigate")
				emit("Fetch.requestPaused", {
					requestId: "document",
					resourceType: "Document",
					request: { url: params.url },
				});
			if (method === "Fetch.fulfillRequest") emit("Page.loadEventFired", {});
			return {};
		},
	} as unknown as Parameters<typeof createHyperframesFxTarget>[0];
	const target = await createHyperframesFxTarget(
		browser,
		new AbortController().signal,
		(error) => {
			errors.push(error);
		},
	);
	const request = {
		name: HYPERFRAMES_FX_WORKLET_BINDING,
		executionContextId: 3,
		payload: JSON.stringify({
			version: 1,
			id: 1,
			url: "data:text/javascript;base64,YXV0aG9yLWNvZGU=",
		}),
	};
	emit("Runtime.bindingCalled", request, "foreign-session");
	expect(
		calls.filter(
			(call) =>
				call.method === "Runtime.evaluate" && call.params.contextId === 3,
		),
	).toHaveLength(0);
	emit("Runtime.bindingCalled", request);
	await target.evaluate("0");
	expect(
		calls.find((call) => call.params.contextId === 3)?.params.expression,
	).toContain('"ok":false');
	emit("Fetch.requestPaused", {
		requestId: "module",
		request: { url: HYPERFRAMES_FX_TARGET_POLICY.moduleUrl },
	});
	await target.evaluate("0");
	expect(
		calls.some(
			(call) =>
				call.method === "Fetch.failRequest" &&
				call.params.requestId === "module",
		),
	).toBe(true);
	expect(
		calls.filter((call) => call.method === "Fetch.fulfillRequest"),
	).toHaveLength(1);
	emit("Runtime.bindingCalled", {
		...request,
		payload: JSON.stringify({
			version: 1,
			id: 2,
			url: "anything",
			extra: "unauthorized",
		}),
	});
	await expect(target.evaluate("0")).rejects.toThrow(
		"Invalid native audio worklet admission request",
	);
	expect(errors).toHaveLength(1);
	await target.close();
});
