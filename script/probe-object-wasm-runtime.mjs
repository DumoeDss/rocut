import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {mkdtemp,readFile,readdir,writeFile,open,statfs} from "node:fs/promises";
import {dirname,join,resolve,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {checkObjectWasm} from "./fixtures/object-wasm-gates.mjs";

const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const buildRoot="C:/tmps/object-wasm-development-5aSyix",pkg=join(buildRoot,"pkg");
const root=await mkdtemp("C:/tmps/object-wasm-runtime-");
const creator="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/glass-object.mjs";
const three="C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
async function files(directory){const paths=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);assert(!entry.isSymbolicLink(),`Unexpected symlink ${path}`);if(entry.isDirectory())paths.push(...await files(path));else if(entry.isFile())paths.push(path);}return paths.sort();}
const report={ok:false,root,scope:"immutable snapshot-built development WASM/runtime/Glass Host; not current HEAD release consistency; no browser/GPU",started:new Date().toISOString()};
let writes=Promise.resolve();
try {
 assert(process.versions.bun,"Explicit existing Bun required");
 const receipt=await pin(join(buildRoot,"evidence.json"));
 assert.equal(receipt.sha256,"a008a425109af9616a714641657ed2218facc23641a7a0232753284649ccf501");
 const build=JSON.parse(await readFile(receipt.path,"utf8"));
 assert.equal(build.build.code,0);assert.deepEqual(build.snapshotDrift,[]);assert.deepEqual(build.metadataDrift,[]);
 assert.deepEqual(build.canonicalAfter,build.canonicalBefore);
 const canonical=join(workspace,"rust/wasm/pkg"),canonicalPaths=await files(canonical);
 report.canonicalBefore=await Promise.all(canonicalPaths.map(async path=>{const value=await pin(path);return {path:relative(canonical,path),bytes:value.bytes,sha256:value.sha256};}));
 assert.deepEqual(report.canonicalBefore,build.canonicalAfter,"Canonical must still match preserved build pins");
 report.build={receipt,exit:0,snapshotUnchanged:true,canonicalUnchanged:true,liveDrift:build.sourceDrift,targetCache:build.targetCache};
 const source=await Promise.all((await files(join(buildRoot,"source"))).map(async path=>{const value=await pin(path);return {path:relative(join(buildRoot,"source"),path),bytes:value.bytes,sha256:value.sha256};}));
 assert.deepEqual(source,build.snapshotAfter,"Successful build snapshot must remain unchanged");
 const fixtureNames=["script/probe-object-wasm-runtime.mjs","script/probe-glass-object-host.mjs","script/fixtures/object-wasm-gates.mjs","script/fixtures/glass-object-host.mjs","script/fixtures/glass-object-assets.ts","script/fixtures/glass-object-preflight.mjs","script/fixtures/glass-object-persistence.mjs","script/fixtures/private-effect-inputs.mjs","script/fixtures/three-assets.ts"];
 const inputs=[receipt.path,...canonicalPaths,...await files(pkg),...await files(three),creator,join(dirname(creator),"glass-object-scene.ts"),...fixtureNames.map(name=>join(workspace,name))];
 assert(inputs.length<10000,"Bound runtime inventory");
 report.before=await Promise.all(inputs.map(pin));
 const wasmPath=join(pkg,"opencut_wasm_bg.wasm"),compiled=new WebAssembly.Module(await readFile(wasmPath));
 assert.equal((await pin(wasmPath)).sha256,"5d40cb7ae4e0fed4d7c7b81d1ef7617b5d874ec5dd6fbead2da03fbc8d021560");
 report.wasmExports=WebAssembly.Module.exports(compiled);
 const module=await import(pathToFileURL(join(pkg,"opencut_wasm_sync.js")).href);
 report.jsExports=Object.keys(module).sort();report.gates=checkObjectWasm(module);
 const command="C:/Users/Sayo/.bun/bin/bun.exe",args=[join(workspace,"script/probe-glass-object-host.mjs"),pkg,creator,three];
 const log=await open(join(root,"host.log"),"wx");const started=Date.now();
 const child=spawn(command,args,{cwd:workspace,env:{...process.env},stdio:["ignore","pipe","pipe"],shell:false});
 const append=bytes=>{writes=writes.then(()=>log.write(bytes));};child.stdout.on("data",append);child.stderr.on("data",append);
 let stopped=false;
 const timer=setInterval(async()=>{const disk=await statfs("C:/");if(!stopped&&(Date.now()-started>180000||disk.bavail*disk.bsize<1.5*1024**3)){stopped=true;spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});}},10000);
 report.host=await new Promise((accept,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>accept({command,args,code,signal,durationMs:Date.now()-started,stopped}));}).finally(async()=>{clearInterval(timer);await writes;await log.close();});
 const output=await readFile(join(root,"host.log"),"utf8");
 const result=output.split(/\r?\n/).filter(line=>line.startsWith('{"root":')).map(line=>JSON.parse(line)).at(-1);
 assert(result);report.host.receipt=await pin(join(result.root,"evidence.json"));
 assert.equal(report.host.code,0,"Actual Glass Host failed; see host.log");assert(result.ok);
 const host=JSON.parse(await readFile(report.host.receipt.path,"utf8"));assert(host.ok);
 report.host.result=host.host;
 report.after=await Promise.all(inputs.map(pin));assert.deepEqual(report.after,report.before,"Runtime dependency drift");
 report.ok=true;
}catch(error){report.failure={name:error.name,message:String(error.message).replace(/https?:\/\/[^\s"'<>]+/g,"[private URL redacted]")};process.exitCode=1;}
finally {
 if(report.before) {
  report.after=await Promise.all(report.before.map(value=>pin(value.path)));
  report.runtimeDrift=report.after.filter((value,index)=>value.sha256!==report.before[index].sha256);
  if(report.runtimeDrift.length){report.ok=false;report.pinFailure="Runtime dependency drift";process.exitCode=1;}
 }
 const disk=await statfs("C:/");report.freeAfter=disk.bavail*disk.bsize;report.finished=new Date().toISOString();
 await writeFile(join(root,"evidence.json"),JSON.stringify(report,null,2),{flag:"wx"});
 console.log(JSON.stringify({root,ok:report.ok,calls:report.gates?.calls,failure:report.failure}));
}
