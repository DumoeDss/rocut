import { expect, test } from "bun:test";
import { pinnedAudioProject } from "./remotion-pinned-audio-fixture";
import {
	pinnedAudioMixedRms,
	pinnedAudioPcmFrameRms,
} from "./remotion-pinned-audio-oracle";
import { renderRemotionAudioRange } from "../programmatic/remotion-audio-render";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
const enabled =
	process.env.ROCUT_RUN_REMOTION_PINNED_AUDIO_PCM === "1" &&
	executable &&
	toolchainDirectory &&
	ffmpeg &&
	ffprobe;

test.skipIf(!enabled)(
	"real pinned Remotion native audio range mixes non-silent PCM with expected gain and silence edges",
	async () => {
		const fixture = await pinnedAudioProject({
			toolchainDirectory: toolchainDirectory!,
			executable: executable!,
			mode: "stable",
		});
		try {
			const render = ({
				firstFrame,
				frameCount,
			}: {
				firstFrame: number;
				frameCount: number;
			}) =>
				renderRemotionAudioRange({
					source: fixture.source,
					firstFrame,
					frameCount,
					sampleRate: 48000,
					executable: executable!,
					decoder: { ffmpeg: ffmpeg!, ffprobe: ffprobe! },
					resourceStore: fixture.context,
					signal: AbortSignal.timeout(90000),
				});
			const result = await render({ firstFrame: 4, frameCount: 10 });
			expect(result).toMatchObject({
				firstFrame: 4,
				frameCount: 10,
				sampleOrigin: 6400,
				frames: 16000,
				channels: 2,
				sampleRate: 48000,
				hasAudio: true,
			});
			expect(result.pcm.length).toBe(16000 * 8);
			for (let offset = 0; offset < 10; offset++) {
				const frame = offset + 4,
					rms = pinnedAudioPcmFrameRms({
						pcm: result.pcm,
						frameOffset: offset,
					}),
					expected = pinnedAudioMixedRms(frame);
				if (frame === 4 || frame === 13) expect(rms).toBe(0);
				else {
					expect(rms).toBeGreaterThan(0.08);
					// A waveform energy check, not a duplicate of the native mixer.
					// 0.003 allows time-stretch boundary phase variation but rejects
					// source default gain, omitted returned props, or missing native gain.
					expect(Math.abs(rms - expected)).toBeLessThan(0.003);
				}
			}
			for (const frame of [0, 13]) {
				const silence = await render({ firstFrame: frame, frameCount: 1 });
				expect(silence).toMatchObject({
					hasAudio: false,
					frames: 1600,
					sampleOrigin: frame * 1600,
				});
				expect(silence.pcm.every((byte) => byte === 0)).toBe(true);
			}
		} finally {
			await fixture.cleanup();
		}
	},
	180000,
);
