import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { nativeAudioWav } from "./native-audio-fixture";
import {
	variableRateSample,
	type VariableRateCase,
} from "./hyperframes-variable-rate-cases";
import { readNativePreparedWav } from "./hyperframes-variable-rate-io";
import type {
	loadVariableRateNative,
	RateSpec,
} from "./hyperframes-variable-rate-native";

const execute = promisify(execFile);
export type RateOracle = Awaited<ReturnType<typeof loadVariableRateNative>>;
export type RateMediaKind =
	| "wav"
	| "mp4-audio"
	| "mp4-silent"
	| "webm-audio"
	| "webm-silent";

async function ffmpegRun(ffmpeg: string, args: string[]) {
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

/** Real encoded test media, never a WAV body labelled as video. */
export async function rateProductionMedia(
	directory: string,
	ffmpeg: string,
	test: VariableRateCase,
	kind: RateMediaKind,
) {
	const name = `${test.id}-${kind}`;
	const wav = nativeAudioWav({
		seconds: 4,
		sampleRate: test.sampleRate,
		channels: test.channels,
		sample: variableRateSample(test.sampleRate),
	});
	const wavPath = join(directory, `${name}-source.wav`);
	await writeFile(wavPath, wav, { flag: "wx" });
	if (kind === "wav")
		return {
			name,
			kind,
			path: wavPath,
			body: wav,
			mimeType: "audio/wav",
			hasAudio: true,
		};
	const mp4 = kind.startsWith("mp4"),
		hasAudio = kind.endsWith("-audio");
	const path = join(directory, `${name}.${mp4 ? "mp4" : "webm"}`);
	await ffmpegRun(ffmpeg, [
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=32x24:r=10:d=4",
		...(hasAudio
			? ["-i", wavPath, "-map", "0:v:0", "-map", "1:a:0"]
			: ["-map", "0:v:0", "-an"]),
		"-c:v",
		mp4 ? "libx264" : "libvpx-vp9",
		"-threads",
		"1",
		"-pix_fmt",
		"yuv420p",
		...(mp4
			? ["-preset", "ultrafast"]
			: ["-deadline", "realtime", "-cpu-used", "8"]),
		...(hasAudio ? ["-c:a", mp4 ? "aac" : "libopus", "-b:a", "128k"] : []),
		"-t",
		"4",
		"-y",
		path,
	]);
	return {
		name,
		kind,
		path,
		body: await readFile(path),
		mimeType: mp4 ? "video/mp4" : "video/webm",
		hasAudio,
	};
}

export type RateProductionMedia = Awaited<
	ReturnType<typeof rateProductionMedia>
>;

/** Original exporter output, read independently as PCM16 before any conversion. */
export async function rateProductionReference(
	oracle: RateOracle,
	directory: string,
	media: RateProductionMedia,
	test: VariableRateCase,
	rate: RateSpec,
) {
	if (!media.hasAudio) return undefined;
	const path = join(directory, `${media.name}-native.wav`);
	const signal = new AbortController().signal,
		config = { ffmpegProcessTimeout: 30000 };
	const result =
		media.kind === "wav"
			? await oracle.native.prepareAudioTrack(
					media.path,
					path,
					test.mediaStart,
					test.duration,
					rate,
					signal,
					config,
				)
			: await oracle.native.extractAudioFromVideo(
					media.path,
					path,
					{
						startTime: test.mediaStart,
						duration: test.duration,
						playbackRate: rate,
					},
					signal,
					config,
				);
	assert.ok(result.success, result.error);
	return { path, ...(await readNativePreparedWav(path)) };
}

/** Independent reference conversion; no Rust recipe/filter strings are reused. */
export async function rateReferenceAtGraphRate(
	ffmpeg: string,
	reference: Awaited<ReturnType<typeof rateProductionReference>>,
	duration: number,
	sampleRate: number,
) {
	const frames = Math.round(duration * sampleRate),
		output = Buffer.alloc(frames * 8);
	if (!reference) return output;
	if (sampleRate === 48000) {
		assert.ok(reference.frames <= frames + 1, "Native preparation frame bound");
		reference.pcm.copy(output, 0, 0, output.length);
		return output;
	}
	const { stdout } = await ffmpegRun(ffmpeg, [
		"-i",
		reference.path,
		"-map",
		"0:a:0",
		"-af",
		`aresample=${sampleRate},apad`,
		"-t",
		String(duration),
		"-ac",
		"2",
		"-ar",
		String(sampleRate),
		"-c:a",
		"pcm_f32le",
		"-f",
		"f32le",
		"pipe:1",
	]);
	assert.equal(
		stdout.length,
		output.length,
		"Reference graph-rate PCM geometry",
	);
	return stdout;
}
