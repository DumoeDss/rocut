import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {build,wasm,topLevelAwait} from '../browser-probe-toolchain.mjs';
import {resolveNativeProbeWasm,assertNativeProbeWasmIdentity} from '../native-probe-wasm-binding.mjs';
import {createNativeProbeWasmPlugin,NATIVE_PRIVATE_WASM_ID} from '../native-probe-wasm-browser.mjs';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),root=await mkdtemp('C:/tmps/ink-object-editor-export-preparation-');
const binding=resolveNativeProbeWasm(),pkg=binding.directory,projectRoot='C:/tmps/ink-object-host-P3xegw/project';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),sources=new Map(),generated=new Map();
const pin=async path=>{const bytes=await readFile(path);const item={path,bytes:bytes.length,sha256:hash(bytes)};const old=sources.get(path);if(old)assert.deepEqual(old,item);sources.set(path,item);return bytes;};
const tree=async path=>{const result=[];for(const entry of await readdir(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())result.push(...await tree(next));else if(entry.isFile()){const bytes=await readFile(next);result.push({path:next,bytes:bytes.length,sha256:hash(bytes)});}else throw Error('Unexpected project/artifact entry');}return result;};
const report={ok:false,root,projectRoot,scope:'CPU-only narrow browser bundle preparation; no browser/GPU/export executed',browserExecuted:false};
try{
 report.wasmBinding={lane:binding.lane,sha256:binding.wasmSha256,source:binding.directory,identity:binding.identity};
 report.projectBefore=await tree(projectRoot);report.pkgBefore=[];
 for(const name of ['opencut_wasm.js','opencut_wasm_bg.js','opencut_wasm_bg.wasm','opencut_wasm.d.ts'])report.pkgBefore.push({path:join(pkg,name),bytes:(await stat(join(pkg,name))).size,sha256:hash(await pin(join(pkg,name)))});
 assert.equal(report.pkgBefore.find(item=>item.path.endsWith('.wasm')).sha256,binding.wasmSha256);
 const input=join(root,'input');await mkdir(input);
 await writeFile(join(input,'index.html'),'<!doctype html><meta charset="utf-8"><title>Private Ink production export</title><script type="module">await import("opencut-wasm");globalThis.__inkExportRun=(await import('+JSON.stringify(join(repo,'script/fixtures/ink-object-editor-export-browser.ts').replaceAll('\\','/'))+')).runInkEditorExport;</script>',{flag:'wx'});
 const classicRequire=createRequire(join(repo,'packages/editor-classic/package.json'));
 const mediabunny=join(dirname(classicRequire.resolve('mediabunny')),'../modules/src/index.js');
 await build({root:input,configFile:false,envDir:root,envPrefix:'LIQUID_EXPORT_PUBLIC_',cacheDir:join(root,'vite-cache'),base:'./',logLevel:'error',
  // Vite's public transform hook uses its required positional (code, id) signature.
  // eslint-disable-next-line opencut/prefer-object-params
  plugins:[createNativeProbeWasmPlugin(binding),wasm(),topLevelAwait(),{name:'ink-export-consumed-byte-pins',async transform(code,id){
   const path=id.split('?')[0];if(path==='/__vite-plugin-wasm-helper')generated.set(id,{id,bytes:Buffer.byteLength(code),sha256:hash(code)});
   else if(isAbsolute(path)&&!path.includes('\0'))await pin(path);else generated.set(id,{id,bytes:Buffer.byteLength(code),sha256:hash(code)});return null;
  }}],resolve:{alias:[{find:/^opencut-wasm$/,replacement:NATIVE_PRIVATE_WASM_ID},{find:/^mediabunny$/,replacement:mediabunny}]},
  build:{outDir:join(root,'editor'),emptyOutDir:false,rollupOptions:{input:join(input,'index.html')}}});
 report.projectAfter=await tree(projectRoot);assert.deepEqual(report.projectAfter,report.projectBefore);
 report.sources=[...sources.values()];report.sourceAfter=await Promise.all(report.sources.map(async item=>{const bytes=await readFile(item.path);return {path:item.path,bytes:bytes.length,sha256:hash(bytes)};}));assert.deepEqual(report.sourceAfter,report.sources);
 report.generated=[...generated.values()];report.outputs=await tree(join(root,'editor'));report.outputBytes=report.outputs.reduce((sum,item)=>sum+item.bytes,0);assert(report.outputBytes<60*1024*1024);
 assertNativeProbeWasmIdentity(binding);
 report.ok=true;report.status='CPU-build-ready-awaiting-GPU-slot';
}catch(error){report.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({root,ok:report.ok,status:report.status,outputBytes:report.outputBytes,failure:report.failure?.message}));}

