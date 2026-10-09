import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { renderHyperframesGraphStages } from "../../apps/cli/src/programmatic/hyperframes-graph-render";
import * as wasm from "opencut-wasm";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { verifyDurationPreparation } from "./hyperframes-fractional-duration-fixture";
import {
	fractionalDifference,
	prepareFractionalNative,
} from "./hyperframes-fractional-phase-media";
import { trimEnvironment } from "./hyperframes-fractional-trim-fixture";
import { digest } from "./hyperframes-variable-rate-io";
import { loopGraphExpected } from "./hyperframes-variable-rate-loop-graph";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";
import { verifyRateGraph } from "./hyperframes-variable-rate-production-graph";
import { nativeAudioWav } from "./native-audio-fixture";

const native = test.skipIf(process.env.ROCUT_TEST_FRACTIONAL_DURATION !== "1");

native(
	"fractional duration retains original source-rate geometry through Host/native FX/Rust crop",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-fractional-duration-"),
		);
		const report: Record<string, unknown> = {
			status: "running",
			directory,
			preparationCases: [],
			graphCases: [],
			negatives: [],
			boundary:
				"Actual private WASM/Host IO and original native preparation/FX; no Electron or complete fractional start/loop support claim.",
		};
		console.log(JSON.stringify({ event: "started", directory }));
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Fractional duration deadline")),
				115000,
			);
		try {
			const toolchain = trimEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
			const decoder = {
				ffmpeg: trimEnvironment("ROCUT_TEST_FFMPEG"),
				ffprobe: trimEnvironment("ROCUT_TEST_FFPROBE"),
			};
			report.wasm = {
				sha256: digest(
					await readFile(
						join(
							trimEnvironment("ROCUT_TEST_WASM_DIRECTORY"),
							"opencut_wasm_bg.wasm",
						),
					),
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
							{ t: 0, v: 0.7, curve: 0.4 },
							{ t: 0.81, v: 1.8 },
						],
					},
				],
			}).lanes[0];
			const graphCases: Awaited<
				ReturnType<typeof verifyDurationPreparation>
			>[] = [];
			for (const sourceRate of [48000, 44100]) {
				const source = join(directory, `source-${sourceRate}.wav`);
				const body = nativeAudioWav({
					sampleRate: sourceRate,
					seconds: 2,
					channels: 2,
					sample: (frame, channel) =>
						0.22 * Math.sin(frame * (channel ? 1.173 : 0.781)) +
						0.13 * Math.sin(frame * frame * 0.000041) +
						(frame % 97 === 0 ? 0.12 : 0),
				});
				await writeFile(source, body, { flag: "wx" });
				for (const [label, duration] of [
					["slice-left", 0.5 - 0.25 / 48000],
					["slice-right", 0.5 + 0.25 / 48000],
					["fractional-both", 0.73 + 0.25 / sourceRate],
				] as const) {
					const id = `${sourceRate}-${label}`,
						mediaStart = 0.1 + 0.25 / sourceRate;
					const reference = await prepareFractionalNative(
						oracle,
						directory,
						id,
						source,
						mediaStart,
						duration,
						rate,
					);
					const testCase = {
						id,
						duration,
						mediaStart,
						rate,
						channels: 2,
						sampleRate: sourceRate,
					};
					if (label === "slice-right") {
						const rounded = await prepareFractionalNative(
							oracle,
							directory,
							`${id}-rounded`,
							source,
							mediaStart,
							Math.round(duration * 48000) / 48000,
							rate,
						);
						const difference = fractionalDifference(reference.pcm, rounded.pcm);
						assert.ok(
							difference.maximum > 0.001,
							"Rounding duration must be an observable wrong algorithm",
						);
						(report.negatives as unknown[]).push({
							id,
							kind: "round-duration-before-preparation",
							difference,
						});
					}
					for (const sampleRate of [48000, 44100]) {
						const prepared = await verifyDurationPreparation({
							oracle,
							body,
							test: testCase,
							rate,
							sampleRate,
							reference,
							decoder,
							signal: controller.signal,
						});
						(report.preparationCases as unknown[]).push({
							sourceRate,
							...prepared.summary,
						});
						if (label === "slice-right") graphCases.push(prepared);
					}
				}
			}
			// Identical authored duration, distinct source-rate-dependent native length.
			assert.deepEqual(
				graphCases.map((item) => item.summary.nativeFrames),
				[24000, 24000, 24001, 24001],
			);
			assert.deepEqual(
				graphCases.map((item) => item.summary.frames),
				[24000, 22050, 24001, 22051],
			);
			report.nativeCalls = oracle.io.calls;
			if (process.env.ROCUT_TEST_RATE_PREPARATION_ONLY === "1") {
				report.status = "preparation-passed-graph-not-run";
				return;
			}
			const fxOracle = await createFxAutomationOracle(toolchain, controller);
			const expected: Awaited<ReturnType<typeof loopGraphExpected>>[] = [];
			try {
				report.fxOracleProvenance = fxOracle.provenance;
				for (const prepared of graphCases)
					expected.push(await loopGraphExpected(fxOracle, prepared));
			} finally {
				await fxOracle.close();
			}
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain,
				signal: controller.signal,
			});
			await withHyperframesFxExecutor(
				{ executable: fxOracle.executable, runtime, signal: controller.signal },
				async (executor) => {
					report.productionFxProvenance = executor.provenance;
					await assert.rejects(
						renderHyperframesGraphStages({
							...graphCases[0].fixture,
							kernels: wasm,
							executor,
							decoder,
							signal: controller.signal,
							request: {
								...graphCases[0].fixture.request,
								decodedSourceObservations: [],
							},
						}),
						/must be collected by Host/,
					);
					for (const [index, prepared] of graphCases.entries())
						(report.graphCases as unknown[]).push(
							await verifyRateGraph(
								prepared,
								expected[index],
								executor,
								decoder,
								controller.signal,
								true,
							),
						);
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
	120000,
);
