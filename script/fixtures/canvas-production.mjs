import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {mkdtemp,mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
const repo=fileURLToPath(new URL("../..",import.meta.url)),root=await mkdtemp("C:/tmps/rocut-canvas-production-");
const surface="C:/tmps/rocut-private-surface-consumption-5SB2xx/surface",runtime="C:/tmps/rocut-private-runtime-consumption-zy1KSH/runtime",pkg="C:/tmps/rocut-svg-wasm-DHuXQ7/pkg";
const report={ok:false,root,surface,runtime,pkg,scope:"actual packed Host apply/save/reopen + production renderer/compositor/SceneExporter; standalone owned browser fixture, not full editor UI",errors:[],cleanup:[]};
const project=join(root,"project"),registry=join(root,"registry");await mkdir(project);await mkdir(registry);
const require=createRequire(join(repo,"apps/vite-example/package.json")),{chromium}=require("@playwright/test");
let host,browser,server;const closeHost=async()=>{if(host&&host.exitCode===null){const closed=new Promise(accept=>host.once("exit",accept));host.kill("SIGTERM");await closed;}};
async function openHost(){
 host=spawn(process.execPath,[join(runtime,"rocut.mjs"),"host","start",project,"--port","0","--targets-root",registry],{cwd:root,env:{...process.env,ROCUT_HTML_BROWSER_PATH:"",ROCUT_ENGINE_TOOLCHAIN_DIR:"",ELFTIA_HTML_FRAME_CONNECTION_FILE:join(root,"private-frame-connection.json")},windowsHide:true,stdio:["ignore","pipe","pipe"]});
 let output="",errors="";host.stderr.on("data",chunk=>errors=(errors+chunk).slice(-1000));
 const target=await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(Error("Host startup timeout")),15000);host.once("exit",code=>{clearTimeout(timer);reject(Error(`Host exit ${code} ${errors}`));});host.stdout.on("data",chunk=>{output=(output+chunk).slice(-10000);const match=output.match(/^target (\S+)$/m);if(match&&/^pid \d+$/m.test(output)){clearTimeout(timer);accept(match[1]);}});});
 const secret=JSON.parse(await readFile(join(registry,"targets",`${target}.json`),"utf8"));return `http://127.0.0.1:${secret.port}/${secret.token}/`;
}
async function request(base,route,body){const response=await fetch(new URL(`api/${route}`,base),{signal:AbortSignal.timeout(20000),...(body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
try {
 const bun=spawn("bun",["build",join(repo,"script/fixtures/canvas-production-browser.ts"),"--target","browser","--outfile",join(root,"browser.js"),"--external","opencut-wasm"],{cwd:repo,windowsHide:true,stdio:["ignore","pipe","pipe"]});let buildErrors="";bun.stderr.on("data",chunk=>buildErrors+=chunk);assert.equal(await new Promise(accept=>bun.once("exit",accept)),0,buildErrors);
 let base=await openHost();const catalog=await request(base,"editing/catalog"),context=await request(base,"context");
 const defaults=Object.fromEntries(catalog.effects.canvas.filter(field=>field.required!==false).map(field=>[field.key,field.default]));
 const paint={...defaults,columns:16,rows:16,seed:17,weaveHeight:0.015,relief:3,lightX:0.4,lightY:0.2,strokeCount:1,stroke0StartTicks:0,stroke0EndTicks:80000,stroke0FromX:0.12,stroke0FromY:0.25,stroke0ToX:0.88,stroke0ToY:0.75,stroke0Radius:0.13,stroke0Bristles:6,stroke0Opacity:0.85,stroke0Wetness:0.7,stroke0Thickness:0.06};
 const graphic={...Object.fromEntries(catalog.graphics.rectangle.map(field=>[field.key,field.default])),fill:"#ed3822"};
 const effects=[{id:"gray-prefix",type:"color-adjustment",enabled:true,params:{exposure:0,contrast:0,saturation:-100,temperature:0,tint:0}},{id:"paint",type:"canvas",enabled:true,params:paint}];
 const applied=await request(base,"apply",{expectedRevision:context.revision,operations:[{kind:"update-project",projectId:context.project.id,patch:{name:"Canvas production stroke",canvasWidth:192,canvasHeight:128,frameRate:{numerator:30,denominator:1}}},{kind:"create-track",track:{id:"paint",kind:"graphic",name:"Paint",hidden:false}},{kind:"create-clip",clip:{id:"paint-clip",trackId:"paint",startTime:0,duration:120000,trimStart:0,trimEnd:0,editing:{type:"graphic",name:"Ordered Canvas",definitionId:"rectangle",params:graphic,effects}}}]});assert(applied.accepted);
 const before=await request(base,"clips"),disk=await readFile(join(project,"project.json"));await closeHost();base=await openHost();assert.deepEqual(await request(base,"clips"),before);assert.deepEqual(await readFile(join(project,"project.json")),disk);report.hostSaveReopen=true;
 const metadata=JSON.parse(await readFile(join(surface,"surface-wasm-package.json"),"utf8")),core=await readFile(join(surface,metadata.coreWasm.path));report.wasmSha256=createHash("sha256").update(core).digest("hex");assert.equal(report.wasmSha256,"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363");
 const html='<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"opencut-wasm":"/wasm-glue.mjs"}}</script><script type="module">import * as wasm from "/wasm-glue.mjs";const bytes=await(await fetch("/wasm.wasm")).arrayBuffer();const compiled=await WebAssembly.compile(bytes);const imports=Object.fromEntries(WebAssembly.Module.imports(compiled).map(({module})=>[module,wasm]));const instance=await WebAssembly.instantiate(compiled,imports);wasm.__wbg_set_wasm(instance.exports);instance.exports.__wbindgen_start();globalThis.__run=(await import("/browser.js")).runCanvasProduction;</script>';
 server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,"http://private.invalid").pathname;let bytes,type="text/javascript";if(pathname==="/"){bytes=Buffer.from(html);type="text/html";}else if(pathname==="/wasm.wasm"){bytes=core;type="application/wasm";}else if(pathname==="/wasm-glue.mjs")bytes=await readFile(join(pkg,"opencut_wasm_bg.js"));else if(pathname==="/browser.js")bytes=await readFile(join(root,"browser.js"));else{res.writeHead(404);res.end();return;}res.writeHead(200,{"content-type":type});res.end(bytes);}catch{res.writeHead(500);res.end();}});await new Promise(accept=>server.listen(0,"127.0.0.1",accept));
 browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-proxy-server","--disable-webgpu","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 const page=await browser.newPage();await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,"gpu",{get:()=>undefined}));const origin=`http://127.0.0.1:${server.address().port}`;
 page.on("pageerror",error=>report.errors.push(String(error)));await page.route("**/*",async route=>{if(new URL(route.request().url()).origin===origin)await route.continue();else{report.errors.push("External request blocked");await route.abort();}});
 await page.goto(origin,{waitUntil:"load"});await page.waitForFunction(()=>typeof globalThis.__run==="function",undefined,{timeout:30000});
 const result=await page.evaluate(saved=>globalThis.__run(saved),JSON.parse(disk.toString("utf8")));report.production=result;
 if(result.video){await writeFile(join(root,"production.webm"),Buffer.from(result.video),{flag:"wx"});delete result.video;}
 if(result.frames){for(const [name,bytes]of Object.entries(result.frames))await writeFile(join(root,`${name}.rgba`),Buffer.from(bytes),{flag:"wx"});delete result.frames;}
 assert(result.ok,result.failure);assert.equal(report.errors.length,0);report.ok=true;
}catch(error){report.failure=error.stack??String(error);process.exitCode=1;}
finally{for(const [name,close]of [["browser",()=>browser?.close()],["server",()=>server?new Promise((accept,reject)=>server.close(error=>error?reject(error):accept())):undefined],["Host",closeHost]])try{await close();report.cleanup.push({name,closed:true});}catch(error){report.cleanup.push({name,closed:false,error:String(error)});report.ok=false;process.exitCode=1;}await writeFile(join(root,"receipt.json"),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({root,ok:report.ok,failure:report.failure}));}
