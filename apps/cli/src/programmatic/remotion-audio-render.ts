import * as wasm from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { withRemotionAudioAnalyzer } from "./remotion-audio-analysis";
import { renderNativeAudioObservations, type NativeAudioFrame } from "./native-audio-render";
import type { ProgrammaticResourceStore } from "./resources";
import type { NativeVideoDecoder } from "./video-decoder";
import {createRemotionArtifactSink,type RemotionAdmittedArtifact} from "./remotion-artifact-sink";
import {prepareRemotionInlineSource,type RemotionInlineSource} from "./remotion-inline-prepare";
import type {NativeAudioAnalysisConfig} from "./remotion-audio-bootstrap";

function producedBinding(name:string):(...args:any[])=>any {
	const binding=(wasm as unknown as Record<string,unknown>)[name];
	if(typeof binding!=="function")throw Error(`Remotion produced runtime requires rebuilt WASM export ${name}`);
	return binding as (...args:any[])=>any;
}

/** Compile/archive output -> native components -> owned soundtrack/sidecars.
 * Authenticated Host consumers persist sidecars only in their owned destination.
 * Whole-source produced history preserves one native root, then crops once.
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
	const scanResult=JSON.parse(producedBinding("resolveRemotionProducedFramesJson")(JSON.stringify({version:1,source})));
	if(scanResult.error || !scanResult.plan)throw Error(scanResult.error??"Missing Remotion canonical produced scan");
	const scan=scanResult.plan as NonNullable<NativeAudioAnalysisConfig["remotionProduced"]>;
	const collected=await withRemotionAudioAnalyzer({executable,resourceStore,signal,decoder,request:timing(firstFrame)},async analyzer=>({
		...await analyzer.producedFrames(scan),sources:analyzer.sources,
	}));
	const sources=collected.sources,admittedSourceBytes=sources.reduce((sum,item)=>sum+item.body.length,0);
	const sink=createRemotionArtifactSink({limits:{...policy,maxTotalBytes:policy.maxTotalBytes-admittedSourceBytes,
		maxSources:policy.maxSources-sources.length},signal,captureFramePng:async index=>{
		const picture=collected.pictures.get(index);if(!picture)throw Error("Missing fulfilled exact-frame Remotion thumbnail");return picture;
	}});
	let artifacts:ReturnType<typeof sink.take>;
	try {
		for(const item of collected.frames) {
			signal.throwIfAborted();
			const result=JSON.parse(producedBinding("resolveRemotionProducedAssetsJson")(JSON.stringify({version:1,
				frameIndex:item.frameIndex,frameRate:source.frameRate,durationFrames:source.durationFrames,assets:item.produced,
				declaredMediaAssetCount:item.assets.length,declaredSourceCount:sources.length,admittedSourceBytes})));
			if(result.error || !result.plan)throw Error(result.error??"Missing native produced admission");
			for(const artifact of result.plan.artifacts as RemotionAdmittedArtifact[])await sink.accept(artifact);
			if(item.frameIndex>=firstFrame && item.frameIndex<firstFrame+frameCount)frames.push({frameIndex:item.frameIndex,assets:item.assets});
		}
		artifacts=sink.take();
	} finally {sink.dispose();}
	const packed=Buffer.from(producedBinding("prepareRemotionInlineAudioSourcesJson")(JSON.stringify({version:1,
		frameRate:source.frameRate,durationFrames:source.durationFrames,declaredSourceCount:sources.length,admittedSourceBytes,
		frames:collected.frames.map(item=>({frameIndex:item.frameIndex,assets:item.produced,declaredMediaAssetCount:item.assets.length}))})));
	if(packed.length<4)throw Error("Truncated native inline source manifest");
	const headerLength=packed.readUInt32LE(0);if(headerLength>policy.maxObservationBytes || headerLength>packed.length-4)throw Error("Invalid native inline manifest budget");
	const manifest=JSON.parse(packed.subarray(4,4+headerLength).toString("utf8")) as {version:number;sources:RemotionInlineSource[]};
	if(manifest.version!==1 || !Array.isArray(manifest.sources))throw Error("Invalid native inline manifest");
	if((manifest.sources.length || collected.frames.some(item=>item.assets.length)) && source.audio?.mode!=="native")throw Error("Remotion produced audio requires explicit native soundtrack mode");
	const inline:{body:Buffer;format:"s16le"|"f32le"}[]=[];let offset=4+headerLength,totalPcm=0;
	for(const item of manifest.sources) {
		if(!Number.isSafeInteger(item.byteLength) || item.byteLength<44 || offset+item.byteLength>packed.length)throw Error("Invalid native inline WAV range");
		const prepared=await prepareRemotionInlineSource({source:item,wav:packed.subarray(offset,offset+item.byteLength),sampleRate,decoder,signal});offset+=item.byteLength;
		totalPcm+=prepared.body.length;if(totalPcm>policy.maxPcmBytes)throw Error("Native inline working PCM exceeds the Rust budget");inline.push(prepared);
	}
	if(offset!==packed.length)throw Error("Trailing native inline payload");
	const rendered = await renderNativeAudioObservations({ frames, sources, frameRate: source.frameRate,
		firstFrame, sampleRate, decoder, signal });
	if (rendered.frames !== plan.outputFrames) throw Error("Native audio sample clock disagrees with the admitted range");
	const mixManifest=Buffer.from(JSON.stringify({version:1,frameRate:source.frameRate,durationFrames:source.durationFrames,
		firstFrame,frameCount,sampleRate,baseByteLength:rendered.pcm.length,inlineByteLengths:inline.map(item=>item.body.length),inlineFormats:inline.map(item=>item.format)}));
	const mixHeader=Buffer.alloc(4);mixHeader.writeUInt32LE(mixManifest.length);
	if(rendered.pcm.length+totalPcm>policy.maxPcmBytes)throw Error("Native produced mix working set exceeds the Rust budget");
	const pcm=Buffer.from(producedBinding("mixRemotionProducedAudioPcm")(Buffer.concat([mixHeader,mixManifest,rendered.pcm,...inline.map(item=>item.body)])));
	signal.throwIfAborted();
	return { ...rendered,sampleRate,pcm,hasAudio:rendered.hasAudio || inline.length>0,artifacts, firstFrame, frameCount, sampleOrigin: plan.sampleOrigin as number };
}
