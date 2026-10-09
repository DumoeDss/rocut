import {
	attachParticleBroker,
	type ParticleBrokerOptions,
} from "../programmatic/particle-broker";
import type { ParticleMotion } from "../programmatic/particle-motion-contract";
import {
	fakeBrowser,
	identity,
	policy,
	requestJson,
	sample,
} from "./particle-broker-test-support";

export const mappedFrame = Object.freeze({ seed: 42, sourceTime: 48_048 });
export const motion = (): ParticleMotion => ({
	version: 1,
	timeTicks: mappedFrame.sourceTime,
	scatterStartTicks: 4004,
	scatterDurationTicks: 12_012,
	holdDurationTicks: 8008,
	returnDurationTicks: 12_012,
	scatterDistance: 2,
	driftAmplitude: 0.1,
	driftFrequency: 1,
	size: 1,
	sizeVariance: 0.2,
});
export function data(changes: Record<string, unknown> = {}) {
	return { ...JSON.parse(requestJson), motion: motion(), ...changes };
}
export const wire = (value: unknown) =>
	sample(1, { requestJson: JSON.stringify(value) });

/** A fail-if-called admission observer, not a replacement Rust sampler. Every
 * negative test must reject before this callback can execute. */
export async function negativeBroker(
	options: Partial<ParticleBrokerOptions> = {},
) {
	const transport = fakeBrowser();
	const controller = new AbortController();
	let sampled = 0;
	const broker = await attachParticleBroker({
		browser: transport.browser,
		session: "cdp-session",
		executionContextId: 17,
		identity,
		policy,
		expectedFrame: mappedFrame,
		signal: controller.signal,
		cleanupTimeoutMs: 1000,
		sampler: async () => {
			sampled++;
			throw Error("Unexpected sampler admission in a negative test");
		},
		terminateSampler: async () => {},
		...options,
	});
	return { ...transport, broker, sampled: () => sampled };
}
