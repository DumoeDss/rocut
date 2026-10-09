import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { createHyperframesFxTarget } from "../../apps/cli/src/programmatic/hyperframes-fx-target";
import { renderHyperframesGraphStages } from "../../apps/cli/src/programmatic/hyperframes-graph-render";
import { prepareHyperframesRateAudio } from "../../apps/cli/src/programmatic/hyperframes-rate-prepare";
import { durationPlan } from "./hyperframes-fractional-duration-fixture";
import { graphRatePcm } from "./hyperframes-fractional-phase-media";
import { trimEnvironment } from "./hyperframes-fractional-trim-fixture";
import { nativeFxFixture } from "./hyperframes-fx-executor-fixture";
import { digest, readNativePreparedWav } from "./hyperframes-variable-rate-io";
import { LOOP_TEST_FX } from "./hyperframes-variable-rate-loop-graph";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";
import { nativeAudioWav } from "./native-audio-fixture";

const native = test.skipIf(process.env.ROCUT_TEST_FRACTIONAL_DURATION !== "1");

function tinyFixture(
	body: Buffer,
	duration: number,
	rate: RateLane,
	sampleRate: number,
) {
	const fixture = variableRateGraphFixture(
		body,
		"audio/wav",
		{
			id: `tiny-${duration}`,
			channels: 2,
			sampleRate: 48000,
			duration,
			mediaStart: 0.1,
			rate,
		},
		rate,
		sampleRate,
		LOOP_TEST_FX,
	);
	// Observe the actual short active window, not the ordinary fixture's 10 ms interior.
	fixture.request.graph.snapshot.time = fixture.start;
	fixture.request.graph.snapshot.tracks[0].observedAt = fixture.start;
	fixture.request.graph.snapshot.tracks[0].resolvedAuthorGain.observedAt =
		fixture.start;
	return fixture;
}

