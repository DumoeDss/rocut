import { afterEach, expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "./frame";
import { runProgrammaticSandbox } from "./sandbox-runtime";
import { ProgrammaticSandboxRealm } from "./sandbox-realm";
import {
	installSandboxHarness,
	SandboxBitmap,
} from "./sandbox-runtime-test-fixture";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "private-author-text-never-in-diagnostics",
	width: 64,
	height: 48,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 900,
	seed: 1978,
};
const frame: ProgrammaticFrame = {
	index: 161,
	time: 161 / 30,
	timelineTime: 644000,
	sourceTime: 644000,
	frameRate: source.frameRate,
	durationFrames: source.durationFrames,
	seed: source.seed,
};
let harness: ReturnType<typeof installSandboxHarness> | undefined;
afterEach(() => {
	harness?.restore();
	harness = undefined;
});

async function start(signal?: AbortSignal) {
	harness = installSandboxHarness();
	const result = runProgrammaticSandbox({
		source,
		frame,
		resources: [],
		operation: "render",
		signal,
	});
	for (let i = 0; i < 12; i++) await Promise.resolve();
	expect(harness.channels).toHaveLength(1);
	return { result, transport: harness };
}

test("a confirmed retired broker is reused with a fresh private port, then closed by its node lifecycle", async () => {
	harness = installSandboxHarness();
	const lifetime = new AbortController();
	const realm = new ProgrammaticSandboxRealm(lifetime.signal);
	for (let index = 0; index < 2; index++) {
		const result = runProgrammaticSandbox({
			source,
			frame,
			resources: [],
			operation: "render",
			realm,
		});
		for (let i = 0; i < 12; i++) await Promise.resolve();
		if (index === 0) harness.iframe.onload();
		const port = harness.channels[index].port1;
		port.onmessage?.({ data: "ready" });
		const bitmap = new SandboxBitmap();
		port.onmessage?.({ data: { bitmap, brokerRetired: true } });
		expect(await result).toBe(bitmap);
		expect(bitmap.closed).toBe(false);
		expect(port.closed).toBe(true);
		expect(harness.channels[index].port2.closed).toBe(true);
		expect(harness.removeCalls).toBe(0);
		expect(realm.isClosed).toBe(false);
	}
	expect(harness.connections).toBe(2);
	expect(harness.channels).toHaveLength(2);
	lifetime.abort();
	expect(harness.removeCalls).toBe(1);
	expect(realm.isClosed).toBe(true);
});

for (const outcome of ["unconfirmed", "failed-retirement", "abort", "timeout"])
	test(`${outcome} closes the broker instead of retaining it for the next frame`, async () => {
		harness = installSandboxHarness();
		const controller = new AbortController();
		const realm = new ProgrammaticSandboxRealm(new AbortController().signal);
		const pending = runProgrammaticSandbox({
			source,
			frame,
			resources: [],
			operation: "render",
			realm,
			signal: controller.signal,
		});
		const result = pending.catch((error: unknown) => error);
		for (let i = 0; i < 12; i++) await Promise.resolve();
		harness.iframe.onload();
		harness.send("ready");
		if (outcome === "abort") controller.abort(Error("owned cancel"));
		else if (outcome === "timeout") harness.deadlines[0].callback();
		else
			harness.send({
				bitmap: new SandboxBitmap(),
				...(outcome === "failed-retirement" ? { brokerRetired: false } : {}),
			});
		await result;
		expect(realm.isClosed).toBe(true);
		expect(harness.removeCalls).toBe(1);
		expect(harness.disposed).toBe(true);
	});

for (const workerStage of [
	"worker-font-resources",
	"worker-image-decode",
	"worker-render",
	"worker-bitmap-transfer",
]) {
	test(`slow ${workerStage} reports exact stage with one unchanged total deadline`, async () => {
		const { result, transport } = await start();
		const outcome = result.catch((error: unknown) => error);
		transport.iframe.onload();
		transport.send("ready");
		transport.setNow(4200.25);
		transport.send({ sandboxStage: workerStage, workerElapsedMs: 4000.125 });
		expect(transport.disposed).toBe(false);
		expect(transport.deadlines).toHaveLength(1);
		expect(transport.deadlines[0].milliseconds).toBe(5000);
		transport.setNow(5000);
		transport.deadlines[0].callback();
		const error = await outcome;
		expect(error).toMatchObject({
			context: {
				phase: "worker-result",
				workerStage,
				workerElapsedMs: 4000.125,
				elapsedMs: 5000,
			},
		});
		transport.send({ sandboxStage: "worker-render", workerElapsedMs: 5001 });
		expect(error).toMatchObject({
			context: { workerStage, workerElapsedMs: 4000.125 },
		});
		expect(transport.disposed).toBe(true);
	});
}

