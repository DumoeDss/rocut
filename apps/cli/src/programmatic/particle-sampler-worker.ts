import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawnParticleSamplerProcess } from "./particle-sampler-worker-process";
import {
	bootstrapParticleSamplerProcess,
	validateParticleBootstrapTimeout,
} from "./particle-sampler-worker-bootstrap";
import { captureParticleSamplerSource } from "./particle-sampler-identity-source";
import {
	assertParticleSamplerIdentity,
	completeParticleSamplerIdentity,
	snapshotParticleSamplerIdentity,
} from "./particle-sampler-identity";
export type {
	ParticleSamplerWorker,
	ParticleSamplerWorkerPolicy,
} from "./particle-sampler-worker-core";

/** Host-only factory: no page-controlled path, module, operation, or env fallback.
 * Source resolves the trusted package; pack-runtime replaces the unique meta
 * property with one fixed sibling-module literal and ships both sidecars.
 * Missing packaged files fail initialization, never fall back to source deps.
 */
export async function createParticleSamplerWorker(options: {
	bootstrapTimeoutMs: number;
	signal?: AbortSignal;
	expectedIdentity?: unknown;
}) {
	validateParticleBootstrapTimeout(options.bootstrapTimeoutMs);
	options.signal?.throwIfAborted();
	const packedModule = (
		import.meta as ImportMeta & {
			readonly __ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__?: string;
		}
	).__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__;
	if (
		packedModule !== undefined &&
		packedModule !== "./particle-sampler-wasm.mjs"
	) {
		throw Error("Invalid compiled particle sampler module literal");
	}
	const moduleUrl =
		packedModule === undefined
			? pathToFileURL(
					createRequire(import.meta.url).resolve("opencut-wasm/sync"),
				).href
			: new URL(packedModule, import.meta.url).href;
	const captured = captureParticleSamplerSource({
		moduleUrl,
		workerEntryUrl: new URL(
			"./particle-sampler-worker-entry.mjs",
			import.meta.url,
		).href,
		layout: packedModule === undefined ? "source-sync" : "packed-sidecar",
	});
	const expected =
		options.expectedIdentity === undefined
			? undefined
			: snapshotParticleSamplerIdentity(options.expectedIdentity);
	if (expected)
		assertParticleSamplerIdentity(
			expected,
			completeParticleSamplerIdentity(captured.identityBase, expected),
		);
	options.signal?.throwIfAborted();
	const worker = await bootstrapParticleSamplerProcess(
		spawnParticleSamplerProcess(captured.moduleUrl, undefined, captured),
		options.bootstrapTimeoutMs,
		undefined,
		options.signal,
	);
	try {
		const samplerIdentity = completeParticleSamplerIdentity(
			captured.identityBase,
			worker,
		);
		if (expected) assertParticleSamplerIdentity(expected, samplerIdentity);
		return {
			...worker,
			samplerIdentity,
		};
	} catch (error) {
		await worker.terminateSampler();
		throw error;
	}
}
