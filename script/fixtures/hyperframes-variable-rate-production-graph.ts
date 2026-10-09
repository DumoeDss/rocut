import assert from "node:assert/strict";
import * as wasm from "opencut-wasm";
import type { HyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-types";
import { renderHyperframesGraphStages } from "../../apps/cli/src/programmatic/hyperframes-graph-render";
import type { NativeVideoDecoder } from "../../apps/cli/src/programmatic/video-decoder";
import type { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { fixtureAdd, fixtureGain } from "./hyperframes-graph-chain-fixture";
import { digest, pcmDifference } from "./hyperframes-variable-rate-io";
import {
	RATE_TEST_FX,
	type RatePreparationVerification,
} from "./hyperframes-variable-rate-production-case";

/** Native core FX independently renders original-prepared PCM; only placement
 * and gain arithmetic are fixture-owned. No production Rust kernel is the oracle. */
export async function rateGraphExpected(
	oracle: Awaited<ReturnType<typeof createFxAutomationOracle>>,
	prepared: RatePreparationVerification,
) {
	const { fixture, expected, summary } = prepared;
	const request = {
		sampleRate: summary.sampleRate,
		chain: { version: 1 as const, nodes: RATE_TEST_FX },
	};
	const native = await oracle.render(request, expected);
	assert.equal(native.pcm.length, expected.length, "Saturate has no tail");
	const output = Buffer.alloc(
		Math.round(
			(fixture.request.graph.durationFrames * summary.sampleRate) / 100,
		) * 8,
	);
	fixtureAdd(
		output,
		fixtureGain(native.pcm, () => fixture.gain),
		Math.round(fixture.start * summary.sampleRate),
	);
	const wrong = await oracle.render(
		request,
		fixtureGain(expected, () => fixture.gain),
	);
	const wrongOrder = pcmDifference(
		fixtureGain(native.pcm, () => fixture.gain),
		wrong.pcm,
	);
	if (summary.hasAudio)
		assert.ok(
			wrongOrder.maximum > 0.001,
			"Pre-FX fader must be an observable wrong-order control",
		);
	return { output, wrongOrder, nativeSha256: native.sha256 };
}

export async function verifyRateGraph(
	prepared: RatePreparationVerification,
	expected: Awaited<ReturnType<typeof rateGraphExpected>>,
	executor: HyperframesFxExecutor,
	decoder: NativeVideoDecoder,
	signal: AbortSignal,
	repeated = false,
) {
	const { fixture, summary } = prepared;
	const input = { ...fixture, kernels: wasm, executor, decoder, signal };
	const full = await renderHyperframesGraphStages(input);
	const difference = pcmDifference(expected.output, full.pcm);
	assert.ok(
		difference.maximum < 2e-6,
		`${summary.name} native nonlinear FX + Rust fader/mix`,
	);
	assert.equal(full.sampleOrigin, 0);
	assert.equal(full.hasAudio, summary.hasAudio);
	const cropRequest = structuredClone(fixture.request);
	cropRequest.graph.firstFrame = 37;
	cropRequest.graph.frameCount = 11;
	const cropped = await renderHyperframesGraphStages({
		...input,
		request: cropRequest,
	});
	const firstSample = Math.round(0.37 * summary.sampleRate),
		lastSample = Math.round(0.48 * summary.sampleRate);
	assert.equal(cropped.sampleOrigin, firstSample);
	assert.equal(
		cropped.pcm.equals(full.pcm.subarray(firstSample * 8, lastSample * 8)),
		true,
		"Crop must rerender complete preparation/FX history before slicing",
	);
	if (repeated) {
		const again = await renderHyperframesGraphStages(input);
		assert.equal(
			again.pcm.equals(full.pcm),
			true,
			"Repeated complete render remains deterministic",
		);
		const changed = Buffer.from(fixture.sources[0].body);
		changed[50] ^= 1;
		await assert.rejects(
			renderHyperframesGraphStages({
				...input,
				sources: [{ ...fixture.sources[0], body: changed }],
			}),
			/source bytes changed/,
		);
		const invalid = structuredClone(fixture.request);
		invalid.graph.sources[0].byteLength--;
		await assert.rejects(
			renderHyperframesGraphStages({ ...input, request: invalid }),
			/source geometry/,
		);
	}
	return {
		...summary,
		graphMaximumError: difference.maximum,
		graphRmsError: difference.rms,
		graphSha256: digest(full.pcm),
		cropExact: true,
		repeated,
		wrongOrder: expected.wrongOrder,
		boundary:
			"Real Host graph stages with trusted test declarations, not browser collection or Electron transport.",
	};
}
