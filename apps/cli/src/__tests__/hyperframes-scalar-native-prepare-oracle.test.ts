import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nativePreparationSource } from "../../../../script/fixtures/hyperframes-variable-rate-source";
import { hyperframesNativePreparationOutputArgs } from "../programmatic/hyperframes-native-prepare-args";
import type { HyperframesRatePreparation } from "../programmatic/hyperframes-rate-prepare";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const archive = process.env.ROCUT_TEST_HYPERFRAMES_ARCHIVE;

test.skipIf(!toolchain || !archive)("scalar output argument policy matches fixed native prepareAudioTrack without media IO", async () => {
	const original = await nativePreparationSource(toolchain!, archive!);
	const core = join(toolchain!, "node_modules/@hyperframes/core/dist");
	const playback = await import(pathToFileURL(join(core, "runtime/playbackRate.js")).href);
	const speed = await import(pathToFileURL(join(core, "speedRamp.js")).href);
	for (const channels of [1, 2]) {
		const captures: string[][] = [];
		const bindings = {
			existsSync: () => true, mkdirSync: () => {}, dirname: () => "unused",
			normalizePlaybackRate: playback.normalizePlaybackRate,
			normalizeRateSpec: playback.normalizeRateSpec, sourceTimeAt: speed.sourceTimeAt,
			extractAudioMetadata: async () => ({ channels }),
			runFfmpeg: async (args: string[]) => { captures.push(args); return { success: true }; },
		};
		const native = new Function(...Object.keys(bindings), original.code)(...Object.values(bindings));
		for (const rate of [1, 1.5, 0.25, 4]) {
			const trim = 0.1 + 0.25 / 44100, duration = 0.5 + 0.25 / 44100;
			await native.prepareAudioTrack("source.media", "output.wav", trim, duration, rate);
			const originalArgs = captures.at(-1)!;
			expect(originalArgs.slice(0, 6)).toEqual(["-ss", String(trim), "-t", String(duration * rate), "-i", "source.media"]);
			const stereoFilter = rate === 1 ? "" : rate === 1.5 ? "atempo=1.5"
				: rate === 0.25 ? "atempo=0.5,atempo=0.5" : "atempo=2,atempo=2";
			const receipt = {
				preparationKind: "scalar", outputDurationRequired: rate !== 1, observedPcm: true,
				durationSeconds: String(duration), stereoFilter,
				monoFilter: "pan=stereo|FL=FL+FC|FR=FR+FC" + (stereoFilter ? "," + stereoFilter : ""),
			} as HyperframesRatePreparation;
			const prefix = originalArgs.indexOf("48000") + 1;
			expect(hyperframesNativePreparationOutputArgs(receipt, channels, "unused")).toEqual(originalArgs.slice(prefix, -2));
		}
	}
});
