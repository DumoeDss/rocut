import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import {
	fractionalTrimCases,
	fractionalTrimMedia,
	roundedTrimNegative,
	trimEnvironment,
} from "./hyperframes-fractional-trim-fixture";
import { digest } from "./hyperframes-variable-rate-io";
import {
	LOOP_TEST_FX,
	loopGraphExpected,
} from "./hyperframes-variable-rate-loop-graph";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";
import {
	verifyRatePreparation,
	type RatePreparationVerification,
} from "./hyperframes-variable-rate-production-case";
import { verifyRateGraph } from "./hyperframes-variable-rate-production-graph";
import { rateProductionReference } from "./hyperframes-variable-rate-production-media";

const native = test.skipIf(process.env.ROCUT_TEST_FRACTIONAL_TRIM !== "1");

native(
	"fractional nonloop native trim → Host → complete stateful FX → Rust mix/crop",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-fractional-trim-"),
		);
		const report: Record<string, unknown> = {
			status: "running",
			directory,
			preparationCases: [],
			graphCases: [],
			negatives: [],
			boundary:
				"Actual private WASM/Host IO and original native preparation/FX on trusted graph declarations. No Electron, encoded video, browser graph collection or complete fractional placement/duration/loop support claim.",
		};
		console.log(JSON.stringify({ event: "started", directory }));
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Fractional trim deadline")),
				115000,
			);
		try {
			const wasmDirectory = trimEnvironment("ROCUT_TEST_WASM_DIRECTORY"),
				toolchain = trimEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
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
				toolchain,
				archive: trimEnvironment("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
			});
			report.provenance = oracle.provenance;
			const graphCases: RatePreparationVerification[] = [];
			for (const testCase of fractionalTrimCases) {
				const rate = oracle.automation.normalizeAutomation({
					version: 1,
					lanes: [testCase.rate as RateLane],
				}).lanes[0];
				const media = await fractionalTrimMedia(directory, testCase);
				const reference = await rateProductionReference(
					oracle,
					directory,
					media,
					testCase,
					rate,
				);
				assert.ok(reference);
				(report.negatives as unknown[]).push(
					await roundedTrimNegative(
						oracle,
						directory,
						media,
						testCase,
						rate,
						reference,
					),
				);
				for (const sampleRate of [48000, 44100]) {
					const prepared = await verifyRatePreparation({
						oracle,
						media,
						reference,
						test: testCase,
						rate,
						sampleRate,
						decoder,
						signal: controller.signal,
						fxNodes: LOOP_TEST_FX,
					});
					const recipe = prepared.plan.decodedSources[0].ratePreparation!;
					assert.equal(recipe.mediaStartSeconds, String(testCase.mediaStart));
					assert.equal(recipe.durationSeconds, String(testCase.duration));
					assert.equal(recipe.sourceLoop, undefined);
					(report.preparationCases as unknown[]).push({
						...prepared.summary,
						originalTrim: testCase.mediaStart,
						mediaStartSeconds: recipe.mediaStartSeconds,
					});
					if (testCase.id === "stereo-48000-half-after")
						graphCases.push(prepared);
				}
			}
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
