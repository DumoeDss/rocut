import assert from "node:assert/strict";
import * as wasm from "opencut-wasm";
import { prepareHyperframesRateAudio } from "../../apps/cli/src/programmatic/hyperframes-rate-prepare";
import type { HyperframesGraphStagePlan } from "../../apps/cli/src/programmatic/hyperframes-graph-kernels";
import type { NativeVideoDecoder } from "../../apps/cli/src/programmatic/video-decoder";
import {
	graphRatePcm,
	type FractionalNative,
} from "./hyperframes-fractional-phase-media";
import type { VariableRateCase } from "./hyperframes-variable-rate-cases";
import {
	digest,
	pcmDifference,
	type readNativePreparedWav,
} from "./hyperframes-variable-rate-io";
import { LOOP_TEST_FX } from "./hyperframes-variable-rate-loop-graph";
import type { RateLane } from "./hyperframes-variable-rate-native";
import type { RatePreparationVerification } from "./hyperframes-variable-rate-production-case";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";

export function durationPlan(request: unknown) {
	const response = JSON.parse(
		wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify(request)),
	) as {
		plan?: HyperframesGraphStagePlan;
		error?: string;
	};
	assert.equal(response.error, undefined);
	assert.ok(response.plan);
	return response.plan;
}

/** Independent expected PCM retains the original prepared WAV's actual length.
 * No production recipe, fixed declaration length or Rust clock builds this oracle. */
export async function verifyDurationPreparation({
	oracle,
	body,
	test,
	rate,
	sampleRate,
	reference,
	decoder,
	signal,
}: {
	oracle: FractionalNative;
	body: Buffer;
	test: VariableRateCase;
	rate: RateLane;
	sampleRate: number;
	reference: Awaited<ReturnType<typeof readNativePreparedWav>> & {
		path: string;
	};
	decoder: NativeVideoDecoder;
	signal: AbortSignal;
}) {
	const fixture = variableRateGraphFixture(
		body,
		"audio/wav",
		test,
		rate,
		sampleRate,
		LOOP_TEST_FX,
	);
	const pending = durationPlan(fixture.request);
	assert.equal(pending.pcmGeometryReady, false);
	const source = pending.decodedSources[0],
		recipe = source.ratePreparation;
	assert.ok(recipe?.observedPcm);
	assert.equal(source.frames, null);
	assert.equal(source.pcmBytes, null);
	assert.equal(pending.tracks[0].fxStage, null);
	assert.equal(recipe.durationSeconds, String(test.duration));
	assert.equal(
		recipe.sourceDurationSeconds,
		String(oracle.speed.sourceTimeAt(rate, test.duration)),
	);
	assert.equal(recipe.mediaStartSeconds, String(test.mediaStart));
	assert.equal(
		recipe.stereoFilter,
		oracle.native.buildRampFilterComplex(rate, test.duration, null),
	);
	assert.equal(
		recipe.monoFilter,
		oracle.native.buildRampFilterComplex(
			rate,
			test.duration,
			"pan=stereo|FL=FL+FC|FR=FR+FC",
		),
	);
	assert.equal(recipe.resampleFilter, `aresample=${sampleRate}`);
	const actual = await prepareHyperframesRateAudio({
		decoder,
		body,
		mimeType: "audio/wav",
		sampleRate,
		frames: source.frames,
		recipe,
		signal,
	});
	assert.equal(actual.nativeFrames, reference.frames);
	const expected = await graphRatePcm(
		decoder.ffmpeg,
		reference.path,
		sampleRate,
	);
	assert.equal(actual.pcm.length, expected.length);
	const comparison = pcmDifference(expected, actual.pcm);
	assert.equal(comparison.maximum, 0);
	const finalizedRequest = {
		...fixture.request,
		decodedSourceObservations: [
			{
				decodedSourceId: source.id,
				preparationKey: source.preparationKey,
				nativeFrames: actual.nativeFrames,
				frames: actual.pcm.length / 8,
			},
		],
	};
	const plan = durationPlan(finalizedRequest);
	assert.equal(plan.pcmGeometryReady, true);
	assert.equal(plan.decodedSources[0].frames, expected.length / 8);
	assert.equal(plan.tracks[0].fxStage?.inputFrames, expected.length / 8);
	assert.equal(plan.decodedSources[0].maxFrames, source.maxFrames);
	const prepared = {
		fixture,
		expected,
		plan,
		summary: {
			name: test.id,
			sampleRate,
			hasAudio: true,
			frames: expected.length / 8,
			maximumError: comparison.maximum,
			rmsError: comparison.rms,
			expectedSha256: digest(expected),
			actualSha256: digest(actual.pcm),
			nativePcm16: reference.format,
			stereoAndMonoFilterMatch: true,
			abortedBeforeIo: false,
			nativeFrames: actual.nativeFrames,
			capacityFrames: source.maxFrames,
			declaredDuration: test.duration,
			semanticCoverageCeil: Math.ceil(test.duration * sampleRate),
		},
	};
	return prepared satisfies RatePreparationVerification;
}
