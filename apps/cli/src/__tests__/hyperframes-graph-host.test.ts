import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { withLifecycleProject } from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-project";
import { createHttpProgrammaticFrames } from "../../../vite-example/src/host/http-programmatic-frames";
import { createProgrammaticAudioService } from "../programmatic/audio-service";
import { renderHtmlPng } from "../programmatic/html-rasterizer";

const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_GRAPH_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_GRAPH_FFPROBE;

test.skipIf(!toolchainDirectory || !ffmpeg || !ffprobe)(
	"real graph archive → identity-gated Host HTTP PCM and silent picture rendering",
	async () => {
		await withLifecycleProject(
			toolchainDirectory!,
			async ({ source, options }) => {
				const decoder = { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
				const config = {
					resourceStore: options.resourceStore,
					executable: options.executable,
					decoder,
					connectionFile: "",
					toolchainDirectory,
				};
				let service = createProgrammaticAudioService(config);
				const server = createServer((request, response) => {
					void service.handle(
						request,
						response,
						request.url?.endsWith("/identity") ? "identity" : "render",
					);
				});
				await new Promise<void>((resolve) =>
					server.listen(0, "127.0.0.1", resolve),
				);
				const address = server.address();
				if (!address || typeof address === "string")
					throw Error("Missing test port");
				const base = `http://127.0.0.1:${address.port}`;
				const provider = createHttpProgrammaticFrames({ base });
				const signal = options.signal;
				try {
					expect(service.capability.hyperframesGraph.configured).toBe(true);
					const identity = await provider.getAudioIdentity!({
						request: { source, sampleRate: 48000 },
						signal,
					});
					expect(identity.profile).toBe("hyperframes-graph-v1");
					expect(identity.id).toMatch(/^[a-f0-9]{64}$/);
					const request = {
						source,
						firstFrame: 0,
						frameCount: 8,
						sampleRate: 48000,
						expectedIdentity: identity,
					};
					const full = await provider.renderAudio!({ request, signal });
					expect(full.identity).toEqual(identity);
					expect(full.frames).toBe(15360);
					expect(full.hasAudio).toBe(true);
					const pcm = new DataView(full.pcm);
					let maxError = 0;
					for (let i = 0; i < full.frames; i++) {
						const a = Math.fround(0.125 * Math.fround(10 ** (6 / 20)));
						const b = i >= 3840 && i < 11520 ? 0.0625 : 0;
						const sum = Math.fround(a + b);
						const expected = Math.fround(
							Math.fround(sum * Math.fround(10 ** (-6 / 20))) * 0.5,
						);
						for (let channel = 0; channel < 2; channel++)
							maxError = Math.max(
								maxError,
								Math.abs(pcm.getFloat32(i * 8 + channel * 4, true) - expected),
							);
					}
					expect(maxError).toBeLessThan(2e-7);
					const crop = await provider.renderAudio!({
						request: { ...request, firstFrame: 2, frameCount: 3 },
						signal,
					});
					expect(crop.sampleOrigin).toBe(3840);
					expect(
						Buffer.from(crop.pcm).equals(
							Buffer.from(full.pcm).subarray(3840 * 8, 9600 * 8),
						),
					).toBe(true);
					await expect(
						provider.renderAudio!({
							request: { ...request, expectedIdentity: undefined },
							signal,
						}),
					).rejects.toThrow("current runtime identity");
					const wrong = { ...identity, id: "0".repeat(64) };
					await expect(
						provider.renderAudio!({
							request: { ...request, expectedIdentity: wrong },
							signal,
						}),
					).rejects.toThrow("identity changed");
					const png = await renderHtmlPng({
						...options,
						connectionFile: "",
						nativeVideoDecoder: decoder,
					});
					expect([...png.subarray(0, 8)]).toEqual([
						137, 80, 78, 71, 13, 10, 26, 10,
					]);
					// A restarted Host is a new cache namespace, even with identical tools.
					await service.dispose();
					service = createProgrammaticAudioService(config);
					const next = await provider.getAudioIdentity!({
						request: { source, sampleRate: 48000 },
						signal,
					});
					expect(next.id).not.toBe(identity.id);
					await expect(
						provider.renderAudio!({ request, signal }),
					).rejects.toThrow("identity changed");
				} finally {
					await service.dispose();
					server.closeAllConnections();
					await new Promise<void>((resolve) => server.close(() => resolve()));
				}
			},
			new URL(
				"../../../../script/fixtures/hyperframes-graph-host.html",
				import.meta.url,
			),
			{ version: 1, mode: "native", profile: "hyperframes-graph-v1" },
		);
	},
	40000,
);
