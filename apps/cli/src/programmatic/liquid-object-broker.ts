import type { ParticleBrowser } from "./particle-broker";
import { particleDeadline } from "./particle-broker-deadline";
import type { createThreeLiquidObjectTransport } from "./engines/three-liquid-object-transport";
import { boundedText } from "./engines/three-liquid-object-transport-publication";
import { parseLiquidBrokerRequest } from "./liquid-object-broker-codec";

const owners = new WeakMap<ParticleBrowser, Set<string>>();

/** Root-context binding only. An iframe request is data, never an executable
 * module, serialized owner, clock override or arbitrary native operation. */
export async function attachLiquidObjectBroker(options: {
	browser: ParticleBrowser;
	session: string;
	executionContextId: number;
	transport: ReturnType<typeof createThreeLiquidObjectTransport>;
	signal: AbortSignal;
}) {
	const { browser, session, executionContextId, transport, signal } = options;
	if (
		!session ||
		!Number.isSafeInteger(executionContextId) ||
		executionContextId < 1
	)
		throw Error("Liquid broker requires an explicit capture context");
	let owned = owners.get(browser);
	if (!owned) {
		owned = new Set();
		owners.set(browser, owned);
	}
	if (owned.has(session))
		throw Error("Liquid broker session already has an owner");
	owned.add(session);
	const jobs = new Set<Promise<void>>();
	let active: symbol | undefined;
	let disposed = false,
		added = false,
		requestId = 0;
	let terminal: Error | undefined, cleanup: Promise<void> | undefined;
	let binding: Promise<unknown> | undefined;
	let unsubscribe = () => {};
	let rejectFailure!: (error: Error) => void;
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	void failure.catch(() => {});
	const dispose = () => {
		if (cleanup) return cleanup;
		disposed = true;
		unsubscribe();
		signal.removeEventListener("abort", abort);
		cleanup = (async () => {
			const errors: unknown[] = [];
			try {
				await transport.dispose();
			} catch (error) {
				errors.push(error);
			}
			try {
				await particleDeadline(
					Promise.allSettled([...jobs]),
					transport.policy.cleanupTimeoutMs,
				);
				await particleDeadline(
					binding?.catch(() => {}) ?? Promise.resolve(),
					transport.policy.cleanupTimeoutMs,
				);
				if (added)
					await particleDeadline(
						browser.send(
							"Runtime.removeBinding",
							{ name: "__rocutLiquidObjectRequest" },
							session,
						),
						transport.policy.cleanupTimeoutMs,
					);
			} catch (error) {
				errors.push(error);
			}
			if (!errors.length) owned.delete(session);
			if (errors.length)
				throw new AggregateError(errors, "Liquid broker cleanup failed");
		})();
		void cleanup.catch(() => {});
		return cleanup;
	};
	const fail = (cause: unknown) => {
		if (!terminal) {
			terminal = transport.fail(cause);
			rejectFailure(terminal);
			void dispose().catch(() => {});
		}
		return terminal;
	};
	const abort = () => fail(signal.reason ?? Error("Liquid capture aborted"));
	void transport.failure.catch((error: unknown) => {
		if (!disposed) fail(error);
	});
	const receive = async (json: unknown) => {
		const ticket = Symbol("liquid-request");
		try {
			if (active) throw Error("Liquid page sent concurrent requests");
			active = ticket;
			const request = parseLiquidBrokerRequest({
				json,
				frame: transport.frame,
				policy: transport.policy,
				nextRequestId: requestId + 1,
			});
			let reply: string;
			if (request.operation === "evaluate") {
				requestId++;
				const payloadJson = await transport.evaluate(request.payloadJson);
				reply = JSON.stringify({
					version: 1,
					identity: { frame: transport.frame, requestId },
					payloadJson,
				});
				boundedText({
					text: reply,
					maximum: transport.policy.maxResponseEnvelopeBytes,
				});
			} else {
				await transport[request.operation]();
				reply = JSON.stringify({
					operation: request.operation,
					frame: transport.frame,
					ok: true,
				});
				boundedText({
					text: reply,
					maximum: transport.policy.maxControlJsonBytes,
				});
			}
			if (disposed || terminal)
				throw terminal ?? Error("Liquid broker disposed before reply");
			signal.throwIfAborted();
			// The page may send its next request before CDP acknowledges delivery.
			// Rust evaluation and settlement are already complete at this point.
			if (active === ticket) active = undefined;
			const result = await particleDeadline(
				browser.send(
					"Runtime.callFunctionOn",
					{
						executionContextId,
						functionDeclaration:
							"function(payload) { return globalThis.__rocutLiquidObjectReply(payload); }",
						arguments: [{ value: reply }],
						returnByValue: true,
					},
					session,
				),
				transport.policy.requestTimeoutMs,
			);
			if (result.exceptionDetails) throw Error("Liquid reply context failed");
		} catch (error) {
			throw fail(error);
		} finally {
			if (active === ticket) active = undefined;
		}
	};
	try {
		signal.throwIfAborted();
		unsubscribe = browser.onEvent((event) => {
			if (disposed || terminal || event.sessionId !== session) return;
			if (
				(event.method === "Runtime.executionContextDestroyed" &&
					event.params.executionContextId === executionContextId) ||
				event.method === "Runtime.executionContextsCleared"
			) {
				fail(Error("Liquid capture context destroyed"));
				return;
			}
			if (
				event.method !== "Runtime.bindingCalled" ||
				event.params.name !== "__rocutLiquidObjectRequest" ||
				event.params.executionContextId !== executionContextId
			)
				return;
			const job = receive(event.params.payload);
			jobs.add(job);
			void job.then(
				() => jobs.delete(job),
				() => jobs.delete(job),
			);
		});
		signal.addEventListener("abort", abort, { once: true });
		binding = browser
			.send(
				"Runtime.addBinding",
				{ name: "__rocutLiquidObjectRequest", executionContextId },
				session,
			)
			.then(() => {
				added = true;
			});
		await Promise.race([
			particleDeadline(binding, transport.policy.initTimeoutMs),
			failure,
		]);
		signal.throwIfAborted();
		return Object.freeze({
			failure,
			dispose,
			check() {
				if (terminal) throw terminal;
				if (active) throw Error("Liquid broker still has work");
				transport.check();
			},
		});
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Liquid broker initialization and cleanup failed",
			);
		}
		throw error;
	}
}
