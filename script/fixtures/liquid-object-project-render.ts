import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { pngPixels, pixelComparison, visibility } from "./liquid-object-capture-probe-pixels.mjs";
import { sha, record } from "./liquid-object-project-host";
import { errorReceipt } from "./liquid-object-capture-probe-types";
import type { runLiquidProjectHost } from "./liquid-object-project-host";
import type { ProbeOptions } from "./liquid-object-capture-probe-types";

/** The reopened same project's persisted source is routed through production renderHtmlPng.
 * This is not a whole-canvas/timeline compositor or editor-attached export proof. */
export async function runLiquidProjectRender(options: ProbeOptions & {
 saved: Awaited<ReturnType<typeof runLiquidProjectHost>>; ffmpeg: string; ffprobe: string;
}) {
 const {root,executable,saved,ffmpeg,ffprobe}=options,frames=[];
 const report:Record<string,unknown>={ok:false,stage:"formal-rasterizer-frame0",scope:"same persisted source through actual html-rasterizer Liquid dispatch + external diagnostic FFV1 encoding/independent FFmpeg decode; not Rocut production export/UI/compositor history"};
 const persist=()=>writeFile(join(root,"render-evidence.json"),JSON.stringify(report,null,2));
 const signal=AbortSignal.timeout(120000),run=promisify(execFile);
 try{
  const graph=record(saved.report.graph),clips=graph.clips;if(!Array.isArray(clips)||clips.length!==1)throw Error("Exactly one persisted clip required");
  const clip=record(clips[0]);for(const key of ["startTime","duration","trimStart"])assert.equal(typeof clip[key],"number");
  const startTime=Number(clip.startTime),duration=Number(clip.duration),trimStart=Number(clip.trimStart);
  for(let i=0;i<4;i++){
   report.stage=`formal-rasterizer-frame${i}`;await persist();
   const png=await renderHtmlPng({executable,resourceStore:saved.context,signal,request:{source:saved.source,
    clipStart:startTime,clipDuration:duration,trimStart,timelineTime:startTime+(23+i)*4000}});
   const path=join(root,`frame-${String(i).padStart(2,"0")}.png`);await writeFile(path,png,{flag:"wx"});
   const image=pngPixels(png);assert.equal(image.width,192);assert.equal(image.height,128);assert(visibility(image).changedPixels>200);
   frames.push({index:i,path,sha256:sha(png),bytes:png.length,image});
  }
  report.frames=frames.map(({image,...frame})=>({...frame,visibility:visibility(image)}));
  report.motion=pixelComparison({a:frames[0]!.image,b:frames[3]!.image});
  assert(pixelComparison({a:frames[0]!.image,b:frames[3]!.image}).changedPixels>100);
  const video=join(root,"liquid-four-frames.mkv"),raw=join(root,"decoded.rgba");
  report.stage="ffmpeg-lossless-encode";await persist();
  await run(ffmpeg,["-hide_banner","-loglevel","error","-n","-framerate","30","-i",join(root,"frame-%02d.png"),"-frames:v","4","-an","-c:v","ffv1","-level","3","-pix_fmt","bgr0",video],{windowsHide:true,timeout:30000});
  report.stage="independent-ffmpeg-decode";await persist();
  const probed=await run(ffprobe,["-v","error","-count_frames","-select_streams","v:0","-show_entries","stream=codec_name,width,height,r_frame_rate,nb_read_frames","-of","json",video],{windowsHide:true,timeout:15000});
  const probe:unknown=JSON.parse(probed.stdout);const streams=record(probe).streams;if(!Array.isArray(streams)||streams.length!==1)throw Error("Independent decoder stream missing");
  const stream=record(streams[0]);assert.equal(stream.codec_name,"ffv1");assert.equal(stream.width,192);assert.equal(stream.height,128);assert.equal(stream.nb_read_frames,"4");assert.equal(stream.r_frame_rate,"30/1");
  await run(ffmpeg,["-hide_banner","-loglevel","error","-n","-i",video,"-frames:v","4","-f","rawvideo","-pix_fmt","rgba",raw],{windowsHide:true,timeout:30000});
  const decoded=await readFile(raw);assert.equal(decoded.length,4*192*128*4);
  for(let i=0;i<4;i++)assert(decoded.subarray(i*192*128*4,(i+1)*192*128*4).equals(frames[i]!.image.pixels),`Independent decoded frame ${i} differs`);
  const bytes=await readFile(video);report.video={path:video,bytes:bytes.length,sha256:sha(bytes),stream};
  report.decoded={path:raw,bytes:decoded.length,sha256:sha(decoded),allFourFramesExact:true};
  report.processes=options.observe?.();report.ok=true;report.stage="completed-same-project-four-frame-diagnostic-encode";
 }catch(error){report.failure=errorReceipt(error);throw Object.assign(error instanceof Error?error:Error(String(error)),{receipt:report});}
 finally{await persist();}
 return report;
}
