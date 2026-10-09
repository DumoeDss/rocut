import { particleDeadline } from "./particle-broker-deadline";
import {
	assertParticleFrameConstraint,
	snapshotParticleFrameConstraint,
	type ParticleFrameConstraint,
} from "./particle-motion-contract";
import {
	createParticleFrameReservation,
	snapshotParticlePolicy,
} from "./particle-policy";
import type { FrameBrowserEvent } from "./chromium-process";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
	ParticleProtocolError,
	parseParticleRequest,
	validateParticlePolicy,
	validateParticleSurfaceResponse,
	type ParticleIdentity,
	type ParticlePolicy,
	type ParticleResponse,
	type ParticleSampleRequest,
} from "./particle-protocol";

export interface ParticleBrowser {
	send(
		method: string,
		params?: Record<string, unknown>,
		session?: string,
	): Promise<Record<string, unknown>>;
	onEvent(listener: (event: FrameBrowserEvent) => void): () => void;
}
export interface ParticleBrokerOptions {
	browser: ParticleBrowser;
	session: string;
	executionContextId: number;
	identity: ParticleIdentity;
	policy: ParticlePolicy;
	signal: AbortSignal;
	sampler(requestJson: string, signal: AbortSignal): Promise<string>;
	/** Owns a capture-private worker; resolves only after actual termination/cleanup.
	 * AbortSignal alone cannot interrupt synchronous WASM execution. */
	terminateSampler(): Promise<void>;
	cleanupTimeoutMs: number;
	/** Required for motion; the production host supplies the mapped Rust frame. */
	expectedFrame?: ParticleFrameConstraint;
}
type FailureCode = "surface" | "protocol" | "cancelled";
type Task = {
	request: ParticleSampleRequest;
	controller: AbortController;
	replied: boolean;
	timer: ReturnType<typeof setTimeout>;
};
const owners = new WeakMap<ParticleBrowser, Set<string>>();

/** One explicit CDP context and fixed surface operation per capture session.
 * The host must race failure against frame evaluation, then always await dispose.
 * Identity fields correlate work; they are not bearer credentials.
 */
