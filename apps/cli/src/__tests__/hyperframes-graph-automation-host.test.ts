import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { withLifecycleProject } from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-project";
import { createFxAutomationOracle } from "../../../../script/fixtures/hyperframes-fx-automation-fixture";
import { createHttpProgrammaticFrames } from "../../../vite-example/src/host/http-programmatic-frames";
import { createProgrammaticAudioService } from "../programmatic/audio-service";

const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_GRAPH_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_GRAPH_FFPROBE;

test.skipIf(!toolchainDirectory || !ffmpeg || !ffprobe)(
	"archived FX automation uses track-local and bus-global native clocks through real Host HTTP",
	async () => {
		await withLifecycleProject(
			toolchainDirectory!,
			async ({ source, options }, controller) => {
				const service = createProgrammaticAudioService({
					resourceStore: options.resourceStore,
					executable: options.executable,
					decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! },
					connectionFile: "",
					toolchainDirectory,
				});
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
					throw Error("Missing Host test address");
				const http = createHttpProgrammaticFrames({
					base: `http://127.0.0.1:${address.port}`,
				});
				let oracle:
					| Awaited<ReturnType<typeof createFxAutomationOracle>>
					| undefined;
				try {
					const expectedIdentity = await http.getAudioIdentity!({
						request: { source, sampleRate: 48000 },
						signal: options.signal,
					});
					const request = {
						source,
						firstFrame: 0,
						frameCount: 8,
						sampleRate: 48000,
						expectedIdentity,
					};
					const full = await http.renderAudio!({
						request,
						signal: options.signal,
					});
					expect(full.hasAudio).toBe(true);
					expect(full.frames).toBe(15360);
					oracle = await createFxAutomationOracle(
						toolchainDirectory!,
						controller,
					);
					const dry = Buffer.alloc(7680 * 8);
					for (let offset = 0; offset < dry.length; offset += 4)
						dry.writeFloatLE(0.125, offset);
					const track = await oracle.render(
						{
							sampleRate: 48000,
							chain: {
								version: 1,
								nodes: [
									{ id: "g", type: "gain", params: { gain: 0 } },
									{
										id: "d",
										type: "delay",
										params: { time: 20, feedback: 0.01, mix: 0.5 },
									},
								],
							},
							automation: {
								version: 1,
								lanes: [
									{
										target: "fx.g.gain",
										points: [
											{ t: 0, v: -12, curve: 0.5 },
											{ t: 0.16, v: 0 },
										],
									},
									{
										target: "fx.d.time",
										points: [
											{ t: 0, v: 10 },
											{ t: 0.16, v: 20 },
										],
									},
								],
							},
						},
						dry,
					);
					expect(track.frames).toBe(9600);
					const sum = Buffer.alloc(15360 * 8);
					for (let i = 0; i < track.frames; i++)
						for (let c = 0; c < 2; c++)
							sum.writeFloatLE(
								Math.fround(track.pcm.readFloatLE(i * 8 + c * 4) * 0.5),
								(3840 + i) * 8 + c * 4,
							);
					const bus = await oracle.render(
						{
							sampleRate: 48000,
							chain: {
								version: 1,
								nodes: [{ id: "bus-gain", type: "gain", params: { gain: 0 } }],
							},
							automation: {
								version: 1,
								lanes: [
									{
										target: "fx.bus-gain.gain",
										points: [
											{ t: 0, v: -12, viaX: 0.3, viaY: 0.7 },
											{ t: 0.32, v: 0 },
										],
									},
								],
							},
						},
						sum,
					);
					let maxError = 0,
						peak = 0;
					const actual = Buffer.from(full.pcm);
					for (let offset = 0; offset < actual.length; offset += 4) {
						const expected = Math.fround(bus.pcm.readFloatLE(offset) * 0.5);
						maxError = Math.max(
							maxError,
							Math.abs(actual.readFloatLE(offset) - expected),
						);
						peak = Math.max(peak, Math.abs(actual.readFloatLE(offset)));
					}
					expect(maxError).toBeLessThan(2e-7);
					expect(peak).toBeGreaterThan(0.01);
					await oracle.close();
					oracle = undefined;
					const crop = await http.renderAudio!({
						request: { ...request, firstFrame: 3, frameCount: 3 },
						signal: options.signal,
					});
					expect(crop.sampleOrigin).toBe(5760);
					expect(
						Buffer.from(crop.pcm).equals(actual.subarray(5760 * 8, 11520 * 8)),
					).toBe(true);
				} finally {
					await oracle?.close();
					await service.dispose();
					server.closeAllConnections();
					await new Promise<void>((resolve) => server.close(() => resolve()));
				}
			},
			new URL(
				"../../../../script/fixtures/hyperframes-graph-automation-host.html",
				import.meta.url,
			),
			{ version: 1, mode: "native", profile: "hyperframes-graph-v1" },
		);
	},
	40000,
);
