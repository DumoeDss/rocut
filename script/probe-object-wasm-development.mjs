import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn,spawnSync} from "node:child_process";
import {mkdir,mkdtemp,readFile,readdir,writeFile,open,statfs,lstat} from "node:fs/promises";
import {dirname,join,resolve,relative} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {checkObjectWasm} from "./fixtures/object-wasm-gates.mjs";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)),"..");
const [cache] = process.argv.slice(2);
assert(process.argv.length<=3,"Optional explicit owned target cache only");
if(cache) assert.equal(resolve(cache),resolve("C:/tmps/object-wasm-development-6jQYhS/target"),"Only authorized prior owned cache");
const root = await mkdtemp("C:/tmps/object-wasm-development-");
const snapshot = join(root,"source"), pkg = join(root,"pkg");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = {ok:false,root,scope:"private development WASM and Glass Host; no GPU",started:new Date().toISOString()};
const save = async (name,value) => writeFile(join(root,name),JSON.stringify(value,null,2),{flag:"wx"});
const free = async () => {const value=await statfs("C:/");return value.bavail*value.bsize;};
const excluded = new Set(["target","pkg","node_modules",".git"]);
async function files(directory) {
 const result=[];
 for(const item of await readdir(directory,{withFileTypes:true})) {
  if(excluded.has(item.name)) continue;
  const path=join(directory,item.name);
  assert(!item.isSymbolicLink(),`No snapshot symlink: ${path}`);
  if(item.isDirectory()) result.push(...await files(path)); else if(item.isFile()) result.push(path);
 }
 return result.sort();
}
async function manifest(directory) {
 try{return await Promise.all((await files(directory)).map(async path=>{const bytes=await readFile(path);return {path:relative(directory,path),bytes:bytes.length,sha256:hash(bytes)};}));}
 catch(error){if(error.code==="ENOENT")return [];throw error;}
}
async function run(command,args,cwd,env,logName) {
 const log=await open(join(root,logName),"wx");
 const started=Date.now(),child=spawn(command,args,{cwd,env,stdio:["ignore","pipe","pipe"],shell:false});
 let reason=null, writes=Promise.resolve();
 const stop=message=>{if(reason)return;reason=message;spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true});};
 const append=bytes=>{writes=writes.then(()=>log.write(bytes));};
 child.stdout.on("data",append); child.stderr.on("data",append);
 const timer=setInterval(async()=>{try {if(Date.now()-started>900000)stop("15 minute timeout");else if(await free()<1.5*1024**3)stop("disk reserve below 1.5 GiB");}catch(error){stop(error.message);}},10000);
 const exit=await new Promise((accept,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>accept({code,signal}));}).finally(async()=>{clearInterval(timer);await writes;await log.close();});
 return {command,args,cwd,...exit,reason,durationMs:Date.now()-started,log:join(root,logName)};
}
try {
 report.freeBefore=await free(); assert(report.freeBefore>=4*1024**3,"Need 4 GiB free on C before fresh build");
 report.canonicalBefore=await manifest(join(workspace,"rust/wasm/pkg"));
 const paths=[...await files(join(workspace,"rust/crates")),...await files(join(workspace,"rust/wasm")),...await files(join(workspace,"apps/desktop/src")),join(workspace,"apps/desktop/Cargo.toml"),...['Cargo.toml','Cargo.lock','rust-toolchain.toml','script/build-wasm.mjs','script/wasm-toolchain.mjs','script/wasm-package-directory.mjs'].map(name=>join(workspace,name))];
 assert(paths.length<=2000,"Snapshot file count bound");
 let total=0; report.sourceBefore=[];
 for(const path of paths.sort()) {
  assert(!(await lstat(path)).isSymbolicLink()); const bytes=await readFile(path);
  new TextDecoder("utf-8",{fatal:true}).decode(bytes); total+=bytes.length;
  assert(total<=64*1024**2,"Snapshot byte bound");
  const name=relative(workspace,path),stored=join(snapshot,name);
  await mkdir(dirname(stored),{recursive:true}); await writeFile(stored,bytes,{flag:"wx"});
  assert.equal(hash(await readFile(stored)),hash(bytes));
  report.sourceBefore.push({path:name,bytes:bytes.length,sha256:hash(bytes)});
 }
 report.sourceBytes=total; await save("source-before.json",report.sourceBefore);
 const env={...process.env,CARGO_TARGET_DIR:cache?resolve(cache):join(root,"target")};
 report.targetCache={path:env.CARGO_TARGET_DIR,reused:Boolean(cache),source:cache?"explicit root authorization after prior compile errors repaired":"fresh"};
 delete env.OPENCUT_WASM_ALLOW_UNPINNED;
 report.metadata=await run("cargo",["metadata","--format-version","1","--no-deps","--offline"],snapshot,env,"metadata.log");
 report.snapshotBuildBefore=await manifest(snapshot);
 report.metadataDrift=report.snapshotBuildBefore.filter((pin,index)=>pin.sha256!==report.sourceBefore[index]?.sha256);
 assert.equal(report.metadata.code,0,"Private metadata preflight failed");
 report.build=await run(process.execPath,["script/build-wasm.mjs","--out-dir",pkg,"--no-opt","--","--locked","--offline"],snapshot,env,"build.log");
 report.sourceAfter=await Promise.all(report.sourceBefore.map(async pin=>{const bytes=await readFile(join(workspace,pin.path));return {...pin,bytes:bytes.length,sha256:hash(bytes)};}));
 report.snapshotAfter=await manifest(snapshot);
 report.sourceDrift=report.sourceAfter.filter((pin,index)=>pin.sha256!==report.sourceBefore[index].sha256);
 report.snapshotDrift=report.snapshotAfter.filter((pin,index)=>pin.sha256!==report.snapshotBuildBefore[index]?.sha256);
 assert.equal(report.build.code,0,"Actual formal build failed; see build.log");
 assert.equal(report.snapshotDrift.length,0,"Snapshot drift; see before/after pins");
 assert.equal(report.sourceDrift.length,0,"Live source drift; immutable snapshot retained");
 report.package=await manifest(pkg);
 const compiled=new WebAssembly.Module(await readFile(join(pkg,"opencut_wasm_bg.wasm")));
 report.wasmExports=WebAssembly.Module.exports(compiled);
 const module=await import(pathToFileURL(join(pkg,"opencut_wasm_sync.js")).href);
 report.jsExports=Object.keys(module).sort(); report.gates=checkObjectWasm(module);
 const creator="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized/glass-object.mjs";
 const three="C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";
 report.host=await run("C:/Users/Sayo/.bun/bin/bun.exe",[join(workspace,"script/probe-glass-object-host.mjs"),pkg,creator,three],workspace,{...process.env},"host.log");
 assert.equal(report.host.code,0,"Actual Glass Host probe failed; see host.log");
 assert.deepEqual(await manifest(pkg),report.package,"Private package drift"); report.ok=true;
} catch(error) {report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally {
 report.canonicalAfter=await manifest(join(workspace,"rust/wasm/pkg"));
 try{assert.deepEqual(report.canonicalAfter,report.canonicalBefore,"Canonical package drift");}catch(error){report.ok=false;report.canonicalFailure=error.message;process.exitCode=1;}
 report.finished=new Date().toISOString();report.freeAfter=await free();await save("evidence.json",report);
 console.log(JSON.stringify({root,ok:report.ok,failure:report.failure}));
}
