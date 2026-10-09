import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import type { HyperframesFxExecutor } from "../programmatic/hyperframes-fx-types";
import {
	nativeFxFixture,
	nativeFxMetrics,
	nativeFxSignal,
	NATIVE_FX_PCM_CASES,
} from "../../../../script/fixtures/hyperframes-fx-executor-fixture";

const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const wasmDirectory = process.env.ROCUT_TEST_HYPERFRAMES_FX_WASM;
const enabled = !!toolchainDirectory && !!wasmDirectory;
const realTest = test.skipIf(!enabled);

realTest(
	"trusted native executor renders real PCM for all sixteen effects, automation and feedback tails",
	async () => {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(Error("Native FX acceptance timed out")),
			110000,
		);
		const fixture = await nativeFxFixture(wasmDirectory!);
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: toolchainDirectory!,
			signal: controller.signal,
		});
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-native-fx-executor-"),
		);
		const evidence: Record<string, unknown> = { directory, effects: [] };
		let disposed: HyperframesFxExecutor | undefined;
		try {
			await withHyperframesFxExecutor(
				{ executable: fixture.executable, runtime, signal: controller.signal },
				async (executor) => {
					disposed = executor;
					evidence.provenance = executor.provenance;
					const input = nativeFxSignal(),
						frames = input.length / 8;
					const bypass = await executor.run(fixture.stage([], frames), input);
					expect(bypass.pcm.equals(input)).toBe(true);
					expect(
						(
							await executor.run(
								fixture.stage([{ type: "delay" }], 0),
								Buffer.alloc(0),
							)
						).pcm.length,
					).toBe(0);
					const disabled = await executor.run(
						fixture.stage(
							NATIVE_FX_PCM_CASES.map((node) => ({ ...node, enabled: false })),
							frames,
						),
						input,
					);
					expect(disabled.pcm.equals(input)).toBe(true);
					for (const node of NATIVE_FX_PCM_CASES) {
						const stage = fixture.stage([{ ...node, id: "effect" }], frames);
						const result = await executor.run(stage, input);
						expect(result.pcm.length).toBe(stage.expectedOutputFrames * 8);
						expect(result.provenance.runtimeSha256).toBe(runtime.sha256);
						const metrics = nativeFxMetrics(result.pcm, input);
						expect(metrics.rms).toBeGreaterThan(1e-5);
						expect(metrics.differenceRms).toBeGreaterThan(1e-5);
						if (node.type === "gain") {
							expect(metrics.peak).toBeGreaterThan(1);
							let maxError = 0;
							for (let byte = 0; byte < input.length; byte += 4)
								maxError = Math.max(
									maxError,
									Math.abs(
										result.pcm.readFloatLE(byte) -
											input.readFloatLE(byte) * 10 ** (12 / 20),
									),
								);
							expect(maxError).toBeLessThan(5e-7);
							evidence.gainAnalyticMaxError = maxError;
						}
						(evidence.effects as unknown[]).push({
							type: node.type,
							frames: stage.expectedOutputFrames,
							...metrics,
							inputSha256: result.inputSha256,
							outputSha256: result.outputSha256,
						});
						await writeFile(join(directory, `${node.type}.f32le`), result.pcm, {
							flag: "wx",
						});
					}
					const constant = Buffer.alloc(14400 * 8);
					for (let frame = 0; frame < 14400; frame++) {
						constant.writeFloatLE(0.2, frame * 8);
						constant.writeFloatLE(-0.4, frame * 8 + 4);
					}
					const automation = {
						version: 1,
						lanes: [
							{
								target: "fx.level.gain",
								points: [
									{ t: 0, v: 0 },
									{ t: 0.1, v: -12 },
									{ t: 0.2, v: 0 },
								],
							},
						],
					};
					const automated = await executor.run(
						fixture.stage([{ type: "gain", id: "level" }], 14400, automation),
						constant,
					);
					expect(automated.pcm.readFloatLE(0)).toBeCloseTo(0.2, 6);
					expect(automated.pcm.readFloatLE(4800 * 8)).toBeCloseTo(
						0.2 * 10 ** (-12 / 20),
						5,
					);
					expect(automated.pcm.readFloatLE(9600 * 8 + 4)).toBeCloseTo(-0.4, 5);
					evidence.automation = {
						outputSha256: automated.outputSha256,
						at0: automated.pcm.readFloatLE(0),
						at4800: automated.pcm.readFloatLE(4800 * 8),
					};
					const impulse = Buffer.alloc(2400 * 8);
					impulse.writeFloatLE(1, 0);
					impulse.writeFloatLE(-0.5, 4);
					const delayedStage = fixture.stage(
						[{ type: "delay", params: { time: 100, feedback: 0.5, mix: 1 } }],
						2400,
					);
					const delayed = await executor.run(delayedStage, impulse);
					const peaks: number[] = [];
					for (let frame = 0; frame < delayed.pcm.length / 8; frame++)
						if (Math.abs(delayed.pcm.readFloatLE(frame * 8)) > 0.01)
							peaks.push(frame);
					expect(delayed.pcm.length / 8).toBe(50400);
					expect(peaks.slice(0, 3)).toEqual([4800, 9728, 14656]);
					const repeated = await executor.run(delayedStage, impulse);
					expect(repeated.pcm.equals(delayed.pcm)).toBe(true);
					evidence.feedbackDelay = {
						firstPeaks: peaks.slice(0, 6),
						frames: delayed.pcm.length / 8,
						repeatedExact: true,
					};
					await expect(
						executor.run(
							{
								...delayedStage,
								expectedOutputFrames: 2400,
								maxOutputBytes: 2400 * 8,
							},
							impulse,
						),
					).rejects.toThrow("admitted output geometry");
					const invalid = Buffer.from(impulse);
					invalid.writeFloatLE(Number.NaN, 0);
					await expect(
						executor.run(fixture.stage([], 2400), invalid),
					).rejects.toThrow("Nonfinite native FX input");
					const pending = executor.run(fixture.stage([], frames), input);
					await expect(
						executor.run(fixture.stage([], frames), input),
					).rejects.toThrow("serially");
					expect((await pending).pcm.equals(input)).toBe(true);
				},
			);
			await expect(
				disposed!.run(fixture.stage([], 0), Buffer.alloc(0)),
			).rejects.toThrow("disposed");
			evidence.status = "passed";
		} catch (error) {
			evidence.error = String(error);
			throw error;
		} finally {
			clearTimeout(timeout);
			await writeFile(
				join(directory, "verification.json"),
				JSON.stringify(evidence, null, 2),
				{ flag: "wx" },
			);
			console.log(`Native FX executor evidence: ${directory}`);
		}
	},
	120000,
);

realTest(
	"native FX in-flight cancellation and timeout destroy the private executor",
	async () => {
		const fixture = await nativeFxFixture(wasmDirectory!);
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: toolchainDirectory!,
			signal: new AbortController().signal,
		});
		for (const mode of ["cancel", "timeout"] as const) {
			const controller = new AbortController();
			const input = nativeFxSignal(48000 * 3);
			const started = Date.now();
			await expect(
				withHyperframesFxExecutor(
					{
						executable: fixture.executable,
						runtime,
						signal: controller.signal,
						stageTimeoutMs: mode === "timeout" ? 1 : 30000,
					},
					async (executor) => {
						const pending = executor.run(
							fixture.stage([{ type: "reverb" }], input.length / 8),
							input,
						);
						const timer =
							mode === "cancel"
								? setTimeout(
										() =>
											controller.abort(Error("Intentional FX cancellation")),
										10,
									)
								: undefined;
						try {
							await pending;
						} finally {
							clearTimeout(timer);
						}
					},
				),
			).rejects.toThrow();
			expect(Date.now() - started).toBeLessThan(15000);
		}
	},
	35000,
);
