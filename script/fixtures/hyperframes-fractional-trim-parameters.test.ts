import assert from "node:assert/strict";
import { test } from "bun:test";
import * as wasm from "opencut-wasm";
import { fractionalTrimCases } from "./hyperframes-fractional-trim-fixture";
import type { RateLane } from "./hyperframes-variable-rate-native";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";

const native = test.skipIf(process.env.ROCUT_TEST_FRACTIONAL_TRIM !== "1");

native(
	"fractional trim recipe preserves JS String and remaining phase gates",
	() => {
		const testCase = fractionalTrimCases[1];
		const resolve = (request: unknown) =>
			JSON.parse(
				wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify(request)),
			);
		for (const sampleRate of [48000, 44100]) {
			const fixture = variableRateGraphFixture(
				Buffer.alloc(64),
				"audio/wav",
				testCase,
				testCase.rate as RateLane,
				sampleRate,
			);
			const request = fixture.request,
				track = request.graph.snapshot.tracks[0];
			for (const trim of [
				0,
				-0,
				Number.MIN_VALUE,
				1e-12,
				1e-7,
				9.999999999999997e-7,
				1e-6,
				1.0000000000000002e-6,
				0.1 + 0.4999 / 48000,
				0.1 + 0.5001 / 48000,
				0.1 + 0.5001 / 44100,
			]) {
				track.native.mediaStart = trim;
				const result = resolve(request);
				assert.equal(result.error, undefined, `${sampleRate} ${String(trim)}`);
				assert.equal(
					result.plan.decodedSources[0].ratePreparation.mediaStartSeconds,
					String(trim),
				);
				assert.equal(result.plan.tracks[0].sourceStartSample, 0);
			}
			track.native.mediaStart = testCase.mediaStart;
			for (const kind of ["start", "loop"] as const) {
				const invalid = structuredClone(request),
					clip = invalid.graph.snapshot.tracks[0].native;
				if (kind === "loop") {
					clip.loop = true;
					clip.sourceDuration = clip.mediaStart + 0.25;
				} else {
					clip[kind] += 0.25 / sampleRate;
					clip.end = clip.start + clip.duration;
				}
				assert.match(resolve(invalid).error, /fractional-sample/);
			}
			const full = resolve(request).plan,
				crop = structuredClone(request);
			crop.graph.firstFrame = 37;
			crop.graph.frameCount = 11;
			assert.deepEqual(resolve(crop).plan.decodedSources, full.decodedSources);
			assert.deepEqual(resolve(crop).plan.tracks, full.tracks);
		}
	},
);
