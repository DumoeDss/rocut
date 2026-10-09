import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import { nativeFxFixture } from "../../../../script/fixtures/hyperframes-fx-executor-fixture";
import {
	CHAIN_FRAMES,
	graphChainFixture,
	graphChainOracle,
	pcmError,
} from "../../../../script/fixtures/hyperframes-graph-chain-fixture";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import { renderHyperframesGraphStages } from "../programmatic/hyperframes-graph-render";

const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_GRAPH_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_GRAPH_FFPROBE;
const real = test.skipIf(
	!wasmDirectory || !toolchainDirectory || !ffmpeg || !ffprobe,
);

real(
	"real decode → Rust dry/faders → native track/bus FX → Rust canonical/crop PCM",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Graph chain test timed out")),
			55000,
		);
		try {
			const fixture = graphChainFixture();
			const native = await nativeFxFixture(wasmDirectory!);
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchainDirectory!,
				signal: controller.signal,
			});
			const directory = await mkdtemp(join(tmpdir(), "rocut-graph-chain-"));
			await withHyperframesFxExecutor(
				{ executable: native.executable, runtime, signal: controller.signal },
				async (executor) => {
					const input = {
						...fixture,
						kernels: wasm,
						executor,
						decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! },
						signal: controller.signal,
					};
					const full = await renderHyperframesGraphStages(input);
					expect(full.frames).toBe(CHAIN_FRAMES);
					expect(full.sampleOrigin).toBe(0);
					expect(full.hasAudio).toBe(true);
					const oracle = await graphChainOracle(
						fixture.pcm,
						executor,
						native.stage,
					);
					const maxError = pcmError(full.pcm, oracle.expected);
					expect(maxError).toBeLessThan(2e-6);
					expect(oracle.wrongOrderError).toBeGreaterThan(0.005);
					let peak = 0;
					for (let byte = 0; byte < full.pcm.length; byte += 4)
						peak = Math.max(peak, Math.abs(full.pcm.readFloatLE(byte)));
					expect(peak).toBeGreaterThan(1);
					const cropRequest = structuredClone(fixture.request);
					cropRequest.graph.firstFrame = 4;
					cropRequest.graph.frameCount = 3;
					const crop = await renderHyperframesGraphStages({
						...input,
						request: cropRequest,
					});
					expect(crop.sampleOrigin).toBe(7680);
					expect(crop.frames).toBe(5760);
					expect(crop.pcm.equals(full.pcm.subarray(7680 * 8, 13440 * 8))).toBe(
						true,
					);
					// Full-history rerender stays deterministic despite another request's crop.
					const repeated = await renderHyperframesGraphStages(input);
					expect(repeated.pcm.equals(full.pcm)).toBe(true);
					const badSource = structuredClone(fixture.request);
					badSource.graph.sources[0].byteLength--;
					await expect(
						renderHyperframesGraphStages({ ...input, request: badSource }),
					).rejects.toThrow("source geometry");
					const changed = Buffer.from(fixture.sources[0].body);
					changed[50] ^= 1;
					await expect(
						renderHyperframesGraphStages({
							...input,
							sources: [{ ...fixture.sources[0], body: changed }],
						}),
					).rejects.toThrow("source bytes");
					const badPhase = structuredClone(fixture.request);
					badPhase.graph.snapshot.tracks[0].native.mediaStart += 0.25 / 48000;
					await expect(
						renderHyperframesGraphStages({ ...input, request: badPhase }),
					).rejects.toThrow("fractional-sample");
					const aborted = new AbortController();
					aborted.abort(Error("test graph cancellation"));
					await expect(
						renderHyperframesGraphStages({ ...input, signal: aborted.signal }),
					).rejects.toThrow("test graph cancellation");
					await writeFile(join(directory, "canonical.f32le"), full.pcm, {
						flag: "wx",
					});
					await writeFile(
						join(directory, "verification.json"),
						JSON.stringify(
							{
								passed: true,
								frames: full.frames,
								maxError,
								wrongOrderError: oracle.wrongOrderError,
								peak,
								exactCrop: true,
								repeatedExact: true,
								provenance: full.provenance,
							},
							null,
							2,
						),
						{ flag: "wx" },
					);
					console.log(
						JSON.stringify({ graphChainEvidence: directory, maxError, peak }),
					);
				},
			);
		} finally {
			clearTimeout(timer);
		}
	},
	60000,
);
