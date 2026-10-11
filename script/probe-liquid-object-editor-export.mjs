import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {copyFile,mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from './browser-probe-toolchain.mjs';
import {resolveNativeProbeWasm,assertNativeProbeWasmIdentity} from './native-probe-wasm-binding.mjs';
import {stageNativeProbeWasm} from './native-probe-wasm-staging.mjs';
import {pngPixels,visibility} from './fixtures/liquid-object-capture-probe-pixels.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=await mkdtemp('C:/tmps/liquid-object-editor-export-');
const preparation=process.argv[2]===undefined?'C:/tmps/liquid-object-editor-export-preparation-OuvfQI':process.argv[2],saved='C:/tmps/liquid-object-project-VnYDFE';
assert(preparation?.startsWith('C:/tmps/liquid-object-editor-export-preparation-'));
const binding=resolveNativeProbeWasm(),pkg=binding.directory,packed='C:/tmps/liquid-object-packed-acceptance-9HwhTX';
const toolchain='C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9';
const ffmpeg='E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe',ffprobe='E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const tree=async path=>{const items=[];for(const entry of await readdir(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())items.push(...await tree(next));else{assert(entry.isFile());items.push(await pin(next));}}return items;};
const report={ok:false,root,stage:'CPU-host-bundle',scope:'actual persisted project decodeProject/buildScene/CanvasRenderer/WasmCompositor/SceneExporter.export; 23..26 only; not editor UI/history/installed/full duration',
 thresholds:{directMean:2,directMax:8,decodedMean:3,decodedActiveMean:6,visiblePixels:200,timestampToleranceSeconds:0.001}};
const processes=[],sources=new Map(),errors=[],external=[],spawn=childProcess.spawn;let browser,host;
childProcess.spawn=function(...args){const process=spawn(...args),item={executable:basename(args[0]),pid:process.pid,closed:false};processes.push(item);process.once('close',(code,signal)=>Object.assign(item,{closed:true,code,signal}));return process;};syncBuiltinESMExports();
const persist=()=>writeFile(join(root,'evidence.json'),JSON.stringify(report,null,2));
function compare({a,b}){assert.equal(a.length,b.length);let sum=0,max=0,activeSum=0,activeCount=0;for(let i=0;i<a.length;i+=4){assert.equal(a[i+3],255);assert.equal(b[i+3],255);const active=[0,1,2].some(c=>Math.abs(a[i+c]-a[c])>5);for(let c=0;c<3;c++){const delta=Math.abs(a[i+c]-b[i+c]);sum+=delta;max=Math.max(max,delta);if(active){activeSum+=delta;activeCount++;}}}return {mean:sum/(a.length/4*3),max,activeMean:activeSum/Math.max(activeCount,1)};}
try{
 report.projectBefore=await tree(join(saved,'project'));const prep=JSON.parse(await readFile(join(preparation,'evidence.json'),'utf8'));assert(prep.ok);report.preparation=await pin(join(preparation,'evidence.json'));
 for(const item of [...prep.sources,...prep.outputs])assert.deepEqual(await pin(item.path),item);
 for(const item of prep.pkgBefore){const name=basename(item.path),selected=binding.identity.find(file=>file.name===name);assert(selected&&selected.bytes===item.bytes&&selected.sha256===item.sha256,'Browser preparation and Host native package differ');}
 if(binding.lane==='production')assertNativeProbeWasmIdentity(binding,prep.wasmBinding?.identity);
 const temp=join(root,'temp');await mkdir(temp);for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temp;
 if(binding.lane==='legacy')for(const name of ['liquid-object-wasm.mjs'])await copyFile(join(packed,name),join(root,name));
 const staged=await stageNativeProbeWasm({binding,runRoot:root});
 report.wasmBinding={lane:binding.lane,sha256:binding.wasmSha256,source:binding.directory,node:staged.directory,identity:binding.identity,browserEvidenceKind:'served-byte-fetch-stamp-after-native-entry-import',wasmInstantiationObserved:false};
 await copyFile(join(pkg,'opencut_wasm_bg.wasm'),join(root,'opencut_wasm_bg.wasm'));
 await copyFile(join(repo,'apps/cli/src/programmatic/liquid-object-worker-entry.mjs'),join(root,'liquid-object-worker-entry.mjs'));
 report.nativePackage=await Promise.all(['opencut_wasm_sync.js','opencut_wasm_bg.wasm'].map(name=>pin(join(pkg,name))));assert.equal(report.nativePackage[1].sha256,binding.wasmSha256);
 const esbuild=await import(pathToFileURL(join(toolchain,'node_modules/esbuild/lib/main.js')).href);
 const build=await esbuild.build({entryPoints:[join(repo,'script/fixtures/liquid-object-editor-export-host.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
 banner:{js:"import {createRequire as __probeRequire} from 'node:module';const require=__probeRequire(import.meta.url);"},define:binding.lane==='legacy'?{'import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__':JSON.stringify('./liquid-object-wasm.mjs')}:{},
 plugins:[{name:'frozen-native-byte-pins',setup(api){api.onResolve({filter:/^opencut-wasm(\/sync)?$/},()=>({path:pathToFileURL(staged.syncEntry).href,external:true}));api.onLoad({filter:/\.(ts|tsx|js|mjs|cjs|json)$/},async({path})=>{const bytes=await readFile(path);sources.set(path,{path,bytes:bytes.length,sha256:sha(bytes)});const suffix=extname(path);return {contents:bytes,loader:suffix==='.ts'?'ts':suffix==='.tsx'?'tsx':suffix==='.json'?'json':'js'};});}}]});esbuild.stop();
 const bundle=join(root,'host.mjs');await writeFile(bundle,build.outputFiles[0].contents,{flag:'wx'});report.hostBundle=await pin(bundle);report.hostSources=[...sources.values()];await persist();
 const entry=await import(pathToFileURL(bundle).href);host=await entry.openLiquidExportHost({root,projectRoot:join(saved,'project'),staticDir:join(preparation,'editor'),toolchain,executable:chromium.executablePath(),ffmpeg,ffprobe});
 report.stage='GPU-production-export';await persist();
 browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),timeout:60000,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-gl=angle']});
 const page=await browser.newPage(),origin=new URL(host.editorUrl).origin;
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin){external.push(url.origin);await route.abort();}else await route.continue();});
 await page.goto(host.editorUrl,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>typeof globalThis.__liquidExportRun==='function',undefined,{timeout:60000});
 if(binding.lane==='production'){report.browserWasmIdentity=await page.evaluate(()=>globalThis.__nativeProbeWasmIdentity);assertNativeProbeWasmIdentity(binding,report.browserWasmIdentity);}assertNativeProbeWasmIdentity(staged);
 const project=JSON.parse(await readFile(join(saved,'project/project.json'),'utf8'));
 const result=await page.evaluate(async options=>{const result=await globalThis.__liquidExportRun(options);const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};return {...result,video:encode(result.video),references:result.references.map(encode)};},{project,base:new URL('api',host.editorUrl).href});
 assert(result.ok);assert.equal(result.frameCount,4);assert.equal(errors.length,0);assert.equal(external.length,0);
 const video=join(root,'production.webm');await writeFile(video,Buffer.from(result.video,'base64'),{flag:'wx'});report.video=await pin(video);delete result.video;
 const references=result.references.map(value=>Buffer.from(value,'base64'));delete result.references;report.production=result;report.directComparisons=[];
 for(let i=0;i<4;i++){const rgba=references[i];assert.equal(rgba.length,192*128*4);await writeFile(join(root,`reference-${i}.rgba`),rgba,{flag:'wx'});assert(visibility({width:192,height:128,pixels:rgba}).changedPixels>report.thresholds.visiblePixels);const direct=pngPixels(await readFile(join(saved,`frame-${String(i).padStart(2,'0')}.png`)));const difference=compare({a:direct.pixels,b:rgba});report.directComparisons.push(difference);assert(difference.mean<=report.thresholds.directMean&&difference.max<=report.thresholds.directMax,`Compositor/direct frame ${i} mismatch`);}
 report.stage='independent-decode-only';await persist();const run=promisify(childProcess.execFile);
 const probed=await run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames:frame=best_effort_timestamp_time','-of','json',video],{windowsHide:true,timeout:30000});report.probe=JSON.parse(probed.stdout);
 const stream=report.probe.streams[0];assert.equal(stream.width,192);assert.equal(stream.height,128);assert.equal(stream.nb_read_frames,'4');assert.equal(stream.r_frame_rate,'30/1');assert.equal(report.probe.frames.length,4);
 for(let i=0;i<4;i++)assert(Math.abs(Number(report.probe.frames[i].best_effort_timestamp_time)-i/30)<=report.thresholds.timestampToleranceSeconds);
 const raw=join(root,'decoded.rgba');await run(ffmpeg,['-hide_banner','-loglevel','error','-n','-i',video,'-frames:v','4','-f','rawvideo','-pix_fmt','rgba',raw],{windowsHide:true,timeout:30000});const decoded=await readFile(raw);assert.equal(decoded.length,4*192*128*4);report.decoded=await pin(raw);report.decodedComparisons=[];
 for(let i=0;i<4;i++){const difference=compare({a:references[i],b:decoded.subarray(i*192*128*4,(i+1)*192*128*4)});report.decodedComparisons.push(difference);assert(difference.mean<=report.thresholds.decodedMean&&difference.activeMean<=report.thresholds.decodedActiveMean,`Encoded frame ${i} mismatch`);}
 assertNativeProbeWasmIdentity(binding);assertNativeProbeWasmIdentity(staged);
 report.ok=true;report.stage='complete';
}catch(error){report.failure={name:error.name,message:error.message.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]'),stack:error.stack?.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]')};process.exitCode=1;}
finally{
 const cleanup=[];for(const [name,close] of [['browser',()=>browser?.close()],['Host',()=>host?.close()]])try{await close();cleanup.push({name,closed:true});}catch(error){cleanup.push({name,closed:false,message:error.message});report.ok=false;process.exitCode=1;}
 report.cleanup=cleanup;report.processes=processes;report.errors=errors;report.externalRequests=external;
 report.projectAfter=await tree(join(saved,'project'));report.projectUnchanged=JSON.stringify(report.projectBefore)===JSON.stringify(report.projectAfter);
 report.hostSourcesAfter=await Promise.all([...sources.values()].map(item=>pin(item.path)));report.hostSourcesUnchanged=JSON.stringify(report.hostSources)===JSON.stringify(report.hostSourcesAfter);
 if(!report.projectUnchanged||!report.hostSourcesUnchanged||processes.some(item=>!item.closed)){report.ok=false;process.exitCode=1;}
 await persist();childProcess.spawn=spawn;syncBuiltinESMExports();console.log(JSON.stringify({root,ok:report.ok,stage:report.stage,failure:report.failure?.message,cleanup:report.cleanup,childrenClosed:processes.every(item=>item.closed)}));
}
