import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { nativeAudioWav } from "./native-audio-fixture";
import { readNativePreparedWav } from "./hyperframes-variable-rate-io";
import type { RateLane, RateSpec } from "./hyperframes-variable-rate-native";
import type { RateOracle } from "./hyperframes-variable-rate-production-media";

const execute = promisify(execFile);
export const LOOP_NATIVE_RATE = 48000;

export async function loopFfmpeg(ffmpeg: string, args: string[]) {
	return execute(
		ffmpeg,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-threads",
			"1",
			...args,
		],
		{
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 32 * 1024 * 1024,
			encoding: "buffer",
		},
	);
}

/** The common IO boundary is source decoding, not loop/rate processing. Mono
 * duplication preserves native amplitude; an implicit -ac 2 would attenuate. */
export function sourceCanonicalFilter(channels: number, frames: number) {
	return [
		"aresample=48000",
		...(channels === 1 ? ["pan=stereo|FL=FL+FC|FR=FR+FC"] : []),
		"aformat=sample_fmts=flt:channel_layouts=stereo",
		`apad=whole_len=${frames}`,
		`atrim=end_sample=${frames}`,
	].join(",");
}

export async function canonicalSourceTile(
	ffmpeg: string,
	source: string,
	trim: number,
	period: number,
	channels: number,
) {
	const frames = Math.round(period * LOOP_NATIVE_RATE);
	const { stdout } = await loopFfmpeg(ffmpeg, [
		"-ss",
		String(trim),
		"-t",
		String(period),
		"-i",
		source,
		"-map",
		"0:a:0",
		"-af",
		sourceCanonicalFilter(channels, frames),
		"-ar",
		"48000",
		"-ac",
		"2",
		"-c:a",
		"pcm_f32le",
		"-f",
		"f32le",
		"pipe:1",
	]);
	assert.equal(stdout.length, frames * 8);
	return stdout;
}

/** Independent sample-domain source extension. This repeats SOURCE samples,
 * never already tempo-adjusted PCM; original native preparation runs once. */
export async function materializeSourceLoop(
	directory: string,
	name: string,
	tile: Buffer,
	frames: number,
	offset = 0,
) {
	assert.ok(tile.length > 0 && tile.length % 8 === 0);
	assert.ok(Number.isSafeInteger(frames) && frames > 0 && frames <= 48000 * 20);
	const period = tile.length / 8;
	const body = nativeAudioWav({
		seconds: frames / LOOP_NATIVE_RATE,
		sampleRate: LOOP_NATIVE_RATE,
		channels: 2,
		sample: (frame, channel) =>
			tile.readFloatLE(((frame + offset) % period) * 8 + channel * 4),
	});
	const path = join(directory, `${name}.wav`);
	await writeFile(path, body, { flag: "wx" });
	return path;
}

export async function prepareLoopReference(
	oracle: RateOracle,
	directory: string,
	name: string,
	source: string,
	duration: number,
	rate: RateSpec,
) {
	const path = join(directory, `${name}-prepared.wav`);
	const result = await oracle.native.prepareAudioTrack(
		source,
		path,
		0,
		duration,
		rate,
		new AbortController().signal,
		{ ffmpegProcessTimeout: 30000 },
	);
	assert.ok(result.success, result.error);
	const reference = await readNativePreparedWav(path);
	const frames = Math.round(duration * LOOP_NATIVE_RATE),
		pcm = Buffer.alloc(frames * 8);
	assert.ok(
		reference.frames <= frames + 1,
		"Original native duration rounding bound",
	);
	reference.pcm.copy(pcm, 0, 0, pcm.length);
	return { ...reference, frames, pcm, path };
}

/** Experimental bounded streaming candidate, NOT a production implementation.
 * Only source wiring precedes the unchanged upstream ramp-filter body. */
export async function prepareStreamingLoop(
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
	const native = oracle.native.buildRampFilterComplex(rate, duration, null);
	assert.ok(native.startsWith("[0:a]asplit="));
	const prefix = `[0:a]${sourceCanonicalFilter(channels, periodFrames)},aloop=loop=${repetitions}:size=${periodFrames},atrim=end_sample=${sourceFrames},asetpts=N/SR/TB[loop];`;
	const filter = prefix + native.replace("[0:a]", "[loop]");
	const filterPath = join(directory, `${name}.filter`);
	await writeFile(filterPath, filter, { flag: "wx" });
	const path = join(directory, `${name}-streamed.wav`);
	await loopFfmpeg(ffmpeg, [
		"-ss",
		String(trim),
		"-t",
		String(period),
		"-i",
		source,
		"-filter_complex_script",
		filterPath,
		"-map",
		"[out]",
		"-acodec",
		"pcm_s16le",
		"-ar",
		"48000",
		"-ac",
		"2",
		"-t",
		String(duration),
		"-y",
		path,
	]);
	const result = await readNativePreparedWav(path);
	const frames = Math.round(duration * LOOP_NATIVE_RATE),
		pcm = Buffer.alloc(frames * 8);
	assert.ok(result.frames <= frames + 1);
	result.pcm.copy(pcm, 0, 0, pcm.length);
	return {
		...result,
		pcm,
		path,
		filter,
		sourceFrames,
		periodFrames,
		repetitions,
		nativeFilter: native,
	};
}
