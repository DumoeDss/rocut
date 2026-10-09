import { expect, test } from "bun:test";
import { withLifecycleProject } from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-project";
import { renderHyperframesGraphAudioRange } from "../programmatic/hyperframes-graph-audio";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_GRAPH_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_GRAPH_FFPROBE;

test.skipIf(!toolchain || !ffmpeg || !ffprobe)(
	"archived native engine → subframe discovery → stable graph → real decoded PCM",
	async () => {
		await withLifecycleProject(
			toolchain!,
			async ({ source, options }) => {
				const input = {
					...options,
					source,
					firstFrame: 0,
					frameCount: source.durationFrames,
					sampleRate: 48000 as const,
					toolchainDirectory: toolchain!,
					decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! },
				};
				const full = await renderHyperframesGraphAudioRange(input);
				expect(full.frames).toBe(15360);
				expect(full.sampleOrigin).toBe(0);
				expect(full.hasAudio).toBe(true);
				// Dedicated source is a .125 constant, 2ms clip starts at .101s.
				// Neither endpoint nor interior falls on a 25fps video frame.
				let nonzero = 0,
					maxError = 0;
				for (let frame = 0; frame < full.frames; frame++) {
					const expected =
						frame >= 4848 && frame < 4944
							? Math.fround(
									0.125 * Math.fround(0.25 + (0.5 * (frame - 4848)) / 96),
								)
							: 0;
					const actual = full.pcm.readFloatLE(frame * 8);
					if (actual !== 0) nonzero++;
					maxError = Math.max(maxError, Math.abs(expected - actual));
				}
				expect(nonzero).toBe(96);
				expect(maxError).toBeLessThan(1e-7);
				const crop = await renderHyperframesGraphAudioRange({
					...input,
					firstFrame: 2,
					frameCount: 1,
				});
				expect(crop.sampleOrigin).toBe(3840);
				expect(crop.frames).toBe(1920);
				expect(crop.pcm.equals(full.pcm.subarray(3840 * 8, 5760 * 8))).toBe(
					true,
				);
				expect(full.provenance.nativeVersion).toBe("0.8.139");
			},
			new URL(
				"../../../../script/fixtures/hyperframes-audio-native-seek.html",
				import.meta.url,
			),
		);
	},
	40000,
);
