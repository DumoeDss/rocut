import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import { nativeFxFixture } from "../../../../script/fixtures/hyperframes-fx-executor-fixture";
import { graphChainFixture } from "../../../../script/fixtures/hyperframes-graph-chain-fixture";
import { withHyperframesFxExecutor } from "../programmatic/hyperframes-fx-executor";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import type { HyperframesFxExecutor } from "../programmatic/hyperframes-fx-types";
import { renderHyperframesGraphStages } from "../programmatic/hyperframes-graph-render";
import { runNativeMediaProcess } from "../programmatic/native-media-process";

// Run with --preload ./script/fixtures/isolated-web-wasm-preload.mjs.
// This is isolated Host/kernel/native-IO acceptance, not installed-app E2E.
const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_GRAPH_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_GRAPH_FFPROBE;
const real = test.skipIf(
	!wasmDirectory || !toolchainDirectory || !ffmpeg || !ffprobe,
);
const wasmOnly = test.skipIf(!wasmDirectory);

async function writeEvidence(
	directory: string,
	details: Record<string, unknown>,
) {
	await writeFile(
		join(directory, "verification.json"),
		JSON.stringify(
			{
				scope: "isolated-real-graph-edge-acceptance-not-app-e2e",
				wasmDirectory,
				wasmSha256: createHash("sha256")
					.update(await readFile(join(wasmDirectory!, "opencut_wasm_bg.wasm")))
					.digest("hex"),
				...details,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(`HyperFrames graph edge evidence: ${directory}`);
}

real(
	"44.1k rational 30000/1001 graph crops equal full canonical history byte-for-byte",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Rational graph edge deadline")),
			55000,
		);
		try {
			const fixture = graphChainFixture();
			fixture.request.graph.sampleRate = 44100;
			fixture.request.graph.frameRate = { numerator: 30000, denominator: 1001 };
			const native = await nativeFxFixture(wasmDirectory!);
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchainDirectory!,
				signal: controller.signal,
			});
			const directory = await mkdtemp(
				join(tmpdir(), "rocut-graph-rational-edge-"),
			);
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
					expect(full.sampleRate).toBe(44100);
					expect(full.channels).toBe(2);
					expect(full.sampleOrigin).toBe(0);
					expect(full.frames).toBe(11771);
					expect(full.pcm.length).toBe(11771 * 8);
					expect(full.hasAudio).toBe(true);
					expect(full.pcm.some((byte) => byte !== 0)).toBe(true);
					const crops: unknown[] = [];
					for (const [firstFrame, frameCount, origin, end] of [
						[3, 3, 4414, 8828],
						[2, 1, 2942, 4414],
					] as const) {
						const request = structuredClone(fixture.request);
						request.graph.firstFrame = firstFrame;
						request.graph.frameCount = frameCount;
						const crop = await renderHyperframesGraphStages({
							...input,
							request,
						});
						expect(crop.sampleOrigin).toBe(origin);
						expect(crop.frames).toBe(end - origin);
						expect(crop.hasAudio).toBe(true);
						expect(
							crop.pcm.equals(full.pcm.subarray(origin * 8, end * 8)),
						).toBe(true);
						crops.push({
							firstFrame,
							frameCount,
							sampleOrigin: crop.sampleOrigin,
							frames: crop.frames,
							exact: true,
						});
					}
					// Frame #2 spans 1472 samples, not floor(44100 * 1001 / 30000)=1471.
					expect(4414 - 2942).not.toBe(Math.floor((44100 * 1001) / 30000));
					await writeFile(join(directory, "canonical.f32le"), full.pcm, {
						flag: "wx",
					});
					await writeEvidence(directory, {
						passed: true,
						sampleRate: full.sampleRate,
						frameRate: fixture.request.graph.frameRate,
						frames: full.frames,
						crops,
						provenance: full.provenance,
					});
				},
			);
		} finally {
			clearTimeout(timer);
		}
	},
	60000,
);