test("optional stage observer failures cannot change result ownership or cancellation", async () => {
	harness = installSandboxHarness();
	const observed: unknown[] = [];
	const result = runProgrammaticSandbox({
		source,
		frame,
		resources: [],
		operation: "render",
		onStage(event) {
			observed.push(event);
			throw Error("observer only");
		},
	});
	for (let i = 0; i < 12; i++) await Promise.resolve();
	harness.iframe.onload();
	harness.send("ready");
	harness.setNow(25);
	harness.send({ sandboxStage: "worker-render", workerElapsedMs: 10 });
	const bitmap = new SandboxBitmap();
	harness.send({ bitmap });
	expect(await result).toBe(bitmap);
	expect(bitmap.closed).toBe(false);
	expect(observed).toContainEqual({
		phase: "worker-result",
		workerStage: "worker-render",
		workerElapsedMs: 10,
		elapsedMs: 25,
	});
	expect(harness.disposed).toBe(true);
});

test("invalid or regressing stage clocks cannot corrupt failure context or reset the watchdog", async () => {
	const { result, transport } = await start();
	const outcome = result.catch((error: unknown) => error);
	transport.send({ sandboxStage: "worker-render", workerElapsedMs: 1 }); // Before dispatch.
	transport.iframe.onload();
	transport.send("ready");
	transport.setNow(10);
	transport.send({ sandboxStage: "worker-image-decode", workerElapsedMs: 5 });
	for (const workerElapsedMs of [NaN, Infinity, -1, "6", 4])
		transport.send({ sandboxStage: "worker-render", workerElapsedMs });
	transport.send({ sandboxStage: "unknown", workerElapsedMs: 6 });
	transport.send({ sandboxStage: "worker-started" }); // Legacy cannot rewind a timed stage.
	transport.setNow(NaN);
	transport.send({ error: "image decode rejected" });
	expect(await outcome).toMatchObject({
		context: {
			phase: "worker-result",
			workerStage: "worker-image-decode",
			workerElapsedMs: 5,
			elapsedMs: 10,
		},
	});
	expect(transport.deadlines).toHaveLength(1);
	expect(transport.disposed).toBe(true);
});

test("a throwing stage observer may abort without replacing the exact abort reason", async () => {
	harness = installSandboxHarness();
	const controller = new AbortController();
	const reason = { cancelled: "original" };
	const result = runProgrammaticSandbox({
		source,
		frame,
		resources: [],
		operation: "render",
		signal: controller.signal,
		onStage() {
			controller.abort(reason);
			throw Error("observer only");
		},
	});
	const outcome = result.catch((error: unknown) => error);
	for (let i = 0; i < 12; i++) await Promise.resolve();
	harness.iframe.onload();
	harness.send("ready");
	harness.send({ sandboxStage: "worker-render", workerElapsedMs: 1 });
	expect(await outcome).toBe(reason);
	expect(harness.disposed).toBe(true);
});

test("a late async observer rejection is absorbed after a successful caller-owned bitmap", async () => {
	harness = installSandboxHarness();
	let rejectObserver!: (error: Error) => void;
	const observation = new Promise<void>((_resolve, reject) => {
		rejectObserver = reject;
	});
	const result = runProgrammaticSandbox({
		source,
		frame,
		resources: [],
		operation: "render",
		onStage: () => observation,
	});
	for (let i = 0; i < 12; i++) await Promise.resolve();
	harness.iframe.onload();
	harness.send("ready");
	harness.send({ sandboxStage: "worker-render", workerElapsedMs: 1 });
	const bitmap = new SandboxBitmap();
	harness.send({ bitmap });
	expect(await result).toBe(bitmap);
	rejectObserver(Error("late observer rejection"));
	for (let i = 0; i < 12; i++) await Promise.resolve();
	expect(bitmap.closed).toBe(false);
	expect(harness.disposed).toBe(true);
});

