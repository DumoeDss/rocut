import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import {
	verifyRatePreparation,
	type RatePreparationVerification,
} from "./hyperframes-variable-rate-production-case";
import {
	rateGraphExpected,
	verifyRateGraph,
} from "./hyperframes-variable-rate-production-graph";
import {
	rateProductionMedia,
	rateProductionReference,
	type RateMediaKind,
} from "./hyperframes-variable-rate-production-media";

function absoluteEnvironment(name: string) {
	const value = process.env[name];
	assert.ok(
		value && isAbsolute(value),
		`${name} must select an existing absolute private test path`,
	);
	return value;
}

test("variable-rate original PCM16 → real Host preparation → native FX → Rust mix/crop at 48k and 44.1k", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-hf-rate-production-"));
	const report: Record<string, unknown> = {
		status: "running",
		directory,
		boundary:
			"Trusted graph fixture; real original native preparation, real Host FFmpeg, real native browser FX, actual private Rust WASM. Not browser graph collection, public native mixer, Electron transport, or MediaElement continuous-preview equivalence.",
		adapterCases: [],
		graphCases: [],
	};
	console.log(JSON.stringify({ event: "started", directory }));
	const controller = new AbortController();
	const deadline = setTimeout(
		() => controller.abort(Error("Variable-rate acceptance deadline")),
		175000,
	);
	try {
		absoluteEnvironment("ROCUT_TEST_WASM_DIRECTORY");
		const toolchain = absoluteEnvironment("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
		const decoder = {
			ffmpeg: absoluteEnvironment("ROCUT_TEST_FFMPEG"),
			ffprobe: absoluteEnvironment("ROCUT_TEST_FFPROBE"),
		};
		const oracle = await loadVariableRateNative({
			...decoder,
			toolchain,
			archive: absoluteEnvironment("ROCUT_TEST_HYPERFRAMES_ENGINE_ARCHIVE"),
		});
		report.preparationProvenance = oracle.provenance;
		const graphCases: RatePreparationVerification[] = [];
		const audioCases = variableRateCases
			.filter((value) => typeof value.rate === "object")
			.map((value) => ({
				...value,
				mediaStart: Math.round(value.mediaStart * 100) / 100,
			}));
		const matrix = audioCases.map((value) => ({
			test: value,
			kinds: ["wav"] as RateMediaKind[],
		}));
		matrix.push({
			test: audioCases[0],
			kinds: ["mp4-audio", "mp4-silent", "webm-audio", "webm-silent"],
		});
		for (const { test: testCase, kinds } of matrix) {
			assert.equal(typeof testCase.rate, "object");
			const rate = oracle.automation.normalizeAutomation({
				version: 1,
				lanes: [testCase.rate as Exclude<typeof testCase.rate, number>],
			}).lanes[0];
			assert.ok(rate);
			for (const kind of kinds) {
				const media = await rateProductionMedia(
					directory,
					decoder.ffmpeg,
					testCase,
					kind,
				);
				const reference = await rateProductionReference(
					oracle,
					directory,
					media,
					testCase,
					rate,
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
					});
					(report.adapterCases as unknown[]).push(prepared.summary);
					console.log(
						JSON.stringify({ event: "adapter-passed", ...prepared.summary }),
					);
					if (testCase.id === "rising-log") graphCases.push(prepared);
				}
			}
		}
		report.nativeCalls = oracle.io.calls;
		assert.equal((report.adapterCases as unknown[]).length, 18);
		if (process.env.ROCUT_TEST_RATE_PREPARATION_ONLY === "1") {
			report.status = "preparation-passed-graph-not-run";
			return;
		}
		const fxOracle = await createFxAutomationOracle(toolchain, controller);
		const expectations: Awaited<ReturnType<typeof rateGraphExpected>>[] = [];
		try {
			report.fxOracleProvenance = fxOracle.provenance;
			for (const prepared of graphCases)
				expectations.push(await rateGraphExpected(fxOracle, prepared));
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
				for (const [index, prepared] of graphCases.entries()) {
					const result = await verifyRateGraph(
						prepared,
						expectations[index],
						executor,
						decoder,
						controller.signal,
						index < 2,
					);
					(report.graphCases as unknown[]).push(result);
					console.log(
						JSON.stringify({
							event: "graph-passed",
							name: result.name,
							sampleRate: result.sampleRate,
							maximumError: result.graphMaximumError,
						}),
					);
				}
			},
		);
		report.status = "passed";
	} catch (error) {
		report.status = "failed";
		report.error =
			error instanceof Error
				? { name: error.name, message: error.message, stack: error.stack }
				: String(error);
		throw error;
	} finally {
		clearTimeout(deadline);
		await writeFile(
			join(directory, "verification.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
		console.log(
			JSON.stringify({
				event: "finished",
				status: report.status,
				report: join(directory, "verification.json"),
			}),
		);
	}
}, 180000);
