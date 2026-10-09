import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { withHyperframesFxExecutor } from "../../apps/cli/src/programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../../apps/cli/src/programmatic/hyperframes-fx-runtime";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { digest, readNativePreparedWav } from "./hyperframes-variable-rate-io";
import {
	LOOP_TEST_FX,
	loopGraphExpected,
} from "./hyperframes-variable-rate-loop-graph";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import {
	verifyRatePreparation,
	type RatePreparationVerification,
} from "./hyperframes-variable-rate-production-case";
import { verifyRateGraph } from "./hyperframes-variable-rate-production-graph";

function absolute(name: string) {
	const value = process.env[name];
	assert.ok(
		value && isAbsolute(value),
		`${name} must be an existing absolute test path`,
	);
	return value;
}

test("source-domain loop → native rate preparation → stateful FX → actual Rust full/crop", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "rocut-hf-rate-loop-production-"),
	);
	const report: Record<string, unknown> = {
		status: "running",
		directory,
		preparationCases: [],
		graphCases: [],
		boundary:
			"Actual private Rust WASM and production Host IO with trusted graph declarations; no browser graph collection, Electron, continuous playback or encoded-video export claim.",
	};
	console.log(JSON.stringify({ event: "started", directory }));
	const controller = new AbortController(),
		timeout = setTimeout(
			() => controller.abort(Error("Loop production deadline")),
			115000,
		);
	try {
		const wasmDirectory = absolute("ROCUT_TEST_WASM_DIRECTORY");
		report.wasm = {
			directory: wasmDirectory,
			sha256: digest(
				await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
			),
		};
		const evidence = absolute("ROCUT_TEST_LOOP_EVIDENCE"),
			toolchain = absolute("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
		const decoder = {
			ffmpeg: absolute("ROCUT_TEST_FFMPEG"),
			ffprobe: absolute("ROCUT_TEST_FFPROBE"),
		};
		const original = JSON.parse(
			await readFile(join(evidence, "verification.json"), "utf8"),
		);
		assert.equal(original.status, "passed");
		assert.equal(original.fx.status, "passed");
		const oracle = await loadVariableRateNative({
			...decoder,
			toolchain,
			archive: absolute("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
		});
		assert.equal(
			oracle.provenance.extractedSha256,
			original.provenance.extractedSha256,
		);
		report.provenance = oracle.provenance;
		report.originalEvidence = evidence;
		const graphCases: RatePreparationVerification[] = [];
		for (const entry of variableRateCases.filter(
			(value) => typeof value.rate === "object",
		)) {
			const recorded = original.cases.find(
				(value: { id: string }) => value.id === entry.id,
			);
			assert.ok(recorded && recorded.difference.maximum === 0);
			const testCase = { ...entry, duration: 1.6, mediaStart: 0.1 };
			const path = join(evidence, `${entry.id}-source.wav`),
				body = await readFile(path);
			const referencePath = join(
				evidence,
				`${entry.id}-reference-prepared.wav`,
			);
			const reference = {
				path: referencePath,
				...(await readNativePreparedWav(referencePath)),
			};
			const padded = Buffer.alloc(1.6 * 48000 * 8);
			reference.pcm.copy(padded);
			assert.equal(
				digest(padded),
				recorded.referenceSha256,
				"Independent retained reference identity",
			);
			const media = {
				name: `${entry.id}-loop`,
				kind: "wav" as const,
				path,
				body,
				mimeType: "audio/wav",
				hasAudio: true,
			};
			for (const sampleRate of [48000, 44100]) {
				const prepared = await verifyRatePreparation({
					oracle,
					media,
					reference,
					test: testCase,
					rate: recorded.rate,
					sampleRate,
					decoder,
					signal: controller.signal,
					loopSourceDuration: 0.35,
					fxNodes: LOOP_TEST_FX,
				});
				(report.preparationCases as unknown[]).push(prepared.summary);
				console.log(
					JSON.stringify({ event: "preparation-passed", ...prepared.summary }),
				);
				if (entry.id === "rising-log") graphCases.push(prepared);
			}
		}
		const fxOracle = await createFxAutomationOracle(toolchain, controller);
		const expectations: Awaited<ReturnType<typeof loopGraphExpected>>[] = [];
		try {
			report.fxOracleProvenance = fxOracle.provenance;
			for (const prepared of graphCases)
				expectations.push(await loopGraphExpected(fxOracle, prepared));
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
						true,
					);
					(report.graphCases as unknown[]).push(result);
					console.log(JSON.stringify({ event: "graph-passed", ...result }));
				}
			},
		);
		report.status = "passed";
	} catch (error) {
		report.status = "failed";
		report.error = error instanceof Error ? error.stack : String(error);
		throw error;
	} finally {
		clearTimeout(timeout);
		await writeFile(
			join(directory, "verification.json"),
			JSON.stringify(report, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				event: "finished",
				status: report.status,
				report: join(directory, "verification.json"),
			}),
		);
	}
}, 120000);
