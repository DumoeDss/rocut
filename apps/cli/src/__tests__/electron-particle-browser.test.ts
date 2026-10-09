import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { captureElectronParticlePng } from "../programmatic/electron-particle-capture";
import { threeParticleCompileIdentity } from "../programmatic/three-particle-provenance";
import { completeParticleSamplerIdentity } from "../programmatic/particle-sampler-identity";
import { parseParticleTransportPolicy } from "../programmatic/particle-policy";
import { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";
import { createParticleSamplerWorkerCore } from "../programmatic/particle-sampler-worker-core";
import {
	FakeWorker,
	policy as workerPolicy,
} from "./particle-sampler-worker-test-support";
import {
	ElectronParticleBrowser,
	ELECTRON_PARTICLE_REPLY,
	ELECTRON_PARTICLE_CLEANUP,
} from "../programmatic/electron-particle-browser";
import { attachParticleBroker } from "../programmatic/particle-broker";
import { enableParticleRootContext } from "../programmatic/particle-capture-context";
import { withHtmlCaptureCleanup } from "../programmatic/particle-capture";
import type { ElectronParticleSessionTransport } from "../programmatic/electron-particle-transport";
import {
	deferred,
	policy,
	requestJson,
	responseJson,
} from "./particle-broker-test-support";

const sessionId = "a".repeat(32),
	identity = {
		sessionId,
		captureId: "capture",
		sourceId: "source",
		frameId: "frame",
	};
const ok = () =>
	new Response(JSON.stringify({ version: 2, ok: true }), {
		headers: { "content-type": "application/json" },
	});
function transportFixture(openedAt = performance.now()) {
	const queue: Response[] = [],
		polls: number[] = [],
		calls: string[] = [];
	let sequence = 0,
		pending: ((response: Response) => void) | undefined;
	let requestHook:
		| ((
				operation: string,
				body: string,
				sequence?: number,
		  ) => Promise<Response> | undefined)
		| undefined;
	const deliver = (response: Response) => {
		if (pending) {
			const resolve = pending;
			pending = undefined;
			resolve(response);
		} else queue.push(response);
	};
	const enqueue = (kind: string, value: object, context?: number) => {
		const response = new Response(JSON.stringify(value), {
			headers: {
				"content-type": "application/json",
				"x-elftia-event-sequence": String(++sequence),
				"x-elftia-event-kind": kind,
				...(context
					? { "x-elftia-execution-context-id": String(context) }
					: {}),
			},
		});
		deliver(response);
	};
	const transport: ElectronParticleSessionTransport = {
		sessionId,
		rootFrameId: "root-A",
		openedAt,
		async request(operation, body, signal, replySequence) {
			signal.throwIfAborted();
			calls.push(operation);
			if (operation === "events") {
				polls.push(JSON.parse(body).afterSequence);
				if (queue.length) return queue.shift()!;
				return new Promise<Response>((resolve, reject) => {
					const abort = () => {
						pending = undefined;
						reject(Error("test poll aborted"));
					};
					if (signal.aborted) {
						abort();
						return;
					}
					signal.addEventListener("abort", abort, { once: true });
					pending = (response) => {
						signal.removeEventListener("abort", abort);
						resolve(response);
					};
				});
			}
			if (operation === "close")
				return new Response(JSON.stringify({ version: 2, closed: true }), {
					headers: { "content-type": "application/json" },
				});
			const hooked = requestHook?.(operation, body, replySequence);
			if (hooked) return hooked;
			if (operation === "context-enable")
				enqueue("context-created", {
					version: 2,
					executionContextId: 7,
					frameId: "root-A",
				});
			return ok();
		},
	};
	return {
		transport,
		calls,
		polls,
		enqueue,
		idle() {
			deliver(new Response(null, { status: 204 }));
		},
		hook(value: typeof requestHook) {
			requestHook = value;
		},
	};
}
function fixture(openedAt = performance.now()) {
	const native = transportFixture(openedAt),
		controller = new AbortController();
	return {
		...native,
		controller,
		browser: new ElectronParticleBrowser(
			native.transport,
			policy,
			controller.signal,
			1,
			1,
		),
	};
}
const evalParams = (expression: string) => ({
	contextId: 7,
	expression,
	awaitPromise: true,
	returnByValue: true,
});

test("real broker admits a new sample while previous reply ACK tail is pending; event ACK keeps correlation", async () => {
	const f = fixture(),
		done = deferred<Response>(),
		firstAck = deferred<Response>();
	const context = await enableParticleRootContext({
		browser: f.browser,
		session: sessionId,
		signal: f.controller.signal,
		timeoutMs: 1000,
	});
	f.browser.setIdentity(identity);
	let samples = 0,
		terminated = 0,
		tailWasPending = false,
		firstPending = false;
	const replySequences: number[] = [];
	const sample = (id: number) => ({
		...identity,
		version: 1,
		operation: "particleSurface",
		kind: "sample",
		id,
		requestJson,
	});
	f.hook((operation, body, sequence) => {
		if (operation === "evaluate") {
			f.enqueue("particle-request", sample(1), 7);
			return done.promise;
		}
		if (operation === "reply") {
			replySequences.push(sequence!);
			if (JSON.parse(body).id === 1) {
				firstPending = true;
				f.enqueue("particle-request", sample(2), 7);
				return firstAck.promise.then((value) => {
					firstPending = false;
					return value;
				});
			}
			tailWasPending = firstPending;
			firstAck.resolve(ok());
			done.resolve(ok());
			return Promise.resolve(ok());
		}
	});
	const broker = await attachParticleBroker({
		browser: f.browser,
		session: sessionId,
		executionContextId: 7,
		identity,
		policy: {
			...policy,
			maxInFlight: 1,
			process: { ...policy.process, maxPendingRequests: 1 },
		},
		signal: f.controller.signal,
		cleanupTimeoutMs: 5000,
		sampler: async () => {
			samples++;
			return responseJson;
		},
		terminateSampler: async () => {
			terminated++;
		},
	});
	try {
		f.browser.freezeExpression("void 0");
		await f.browser.send("Runtime.evaluate", evalParams("void 0"), sessionId);
		await broker.check();
		expect(samples).toBe(2);
		expect(tailWasPending).toBe(true);
		expect(replySequences).toEqual([2, 3]);
		expect(f.polls).toEqual([0, 1, 2, 3]);
	} finally {
		f.browser.beginCleanup();
		await broker.dispose();
		context.dispose();
		await f.browser.close("complete");
	}
	expect(terminated).toBe(1);
	expect(f.calls.filter((call) => call === "close").length).toBe(1);
});

test.each([
	[
		"Runtime.evaluate",
		{ ...evalParams("malicious()"), includeCommandLineAPI: true },
	],
	["Runtime.callFunctionOn", { functionDeclaration: "arbitrary" }],
	["Network.enable", {}],
	[
		"Page.captureScreenshot",
		{ format: "jpeg", fromSurface: true, captureBeyondViewport: false },
	],
	["Runtime.addBinding", { name: "anything", executionContextId: 7 }],
])(
	"finite adapter rejects altered %s before native request",
	async (method, params) => {
		const f = fixture();
		await expect(
			f.browser.send(
				method as string,
				params as Record<string, unknown>,
				sessionId,
			),
		).rejects.toThrow();
		expect(f.calls.length).toBe(0);
		await expect(f.browser.close("failed")).rejects.toThrow();
		expect(f.calls).toEqual(["close"]);
	},
);

test("unknown replies, wrong sessions and root replacement are terminal", async () => {
	const f = fixture();
	const context = await enableParticleRootContext({
		browser: f.browser,
		session: sessionId,
		signal: f.controller.signal,
		timeoutMs: 1000,
	});
	f.browser.setIdentity(identity);
	await expect(
		f.browser.send(
			"Runtime.callFunctionOn",
			{
				executionContextId: 7,
				functionDeclaration: ELECTRON_PARTICLE_REPLY,
				arguments: [
					{
						value: JSON.stringify({
							...identity,
							version: 1,
							operation: "particleSurface",
							id: 99,
							ok: true,
							responseJson,
						}),
					},
				],
				returnByValue: true,
			},
			sessionId,
		),
	).rejects.toThrow("unknown");
	context.dispose();
	await expect(f.browser.close("failed")).rejects.toThrow();
	const g = fixture();
	await expect(
		g.browser.send("Page.getFrameTree", {}, "wrong"),
	).rejects.toThrow("wrong adapter session");
	await expect(g.browser.close("failed")).rejects.toThrow();
	const h = fixture(),
		root = await enableParticleRootContext({
			browser: h.browser,
			session: sessionId,
			signal: h.controller.signal,
			timeoutMs: 1000,
		});
	h.enqueue("context-created", {
		version: 2,
		executionContextId: 8,
		frameId: "root-A",
	});
	await expect(h.browser.failure).rejects.toThrow("replaced");
	root.dispose();
	await expect(h.browser.close("failed")).rejects.toThrow();
});

test("absolute session budget cannot be renewed by event polling and close has separate abort signal", async () => {
	const f = fixture(performance.now() - 39900);
	const context = await enableParticleRootContext({
		browser: f.browser,
		session: sessionId,
		signal: f.controller.signal,
		timeoutMs: 1000,
	});
	const idleTimer = setInterval(() => f.idle(), 5);
	try {
		await expect(f.browser.failure).rejects.toThrow(
			"absolute session deadline",
		);
		expect(f.polls.length).toBeGreaterThan(3);
		expect(f.polls.slice(1).every((value) => value === 1)).toBe(true);
	} finally {
		clearInterval(idleTimer);
	}
	context.dispose();
	await expect(f.browser.close("failed")).rejects.toThrow(
		"absolute session deadline",
	);
	expect(f.calls.at(-1)).toBe("close");
});

test("falsey cleanup error remains a cause and cannot skip native close or mask primary failure", async () => {
	const f = fixture(),
		context = await enableParticleRootContext({
			browser: f.browser,
			session: sessionId,
			signal: f.controller.signal,
			timeoutMs: 1000,
		});
	f.browser.setIdentity(identity);
	await f.browser.send(
		"Runtime.addBinding",
		{ name: "__rocutParticleSurface", executionContextId: 7 },
		sessionId,
	);
	f.browser.freezeExpression("void 0");
	await f.browser.send("Runtime.evaluate", evalParams("void 0"), sessionId);
	f.hook((operation) =>
		operation === "cleanup" ? Promise.reject(false) : undefined,
	);
	let disposed = false;
	try {
		await withHtmlCaptureCleanup({
			run: async () => {
				throw 0;
			},
			cleanupPage: async () => {
				await f.browser.send(
					"Runtime.evaluate",
					evalParams(ELECTRON_PARTICLE_CLEANUP),
					sessionId,
				);
			},
			disposeBrokers: [
				async () => {
					disposed = true;
				},
			],
			closeBrowser: async () => {
				context.dispose();
				await f.browser.close("failed");
			},
		});
		throw Error("Expected cleanup failure");
	} catch (error) {
		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors[0]).toBe(0);
		expect((error as AggregateError).errors[1].cause).toBe(false);
	}
	expect(disposed).toBe(true);
	expect(f.calls.at(-1)).toBe("close");
});

