import assert from "node:assert/strict";
import {isDeepStrictEqual} from "node:util";
import {spawn} from "node:child_process";
import {mkdtemp,mkdir,cp,readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {blazeEditorRequest,blazeEditorPoll as poll} from "./blaze-editor-control.mjs";
const repo=fileURLToPath(new URL("../..",import.meta.url)),runtime="C:/tmps/rocut-private-runtime-consumption-zy1KSH/runtime",surface="C:/tmps/rocut-private-surface-consumption-5SB2xx/surface";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const fields=["StartTicks","EndTicks","FromX","FromY","ToX","ToY","Radius","Bristles","Opacity","Wetness","Thickness"];
async function hostAt(root){
 const child=spawn(process.execPath,[join(runtime,"rocut.mjs"),"host","start",join(root,"project"),"--static",surface,"--port","0","--targets-root",join(root,"registry")],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,ROCUT_HTML_BROWSER_PATH:"",ROCUT_ENGINE_TOOLCHAIN_DIR:"",ELFTIA_HTML_FRAME_CONNECTION_FILE:join(root,"frame-connection.json")}});
 const exited=new Promise(accept=>child.once("exit",accept));let output="",errors="";child.stderr.on("data",chunk=>errors=(errors+chunk).slice(-1500));
 const editorUrl=await new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(Error("Canvas Host startup timeout")),30000);child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("exit",code=>{clearTimeout(timer);reject(Error(`Canvas Host exited ${code}: ${errors}`));});child.stdout.on("data",chunk=>{output+=chunk;const match=output.match(/editorUrl (\S+)/);if(match){clearTimeout(timer);accept(match[1]);}});});
 return {editorUrl,request:blazeEditorRequest(editorUrl),async close(){child.kill();await exited;}};
}
const clip=async request=>(await request("clips")).find(item=>item.id==="paint-clip");
const params=item=>item.editing.effects.find(effect=>effect.type==="canvas").params;
if(process.argv.includes("--prepare")){
 const root=await mkdtemp("C:/tmps/rocut-canvas-authoring-");await mkdir(join(root,"registry"));await cp("C:/tmps/rocut-canvas-production-KUuxxh/project",join(root,"project"),{recursive:true,errorOnExist:true,force:false});
 const host=await hostAt(root);try{const value=await clip(host.request),editing=structuredClone(value.editing),paint=editing.effects.find(effect=>effect.type==="canvas");paint.params=Object.fromEntries(Object.entries({...paint.params,strokeCount:0}).filter(([key])=>!/^stroke\d+/.test(key)));const context=await host.request("context");const response=await host.request("apply",{expectedRevision:context.revision,operations:[{kind:"update-clip",clipId:value.id,patch:{editing}}]});assert(response.accepted);await writeFile(join(root,"prepared.json"),JSON.stringify({runtime,surface,clip:await clip(host.request)},null,2),{flag:"wx"});console.log(JSON.stringify({root,prepared:true}));}finally{await host.close();}
}else{
 const root=resolve(process.argv[2]);assert(root.toLowerCase().startsWith("c:\\tmps\\rocut-canvas-authoring-"));
 const report={ok:false,root,runtime,surface,errors:[],applyWrites:[],checks:[],cleanup:[],scope:"actual 352-file mounted editor CanvasStrokeFields; control commit -> production ProjectStore PUT record/history/reload/reopen; seed uses Host apply; no separate Apply button or export/GPU optical oracle"};
 const require=createRequire(join(repo,"apps/vite-example/package.json")),{chromium}=require("@playwright/test");let host,browser,page;
 const file=join(root,"project/project.json"),saved=async()=>readFile(file);
 const select=async()=>{await page.locator('[data-testid="timeline-clip"][data-element-id="paint-clip"]').click();await page.getByRole("button",{name:"Effects",exact:true}).last().click();await page.getByTestId("effect-canvas-trajectories").waitFor();};
 const open=async()=>{host=await hostAt(root);page=await browser.newPage({viewport:{width:1600,height:1000}});const origin=new URL(host.editorUrl).origin;page.on("pageerror",error=>report.errors.push(String(error).replace(/https?:\/\/[^\s]+/g,"[private URL]")));page.on("request",request=>{if(request.method()==="PUT"&&new URL(request.url()).pathname.endsWith("/record"))report.applyWrites.push({mechanism:"production ProjectStore PUT record",bytes:Buffer.byteLength(request.postData()??""),sha256:hash(request.postData()??"")});});await page.route("**/*",async route=>{const url=new URL(route.request().url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin){report.errors.push("external request");await route.abort();}else await route.continue();});await page.goto(host.editorUrl,{waitUntil:"commit"});await page.locator('[data-testid="timeline-clip"][data-element-id="paint-clip"]').waitFor({timeout:90000});await poll(async()=>(await host.request("export")).surfaces===1,90000);};
 const set=async(key,value)=>{const input=page.getByTestId(`effect-canvas-input-${key}`);await input.fill(String(value));await input.press("Enter");await poll(async()=>params(await clip(host.request))[key]===value);};
 const history=async(before,after,label)=>{await page.getByRole("heading",{name:"Trajectories",exact:true}).click();await page.keyboard.press("Control+z");await poll(async()=>isDeepStrictEqual(await clip(host.request),before));await page.keyboard.press("Control+Shift+z");await poll(async()=>isDeepStrictEqual(await clip(host.request),after));report.checks.push({name:label,completeClipUndoRedo:true});};
 try{
  browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--no-proxy-server","--disable-webgpu","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});await open();await select();
  const before=await clip(host.request);assert.equal(params(before).strokeCount,0);const writesBefore=report.applyWrites.length;
  await page.getByTestId("effect-canvas-add").click();await poll(async()=>params(await clip(host.request)).strokeCount===1);const added=await clip(host.request);for(const field of fields)assert.equal(typeof params(added)[`stroke0${field}`],"number");assert(params(added).stroke0StartTicks<params(added).stroke0EndTicks);await history(before,added,"add complete trajectory");
  await set("relief",4);const scalar=await clip(host.request);await history(added,scalar,"scalar edit");
  await set("stroke0FromX",.2);const edited=await clip(host.request);await history(scalar,edited,"trajectory field edit");assert(report.applyWrites.length>writesBefore,"actual UI Apply writes missing");
  await poll(async()=>JSON.stringify(JSON.parse((await saved()).toString("utf8"))).includes('"stroke0FromX":0.2'));const finalBytes=await saved();report.finalSavedSha256=hash(finalBytes);await page.screenshot({path:join(root,"canvas-authoring.png")});
  await page.reload({waitUntil:"commit"});await page.locator('[data-testid="timeline-clip"][data-element-id="paint-clip"]').waitFor({timeout:90000});await poll(async()=>(await host.request("export")).surfaces===1);assert.deepEqual(await clip(host.request),edited);assert.deepEqual(await saved(),finalBytes);await select();assert.equal(Number(await page.getByTestId("effect-canvas-input-stroke0FromX").inputValue()),.2);
  await page.close();await host.close();host=undefined;await open();assert.deepEqual(await clip(host.request),edited);assert.deepEqual(await saved(),finalBytes);await select();assert.equal(Number(await page.getByTestId("effect-canvas-input-relief").inputValue()),4);assert.equal(Number(await page.getByTestId("effect-canvas-input-stroke0FromX").inputValue()),.2);assert.deepEqual(report.errors,[]);report.checks.push({name:"reload and Host reopen",completeClipRetained:true,savedBytesIdentical:true});report.params=params(edited);report.ok=true;
 }catch(error){report.failure=(error.stack??String(error)).replace(/https?:\/\/[^\s]+/g,"[private URL]");process.exitCode=1;try{await page?.screenshot({path:join(root,`failure-${Date.now()}.png`)});}catch{}}
 finally{for(const [name,close]of [["browser",()=>browser?.close()],["Host",()=>host?.close()]])try{await close();report.cleanup.push({name,closed:true});}catch(error){report.cleanup.push({name,closed:false,error:String(error)});report.ok=false;process.exitCode=1;}await writeFile(join(root,`ui-receipt-${Date.now()}.json`),JSON.stringify(report,null,2),{flag:"wx"});console.log(JSON.stringify({root,ok:report.ok,failure:report.failure?.split("\n")[0]}));}
}
