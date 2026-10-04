import { afterEach, expect, test } from "bun:test";
import { bindEmbeddedHostLifecycle } from "./embedded-host-lifecycle";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
	else Reflect.deleteProperty(globalThis, "window");
});

function harness(prepare: () => Promise<void>) {
	let listener: ((event: object) => void) | undefined;
	const sent: Array<{ message: { type?: string; version?: number; requestId?: string; ok?: boolean }; origin: string }> = [];
	const parent = { postMessage: (...args: [object, string]) => sent.push({ message: args[0], origin: args[1] }) };
	Object.defineProperty(globalThis, "window", { configurable: true, value: {
		parent,
		addEventListener: (_name: string, fn: (event: object) => void) => { listener = fn; },
		removeEventListener: () => { listener = undefined; },
	} });
	const dispose = bindEmbeddedHostLifecycle(prepare);
	return {
		sent, dispose,
		receive: ({ source = parent, origin = "null", data }: { source?: object; origin?: string; data: object }) => listener?.({ source, origin, data: { version: 1, ...data } }),
	};
}

test("only the parent can flush, replies await durability, duplicate requests do not write twice", async () => {
	let release: (() => void) | undefined;
	let calls = 0;
	const h = harness(() => { calls++; return new Promise<void>((resolve) => { release = resolve; }); });
	const data = { type: "elftia:tool-host-prepare-close", requestId: "one" };
	h.receive({ data, source: {} });
	expect(calls).toBe(0);
	h.receive({ data }); h.receive({ data });
	expect(calls).toBe(1);
	expect(h.sent).toHaveLength(1);
	release!(); await Promise.resolve(); await Promise.resolve();
	expect(h.sent[1]).toEqual({ message: { type: "elftia:tool-host-close-ready", version: 1, requestId: "one", ok: true }, origin: "*" });
	h.dispose();
});

test("save failures return a negative acknowledgement to the exact non-opaque parent origin", async () => {
	const h = harness(async () => { throw new Error("failure with private details"); });
	h.receive({ origin: "https://host.invalid", data: { type: "elftia:tool-host-prepare-close", requestId: "two" } });
	await Promise.resolve(); await Promise.resolve();
	expect(h.sent[1]).toEqual({ message: { type: "elftia:tool-host-close-ready", version: 1, requestId: "two", ok: false }, origin: "https://host.invalid" });
	h.dispose();
});

test("retiring an editor suppresses a late successful reply", async () => {
	let release: (() => void) | undefined;
	const h = harness(() => new Promise<void>((resolve) => { release = resolve; }));
	h.receive({ data: { type: "elftia:tool-host-prepare-close", requestId: "three" } });
	h.dispose(); release!(); await Promise.resolve(); await Promise.resolve();
	expect(h.sent).toHaveLength(1);
});
