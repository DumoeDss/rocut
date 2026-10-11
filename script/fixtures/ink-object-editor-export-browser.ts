import { initializeGpu, disposeGpu, WasmRuntimeGpuResourceQuery } from "opencut-wasm";
import { decodeProject } from "../../packages/editor-classic/src/editor/persistence/project-codec";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree";
import { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { BrowserRuntimeResourceHost } from "../../packages/editor-classic/src/editor/host/browser-runtime";
import { createSessionResources } from "../../packages/editor-classic/src/editor/session/session-resources";
import { mediaTime, resolveMediaTimeRange } from "../../packages/editor-classic/src/wasm/media-time";

function check(value: unknown, message: string): asserts value { if(!value)throw Error(message); }
function record(value: unknown): Record<string,unknown> {
 check(value && typeof value==="object" && !Array.isArray(value),"Project object missing");
 return Object.fromEntries(Object.entries(value));
}
/** Actual production renderer/compositor/encoder; no direct FFmpeg encoding. */
export async function runInkEditorExport(options: { project: unknown; base: string; window?: { startFrame: number; frameCount: number } }) {
 const wrapper=record(options.project),saved=record(wrapper.record);
 check(wrapper.wrapperVersion===1 && saved.schemaVersion===32,"Actual FileProjectStore schema32 project required");
 const project=decodeProject(saved.data),scene=project.scenes.find(value=>value.id===project.currentSceneId);
 check(scene && scene.isMain,"Saved active scene missing");
 const elements=[...scene.tracks.main.elements,...scene.tracks.overlay.flatMap(track=>[...track.elements]),...scene.tracks.audio.flatMap(track=>track.elements)];
 check(elements.length===1,"Exactly one saved Ink clip required");const clip=elements[0];
 check(clip.type==="graphic" && clip.definitionId==="programmatic" && clip.programmatic?.build?.engine==="three" && clip.id==="ink-object","Saved Ink source missing");
 check(clip.startTime===0 && clip.trimStart===0 && clip.duration===245000,"Saved clip timing changed");
 check(project.settings.canvasSize.width===192 && project.settings.canvasSize.height===128,"Saved canvas changed");
 check(project.settings.fps.numerator===24 && project.settings.fps.denominator===1,"Saved frame rate changed");
 const speed=clip.programmatic.build.inputProps?.rotationSpeed;
 check(Array.isArray(speed) && speed.length===3 && speed.every(value=>value===0),"Original static baked rotationSpeed required");
 const url=new URL(options.base);check(["localhost","127.0.0.1"].includes(url.hostname) && url.protocol==="http:","Private Host API only");
 const frameWindow=options.window ?? {startFrame:6,frameCount:4};
 check(Number.isInteger(frameWindow.startFrame)&&frameWindow.startFrame>=0&&Number.isInteger(frameWindow.frameCount)&&frameWindow.frameCount>0&&frameWindow.startFrame+frameWindow.frameCount<=clip.programmatic.durationFrames,"Export frame window out of clip bounds");
 const range=resolveMediaTimeRange({range:{startTime:mediaTime({ticks:frameWindow.startFrame*5000}),endTime:mediaTime({ticks:(frameWindow.startFrame+frameWindow.frameCount)*5000})},timelineDuration:project.metadata.duration});
 const videoCache=new VideoCache(),runtimeGpu=new WasmRuntimeGpuResourceQuery();let id=0;
 const resources=createSessionResources({runtimeGpu,nextId:({scope})=>`${scope}:ink-export:${++id}`,
  runtimeResources:new BrowserRuntimeResourceHost(({request,url})=>new Worker(url,{type:request.type,name:request.name}))});
 const compositor=new WasmCompositor(resources),nodes:ReturnType<typeof buildScene>[]=[],references:Uint8Array[]=[];
 let exporter:SceneExporter|undefined,gpu=false,primary:unknown,result:unknown;
 try{
  await initializeGpu();gpu=true;
  const params={width:192,height:128,fps:project.settings.fps,compositor,videoCache};
  const make=()=>buildScene({programmaticFrames:createHttpProgrammaticFrames({base:options.base}),tracks:scene.tracks,
   mediaAssets:[],canvasSize:project.settings.canvasSize,duration:project.metadata.duration,background:project.settings.background,
   assetResolver:{resolve(){throw Error("Unexpected external editor asset");}},isPreview:false});
  const exportNode=make();nodes.push(exportNode);
  exporter=new SceneExporter({...params,format:"webm",quality:"very_high",shouldIncludeAudio:false});
  // First acceptance stage is the actual production encoder, not a stand-in.
  const encoded=await exporter.export({rootNode:exportNode,range});
  check(encoded && encoded.byteLength>0 && encoded.byteLength<4*1024*1024,"Production export video missing/oversized");
  await exporter.drainRasterResidency();
  const renderer=new CanvasRenderer(params),referenceNode=make();nodes.push(referenceNode);
  try{
   for(let index=0;index<frameWindow.frameCount;index++){
    const rgba=await renderer.renderAndCapture({node:referenceNode,time:mediaTime({ticks:(frameWindow.startFrame+index)*5000}),capture(canvas){
     const copy=new OffscreenCanvas(192,128),context=copy.getContext("2d",{colorSpace:"srgb",willReadFrequently:true});check(context,"sRGB readback context missing");
     try{context.drawImage(canvas,0,0);const image=context.getImageData(0,0,192,128,{colorSpace:"srgb"});check(image.colorSpace==="srgb","Non-sRGB reference");return new Uint8Array(image.data);}
     finally{copy.width=copy.height=0;}
    }});check(rgba.length===192*128*4,"Reference shape mismatch");references.push(rgba);
   }
  }finally{await renderer.retireTree(referenceNode);}
  result={ok:true,video:new Uint8Array(encoded),references,width:192,height:128,frameCount:frameWindow.frameCount,frameRate:project.settings.fps,range,
   projectId:project.metadata.id,clipId:clip.id,source:clip.programmatic,
   scope:"actual persisted project decodeProject/buildScene/CanvasRenderer/WasmCompositor/SceneExporter.export; static original baked props, no motion/runtime-props claim; bounded timeline window; not attached editor UI/history/install acceptance"};
 }catch(error){primary=error;}
 const errors:unknown[]=[];
 for(const node of nodes)try{cancelPendingRenderFrames(node);}catch(error){errors.push(error);}
 for(const cleanup of [()=>exporter?.drainRasterResidency(),()=>compositor.dispose(),()=>videoCache.dispose(),()=>resources.disposeAll()])
  try{await cleanup();}catch(error){errors.push(error);}
 try{check(runtimeGpu.liveHandles().length===0,"Actual compositor GPU handles leaked");runtimeGpu.free();if(gpu)disposeGpu();}catch(error){errors.push(error);}
 if(primary!==undefined)throw errors.length?new AggregateError([primary,...errors],"Ink export and cleanup failed"):primary;
 if(errors.length)throw new AggregateError(errors,"Ink export cleanup failed");
 return result;
}

