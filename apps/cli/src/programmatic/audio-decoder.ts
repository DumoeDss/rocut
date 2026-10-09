import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import * as wasm from "opencut-wasm";
import { runNativeMediaProcess } from "./native-media-process";
import type { NativeVideoDecoder } from "./video-decoder";

export interface NativeAudioDecodeRequest {
	mimeType: string; audioStreamIndex: number; sampleRate: number;
	sourceSample: number; frames: number; playbackRate: number; toneFrequency: number;
}
interface MetadataStream { codec_type?: string; channels?: number; sample_rate?: string; start_time?: string }

/** atempo is cascaded to keep pitch while changing speed. toneFrequency is
 * a separate native Remotion option, not a playbackRate alias. */
function tempoFilters(rate: number): string[] {
	const filters: string[] = [];
	while (rate < 0.5) { filters.push("atempo=0.5"); rate /= 0.5; }
	while (rate > 2) { filters.push("atempo=2"); rate /= 2; }
	if (rate !== 1) filters.push(`atempo=${rate}`);
	return filters;
}

/** Admitted bytes to stereo f32LE; sourceSample addresses the tempo-adjusted
 * stream. No audio device, arbitrary path/network, final encoder or mastering.
 */
export async function decodeNativeAudioSegment({ decoder, body, request, signal }: {
	decoder: NativeVideoDecoder; body: Uint8Array; request: NativeAudioDecodeRequest; signal: AbortSignal;
}): Promise<{ pcm: Buffer; hasAudio: boolean }> {
	signal.throwIfAborted();
	if (!isAbsolute(decoder.ffmpeg) || !isAbsolute(decoder.ffprobe)) throw Error("Native audio decoder paths must be host-configured absolute paths");
	const validate = (metadata?: { channels: number; sampleRate: number; originSeconds: number }) => {
		const result = JSON.parse(wasm.resolveNativeAudioDecodeJson(JSON.stringify({
			version: 1, ...request, byteLength: body.byteLength, ...(metadata ? { metadata } : {}),
		})));
		if (result.error) throw Error(result.error);
		return result as { outputBytes: number; channels: number; plan: NativeAudioDecodeRequest };
	};
	const checked = validate(), plan = checked.plan;
	const demuxer = ({ "audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/flac": "flac",
		"video/mp4": "mov", "video/webm": "matroska" } as Record<string, string>)[plan.mimeType];
	const inputArgs = ["-protocol_whitelist", "file,pipe", "-f", demuxer,
		...(demuxer === "mov" ? ["-enable_drefs", "0"] : [])];
	const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-native-audio-"));
	try {
		const input = join(root, "source.media");
		await writeFile(input, body, { flag: "wx" });
		const metadata = JSON.parse((await runNativeMediaProcess({
			executable: decoder.ffprobe, media: "audio", signal, maxBytes: 65536,
			args: ["-v", "error", "-threads", "1", ...inputArgs,
				"-show_entries", "stream=codec_type,channels,sample_rate,start_time:format=start_time", "-of", "json", input],
		})).toString("utf8")) as { streams?: MetadataStream[]; format?: { start_time?: string } };
		if (!Array.isArray(metadata.streams)) throw Error("Native audio metadata has no streams");
		const audio = metadata.streams.filter(stream => stream.codec_type === "audio");
		if (!audio.length && plan.audioStreamIndex === 0 && plan.mimeType.startsWith("video/"))
			return { pcm: Buffer.alloc(0), hasAudio: false };
		const stream = audio[plan.audioStreamIndex];
		if (!stream) throw Error("Selected native audio stream does not exist");
		// Align to the first video's presentation origin, as in native frame IO.
		// Audio-only containers use their start (zero for timestamp-less PCM).
		const video = metadata.streams.find(stream => stream.codec_type === "video");
		const originSeconds = Number(video?.start_time ?? metadata.format?.start_time ?? "0");
		validate({ channels: stream.channels!, sampleRate: Number(stream.sample_rate), originSeconds });
		const filters = [`asetpts=PTS-(${originSeconds})/TB`, `aresample=${plan.sampleRate}:async=1:first_pts=0`,
			...tempoFilters(plan.playbackRate)];
		if (plan.toneFrequency !== 1) filters.push(`asetrate=${plan.sampleRate}*${plan.toneFrequency}`,
			`aresample=${plan.sampleRate}`, ...tempoFilters(1 / plan.toneFrequency));
		filters.push(`atrim=start_sample=${plan.sourceSample}:end_sample=${plan.sourceSample + plan.frames}`,
			"asetpts=PTS-STARTPTS", `apad=whole_len=${plan.frames}`, `atrim=end_sample=${plan.frames}`);
		const pcm = await runNativeMediaProcess({ executable: decoder.ffmpeg, media: "audio", signal, maxBytes: checked.outputBytes,
			args: ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1", "-copyts", ...inputArgs,
				"-i", input, "-map", `0:a:${plan.audioStreamIndex}`, "-vn", "-sn", "-dn", "-af", filters.join(","),
				"-ac", String(checked.channels), "-ar", String(plan.sampleRate), "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
		});
		if (pcm.length % 8 !== 0) throw Error("Native audio decoder returned incomplete stereo samples");
		// After EOF, atrim can emit no buffers and therefore apad cannot run.
		if (pcm.length < checked.outputBytes) {
			const padded = Buffer.alloc(checked.outputBytes); pcm.copy(padded);
			return { pcm: padded, hasAudio: true };
		}
		return { pcm, hasAudio: true };
	} finally {
		if (dirname(root) !== parent || !basename(root).startsWith("rocut-native-audio-")) throw Error("Unsafe native audio decoder cleanup");
		await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
