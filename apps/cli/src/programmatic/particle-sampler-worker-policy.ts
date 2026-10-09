import type { ParticlePolicy } from "./particle-policy";

export interface ParticleSamplerWorkerPolicy {
	maxRequestJsonBytes: number;
	maxResponseJsonBytes: number;
	maxRequestEnvelopeBytes: number;
	maxResponseEnvelopeBytes: number;
	maxRequestsPerFrame: number;
	maxPendingRequests: number;
	requestTimeoutMs: number;
	initTimeoutMs: number;
	terminationTimeoutMs: number;
}
const KEYS = [
	"maxRequestJsonBytes",
	"maxResponseJsonBytes",
	"maxRequestEnvelopeBytes",
	"maxResponseEnvelopeBytes",
	"maxRequestsPerFrame",
	"maxPendingRequests",
	"requestTimeoutMs",
	"initTimeoutMs",
	"terminationTimeoutMs",
] as const;

export function snapshotParticleWorkerPolicy(
	policy: ParticleSamplerWorkerPolicy,
) {
	const copy = Object.freeze({ ...policy });
	if (
		Object.keys(copy).length !== KEYS.length ||
		KEYS.some((key) => !Number.isSafeInteger(copy[key]) || copy[key] < 1) ||
		copy.maxPendingRequests > copy.maxRequestsPerFrame ||
		copy.maxRequestJsonBytes > copy.maxRequestEnvelopeBytes ||
		copy.maxResponseJsonBytes > copy.maxResponseEnvelopeBytes ||
		[copy.requestTimeoutMs, copy.initTimeoutMs, copy.terminationTimeoutMs].some(
			(n) => n > 0x7fff_ffff,
		) ||
		!Number.isSafeInteger(
			copy.maxPendingRequests * copy.maxRequestJsonBytes +
				copy.maxResponseJsonBytes,
		)
	)
		throw Error("Particle sampler worker: invalid explicit policy");
	return copy;
}
export function particleWorkerPolicy(
	host: ParticlePolicy,
): Readonly<ParticleSamplerWorkerPolicy> {
	return snapshotParticleWorkerPolicy({
		maxRequestJsonBytes: host.maxRequestJsonBytes,
		maxResponseJsonBytes: host.maxResponseJsonBytes,
		maxRequestEnvelopeBytes: host.maxRequestEnvelopeBytes,
		maxResponseEnvelopeBytes: host.maxResponseEnvelopeBytes,
		maxRequestsPerFrame: host.maxRequestsPerFrame,
		maxPendingRequests: host.process.maxPendingRequests,
		requestTimeoutMs: host.requestTimeoutMs,
		initTimeoutMs: host.process.initTimeoutMs,
		terminationTimeoutMs: host.process.terminationTimeoutMs,
	});
}
export function validParticleText(
	value: unknown,
	limit: number,
): value is string {
	if (typeof value !== "string" || value.length > limit) return false;
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const low = value.charCodeAt(++i);
			if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
		} else if (code >= 0xdc00 && code <= 0xdfff) return false;
	}
	return Buffer.byteLength(value, "utf8") <= limit;
}
