import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { createScene } from "glass-object-source";
import {acceptGlassGpu,glassPixelDifference} from "./glass-object-gpu-metrics.mjs";

const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
async function hash(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");}
export async function runGlassObjectGpu(config:any) {
 assert(THREE.REVISION==="185","Actual pinned Three185 required");
 const width=256,height=192,canvas=document.createElement("canvas");document.body.append(canvas);
 const gl=canvas.getContext("webgl2",{alpha:false,antialias:false,preserveDrawingBuffer:true});assert(gl,"Real WebGL2 unavailable");
 const renderer=new THREE.WebGLRenderer({canvas,context:gl!,antialias:false});renderer.setSize(width,height);renderer.setPixelRatio(1);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 const borrowed=new Set<any>();
 const diagnostic:any={stages:[],contextAttributes:gl!.getContextAttributes(),version:gl!.getParameter(gl!.VERSION),threeRevision:THREE.REVISION,assets:["curved optical-model.glb","64x32 optical-environment.hdr","128x128 optical-dark.png","128x128 optical-light.png"],firstFrame:{time:0,width,height}};
 Reflect.set(globalThis,"__glassGpuDebug",diagnostic);
 const stage=(name:string)=>{
  const errors:number[]=[];for(let count=0;count<8;count++){const code=gl!.getError();if(code===gl!.NO_ERROR)break;errors.push(code);}
  const programs=renderer.info.programs?.map((program:any)=>({id:program.id,name:program.name,runnable:program.diagnostics?.runnable,programLog:program.diagnostics?.programLog,vertexLog:program.diagnostics?.vertexShader?.log,fragmentLog:program.diagnostics?.fragmentShader?.log}));
  diagnostic.stages.push({name,errors,contextLost:gl!.isContextLost(),programs});
  assert(errors.length===0,`WebGL stage ${name}: error codes ${errors.join(',')}`);
 };
 stage("renderer-initialized-before-load");
 try {
 const shaderErrors:any[]=[];renderer.debug.checkShaderErrors=true;
 renderer.debug.onShaderError=(context,program,vertex,fragment)=>shaderErrors.push({program:context.getProgramInfoLog(program),vertex:context.getShaderInfoLog(vertex),fragment:context.getShaderInfoLog(fragment)});
 const loaded=await new GLTFLoader().loadAsync("/optical-model.glb"),model=loaded.scene;
 const originals=new Map<any,any>();
 model.traverse((node:any)=>{if(node.isMesh){originals.set(node,node.material);borrowed.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])borrowed.add(material);}});
 stage("GLB-decoded-before-environment");
 const environment=await new HDRLoader().loadAsync("/optical-environment.hdr");environment.mapping=THREE.EquirectangularReflectionMapping;
 borrowed.add(environment);const textures:THREE.Texture[]=[];
 for(const name of ["dark","light"]){const texture=await new THREE.TextureLoader().loadAsync(`/optical-${name}.png`);textures.push(texture);borrowed.add(texture);}
 for(const texture of textures){texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.repeat.set(7,7);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;}
 stage("all-assets-decoded-before-createScene");
 let borrowedDisposals=0;for(const item of borrowed)item.addEventListener("dispose",()=>borrowedDisposals++);
 const captures:any[]=[],pixels=new Map<string,Uint8Array>(),cleanup:any[]=[];
 const props={modelId:"model",environmentId:"environment",scale:1,rotation:[0.12,0.25,0],rotationSpeed:[0.18,0.65,0],camera:{position:[0.7,0.25,4],target:[0,0,0],fov:37,near:0.1,far:100}};
 const capture=async(name:string,params:any,background:number,time=0,sequence?:number[])=>{
  const abort=new AbortController(),owned=new Set<any>(),disposed=new Set<any>();
  const lifecycle=await createScene({THREE,renderer,signal:abort.signal,frame:{time:0},inputProps:{...props,glass:params,backgroundId:"background"},assets:{model:async()=>({value:model}),environment:async()=>({value:environment}),texture:async()=>({value:textures[background]})}});
  lifecycle.scene.traverse((node:any)=>{if(node.isMesh){if(!borrowed.has(node.geometry))owned.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(!borrowed.has(material))owned.add(material);}});
  for(const item of owned)item.addEventListener("dispose",()=>{assert(!disposed.has(item),"Owned resource disposed twice");disposed.add(item);});
  try {
   stage(`${name}:before-compileAsync`);
   await renderer.compileAsync(lifecycle.scene,lifecycle.camera);
   stage(`${name}:after-compileAsync-before-render`);
   for(const tick of sequence??[time]){lifecycle.renderFrame({time:tick});renderer.render(lifecycle.scene,lifecycle.camera);}
   stage(`${name}:after-render`);assert(shaderErrors.length===0,"Real shader compilation failed");
   const bytes=new Uint8Array(width*height*4);gl!.readPixels(0,0,width,height,gl!.RGBA,gl!.UNSIGNED_BYTE,bytes);
   stage(`${name}:after-readPixels`);
   pixels.set(name,bytes);captures.push({name,time,sha256:await hash(bytes),pngBase64:canvas.toDataURL("image/png").split(",")[1]});
  } finally {
   abort.abort();lifecycle.dispose();assert(disposed.size===owned.size&&owned.size>=3,"Owned Glass resources leaked");
   for(const [mesh,original] of originals)assert(mesh.material===original,"Borrowed model assignment not restored");
   assert(borrowedDisposals===0,"Glass disposed borrowed resources");cleanup.push({name,owned:owned.size,disposed:disposed.size,borrowedUntouched:true});
  }
 };
  await capture("base",config.params.base,0);
  if(config.firstFrameOnly)return {ok:true,opticalAcceptance:false,scope:"Single first-frame stage diagnostic only; optical parameter matrix not run",diagnostic,shaderErrors,captures,cleanup};
  await capture("light",config.params.base,1);
  await capture("opaqueDark",config.params.opaque,0);await capture("opaqueLight",config.params.opaque,1);
  for(const name of ["roughness","thickness","ior"])await capture(name,config.params[name],0);
  await capture("late",config.params.base,0,0.75);await capture("reverse",config.params.base,0,0,[0.75,0]);
  const difference=(a:string,b:string)=>glassPixelDifference(pixels.get(a),pixels.get(b),width,height);
  const metrics={backgroundTransmission:difference("base","light"),backgroundOpaque:difference("opaqueDark","opaqueLight"),roughness:difference("base","roughness"),thickness:difference("base","thickness"),ior:difference("base","ior"),motion:difference("base","late"),reverseSeek:difference("base","reverse")};
  acceptGlassGpu(metrics);
  let negativeControlRejected=false;try{acceptGlassGpu({...metrics,ior:difference("base","base")});}catch{negativeControlRejected=true;}
  assert(negativeControlRejected,"Independent no-op negative control accepted");
  return {ok:true,width,height,threeRevision:THREE.REVISION,renderer:gl!.getParameter(gl!.RENDERER),version:gl!.getParameter(gl!.VERSION),diagnostic,shaderErrors,programCount:renderer.info.programs?.length,metrics,captures,cleanup,negativeControlRejected,resourceDecode:{modelMeshes:originals.size,environment:[environment.image.width,environment.image.height],backgrounds:textures.map(t=>[t.image.width,t.image.height])},scope:"Actual Glass source with curved GLB and detailed dark/light PNG optical diagnostic fixtures; not GPU acceptance of earlier tiny Host project or user visual full support. Real WebGL2 compile/render/pixels only; no editor/history/encoded export or hardware cross-device certification"};
 } finally {
  for(const resource of borrowed)resource.dispose();renderer.dispose();renderer.forceContextLoss();
 }
}
