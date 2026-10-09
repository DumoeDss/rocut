import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import * as wasm from "opencut-wasm";
import {
	materializeHyperframesRateLoop,
	type HyperframesRateSourceLoop,
} from "./hyperframes-rate-loop-source";
import { runNativeMediaProcess } from "./native-media-process";
import type { NativeVideoDecoder } from "./video-decoder";

/** Rust-owned exporter preparation recipe, never accepted from authored JS. */
export interface HyperframesRatePreparation {
	profile: "hyperframes-0.8.139-exporter-prepare-s16-48k-v1";
	mediaStartSeconds: string;
	sourceDurationSeconds: string;
	durationSeconds: string;
	nativeSampleRate: 48000;
	nativeMaxFrames: number;
	nativeMaxBytes: number;
	stereoFilter: string;
	monoFilter: string;
	resampleFilter: string;
	slices: number;
	clockCells: number;
	sourceLoop?: HyperframesRateSourceLoop;
}

async function removeRatePreparation(root: string, parent: string) {
	if (
		dirname(root) !== parent ||
		!basename(root).startsWith("rocut-rate-prepare-")
	)
		throw Error("Unsafe native rate cleanup");
	await rm(root, {
		recursive: true,
		force: true,
		maxRetries: 3,
		retryDelay: 100,
	});
}

/** Canonical full clip -> original s16/48k -> explicit graph-domain resample.
 * Gain/FX/placement/crop stay downstream. This is NOT MediaElement playback.
 * File, demuxer and process confinement match the shared decoder, whose scalar
 * resample/atempo/trim algorithm must not be reused for native ramp semantics.
 */
