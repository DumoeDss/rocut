import { createParticleClient } from "./particle-client";
import type { ParticlePageConfig } from "./particle-page-contract";
import { snapshotParticlePolicy } from "./particle-policy";
import type { ThreeSurfaceObject } from "./engines/three-surface-extract";
import {
	prepareParticleSurface,
	type ParticleSurfaceOptions,
} from "./particle-surface-preparation";
export type { ParticleSurfaceOptions } from "./particle-surface-preparation";

/** Browser adaptation only: static extraction, correlation and GPU packing.
 * Sampling, geometry weights and randomness remain in the Rust sampler. */
export function createParticlePageRuntime(
	config: ParticlePageConfig,
	mappedFrame: unknown,
	send: (json: string) => void | Promise<void>,
) {
	if (config?.version !== 1) throw Error("Invalid particle page configuration");
	const frame = JSON.parse(JSON.stringify(mappedFrame)) as Record<
		string,
		unknown
	>;
	if (
		!frame ||
		!Number.isSafeInteger(frame.index) ||
		(frame.index as number) < 0 ||
		!Number.isSafeInteger(frame.seed) ||
		(frame.seed as number) < 0 ||
		(frame.seed as number) > 0xffff_ffff
	)
		throw Error("Particle frame requires the Rust mapped index and seed");
	Object.freeze(frame);
	const policy = snapshotParticlePolicy(config.policy);
	const controller = new AbortController();
	const client = createParticleClient({
		identity: config.identity,
		policy,
		requestTimeoutMs: config.requestTimeoutMs,
		signal: controller.signal,
		send,
	});
	let phase: "idle" | "sampling" | "closed" | "disposed" = "idle";
	let pending = 0;
	let terminal: Error | undefined;
	let rejectFailure!: (reason: Error) => void;
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	void failure.catch(() => {});
	const fail = (cause: unknown): Error => {
		const error = cause instanceof Error ? cause : Error(String(cause));
		if (!terminal) {
			terminal = error;
			rejectFailure(error);
			controller.abort(error);
		}
		return terminal;
	};
	void client.failure.catch((error: unknown) => {
		if (phase !== "disposed") fail(error);
	});
	const checkTerminal = () => {
		if (terminal) throw terminal;
	};
	const particles = Object.freeze({
		sampleSurface(root: ThreeSurfaceObject, options: ParticleSurfaceOptions) {
			const sample = async () => {
				checkTerminal();
				if (phase !== "sampling")
					throw Error("Particle sampling is outside particleFrame");
				const prepared = prepareParticleSurface(root, options, frame, policy);
				const response = await client.sample(prepared.requestJson);
				checkTerminal();
				if (phase !== "sampling")
					throw Error("Particle sample completed after the sampling phase");
				return prepared.finish(response);
			};
			pending++;
			const result = sample()
				.catch((error: unknown) => {
					throw fail(error);
				})
				.finally(() => {
					pending--;
				});
			// A forgotten promise still fails the frame through failure; do not
			// depend on browser unhandledrejection timing for admission.
			void result.catch(() => {});
			return result;
		},
	});
	let cleanup: (() => void | Promise<void>) | undefined;
	let cleanupPromise: Promise<void> | undefined;
	return Object.freeze({
		frame,
		failure,
		receive: client.receive,
		registerCleanup(callback: () => void | Promise<void>) {
			if (cleanup || phase === "disposed")
				throw fail(Error("Particle cleanup owner already set or closed"));
			cleanup = callback;
		},
		async runPhase(
			callback: (input: {
				frame: typeof frame;
				particles: typeof particles;
			}) => unknown,
		) {
			try {
				checkTerminal();
				if (phase !== "idle" || typeof callback !== "function")
					throw Error("Three particleFrame hook is required exactly once");
				phase = "sampling";
				await Promise.race([
					Promise.resolve(callback({ frame, particles })),
					failure,
				]);
				if (pending)
					throw Error(
						"Particle sampling is still pending when particleFrame returned",
					);
				phase = "closed";
				await client.check();
				checkTerminal();
			} catch (error) {
				if (phase !== "disposed") phase = "closed";
				throw fail(error);
			}
		},
		async check() {
			checkTerminal();
			if (phase !== "closed" || pending)
				throw fail(Error("Particle frame is not settled"));
			await client.check();
			checkTerminal();
		},
		cleanup() {
			if (cleanupPromise) return cleanupPromise;
			// Synchronous phase closure and cancellation precede any author
			// disposal await or acknowledgement delivered to the outer page.
			phase = "disposed";
			client.dispose();
			const disposed = Error("Particle page disposed");
			controller.abort(disposed);
			rejectFailure(disposed);
			const ownership = Promise.resolve().then(async () => {
				let cleanupError: unknown;
				let cleanupFailed = false;
				try {
					await cleanup?.();
				} catch (error) {
					cleanupFailed = true;
					cleanupError = error;
				}
				if (terminal && cleanupFailed)
					throw new AggregateError(
						[terminal, cleanupError],
						"Particle page and cleanup failed",
						{ cause: terminal },
					);
				if (cleanupFailed) throw cleanupError;
				if (terminal) throw terminal;
			});
			cleanupPromise = new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() =>
						reject(
							Error(
								"Particle page cleanup timed out with unfinished ownership",
							),
						),
					policy.cleanupTimeoutMs,
				);
				// Keep the actual ownership task alive after timeout so late scene
				// owners are still disposed, but never acknowledge them as complete.
				ownership.then(
					() => {
						clearTimeout(timer);
						resolve();
					},
					(error) => {
						clearTimeout(timer);
						reject(error);
					},
				);
			});
			return cleanupPromise;
		},
	});
}
