import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createPrivateEffectInputs} from "./fixtures/private-effect-inputs.mjs";
import {inkObjectGpuAssets} from "./fixtures/ink-object-gpu-assets.ts";

assert(process.versions.bun,"Explicit existing Bun required; no installation");
const [expectedScene]=process.argv.slice(2);assert(process.argv.length===3&&/^[a-f0-9]{64}$/.test(expectedScene),"Explicit current source SHA256 required; old receipts never refreshed");
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const root=await mkdtemp("C:/tmps/ink-object-gpu-");
const pkg="C:/tmps/object-wasm-development-5aSyix/pkg";
const three="C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";
const scene="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/ink-object-scene.ts";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
let report={ok:false,root,gpuExecuted:false,expectedScene,status:"preparing-real-Ink-WebGL-harness",scope:"Mapped/normal-bearing curved diagnostic GLB/HDR only; not formal Host/editor/export/installation"};
try {
 const packagePaths=["opencut_wasm_bg.wasm","opencut_wasm_bg.js","opencut_wasm_sync.js","package.json"].map(name=>join(pkg,name));
 report.packageBefore=await Promise.all(packagePaths.map(pin));assert.equal(report.packageBefore[0].sha256,"5d40cb7ae4e0fed4d7c7b81d1ef7617b5d874ec5dd6fbead2da03fbc8d021560");
 report.scene=await pin(scene);assert.equal(report.scene.sha256,expectedScene);
 report.toolchainManifest=await pin(join(three,"node_modules/three/package.json"));assert.equal(JSON.parse(await readFile(report.toolchainManifest.path,"utf8")).version,"0.185.1");
 const fixtureNames=["script/probe-ink-object-gpu.mjs","script/fixtures/ink-object-gpu-assets.ts","script/fixtures/glass-object-gpu-assets.ts","script/fixtures/three-assets.ts"];
 report.fixtureBefore=await Promise.all(fixtureNames.map(name=>pin(join(workspace,name))));
 const THREE=await import(pathToFileURL(join(three,"node_modules/three/build/three.module.js")).href);
 const wasm=await import(pathToFileURL(join(pkg,"opencut_wasm_sync.js")).href);
 const base={version:1,contourWidth:4,inkDensity:0.85,paperTexture:0.65,paperScale:12,seed:19};
 const variants={base:{},inkColor:{inkColor:"#bc1832"},density:{inkDensity:0.15},paperTexture:{paperTexture:0},paperScale:{paperScale:64},seed:{seed:41},contour:{contourWidth:0}};
 const params={};report.actualResolver=[];for(const [name,override] of Object.entries(variants)){const input={...base,...override},response=JSON.parse(wasm.resolveInkObjectParamsJson(JSON.stringify(input)));assert(response.ok);params[name]=response.params;report.actualResolver.push({name,input,response});}
 report.params=params;report.assets=[];
 for(const asset of inkObjectGpuAssets(THREE)){const path=join(root,asset.id);await writeFile(path,asset.body,{flag:"wx"});report.assets.push({...await pin(path),kind:asset.kind,mimeType:asset.mimeType});}
 const privateInputs=await createPrivateEffectInputs(root),copied=await privateInputs.captureGroup([scene]);
 const entry=join(root,"gpu-entry.ts");
 await writeFile(entry,`import {runInkObjectGpu} from ${JSON.stringify(join(workspace,"script/fixtures/ink-object-gpu-browser.ts"))};\nrunInkObjectGpu(${JSON.stringify({params})}).then(async result=>{globalThis.__inkGpuResult=result;await fetch('/receipt',{method:'POST',body:JSON.stringify(result)});},async error=>{const result={ok:false,error:String(error?.stack??error),diagnostic:globalThis.__inkGpuDebug};globalThis.__inkGpuResult=result;await fetch('/receipt',{method:'POST',body:JSON.stringify(result)});});`,{flag:"wx"});
 const captured=new Map();
 const result=await Bun.build({entrypoints:[entry],target:"browser",outdir:root,naming:"ink-gpu.js",plugins:[{name:"frozen-ink-gpu",setup(builder){
  builder.onResolve({filter:/^ink-object-source$/},()=>({path:copied[0].file.path}));
  builder.onResolve({filter:/^three(?:\/.*)?$/},({path})=>({path:path==="three"?join(three,"node_modules/three/build/three.module.js"):join(three,"node_modules/three",path.replace(/^three\/addons\//,"examples/jsm/"))}));
  builder.onLoad({filter:/./},async({path,namespace,loader})=>{assert.equal(namespace,"file");const item=await privateInputs.capture(path,{loader});captured.set(path,item.file);return {contents:item.bytes,loader};});
 }}]});assert(result.success,result.logs.map(String).join("\n"));assert.equal(result.outputs.length,1);
 report.buildInputs={validation:await privateInputs.verify([...captured.values(),...copied.map(x=>x.file)]),files:[...captured.values()],snapshot:privateInputs.evidence()};
 await writeFile(join(root,"index.html"),'<!doctype html><meta charset="UTF-8"><title>Ink diagnostic WebGL probe</title><style>body{margin:0;background:#16191f}canvas{width:768px;height:576px;image-rendering:pixelated}</style><script type="module" src="/ink-gpu.js"></script>',{flag:"wx"});
 report.outputFiles=await Promise.all([join(root,"index.html"),join(root,"ink-gpu.js"),...report.assets.map(x=>x.path)].map(pin));
 report.packageAfter=await Promise.all(packagePaths.map(pin));assert.deepEqual(report.packageAfter,report.packageBefore);
 report.fixtureAfter=await Promise.all(fixtureNames.map(name=>pin(join(workspace,name))));assert.deepEqual(report.fixtureAfter,report.fixtureBefore);
 assert.deepEqual(await pin(scene),report.scene);report.ok=true;report.status="prepared-awaiting-GPU";
}catch(error){report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally{await writeFile(join(root,"preparation.json"),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({root,ok:report.ok,status:report.status,failure:report.failure}));}
