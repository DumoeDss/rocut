import { expect, test } from "bun:test";
import vm from "node:vm";
import { attachLiquidObjectBroker } from "../programmatic/liquid-object-broker";
import { parseLiquidBrokerRequest } from "../programmatic/liquid-object-broker-codec";
import { THREE_LIQUID_OBJECT_BROWSER_MODULE } from "../programmatic/liquid-object-browser-module";
import { control, deferred, envelope, fixture, frame, payloadJson, policy, replyText, responseJson } from "./liquid-object-broker-fixture";

test("fake CDP explicit root context only: normal controls/raw canonical wire and correct replies", async () => {
	const f = await fixture();
	try {
		f.emit("{", 18); f.emit("{", 17, "other"); f.emit("{", 17, "root-session", "other");
		await f.settled(); expect(f.admissions).toHaveLength(0); expect(f.evaluated).toHaveLength(0);
		expect(f.calls[0]).toEqual({ method: "Runtime.addBinding", params: { name: "__rocutLiquidObjectRequest", executionContextId: 17 }, session: "root-session" });
		f.emit(control("open")); await f.settled(); f.emit(envelope()); await f.settled();
		f.emit(control("close")); await f.settled(); f.broker.check();
		expect(f.evaluated).toEqual([envelope()]);
		expect(f.admissions.map((value) => value.operation)).toEqual(["open", "reserve", "settle", "close"]);
		const replies = f.replies(); expect(replies).toHaveLength(3);
		for (const reply of replies) {
			expect(reply.session).toBe("root-session"); expect(reply.params.executionContextId).toBe(17);
			expect(reply.params.functionDeclaration).toBe("function(payload) { return globalThis.__rocutLiquidObjectReply(payload); }");
		}
		const text = (reply: typeof replies[number]) => replyText(reply.params.arguments);
		expect(JSON.parse(text(replies[0]!))).toEqual({ operation: "open", frame, ok: true });
		expect(JSON.parse(text(replies[1]!))).toEqual({ version: 1, identity: { frame, requestId: 1 }, payloadJson: responseJson });
		expect(JSON.parse(text(replies[2]!))).toEqual({ operation: "close", frame, ok: true });
		await f.broker.dispose(); expect(f.listeners.size).toBe(0); expect(f.terminations()).toBe(1);
		expect(f.calls.filter((call) => call.method === "Runtime.removeBinding")).toHaveLength(1);
	} finally { await f.finish(); }
});

test("canonical codec rejects changed frame, replay/gaps, unknown operations and oversized text preparse", () => {
	for (const json of ["{", "null", control("reserve"), " " + envelope(), envelope(0), envelope(2),
		JSON.stringify({ operation: "open", frame: { ...frame, seed: 99 } }),
		JSON.stringify({ version: 1, identity: { frame: { ...frame, index: 99 }, requestId: 1 }, payloadJson }),
		"界".repeat(policy.maxRequestEnvelopeBytes),
	]) expect(() => parseLiquidBrokerRequest({ json, frame, policy, nextRequestId: 1 })).toThrow();
	// Invalid JSON is intentionally over budget: UTF-8 guard must win over parsing.
	expect(() => parseLiquidBrokerRequest({ json: "界".repeat(policy.maxRequestEnvelopeBytes), frame, policy, nextRequestId: 1 })).toThrow("UTF-8");
});

test("authorized unknown operation/frame changes fail before native admission; evaluate replay is terminal", async () => {
	for (const wire of [control("terminate"), JSON.stringify({ operation: "open", frame: { ...frame, sessionId: "foreign" } }), envelope(2)]) {
		const f = await fixture(); try {
			f.emit(wire); await expect(f.broker.failure).rejects.toThrow();
			expect(f.admissions.filter((value) => value.operation !== "fail")).toHaveLength(0);
			expect(f.evaluated).toHaveLength(0); expect(f.replies()).toHaveLength(0);
			await expect(f.broker.dispose()).rejects.toThrow();
		} finally { await f.finish(); }
	}
	const f = await fixture(); try {
		f.emit(control("open")); await f.settled(); f.emit(envelope()); await f.settled();
		f.emit(envelope()); await expect(f.broker.failure).rejects.toThrow("Replayed");
		expect(f.evaluated).toHaveLength(1); await expect(f.broker.dispose()).rejects.toThrow();
	} finally { await f.finish(); }
});

test("concurrent page requests fail whole capture, cancel pending fake worker, and suppress late reply", async () => {
	const gate = deferred<string>(); const f = await fixture({ evaluate: () => gate.promise });
	try {
		f.emit(control("open")); await f.settled(); f.emit(envelope()); await f.settled();
		f.emit(envelope(2)); await expect(f.broker.failure).rejects.toThrow("concurrent");
		gate.resolve(JSON.stringify({ version: 1, identity: { frame, requestId: 1 }, payloadJson: responseJson }));
		await f.settled(); expect(f.evaluated).toHaveLength(1); expect(f.replies()).toHaveLength(1);
		await expect(f.broker.dispose()).rejects.toThrow(); expect(f.listeners.size).toBe(0);
	} finally { await f.finish(); }
});

