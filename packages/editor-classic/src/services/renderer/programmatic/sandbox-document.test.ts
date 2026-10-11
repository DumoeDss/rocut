import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { PROGRAMMATIC_SANDBOX_DOCUMENT } from "./sandbox-document";
import { SandboxBitmap } from "./sandbox-runtime-test-fixture";

function broker({ startupFailure = false } = {}) {
	const listeners = new Map<string, (event: object) => void>();
	const blobs: Blob[] = [];
	const messages: unknown[] = [];
	const workers: BrokerWorker[] = [];
	const revoked: string[] = [];
	const parent = {};
	const port = {
		onmessage: (_event: { data: unknown }) => {},
		postMessage(data: unknown) {
			messages.push(data);
		},
		close() {},
	};
	class BrokerWorker {
		onmessage = (_event: { data: unknown }) => {};
		onerror = () => {};
		terminated = 0;
		constructor() {
			if (startupFailure) throw Error("Worker unavailable");
			workers.push(this);
		}
		postMessage() {}
		terminate() {
			this.terminated++;
		}
	}
	const script = PROGRAMMATIC_SANDBOX_DOCUMENT.match(
		/<script>([\s\S]*)<\/script>/,
	)?.[1];
	if (!script) throw Error("Missing sandbox script");
	runInNewContext(
		script,
		{
			parent,
			Blob,
			Worker: BrokerWorker,
			ImageBitmap: SandboxBitmap,
			URL: {
				createObjectURL(blob: Blob) {
					blobs.push(blob);
					return "blob:fixture";
				},
				revokeObjectURL(url: string) {
					revoked.push(url);
				},
			},
			addEventListener(name: string, listener: (event: object) => void) {
				listeners.set(name, listener);
			},
			removeEventListener(name: string) {
				listeners.delete(name);
			},
		},
		{ timeout: 1000 },
	);
	listeners.get("message")?.({
		source: parent,
		data: "rocut-frame-v1",
		ports: [port],
	});
	port.onmessage({ data: { source: {}, frame: {} } });
	return { messages, workers, blobs, revoked };
}

test("Worker start is relayed without terminating the worker or releasing its Blob", () => {
	const transport = broker();
	expect(transport.messages).toEqual(["ready"]);
	transport.workers[0].onmessage({ data: { sandboxStage: "worker-started" } });
	expect(transport.messages).toEqual([
		"ready",
		{ sandboxStage: "worker-started" },
	]);
	expect(transport.workers[0].terminated).toBe(0);
	expect(transport.revoked).toEqual([]);
	const bitmap = new SandboxBitmap();
	transport.workers[0].onmessage({ data: { bitmap } });
	expect(transport.messages[2]).toEqual({ bitmap });
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toEqual(["blob:fixture"]);
});

test("a Worker constructor failure returns an error immediately and releases its Blob", () => {
	const transport = broker({ startupFailure: true });
	expect(transport.messages).toEqual([
		"ready",
		{ error: "Programmatic Worker startup failed" },
	]);
	expect(transport.revoked).toEqual(["blob:fixture"]);
});

test("a malformed Worker response is a terminal error, not an unhandled broker exception", () => {
	const transport = broker();
	transport.workers[0].onmessage({ data: null });
	expect(transport.messages).toEqual([
		"ready",
		{ error: "Invalid worker result" },
	]);
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toEqual(["blob:fixture"]);
});

test("the actual generated Worker emits start before its resource/render pipeline", async () => {
	const transport = broker();
	const messages: unknown[] = [];
	const workerSource = await transport.blobs[0].text();
	const context = {
		self: {},
		postMessage(data: unknown) {
			messages.push(data);
		},
	};
	runInNewContext(
		workerSource +
			"\nonmessage({data:{source:{resources:[]},frame:{},resources:[]}})",
		context,
		{ timeout: 1000 },
	);
	for (let i = 0; i < 12; i++) await Promise.resolve();
	expect(messages[0]).toEqual({ sandboxStage: "worker-started" });
	// Missing decode limits deliberately terminates after the genuine start event.
	expect(messages[1]).toMatchObject({ error: expect.any(String) });
});
