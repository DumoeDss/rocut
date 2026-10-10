import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {HDRLoader} from "three/addons/loaders/HDRLoader.js";
import {createScene} from "ink-object-source";
import {acceptInkGpu,inkPixelDifference} from "./ink-object-gpu-metrics.mjs";

const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
export async function runInkObjectGpu(config:any) {
 assert(THREE.REVISION==="185","Actual pinned Three185 required");
 const width=256,height=192,canvas=document.createElement("canvas");document.body.append(canvas);
 const gl=canvas.getContext("webgl2",{alpha:false,antialias:false,preserveDrawingBuffer:true});assert(gl,"Real WebGL2 unavailable");
 const renderer=new THREE.WebGLRenderer({canvas,context:gl!,antialias:false});renderer.setSize(width,height);renderer.setPixelRatio(1);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 const borrowed=new Set<any>(),shaderErrors:any[]=[];
 const diagnostic:any={stages:[],shaderErrors,contextAttributes:gl!.getContextAttributes(),version:gl!.getParameter(gl!.VERSION),threeRevision:THREE.REVISION};Reflect.set(globalThis,"__inkGpuDebug",diagnostic);
 renderer.debug.checkShaderErrors=true;renderer.debug.onShaderError=(context,program,vertex,fragment)=>shaderErrors.push({program:context.getProgramInfoLog(program),vertex:context.getShaderInfoLog(vertex),fragment:context.getShaderInfoLog(fragment)});
 const stage=(name:string)=>{
  const errors=[];for(let i=0;i<8;i++){const code=gl!.getError();if(code===gl!.NO_ERROR)break;errors.push(code);}
  diagnostic.stages.push({name,errors,contextLost:gl!.isContextLost(),programs:renderer.info.programs?.map((p:any)=>({id:p.id,runnable:p.diagnostics?.runnable,programLog:p.diagnostics?.programLog,vertexLog:p.diagnostics?.vertexShader?.log,fragmentLog:p.diagnostics?.fragmentShader?.log}))});
  assert(errors.length===0,`WebGL stage ${name}: error codes ${errors.join(',')}`);
 };
 try {
  stage("renderer-initialized-before-load");
  const model=(await new GLTFLoader().loadAsync("/ink-model.glb")).scene,originals=new Map<any,any>();
  model.traverse((node:any)=>{if(node.isMesh){originals.set(node,{material:node.material,children:node.children.length});borrowed.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material]){borrowed.add(material);for(const texture of [material.map,material.normalMap])if(texture)borrowed.add(texture);}}});
  assert(originals.size===1,"Expected real diagnostic model");
  const sourceMaterial=[...originals.values()][0].material;assert(sourceMaterial.map?.isTexture&&sourceMaterial.normalMap?.isTexture,"Actual GLB map and normal map missing");
  assert(sourceMaterial.map.image.width===32&&sourceMaterial.normalMap.image.width===32,"Embedded PNG decode failed");
  const environment=await new HDRLoader().loadAsync("/ink-environment.hdr");environment.mapping=THREE.EquirectangularReflectionMapping;borrowed.add(environment);stage("all-assets-decoded-before-createScene");
  let borrowedDisposals=0;for(const item of borrowed)item.addEventListener("dispose",()=>borrowedDisposals++);
  const captures:any[]=[],pixels=new Map<string,Uint8Array>(),cleanup:any[]=[];
  const props={modelId:"model",environmentId:"environment",scale:1,rotation:[0.12,0.25,0],rotationSpeed:[0.18,0.65,0],camera:{position:[0.7,0.25,4],target:[0,0,0],fov:37,near:0.1,far:100}};
  const capture=async(name:string,params:any,time=0,sequence?:number[],omit?:string)=>{
   const abort=new AbortController(),owned=new Set<any>(),disposed=new Set<any>();
   const originalMap=sourceMaterial.map,originalNormal=sourceMaterial.normalMap;if(omit==="map")sourceMaterial.map=null;if(omit==="normalMap")sourceMaterial.normalMap=null;
   let lifecycle:any;
   try {
    lifecycle=await createScene({THREE,renderer,signal:abort.signal,frame:{time:0},inputProps:{...props,ink:params},assets:{model:async()=>({value:model}),environment:async()=>({value:environment})}});
    lifecycle.scene.traverse((node:any)=>{if(node.isMesh)for(const material of Array.isArray(node.material)?node.material:[node.material])if(!borrowed.has(material))owned.add(material);});
    for(const item of owned)item.addEventListener("dispose",()=>{assert(!disposed.has(item),"Owned material disposed twice");disposed.add(item);});
    stage(`${name}:before-compileAsync`);await renderer.compileAsync(lifecycle.scene,lifecycle.camera);stage(`${name}:after-compileAsync-before-render`);
    for(const tick of sequence??[time]){lifecycle.renderFrame({time:tick});renderer.render(lifecycle.scene,lifecycle.camera);}
    stage(`${name}:after-render`);assert(shaderErrors.length===0,"Actual Ink shader compilation failed");
    const bytes=new Uint8Array(width*height*4);gl!.readPixels(0,0,width,height,gl!.RGBA,gl!.UNSIGNED_BYTE,bytes);stage(`${name}:after-readPixels`);
    pixels.set(name,bytes);captures.push({name,time,sha256:await hash(bytes),pngBase64:canvas.toDataURL("image/png").split(',')[1]});
   }finally {
    if(lifecycle){abort.abort();lifecycle.dispose();assert(disposed.size===owned.size&&owned.size===2,"Owned Ink material leaked");for(const [mesh,original] of originals){assert(mesh.material===original.material,"Borrowed material assignment not restored");assert(mesh.children.length===original.children,"Contour child leaked");}assert(borrowedDisposals===0,"Ink disposed borrowed resources");cleanup.push({name,owned:owned.size,disposed:disposed.size,borrowedUntouched:true,contoursRemoved:true});}
    sourceMaterial.map=originalMap;sourceMaterial.normalMap=originalNormal;
   }
  };
  await capture("base",config.params.base);
  for(const name of ["inkColor","density","paperTexture","paperScale","seed","contour"])await capture(name,config.params[name]);
  await capture("map",config.params.base,0,undefined,"map");await capture("normalMap",config.params.base,0,undefined,"normalMap");
  await capture("late",config.params.base,0.75);await capture("reverse",config.params.base,0,[0.75,0]);
  const difference=(a:string,b:string,region="center")=>inkPixelDifference(pixels.get(a),pixels.get(b),width,height,region);
  const metrics:any=Object.fromEntries(["inkColor","density","paperTexture","paperScale","seed","map","normalMap"].map(name=>[name,difference("base",name)]));
  metrics.contour=difference("base","contour","contour");metrics.motion=difference("base","late");metrics.reverseSeek=difference("base","reverse");diagnostic.metrics=metrics;acceptInkGpu(metrics);
  let negativeControlRejected=false;try{acceptInkGpu({...metrics,paperTexture:difference("base","base")});}catch{negativeControlRejected=true;}assert(negativeControlRejected,"Independent copied/no-op capture accepted");
  return {ok:true,width,height,threeRevision:THREE.REVISION,diagnostic,shaderErrors,metrics,captures,cleanup,negativeControlRejected,resourceDecode:{meshes:originals.size,baseColorTexture:[sourceMaterial.map.image.width,sourceMaterial.map.image.height],normalTexture:[sourceMaterial.normalMap.image.width,sourceMaterial.normalMap.image.height],environment:[environment.image.width,environment.image.height]},scope:"Actual Ink source and real static mapped/normal-bearing diagnostic GLB/HDR, WebGL2 GLSL/render/readback; not formal Host/editor/export/installation, hardware/WebGPU or general model support"};
 }finally {for(const resource of borrowed)resource.dispose();renderer.dispose();renderer.forceContextLoss();}
}
