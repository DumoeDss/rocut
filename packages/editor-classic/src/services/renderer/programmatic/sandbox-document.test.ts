import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	AUTHORED_CANVAS_SANDBOX_DOCUMENT,
	PROGRAMMATIC_SANDBOX_DOCUMENT,
} from "./sandbox-document";
import { SandboxBitmap } from "./sandbox-runtime-test-fixture";

function broker({
	startupFailure = false,
	terminateFailure = false,
	revokeFailure = false,
	authored = false,
} = {}) {
	const listeners = new Map<string, (event: object) => void>();
	const blobs: Blob[] = [];
	const messages: unknown[] = [];
	const workers: BrokerWorker[] = [];
	const revoked: string[] = [];
	const parent = {};
	let replyFailure = false;
	let closed = 0;
	let retiredBeforeBitmap = false;
	const port = {
		onmessage: (_event: { data: unknown }) => {},
		onmessageerror: () => {},
		postMessage(data: unknown) {
			if (data && typeof data === "object" && "bitmap" in data)
				retiredBeforeBitmap =
					workers.every((worker) => worker.terminated === 1) &&
					revoked.length === workers.length;
			if (replyFailure) {
				replyFailure = false;
				throw Error("Reply transfer failed");
			}
			messages.push(data);
		},
		close() {
			closed++;
		},
	};
	class BrokerWorker {
		onmessage = (_event: { data: unknown }) => {};
		onerror = () => {};
		onmessageerror = () => {};
		terminated = 0;
		constructor() {
			if (startupFailure) throw Error("Worker unavailable");
			workers.push(this);
		}
		postMessage() {}
		terminate() {
			this.terminated++;
			if (terminateFailure) throw Error("Worker termination failed");
		}
	}
	const document = authored
		? AUTHORED_CANVAS_SANDBOX_DOCUMENT
		: PROGRAMMATIC_SANDBOX_DOCUMENT;
	const script = document.match(/<script>([\s\S]*)<\/script>/)?.[1];
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
					if (revokeFailure) throw Error("Blob revocation failed");
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
	return {
		messages,
		workers,
		blobs,
		revoked,
		port,
		get closed() {
			return closed;
		},
		get retiredBeforeBitmap() {
			return retiredBeforeBitmap;
		},
		failReply() {
			replyFailure = true;
		},
		reconnect() {
			const nextPort = { ...port };
			listeners.get("message")?.({
				source: parent,
				data: "rocut-frame-v1",
				ports: [nextPort],
			});
			nextPort.onmessage({ data: { source: {}, frame: {} } });
			return nextPort;
		},
	};
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
	expect(transport.messages[2]).toEqual({ bitmap, brokerRetired: true });
	expect(transport.retiredBeforeBitmap).toBe(true);
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toEqual(["blob:fixture"]);
});

test("timed Worker stages relay scalar diagnostics without becoming a terminal result", () => {
	const transport = broker();
	for (const sandboxStage of [
		"worker-font-resources",
		"worker-image-decode",
		"worker-render",
		"worker-bitmap-transfer",
	]) {
		transport.workers[0].onmessage({
			data: { sandboxStage, workerElapsedMs: 17.125 },
		});
		expect(transport.messages.at(-1)).toEqual({
			sandboxStage,
			workerElapsedMs: 17.125,
		});
		expect(transport.workers[0].terminated).toBe(0);
	}
	const before = transport.messages.length;
	for (const workerElapsedMs of [NaN, Infinity, -1, "17"])
		transport.workers[0].onmessage({
			data: { sandboxStage: "worker-render", workerElapsedMs },
		});
	expect(transport.messages).toHaveLength(before);
	const bitmap = new SandboxBitmap();
	transport.workers[0].onmessage({ data: { bitmap } });
	transport.workers[0].onmessage({
		data: { sandboxStage: "worker-render", workerElapsedMs: 18 },
	});
	expect(transport.messages).toHaveLength(before + 1);
	expect(bitmap.closed).toBe(false);
	expect(transport.workers[0].terminated).toBe(1);
});

test("progress relay transport failure releases the worker and reports an ordinary error", () => {
	const transport = broker();
	transport.failReply();
	transport.workers[0].onmessage({
		data: { sandboxStage: "worker-image-decode", workerElapsedMs: 4 },
	});
	expect(transport.messages.at(-1)).toEqual({
		error: "Programmatic Worker progress dispatch failed",
	});
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toHaveLength(1);
});

