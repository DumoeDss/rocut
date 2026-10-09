import {
	ParticleProtocolError,
	parseParticleReplyEnvelope,
	parseParticleRequest,
	parseParticleResponse,
	validateParticlePolicy,
	type ParticleIdentity,
	type ParticlePolicy,
	type ParticleSampleRequest,
} from "./particle-protocol";
import {
	createParticleFrameReservation,
	snapshotParticlePolicy,
} from "./particle-policy";

export interface ParticleClientOptions {
	identity: ParticleIdentity;
	policy: ParticlePolicy;
	signal: AbortSignal;
	requestTimeoutMs: number;
	/** A fixed host binding, never a page-selected URL or arbitrary RPC. */
	send(json: string): void | Promise<void>;
}

export class ParticleSurfaceError extends Error {
	constructor(readonly responseJson: string) {
		super("Rust particle surface sampling failed");
		this.name = "ParticleSurfaceError";
	}
}

type Pending = {
	request: ParticleSampleRequest;
	resolve(value: string): void;
	reject(error: Error): void;
	clear(): void;
};

/** Browser-side correlation only. The host independently owns authorization,
 * worker termination and admission. The frame driver must race failure with
 * author evaluation, await check(), and dispose the client on every capture exit.
 */
export function createParticleClient(options: ParticleClientOptions) {
	const { signal, send, requestTimeoutMs } = options;
	const identity = Object.freeze({ ...options.identity });
	const policy = snapshotParticlePolicy(options.policy);
	validateParticlePolicy(policy);
	if (
		!Number.isSafeInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1 ||
		requestTimeoutMs > policy.requestTimeoutMs ||
		typeof send !== "function"
	)
		throw new ParticleProtocolError(
			"Invalid particle client transport or deadline",
		);
	const envelope = (id: number) => ({
		...identity,
		version: 1 as const,
		operation: "particleSurface" as const,
		id,
	});
	parseParticleRequest(
		JSON.stringify({ ...envelope(1), kind: "cancel" }),
		identity,
		policy,
	);
	const pending = new Map<number, Pending>();
	const reservation = createParticleFrameReservation(policy);
	const deliveries = new Map<Promise<void>, () => void>();
	let nextId = 1,
		terminal: Error | undefined;
	let rejectFailure!: (error: Error) => void;
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	void failure.catch(() => {});
	let frameTimer: ReturnType<typeof setTimeout> | undefined;
	const stop = (error: Error, cancel = true) => {
		if (terminal) return;
		terminal = error;
		clearTimeout(frameTimer);
		signal.removeEventListener("abort", abort);
		const id = pending.keys().next().value;
		for (const item of pending.values()) {
			item.clear();
			item.reject(error);
		}
		pending.clear();
		for (const cancel of deliveries.values()) cancel();
		rejectFailure(error);
		// A single known active id cancels the complete frame in the host broker.
		if (cancel && id !== undefined) {
			try {
				void Promise.resolve(
					send(JSON.stringify({ ...envelope(id), kind: "cancel" })),
				).catch(() => {});
			} catch {
				/* The frame is already failed; cancellation is best effort. */
			}
		}
	};
	const abort = () => stop(Error("Particle capture aborted"));
	frameTimer = setTimeout(
		() => stop(Error("Particle frame timed out")),
		policy.frameTimeoutMs,
	);
	if (signal.aborted) abort();
	else signal.addEventListener("abort", abort, { once: true });
	const dispatch = (wire: string) => {
		try {
			const delivery = send(wire);
			if (delivery === undefined) return;
			let clear!: () => void;
			const bounded = new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(Error("Particle transport acknowledgement timed out")),
					requestTimeoutMs,
				);
				clear = () => {
					clearTimeout(timer);
					resolve();
				};
				Promise.resolve(delivery).then(
					() => {
						clearTimeout(timer);
						resolve();
					},
					(error: unknown) => {
						clearTimeout(timer);
						reject(error);
					},
				);
			}).catch((error: unknown) =>
				stop(
					error instanceof Error ? error : Error("Particle transport failed"),
				),
			);
			deliveries.set(bounded, clear);
			void bounded.then(() => deliveries.delete(bounded));
			if (terminal) clear();
		} catch (error) {
			stop(error instanceof Error ? error : Error("Particle transport failed"));
		}
	};

	return {
		failure,
		sample(requestJson: string, requestSignal?: AbortSignal): Promise<string> {
			if (terminal) return Promise.reject(terminal);
			if (requestSignal?.aborted)
				return Promise.reject(Error("Particle request already aborted"));
			let request: ParticleSampleRequest, wire: string;
			try {
				if (
					typeof requestJson !== "string" ||
					requestJson.length > policy.maxRequestJsonBytes
				)
					throw new ParticleProtocolError(
						"Particle request exceeds its byte limit",
					);
				if (
					nextId > policy.maxRequestsPerFrame ||
					pending.size >= policy.maxInFlight
				)
					throw new ParticleProtocolError(
						"Particle client request limit exceeded",
					);
				wire = JSON.stringify({
					...envelope(nextId),
					kind: "sample",
					requestJson,
				});
				const parsed = parseParticleRequest(wire, identity, policy);
				if (parsed.kind !== "sample")
					throw new ParticleProtocolError("Expected sample request");
				request = parsed;
				reservation.reserve();
			} catch (error) {
				const reason =
					error instanceof Error ? error : Error("Invalid particle request");
				stop(reason);
				return Promise.reject(reason);
			}
			nextId++;
			return new Promise<string>((resolve, reject) => {
				const onAbort = () => stop(Error("Particle request aborted"));
				const timer = setTimeout(
					() => stop(Error("Particle request timed out")),
					requestTimeoutMs,
				);
				pending.set(request.id, {
					request,
					resolve,
					reject,
					clear() {
						clearTimeout(timer);
						requestSignal?.removeEventListener("abort", onAbort);
					},
				});
				requestSignal?.addEventListener("abort", onAbort, { once: true });
				dispatch(wire);
			});
		},
		receive(json: string): void {
			if (terminal) return;
			try {
				const reply = parseParticleReplyEnvelope(json, identity, policy);
				const item = pending.get(reply.id);
				if (!item)
					throw new ParticleProtocolError(
						"Unknown or replayed particle reply id",
					);
				const checked = parseParticleResponse(json, item.request, policy);
				if (!checked.ok) {
					stop(Error(checked.error.message), false);
					return;
				}
				const result = JSON.parse(checked.responseJson) as { ok: boolean };
				if (!result.ok) {
					stop(new ParticleSurfaceError(checked.responseJson), false);
					return;
				}
				item.clear();
				pending.delete(reply.id);
				item.resolve(checked.responseJson);
			} catch (error) {
				stop(
					error instanceof Error ? error : Error("Invalid particle response"),
				);
			}
		},
		async check(): Promise<void> {
			if (terminal) throw terminal;
			while (deliveries.size)
				await Promise.race([Promise.all(deliveries.keys()), failure]);
			if (terminal) throw terminal;
			if (pending.size) throw Error("Particle sampling is not complete");
		},
		dispose(): void {
			stop(Error("Particle client disposed"));
			reservation.close();
		},
	};
}
