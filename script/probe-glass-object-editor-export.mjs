import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {copyFile,mkdir,mkdtemp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build,wasm,topLevelAwait,chromium} from './browser-probe-toolchain.mjs';
import {pngPixels,visibility} from './fixtures/liquid-object-capture-probe-pixels.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [savedArg,pkgArg,toolchainArg,executableArg,ffmpegArg,ffprobeArg]=process.argv.slice(2);
const root=await mkdtemp('C:/tmps/glass-object-editor-export-');
const saved=resolve(savedArg),pkg=resolve(pkgArg),toolchain=resolve(toolchainArg);
for(const target of [saved,pkg,toolchain])assert(isAbsolute(target));
assert(executableArg&&isAbsolute(resolve(executableArg)),'Chromium executable path required');
assert(ffmpegArg&&ffprobeArg,'FFmpeg/FFprobe paths required');
const ffmpeg=resolve(ffmpegArg),ffprobe=resolve(ffprobeArg);
const fullDuration=process.env.ROCUT_GLASS_EXPORT_FULL==='1';
const frameWindow=fullDuration?{startFrame:0,frameCount:49}:{startFrame:8,frameCount:4};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pin=async path=>{const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};};
const tree=async path=>{const items=[];for(const entry of await readdir(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())items.push(...await tree(next));else{assert(entry.isFile());items.push(await pin(next));}}return items;};
const report={ok:false,root,saved,pkg,toolchain,stage:'CPU-bundle',scope:fullDuration?'actual persisted edited Glass project decodeProject/buildScene/CanvasRenderer/WasmCompositor/SceneExporter.export; all 49 clip frames 0..48; edited transmission 0.35 baked props; not editor UI/history/installed':'actual persisted edited Glass project decodeProject/buildScene/CanvasRenderer/WasmCompositor/SceneExporter.export; frames 8..11 only; edited transmission 0.35 baked props; not editor UI/history/installed/full duration',
 thresholds:{directMean:2,directMax:8,decodedMean:3,decodedActiveMean:6,visiblePixels:200,timestampToleranceSeconds:0.001}};