test("a malformed progress message cannot strand its bitmap ownership", () => {
	const transport = broker();
	const bitmap = new SandboxBitmap();
	transport.workers[0].onmessage({
		data: { sandboxStage: "worker-render", bitmap },
	});
	expect(bitmap.closed).toBe(true);
	expect(transport.messages.at(-1)).toEqual({
		error: "Invalid worker progress",
	});
	expect(transport.workers[0].terminated).toBe(1);
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
		performance,
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
	expect(messages[1]).toMatchObject({
		sandboxStage: "worker-font-resources",
		workerElapsedMs: expect.any(Number),
	});
	expect(messages.at(-1)).toMatchObject({ error: expect.any(String) });
});

test("broker Worker and request-port message errors fail immediately and dispose once", () => {
	for (const target of ["worker", "port"]) {
		const transport = broker();
		if (target === "worker") transport.workers[0].onmessageerror();
		else transport.port.onmessageerror();
		expect(transport.messages[1]).toEqual({
			error:
				target === "worker"
					? "Programmatic Worker response deserialization failed"
					: "Programmatic request deserialization failed",
		});
		expect(transport.workers[0].terminated).toBe(1);
		expect(transport.revoked).toEqual(["blob:fixture"]);
		transport.workers[0].onerror();
		expect(transport.messages).toHaveLength(2);
	}
});

test("broker cleanup failures do not skip remaining releases or replace failure", () => {
	const transport = broker({ terminateFailure: true, revokeFailure: true });
	expect(() => transport.workers[0].onmessageerror()).not.toThrow();
	expect(transport.messages[1]).toEqual({
		error: "Programmatic Worker response deserialization failed",
	});
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toEqual(["blob:fixture"]);
	transport.port.onmessage({ data: "dispose" });
	expect(transport.closed).toBe(1);
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toHaveLength(1);
});

test("a failed bitmap relay reports ordinary failure and closes its untransferred bitmap", () => {
	const transport = broker();
	transport.failReply();
	const bitmap = new SandboxBitmap();
	expect(() =>
		transport.workers[0].onmessage({ data: { bitmap } }),
	).not.toThrow();
	expect(transport.messages[1]).toEqual({
		error: "Programmatic Worker result dispatch failed",
	});
	expect(bitmap.closed).toBe(true);
	expect(transport.workers[0].terminated).toBe(1);
	expect(transport.revoked).toHaveLength(1);
});

test("generated Worker request messageerror publishes a failure without starting render", async () => {
	const transport = broker();
	const messages: unknown[] = [];
	runInNewContext(
		(await transport.blobs[0].text()) + "\nonmessageerror()",
		{
			self: {},
			postMessage(data: unknown) {
				messages.push(data);
			},
		},
		{ timeout: 1000 },
	);
	expect(messages).toEqual([
		{ error: "Programmatic Worker request deserialization failed" },
	]);
});

for (const authored of [false, true])
	for (const transferFails of [false, true])
		test(`generated ${authored ? "authored" : "recipe"} Worker bitmap transfer ${transferFails ? "failure closes ownership" : "success preserves caller ownership"}`, async () => {
			const transport = broker({ authored });
			const messages: unknown[] = [];
			const bitmap = new SandboxBitmap();
			const onmessage = runInNewContext(
				(await transport.blobs[0].text()) + "\n;onmessage",
				{
					self: {},
					performance,
					OffscreenCanvas: class {
						width: number;
						height: number;
						constructor(...[width, height]: [number, number]) {
							this.width = width;
							this.height = height;
						}
						transferToImageBitmap() {
							return bitmap;
						}
					},
					postMessage(data: { bitmap?: unknown }) {
						if (transferFails && data.bitmap)
							throw Error("Worker bitmap transfer failed");
						messages.push(data);
					},
				},
			);
			await onmessage({
				data: {
					source: { width: 64, height: 48, resources: [], code: "" },
					frame: {
						seed: 1,
						imageDecodeLimits: {
							maxDimension: 8192,
							maxDecodedBytes: 128 * 1024 * 1024,
						},
					},
					resources: [],
				},
			});
			expect(messages[0]).toEqual({ sandboxStage: "worker-started" });
			expect(
				messages.flatMap((message) =>
					message && typeof message === "object" && "sandboxStage" in message
						? [message.sandboxStage]
						: [],
				),
			).toEqual([
				"worker-started",
				"worker-font-resources",
				"worker-image-decode",
				"worker-sequence-decode",
				"worker-render",
				"worker-bitmap-transfer",
			]);
			expect(messages.at(-1)).toEqual(
				transferFails
					? { error: "Error: Worker bitmap transfer failed" }
					: { bitmap },
			);
			expect(bitmap.closed).toBe(transferFails);
		});