test("a malformed progress bitmap closes exactly as an invalid terminal response", async () => {
	const { result, transport } = await start();
	const outcome = result.catch((error: unknown) => error);
	transport.iframe.onload();
	transport.send("ready");
	const bitmap = new SandboxBitmap();
	transport.send({ sandboxStage: "worker-render", bitmap });
	expect(await outcome).toMatchObject({
		message: expect.stringContaining("Invalid programmatic progress"),
	});
	expect(bitmap.closed).toBe(true);
	expect(transport.disposed).toBe(true);
});

for (const phase of [
	"iframe-load",
	"sandbox-ready",
	"worker-start",
	"worker-result",
])
	test(`unchanged 5000 ms watchdog identifies ${phase}`, async () => {
		const { result, transport } = await start();
		if (phase !== "iframe-load") transport.iframe.onload();
		if (phase === "worker-start" || phase === "worker-result")
			transport.send("ready");
		if (phase === "worker-result")
			transport.send({ sandboxStage: "worker-started" });
		expect(transport.deadlines).toHaveLength(1);
		expect(transport.deadlines[0].milliseconds).toBe(5000);
		transport.deadlines[0].callback();
		const error: unknown = await result.catch((error: unknown) => error);
		expect(error).toMatchObject({
			name: "ProgrammaticSandboxError",
			context: {
				phase,
				operation: "render",
				root: "authored-code",
				seed: 1978,
				frameIndex: 161,
				sourceTime: 644000,
				timelineTime: 644000,
				width: 64,
				height: 48,
			},
		});
		expect(error instanceof Error && error.message).toContain(
			"timed out after 5000 ms",
		);
		expect(error instanceof Error && error.message).not.toContain(source.code);
		expect(transport.disposed).toBe(true);
	});

test("duplicate load/ready cannot transfer a port or dispatch a request twice", async () => {
	const { result, transport } = await start();
	transport.iframe.onload();
	transport.iframe.onload();
	transport.send("ready");
	transport.send("ready");
	expect(transport.connections).toBe(1);
	expect(transport.channels[0].port1.messages).toHaveLength(1);
	transport.send({ sandboxStage: "worker-started" });
	const bitmap = new SandboxBitmap();
	transport.send({ bitmap });
	expect(await result).toBe(bitmap);
	expect(bitmap.closed).toBe(false);
	expect(transport.disposed).toBe(true);
	const late = new SandboxBitmap();
	transport.send({ bitmap: late });
	expect(late.closed).toBe(true);
});

test("a failed port transfer rejects immediately with its stage", async () => {
	const { result, transport } = await start();
	transport.failConnection();
	transport.iframe.onload();
	await expect(result).rejects.toMatchObject({
		context: { phase: "sandbox-ready", operation: "render" },
	});
	expect(transport.disposed).toBe(true);
});

test("failed dispatch and dispose cannot strand the promise or its realm", async () => {
	const { result, transport } = await start();
	transport.iframe.onload();
	transport.channels[0].port1.dispatchError = true;
	transport.send("ready");
	await expect(result).rejects.toMatchObject({
		context: { phase: "worker-start", operation: "render" },
	});
	expect(transport.disposed).toBe(true);
});

test("cancellation retains the original reason and disposes both ports", async () => {
	const controller = new AbortController();
	const { result, transport } = await start(controller.signal);
	transport.iframe.onload();
	transport.send("ready");
	transport.send({ sandboxStage: "worker-started" });
	const reason = new DOMException("test cancellation", "AbortError");
	controller.abort(reason);
	expect(await result.catch((error: unknown) => error)).toBe(reason);
	expect(transport.disposed).toBe(true);
});

test("progress does not settle measurement or reset its watchdog", async () => {
	harness = installSandboxHarness();
	const result = runProgrammaticSandbox({
		source,
		frame,
		resources: [],
		operation: "measure-resources",
	});
	for (let i = 0; i < 12; i++) await Promise.resolve();
	harness.iframe.onload();
	harness.send("ready");
	harness.send({ sandboxStage: "worker-started" });
	expect(harness.disposed).toBe(false);
	expect(harness.deadlines).toHaveLength(1);
	harness.send({ fontMetrics: [], imageDimensions: [] });
	expect(await result).toEqual({ fontMetrics: [], imageDimensions: [] });
	expect(harness.disposed).toBe(true);
});

test("invalid dimensions close the transferred bitmap and preserve frame context", async () => {
	const { result, transport } = await start();
	transport.iframe.onload();
	transport.send("ready");
	transport.send({ sandboxStage: "worker-started" });
	const bitmap = new SandboxBitmap();
	bitmap.width = 1;
	transport.send({ bitmap });
	await expect(result).rejects.toMatchObject({
		context: { phase: "worker-result", frameIndex: 161 },
	});
	expect(bitmap.closed).toBe(true);
	expect(transport.disposed).toBe(true);
});