real(
	"real video without an audio stream yields hasAudio false and zero graph PCM",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("No-audio video edge deadline")),
			55000,
		);
		try {
			const directory = await mkdtemp(
				join(tmpdir(), "rocut-graph-silent-video-edge-"),
			);
			const body = await runNativeMediaProcess({
				executable: ffmpeg!,
				media: "video",
				signal: controller.signal,
				maxBytes: 256 * 1024,
				args: [
					"-hide_banner",
					"-loglevel",
					"error",
					"-nostdin",
					"-f",
					"lavfi",
					"-i",
					"color=c=black:s=16x16:r=25:d=0.32",
					"-an",
					"-threads",
					"1",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-movflags",
					"frag_keyframe+empty_moov",
					"-f",
					"mp4",
					"pipe:1",
				],
			});
			const videoFile = join(directory, "no-audio.mp4");
			await writeFile(videoFile, body, { flag: "wx" });
			const metadata = JSON.parse(
				(
					await runNativeMediaProcess({
						executable: ffprobe!,
						media: "video",
						signal: controller.signal,
						maxBytes: 65536,
						args: [
							"-v",
							"error",
							"-protocol_whitelist",
							"file,pipe",
							"-f",
							"mov",
							"-enable_drefs",
							"0",
							"-show_entries",
							"stream=codec_type",
							"-of",
							"json",
							videoFile,
						],
					})
				).toString("utf8"),
			) as { streams: { codec_type: string }[] };
			expect(metadata.streams.map((stream) => stream.codec_type)).toEqual([
				"video",
			]);
			const fixture = graphChainFixture();
			const mimeType = "video/mp4";
			const id = createHash("sha256")
				.update(mimeType)
				.update("\0")
				.update(body)
				.digest("hex");
			const template = fixture.request.graph.snapshot.tracks[2]!;
			const request = {
				...fixture.request,
				graph: {
					...fixture.request.graph,
					sources: [{ id, mimeType, byteLength: body.length }],
					snapshot: {
						...fixture.request.graph.snapshot,
						buses: [],
						tracks: [
							{
								...template,
								resourceId: id,
								type: "video",
								native: {
									...template.native,
									sourceDuration: 0.32,
									loop: false,
								},
								attributes: { ...template.attributes, hasAudio: "true" },
							},
						],
					},
				},
			};
			const plan = JSON.parse(
				wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify(request)),
			).plan;
			expect(plan.tracks[0].requiresPcm).toBe(true);
			expect(plan.decodedSources[0].required).toBe(true);
			const native = await nativeFxFixture(wasmDirectory!);
			const runtime = await loadHyperframesFxRuntime({
				toolchainDirectory: toolchainDirectory!,
				signal: controller.signal,
			});
			await withHyperframesFxExecutor(
				{ executable: native.executable, runtime, signal: controller.signal },
				async (executor) => {
					let fxCalls = 0;
					const observedExecutor: HyperframesFxExecutor = {
						provenance: executor.provenance,
						run(stage, pcm) {
							fxCalls++;
							return executor.run(stage, pcm);
						},
					};
					const result = await renderHyperframesGraphStages({
						request,
						sources: [
							{ id, mimeType, body, src: "https://rocut.invalid/no-audio.mp4" },
						],
						kernels: wasm,
						executor: observedExecutor,
						decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! },
						signal: controller.signal,
					});
					expect(fxCalls).toBe(1);
					expect(result.hasAudio).toBe(false);
					expect(result.frames).toBe(15360);
					expect(result.pcm.length).toBe(15360 * 8);
					let nonzeroSamples = 0;
					for (let byte = 0; byte < result.pcm.length; byte += 4)
						if (result.pcm.readFloatLE(byte) !== 0) nonzeroSamples++;
					expect(nonzeroSamples).toBe(0);
					await writeEvidence(directory, {
						passed: true,
						generatedVideoBytes: body.length,
						streams: metadata.streams,
						hasAudio: result.hasAudio,
						frames: result.frames,
						nonzeroSamples,
						fxCalls,
						provenance: result.provenance,
					});
				},
			);
		} finally {
			clearTimeout(timer);
		}
	},
	60000,
);

wasmOnly(
	"all-muted graph needs neither FFmpeg nor FX and returns canonical silence",
	async () => {
		const fixture = graphChainFixture();
		for (const track of fixture.request.graph.snapshot.tracks) {
			track.authoredMuted = true;
			track.attributes.muted = true;
		}
		const plan = JSON.parse(
			wasm.resolveHyperframesAudioExecutionPlanJson(
				JSON.stringify(fixture.request),
			),
		).plan;
		for (const track of plan.tracks) expect(track.requiresPcm).toBe(false);
		for (const source of plan.decodedSources)
			expect(source.required).toBe(false);
		for (const bus of plan.buses) expect(bus.requiresPcm).toBe(false);
		let fxCalls = 0;
		const forbiddenExecutor: HyperframesFxExecutor = {
			provenance: {
				nativeVersion: "0.8.139",
				runtimeSha256: "unused-test-sentinel",
				moduleSha256: "unused-test-sentinel",
				packageLockSha256: "unused-test-sentinel",
				packageIntegrity: "unused-test-sentinel",
				adapterVersion: 1,
				adapterSha256: "unused-test-sentinel",
				browser: {
					product: "not-launched",
					revision: "not-launched",
					jsVersion: "not-launched",
					protocolVersion: "not-launched",
				},
			},
			async run() {
				fxCalls++;
				throw Error("All-muted graph must never execute FX");
			},
		};
		const result = await renderHyperframesGraphStages({
			...fixture,
			kernels: wasm,
			executor: forbiddenExecutor,
			decoder: {
				ffmpeg: "Z:/rocut-edge-does-not-exist/ffmpeg.exe",
				ffprobe: "Z:/rocut-edge-does-not-exist/ffprobe.exe",
			},
			signal: new AbortController().signal,
		});
		expect(fxCalls).toBe(0);
		expect(result.hasAudio).toBe(false);
		expect(result.frames).toBe(15360);
		expect(result.pcm.equals(Buffer.alloc(15360 * 8))).toBe(true);
		expect(result.provenance.browser.product).toBe("not-launched");
		const directory = await mkdtemp(join(tmpdir(), "rocut-graph-muted-edge-"));
		await writeEvidence(directory, {
			passed: true,
			hasAudio: result.hasAudio,
			frames: result.frames,
			exactZeroPcm: true,
			decoderPaths: "intentionally-nonexistent",
			fxCalls,
			browserLaunched: false,
		});
	},
);
