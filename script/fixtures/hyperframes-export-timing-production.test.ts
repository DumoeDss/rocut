import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { renderHyperframesGraphStages } from "../../apps/cli/src/programmatic/hyperframes-graph-render";
import { nativeExportTiming } from "./hyperframes-export-timing-native";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import {
	fractionalDifference,
	graphRatePcm,
	prepareFractionalNative,
} from "./hyperframes-fractional-phase-media";
import { trimEnvironment } from "./hyperframes-fractional-trim-fixture";
import { fixtureGain } from "./hyperframes-graph-chain-fixture";
import { digest, pcmDifference } from "./hyperframes-variable-rate-io";
import { LOOP_TEST_FX } from "./hyperframes-variable-rate-loop-graph";
import { loopFfmpeg } from "./hyperframes-variable-rate-loop-media";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { variableRateGraphFixture } from "./hyperframes-variable-rate-production-fixture";
import { nativeAudioWav } from "./native-audio-fixture";

const native = test.skipIf(process.env.ROCUT_TEST_EXPORT_TIMING !== "1");

native(
	"original prepare/FX/fader/final-filter matches selected Rust timing and canonical crops",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-export-timing-production-"),
		);
		const report: Record<string, unknown> = {
			status: "running",
			directory,
			cases: [],
		};
		console.log(JSON.stringify({ event: "started", directory }));
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Exporter timing deadline")),
			110000,
		);
		try {
			const toolchain = trimEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
			const decoder = {
				ffmpeg: trimEnvironment("ROCUT_TEST_FFMPEG"),
				ffprobe: trimEnvironment("ROCUT_TEST_FFPROBE"),
			};
			const oracle = await loadVariableRateNative({
				toolchain,
				...decoder,
				archive: trimEnvironment("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
			});
			const placement = await nativeExportTiming(
				toolchain,
				trimEnvironment("ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY"),
			);
			report.provenance = oracle.provenance;
			report.mixerSha256 = placement.mixerSha256;
			report.wasmSha256 = digest(
				await readFile(
					join(
						trimEnvironment("ROCUT_TEST_WASM_DIRECTORY"),
						"opencut_wasm_bg.wasm",
					),
				),
			);
			const duration = 0.5 + 0.25 / 48000,
				mediaStart = 0.1 + 0.25 / 44100,
				sampleRate = 44100;
			const rate = oracle.automation.normalizeAutomation({
				version: 1,
				lanes: [
					{
						target: "rate",
						points: [
							{ t: 0, v: 0.7, curve: 0.4 },
							{ t: 0.81, v: 1.8 },
						],
					},
				],
			}).lanes[0];
			const body = nativeAudioWav({
				sampleRate,
				seconds: 4,
				channels: 2,
				sample: (frame, channel) =>
					0.22 * Math.sin(frame * (channel ? 1.173 : 0.781)) +
					0.13 * Math.sin(frame * frame * 0.000041) +
					(frame % 97 === 0 ? 0.12 : 0),
			});
			const source = join(directory, "source.wav");
			await writeFile(source, body, { flag: "wx" });
			const prepared = await prepareFractionalNative(
				oracle,
				directory,
				"original-prepared",
				source,
				mediaStart,
				duration,
				rate,
			);
			const dry = await graphRatePcm(decoder.ffmpeg, prepared.path, sampleRate);
			assert.equal(prepared.frames, 24001);
			assert.equal(dry.length / 8, 22051);
			const fxOracle = await createFxAutomationOracle(toolchain, controller);
			let gained: Buffer,
				tailSeconds: number,
				wrongOrder: ReturnType<typeof pcmDifference>;
			try {
				report.fxProvenance = fxOracle.provenance;
				const config = {
					sampleRate,
					chain: { version: 1 as const, nodes: LOOP_TEST_FX },
				};
				const nativeFx = await fxOracle.render(config, dry);
				gained = fixtureGain(nativeFx.pcm, () => 0.75);
				tailSeconds = nativeFx.tailSeconds;
				assert.ok(nativeFx.frames > dry.length / 8);
				const wrong = await fxOracle.render(
					config,
					fixtureGain(dry, () => 0.75),
				);
				wrongOrder = pcmDifference(gained, wrong.pcm);
				assert.ok(
					wrongOrder.maximum > 0.001,
					"Nonlinear FX detects incorrect pre-FX fader order",
				);
				report.nativeFx = {
					frames: nativeFx.frames,
					tailSeconds,
					sha256: nativeFx.sha256,
					wrongOrder,
				};
			} finally {
				await fxOracle.close();
			}
			const gainedFile = join(directory, "original-post-fx-gain.f32le");
			await writeFile(gainedFile, gained, { flag: "wx" });
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain,
				signal: controller.signal,
			});
			await withHyperframesFxExecutor(
				{ executable: fxOracle.executable, runtime, signal: controller.signal },
				async (executor) => {
					for (const start of [0.00051, 1 / 44100, 3.05]) {
						const test = {
							id: `start-${start}`,
							duration,
							mediaStart,
							rate,
							channels: 2,
							sampleRate,
						};
						const fixture = variableRateGraphFixture(
							body,
							"audio/wav",
							test,
							rate,
							sampleRate,
							LOOP_TEST_FX,
						);
						const track = fixture.request.graph.snapshot.tracks[0];
						track.native.start = start;
						track.native.end = start + duration;
						track.observedAt = start + 0.01;
						track.resolvedAuthorGain.observedAt = start + 0.01;
						fixture.request.graph.snapshot.time = start + 0.01;
						fixture.request.graph.durationFrames = Math.ceil(
							(start + duration + 0.4) * 100,
						);
						fixture.request.graph.frameCount =
							fixture.request.graph.durationFrames;
						const request = {
							...fixture.request,
							graph: { ...fixture.request.graph, timing: "native-exporter" },
						};
						const total = request.graph.durationFrames / 100;
						const filter = placement.build(
							{ start, end: start + duration, tailSeconds },
							total,
						);
						const { stdout: expected } = await loopFfmpeg(decoder.ffmpeg, [
							"-f",
							"f32le",
							"-ar",
							String(sampleRate),
							"-ac",
							"2",
							"-i",
							gainedFile,
							"-filter_complex",
							filter,
							"-map",
							"[a0]",
							"-c:a",
							"pcm_f32le",
							"-f",
							"f32le",
							"pipe:1",
						]);
						const input = {
							request,
							sources: fixture.sources,
							kernels: wasm,
							executor,
							decoder,
							signal: controller.signal,
						};
						const full = await renderHyperframesGraphStages(input);
						const difference = pcmDifference(expected, full.pcm);
						assert.equal(
							difference.maximum,
							0,
							"Original complete final filter must equal Rust output sample for sample",
						);
						const crop = structuredClone(request);
						crop.graph.firstFrame = Math.floor(start * 100) + 37;
						crop.graph.frameCount = 11;
						const cropped = await renderHyperframesGraphStages({
							...input,
							request: crop,
						});
						const first = crop.graph.firstFrame * 441,
							end = (crop.graph.firstFrame + crop.graph.frameCount) * 441;
						assert.ok(
							cropped.pcm.equals(full.pcm.subarray(first * 8, end * 8)),
						);
						const repeated = await renderHyperframesGraphStages({
							...input,
							request: crop,
						});
						assert.ok(repeated.pcm.equals(cropped.pcm));
						// A sample-aligned delay (even for an aligned start) is the wrong
						// algorithm in this explicitly selected native exporter mode.
						const wrongFilter = filter.replace(
							/adelay=\d+\|\d+/,
							`adelay=${Math.round(start * sampleRate)}S|${Math.round(start * sampleRate)}S`,
						);
						const wrong = await loopFfmpeg(decoder.ffmpeg, [
							"-f",
							"f32le",
							"-ar",
							String(sampleRate),
							"-ac",
							"2",
							"-i",
							gainedFile,
							"-filter_complex",
							wrongFilter,
							"-map",
							"[a0]",
							"-c:a",
							"pcm_f32le",
							"-f",
							"f32le",
							"pipe:1",
						]);
						const wrongPlacement = fractionalDifference(expected, wrong.stdout);
						assert.ok(wrongPlacement.maximum > 0.001);
						(report.cases as unknown[]).push({
							start,
							duration,
							mediaStart,
							filter,
							nativeFrames: prepared.frames,
							graphDryFrames: dry.length / 8,
							maximumError: difference.maximum,
							pcmSha256: digest(full.pcm),
							cropExact: true,
							repeatExact: true,
							wrongPlacement,
							boundary:
								"Real Host graph IO and original native prepare/FX/filter; browser author collection and editor export are separate acceptance.",
						});
					}
				},
			);
			report.status = "passed";
		} catch (error) {
			report.status = "failed";
			report.error = error instanceof Error ? error.stack : String(error);
			throw error;
		} finally {
			clearTimeout(timer);
			await writeFile(
				join(directory, "verification.json"),
				JSON.stringify(report, null, 2),
				{ flag: "wx" },
			);
			console.log(
				JSON.stringify({ event: "finished", directory, status: report.status }),
			);
		}
	},
	120000,
);
