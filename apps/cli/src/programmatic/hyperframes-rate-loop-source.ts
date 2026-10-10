import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runNativeMediaProcess } from "./native-media-process";
import type { HyperframesLoopSourceOwner } from "./hyperframes-loop-source-owner";
import { hyperframesFloatWav } from "./hyperframes-loop-source-wav";

/** Geometry, filters, finite repetition and reservations are Rust-owned. */
export interface HyperframesRateSourceLoop {
	mediaStartSeconds: string;
	sourceDurationSeconds: string;
	periodFrames: number;
	sourceFrames: number;
	repeatCount: number;
	maxWavBytes: number;
	workingSetBytes: number;
	stereoFilter: string;
	monoFilter: string;
	nativeBufferClock?: {
		profile: "hyperframes-0.8.139-native-buffer-loop-clock-v1";
		sampleRate: 48000;
		outputFrames: number;
		maxSourceFrames: number;
		periodSeconds: number;
		durationSeconds: number;
		segments: readonly { elapsedSeconds: number; mediaStartSeconds: number; durationSeconds: number }[];
	};
}

/** Bounded IO only. A separate canonical stereo float WAV is intentional:
 * inlining source pan/aloop into the atempo graph changes real mono PCM.
 * This repeats source-domain audio before rate preparation, never prepared PCM.
 */
export async function materializeHyperframesRateLoop({
	ffmpeg,
	root,
	sourcePath,
	inputArgs,
	channels,
	recipe,
	signal,
	body,
	owner,
}: {
	ffmpeg: string;
	root: string;
	sourcePath: string;
	inputArgs: string[];
	channels: number;
	recipe: HyperframesRateSourceLoop;
	signal: AbortSignal;
	body?: Uint8Array;
	owner?: HyperframesLoopSourceOwner;
}) {
	if (!Number.isSafeInteger(recipe.maxWavBytes) || recipe.maxWavBytes < 44)
		throw Error("Invalid admitted source-loop WAV bound");
	if (recipe.nativeBufferClock) {
		if (!owner || !body) throw Error("Fractional HyperFrames loop requires its native source-clock owner");
		const pcm = await owner.materialize({ body, recipe, signal });
		signal.throwIfAborted();
		const wav = hyperframesFloatWav(pcm, recipe.sourceFrames, recipe.maxWavBytes);
		const path = join(root, "loop-source.wav");
		await writeFile(path, wav, { flag: "wx" });
		return path;
	}
	const wav = await runNativeMediaProcess({
		executable: ffmpeg,
		media: "audio",
		signal,
		maxBytes: recipe.maxWavBytes,
		timeoutMs: 300000,
		args: [
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-threads",
			"1",
			...inputArgs,
			"-ss",
			recipe.mediaStartSeconds,
			"-t",
			recipe.sourceDurationSeconds,
			"-i",
			sourcePath,
			"-vn",
			"-sn",
			"-dn",
			"-map",
			"0:a:0",
			"-map_metadata",
			"-1",
			"-af",
			channels === 1 ? recipe.monoFilter : recipe.stereoFilter,
			"-c:a",
			"pcm_f32le",
			"-ar",
			"48000",
			"-ac",
			"2",
			"-f",
			"wav",
			"pipe:1",
		],
	});
	if (
		wav.length < 44 ||
		wav.toString("ascii", 0, 4) !== "RIFF" ||
		wav.toString("ascii", 8, 12) !== "WAVE"
	)
		throw Error("Native loop source did not return a bounded canonical WAV");
	signal.throwIfAborted();
	const path = join(root, "loop-source.wav");
	await writeFile(path, wav, { flag: "wx" });
	return path;
}
