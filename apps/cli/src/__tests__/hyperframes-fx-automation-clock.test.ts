import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createFxAutomationOracle,
	type FxAutomationRequest,
} from "../../../../script/fixtures/hyperframes-fx-automation-fixture";
import {
	compareFxAutomationPcm,
	fxLane,
	fxNode,
	fxRequest,
} from "../../../../script/fixtures/hyperframes-fx-automation-cases";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const native = test.skipIf(!toolchain);
function constant(frames: number) {
	const pcm = Buffer.alloc(frames * 8);
	for (let frame = 0; frame < frames; frame++) {
		pcm.writeFloatLE(1, frame * 8);
		pcm.writeFloatLE(-0.37, frame * 8 + 4);
	}
	return pcm;
}
function energy(pcm: Buffer) {
	let sum = 0,
		peak = 0;
	for (let byte = 0; byte < pcm.length; byte += 4) {
		const v = pcm.readFloatLE(byte);
		sum += v * v;
		peak = Math.max(peak, Math.abs(v));
	}
	return { rms: Math.sqrt(sum / (pcm.length / 4)), peak };
}

native(
	"native FX automation uses full local/global history; dynamic tail is not a physical upper bound",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("FX automation clock oracle deadline")),
			55000,
		);
		const evidence = await mkdtemp(
			join(resolve(tmpdir()), "rocut-fx-automation-clock-"),
		);
		const oracle = await createFxAutomationOracle(toolchain!, controller);
		try {
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchain!,
				signal: controller.signal,
			});
			const report: Record<string, unknown> = {
				provenance: oracle.provenance,
				clocks: [],
				tails: [],
			};
			await withHyperframesFxExecutor(
				{ executable: oracle.executable, runtime, signal: controller.signal },
				async (executor) => {
					async function compare(request: FxAutomationRequest, input: Buffer) {
						const expected = await oracle.render(request, input);
						const actual = await executor.run(
							{
								sampleRate: request.sampleRate,
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
						return expected;
					}
					for (const sampleRate of [48000, 44100]) {
						const request = fxRequest(
							[fxNode("gain")],
							[
								fxLane("fx.n1.gain", [
									{ t: 0, v: -24 },
									{ t: 0.2, v: 0 },
								]),
							],
							sampleRate,
						);
						const totalFrames = Math.round(sampleRate * 0.2),
							offsetFrames = Math.round(sampleRate * 0.08);
						const localInput = constant(totalFrames - offsetFrames);
						const local = await compare(request, localInput);
						const globalInput = Buffer.alloc(totalFrames * 8);
						localInput.copy(globalInput, offsetFrames * 8);
						const global = await compare(request, globalInput);
						const trackPlaced = Buffer.alloc(totalFrames * 8);
						local.pcm.copy(trackPlaced, offsetFrames * 8);
						const localVersusBus = compareFxAutomationPcm(
							trackPlaced,
							global.pcm,
						);
						expect(localVersusBus.maxAbs).toBeGreaterThan(0.1);
						const croppedInput = globalInput.subarray(offsetFrames * 8);
						const wrongRestart = await compare(request, croppedInput);
						const cropDelta = compareFxAutomationPcm(
							global.pcm.subarray(offsetFrames * 8),
							wrongRestart.pcm,
						);
						expect(cropDelta.maxAbs).toBeGreaterThan(0.1);
						const shifted = await oracle.render(
							{ ...request, scheduledAt: 0.03, elapsed: 0.08, rate: 2 },
							constant(totalFrames),
						);
						const curve = shifted.events.find(
							(event) => event.kind === "curve",
						)!;
						expect(curve.time).toBe(0.03);
						expect(curve.duration).toBeCloseTo(0.06, 12);
						expect(curve.values![0]).toBeCloseTo(10 ** (-14.4 / 20), 6);
						(report.clocks as unknown[]).push({
							sampleRate,
							localVersusBus,
							cropDelta,
							shiftedEvents: shifted.events,
						});
						await writeFile(
							join(evidence, `track-placed-${sampleRate}.f32le`),
							trackPlaced,
						);
						await writeFile(
							join(evidence, `bus-global-${sampleRate}.f32le`),
							global.pcm,
						);
						const reverb = fxRequest(
							[fxNode("reverb", { size: 1, wet: 1, dry: 0 })],
							[],
							sampleRate,
						);
						const impulse = Buffer.alloc(Math.round(sampleRate * 0.04) * 8);
						impulse.writeFloatLE(1, 0);
						impulse.writeFloatLE(-0.37, 4);
						const full = await compare(reverb, impulse);
						const shortened = await compare(
							{
								...reverb,
								automation: {
									version: 1,
									lanes: [fxLane("fx.n1.size", [{ t: 0, v: 0 }])],
								},
							},
							impulse,
						);
						expect(full.tailSeconds).toBe(3.2);
						expect(shortened.tailSeconds).toBe(0.73);
						expect(shortened.scheduledTargetCount).toBe(0);
						const prefixDelta = compareFxAutomationPcm(
							full.pcm.subarray(0, shortened.pcm.length),
							shortened.pcm,
						);
						expect(prefixDelta.maxAbs).toBeLessThanOrEqual(2e-6);
						const discarded = energy(full.pcm.subarray(shortened.pcm.length));
						expect(discarded.rms).toBeGreaterThan(0.0001);
						(report.tails as unknown[]).push({
							sampleRate,
							fullFrames: full.frames,
							shortenedFrames: shortened.frames,
							prefixDelta,
							discarded,
						});
						await writeFile(
							join(
								evidence,
								`reverb-discarded-by-native-tail-${sampleRate}.f32le`,
							),
							full.pcm.subarray(shortened.pcm.length),
						);
					}
				},
			);
			await writeFile(
				join(evidence, "verification.json"),
				JSON.stringify(report, null, 2),
				"utf8",
			);
			console.log(`Native FX automation clock evidence: ${evidence}`);
		} finally {
			clearTimeout(timer);
			await oracle.close();
		}
	},
	60000,
);
