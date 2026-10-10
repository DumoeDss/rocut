import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {join,resolve,win32} from "node:path";
import {chromium} from "./browser-probe-toolchain.mjs";

const [directory]=process.argv.slice(2);assert(directory&&process.argv.length===3);
assert(/^glass-object-gpu-[^\\/]+$/.test(win32.relative("C:/tmps",resolve(directory))));
const root=await mkdtemp("C:/tmps/glass-object-gpu-run-");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const preparationBytes=await readFile(join(directory,"preparation.json")),preparation=JSON.parse(preparationBytes);
assert(preparation.ok&&preparation.gpuExecuted===false);
const expected=[...preparation.outputFiles,...preparation.packageBefore,preparation.scene,preparation.toolchainManifest,...preparation.buildInputs.files];
const verify=async()=>{assert((await readFile(join(directory,"preparation.json"))).equals(preparationBytes));for(const file of expected){const bytes=await readFile(file.path);assert.equal(sha(bytes),file.sha256,"Frozen input drift");assert.equal(bytes.length,file.bytes);}};
await verify();const bodies=new Map();for(const file of preparation.outputFiles)bodies.set('/'+win32.basename(file.path),await readFile(file.path));
const report={ok:false,root,preparation:{path:join(directory,"preparation.json"),sha256:sha(preparationBytes)},gpuExecuted:false,browserOwned:true,browserClosed:false,serverClosed:false,consoleErrors:[],pageErrors:[],externalRequests:[],diagnosticFixtureBoundary:"Curved GLB/detailed diagnostic PNGs; not original tiny Host project GPU acceptance or user full visual support"};
const server=createServer(async(request,response)=>{
 try {
  const path=new URL(request.url,"http://127.0.0.1").pathname;
  if(path==="/favicon.ico"){response.writeHead(204);response.end();return;}
  if(request.method==="POST"&&path==="/receipt"){
   const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>3000000){response.writeHead(413);response.end();return;}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks),result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
   await writeFile(join(root,"gpu-result.json"),JSON.stringify({result,preparationSha256:sha(preparationBytes)},null,2),{flag:"wx"});response.writeHead(200,{"content-type":"application/json"});response.end('{"retained":true}');return;
  }
  const name=path==="/"?"/index.html":path,body=bodies.get(name);if(!body){response.writeHead(404);response.end();return;}
  response.writeHead(200,{"content-type":name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':name.endsWith('.png')?'image/png':'application/octet-stream',"cache-control":"no-store"});response.end(body);
 }catch(error){report.serverError=error.message;response.writeHead(500);response.end();}
});
await new Promise(accept=>server.listen(0,"127.0.0.1",accept));
let browser;
try {
 browser=await chromium.launch({headless:true,args:["--no-proxy-server","--use-angle=swiftshader","--enable-unsafe-swiftshader","--disable-webgpu"]});report.browserVersion=browser.version();report.gpuExecuted=true;
 const page=await browser.newPage();
 await page.route("**/*",route=>{const url=new URL(route.request().url());if(url.hostname!=="127.0.0.1"){report.externalRequests.push(url.origin);return route.abort();}return route.continue();});
 page.on("pageerror",error=>report.pageErrors.push(error.message));page.on("console",message=>{if(message.type()==="error")report.consoleErrors.push(message.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:"domcontentloaded",timeout:30000});
 await page.waitForFunction(()=>Reflect.get(globalThis,"__glassGpuResult"),null,{timeout:60000});
 const result=await page.evaluate(()=>Reflect.get(globalThis,"__glassGpuResult"));
 report.result={...result,captures:result.captures?.map(({pngBase64,...capture})=>capture)};
 if(result.captures)for(const capture of result.captures)await writeFile(join(root,`${capture.name}.png`),Buffer.from(capture.pngBase64,"base64"),{flag:"wx"});
 assert(result.ok,result.error??"GPU optical gates failed");assert.equal(report.pageErrors.length,0);assert.equal(report.externalRequests.length,0);assert.equal(report.consoleErrors.length,0);
 await verify();report.inputsUnchanged=true;report.ok=true;
}catch(error){report.failure={name:error.name,message:error.message};process.exitCode=1;}
finally {
 if(browser){await browser.close();report.browserClosed=true;}
 await new Promise(accept=>server.close(accept));report.serverClosed=true;
 try{await verify();report.inputsUnchanged=true;}catch(error){report.pinFailure=error.message;report.ok=false;process.exitCode=1;}
 await writeFile(join(root,"gpu-run.json"),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({root,ok:report.ok,browserClosed:report.browserClosed,serverClosed:report.serverClosed,failure:report.failure}));
}
