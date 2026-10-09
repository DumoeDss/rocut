import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	loopFfmpeg,
	LOOP_NATIVE_RATE,
	prepareLoopReference,
	sourceCanonicalFilter,
} from "./hyperframes-variable-rate-loop-media";
import type { RateLane } from "./hyperframes-variable-rate-native";
import type { RateOracle } from "./hyperframes-variable-rate-production-media";

/** Source-domain streaming is materialized BEFORE native tempo preparation.
 * Inline pan/aloop+ramp is an observed wrong implementation for real mono PCM;
 * a separate canonical stereo Float32 WAV avoids changing the native input seam.
 * This fixture still does not establish any production Rust support. */
export async function prepareStagedLoop(
	oracle: RateOracle,
	ffmpeg: string,
	directory: string,
	name: string,
	source: string,
	trim: number,
	period: number,
	channels: number,
	duration: number,
	rate: RateLane,
) {
	const periodFrames = Math.round(period * LOOP_NATIVE_RATE);
	const consumed = oracle.speed.sourceTimeAt(rate, duration);
	const sourceFrames = Math.round(consumed * LOOP_NATIVE_RATE);
	const repetitions = Math.max(0, Math.ceil(sourceFrames / periodFrames) - 1);
	const sourceFilter = `${sourceCanonicalFilter(channels, periodFrames)},aloop=loop=${repetitions}:size=${periodFrames},atrim=end_sample=${sourceFrames},asetpts=N/SR/TB`;
	const sourcePath = join(directory, `${name}-staged-source.wav`);
	await loopFfmpeg(ffmpeg, [
		"-ss",
		String(trim),
		"-t",
		String(period),
		"-i",
		source,
		"-map",
		"0:a:0",
		"-af",
		sourceFilter,
		"-acodec",
		"pcm_f32le",
		"-ar",
		"48000",
		"-ac",
		"2",
		"-y",
		sourcePath,
	]);
	const result = await prepareLoopReference(
		oracle,
		directory,
		`${name}-staged`,
		sourcePath,
		duration,
		rate,
	);
	const nativeFilter = oracle.native.buildRampFilterComplex(
		rate,
		duration,
		null,
	);
	const lastCall = oracle.io.calls.at(-1);
	assert.ok(lastCall?.success && lastCall.args.includes(nativeFilter));
	await writeFile(
		join(directory, `${name}-staged.filter`),
		sourceFilter + "\n" + nativeFilter + "\n",
		{ flag: "wx" },
	);
	return {
		...result,
		sourcePath,
		filter: sourceFilter,
		sourceFrames,
		periodFrames,
		repetitions,
		nativeFilter,
	};
}
