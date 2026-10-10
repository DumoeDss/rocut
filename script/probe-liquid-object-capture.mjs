import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from './browser-probe-toolchain.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg='C:/tmps/liquid-object-wasm-development-35IsB3/pkg';
const packed='C:/tmps/liquid-object-packed-acceptance-9HwhTX';
const threeToolchain='C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9';
const originalCreator='E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized';
const root=await mkdtemp('C:/tmps/liquid-object-capture-');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const receipt={ok:false,root,stage:'preparing',scope:'actual current production compile/archive/capture, private frozen WASM; no release/editor/export claim'};
const processes=[],consoleErrors=[],exceptionEvents=[];
const observe=()=>processes.map(item=>({...item}));
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(...args){
 const process=originalSpawn(...args),flags=args[1]??[];
 const item={executable:basename(args[0]),pid:process.pid,kind:flags.includes('--input-type=module')?'native-worker':flags.includes('--headless=new')?'chromium':'compiler',closed:false};
 processes.push(item);process.once('close',(code,signal)=>Object.assign(item,{closed:true,code,signal}));return process;
};
syncBuiltinESMExports();
const NativeWebSocket=globalThis.WebSocket;
globalThis.WebSocket=class extends NativeWebSocket {
 constructor(...args){super(...args);this.addEventListener('message',event=>{
  try{const message=JSON.parse(String(event.data));
   if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error')consoleErrors.push(message.params.args.map(item=>item.value??item.description).join(' ').slice(0,2000));
   if(message.method==='Runtime.exceptionThrown')exceptionEvents.push(message.params.exceptionDetails);
  }catch{/* Ignore non-JSON/non-event WebSocket frames only. */}
 });}
};
try{
 receipt.packageBefore=await Promise.all(['opencut_wasm_bg.wasm','opencut_wasm_bg.js','opencut_wasm_sync.js','package.json'].map(name=>pin(join(pkg,name))));
 assert.equal(receipt.packageBefore[0].sha256,'7f7dba6b40fa79618d1e2f7fedab82e1731dee9c26564796f597bf31758b349c');
 assert.equal((await pin(join(packed,'opencut_wasm_bg.wasm'))).sha256,receipt.packageBefore[0].sha256);
 const executable=chromium.executablePath();await stat(executable);receipt.browser=await pin(executable);
 const temporary=join(root,'temp'),creator=join(root,'creator');await mkdir(temporary);await mkdir(creator);
 for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temporary;
 const creatorNames=['liquid-object.mjs','liquid-object-scene.ts','liquid-object-geometry.mjs'];
 receipt.creatorBefore=await Promise.all(creatorNames.map(name=>pin(join(originalCreator,name))));
 for(const name of creatorNames)await copyFile(join(originalCreator,name),join(creator,name));
 await copyFile(join(packed,'liquid-object-wasm.mjs'),join(root,'liquid-object-wasm.mjs'));
 await copyFile(join(pkg,'opencut_wasm_bg.wasm'),join(root,'opencut_wasm_bg.wasm'));
 await copyFile(join(workspace,'apps/cli/src/programmatic/liquid-object-worker-entry.mjs'),join(root,'liquid-object-worker-entry.mjs'));
 const esbuild=await import(pathToFileURL(join(threeToolchain,'node_modules/esbuild/lib/main.js')).href);
 const build=await esbuild.build({entryPoints:[join(workspace,'script/fixtures/liquid-object-capture-probe.ts')],bundle:true,write:false,
  platform:'node',format:'esm',metafile:true,logLevel:'silent',define:{'import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__':JSON.stringify('./liquid-object-wasm.mjs')},
  plugins:[{name:'fixed-private-wasm-only',setup(builder){builder.onResolve({filter:/^opencut-wasm$/},()=>({path:pathToFileURL(join(pkg,'opencut_wasm_sync.js')).href,external:true}));}}]});
 assert.equal(build.outputFiles.length,1);assert(build.outputFiles[0].contents.length<10*1024*1024);
 esbuild.stop();
 const bundle=join(root,'capture-harness.mjs');await writeFile(bundle,build.outputFiles[0].contents,{flag:'wx'});
 receipt.bundle=await pin(bundle);receipt.sourceBefore=await Promise.all(Object.keys(build.metafile.inputs).map(path=>pin(resolve(workspace,path))));
 await writeFile(join(root,'preparation.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 receipt.stage='execute-production-entry';
 const {runLiquidCaptureProbe}=await import(pathToFileURL(bundle).href);
 receipt.capture=await runLiquidCaptureProbe({root,creator,threeToolchain,executable,observe});
 assert.equal(consoleErrors.length,0);assert.equal(exceptionEvents.length,0);assert(processes.every(item=>item.closed),'Every owned compiler/worker/browser must actually close');
 receipt.ok=receipt.capture.ok;receipt.stage='complete';
}catch(error){receipt.failure={name:error.name,message:error.message,stack:error.stack,causes:error.errors?.map(item=>({name:item.name,message:item.message,stack:item.stack}))};receipt.capture=error.receipt;process.exitCode=1;}
finally{
 receipt.processes=observe();receipt.consoleErrors=consoleErrors;receipt.exceptionEvents=exceptionEvents;
 if(receipt.packageBefore){receipt.packageAfter=await Promise.all(receipt.packageBefore.map(item=>pin(item.path)));assert.deepEqual(receipt.packageAfter,receipt.packageBefore);}
 if(receipt.creatorBefore){receipt.creatorAfter=await Promise.all(receipt.creatorBefore.map(item=>pin(item.path)));assert.deepEqual(receipt.creatorAfter,receipt.creatorBefore);}
 if(receipt.sourceBefore){receipt.sourceAfter=await Promise.all(receipt.sourceBefore.map(item=>pin(item.path)));receipt.sourceUnchanged=JSON.stringify(receipt.sourceBefore)===JSON.stringify(receipt.sourceAfter);}
 await writeFile(join(root,'evidence.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 childProcess.spawn=originalSpawn;syncBuiltinESMExports();globalThis.WebSocket=NativeWebSocket;
 console.log(JSON.stringify({root,ok:receipt.ok,stage:receipt.stage,captureStage:receipt.capture?.stage,failure:receipt.failure?.message}));
}