// Schema-only CPU publication. This does not substitute for the private Rust
// worker or real Electron acceptance run.
function publication(sampler = "a") {
	const hash = (value: string) =>
		createHash("sha256").update(value).digest("hex");
	const transportPolicy = parseParticleTransportPolicy(
		JSON.stringify({
			...JSON.parse(particleTransportPolicyJson()),
			hostDefaults: policy,
		}),
	);
	const policyJson = JSON.stringify(transportPolicy),
		policyHash = hash(policyJson),
		publishedPolicyHash = hash(particleTransportPolicyJson());
	const files = (["module", "glue", "wasm", "worker-entry"] as const).map(
		(role) => ({ role, sha256: hash(role + sampler), bytes: 12 }),
	);
	return {
		transportPolicy,
		policyJson,
		policyHash,
		publishedPolicyHash,
		samplerIdentity: completeParticleSamplerIdentity(
			{
				version: 1,
				bindingVersion: "inline-wasm-v1",
				layout: "source-sync",
				runtime: { name: "bun", version: "1.2.18" },
				files,
				executionHash: hash("execution" + sampler),
				closureHash: hash(JSON.stringify(files)),
			},
			{ policyHash, publishedPolicyHash },
		),
	};
}

test("capture probe rejection starts neither window nor sampler", async () => {
	const archive = threeParticleCompileIdentity(publication(), "b".repeat(64));
	let workers = 0;
	const sentinel = Error("capability or native ceilings unavailable");
	await expect(
		captureElectronParticlePng(
			{
				connection: {
					async probe(received) {
						expect(received).toBe(archive.transportPolicy.hostDefaults);
						throw sentinel;
					},
				},
				width: 1,
				height: 1,
				code: "void 0",
				resources: [],
				frame: { seed: 42, sourceTime: 0 },
				archive,
				signal: new AbortController().signal,
			},
			async () => {
				workers++;
				throw Error("must not start worker");
			},
		),
	).rejects.toBe(sentinel);
	expect(workers).toBe(0);
});

