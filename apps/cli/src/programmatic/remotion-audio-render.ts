import * as wasm from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { withRemotionAudioAnalyzer } from "./remotion-audio-analysis";
import { renderNativeAudioObservations, type NativeAudioFrame } from "./native-audio-render";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";

/** Compile/archive output -> native components -> source soundtrack.
 * Internal only until editor preview and final mixing share this provider.
 * Every frame gets a fresh target in one owned private browser.
 */
export async function renderRemotionAudioRange({ source, firstFrame, frameCount, sampleRate,
	executable, decoder, resourceStore, signal }: {
	source: ProgrammaticSource; firstFrame: number; frameCount: number; sampleRate: 44100 | 48000;
	executable: string; decoder: NativeVideoDecoder; resourceStore: ProgrammaticResourceStore; signal: AbortSignal;
}) {
	signal.throwIfAborted();
	if (source.runtime !== "html-document" || source.build?.engine !== "remotion")
		throw Error("Native audio rendering requires a compiled Remotion source");
	// Bound work BEFORE collecting frames, including very high-fps compositions.
	const range = JSON.parse(wasm.resolveProgrammaticAudioRangeJson(JSON.stringify({ version: 1,
		frameRate: source.frameRate, durationFrames: source.durationFrames, firstFrame, frameCount, sampleRate,
	})));
	if (range.error || !range.plan) throw Error(range.error ?? "Missing native audio range");
	const plan = range.plan, policy = JSON.parse(wasm.programmaticAudioPolicyJson());
	const frames: NativeAudioFrame[] = [];
	const timing = (index: number) => ({ source, clipStart: 0, clipDuration: source.durationFrames * plan.ticksPerFrame,
		trimStart: 0, timelineTime: index * plan.ticksPerFrame });
	let observationBytes = 1024;
	const sources = await withRemotionAudioAnalyzer({ executable, resourceStore, signal, request: timing(firstFrame) }, async analyzer => {
		for (let index = firstFrame; index < firstFrame + frameCount; index++) {
			signal.throwIfAborted();
			const analyzed = await analyzer.frame(timing(index));
			if (analyzed.frameIndex !== index) throw Error("Native audio frame clock disagrees with the admitted range");
			const frame = { frameIndex: index, assets: analyzed.assets };
			observationBytes += Buffer.byteLength(JSON.stringify(frame)) + 1;
			if (observationBytes > policy.maxObservationBytes) throw Error("Native audio observations exceed the Rust budget");
			frames.push(frame);
		}
		return analyzer.sources;
	});
	const rendered = await renderNativeAudioObservations({ frames, sources, frameRate: source.frameRate,
		firstFrame, sampleRate, decoder, signal });
	if (rendered.frames !== plan.outputFrames) throw Error("Native audio sample clock disagrees with the admitted range");
	return { ...rendered, firstFrame, frameCount, sampleOrigin: plan.sampleOrigin as number };
}