for (const phase of [
	"iframe-load",
	"sandbox-ready",
	"worker-start",
	"worker-result",
]) {
	test(`message deserialization immediately rejects with ${phase} context`, async () => {
		const { result, transport } = await start();
		if (phase !== "iframe-load") transport.iframe.onload();
		if (phase === "worker-start" || phase === "worker-result")
			transport.send("ready");
		if (phase === "worker-result")
			transport.send({ sandboxStage: "worker-started" });
		transport.messageError();
		await expect(result).rejects.toMatchObject({
			context: { phase, operation: "render", frameIndex: 161 },
			message: expect.stringContaining("deserialization failed"),
		});
		expect(transport.deadlines[0].milliseconds).toBe(5000);
		expect(transport.disposed).toBe(true);
	});
}

test("cleanup exceptions cannot replace a failure or skip independent releases", async () => {
	const { result, transport } = await start();
	transport.channels[0].port1.closeError = true;
	transport.channels[0].port2.closeError = true;
	transport.failRemoval();
	transport.messageError();
	await expect(result).rejects.toMatchObject({
		message: expect.stringContaining("deserialization failed"),
		context: { phase: "iframe-load" },
	});
	for (const port of [transport.channels[0].port1, transport.channels[0].port2])
		expect(port.closeCalls).toBe(1);
	expect(transport.removeCalls).toBe(1);
});

test("cleanup exceptions retain cancellation identity and a successful caller-owned bitmap", async () => {
	const controller = new AbortController();
	const cancelled = await start(controller.signal);
	cancelled.transport.channels[0].port1.closeError = true;
	cancelled.transport.failRemoval();
	const reason = Error("original private cancellation reason");
	controller.abort(reason);
	expect(await cancelled.result.catch((error: unknown) => error)).toBe(reason);
	expect(cancelled.transport.channels[0].port2.closed).toBe(true);
	expect(cancelled.transport.removeCalls).toBe(1);
	cancelled.transport.restore();
	const success = await start();
	success.transport.channels[0].port1.closeError = true;
	success.transport.failRemoval();
	const bitmap = new SandboxBitmap();
	success.transport.send({ bitmap });
	expect(await success.result).toBe(bitmap);
	expect(bitmap.closed).toBe(false);
	expect(success.transport.channels[0].port2.closed).toBe(true);
	expect(success.transport.removeCalls).toBe(1);
});

for (const kind of ["font", "image"] as const) {
	for (const late of ["resolve", "reject"] as const) {
		test(`${kind} preparation aborts before digest settles and absorbs its late ${late}`, async () => {
			harness = installSandboxHarness();
			const originalCrypto = Object.getOwnPropertyDescriptor(
				globalThis,
				"crypto",
			);
			let resolveDigest!: (value: ArrayBuffer) => void;
			let rejectDigest!: (reason: unknown) => void;
			let digestCalls = 0;
			const digest = new Promise<ArrayBuffer>((resolve, reject) => {
				resolveDigest = resolve;
				rejectDigest = reject;
			});
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				value: {
					subtle: {
						digest: () => {
							digestCalls++;
							return digest;
						},
					},
				},
			});
			const resource = {
				id: "asset",
				kind,
				mimeType: kind === "font" ? "font/woff2" : "image/png",
				byteLength: 1,
				sha256: "0".repeat(64),
				attachmentKey: "programmatic-sha256-" + "0".repeat(64),
				...(kind === "font"
					? { font: { family: "Test", style: "normal" as const, weight: 400 } }
					: {}),
			};
			const controller = new AbortController(),
				reason = Error("exact preparation cancellation");
			let outcome: unknown;
			const result = runProgrammaticSandbox({
				source: { ...source, resources: [resource] },
				frame,
				resources: [{ resource, body: new ArrayBuffer(1) }],
				operation: "render",
				signal: controller.signal,
			});
			void result.then(
				(value) => {
					outcome = value;
				},
				(error) => {
					outcome = error;
				},
			);
			try {
				for (let i = 0; i < 12; i++) await Promise.resolve();
				expect(digestCalls).toBe(1);
				controller.abort(reason);
				for (let i = 0; i < 12; i++) await Promise.resolve();
				expect(outcome).toBe(reason);
				expect(harness.channels).toHaveLength(0);
				expect(harness.deadlines).toHaveLength(0);
				if (late === "resolve") resolveDigest(new ArrayBuffer(32));
				else rejectDigest(Error("late digest rejection must be handled"));
				for (let i = 0; i < 12; i++) await Promise.resolve();
				expect(outcome).toBe(reason);
				expect(harness.channels).toHaveLength(0);
			} finally {
				rejectDigest(Error("test teardown"));
				await result.catch(() => {});
				if (originalCrypto)
					Object.defineProperty(globalThis, "crypto", originalCrypto);
				else Reflect.deleteProperty(globalThis, "crypto");
			}
		});
	}
}