native(
	"tiny duration preserves real original empty preparation and native failure through Host/FX",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "rocut-hf-duration-tiny-"));
		const report: Record<string, unknown> = {
			status: "running",
			directory,
			cases: [],
			graphCases: [],
			nativeEmptyFx: [],
		};
		console.log(JSON.stringify({ event: "started", directory }));
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Tiny duration deadline")),
				55000,
			);
		try {
			const wasmDirectory = trimEnvironment("ROCUT_TEST_WASM_DIRECTORY"),
				toolchain = trimEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
			const decoder = {
				ffmpeg: trimEnvironment("ROCUT_TEST_FFMPEG"),
				ffprobe: trimEnvironment("ROCUT_TEST_FFPROBE"),
			};
			report.wasm = {
				directory: wasmDirectory,
				sha256: digest(
					await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
				),
			};
			const oracle = await loadVariableRateNative({
				...decoder,
				toolchain,
				archive: trimEnvironment("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
			});
			report.provenance = oracle.provenance;
			const rate: RateLane = oracle.automation.normalizeAutomation({
				version: 1,
				lanes: [
					{
						target: "rate",
						points: [
							{ t: 0, v: 2 },
							{ t: 1, v: 2 },
						],
					},
				],
			}).lanes[0];
			const body = nativeAudioWav({
				sampleRate: 48000,
				channels: 2,
				seconds: 1,
				sample: (frame, channel) =>
					Math.sin(frame * (channel ? 0.31 : 0.27)) * 0.3,
			});
			const sourcePath = join(directory, "source.wav");
			await writeFile(sourcePath, body, { flag: "wx" });
			const empty: {
				fixture: ReturnType<typeof tinyFixture>;
				sampleRate: number;
				duration: number;
				pcm: Buffer;
			}[] = [];
			for (const [index, duration] of [1e-7, 1e-6, 1e-5].entries()) {
				const path = join(directory, `native-${index}.wav`);
				const original = await oracle.native.prepareAudioTrack(
					sourcePath,
					path,
					0.1,
					duration,
					rate,
					controller.signal,
					{ ffmpegProcessTimeout: 30000 },
				);
				const call = oracle.io.calls.at(-1)!;
				const reference = original.success
					? await readNativePreparedWav(path)
					: undefined;
				for (const sampleRate of [48000, 44100]) {
					const fixture = tinyFixture(body, duration, rate, sampleRate),
						pending = durationPlan(fixture.request);
					const source = pending.decodedSources[0],
						recipe = source.ratePreparation;
					assert.ok(recipe?.observedPcm);
					assert.equal(recipe.durationSeconds, String(duration));
					assert.equal(
						recipe.sourceDurationSeconds,
						String(oracle.speed.sourceTimeAt(rate, duration)),
					);
					let actual:
							| Awaited<ReturnType<typeof prepareHyperframesRateAudio>>
							| undefined,
						hostError: string | undefined;
					try {
						actual = await prepareHyperframesRateAudio({
							decoder,
							body,
							mimeType: "audio/wav",
							sampleRate,
							frames: source.frames,
							recipe,
							signal: controller.signal,
						});
					} catch (error) {
						hostError = error instanceof Error ? error.message : String(error);
					}
					const entry: Record<string, unknown> = {
						duration,
						sampleRate,
						originalSuccess: original.success,
						originalDiagnostic: call.stderr.slice(-1000),
						hostSuccess: actual !== undefined,
						hostError,
					};
					(report.cases as unknown[]).push(entry);
					assert.equal(
						actual !== undefined,
						original.success,
						"Preserve original success/failure, never silence on native failure",
					);
					if (!original.success) {
						assert.match(call.stderr, /Invalid duration specification for t:/i);
						assert.equal(hostError, "Native audio decoder failed (exit 1)");
						continue;
					}
					assert.ok(actual?.hasAudio && reference);
					const expected = await graphRatePcm(decoder.ffmpeg, path, sampleRate);
					assert.equal(actual.nativeFrames, reference.frames);
					assert.equal(actual.pcm.equals(expected), true);
					Object.assign(entry, {
						nativeFrames: reference.frames,
						graphFrames: expected.length / 8,
						pcmExact: true,
						sha256: digest(expected),
					});
					if (reference.frames === 0 && expected.length === 0)
						empty.push({ fixture, sampleRate, duration, pcm: expected });
				}
			}
			report.nativeCalls = oracle.io.calls;
			report.emptyPreparationCases = empty.length;
			assert.ok(
				empty.length > 0,
				"No successful native empty PCM observed; do not invent an empty reference",
			);
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain,
				signal: controller.signal,
			});
			const { executable } = await nativeFxFixture(wasmDirectory);
			// Call the unchanged pinned original root directly, independently of the
			// production transport and Rust's expectedOutputFrames. The ordinary FX
			// graph-building oracle lacks this root's empty-input short circuit.
			const browser = await launchFrameBrowser(executable, controller.signal);
			try {
				const target = await createHyperframesFxTarget(
					browser,
					controller.signal,
					(error) => controller.abort(error),
				);
				await target.evaluate(runtime.code);
				for (const sampleRate of [48000, 44100]) {
					const result = await target.evaluate(
						`(async()=>{const input=[new Float32Array(0),new Float32Array(0)];const output=await window.__HF_AUDIO_FX.render(input,${sampleRate},${JSON.stringify(JSON.stringify({ version: 1, nodes: LOOP_TEST_FX }))});return {lengths:output.map(channel=>channel.length),sameInput:output===input};})()`,
					);
					assert.deepEqual(result, { lengths: [0, 0], sameInput: true });
					(report.nativeEmptyFx as unknown[]).push({ sampleRate, result });
				}
				report.nativeEmptyFxRuntimeSha256 = runtime.sha256;
			} finally {
				await browser.close();
			}
			await withHyperframesFxExecutor(
				{ executable, runtime, signal: controller.signal },
				async (executor) => {
					for (const item of empty) {
						let fxCalls = 0;
						const checked = {
							provenance: executor.provenance,
							async run(
								stage: Parameters<typeof executor.run>[0],
								input: Uint8Array,
							) {
								assert.equal(stage.inputFrames, 0);
								assert.equal(stage.expectedOutputFrames, 0);
								assert.ok(
									stage.maxOutputBytes > 0,
									"Retain predecode capacity even for empty actual PCM",
								);
								assert.equal(input.byteLength, 0);
								fxCalls++;
								const result = await executor.run(stage, input);
								assert.equal(result.pcm.length, 0);
								return result;
							},
						};
						const result = await renderHyperframesGraphStages({
							...item.fixture,
							kernels: wasm,
							decoder,
							executor: checked,
							signal: controller.signal,
						});
						assert.equal(fxCalls, 1);
						assert.equal(result.hasAudio, true);
						assert.equal(
							result.pcm.every((byte) => byte === 0),
							true,
						);
						(report.graphCases as unknown[]).push({
							duration: item.duration,
							sampleRate: item.sampleRate,
							actualNativeFrames: 0,
							actualFxFrames: 0,
							fxCalls,
							masterFrames: result.frames,
							masterSha256: digest(result.pcm),
						});
					}
					report.productionFxProvenance = executor.provenance;
				},
			);
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
