import { afterEach, expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "./frame";
import { runProgrammaticSandbox } from "./sandbox-runtime";
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
