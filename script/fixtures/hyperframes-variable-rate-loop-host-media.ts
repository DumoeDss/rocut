import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import {
	variableRateSample,
	type VariableRateCase,
} from "./hyperframes-variable-rate-cases";
import {
	canonicalSourceTile,
	loopFfmpeg,
	materializeSourceLoop,
	prepareLoopReference,
} from "./hyperframes-variable-rate-loop-media";
import type { RateLane } from "./hyperframes-variable-rate-native";
import type { RateOracle } from "./hyperframes-variable-rate-production-media";

export type LoopHostKind = "wav" | "mp4-audio" | "mp4-silent";

/** Genuine short encoded video/audio. The independently materialized reference
 * decodes the REAL encoded audio, preserving AAC effects and mono amplitude. */
export async function loopHostMedia(
	directory: string,
	ffmpeg: string,
	oracle: RateOracle,
	kind: LoopHostKind,
	test: VariableRateCase,
	rate: RateLane,
) {
	const name = `${test.id}-${kind}-loop-host`,
		sourceDuration = 0.4;
	const wavPath = join(directory, `${name}-source.wav`);
	await writeFile(
		wavPath,
		nativeAudioWav({
			seconds: sourceDuration,
			sampleRate: test.sampleRate,
			channels: test.channels,
			sample: variableRateSample(test.sampleRate),
		}),
		{ flag: "wx" },
	);
	const hasAudio = kind !== "mp4-silent",
		path = kind === "wav" ? wavPath : join(directory, `${name}.mp4`);
	if (kind !== "wav")
		await loopFfmpeg(ffmpeg, [
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=32x24:r=25:d=0.4",
			...(hasAudio
				? ["-i", wavPath, "-map", "0:v:0", "-map", "1:a:0"]
				: ["-map", "0:v:0", "-an"]),
			"-c:v",
			"libx264",
			"-threads",
			"1",
			"-preset",
			"ultrafast",
			"-pix_fmt",
			"yuv420p",
			...(hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : []),
			"-t",
			String(sourceDuration),
			"-y",
			path,
		]);
	const media = {
		name,
		kind,
		path,
		body: await readFile(path),
		mimeType: kind === "wav" ? "audio/wav" : "video/mp4",
		hasAudio,
	};
	if (!hasAudio) return { media, reference: undefined, sourceDuration };
	const tile = await canonicalSourceTile(
		ffmpeg,
		path,
		test.mediaStart,
		sourceDuration - test.mediaStart,
		test.channels,
	);
	assert.equal(
		tile.length / 8,
		Math.round((sourceDuration - test.mediaStart) * 48000),
	);
	const sourceFrames =
		Math.ceil(oracle.speed.sourceTimeAt(rate, test.duration) * 48000) + 480;
	const virtual = await materializeSourceLoop(
		directory,
		`${name}-independent-source`,
		tile,
		sourceFrames,
	);
	const reference = await prepareLoopReference(
		oracle,
		directory,
		`${name}-independent`,
		virtual,
		test.duration,
		rate,
	);
	return { media, reference, sourceDuration };
}
