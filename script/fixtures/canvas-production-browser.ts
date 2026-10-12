import * as wasm from "opencut-wasm";
import { decodeProject } from "../../packages/editor-classic/src/editor/persistence/project-codec";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { createSessionResources } from "../../packages/editor-classic/src/editor/session/session-resources";
import { BrowserRuntimeResourceHost } from "../../packages/editor-classic/src/editor/host/browser-runtime";
import { mediaTime, resolveMediaTimeRange } from "../../packages/editor-classic/src/wasm/media-time";
import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";

function check(value: unknown, label: string): asserts value { if(!value) throw Error(label); }
function read(canvas: CanvasImageSource, width: number, height: number) {
 const copy = new OffscreenCanvas(width,height), context=copy.getContext("2d",{willReadFrequently:true});check(context,"2d readback");
 context.drawImage(canvas,0,0); const pixels=new Uint8Array(context.getImageData(0,0,width,height).data);copy.width=copy.height=0;return pixels;
}
async function hash(bytes: Uint8Array) {return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(value=>value.toString(16).padStart(2,"0")).join("");}
function chroma(bytes: Uint8Array) {let total=0;for(let i=0;i<bytes.length;i+=4)total+=Math.max(bytes[i],bytes[i+1],bytes[i+2])-Math.min(bytes[i],bytes[i+1],bytes[i+2]);return total/(bytes.length/4);}
function difference(a:Uint8Array,b:Uint8Array) {check(a.length===b.length,"pixel lengths");return a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0)/a.length;}
export async function runCanvasProduction(saved: any) {
 const report:any={ok:false,checks:[],cleanupErrors:[]};let gpu=false,exporter:SceneExporter|undefined;
 const project=decodeProject(saved.record.data),scene=project.scenes.find(item=>item.id===project.currentSceneId);check(scene,"saved active scene");
 const {width,height}=project.settings.canvasSize;check(width===192&&height===128,"saved dimensions");
 const resourceQuery=new wasm.WasmRuntimeGpuResourceQuery();let id=0;
 const resources=createSessionResources({runtimeGpu:resourceQuery,nextId:({scope})=>`${scope}:canvas-production:${++id}`,runtimeResources:new BrowserRuntimeResourceHost(({request,url})=>new Worker(url,{type:request.type,name:request.name}))});
 const compositor=new WasmCompositor(resources),videoCache=new VideoCache(),params={width,height,fps:project.settings.fps,compositor,videoCache};
 const renderer=new CanvasRenderer(params),nodes:ReturnType<typeof buildScene>[]=[];
 const make=(variant="ordered",preview=false)=>{
  const tracks=structuredClone(scene.tracks),clip=tracks.overlay.flatMap(track=>track.elements).find(item=>item.id==="paint-clip");check(clip&&clip.type==="graphic","actual Canvas clip");
  if(variant==="raw")clip.effects=[];
  if(variant==="unprefixed")clip.effects=clip.effects!.filter(effect=>effect.id!=="gray-prefix");
  if(variant==="gray")clip.effects=clip.effects!.filter(effect=>effect.id==="gray-prefix");
  const node=buildScene({tracks,mediaAssets:[],canvasSize:project.settings.canvasSize,duration:project.metadata.duration,background:project.settings.background,assetResolver:{resolve(){throw Error("unexpected asset");}},isPreview:preview});nodes.push(node);return node;
 };
 try {
  registerDefaultEffects();await wasm.initializeGpu();gpu=true;
  const graphics=new wasm.WasmRuntimeGraphicsQuery();report.backend=graphics.selectedBackend();graphics.free();check(report.backend==="webgl","explicit webgl selected");
  const ordered=make(),preview=make("ordered",true),raw=make("raw"),gray=make("gray"),unprefixed=make("unprefixed");
  const capture=(node:ReturnType<typeof make>,ticks:number)=>renderer.renderAndCapture({node,time:mediaTime({ticks}),capture:canvas=>read(canvas,width,height)});
  const early=await capture(ordered,36000),late=await capture(ordered,84000),repeat=await capture(ordered,36000),same=await capture(preview,36000);
  check(await hash(early)===await hash(repeat),"reverse seek must reproduce exact frame");check(difference(early,late)>0.1,"stroke trajectory must visibly evolve");check(difference(early,same)===0,"preview/export rendering parity");
  const rawPixels=await capture(raw,60000),grayPixels=await capture(gray,60000),paintPixels=await capture(ordered,60000),unprefixedPixels=await capture(unprefixed,60000);
  check(chroma(rawPixels)>20&&chroma(unprefixedPixels)>10,"colored source/control must remain chromatic");check(chroma(grayPixels)<1&&chroma(paintPixels)<1,"Canvas must sample actual grayscale prefix output");check(difference(paintPixels,grayPixels)>0.1,"Canvas physical/stroke effect must be visible");
  report.checks.push({name:"ordered grayscale prefix",rawChroma:chroma(rawPixels),grayChroma:chroma(grayPixels),paintChroma:chroma(paintPixels),unprefixedChroma:chroma(unprefixedPixels),paintDifference:difference(paintPixels,grayPixels)},{name:"seek/preview",earlyHash:await hash(early),repeatHash:await hash(repeat),lateHash:await hash(late),motion:difference(early,late)});
  const range=resolveMediaTimeRange({range:{startTime:mediaTime({ticks:36000}),endTime:mediaTime({ticks:60000})},timelineDuration:project.metadata.duration});
  exporter=new SceneExporter({...params,format:"webm",quality:"very_high",shouldIncludeAudio:false});
  const encoded=await exporter.export({rootNode:make(),range});check(encoded&&encoded.byteLength>0,"real SceneExporter bytes");await exporter.drainRasterResidency();
  const input=new Input({source:new BufferSource(encoded),formats:ALL_FORMATS}),decoded:any[]=[];
  try {const video=await input.getPrimaryVideoTrack();check(video,"encoded video track");for await(const sample of new CanvasSink(video).canvases()) {const frame=decoded.length,expected=await capture(ordered,36000+frame*4000),actual=read(sample.canvas,width,height);const mean=difference(expected,actual);check(mean<4,"decoded frame differs from production reference");check(Math.abs(sample.timestamp-frame/30)<0.002,"encoded timestamp");decoded.push({frame,timestamp:sample.timestamp,mean});}}
  finally {input.dispose();}
  check(decoded.length===6,"six encoded frames");report.checks.push({name:"production SceneExporter six-frame decode",decoded});report.video=Array.from(new Uint8Array(encoded));report.frames={early:Array.from(early),late:Array.from(late),paint:Array.from(paintPixels)};report.projectId=project.metadata.id;report.ok=true;
 } catch(error) {report.failure=error instanceof Error ? error.stack : String(error);}
 finally {
  for(const node of nodes)try{await renderer.retireTree(node);}catch(error){report.cleanupErrors.push(String(error));}
  for(const cleanup of [()=>exporter?.drainRasterResidency(),()=>compositor.dispose(),()=>videoCache.dispose(),()=>resources.disposeAll()])try{await cleanup();}catch(error){report.cleanupErrors.push(String(error));}
  try{report.liveHandles=resourceQuery.liveHandles();check(report.liveHandles.length===0,"GPU handles leaked");resourceQuery.free();if(gpu)wasm.disposeGpu();}catch(error){report.cleanupErrors.push(String(error));}
  if(report.cleanupErrors.length)report.ok=false;
 }
 return report;
}
