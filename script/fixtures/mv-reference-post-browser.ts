import {renderReferencePost, type ReferencePostPlan} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-reference-post";

interface OriginalPost {
 init(canvas:HTMLCanvasElement):string;
 setLutAtlas(canvas:HTMLCanvasElement):void;
 render(scene:HTMLCanvasElement,text:HTMLCanvasElement,parameters:Record<string,unknown>,foreground?:HTMLCanvasElement):void;
}
function isOriginalPost(value:unknown):value is OriginalPost {
 if(typeof value!=="object" || value===null)return false;
 return "init" in value && typeof value.init==="function" &&
 "render" in value && typeof value.render==="function" &&
 "setLutAtlas" in value && typeof value.setLutAtlas==="function";
}
function canvas(width:number,height:number):HTMLCanvasElement {
 const output=document.createElement("canvas");output.width=width;output.height=height;return output;
}
function pixels(source:HTMLCanvasElement):Uint8ClampedArray {
 const copy=canvas(source.width,source.height),ctx=copy.getContext("2d",{willReadFrequently:true});
 if(!ctx)throw Error("Pixel readback requires 2D canvas");
 ctx.drawImage(source,0,0);const result=ctx.getImageData(0,0,source.width,source.height).data;
 copy.width=copy.height=1;return result;
}
/** Fixture-only independent original GL oracle. The native evaluator must be
 * bound by the caller to its hash-pinned private WASM, never to this oracle.
 * No native uniforms/passes are used to calculate the oracle's parameters. */
export async function compareReferencePostPixels({reference, evaluateNativePlan, scene,text,foreground,lutAtlas,parameters,songTicks,ticksPerSecond,maxChannelError=1}: {
 reference:{id:"core/gl.js";code:string;sha256:string};
 evaluateNativePlan:()=>Promise<ReferencePostPlan>;
 scene:HTMLCanvasElement; text?:HTMLCanvasElement; foreground?:HTMLCanvasElement;
 lutAtlas?:HTMLCanvasElement;
 parameters:Readonly<Record<string,number|readonly number[]>>;
 songTicks:number; ticksPerSecond:number; maxChannelError?:number;
}) {
 if(reference.id!=="core/gl.js" || !/^[a-f0-9]{64}$/.test(reference.sha256))throw Error("Invalid archived GL identity");
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(reference.code)));
 const digest=Array.from(hash,v=>v.toString(16).padStart(2,"0")).join("");
 if(digest!==reference.sha256)throw Error("Archived GL bytes changed");
 if(!Number.isSafeInteger(songTicks) || songTicks<0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond<=0 || !Number.isInteger(maxChannelError) || maxChannelError<0 || maxChannelError>2)throw Error("Invalid pixel gate clock/tolerance");
 // Invoke the real native provider inside this gate; never substitute oracle
 // values or a fixture-authored pass plan for its returned serialized plan.
 const plan=await evaluateNativePlan();
 if(plan.profile!=="tunnel-original-gl-v1" || plan.songTicks!==songTicks || plan.width!==scene.width || plan.height!==scene.height)throw Error("Native frame plan identity mismatch");
 const native=canvas(plan.width,plan.height),oracle=canvas(plan.width,plan.height),blank=canvas(plan.width,plan.height);
 const iframe=document.createElement("iframe");iframe.hidden=true;iframe.title="Independent archived GL pixel oracle";
 iframe.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; connect-src \'none\'; img-src \'none\'; base-uri \'none\'"><body></body>';
 try {
  renderReferencePost({canvas:native,scene,text,foreground,lutAtlas,plan});
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error("GL oracle realm timeout")),5000);
   iframe.onload=()=>{clearTimeout(timer);resolve();};iframe.onerror=()=>{clearTimeout(timer);reject(Error("GL oracle realm failed"));};document.body.append(iframe);
  });
  const realm=iframe.contentWindow,doc=iframe.contentDocument;
  if(!realm || !doc)throw Error("GL oracle realm inaccessible");
  let scriptError:Error|undefined;
  const onError=(event:ErrorEvent)=>{scriptError=Error("Archived GL execution failed: "+event.message);event.preventDefault();};
  realm.addEventListener("error",onError);
  try {
   for(const source of ["window.Z = {};",reference.code]) {
    const script=doc.createElement("script");script.textContent=source;doc.body.append(script);
    if(scriptError)throw scriptError;
   }
  } finally {realm.removeEventListener("error",onError);}
  const engine:unknown=Reflect.get(realm,"Z");
  const post:unknown=typeof engine==="object" && engine!==null && "post" in engine?engine.post:null;
  if(!isOriginalPost(post))throw Error("Archived GL did not register original post backend");
  const renderer=post.init(oracle);if(lutAtlas)post.setLutAtlas(lutAtlas);
  // Reconstruct upstream core/main.js postFor independently from Rust output.
  const time=songTicks/ticksPerSecond,original:Record<string,unknown>={...parameters};
  original.lutB=parameters.lutB??parameters.lutA??0;
  original.boilSeed=parameters.boilSeed??(Math.floor(time*(Number(parameters.boilFps)||12)+1e-6)%997);
  original.grainSeed=parameters.grainSeed??(Math.floor(time*24+1e-6)%1009);
  original.glitchSeed=parameters.glitchSeed??(Math.floor(time*24+1e-6)%101);
  post.render(scene,text??blank,original,foreground);
  const actual=pixels(native),expected=pixels(oracle);
  let max=0,sum=0,mismatchedPixels=0;
  for(let offset=0;offset<actual.length;offset+=4) {
   let mismatch=false;
   for(let channel=0;channel<4;channel++) {
    const error=Math.abs(actual[offset+channel]-expected[offset+channel]);max=Math.max(max,error);sum+=error;
    if(error>maxChannelError)mismatch=true;
   }
   if(mismatch)mismatchedPixels++;
  }
  if(mismatchedPixels)throw Error(`Reference post pixel mismatch: ${mismatchedPixels} pixels, max channel error ${max}`);
  return {profile:plan.profile,songTicks,referenceSha256:digest,renderer,drawPasses:plan.passes.length,
    width:plan.width,height:plan.height,maxChannelError:max,meanChannelError:sum/actual.length,mismatchedPixels,
    nativeRgba:actual,originalRgba:expected};
 } finally {
  for(const surface of [native,oracle])surface.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  native.width=native.height=oracle.width=oracle.height=blank.width=blank.height=1;
  iframe.remove();
 }
}
