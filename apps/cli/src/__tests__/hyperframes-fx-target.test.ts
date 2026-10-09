import { expect, test } from "bun:test";
import {
	createHyperframesFxTarget,
	HYPERFRAMES_FX_TARGET_POLICY,
} from "../programmatic/hyperframes-fx-target";

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
	])
		emit("Fetch.requestPaused", { requestId: url, request: { url } });
	expect(
		calls.filter((call) => call.method === "Fetch.failRequest"),
	).toHaveLength(7);
	expect(
		calls.filter((call) => call.method === "Fetch.continueRequest"),
	).toHaveLength(0);
	expect(
		calls.filter((call) => call.method === "Fetch.fulfillRequest"),
	).toHaveLength(1);
	await target.close();
	expect(listeners.size).toBe(0);
	expect(calls.at(-1)).toEqual({
		method: "Target.closeTarget",
		params: { targetId: "private-target" },
	});
});