const processes=[],sources=new Map(),errors=[],external=[],spawn=childProcess.spawn;let browser,host;
childProcess.spawn=function(...args){const process=spawn(...args),item={executable:basename(args[0]),pid:process.pid,closed:false};processes.push(item);process.once('close',(code,signal)=>Object.assign(item,{closed:true,code,signal}));return process;};syncBuiltinESMExports();
const persist=()=>writeFile(join(root,'evidence.json'),JSON.stringify(report,null,2));
function compare({a,b}){assert.equal(a.length,b.length);let sum=0,max=0,activeSum=0,activeCount=0;for(let i=0;i<a.length;i+=4){assert.equal(a[i+3],255);assert.equal(b[i+3],255);const active=[0,1,2].some(c=>Math.abs(a[i+c]-a[c])>5);for(let c=0;c<3;c++){const delta=Math.abs(a[i+c]-b[i+c]);sum+=delta;max=Math.max(max,delta);if(active){activeSum+=delta;activeCount++;}}}return {mean:sum/(a.length/4*3),max,activeMean:activeSum/Math.max(activeCount,1)};}
try{
 report.projectBefore=await tree(join(saved,'project'));
 const projectJson=await pin(join(saved,'project/project.json'));report.projectJson=projectJson;
 const parsed=JSON.parse(await readFile(projectJson.path,'utf8'));assert(parsed.wrapperVersion===1&&parsed.record.schemaVersion===32);
 const scene=parsed.record.data.scenes.find(value=>value.id===parsed.record.data.currentSceneId);
 const glassClip=[...scene.tracks.main.elements,...scene.tracks.overlay.flatMap(track=>track.elements)].find(element=>element.id==='glass-object');
 assert(glassClip.programmatic.build.inputProps.glass.transmission===0.35);
 report.buildIdentity={engine:glassClip.programmatic.build.engine,engineVersion:glassClip.programmatic.build.engineVersion,toolchainLockSha256:glassClip.programmatic.build.toolchainLock.sha256,durationFrames:glassClip.programmatic.durationFrames};
 const temp=join(root,'temp');await mkdir(temp);for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=temp;
 report.nativePackage=await Promise.all(['opencut_wasm.js','opencut_wasm_bg.js','opencut_wasm_bg.wasm','opencut_wasm_sync.js'].map(name=>pin(join(pkg,name))));
 const input=join(root,'input');await mkdir(input);
 await writeFile(join(input,'index.html'),'<!doctype html><meta charset="utf-8"><title>Private Glass production export</title><script type="module">await import("opencut-wasm");globalThis.__glassExportRun=(await import('+JSON.stringify(join(repo,'script/fixtures/glass-object-editor-export-browser.ts').replaceAll('\\','/'))+')).runGlassEditorExport;</script>',{flag:'wx'});
 const classicRequire=createRequire(join(repo,'packages/editor-classic/package.json'));
 const mediabunny=join(dirname(classicRequire.resolve('mediabunny')),'../modules/src/index.js');
 report.bundleBuild={startedAt:new Date().toISOString()};await persist();
 await build({root:input,configFile:false,envDir:root,envPrefix:'GLASS_EXPORT_PUBLIC_',cacheDir:join(root,'vite-cache'),base:'./',logLevel:'error',
  // Vite's public transform hook uses its required positional (code, id) signature.
  // eslint-disable-next-line opencut/prefer-object-params
  plugins:[wasm(),topLevelAwait(),{name:'glass-export-consumed-byte-pins',async transform(code,id){
   const path=id.split('?')[0];if(path==='/__vite-plugin-wasm-helper')return null;if(isAbsolute(path)&&!path.includes('\0')){const bytes=await readFile(path);const item={path,bytes:bytes.length,sha256:sha(bytes)};const old=sources.get(path);if(old)assert.deepEqual(old,item);sources.set(path,item);}return null;
  }}],resolve:{alias:[{find:/^opencut-wasm$/,replacement:join(pkg,'opencut_wasm.js')},{find:/^mediabunny$/,replacement:mediabunny}]},
  build:{outDir:join(root,'static'),emptyOutDir:false,rollupOptions:{input:join(input,'index.html')}}});
 report.sources=[...sources.values()];report.outputs=await tree(join(root,'static'));report.outputBytes=report.outputs.reduce((sum,item)=>sum+item.bytes,0);assert(report.outputBytes<60*1024*1024);
 const esbuild=await import(pathToFileURL(join(toolchain,'node_modules/esbuild/lib/main.js')).href);
 const hostBundleBuild=await esbuild.build({entryPoints:[join(repo,'script/fixtures/glass-object-editor-export-host.ts')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',
 banner:{js:"import {createRequire as __probeRequire} from 'node:module';const require=__probeRequire(import.meta.url);"},
 plugins:[{name:'glass-export-host-pins',setup(api){api.onResolve({filter:/^opencut-wasm$/},()=>({path:pathToFileURL(join(pkg,'opencut_wasm_sync.js')).href,external:true}));api.onLoad({filter:/\.(ts|tsx|js|mjs|cjs|json)$/},async({path})=>{const bytes=await readFile(path);const item={path,bytes:bytes.length,sha256:sha(bytes)};const old=sources.get(path);if(old)assert.deepEqual(old,item);sources.set(path,item);const suffix=extname(path);return {contents:bytes,loader:suffix==='.ts'?'ts':suffix==='.tsx'?'tsx':suffix==='.json'?'json':'js'};});}}]});esbuild.stop();
 const bundle=join(root,'host.mjs');await writeFile(bundle,hostBundleBuild.outputFiles[0].contents,{flag:'wx'});report.hostBundle=await pin(bundle);report.hostSources=[...sources.values()];await persist();
 const entry=await import(pathToFileURL(bundle).href);host=await entry.openGlassExportHost({root,projectRoot:join(saved,'project'),staticDir:join(root,'static'),toolchain,executable:resolve(executableArg),ffmpeg,ffprobe});
 report.stage='GPU-production-export';await persist();
 browser=await chromium.launch({headless:true,executablePath:resolve(executableArg),timeout:60000,args:['--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-gl=angle']});
 const page=await browser.newPage(),origin=new URL(host.editorUrl).origin;
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin){external.push(url.origin);await route.abort();}else await route.continue();});
 await page.goto(host.editorUrl,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>typeof globalThis.__glassExportRun==='function',undefined,{timeout:60000});
 const result=await page.evaluate(async options=>{const result=await globalThis.__glassExportRun(options);const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};return {...result,video:encode(result.video),references:result.references.map(encode)};},{project:parsed,base:new URL('api',host.editorUrl).href,window:frameWindow});
 assert(result.ok);assert.equal(result.frameCount,frameWindow.frameCount);assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(external.length,0);
 const video=join(root,'production.webm');await writeFile(video,Buffer.from(result.video,'base64'),{flag:'wx'});report.video=await pin(video);delete result.video;
 const references=result.references.map(value=>Buffer.from(value,'base64'));delete result.references;report.production=result;report.directComparisons=[];
 for(let i=0;i<frameWindow.frameCount;i++){const rgba=references[i];assert.equal(rgba.length,192*128*4);await writeFile(join(root,`reference-${i}.rgba`),rgba,{flag:'wx'});assert(visibility({width:192,height:128,pixels:rgba}).changedPixels>report.thresholds.visiblePixels,`Reference frame ${i} not visibly rendered`);report.directComparisons.push({frame:frameWindow.startFrame+i,note:'in-run CanvasRenderer reference; no separate formal frame chain for Glass'});}
 report.stage='independent-decode-only';await persist();const run=promisify(childProcess.execFile);
 const probed=await run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames:frame=best_effort_timestamp_time','-of','json',video],{windowsHide:true,timeout:30000});report.probe=JSON.parse(probed.stdout);
 const stream=report.probe.streams[0];assert.equal(stream.width,192);assert.equal(stream.height,128);assert.equal(stream.nb_read_frames,String(frameWindow.frameCount));assert.equal(stream.r_frame_rate,'24/1');assert.equal(report.probe.frames.length,frameWindow.frameCount);
 for(let i=0;i<frameWindow.frameCount;i++)assert(Math.abs(Number(report.probe.frames[i].best_effort_timestamp_time)-i/24)<=report.thresholds.timestampToleranceSeconds,`Frame ${i} PTS mismatch`);
 const raw=join(root,'decoded.rgba');await run(ffmpeg,['-hide_banner','-loglevel','error','-n','-i',video,'-frames:v',String(frameWindow.frameCount),'-f','rawvideo','-pix_fmt','rgba',raw],{windowsHide:true,timeout:120000});const decoded=await readFile(raw);assert.equal(decoded.length,frameWindow.frameCount*192*128*4);report.decoded=await pin(raw);report.decodedComparisons=[];
 for(let i=0;i<frameWindow.frameCount;i++){const difference=compare({a:references[i],b:decoded.subarray(i*192*128*4,(i+1)*192*128*4)});report.decodedComparisons.push(difference);assert(difference.mean<=report.thresholds.decodedMean&&difference.activeMean<=report.thresholds.decodedActiveMean,`Encoded frame ${i} mismatch: ${JSON.stringify(difference)}`);}
 report.ok=true;report.stage='complete';
}catch(error){report.failure={name:error.name,message:error.message.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]'),stack:error.stack?.replace(/https?:\/\/[^\s"'<>]+/g,'[private URL]')};process.exitCode=1;}
finally{
 const cleanup=[];for(const [name,close] of [['browser',()=>browser?.close()],['Host',()=>host?.close()]])try{await close();cleanup.push({name,closed:true});}catch(error){cleanup.push({name,closed:false,message:error.message});report.ok=false;process.exitCode=1;}
 // The esbuild JS API keeps an unref'd service daemon that terminates when
 // this parent exits (its stdio pipes close). It is not a leak: it cannot
 // block Node exit. A detached witness process observes the daemon's actual
 // termination after parent exit and writes a separate receipt that the
 // evidence links to, so the lifecycle claim stays independently checkable.
 const esbuildWitness=processes.filter(item=>!item.closed&&item.executable==='esbuild.exe').map(item=>item.pid);
 if(esbuildWitness.length>0){
  const sidecarPath=join(root,'esbuild-exit-witness.cjs');
  const witnessCode=[
   'const {writeFile}=require("node:fs/promises");',
   'const pids=JSON.parse(process.argv[2]);',
   'const receiptPath=process.argv[3];',
   'const parentPid=Number(process.env.ROCUT_EXPORT_PARENT_PID);',
   'const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};',
   'const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));',
   '(async()=>{',
   ' for(let round=0;round<2400&&(alive(parentPid)||pids.some(alive));round++)await delay(100);',
   ' const exited=pids.map(pid=>({pid,alive:alive(pid)}));',
   ' await writeFile(receiptPath,JSON.stringify({pids,exited,allGone:exited.every(item=>!item.alive),parentPid,finishedAt:new Date().toISOString()},null,2));',
   '})();',
  ].join(String.fromCharCode(10));
  await writeFile(sidecarPath,witnessCode,{flag:'wx'});
  const witness=spawn(process.execPath,[sidecarPath,JSON.stringify(esbuildWitness),join(root,'esbuild-exit-witness.json')],{detached:true,stdio:'ignore',env:{...process.env,ROCUT_EXPORT_PARENT_PID:String(process.pid)},windowsHide:true});
  witness.unref();
  report.esbuildExitWitness={pids:esbuildWitness,receipt:join(root,'esbuild-exit-witness.json'),note:'detached witness observes the unref esbuild service daemon exiting after parent exit'};
 }
 report.cleanup=cleanup;report.processes=processes;report.errors=errors;report.externalRequests=external;
 report.projectAfter=await tree(join(saved,'project'));report.projectUnchanged=JSON.stringify(report.projectBefore)===JSON.stringify(report.projectAfter);
 report.hostSourcesAfter=await Promise.all([...sources.values()].filter(item=>!item.path.startsWith(root)).map(item=>pin(item.path)));report.hostSourcesUnchanged=JSON.stringify([...sources.values()].filter(item=>!item.path.startsWith(root)))===JSON.stringify(report.hostSourcesAfter);
 const unrefEsbuildPids=new Set(esbuildWitness||[]);
 report.childrenAudit={observed:processes.length,unrefEsbuildServiceWitnessed:esbuildWitness?.length??0,blocking:processes.filter(item=>!item.closed&&!unrefEsbuildPids.has(item.pid)).length};
 if(!report.projectUnchanged||!report.hostSourcesUnchanged||processes.some(item=>!item.closed&&!unrefEsbuildPids.has(item.pid))){report.ok=false;process.exitCode=1;}
 await persist();childProcess.spawn=spawn;syncBuiltinESMExports();console.log(JSON.stringify({root,ok:report.ok,stage:report.stage,failure:report.failure?.message,cleanup:report.cleanup,childrenClosed:processes.every(item=>item.closed)}));
}
