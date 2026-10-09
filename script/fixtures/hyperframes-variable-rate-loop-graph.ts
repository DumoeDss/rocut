import assert from "node:assert/strict";
import type { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { fixtureAdd, fixtureGain } from "./hyperframes-graph-chain-fixture";
import { pcmDifference } from "./hyperframes-variable-rate-io";
import type { RatePreparationVerification } from "./hyperframes-variable-rate-production-case";

export const LOOP_TEST_FX = [
	{ type: "saturate", params: { threshold: -20 } },
	{ type: "delay", params: { time: 70, feedback: 0.25, mix: 0.7 } },
];

/** Original native stateful FX processes the independently prepared full clip
 * exactly once. Fixture-owned fader/placement do not use a production kernel. */
export async function loopGraphExpected(
	oracle: Awaited<ReturnType<typeof createFxAutomationOracle>>,
	prepared: RatePreparationVerification,
) {
	const { fixture, expected, summary } = prepared;
	const request = {
		sampleRate: summary.sampleRate,
		chain: { version: 1 as const, nodes: LOOP_TEST_FX },
	};
	const native = await oracle.render(request, expected);
	assert.ok(
		native.pcm.length > expected.length,
		"Real delay history/tail must be exercised",
	);
	const gained = fixtureGain(native.pcm, () => fixture.gain);
	const output = Buffer.alloc(
		Math.round(
			(fixture.request.graph.durationFrames * summary.sampleRate) / 100,
		) * 8,
	);
	fixtureAdd(output, gained, Math.round(fixture.start * summary.sampleRate));
	const wrong = await oracle.render(
		request,
		fixtureGain(expected, () => fixture.gain),
	);
	const wrongOrder = pcmDifference(gained, wrong.pcm);
	assert.ok(
		wrongOrder.maximum > 0.001,
		"Fader before nonlinear FX must remain an observable error",
	);
	return {
		output,
		wrongOrder,
		nativeSha256: native.sha256,
		nativeFrames: native.frames,
	};
}
