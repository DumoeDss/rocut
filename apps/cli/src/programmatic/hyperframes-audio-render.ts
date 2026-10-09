import * as wasm from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { withHyperframesAudioAnalyzer } from "./hyperframes-audio-analysis";
import { renderNativeAudioObservations, type NativeAudioFrame } from "./native-audio-render";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";

/** Archived native HyperFrames media -> Rocut source PCM, never an upstream
 * video exporter. Uses the same absolute rational sample clock as Remotion.
 */
export async function renderHyperframesAudioRange({ source, firstFrame, frameCount, sampleRate,
	executable, decoder, resourceStore, signal }: {
	source: ProgrammaticSource; firstFrame: number; frameCount: number; sampleRate: 44100 | 48000;
	executable: string; decoder: NativeVideoDecoder; resourceStore: ProgrammaticResourceStore; signal: AbortSignal;
}) {
	signal.throwIfAborted();
	if (source.runtime !== "html-document" || source.build?.engine !== "hyperframes")
		throw Error("Native audio rendering requires a compiled HyperFrames source");
	const range = JSON.parse(wasm.resolveProgrammaticAudioRangeJson(JSON.stringify({ version: 1,
		frameRate: source.frameRate, durationFrames: source.durationFrames, firstFrame, frameCount, sampleRate,
	})));
	if (range.error || !range.plan) throw Error(range.error ?? "Missing native audio range");
	const plan = range.plan, policy = JSON.parse(wasm.programmaticAudioPolicyJson());
	const frames: NativeAudioFrame[] = [];
	const timing = (index: number) => ({ source, clipStart: 0, clipDuration: source.durationFrames * plan.ticksPerFrame,
		trimStart: 0, timelineTime: index * plan.ticksPerFrame });
	let observationBytes = 1024;
	const sources = await withHyperframesAudioAnalyzer({ executable, resourceStore, signal, request: timing(firstFrame) }, async analyzer => {
		for (let index = firstFrame; index < firstFrame + frameCount; index++) {
			signal.throwIfAborted();
			const analyzed = await analyzer.frame(timing(index));
			if (analyzed.frameIndex !== index) throw Error("HyperFrames audio frame clock disagrees with the admitted range");
			const frame = { frameIndex: index, assets: analyzed.assets };
			observationBytes += Buffer.byteLength(JSON.stringify(frame)) + 1;
			if (observationBytes > policy.maxObservationBytes) throw Error("Native audio observations exceed the Rust budget");
			frames.push(frame);
		}
		return analyzer.sources;
	});
	const rendered = await renderNativeAudioObservations({ frames, sources, frameRate: source.frameRate,
		firstFrame, sampleRate, decoder, signal });
	if (rendered.frames !== plan.outputFrames) throw Error("HyperFrames audio sample clock disagrees with the admitted range");
	return { ...rendered, firstFrame, frameCount, sampleOrigin: plan.sampleOrigin as number };
}
