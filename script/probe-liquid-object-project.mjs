import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from './browser-probe-toolchain.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pkg='C:/tmps/liquid-object-wasm-development-35IsB3/pkg',packed='C:/tmps/liquid-object-packed-acceptance-9HwhTX';
const threeToolchain='C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9';
const originalCreator='E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized';
const ffmpeg='E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe',ffprobe='E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe';
const root=await mkdtemp('C:/tmps/liquid-object-project-'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const receipt={ok:false,root,stage:'preparing-CPU',scope:'dedicated actual HeadlessHost/FileProjectStore persistence then same-source formal rasterizer + external diagnostic encoding; not Rocut production export/editor UI/full compositor/release acceptance'};
const processes=[],errors=[],exceptions=[],sourcePins=new Map(),originalSpawn=childProcess.spawn;
const observe=()=>processes.map(item=>({...item}));
childProcess.spawn=function(...args){const process=originalSpawn(...args),flags=args[1]??[];
 const item={executable:basename(args[0]),pid:process.pid,kind:flags.includes('--input-type=module')?'native-worker':flags.includes('--headless=new')?'chromium':basename(args[0]),closed:false};
 processes.push(item);process.once('close',(code,signal)=>Object.assign(item,{closed:true,code,signal}));return process;};
syncBuiltinESMExports();
const NativeWebSocket=globalThis.WebSocket;
globalThis.WebSocket=class extends NativeWebSocket{constructor(...args){super(...args);this.addEventListener('message',event=>{
 try{const message=JSON.parse(String(event.data));if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(item=>item.value??item.description).join(' ').slice(0,2000));
 if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);}catch{/* Ignore non-JSON/non-event WebSocket frames only. */}});}};
try{
 receipt.packageBefore=await Promise.all(['opencut_wasm_bg.wasm','opencut_wasm_bg.js','opencut_wasm_sync.js','package.json'].map(name=>pin(join(pkg,name))));
 assert.equal(receipt.packageBefore[0].sha256,'7f7dba6b40fa79618d1e2f7fedab82e1731dee9c26564796f597bf31758b349c');
 assert.equal((await pin(join(packed,'opencut_wasm_bg.wasm'))).sha256,receipt.packageBefore[0].sha256);
 const executable=chromium.executablePath();for(const path of [executable,ffmpeg,ffprobe])await stat(path);
 receipt.tools=await Promise.all([executable,ffmpeg,ffprobe].map(pin));
 const temporary=join(root,'temp'),creator=join(root,'creator');await mkdir(temporary);await mkdir(creator);
 for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temporary;
 const creatorNames=['liquid-object.mjs','liquid-object-scene.ts','liquid-object-geometry.mjs'];
 receipt.creatorBefore=await Promise.all(creatorNames.map(name=>pin(join(originalCreator,name))));
 for(const name of creatorNames)await copyFile(join(originalCreator,name),join(creator,name));
 await copyFile(join(packed,'liquid-object-wasm.mjs'),join(root,'liquid-object-wasm.mjs'));
 await copyFile(join(pkg,'opencut_wasm_bg.wasm'),join(root,'opencut_wasm_bg.wasm'));
 await copyFile(join(workspace,'apps/cli/src/programmatic/liquid-object-worker-entry.mjs'),join(root,'liquid-object-worker-entry.mjs'));
 const esbuild=await import(pathToFileURL(join(threeToolchain,'node_modules/esbuild/lib/main.js')).href);
 const build=await esbuild.build({entryPoints:[join(workspace,'script/fixtures/liquid-object-project-entry.ts')],bundle:true,write:false,
  platform:'node',format:'esm',metafile:true,logLevel:'silent',banner:{js:"import {createRequire as __probeRequire} from 'node:module';const require=__probeRequire(import.meta.url);"},
  define:{'import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__':JSON.stringify('./liquid-object-wasm.mjs')},
  plugins:[{name:'fixed-private-native-and-snapshot',setup(builder){
   builder.onResolve({filter:/^opencut-wasm$/},()=>({path:pathToFileURL(join(pkg,'opencut_wasm_sync.js')).href,external:true}));
   builder.onLoad({filter:/\.(ts|tsx|js|mjs|cjs|json)$/},async({path})=>{
    const bytes=await readFile(path),item={path,bytes:bytes.length,sha256:sha(bytes)};sourcePins.set(path,item);
    const suffix=extname(path),loader=suffix==='.ts'?'ts':suffix==='.tsx'?'tsx':suffix==='.json'?'json':'js';return {contents:bytes,loader};
   });
  }}]});esbuild.stop();assert.equal(build.outputFiles.length,1);assert(build.outputFiles[0].contents.length<20*1024*1024);
 const bundle=join(root,'project-harness.mjs');await writeFile(bundle,build.outputFiles[0].contents,{flag:'wx'});receipt.bundle=await pin(bundle);receipt.sourceConsumed=[...sourcePins.values()];
 await writeFile(join(root,'preparation.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 const entry=await import(pathToFileURL(bundle).href);receipt.stage='CPU-host-persistence';
 const saved=await entry.runLiquidProjectHost({root,creator,threeToolchain,executable,observe});receipt.persistence=saved.report;
 assert.equal(saved.report.ok,true);assert(processes.every(item=>item.closed));
 receipt.stage='GPU-same-project-short-rasterizer-and-diagnostic-encode';
 receipt.render=await entry.runLiquidProjectRender({root,creator,threeToolchain,executable,observe,saved,ffmpeg,ffprobe});
 assert.equal(receipt.render.ok,true);assert.equal(errors.length,0);assert.equal(exceptions.length,0);assert(processes.every(item=>item.closed));
 receipt.ok=true;receipt.stage='complete';
}catch(error){receipt.failure={name:error.name,message:error.message.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]'),stack:error.stack?.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]'),causes:error.errors?.map(item=>({name:item.name,message:item.message}))};receipt.stageReceipt=error.receipt;process.exitCode=1;}
finally{
 receipt.processes=observe();receipt.consoleErrors=errors;receipt.exceptionEvents=exceptions;
 if(receipt.packageBefore){receipt.packageAfter=await Promise.all(receipt.packageBefore.map(item=>pin(item.path)));assert.deepEqual(receipt.packageAfter,receipt.packageBefore);}
 if(receipt.creatorBefore){receipt.creatorAfter=await Promise.all(receipt.creatorBefore.map(item=>pin(item.path)));assert.deepEqual(receipt.creatorAfter,receipt.creatorBefore);}
 receipt.sourceAfter=await Promise.all([...sourcePins.values()].map(item=>pin(item.path)));receipt.sourceUnchanged=JSON.stringify(receipt.sourceConsumed)===JSON.stringify(receipt.sourceAfter);
 await writeFile(join(root,'evidence.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 childProcess.spawn=originalSpawn;syncBuiltinESMExports();globalThis.WebSocket=NativeWebSocket;
 console.log(JSON.stringify({root,ok:receipt.ok,stage:receipt.stage,failure:receipt.failure?.message}));
}