export async function attachParticleBroker(options: ParticleBrokerOptions) {
	const {
		browser,
		session,
		executionContextId,
		signal,
		sampler,
		terminateSampler,
		cleanupTimeoutMs,
	} = options;
	if (
		!session ||
		typeof session !== "string" ||
		!Number.isSafeInteger(executionContextId) ||
		executionContextId < 1
	)
		throw Error(
			"Particle broker requires an explicit session and execution context",
		);
	if (
		!Number.isSafeInteger(cleanupTimeoutMs) ||
		cleanupTimeoutMs < 1 ||
		cleanupTimeoutMs > 30_000 ||
		typeof sampler !== "function" ||
		typeof terminateSampler !== "function"
	)
		throw Error(
			"Particle broker requires a terminable sampler and bounded cleanup deadline",
		);
	const identity = Object.freeze({ ...options.identity }),
		policy = snapshotParticlePolicy(options.policy);
	validateParticlePolicy(policy);
	const expectedFrame =
		options.expectedFrame === undefined
			? undefined
			: snapshotParticleFrameConstraint(options.expectedFrame);
	if (cleanupTimeoutMs > policy.cleanupTimeoutMs)
		throw Error("Particle cleanup deadline exceeds policy");
	const reservation = createParticleFrameReservation(policy);
	let frameTimer: ReturnType<typeof setTimeout> | undefined;
	// Exercise the same identity and encoded-envelope admission as real wire input.
	parseParticleRequest(
		JSON.stringify({
			...identity,
			version: 1,
			operation: "particleSurface",
			id: 1,
			kind: "cancel",
		}),
		identity,
		policy,
	);
	let owned = owners.get(browser);
	if (!owned) {
		owned = new Set();
		owners.set(browser, owned);
	}
	if (owned.has(session))
		throw Error("Particle broker session already has an owner");
	owned.add(session); // removeBinding is session-wide; never share its ownership.
	const active = new Map<number, Task>(),
		sampling = new Set<number>(),
		seen = new Set<number>(),
		jobs = new Set<Promise<void>>();
	let unsubscribe = () => {},
		disposed = false,
		contextGone = false,
		bindingAdded = false,
		requests = 0;
	let failureError: Error | undefined,
		cleanup: Promise<void> | undefined,
		pendingBinding: Promise<void> | undefined;
	let rejectFailure!: (error: Error) => void;
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	void failure.catch(() => {});
	const track = (job: Promise<void>) => {
		jobs.add(job);
		void job.then(
			() => jobs.delete(job),
			() => jobs.delete(job),
		);
	};
	const envelope = (task: Task) => ({
		...identity,
		version: 1 as const,
		operation: "particleSurface" as const,
		id: task.request.id,
	});
	const sendReply = (task: Task, reply: ParticleResponse): Promise<void> => {
		if (task.replied || disposed || contextGone || signal.aborted)
			return Promise.resolve();
		task.replied = true;
		return (async () => {
			const json = JSON.stringify(reply);
			if (Buffer.byteLength(json, "utf8") > policy.maxResponseEnvelopeBytes)
				throw new ParticleProtocolError(
					"Particle response envelope exceeds its byte limit",
				);
			const result = await browser.send(
				"Runtime.callFunctionOn",
				{
					executionContextId,
					functionDeclaration: `function(payload) { return globalThis.${PARTICLE_REPLY_NAME}(payload); }`,
					arguments: [{ value: json }],
					returnByValue: true,
				},
				session,
			);
			if (result.exceptionDetails) throw Error("Particle reply context failed");
		})();
	};
	const failFrame = (error: Error, code: FailureCode, skip?: Task) => {
		if (failureError) return;
		failureError = error;
		clearTimeout(frameTimer);
		rejectFailure(error);
		for (const task of active.values()) {
			task.controller.abort(error);
			if (task !== skip)
				track(
					sendReply(task, {
						...envelope(task),
						ok: false,
						error: {
							code,
							message:
								code === "cancelled"
									? "Particle capture cancelled"
									: "Particle capture failed",
						},
					}).catch(() => {}),
				);
		}
		// A hostile page need not call dispose: host deadlines close the private worker.
		void dispose().catch(() => {});
	};
	const abort = () => failFrame(Error("Particle capture aborted"), "cancelled");
	const event = (event: FrameBrowserEvent) => {
		if (disposed || failureError || event.sessionId !== session) return;
		if (
			(event.method === "Runtime.executionContextDestroyed" &&
				event.params.executionContextId === executionContextId) ||
			event.method === "Runtime.executionContextsCleared"
		) {
			contextGone = true;
			failFrame(Error("Particle execution context was destroyed"), "protocol");
			return;
		}
		if (
			event.method !== "Runtime.bindingCalled" ||
			event.params.name !== PARTICLE_BINDING_NAME ||
			event.params.executionContextId !== executionContextId
		)
			return;
		try {
			if (typeof event.params.payload !== "string")
				throw new ParticleProtocolError(
					"Particle binding payload must be JSON text",
				);
			const request = parseParticleRequest(
				event.params.payload,
				identity,
				policy,
			);
			if (request.kind === "cancel") {
				if (!active.has(request.id))
					throw new ParticleProtocolError(
						"Unknown or replayed particle cancellation",
					);
				failFrame(Error("Particle request cancelled"), "cancelled");
				return;
			}
			if (seen.has(request.id))
				throw new ParticleProtocolError("Replayed particle request id");
			assertParticleFrameConstraint(
				JSON.parse(request.requestJson),
				expectedFrame,
			);
			if (requests >= policy.maxRequestsPerFrame)
				throw new ParticleProtocolError(
					"Particle request count limit exceeded",
				);
			if (sampling.size >= policy.maxInFlight)
				throw new ParticleProtocolError("Particle in-flight limit exceeded");
			reservation.reserve();
			seen.add(request.id);
			requests++;
			const task: Task = {
				request,
				controller: new AbortController(),
				replied: false,
				timer: setTimeout(
					() =>
						failFrame(Error("Particle host request timed out"), "cancelled"),
					policy.requestTimeoutMs,
				),
			};
			active.set(request.id, task);
			sampling.add(request.id);
			const job = Promise.resolve().then(async () => {
				try {
					task.controller.signal.throwIfAborted();
					const responseJson = await sampler(
						request.requestJson,
						task.controller.signal,
					);
					if (disposed || failureError || task.controller.signal.aborted)
						return;
					const result = validateParticleSurfaceResponse(
						responseJson,
						request,
						policy,
					);
					// Page continuations may issue the next sample before CDP acknowledges
					// this reply. Retain active ownership for cancellation/cleanup, but
					// release computation admission now. Reply tails remain in jobs and
					// keep their whole-frame reservation until confirmed cleanup.
					sampling.delete(request.id);
					const reply = sendReply(task, {
						...envelope(task),
						ok: true,
						responseJson,
					});
					if (!result.ok)
						failFrame(
							Error("Rust particle surface sampling failed"),
							"surface",
							task,
						);
					await reply;
				} catch (error) {
					if (!disposed && !failureError)
						failFrame(
							error instanceof Error ? error : Error("Particle sampler failed"),
							error instanceof ParticleProtocolError ? "protocol" : "surface",
						);
				} finally {
					clearTimeout(task.timer);
					sampling.delete(request.id);
					active.delete(request.id);
				}
			});
			track(job);
		} catch (error) {
			failFrame(
				error instanceof Error ? error : Error("Particle request failed"),
				"protocol",
			);
		}
	};
	const dispose = () =>
		(cleanup ??= (async () => {
			disposed = true;
			clearTimeout(frameTimer);
			unsubscribe();
			signal.removeEventListener("abort", abort);
			for (const task of active.values()) {
				clearTimeout(task.timer);
				task.controller.abort(Error("Particle broker disposed"));
			}
			const terminate = Promise.resolve().then(terminateSampler);
			const remove = Promise.resolve().then(async () => {
				// An uncertain addBinding remains owned until its outcome/cleanup settles.
				await pendingBinding?.catch(() => {});
				if (bindingAdded)
					await browser.send(
						"Runtime.removeBinding",
						{ name: PARTICLE_BINDING_NAME },
						session,
					);
			});
			try {
				const results = await particleDeadline(
					Promise.allSettled([...jobs, terminate, remove]),
					cleanupTimeoutMs,
				);
				const rejected = results.find((result) => result.status === "rejected");
				if (rejected?.status === "rejected")
					throw Error("Particle broker cleanup failed", {
						cause: rejected.reason,
					});
				owned!.delete(session);
				reservation.close();
			} catch (error) {
				const failure =
					error instanceof Error
						? error
						: Error("Particle broker cleanup failed");
				failFrame(failure, "cancelled");
				// Retain session ownership on uncertain cleanup; caller must close its browser.
				throw failure;
			}
		})());
	try {
		frameTimer = setTimeout(
			() => failFrame(Error("Particle host frame timed out"), "cancelled"),
			policy.frameTimeoutMs,
		);
		signal.throwIfAborted();
		unsubscribe = browser.onEvent(event);
		signal.addEventListener("abort", abort, { once: true });
		pendingBinding = Promise.resolve().then(async () => {
			await browser.send(
				"Runtime.addBinding",
				{ name: PARTICLE_BINDING_NAME, executionContextId },
				session,
			);
			bindingAdded = true;
		});
		await Promise.race([pendingBinding, failure]);
		if (signal.aborted) {
			abort();
			signal.throwIfAborted();
		}
	} catch (error) {
		await dispose();
		throw error;
	}
	return {
		/** Rejects immediately on frame failure, even if a sampler ignores abort. */
		failure,
		get retainedPayloadBytes() {
			return reservation.retainedBytes;
		},
		async check() {
			if (failureError) throw failureError;
			if (disposed) throw Error("Particle broker is disposed");
			while (jobs.size) await Promise.race([Promise.all([...jobs]), failure]);
			if (failureError) throw failureError;
			if (disposed) throw Error("Particle broker is disposed");
		},
		dispose,
	};
}
