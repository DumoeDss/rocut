import {
	parseLiquidTransportPolicy,
	type LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-publication";
import { ELECTRON_PARTICLE_LIMITS as limits } from "./electron-particle-protocol";
export const ELECTRON_LIQUID_LIMITS = Object.freeze({
	...limits,
	maxParticleEventOrReplyRawBytes: 33554432,
	maxQueuedEventRawBytes: 33554432,
	maxTransportRetainedParticlePayloadBytesPerSession: 134217728,
});

/** Admission compares the archived Rust publication without narrowing its policy. */
export function assertElectronLiquidPolicyFit(
	value: LiquidTransportPolicy,
): void {
	const policy = parseLiquidTransportPolicy(JSON.stringify(value));
	const limits = ELECTRON_LIQUID_LIMITS;
	const reservation =
		policy.maxEncodedBytesPerFrame + 4 * policy.maxControlJsonBytes;
	if (
		policy.maxRequestEnvelopeBytes > limits.maxParticleEventOrReplyRawBytes ||
		policy.maxResponseEnvelopeBytes > limits.maxParticleEventOrReplyRawBytes ||
		policy.maxControlJsonBytes > limits.maxParticleEventOrReplyRawBytes ||
		policy.maxRetainedPayloadBytesPerFrame >
			limits.maxTransportRetainedParticlePayloadBytesPerSession ||
		!Number.isSafeInteger(reservation) ||
		reservation > limits.maxTransportRetainedParticlePayloadBytesPerSession ||
		policy.maxInFlight !== 1 ||
		policy.frameTimeoutMs > 30000 ||
		policy.initTimeoutMs > 5000 ||
		policy.cleanupTimeoutMs > limits.cleanupTimeoutMs ||
		5000 +
			policy.initTimeoutMs +
			policy.frameTimeoutMs +
			policy.cleanupTimeoutMs >
			limits.sessionTimeoutMs
	)
		throw Error(
			"Archived Liquid policy does not fit the Electron transport; explicitly recompile for a supported profile",
		);
}