test("capture compares complete archived sampler identity before author evaluation and closes on mismatch", async () => {
	const native = transportFixture(),
		archive = threeParticleCompileIdentity(publication(), "b".repeat(64));
	let workers = 0,
		disposed = 0;
	await expect(
		captureElectronParticlePng(
			{
				connection: {
					async probe() {
						return {
							async open() {
								return native.transport;
							},
						};
					},
				},
				width: 1,
				height: 1,
				code: "void 0",
				resources: [],
				frame: { seed: 42, sourceTime: 0 },
				archive,
				signal: new AbortController().signal,
			},
			async (options) => {
				workers++;
				expect(options.expectedIdentity).toEqual(archive.samplerIdentity);
				expect(options.mappedFrame).toEqual({ seed: 42, sourceTime: 0 });
				return {
					...publication("changed"),
					policy,
					retainedPayloadBytes: 0,
					failure: new Promise<never>(() => {}),
					async check() {},
					async dispose() {
						disposed++;
					},
				};
			},
		),
	).rejects.toThrow("explicitly recompile");
	expect(workers).toBe(1);
	expect(disposed).toBe(1);
	expect(native.calls).not.toContain("evaluate");
	expect(native.calls.at(-1)).toBe("close");
});

test.each([false, true])(
	"real worker-core normal termination is not capture cancellation; dispose failure=%s is retained",
	async (disposeFails) => {
		const native = transportFixture(),
			runtime = publication(),
			archive = threeParticleCompileIdentity(runtime, "b".repeat(64));
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=",
			"base64",
		);
		native.hook((operation) =>
			operation === "screenshot"
				? Promise.resolve(
						new Response(png, { headers: { "content-type": "image/png" } }),
					)
				: undefined,
		);
		let disposals = 0,
			terminations = 0,
			intentionalFailure = "";
		const cleanupError = Error("fixture real disposal failed");
		const result = captureElectronParticlePng(
			{
				connection: {
					async probe() {
						return {
							async open() {
								return native.transport;
							},
						};
					},
				},
				width: 1,
				height: 1,
				code: "void 0",
				resources: [],
				frame: { seed: 42, sourceTime: 0 },
				archive,
				signal: new AbortController().signal,
			},
			async (options) => {
				const port = new FakeWorker();
				port.terminate = async () => {
					terminations++;
					port.exit(0);
					return 0;
				};
				const worker = createParticleSamplerWorkerCore(
					workerPolicy,
					() => port,
				);
				void worker.failure.catch((error: Error) => {
					intentionalFailure = error.message;
				});
				port.ready();
				await worker.ready;
				const broker = await attachParticleBroker({
					...options,
					policy,
					cleanupTimeoutMs: policy.cleanupTimeoutMs,
					sampler: worker.sampler,
					terminateSampler: worker.terminateSampler,
				});
				const failure = Promise.race([worker.failure, broker.failure]);
				void failure.catch(() => {});
				return {
					...runtime,
					...broker,
					policy,
					failure,
					async check() {
						await broker.check();
						worker.check();
					},
					async dispose() {
						disposals++;
						await broker.dispose();
						if (disposeFails) throw cleanupError;
					},
				};
			},
		);
		if (disposeFails) await expect(result).rejects.toBe(cleanupError);
		else expect(await result).toEqual(png);
		expect(intentionalFailure).toBe(
			"Particle sampler worker: capture terminated",
		);
		expect(disposals).toBe(1);
		expect(terminations).toBe(1);
		expect(native.calls.slice(-3)).toEqual(["cleanup", "binding", "close"]);
	},
);
