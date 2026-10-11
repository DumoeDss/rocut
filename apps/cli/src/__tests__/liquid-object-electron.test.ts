import { expect, test } from "bun:test";
import { captureElectronLiquidObjectPng } from "../programmatic/liquid-object-electron-capture";
import { threeLiquidObjectCompileIdentity } from "../programmatic/three-liquid-object-identity";
import { runtime } from "./three-liquid-object-provenance-fixture";
import { ElectronParticleBrowser } from "../programmatic/electron-particle-browser";
import {
	createElectronLiquidProfile,
	ELECTRON_LIQUID_CLEANUP,
} from "../programmatic/liquid-object-electron-profile";
import { assertElectronLiquidPolicyFit } from "../programmatic/liquid-object-electron-policy";
import { enableParticleRootContext } from "../programmatic/particle-capture-context";
import { attachLiquidObjectBroker } from "../programmatic/liquid-object-broker";
import { createThreeLiquidObjectTransport } from "../programmatic/engines/three-liquid-object-transport";
import type { ElectronParticleSessionTransport } from "../programmatic/electron-particle-transport";
import {
	policy,
	frame,
	envelope,
	control,
	deferred,
	tick,
	responseJson,
} from "./liquid-object-broker-fixture";

const response = (value: object) =>
	new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
	});

test("Liquid Electron capture checks closed Rust phase only after author evaluation and always closes native ownership", async () => {
	const publication = runtime();
	const archive = threeLiquidObjectCompileIdentity({
		runtime: publication,
		adapterSha256: "b".repeat(64),
	});
	const context = deferred<Response>();
	let enabled = false,
		evaluated = false,
		disposed = false,
		closed = false,
		checks = 0;
	const wire: ElectronParticleSessionTransport = {
		sessionId: "b".repeat(32),
		rootFrameId: "root",
		openedAt: performance.now(),
		async request(operation, _body, signal) {
			if (operation === "events") {
				if (!enabled) return context.promise;
				return new Promise<Response>((_, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(Error("poll stopped")),
						{ once: true },
					),
				);
			}
			if (operation === "context-enable") {
				enabled = true;
				context.resolve(
					new Response(
						JSON.stringify({
							version: 2,
							executionContextId: 7,
							frameId: "root",
						}),
						{
							headers: {
								"content-type": "application/json",
								"x-elftia-event-kind": "context-created",
								"x-elftia-event-sequence": "1",
							},
						},
					),
				);
			}
			if (operation === "evaluate") evaluated = true;
			if (operation === "screenshot") {
				const png = Buffer.alloc(24);
				Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
				png.write("IHDR", 12);
				png.writeUInt32BE(320, 16);
				png.writeUInt32BE(240, 20);
				return new Response(png, { headers: { "content-type": "image/png" } });
			}
			if (operation === "close") {
				closed = true;
				return response({ version: 2, closed: true });
			}
			return response({ version: 2, ok: true });
		},
	};
	const result = await captureElectronLiquidObjectPng(
		{
			connection: {
				async probe(received) {
					expect(received).toBe(archive.transportPolicy);
					return {
						async open() {
							return wire;
						},
					};
				},
			},
			width: 320,
			height: 240,
			code: "fixture-author",
			resources: [],
			frame,
			archive,
			signal: new AbortController().signal,
		},
		async (options) => {
			await options.browser.send(
				"Runtime.addBinding",
				{ name: "__rocutLiquidObjectRequest", executionContextId: 7 },
				wire.sessionId,
			);
			return {
				...publication,
				failure: new Promise<never>(() => {}),
				check() {
					if (!evaluated)
						throw Error(
							"Rust frame must not be checked before author closes phase",
						);
					checks++;
				},
				async dispose() {
					disposed = true;
					await options.browser.send(
						"Runtime.removeBinding",
						{ name: "__rocutLiquidObjectRequest" },
						wire.sessionId,
					);
				},
			};
		},
	);
	expect(result.readUInt32BE(16)).toBe(320);
	expect(checks).toBe(3);
	expect(disposed).toBe(true);
	expect(closed).toBe(true);
});
async function fixture() {
	const replies: { body: string; sequence?: number }[] = [];
	const queue: Response[] = [];
	let sequence = 0,
		pending: ReturnType<typeof deferred<Response>> | undefined;
	const evaluation = deferred<Response>();
	const enqueue = (kind: string, value: object, context?: number) => {
		const result = new Response(JSON.stringify(value), {
			headers: {
				"content-type": "application/json",
				"x-elftia-event-kind": kind,
				"x-elftia-event-sequence": String(++sequence),
				...(context
					? { "x-elftia-execution-context-id": String(context) }
					: {}),
			},
		});
		if (pending) {
			const waiter = pending;
			pending = undefined;
			waiter.resolve(result);
		} else queue.push(result);
	};
	const transport: ElectronParticleSessionTransport = {
		sessionId: "a".repeat(32),
		rootFrameId: "root",
		openedAt: performance.now(),
		async request(operation, body, signal, replySequence) {
			if (operation === "events") {
				if (queue.length) return queue.shift()!;
				const waiter = deferred<Response>();
				pending = waiter;
				const abort = () => {
					pending = undefined;
					waiter.reject(Error("fixture cancelled"));
				};
				signal.addEventListener("abort", abort, { once: true });
				try {
					return await waiter.promise;
				} finally {
					signal.removeEventListener("abort", abort);
				}
			}
			if (operation === "context-enable")
				enqueue("context-created", {
					version: 2,
					executionContextId: 7,
					frameId: "root",
				});
			if (operation === "evaluate") return evaluation.promise;
			if (operation === "reply")
				replies.push({ body, sequence: replySequence });
			if (operation === "close") return response({ version: 2, closed: true });
			return response({ version: 2, ok: true });
		},
	};
	const abort = new AbortController();
	const browser = new ElectronParticleBrowser(
		transport,
		policy,
		abort.signal,
		320,
		240,
		createElectronLiquidProfile(frame, policy),
	);
	const context = await enableParticleRootContext({
		browser,
		session: transport.sessionId,
		signal: abort.signal,
		timeoutMs: 100,
	});
	browser.setIdentity({
		sessionId: transport.sessionId,
		captureId: frame.sessionId,
		sourceId: "source",
		frameId: "frame",
	});
	let terminations = 0;
	const worker = createThreeLiquidObjectTransport({
		frameJson: JSON.stringify(frame),
		policyJson: JSON.stringify(policy),
		signal: abort.signal,
		admission: {
			async command(text) {
				const command = JSON.parse(text);
				return JSON.stringify({
					version: 1,
					ok: true,
					...(command.operation === "reserve"
						? {
								reservation: {
									requestId: command.identity.requestId,
									maxResponseJsonBytes: 2048,
									maxResponseEnvelopeBytes: 4096,
								},
							}
						: {}),
				});
			},
			async terminate() {
				terminations++;
			},
		},
		async evaluate(text) {
			return JSON.stringify({
				version: 1,
				identity: JSON.parse(text).identity,
				payloadJson: responseJson,
			});
		},
	});
	const broker = await attachLiquidObjectBroker({
		browser,
		session: transport.sessionId,
		executionContextId: context.executionContextId,
		transport: worker,
		signal: abort.signal,
	});
	browser.freezeExpression("fixture-author-expression");
	const running = browser.send(
		"Runtime.evaluate",
		{
			contextId: 7,
			expression: "fixture-author-expression",
			awaitPromise: true,
			returnByValue: true,
		},
		transport.sessionId,
	);
	const emit = (text: string) => enqueue("liquid-request", JSON.parse(text), 7);
	const settle = async () => {
		for (let i = 0; i < 8; i++) await tick();
	};
	return {
		browser,
		broker,
		context,
		transport,
		abort,
		replies,
		running,
		evaluation,
		emit,
		settle,
		terminations: () => terminations,
		async finish() {
			evaluation.resolve(response({ version: 2, ok: true }));
			await running.catch(() => {});
			await broker.dispose().catch(() => {});
			context.dispose();
			await browser.close("complete").catch(() => {});
		},
	};
}

