import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import { prepareHyperframesRateAudio } from "../../apps/cli/src/programmatic/hyperframes-rate-prepare";
import type { HyperframesGraphStagePlan } from "../../apps/cli/src/programmatic/hyperframes-graph-kernels";
import {
	fractionalTrimCases,
	fractionalTrimMedia,
	trimEnvironment,
} from "./hyperframes-fractional-trim-fixture";
import {
	digest,
	pcmDifference,
	readNativePreparedWav,
} from "./hyperframes-variable-rate-io";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";
import { rateReferenceAtGraphRate } from "./hyperframes-variable-rate-production-media";

const native = test.skipIf(process.env.ROCUT_TEST_FRACTIONAL_TRIM !== "1");

/** Recipe admission is NOT proof that FFmpeg accepts the original JS spelling.
 * Retain original rejection instead of silently snapping a tiny trim to zero. */
native(
	"tiny fractional trim preserves native FFmpeg success or failure, never silent fallback",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-fractional-trim-io-"),
		);
		const report: Record<string, unknown> = {
			status: "running",
			cases: [],
			boundary:
				"Actual pinned exporter preparation versus actual Host IO; native exponent parse failures are unsupported inputs, not successful fractional PCM. No browser/FX/Electron exercised here.",
		};
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Fractional native IO deadline")),
				55000,
			);
		try {
			const wasmDirectory = trimEnvironment("ROCUT_TEST_WASM_DIRECTORY");
			report.wasm = {
				directory: wasmDirectory,
				sha256: digest(
					await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
				),
			};
			const decoder = {
				ffmpeg: trimEnvironment("ROCUT_TEST_FFMPEG"),
				ffprobe: trimEnvironment("ROCUT_TEST_FFPROBE"),
			};
			const oracle = await loadVariableRateNative({
				...decoder,
				toolchain: trimEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
				archive: trimEnvironment("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
			});
			report.provenance = oracle.provenance;
			const base = fractionalTrimCases[0],
				media = await fractionalTrimMedia(directory, base);
			const rate = oracle.automation.normalizeAutomation({
				version: 1,
				lanes: [base.rate as RateLane],
			}).lanes[0];
			for (const [index, trim] of [
				0,
				Number.MIN_VALUE,
				1e-12,
				1e-7,
				9.999999999999997e-7,
				1e-6,
				1.0000000000000002e-6,
			].entries()) {
				const testCase = { ...base, mediaStart: trim },
					path = join(directory, `case-${index}-native.wav`);
				const original = await oracle.native.prepareAudioTrack(
					media.path,
					path,
					trim,
					testCase.duration,
					rate,
					controller.signal,
					{ ffmpegProcessTimeout: 30000 },
				);
				const call = oracle.io.calls.at(-1)!;
				assert.equal(call.args[call.args.indexOf("-ss") + 1], String(trim));
				if (trim === 0 || trim >= 1e-6)
					assert.ok(original.success, original.error);
				if (!original.success)
					assert.match(call.stderr, /Invalid duration specification for ss:/i);
				const reference = original.success
					? { path, ...(await readNativePreparedWav(path)) }
					: undefined;
				for (const sampleRate of [48000, 44100]) {
					const fixture = variableRateGraphFixture(
						media.body,
						media.mimeType,
						testCase,
						rate,
						sampleRate,
					);
					const resolved = JSON.parse(
						wasm.resolveHyperframesAudioExecutionPlanJson(
							JSON.stringify(fixture.request),
						),
					) as { error?: string; plan?: HyperframesGraphStagePlan };
					assert.equal(resolved.error, undefined);
					assert.ok(resolved.plan);
					const source = resolved.plan.decodedSources[0],
						recipe = source.ratePreparation;
					assert.ok(recipe);
					assert.equal(recipe.mediaStartSeconds, String(trim));
					let actual:
						| Awaited<ReturnType<typeof prepareHyperframesRateAudio>>
						| undefined;
					let hostError: string | undefined;
					try {
						actual = await prepareHyperframesRateAudio({
							decoder,
							body: media.body,
							mimeType: media.mimeType,
							sampleRate,
							frames: source.frames,
							recipe,
							signal: controller.signal,
						});
					} catch (error) {
						hostError = error instanceof Error ? error.message : String(error);
					}
					const entry: Record<string, unknown> = {
						trim,
						spelling: String(trim),
						sampleRate,
						originalSuccess: original.success,
						hostSuccess: actual !== undefined,
						originalDiagnostic: call.stderr.slice(-1000),
						hostError,
					};
					(report.cases as unknown[]).push(entry);
					assert.equal(
						actual !== undefined,
						original.success,
						"Host must preserve native success/failure without changing the trim",
					);
					if (!original.success) {
						// Production intentionally omits stderr; a real process failure is
						// distinguishable from a phase gate, timeout or silent PCM fallback.
						assert.equal(hostError, "Native audio decoder failed (exit 1)");
						continue;
					}
					assert.ok(actual?.hasAudio && reference);
					const expected = await rateReferenceAtGraphRate(
						decoder.ffmpeg,
						reference,
						testCase.duration,
						sampleRate,
					);
					const difference = pcmDifference(expected, actual.pcm);
					entry.difference = difference;
					entry.expectedSha256 = digest(expected);
					entry.actualSha256 = digest(actual.pcm);
					assert.equal(difference.maximum, 0);
				}
			}
			report.nativeCalls = oracle.io.calls;
			report.status = "passed";
		} catch (error) {
			report.status = "failed";
			report.error = error instanceof Error ? error.stack : String(error);
			throw error;
		} finally {
			clearTimeout(timer);
			const path = join(directory, "verification.json");
			await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
				flag: "wx",
			});
			console.log(
				JSON.stringify({
					event: "finished",
					status: report.status,
					report: path,
				}),
			);
		}
	},
	60000,
);
