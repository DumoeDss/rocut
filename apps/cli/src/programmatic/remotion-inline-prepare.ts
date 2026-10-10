import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname,isAbsolute} from "node:path";
import {runNativeMediaProcess} from "./native-media-process";
import type {NativeVideoDecoder} from "./video-decoder";

export interface RemotionInlineSource {kind:"native-generated-inline-pcm";id:string;byteLength:number;nativeFrames:number;
  sampleRate:48000;channels:2;toneFrequency:number;toneFilter:string|null;maxToneBytes:number;maxDecodedBytes:number;gainApplied:true}

/** Full native history is toned and quantized to s16 BEFORE graph-rate decode. */
export async function prepareRemotionInlineSource({source,wav,sampleRate,decoder,signal,run=runNativeMediaProcess}:{
  source:RemotionInlineSource;wav:Buffer;sampleRate:44100|48000;decoder:NativeVideoDecoder;signal:AbortSignal;run?:typeof runNativeMediaProcess;
}):Promise<{body:Buffer;format:"s16le"|"f32le"}> {
  signal.throwIfAborted();
  if(source.kind!=="native-generated-inline-pcm" || wav.length!==source.byteLength || wav.length!==44+source.nativeFrames*4
    || !wav.subarray(0,4).equals(Buffer.from("RIFF")) || !wav.subarray(8,12).equals(Buffer.from("WAVE")))throw Error("Invalid Rust-owned native inline WAV");
  if(source.toneFilter===null && sampleRate===48000)return {body:Buffer.from(wav.subarray(44)),format:"s16le"};
  if(!isAbsolute(decoder.ffmpeg))throw Error("Native inline decoder must be host-configured");
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,"rocut-remotion-inline-"));
  try {
    const input=join(root,"source.wav");await writeFile(input,wav,{flag:"wx"});
    const common=["-v","error","-nostdin","-threads","1","-protocol_whitelist","file,pipe"];
    let pcmInput=input,raw=false;
    if(source.toneFilter!==null) {
      const toned=await run({executable:decoder.ffmpeg,args:[...common,"-f","wav","-i",input,"-vn","-af",source.toneFilter,
        "-ar","48000","-ac","2","-c:a","pcm_s16le","-f","s16le","pipe:1"],signal,maxBytes:source.maxToneBytes,media:"audio"});
      signal.throwIfAborted();if(toned.length%4)throw Error("Native toned inline PCM is not stereo s16");
      if(sampleRate===48000)return {body:toned,format:"s16le"};
      pcmInput=join(root,"toned.s16");await writeFile(pcmInput,toned,{flag:"wx"});raw=true;
    }
    const body=await run({executable:decoder.ffmpeg,args:[...common,...(raw?["-f","s16le","-ar","48000","-ac","2"]:["-f","wav"]),
      "-i",pcmInput,"-vn","-ar",String(sampleRate),"-ac","2","-c:a","pcm_f32le","-f","f32le","pipe:1"],signal,maxBytes:source.maxDecodedBytes,media:"audio"});
    signal.throwIfAborted();if(body.length%8)throw Error("Native inline graph PCM is not stereo f32");return {body,format:"f32le"};
  } finally {
    const absolute=resolve(root);if(dirname(absolute)!==parent || !absolute.startsWith(join(parent,"rocut-remotion-inline-")))throw Error("Unsafe inline temporary cleanup");
    await rm(absolute,{recursive:true,force:true});
  }
}
