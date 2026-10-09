import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createFxAutomationOracle } from "../../../../script/fixtures/hyperframes-fx-automation-fixture";
import {
	compareFxAutomationPcm,
	fxAutomationCases,
	fxAutomationInput,
	fxLane,
	fxNode,
	fxRequest,
} from "../../../../script/fixtures/hyperframes-fx-automation-cases";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const native = test.skipIf(!toolchain);

native(
	"native FX automation schema, target maps, timing and PCM oracle",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Native FX automation oracle deadline")),
			55000,
		);
		const evidence = await mkdtemp(
			join(resolve(tmpdir()), "rocut-fx-automation-oracle-"),
		);
		const oracle = await createFxAutomationOracle(toolchain!, controller);
		const report: Record<string, unknown> = { provenance: oracle.provenance };
		try {
			const nodes = [
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
			].map((type, index) => fxNode(type, {}, `n${index + 1}`));
			const maps = await oracle.inspect(fxRequest(nodes));
			report.targetMaps = maps.targets;
			const map = (target: string, index: number, value: number) =>
				maps.targets
					.find((item) => item.target === target)!
					.params[index]!.mapped.find((item) => item.value === value)!.mapped;
			expect(map("fx.n1.gain", 0, 10)).toBeCloseTo(10 ** 0.5, 12);
			expect(map("fx.n13.time", 0, 1000)).toBe(1);
			expect(map("fx.n13.mix", 1, 0.25)).toBe(0.75);
			expect(map("fx.n14.delay", 0, 10)).toBe(0.01);
			expect(
				maps.targets.find((item) => item.target === "fx.n13.time")!.range!
					.scale,
			).toBe("log");
			expect(
				maps.targets.find((item) => item.target === "fx.n6.frequency")!.range!
					.scale,
			).toBe("log");
			expect(maps.targets.some((item) => item.target === "fx.n16.size")).toBe(
				false,
			);
			expect(
				maps.targets.some((item) => item.target === "fx.n7.threshold"),
			).toBe(false);
			const normalized = await oracle.inspect({
				...fxRequest([fxNode("gain")]),
				automation: {
					version: 1,
					lanes: [
						{
							target: "fx.n1.gain",
							points: [
								{ t: "0.1", v: "100" },
								{ t: -1, v: -100, curve: 9 },
								{ t: 0.1, v: 2, viaX: 0.5, viaY: 0.1 },
								{ t: null, v: 1 },
							],
						},
						{ target: "fx.absent.gain", points: [{ t: 0, v: 1 }] },
					],
				},
			});
			report.normalized = normalized;
			expect(normalized.parsed.lanes).toHaveLength(2);
			expect(normalized.automation.lanes).toHaveLength(1);
			expect(normalized.automation.lanes[0]!.points).toEqual([
				{ t: 0, v: -60, curve: 1 },
				{ t: 0.1, v: 2, viaX: 0.5, viaY: 0.1 },
			]);
			const tail = await oracle.inspect(
				fxRequest(
					[fxNode("delay", { time: 200, feedback: 0, mix: 1 })],
					[
						fxLane("fx.n1.time", [
							{ t: 0, v: 20 },
							{ t: 50, v: 10 },
						]),
					],
				),
			);
			expect(tail.tailSeconds).toBe(0.04);
			expect(tail.staticTailSeconds).toBe(0.4);
			report.tailFallbackReplacement = tail;
			const duplicateNode = await oracle.inspect(
				fxRequest(
					[fxNode("gain"), fxNode("peaking")],
					[fxLane("fx.n1.gain", [{ t: 0, v: -100 }])],
				),
			);
			expect(duplicateNode.automation.lanes[0]!.points[0]!.v).toBe(-60);
			report.duplicateNode = duplicateNode;
			const via = await oracle.inspect({
				...fxRequest(
					[fxNode("gain")],
					[
						fxLane("fx.n1.gain", [
							{ t: 0, v: -18, curve: -1, viaX: 0.5, viaY: 0.1 },
							{ t: 0.1, v: 6 },
						]),
					],
				),
				sampleTimes: [0.05],
			});
			expect(via.lanes[0]!.samples[0]!.value).toBeCloseTo(-15.6, 10);
			report.viaOverridesCurve = via;
			await writeFile(
				join(evidence, "native-model.json"),
				JSON.stringify(report, null, 2),
				"utf8",
			);
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain!,
				signal: controller.signal,
			});
			const results: Record<string, unknown>[] = [];
			await withHyperframesFxExecutor(
				{ executable: oracle.executable, runtime, signal: controller.signal },
				async (executor) => {
					for (const sampleRate of [48000, 44100])
						for (const request of fxAutomationCases(sampleRate)) {
							const input = fxAutomationInput(
								Math.round(sampleRate * 0.16),
								sampleRate,
							);
							const expected = await oracle.render(request, input);
							const actual = await executor.run(
								{
									sampleRate,
									inputFrames: input.length / 8,
									expectedOutputFrames: expected.frames,
									maxOutputBytes: expected.frames * 8,
									normalizedFxChain: request.chain,
									nativeFxAutomation: request.automation,
								},
								input,
							);
							const delta = compareFxAutomationPcm(actual.pcm, expected.pcm);
							expect(delta.maxAbs).toBeLessThanOrEqual(2e-6);
							expect(
								expected.events.some(
									(event) => event.kind === "curve-rejected",
								),
							).toBe(false);
							if (request.name === "duplicate-gain-last-schedule") {
								expect(
									expected.events.filter((event) => event.kind === "cancel"),
								).toHaveLength(2);
								expect(expected.events.at(-1)!.value).toBeCloseTo(
									10 ** (6 / 20),
									12,
								);
							}
							if (request.name === "duplicate-delay-first-tail-last-schedule") {
								expect(expected.tailSeconds).toBe(0.04);
								expect(expected.events.at(-1)!.value).toBe(0.2);
							}
							if (
								[
									"disabled-valid-noop",
									"onepole-frequency-valid-noop",
									"worklet-param-valid-noop",
									"orphan-and-enum-drop",
									"reverb-size-noop-but-longer-tail",
									"reverb-size-noop-but-shorter-tail",
								].includes(request.name!)
							)
								expect(expected.scheduledTargetCount).toBe(0);
							if (request.name === "split-preset-blends")
								expect(expected.scheduledTargetCount).toBe(4);
							if (request.name === "disabled-valid-noop")
								expect(compareFxAutomationPcm(expected.pcm, input).maxAbs).toBe(
									0,
								);
							if (
								[
									"onepole-frequency-valid-noop",
									"worklet-param-valid-noop",
									"orphan-and-enum-drop",
								].includes(request.name!)
							) {
								const baseline = await oracle.render(
									{ ...request, automation: undefined },
									input,
								);
								expect(
									compareFxAutomationPcm(expected.pcm, baseline.pcm).maxAbs,
								).toBe(0);
							}
							await writeFile(
								join(evidence, `${request.name}-${sampleRate}.f32le`),
								expected.pcm,
							);
							const { pcm: _pcm, ...metadata } = expected;
							results.push({
								name: request.name,
								sampleRate,
								...metadata,
								delta,
								executorSha256: actual.outputSha256,
							});
						}
				},
			);
			report.results = results;
			await writeFile(
				join(evidence, "verification.json"),
				JSON.stringify(report, null, 2),
				"utf8",
			);
			console.log(`Native FX automation evidence: ${evidence}`);
		} finally {
			clearTimeout(timer);
			await oracle.close();
		}
	},
	60000,
);