test("Electron finite adapter relays Liquid open/Rust evaluation/close with native sequence correlation", async () => {
	const f = await fixture();
	try {
		f.emit(control("open"));
		await f.settle();
		f.emit(envelope());
		await f.settle();
		f.evaluation.resolve(response({ version: 2, ok: true }));
		await f.running;
		// Page cleanup closes its Rust phase after the authored expression completed.
		f.emit(control("close"));
		await f.settle();
		expect(f.replies.map((reply) => reply.sequence)).toEqual([2, 3, 4]);
		expect(JSON.parse(f.replies[1].body).payloadJson).toBe(responseJson);
		f.broker.check();
		await f.browser.send(
			"Runtime.evaluate",
			{
				contextId: 7,
				expression: ELECTRON_LIQUID_CLEANUP,
				awaitPromise: true,
				returnByValue: true,
			},
			f.transport.sessionId,
		);
	} finally {
		await f.finish();
	}
	expect(f.terminations()).toBe(1);
});

test("changed Liquid frame is terminal and disposes the worker without forwarding a reply", async () => {
	const f = await fixture();
	try {
		f.emit(
			JSON.stringify({
				operation: "open",
				frame: { ...frame, seed: frame.seed + 1 },
			}),
		);
		await expect(f.browser.failure).rejects.toThrow("trusted mapped frame");
		expect(f.replies).toHaveLength(0);
	} finally {
		await f.finish();
	}
	expect(f.terminations()).toBe(1);
});

test("cancellation releases the Liquid worker and rejects further Electron page requests", async () => {
	const f = await fixture();
	try {
		f.emit(control("open"));
		await f.settle();
		f.abort.abort(Error("fixture cancellation"));
		await expect(f.broker.failure).rejects.toThrow("fixture cancellation");
		await expect(f.browser.failure).rejects.toThrow("capture aborted");
		await f.settle();
		expect(f.terminations()).toBe(1);
		expect(f.replies).toHaveLength(1);
	} finally {
		await f.finish();
	}
});

test("Electron admits the published default Liquid envelope budget and refuses unsupported ceilings", () => {
	const defaults = {
		...policy,
		maxRequestEnvelopeBytes: 24004096,
		maxResponseEnvelopeBytes: 24004096,
		maxRequestsPerFrame: 64,
		maxEncodedBytesPerFrame: 48000000,
		maxRetainedPayloadBytesPerFrame: 96000000,
		requestTimeoutMs: 15000,
		frameTimeoutMs: 30000,
		initTimeoutMs: 5000,
		cleanupTimeoutMs: 5000,
		terminationTimeoutMs: 5000,
	};
	expect(() => assertElectronLiquidPolicyFit(defaults)).not.toThrow();
	expect(() =>
		assertElectronLiquidPolicyFit({
			...defaults,
			maxRequestEnvelopeBytes: 33554433,
		}),
	).toThrow("does not fit");
});