test("fake termination rejection/unfinished termination and binding removal failure preserve cleanup failure", async () => {
	for (const options of [
		{ terminate: async () => { throw Error("termination uncertain"); } },
		{ terminate: () => new Promise<void>(() => {}), limits: { terminationTimeoutMs: 5 } },
		{ send: async (method: string) => { if (method === "Runtime.removeBinding") throw Error("binding uncertain"); return {}; } },
	]) {
		const f = await fixture(options); try {
			const first = f.broker.dispose(); expect(first).toBe(f.broker.dispose());
			await expect(first).rejects.toThrow("cleanup failed"); expect(f.listeners.size).toBe(0);
			expect(f.terminations()).toBe(1);
			await expect(attachLiquidObjectBroker({ browser: f.browser, session: "root-session", executionContextId: 17,
				transport: f.transport, signal: f.controller.signal })).rejects.toThrow("already has an owner");
		} finally { await f.finish(); }
	}
});

test("hanging fake CDP binding initialization has bounded cleanup and retains uncertainty", async () => {
	await expect(fixture({ send: (method) => method === "Runtime.addBinding" ? new Promise(() => {}) : Promise.resolve({}),
		limits: { initTimeoutMs: 5, cleanupTimeoutMs: 5 } })).rejects.toThrow("initialization and cleanup failed");
});

test("explicit context required and context destruction/abort prevent further native work", async () => {
	const f = await fixture(); try {
		await expect(attachLiquidObjectBroker({ browser: f.browser, session: "other", executionContextId: 0, transport: f.transport, signal: f.controller.signal })).rejects.toThrow("explicit");
		for (const listener of f.listeners) listener({ sessionId: "root-session", method: "Runtime.executionContextDestroyed", params: { executionContextId: 17 } });
		await expect(f.broker.failure).rejects.toThrow("destroyed"); f.emit(control("open"));
		expect(f.evaluated).toHaveLength(0); await expect(f.broker.dispose()).rejects.toThrow();
	} finally { await f.finish(); }
	const aborted = await fixture(); try {
		aborted.controller.abort(Error("fixture cancellation"));
		await expect(aborted.broker.failure).rejects.toThrow("fixture cancellation");
		aborted.emit(control("open")); expect(aborted.evaluated).toHaveLength(0);
		await expect(aborted.broker.dispose()).rejects.toThrow();
	} finally { await aborted.finish(); }
});

test("actual browser strings/VM progress before delayed CDP delivery acknowledgement (fake CDP/admission only)", async () => {
	type Message = { source: unknown; data: { tag: string; reply: string }; stopImmediatePropagation(): void };
	const listeners: ((event: Message) => void)[] = [];
	const delivery = deferred<Record<string, unknown>>();
	const f = await fixture({ send: (method) => method === "Runtime.callFunctionOn" ? delivery.promise : Promise.resolve({}), onReply(reply) {
		for (const listener of listeners) listener({ source: parent, data: { tag: "rocut-liquid-object-reply", reply }, stopImmediatePropagation() {} });
	} });
	const parent = { postMessage(message: { tag: string; payload: string }) { expect(message.tag).toBe("rocut-liquid-object-request"); f.emit(message.payload); } };
	class CaptureEvent { stopImmediatePropagation() {} }
	const realm = vm.createContext({ window: { __rocutLiquidObjectConfig: { version: 1, frame, policy } },
		parent, Event: CaptureEvent, TextEncoder, setTimeout, clearTimeout,
		addEventListener(...args: [name: string, listener: (event: Message) => void]) { listeners.push(args[1]); },
	});
	vm.runInContext(THREE_LIQUID_OBJECT_BROWSER_MODULE.replace("export function claimLiquidObjectRuntime", "function claimLiquidObjectRuntime") + "\nthis.runtime=claimLiquidObjectRuntime();", realm);
	const runtime = realm.runtime;
	try {
		let received: string | undefined;
		await runtime.runPhase(async (service: { evaluate(value: unknown): Promise<string> }) => {
			received = await service.evaluate(JSON.parse(payloadJson));
			received = await service.evaluate(JSON.parse(payloadJson));
		});
		expect(received).toBe(responseJson); runtime.check(); f.broker.check();
		expect(f.evaluated).toEqual([envelope(), envelope(2)]); expect(f.replies()).toHaveLength(4);
	} finally { delivery.resolve({}); await runtime.cleanup(); await f.finish(); }
});