test("authored broker omits recipe parsing while retaining isolated Worker and post/resource helpers", async () => {
	const full = await broker().blobs[0].text();
	const authored = broker({ authored: true });
	const lean = await authored.blobs[0].text();
	expect(lean.length).toBeLessThan(full.length / 2);
	expect(lean).not.toContain("function* renderMvRecipeSteps");
	expect(lean).toContain("createRoadPostBackend");
	expect(lean).toContain("loadProgrammaticFont");
	expect(AUTHORED_CANVAS_SANDBOX_DOCUMENT).toContain("connect-src 'none'");
	const bitmap = new SandboxBitmap();
	authored.workers[0].onmessage({ data: { bitmap } });
	expect(authored.workers[0].terminated).toBe(1);
	expect(bitmap.closed).toBe(false);
	expect(authored.revoked).toHaveLength(1);
});

test("reconnecting the broker starts a distinct Worker and closes stale output without publishing it", () => {
	const transport = broker({ authored: true });
	transport.workers[0].onmessage({ data: { bitmap: new SandboxBitmap() } });
	expect(transport.workers[0].terminated).toBe(1);
	transport.port.onmessage({ data: "dispose" });
	transport.reconnect();
	expect(transport.workers).toHaveLength(2);
	expect(transport.workers[1].terminated).toBe(0);
	const stale = new SandboxBitmap();
	const count = transport.messages.length;
	transport.workers[0].onmessage({ data: { bitmap: stale } });
	expect(stale.closed).toBe(true);
	expect(transport.messages).toHaveLength(count);
	const current = new SandboxBitmap();
	transport.workers[1].onmessage({ data: { bitmap: current } });
	expect(transport.messages.at(-1)).toEqual({
		bitmap: current,
		brokerRetired: true,
	});
	expect(transport.workers[1].terminated).toBe(1);
});

test("failed Worker retirement cannot claim a healthy reusable broker", () => {
	const transport = broker({ terminateFailure: true });
	const bitmap = new SandboxBitmap();
	transport.workers[0].onmessage({ data: { bitmap } });
	expect(transport.messages.at(-1)).toEqual({ bitmap, brokerRetired: false });
});

test("generated Worker stages identify deferred font preparation and user eval before bitmap failure", async () => {
	const transport = broker();
	const messages: unknown[] = [];
	let finishFont!: () => void;
	let finishRender!: () => void;
	const fontGate = new Promise<void>((resolve) => {
		finishFont = resolve;
	});
	const renderGate = new Promise<void>((resolve) => {
		finishRender = resolve;
	});
	let now = 100;
	const context = {
		self: {},
		fontGate,
		renderGate,
		performance: { now: () => now++ },
		postMessage(message: unknown) {
			messages.push(message);
		},
		OffscreenCanvas: class {
			width: number;
			height: number;
			constructor(...[width, height]: [number, number]) {
				this.width = width;
				this.height = height;
			}
			transferToImageBitmap() {
				throw Error("deterministic bitmap failure");
			}
		},
	};
	const onmessage = runInNewContext(
		(await transport.blobs[0].text()) +
			"\nloadProgrammaticFont = () => fontGate; onmessage",
		context,
	);
	const font = { id: "font", kind: "font" };
	const pending = onmessage({
		data: {
			source: {
				width: 64,
				height: 48,
				resources: [font],
				code: "await globalThis.renderGate",
			},
			frame: {
				seed: 1,
				imageDecodeLimits: {
					maxDimension: 8192,
					maxDecodedBytes: 128 * 1024 * 1024,
				},
			},
			resources: [{ resource: font, body: new ArrayBuffer(1) }],
		},
	});
	expect(messages.at(-1)).toEqual({
		sandboxStage: "worker-font-resources",
		workerElapsedMs: 1,
	});
	finishFont();
	for (let i = 0; i < 12; i++) await Promise.resolve();
	expect(messages.at(-1)).toEqual({
		sandboxStage: "worker-render",
		workerElapsedMs: 4,
	});
	finishRender();
	await pending;
	expect(messages.at(-2)).toEqual({
		sandboxStage: "worker-bitmap-transfer",
		workerElapsedMs: 5,
	});
	expect(messages.at(-1)).toEqual({
		error: "Error: deterministic bitmap failure",
	});
	// The pipeline is genuine generated Worker JS; font completion and Canvas are
	// controlled lifecycle doubles, not real Host scheduling or raster acceptance.
});