test("an uncancelled preparation failure returns the original digest error without a realm", async () => {
	harness = installSandboxHarness();
	const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
	const reason = Error("real digest failure");
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: {
			subtle: { digest: () => Promise.reject(reason) },
		},
	});
	const resource = {
		id: "font",
		kind: "font" as const,
		mimeType: "font/woff2",
		byteLength: 1,
		sha256: "0".repeat(64),
		attachmentKey: "programmatic-sha256-" + "0".repeat(64),
		font: { family: "Test", style: "normal" as const, weight: 400 },
	};
	try {
		await expect(
			runProgrammaticSandbox({
				source: { ...source, resources: [resource] },
				frame,
				resources: [{ resource, body: new ArrayBuffer(1) }],
				operation: "render",
				signal: new AbortController().signal,
			}),
		).rejects.toBe(reason);
		expect(harness.channels).toHaveLength(0);
	} finally {
		if (originalCrypto)
			Object.defineProperty(globalThis, "crypto", originalCrypto);
		else Reflect.deleteProperty(globalThis, "crypto");
	}
});

test("a synchronous sandbox document assignment failure releases its timer and private ports", async () => {
	harness = installSandboxHarness();
	const reason = Error("host rejected sandbox srcdoc assignment");
	Object.defineProperty(harness.iframe, "srcdoc", {
		set() {
			throw reason;
		},
	});
	await expect(
		runProgrammaticSandbox({
			source,
			frame,
			resources: [],
			operation: "render",
		}),
	).rejects.toBe(reason);
	expect(harness.channels).toHaveLength(1);
	expect(harness.disposed).toBe(true);
});

test("pre-aborted preparation handoff releases its listener before the digest settles", async () => {
	harness = installSandboxHarness();
	const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
	const controller = new AbortController(),
		reason = Error("synchronous digest-start cancellation");
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const add = controller.signal.addEventListener.bind(controller.signal);
	const remove = controller.signal.removeEventListener.bind(controller.signal);
	Object.defineProperties(controller.signal, {
		addEventListener: {
			value(
				type: string,
				listener: EventListenerOrEventListenerObject,
				options?: AddEventListenerOptions,
			) {
				if (type === "abort") listeners.add(listener);
				add(type, listener, options);
			},
		},
		removeEventListener: {
			value(
				type: string,
				listener: EventListenerOrEventListenerObject,
				options?: EventListenerOptions,
			) {
				if (type === "abort") listeners.delete(listener);
				remove(type, listener, options);
			},
		},
	});
	let rejectDigest!: (reason: unknown) => void;
	const digest = new Promise<ArrayBuffer>((_, reject) => {
		rejectDigest = reject;
	});
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: {
			subtle: {
				digest: () => {
					controller.abort(reason);
					return digest;
				},
			},
		},
	});
	const resource = {
		id: "font",
		kind: "font" as const,
		mimeType: "font/woff2",
		byteLength: 1,
		sha256: "0".repeat(64),
		attachmentKey: "programmatic-sha256-" + "0".repeat(64),
		font: { family: "Test", style: "normal" as const, weight: 400 },
	};
	try {
		await expect(
			runProgrammaticSandbox({
				source: { ...source, resources: [resource] },
				frame,
				resources: [{ resource, body: new ArrayBuffer(1) }],
				operation: "render",
				signal: controller.signal,
			}),
		).rejects.toBe(reason);
		expect(listeners.size).toBe(0);
		expect(harness.channels).toHaveLength(0);
	} finally {
		rejectDigest(Error("late digest rejection"));
		for (let i = 0; i < 12; i++) await Promise.resolve();
		if (originalCrypto)
			Object.defineProperty(globalThis, "crypto", originalCrypto);
		else Reflect.deleteProperty(globalThis, "crypto");
	}
});
