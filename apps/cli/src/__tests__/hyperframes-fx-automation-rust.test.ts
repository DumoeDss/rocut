import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFxAutomationOracle } from "../../../../script/fixtures/hyperframes-fx-automation-fixture";
import {
	compareFxAutomationPcm,
	fxAutomationCases,
	fxAutomationInput,
	fxNode,
	fxRequest,
} from "../../../../script/fixtures/hyperframes-fx-automation-cases";
import {
	extraFxAutomationRustCases,
	fxAutomationRustRequest,
	mappedKnobRustCases,
	observedFxAutomationCounts,
} from "../../../../script/fixtures/hyperframes-fx-automation-rust-fixture";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import type { HyperframesFxStage } from "../programmatic/hyperframes-fx-types";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
const native = test.skipIf(!toolchain || !wasmDirectory);
interface Stage extends HyperframesFxStage {
	nativeTailSeconds: number;
	automationPoints: number;
	automationCurveValues: number;
	automationScheduledEvents: number;
}
interface Plan {
	renderFrames: number;
	cropStartSample: number;
	outputFrames: number;
	tracks: { fxStage: Stage }[];
	buses: { fxStage: Stage }[];
}

native(
	"Rust FX automation plans match actual upstream normalization, AudioParam events, geometry and PCM",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Rust/native FX differential deadline")),
			110000,
		);
		const evidence = await mkdtemp(
			join(resolve(tmpdir()), "rocut-fx-automation-rust-"),
		);
		const wasmBytes = await readFile(
			join(wasmDirectory!, "opencut_wasm_bg.wasm"),
		);
		const wasm = await import(
			pathToFileURL(join(wasmDirectory!, "opencut_wasm.js")).href
		);
		wasm.initSync({ module: wasmBytes });
		const oracle = await createFxAutomationOracle(toolchain!, controller);
		const results: Record<string, unknown>[] = [];
		const prepare = (request: unknown): Plan => {
			const result = JSON.parse(
				wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify(request)),
			);
			if (result.error)
				throw Error(`Rust rejected native case: ${result.error}`);
			return result.plan;
		};
		try {
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain!,
				signal: controller.signal,
			});
			const registryNodes = [
				"gain",
				"peaking",
				"lowshelf",
				"highshelf",
				"highpass",
				"lowpass",
				"compressor",
				"limiter",
				"gate",
				"saturate",
				"bitcrush",
				"pitchshift",
				"delay",
				"chorus",
				"phaser",
				"reverb",
			].map((type, i) => fxNode(type, {}, `n${i + 1}`));
			const mapping = await oracle.inspect(fxRequest(registryNodes));
			const cases = [
				...fxAutomationCases(48000),
				...fxAutomationCases(44100),
				...mappedKnobRustCases(mapping),
				...extraFxAutomationRustCases(),
			];
			await withHyperframesFxExecutor(
				{ executable: oracle.executable, runtime, signal: controller.signal },
				async (executor) => {
					for (const request of cases) {
						const label = `${request.name}-${request.sampleRate}`;
						const graph = fxAutomationRustRequest(request, {
							volumeLane: request.name === "volume-and-fx-projections",
						});
						const input = fxAutomationInput(
							Math.round(request.sampleRate * 0.16),
							request.sampleRate,
						);
						const upstream = await oracle.render(request, input);
						const observed = observedFxAutomationCounts(upstream);
						let plan: Plan;
						try {
							plan = prepare(graph);
						} catch (error) {
							throw Error(`${label}: ${error}`);
						}
						for (const [kind, stage] of [
							["track", plan.tracks[0]!.fxStage],
							["bus", plan.buses[0]!.fxStage],
						] as const) {
							expect(
								stage.nativeFxAutomation,
								`${label} ${kind} normalized payload`,
							).toEqual(observed.fxAutomation);
							expect(
								stage.nativeTailSeconds === upstream.tailSeconds,
								`${label} ${kind} native tail`,
							).toBe(true);
							expect(stage.inputFrames, `${label} ${kind} input geometry`).toBe(
								input.length / 8,
							);
							expect(
								stage.expectedOutputFrames,
								`${label} ${kind} output geometry`,
							).toBe(upstream.frames);
							expect(
								stage.maxOutputBytes,
								`${label} ${kind} output budget`,
							).toBe(upstream.frames * 8);
							expect(stage.automationPoints, `${label} ${kind} points`).toBe(
								observed.points,
							);
							expect(
								stage.automationCurveValues,
								`${label} ${kind} actual curve values`,
							).toBe(observed.curveValues);
							expect(
								stage.automationScheduledEvents,
								`${label} ${kind} actual events`,
							).toBe(observed.scheduledEvents);
						}
						const actual = await executor.run(plan.tracks[0]!.fxStage, input);
						const delta = compareFxAutomationPcm(actual.pcm, upstream.pcm);
						expect(
							delta.maxAbs,
							`${label} Rust-normalized payload PCM`,
						).toBeLessThanOrEqual(2e-6);
						expect(
							upstream.events.some((event) => event.kind === "curve-rejected"),
							`${label} native fallback`,
						).toBe(false);
						const cropGraph = structuredClone(graph);
						cropGraph.graph.firstFrame = 1;
						cropGraph.graph.frameCount = 2;
						const crop = prepare(cropGraph);
						expect(
							crop.tracks,
							`${label} crop must not shift track automation`,
						).toEqual(plan.tracks);
						expect(
							crop.buses,
							`${label} crop must not shift bus automation`,
						).toEqual(plan.buses);
						results.push({
							name: label,
							observed,
							upstreamTail: upstream.tailSeconds,
							upstreamFrames: upstream.frames,
							trackStage: plan.tracks[0]!.fxStage,
							busStage: plan.buses[0]!.fxStage,
							delta,
							upstreamSha256: upstream.sha256,
							rustPlanExecutorSha256: actual.outputSha256,
						});
					}
				},
			);
			await writeFile(
				join(evidence, "verification.json"),
				JSON.stringify(
					{
						provenance: oracle.provenance,
						wasmSha256: createHash("sha256").update(wasmBytes).digest("hex"),
						cases: results,
					},
					null,
					2,
				),
				"utf8",
			);
			console.log(`Rust/native FX differential evidence: ${evidence}`);
		} finally {
			clearTimeout(timer);
			await oracle.close();
		}
	},
	120000,
);
