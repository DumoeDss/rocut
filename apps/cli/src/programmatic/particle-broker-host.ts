import {
	attachParticleBroker,
	type ParticleBrokerOptions,
} from "./particle-broker";
import { createParticleSamplerWorker } from "./particle-sampler-worker";
import type { ParticleSamplerIdentity } from "./particle-sampler-identity";
import { snapshotParticleFrameConstraint } from "./particle-motion-contract";

/** Host-owned assembly. The page receives this exact policy, never chooses the WASM path. */
export async function attachParticleSamplerFrame(
	options: Omit<
		ParticleBrokerOptions,
		| "policy"
		| "sampler"
		| "terminateSampler"
		| "cleanupTimeoutMs"
		| "expectedFrame"
	> & {
		mappedFrame: unknown;
		bootstrapTimeoutMs: number;
		expectedIdentity?: ParticleSamplerIdentity;
	},
) {
	const expectedFrame = snapshotParticleFrameConstraint(options.mappedFrame);
	const worker = await createParticleSamplerWorker({
		bootstrapTimeoutMs: options.bootstrapTimeoutMs,
		signal: options.signal,
		expectedIdentity: options.expectedIdentity,
	});
	const capture = new AbortController();
	const abort = () => capture.abort(options.signal.reason);
	options.signal.addEventListener("abort", abort, { once: true });
	if (options.signal.aborted) abort();
	void worker.failure.catch((error: unknown) => capture.abort(error));
	try {
		await worker.ready;
		const broker = await attachParticleBroker({
			...options,
			expectedFrame,
			signal: capture.signal,
			policy: worker.policy,
			cleanupTimeoutMs: worker.policy.cleanupTimeoutMs,
			sampler: worker.sampler,
			terminateSampler: worker.terminateSampler,
		});
		const failure = Promise.race([broker.failure, worker.failure]);
		void failure.catch(() => {});
		return {
			...broker,
			failure,
			get retainedPayloadBytes() {
				return broker.retainedPayloadBytes;
			},
			dispose() {
				options.signal.removeEventListener("abort", abort);
				return broker.dispose();
			},
			async check() {
				await Promise.race([broker.check(), failure]);
				worker.check();
			},
			policy: worker.policy,
			transportPolicy: worker.transportPolicy,
			policyJson: worker.policyJson,
			policyHash: worker.policyHash,
			publishedPolicyHash: worker.publishedPolicyHash,
			samplerIdentity: worker.samplerIdentity,
		};
	} catch (error) {
		options.signal.removeEventListener("abort", abort);
		try {
			await worker.terminateSampler();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"Particle frame initialization and cleanup failed",
				{ cause: error },
			);
		}
		throw error;
	}
}