export async function prepareHyperframesRateAudio({
	decoder,
	body,
	mimeType,
	sampleRate,
	frames,
	recipe,
	signal,
}: {
	decoder: NativeVideoDecoder;
	body: Uint8Array;
	mimeType: string;
	sampleRate: number;
	frames: number;
	recipe: HyperframesRatePreparation;
	signal: AbortSignal;
}): Promise<{ pcm: Buffer; hasAudio: boolean }> {
	signal.throwIfAborted();
	if (!isAbsolute(decoder.ffmpeg) || !isAbsolute(decoder.ffprobe))
		throw Error(
			"Native rate decoder paths must be host-configured absolute paths",
		);
	const validate = (metadata?: {
		channels: number;
		sampleRate: number;
		originSeconds: number;
	}) => {
		const result = JSON.parse(
			wasm.resolveNativeAudioDecodeJson(
				JSON.stringify({
					version: 1,
					mimeType,
					sampleRate,
					frames,
					sourceSample: 0,
					audioStreamIndex: 0,
					playbackRate: 1,
					toneFrequency: 1,
					byteLength: body.byteLength,
					...(metadata ? { metadata } : {}),
				}),
			),
		);
		if (result.error) throw Error(result.error);
		return result as { outputBytes: number };
	};
	const checked = validate();
	if (
		recipe.profile !== "hyperframes-0.8.139-exporter-prepare-s16-48k-v1" ||
		recipe.nativeSampleRate !== 48000 ||
		!Number.isSafeInteger(recipe.nativeMaxBytes) ||
		recipe.nativeMaxBytes < 4 ||
		recipe.nativeMaxBytes !== recipe.nativeMaxFrames * 4
	)
		throw Error("Invalid admitted native rate preparation geometry");
	const demuxer = (
		{
			"audio/wav": "wav",
			"audio/mpeg": "mp3",
			"audio/ogg": "ogg",
			"audio/flac": "flac",
			"video/mp4": "mov",
			"video/webm": "matroska",
		} as Record<string, string>
	)[mimeType];
	const inputArgs = [
		"-protocol_whitelist",
		"file,pipe",
		"-f",
		demuxer,
		...(demuxer === "mov" ? ["-enable_drefs", "0"] : []),
	];
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-rate-prepare-"));
	try {
		const sourcePath = join(root, "source.media");
		await writeFile(sourcePath, body, { flag: "wx" });
		const metadata = JSON.parse(
			(
				await runNativeMediaProcess({
					executable: decoder.ffprobe,
					media: "audio",
					signal,
					maxBytes: 65536,
					args: [
						"-v",
						"error",
						"-threads",
						"1",
						...inputArgs,
						"-show_entries",
						"stream=codec_type,channels,sample_rate,start_time:format=start_time",
						"-of",
						"json",
						sourcePath,
					],
				})
			).toString("utf8"),
		) as {
			streams?: {
				codec_type?: string;
				channels?: number;
				sample_rate?: string;
				start_time?: string;
			}[];
			format?: { start_time?: string };
		};
		if (!Array.isArray(metadata.streams))
			throw Error("Native rate metadata has no streams");
		const audio = metadata.streams.filter(
			(stream) => stream.codec_type === "audio",
		);
		if (!audio.length && mimeType.startsWith("video/"))
			return { pcm: Buffer.alloc(0), hasAudio: false };
		const stream = audio[0];
		if (!stream) throw Error("Native rate audio stream does not exist");
		validate({
			channels: stream.channels!,
			sampleRate: Number(stream.sample_rate),
			originSeconds: Number(
				metadata.streams.find((item) => item.codec_type === "video")
					?.start_time ??
					metadata.format?.start_time ??
					"0",
			),
		});
		const nativeSource = recipe.sourceLoop
			? await materializeHyperframesRateLoop({
					ffmpeg: decoder.ffmpeg,
					root,
					sourcePath,
					inputArgs,
					channels: stream.channels!,
					recipe: recipe.sourceLoop,
					signal,
				})
			: sourcePath;
		const nativeInputArgs = recipe.sourceLoop
			? ["-protocol_whitelist", "file,pipe", "-f", "wav"]
			: inputArgs;
		const nativeChannels = recipe.sourceLoop ? 2 : stream.channels;
		// A 240-slice graph can exceed Windows' command-line bound. Transport the
		// exact Rust-generated graph in a private file; do not rewrite its filters.
		const graphPath = join(root, "native.filter");
		await writeFile(
			graphPath,
			nativeChannels === 1 ? recipe.monoFilter : recipe.stereoFilter,
			{ flag: "wx" },
		);
		const prepared = await runNativeMediaProcess({
			executable: decoder.ffmpeg,
			media: "audio",
			signal,
			maxBytes: recipe.nativeMaxBytes,
			timeoutMs: 300000,
			args: [
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-threads",
				"1",
				...nativeInputArgs,
				"-ss",
				recipe.mediaStartSeconds,
				"-t",
				recipe.sourceDurationSeconds,
				"-i",
				nativeSource,
				"-vn",
				"-sn",
				"-dn",
				"-acodec",
				"pcm_s16le",
				"-ar",
				"48000",
				"-filter_complex_script",
				graphPath,
				"-map",
				"[out]",
				...(nativeChannels === 1 ? [] : ["-ac", "2"]),
				"-t",
				recipe.durationSeconds,
				"-f",
				"s16le",
				"pipe:1",
			],
		});
		if (prepared.length % 4)
			throw Error(
				"Native rate preparation returned incomplete stereo s16 samples",
			);
		if (!prepared.length)
			return { pcm: Buffer.alloc(checked.outputBytes), hasAudio: true };
		const pcmPath = join(root, "prepared.s16le");
		await writeFile(pcmPath, prepared, { flag: "wx" });
		const pcm = await runNativeMediaProcess({
			executable: decoder.ffmpeg,
			media: "audio",
			signal,
			maxBytes: checked.outputBytes,
			timeoutMs: 300000,
			args: [
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-threads",
				"1",
				"-protocol_whitelist",
				"file,pipe",
				"-f",
				"s16le",
				"-ar",
				"48000",
				"-ac",
				"2",
				"-i",
				pcmPath,
				"-af",
				recipe.resampleFilter,
				"-ac",
				"2",
				"-ar",
				String(sampleRate),
				"-c:a",
				"pcm_f32le",
				"-f",
				"f32le",
				"pipe:1",
			],
		});
		if (pcm.length !== checked.outputBytes)
			throw Error("Native rate graph conversion disagrees with Rust geometry");
		return { pcm, hasAudio: true };
	} finally {
		await removeRatePreparation(root, parent);
	}
}
