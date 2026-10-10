import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve,win32} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createPrivateEffectInputs} from "./fixtures/private-effect-inputs.mjs";
import {glassObjectGpuAssets} from "./fixtures/glass-object-gpu-assets.ts";

assert(process.versions.bun,"Explicit existing Bun required; no installation");
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const [mode="--prepare",directory]=process.argv.slice(2);
if(mode==="--serve") {
 assert(directory&&process.argv.length===4,"Explicit prepared root required");
 const relative=win32.relative("C:/tmps",resolve(directory));assert(/^glass-object-gpu-[^\\/]+$/.test(relative));
 const evidence=JSON.parse(await readFile(join(directory,"preparation.json"),"utf8"));assert(evidence.ok&&evidence.gpuExecuted===false);
 const expected=[...evidence.outputFiles,...evidence.packageBefore,evidence.scene,evidence.toolchainManifest,...evidence.buildInputs.files];
 const verify=async()=>{for(const file of expected){const current=await pin(file.path);assert.equal(current.sha256,file.sha256,"Frozen GPU input drift");assert.equal(current.bytes,file.bytes);}};
 await verify();
 const bodies=new Map();for(const file of evidence.outputFiles){const bytes=await readFile(file.path);assert.equal(sha(bytes),file.sha256);bodies.set('/'+win32.basename(file.path),bytes);}
 const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  const path=new URL(request.url).pathname;
  if(request.method==="POST"&&path==="/receipt") {
   const bytes=Buffer.from(await request.arrayBuffer());if(bytes.length>3000000)return new Response("Budget",{status:413});
   const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
   await writeFile(join(directory,"gpu-result.json"),JSON.stringify({result,preparationSha256:sha(await readFile(join(directory,"preparation.json"))),received:new Date().toISOString()},null,2),{flag:"wx"});
   return Response.json({retained:true});
  }
  const name=path==="/"?"/index.html":path,body=bodies.get(name);if(!body)return new Response("Not found",{status:404});
  const type=name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.png')?'image/png':name.endsWith('.glb')?'model/gltf-binary':'application/octet-stream';
  return new Response(body,{headers:{"content-type":type,"cache-control":"no-store"}});
 }});
 console.log(JSON.stringify({root:directory,url:`http://127.0.0.1:${server.port}/`,status:"served-prepared-only-browser-not-started"}));
 setTimeout(()=>server.stop(true),25*60*1000);
} else {
 assert(["--prepare","--prepare-diagnostic","--prepare-fixed"].includes(mode));
 if(mode==="--prepare-fixed")assert(/^[a-f0-9]{64}$/.test(directory??""),"Explicit corrected-source SHA256 required");else assert.equal(directory,undefined);
 const root=await mkdtemp("C:/tmps/glass-object-gpu-");
 const pkg="C:/tmps/object-wasm-development-5aSyix/pkg";
 const three="C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";
 const scene="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/glass-object-scene.ts";
 let report={ok:false,root,gpuExecuted:false,firstFrameOnly:mode==="--prepare-diagnostic",status:"preparing-real-WebGL-harness-no-browser",scope:"Harness only; GPU acceptance pending scheduler; not production Host/editor/export"};
 try {
  const packagePaths=["opencut_wasm_bg.wasm","opencut_wasm_bg.js","opencut_wasm_sync.js","package.json"].map(name=>join(pkg,name));
  report.packageBefore=await Promise.all(packagePaths.map(pin));assert.equal(report.packageBefore[0].sha256,"5d40cb7ae4e0fed4d7c7b81d1ef7617b5d874ec5dd6fbead2da03fbc8d021560");
  report.scene=await pin(scene);report.sourceLineage={priorCounterexampleSha256:"2a687e43962af1f1610d7f68f2b8832aadc741b75add049ea85d0720b0965e85",correctedSourceExplicitPin:mode==="--prepare-fixed"?directory:null};
  assert.equal(report.scene.sha256,mode==="--prepare-fixed"?directory:report.sourceLineage.priorCounterexampleSha256);
  report.toolchainManifest=await pin(join(three,"node_modules/three/package.json"));assert.equal(JSON.parse(await readFile(report.toolchainManifest.path,"utf8")).version,"0.185.1");
  const THREE=await import(pathToFileURL(join(three,"node_modules/three/build/three.module.js")).href);
  const wasm=await import(pathToFileURL(join(pkg,"opencut_wasm_sync.js")).href);
  const base={version:1,transmission:1,roughness:0.02,thickness:0.4,ior:1.5,dispersion:0,environmentIntensity:0.2};
  const overrides={base:{},opaque:{transmission:0},roughness:{roughness:0.85},thickness:{thickness:2},ior:{ior:2.3}};
  const params={};for(const [name,override] of Object.entries(overrides)){const response=JSON.parse(wasm.resolveGlassObjectParamsJson(JSON.stringify({...base,...override})));assert(response.ok);params[name]=response.params;}
  report.actualResolverCalls=Object.keys(params).length;report.params=params;
  const assets=glassObjectGpuAssets(THREE);report.assets=[];
  for(const asset of assets){const path=join(root,asset.id);await writeFile(path,asset.body,{flag:"wx"});report.assets.push({...await pin(path),kind:asset.kind,mimeType:asset.mimeType});}
  const privateInputs=await createPrivateEffectInputs(root),copied=await privateInputs.captureGroup([scene]);
  const entry=join(root,"gpu-entry.ts");
  await writeFile(entry,`import {runGlassObjectGpu} from ${JSON.stringify(join(workspace,"script/fixtures/glass-object-gpu-browser.ts"))};\nrunGlassObjectGpu(${JSON.stringify({params,firstFrameOnly:report.firstFrameOnly})}).then(async result=>{globalThis.__glassGpuResult=result;await fetch('/receipt',{method:'POST',body:JSON.stringify(result)});},async error=>{const result={ok:false,error:String(error?.stack??error),diagnostic:globalThis.__glassGpuDebug};globalThis.__glassGpuResult=result;await fetch('/receipt',{method:'POST',body:JSON.stringify(result)});});`,{flag:"wx"});
  const captured=new Map();
  const result=await Bun.build({entrypoints:[entry],target:"browser",outdir:root,naming:"glass-gpu.js",plugins:[{name:"frozen-glass-gpu",setup(builder){
   builder.onResolve({filter:/^glass-object-source$/},()=>({path:copied[0].file.path}));
   builder.onResolve({filter:/^three(?:\/.*)?$/},({path})=>({path:path==="three"?join(three,"node_modules/three/build/three.module.js"):join(three,"node_modules/three",path.replace(/^three\/addons\//,"examples/jsm/"))}));
   builder.onLoad({filter:/./},async({path,namespace,loader})=>{assert.equal(namespace,"file");const item=await privateInputs.capture(path,{loader});captured.set(path,item.file);return {contents:item.bytes,loader};});
  }}]});assert(result.success,result.logs.map(String).join("\n"));assert.equal(result.outputs.length,1);
  report.buildInputs={validation:await privateInputs.verify([...captured.values(),...copied.map(x=>x.file)]),files:[...captured.values()],snapshot:privateInputs.evidence()};
  await writeFile(join(root,"index.html"),'<!doctype html><meta charset="UTF-8"><title>Glass optical WebGL probe</title><style>body{margin:0;background:#16191f;color:white}canvas{width:768px;height:576px;image-rendering:pixelated}</style><script type="module" src="/glass-gpu.js"></script>',{flag:"wx"});
  report.outputFiles=await Promise.all([join(root,"index.html"),join(root,"glass-gpu.js"),...report.assets.map(x=>x.path)].map(pin));
  report.packageAfter=await Promise.all(packagePaths.map(pin));assert.deepEqual(report.packageAfter,report.packageBefore);
  assert.deepEqual(await pin(scene),report.scene);report.ok=true;report.status="prepared-awaiting-exclusive-gpu-schedule";
 }catch(error){report.failure={name:error.name,message:error.message};process.exitCode=1;}
 finally{await writeFile(join(root,"preparation.json"),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({root,ok:report.ok,status:report.status,failure:report.failure}));}
}
