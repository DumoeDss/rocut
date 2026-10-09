import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	createFractionalOracle,
	type FractionalRequest,
} from "../../../../script/fixtures/hyperframes-fractional-fixture";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const engine = process.env.ROCUT_TEST_HYPERFRAMES_ENGINE;
const native = test.skipIf(!toolchain || !engine);

/** Measured same-rate Chromium buffer path only, not HTMLMediaElement/export. */
function measuredSameRateCandidate(
	request: FractionalRequest,
	source: number[],
) {
	const rate = request.sampleRate;
	const start = (request.startFrames! / rate) * rate;
	const offset = Math.round((request.offsetFrames! / rate) * rate);
	const end =
		(request.startFrames! / rate + request.durationFrames! / rate) * rate;
	return Array.from({ length: request.totalFrames! }, (_, frame) => {
		if (frame < Math.ceil(start) || frame >= Math.ceil(end)) return 0;
		const position = offset + frame - start,
			index = Math.floor(position),
			fraction = position - index;
		return Math.fround(
			(source[index] ?? 0) +
				((source[index + 1] ?? 0) - (source[index] ?? 0)) * fraction,
		);
	});
}
const maxDifference = (a: number[], b: number[]) =>
	Math.max(...a.map((value, i) => Math.abs(value - b[i]!)));

native(
	"fractional source scheduling separates native fallback, DOM loop clock and exporter quantization",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Fractional oracle deadline")),
			55000,
		);
		const evidence = await mkdtemp(
			join(resolve(tmpdir()), "rocut-fractional-oracle-"),
		);
		const oracle = await createFractionalOracle(
			toolchain!,
			engine!,
			controller,
		);
		try {
			const results: Record<string, unknown>[] = [];
			for (const sampleRate of [48000, 44100])
				for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
					for (const [name, extra] of [
						["start", { startFrames: 4 + fraction }],
						["offset", { offsetFrames: 3 + fraction }],
						["duration", { durationFrames: 8 + fraction }],
						["subsample-duration", { durationFrames: fraction }],
						[
							"render-quantum-crossing",
							{
								startFrames: 126 + fraction,
								offsetFrames: 3 + fraction,
								durationFrames: 260 + fraction,
								sourceFrames: 512,
								totalFrames: 512,
							},
						],
						[
							"subsample-future",
							{ startFrames: 4 + fraction, durationFrames: fraction },
						],
						[
							"combined",
							{
								startFrames: 4 + fraction,
								offsetFrames: 3 + fraction,
								durationFrames: 8 + fraction,
							},
						],
						[
							"loop-api-probe",
							{
								sourceFrames: 8,
								offsetFrames: 2 + fraction,
								durationFrames: 32,
								mode: "web-audio-loop-probe-not-upstream",
							},
						],
					] as const) {
						const request: FractionalRequest = {
							sampleRate,
							totalFrames: 64,
							startFrames: 0,
							offsetFrames: 0,
							durationFrames: 16,
							...extra,
						};
						const result = await oracle.render(request);
						expect(result.pcm).toHaveLength(request.totalFrames!);
						expect(result.pcm.every(Number.isFinite)).toBe(true);
						expect(result.calls).toHaveLength(1);
						const support = result.pcm
							.map((value, index) => (value === 0 ? -1 : index))
							.filter((index) => index >= 0);
						let candidateError: number | undefined;
						let loopContrast: unknown;
						if (request.mode !== "web-audio-loop-probe-not-upstream") {
							candidateError = maxDifference(
								result.pcm,
								measuredSameRateCandidate(request, result.source),
							);
							expect(candidateError).toBeLessThanOrEqual(2e-6);
							expect(result.sourceLoop).toBe(false);
						} else {
							const fallback = await oracle.render({
								...request,
								mode: "native-buffer-fallback",
							});
							expect(fallback.sourceLoop).toBe(false);
							expect(result.sourceLoop).toBe(true);
							const integerStart = Math.round(request.offsetFrames!);
							const wrongIntegerLoop = result.pcm.map((_, i) =>
								i < 32
									? result.source[
											integerStart +
												(i % (request.sourceFrames! - integerStart))
										]!
									: 0,
							);
							const integerLoopDifference = maxDifference(
								result.pcm,
								wrongIntegerLoop,
							);
							expect(integerLoopDifference).toBeGreaterThan(0.01);
							loopContrast = { fallback, integerLoopDifference };
						}
						results.push({
							name,
							sampleRate,
							fraction,
							request,
							result,
							support,
							candidateError,
							loopContrast,
						});
					}
					const fullRequest: FractionalRequest = {
						sampleRate,
						totalFrames: 64,
						startFrames: 4 + fraction,
						offsetFrames: 3 + fraction,
						durationFrames: 24,
					};
					const full = await oracle.render(fullRequest);
					const cropFrom = 12;
					const restart = await oracle.render({
						...fullRequest,
						totalFrames: 64 - cropFrom,
						elapsedFrames: cropFrom - fullRequest.startFrames!,
					});
					const restartDifference = maxDifference(
						full.pcm.slice(cropFrom),
						restart.pcm,
					);
					expect(restartDifference).toBeGreaterThan(0.01);
					results.push({
						name: "local-crop-restart-is-not-full-history",
						sampleRate,
						fraction,
						full,
						restart,
						cropFrom,
						restartDifference,
					});
					const crossRate = await oracle.render({
						...fullRequest,
						sourceRate: sampleRate === 48000 ? 44100 : 48000,
					});
					expect(crossRate.pcm.every(Number.isFinite)).toBe(true);
					results.push({
						name: "cross-rate-browser-probe-no-portability-claim",
						sampleRate,
						fraction,
						result: crossRate,
					});
					const clock = await oracle.mediaClock({
						sampleRate,
						sourceFrames: 8,
						offsetFrames: 2 + fraction,
						elapsedFrames: 20,
					});
					expect(clock.loop).toBe(true);
					const expectedFrame = 2 + fraction + (20 % (8 - (2 + fraction)));
					expect(clock.sourceFrame).toBeCloseTo(expectedFrame, 10);
					const filter = await oracle.exportFilter({
						sampleRate,
						startFrames: 4 + fraction,
						durationFrames: 8 + fraction,
						totalFrames: 64,
					});
					expect(filter).toContain("adelay=0|0");
					const halfMillisecondFilter = await oracle.exportFilter({
						sampleRate,
						startFrames: sampleRate * 0.0005 + fraction - 0.5,
						durationFrames: 16,
						totalFrames: 64,
					});
					const delayMs = fraction < 0.5 ? 0 : 1;
					expect(halfMillisecondFilter).toContain(
						`adelay=${delayMs}|${delayMs}`,
					);
					results.push({
						name: "native-media-clock-and-export-filter",
						sampleRate,
						fraction,
						clock,
						filter,
						halfMillisecondFilter,
					});
				}
			await writeFile(
				join(evidence, "verification.json"),
				JSON.stringify({ provenance: oracle.provenance, results }, null, 2),
				"utf8",
			);
			console.log(`Fractional source oracle evidence: ${evidence}`);
		} finally {
			clearTimeout(timer);
			await oracle.close();
		}
	},
	60000,
);
