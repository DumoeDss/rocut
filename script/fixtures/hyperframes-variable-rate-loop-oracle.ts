import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import {
	variableRateCases,
	variableRateSample,
} from "./hyperframes-variable-rate-cases";
import { digest, pcmDifference } from "./hyperframes-variable-rate-io";
import { nativeVariableLoopClock } from "./hyperframes-variable-rate-loop-clock";
import {
	canonicalSourceTile,
	LOOP_NATIVE_RATE,
	materializeSourceLoop,
	prepareLoopReference,
} from "./hyperframes-variable-rate-loop-media";
import {
	loopFxResetNegative,
	sourceLoopNegatives,
} from "./hyperframes-variable-rate-loop-negatives";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { prepareStagedLoop } from "./hyperframes-variable-rate-loop-staged";

/** Source-domain loop extension deliberately preserves author/preview intent.
 * Upstream exporter omits loop. This is NOT an equivalence claim to that bug. */
export async function variableRateLoopOracle(options: {
	toolchain: string;
	archive: string;
	ffmpeg: string;
	ffprobe: string;
	browser: boolean;
}) {
	const directory = await mkdtemp(join(tmpdir(), "rocut-hf-rate-loop-oracle-"));
	const oracle = await loadVariableRateNative(options);
	const clock = await nativeVariableLoopClock(options.toolchain);
	const duration = 1.6,
		trim = 0.1,
		sourceDuration = 0.35,
		period = 0.25;
	const cases = [],
		selected = variableRateCases.filter(
			(test) => typeof test.rate === "object",
		);
	let fxInput: { pcm: Buffer; firstLapSeconds: number } | undefined;
	for (const test of selected) {
		assert.equal(typeof test.rate, "object");
		const rate = oracle.automation.normalizeAutomation({
			version: 1,
			lanes: [test.rate as Exclude<typeof test.rate, number>],
		}).lanes[0];
		const source = join(directory, `${test.id}-source.wav`);
		await writeFile(
			source,
			nativeAudioWav({
				seconds: sourceDuration,
				sampleRate: test.sampleRate,
				channels: test.channels,
				sample: variableRateSample(test.sampleRate),
			}),
			{ flag: "wx" },
		);
		const tile = await canonicalSourceTile(
			options.ffmpeg,
			source,
			trim,
			period,
			test.channels,
		);
		const untrimmed = await canonicalSourceTile(
			options.ffmpeg,
			source,
			0,
			sourceDuration,
			test.channels,
		);
		const sourceFrames =
			Math.ceil(oracle.speed.sourceTimeAt(rate, duration) * LOOP_NATIVE_RATE) +
			480;
		const virtual = await materializeSourceLoop(
			directory,
			`${test.id}-virtual`,
			tile,
			sourceFrames,
		);
		const reference = await prepareLoopReference(
			oracle,
			directory,
			`${test.id}-reference`,
			virtual,
			duration,
			rate,
		);
		const streamed = await prepareStagedLoop(
			oracle,
			options.ffmpeg,
			directory,
			test.id,
			source,
			trim,
			period,
			test.channels,
			duration,
			rate,
		);
		const difference = pcmDifference(reference.pcm, streamed.pcm);
		if (difference.maximum !== 0)
			await writeFile(
				join(directory, "verification-failure.json"),
				JSON.stringify(
					{
						status: "failed",
						id: test.id,
						difference,
						rate,
						referenceSha256: digest(reference.pcm),
						actualSha256: digest(streamed.pcm),
						provenance: oracle.provenance,
						nativeCalls: oracle.io.calls,
					},
					null,
					2,
				) + "\n",
				{ flag: "wx" },
			);
		assert.equal(
			difference.maximum,
			0,
			`${test.id}: streaming source loop matches independent materialized-source native preparation`,
		);
		const nativeClock = clock.cases.find((value) => value.id === test.id);
		assert.ok(nativeClock);
		const negatives = await sourceLoopNegatives({
			oracle,
			directory,
			name: test.id,
			source: virtual,
			tile,
			untrimmedTile: untrimmed,
			expected: reference.pcm,
			duration,
			rate,
			firstLapSeconds: nativeClock.firstLapSeconds,
			trim,
		});
		if (!fxInput)
			fxInput = {
				pcm: reference.pcm,
				firstLapSeconds: nativeClock.firstLapSeconds,
			};
		cases.push({
			id: test.id,
			channels: test.channels,
			sampleRate: test.sampleRate,
			rate,
			difference,
			sourceFrames: streamed.sourceFrames,
			periodFrames: streamed.periodFrames,
			repetitions: streamed.repetitions,
			referenceSha256: digest(reference.pcm),
			actualSha256: digest(streamed.pcm),
			sourceTileSha256: digest(tile),
			nativeFilterSha256: digest(streamed.nativeFilter),
			filter: streamed.filter,
			negatives,
		});
	}
	let fx: unknown = {
		status: "not-run",
		reason: "Separate browser slot required for native FX-reset negative",
	};
	if (options.browser) {
		assert.ok(fxInput);
		const { createFxAutomationOracle } =
			await import("./hyperframes-fx-automation-fixture");
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Loop FX oracle deadline")),
				60000,
			);
		try {
			const nativeFx = await createFxAutomationOracle(
				options.toolchain,
				controller,
			);
			try {
				fx = {
					status: "passed",
					...(await loopFxResetNegative(
						nativeFx,
						fxInput.pcm,
						fxInput.firstLapSeconds,
					)),
					provenance: nativeFx.provenance,
				};
			} finally {
				await nativeFx.close();
			}
		} finally {
			clearTimeout(timer);
		}
	}
	const report = {
		status: "passed",
		boundary:
			"Candidate source-domain extension; independent materialized source + unchanged original rate preparation. Not production acceptance, continuous playback, public mixer or Electron evidence.",
		duration,
		trim,
		sourceDuration,
		period,
		nativeRate: LOOP_NATIVE_RATE,
		provenance: oracle.provenance,
		clock,
		cases,
		fx,
		nativeCalls: oracle.io.calls,
	};
	const path = join(directory, "verification.json");
	await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
	return { directory, path, report };
}

if (import.meta.main) {
	const required = (name: string) => {
		const value = process.env[name];
		assert.ok(
			value && isAbsolute(value),
			`${name} requires an absolute existing path`,
		);
		return value;
	};
	const result = await variableRateLoopOracle({
		toolchain: required("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
		archive: required("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
		ffmpeg: required("ROCUT_TEST_FFMPEG"),
		ffprobe: required("ROCUT_TEST_FFPROBE"),
		browser: process.env.ROCUT_TEST_LOOP_FX_ORACLE === "1",
	});
	console.log(
		JSON.stringify({
			status: result.report.status,
			report: result.path,
			cases: result.report.cases.map((value) => ({
				id: value.id,
				difference: value.difference,
				negatives: value.negatives,
			})),
			fx: result.report.fx,
		}),
	);
}
