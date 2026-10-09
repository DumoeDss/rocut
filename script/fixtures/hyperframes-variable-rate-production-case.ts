import assert from "node:assert/strict";
import * as wasm from "opencut-wasm";
import { prepareHyperframesRateAudio } from "../../apps/cli/src/programmatic/hyperframes-rate-prepare";
import type { HyperframesGraphStagePlan } from "../../apps/cli/src/programmatic/hyperframes-graph-kernels";
import type { NativeVideoDecoder } from "../../apps/cli/src/programmatic/video-decoder";
import type { VariableRateCase } from "./hyperframes-variable-rate-cases";
import { digest, pcmDifference } from "./hyperframes-variable-rate-io";
import type { RateLane } from "./hyperframes-variable-rate-native";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";
import {
	rateReferenceAtGraphRate,
	type RateOracle,
	type RateProductionMedia,
	type rateProductionReference,
} from "./hyperframes-variable-rate-production-media";

export const RATE_TEST_FX = [{ type: "saturate", params: { threshold: -20 } }];

export async function verifyRatePreparation({
	oracle,
	media,
	reference,
	test,
	rate,
	sampleRate,
	decoder,
	signal,
	loopSourceDuration,
	fxNodes = RATE_TEST_FX,
}: {
	oracle: RateOracle;
	media: RateProductionMedia;
	reference: Awaited<ReturnType<typeof rateProductionReference>>;
	test: VariableRateCase;
	rate: RateLane;
	sampleRate: number;
	decoder: NativeVideoDecoder;
	signal: AbortSignal;
	loopSourceDuration?: number;
	fxNodes?: unknown[];
}) {
	const fixture = variableRateGraphFixture(
		media.body,
		media.mimeType,
		test,
		rate,
		sampleRate,
		fxNodes,
	);
	if (loopSourceDuration !== undefined) {
		fixture.request.graph.snapshot.tracks[0].native.loop = true;
		fixture.request.graph.snapshot.tracks[0].native.sourceDuration =
			loopSourceDuration;
	}
	const response = JSON.parse(
		wasm.resolveHyperframesAudioExecutionPlanJson(
			JSON.stringify(fixture.request),
		),
	) as { error?: string; plan?: HyperframesGraphStagePlan };
	assert.equal(response.error, undefined);
	assert.ok(response.plan);
	const plan = response.plan;
	assert.equal(plan.decodedSources.length, 1);
	const source = plan.decodedSources[0],
		recipe = source.ratePreparation;
	assert.ok(recipe, "Variable-rate path must not fall back to scalar decoder");
	if (loopSourceDuration !== undefined) {
		assert.ok(
			recipe.sourceLoop,
			"Loop must materialize canonical source before native rate preparation",
		);
		assert.equal(recipe.mediaStartSeconds, "0");
		assert.equal(
			recipe.sourceLoop.periodFrames,
			Math.round((loopSourceDuration - test.mediaStart) * 48000),
		);
	} else assert.equal(recipe.sourceLoop, undefined);
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
	assert.ok(
		Math.abs(
			Number(recipe.sourceDurationSeconds) -
				oracle.speed.sourceTimeAt(rate, test.duration),
		) < 1e-12,
	);
	const input = {
		decoder,
		body: media.body,
		mimeType: media.mimeType,
		sampleRate,
		frames: source.frames,
		recipe,
		signal,
	};
	const actual = await prepareHyperframesRateAudio(input);
	assert.equal(actual.hasAudio, media.hasAudio);
	const expected = await rateReferenceAtGraphRate(
		decoder.ffmpeg,
		reference,
		test.duration,
		sampleRate,
	);
	const comparison = pcmDifference(
		expected,
		actual.hasAudio ? actual.pcm : Buffer.alloc(expected.length),
	);
	assert.equal(
		comparison.maximum,
		0,
		`${media.name} ${sampleRate}: original native preparation + explicit conversion`,
	);
	if (!media.hasAudio)
		assert.equal(
			actual.pcm.length,
			0,
			"Silent video has no invented soundtrack",
		);
	const controller = new AbortController();
	controller.abort(Error("rate fixture cancellation"));
	await assert.rejects(
		prepareHyperframesRateAudio({ ...input, signal: controller.signal }),
		/rate fixture cancellation/,
	);
	return {
		fixture,
		expected,
		plan,
		summary: {
			name: media.name,
			sampleRate,
			hasAudio: actual.hasAudio,
			frames: expected.length / 8,
			maximumError: comparison.maximum,
			rmsError: comparison.rms,
			expectedSha256: digest(expected),
			actualSha256: actual.hasAudio ? digest(actual.pcm) : null,
			nativePcm16: reference?.format,
			stereoAndMonoFilterMatch: true,
			abortedBeforeIo: true,
		},
	};
}

export type RatePreparationVerification = Awaited<
	ReturnType<typeof verifyRatePreparation>
>;
