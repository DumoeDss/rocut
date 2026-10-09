import { createHash } from "node:crypto";
import {
	deriveParticleTransportPolicy,
	type ParticlePolicyOverrides,
} from "./particle-policy";
import { createParticleSamplerWorkerCore } from "./particle-sampler-worker-core";
import { particleWorkerPolicy } from "./particle-sampler-worker-policy";
import type { spawnParticleSamplerProcess } from "./particle-sampler-worker-process";

function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(Error("Particle policy initialization timed out")),
			milliseconds,
		);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(reason) => {
				clearTimeout(timer);
				reject(reason);
			},
		);
	});
}
export function validateParticleBootstrapTimeout(timeout: number): void {
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000)
		throw Error("Particle bootstrap requires an explicit bounded deadline");
}

/** Internal host seam. Policy getter/import execution stays inside the killable process. */
export async function bootstrapParticleSamplerProcess(
	spawned: ReturnType<typeof spawnParticleSamplerProcess>,
	bootstrapTimeoutMs: number,
	overrides?: ParticlePolicyOverrides,
	signal?: AbortSignal,
) {
	const ignoreObservedError = () => {};
	spawned.port.on("error", ignoreObservedError);
	let rejectAbort!: (reason: Error) => void;
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = reject;
	});
	void aborted.catch(() => {});
	const abort = () =>
		rejectAbort(Error("Particle policy initialization aborted"));
	signal?.addEventListener("abort", abort, { once: true });
	try {
		validateParticleBootstrapTimeout(bootstrapTimeoutMs);
		signal?.throwIfAborted();
		const { policy: published, json: publishedPolicyJson } = await bounded(
			Promise.race([spawned.discovered, aborted]),
			bootstrapTimeoutMs,
		);
		const transportPolicy = overrides
			? deriveParticleTransportPolicy(published, overrides)
			: published;
		const policyJson = JSON.stringify(transportPolicy);
		const worker = createParticleSamplerWorkerCore(
			particleWorkerPolicy(transportPolicy.hostDefaults),
			() => spawned.port,
		);
		try {
			spawned.activate(transportPolicy);
		} catch (error) {
			await worker.terminateSampler();
			throw error;
		}
		const captureAbort = () => {
			void worker.terminateSampler().catch(() => {});
		};
		signal?.addEventListener("abort", captureAbort, { once: true });
		if (signal?.aborted) captureAbort();
		return {
			...worker,
			terminateSampler() {
				signal?.removeEventListener("abort", captureAbort);
				return worker.terminateSampler();
			},
			policy: transportPolicy.hostDefaults,
			transportPolicy,
			publishedPolicyJson,
			policyJson,
			publishedPolicyHash: createHash("sha256")
				.update(publishedPolicyJson)
				.digest("hex"),
			policyHash: createHash("sha256").update(policyJson).digest("hex"),
		};
	} catch (reason) {
		try {
			await bounded(spawned.port.terminate(), bootstrapTimeoutMs);
		} catch (cleanup) {
			throw new AggregateError(
				[reason, cleanup],
				"Particle policy initialization and confirmed termination failed",
			);
		}
		throw reason;
	} finally {
		spawned.port.off("error", ignoreObservedError);
		signal?.removeEventListener("abort", abort);
	}
}
