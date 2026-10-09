import * as wasm from "opencut-wasm";
import { decodeNativeAudioSegment } from "./audio-decoder";
import type { NativeAudioObservation, NativeAudioSource, NativeGainEnvelope } from "./remotion-audio-analysis";
import type { NativeVideoDecoder } from "./video-decoder";

export interface NativeAudioFrame { frameIndex: number; assets: NativeAudioObservation[] }
interface Gain { offset: number; frames: number; value: number; envelope?: NativeGainEnvelope }
interface Segment {
	resourceId: string; audioStreamIndex: number; playbackRate: number; toneFrequency: number;
	sourceSample: number; outputStart: number; frames: number; gains: Gain[];
}
interface Schedule { sampleRate: number; sampleOrigin: number; channels: number; outputFrames: number; segments: Segment[] }

/** Native observations -> decoded PCM -> Rust mix. This is an internal source
 * soundtrack, not a separate exporter or a substitute for Rocut's final master.
 */
export async function renderNativeAudioObservations({ frames, sources, frameRate, firstFrame, sampleRate, decoder, signal }: {
	frames: NativeAudioFrame[]; sources: NativeAudioSource[];
	frameRate: { numerator: number; denominator: number }; firstFrame: number;
	sampleRate: 44100 | 48000; decoder: NativeVideoDecoder; signal: AbortSignal;
}): Promise<{ pcm: Buffer; sampleRate: number; channels: number; frames: number; hasAudio: boolean }> {
	signal.throwIfAborted();
	const result = JSON.parse(wasm.resolveProgrammaticAudioScheduleJson(JSON.stringify({
		version: 1, frameRate, firstFrame, sampleRate, frames,
	}))) as { plan?: Schedule; error?: string };
	if (result.error || !result.plan) throw Error(result.error ?? "Missing native audio schedule");
	const plan = result.plan, policy = JSON.parse(wasm.programmaticAudioPolicyJson());
	const sourceMap = new Map(sources.map(source => [source.id, source]));
	if (sourceMap.size !== sources.length) throw Error("Duplicate native audio source identity");
	const buffers: Buffer[] = [], cache = new Map<string, number>();
	const clips: { pcmIndex: number; outputStart: number; frames: number; gains: Gain[] }[] = [];
	let total = 0;
	for (const segment of plan.segments) {
		signal.throwIfAborted();
		const source = sourceMap.get(segment.resourceId);
		if (!source) throw Error("Native audio schedule references an unadmitted source");
		const request = { mimeType: source.mimeType, audioStreamIndex: segment.audioStreamIndex,
			sampleRate: plan.sampleRate, sourceSample: segment.sourceSample, frames: segment.frames,
			playbackRate: segment.playbackRate, toneFrequency: segment.toneFrequency };
		const key = JSON.stringify([segment.resourceId, request]);
		let pcmIndex = cache.get(key);
		if (pcmIndex === undefined) {
			if (total + segment.frames * 8 > policy.maxPcmBytes) throw Error("Native audio PCM cache exceeds the Rust budget");
			const decoded = await decodeNativeAudioSegment({ decoder, body: source.body, request, signal });
			signal.throwIfAborted();
			pcmIndex = decoded.hasAudio ? buffers.length : -1;
			if (decoded.hasAudio) { buffers.push(decoded.pcm); total += decoded.pcm.length; }
			cache.set(key, pcmIndex);
		}
		if (pcmIndex >= 0) clips.push({ pcmIndex, outputStart: segment.outputStart, frames: segment.frames, gains: segment.gains });
	}
	const manifest = Buffer.from(JSON.stringify({ version: 1, sampleRate: plan.sampleRate, sampleOrigin: plan.sampleOrigin, channels: plan.channels,
		outputFrames: plan.outputFrames, pcmBytes: buffers.map(body => body.length), clips }));
	const header = Buffer.alloc(4); header.writeUInt32LE(manifest.length);
	signal.throwIfAborted();
	const pcm = Buffer.from(wasm.mixProgrammaticAudioPcm(Buffer.concat([header, manifest, ...buffers])));
	signal.throwIfAborted();
	return { pcm, sampleRate: plan.sampleRate, channels: plan.channels, frames: plan.outputFrames, hasAudio: clips.length > 0 };
}
