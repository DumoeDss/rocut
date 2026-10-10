import {expect,test} from "bun:test";
import {mkdtemp,rm,readFile,readdir,realpath,symlink,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {writeRemotionArtifactOutputs} from "../programmatic/remotion-artifact-output";
import {prepareRemotionInlineSource,type RemotionInlineSource} from "../programmatic/remotion-inline-prepare";
import {attachRemotionProducedCaptureBroker} from "../programmatic/remotion-produced-capture-broker";
import {runInNewContext} from "node:vm";
import {REMOTION_PRODUCED_THUMBNAIL_CAPTURE} from "../programmatic/remotion-produced-thumbnail-capture";
const signal=()=>new AbortController().signal;
const body=Buffer.from("native output"),sha256=createHash("sha256").update(body).digest("hex");
const artifact=(filename="captions/note.txt")=>({filename,body,sha256,collectionFrame:2,nativeLocalFrame:-1,downloadBehavior:null});
test("fulfilled artifacts land in an exclusive owned sidecar destination",async()=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,"rocut-artifact-test-")),project=await realpath(root);
  try {
    const first=await writeRemotionArtifactOutputs({projectDir:project,artifacts:[artifact()],signal:signal()});
    const second=await writeRemotionArtifactOutputs({projectDir:project,artifacts:[artifact()],signal:signal()});
    expect(first!.directory).not.toBe(second!.directory);expect(first!.artifacts[0].nativeLocalFrame).toBe(-1);
    expect(await readFile(join(project,first!.artifacts[0].path))).toEqual(body);
  } finally {if(dirname(resolve(root))!==parent)throw Error("Unsafe test cleanup");await rm(root,{recursive:true,force:true});}
});
test("traversal and conflicting logical paths fail and clean only the owned run",async()=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,"rocut-artifact-test-")),project=await realpath(root);
  try {
    await expect(writeRemotionArtifactOutputs({projectDir:project,artifacts:[artifact("../escape")],signal:signal()})).rejects.toThrow("Unsafe");
    await expect(writeRemotionArtifactOutputs({projectDir:project,artifacts:[artifact("A.txt"),artifact("a.txt")],signal:signal()})).rejects.toThrow("Conflicting");
    expect(await readdir(join(project,"exports","programmatic"))).toEqual([]);
  } finally {if(dirname(resolve(root))!==parent)throw Error("Unsafe test cleanup");await rm(root,{recursive:true,force:true});}
});
test("zero-byte native output is persisted and returned in output metadata",async()=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,"rocut-artifact-test-")),project=await realpath(root);
  try {
    const output=await writeRemotionArtifactOutputs({projectDir:project,artifacts:[{...artifact(),body:Buffer.alloc(0),
      sha256:createHash("sha256").update(Buffer.alloc(0)).digest("hex")}],signal:signal()});
    expect(output!.artifacts).toHaveLength(1);expect(output!.artifacts[0].byteLength).toBe(0);
    expect((await readFile(join(project,output!.artifacts[0].path))).length).toBe(0);
  } finally {if(dirname(resolve(root))!==parent)throw Error("Unsafe test cleanup");await rm(root,{recursive:true,force:true});}
});
test("redirected exports parent fails without writing through the junction",async()=>{
  const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,"rocut-artifact-test-")),project=await realpath(root);
  try {
    const outside=join(project,"outside");await mkdir(outside);await symlink(outside,join(project,"exports"),"junction");
    await expect(writeRemotionArtifactOutputs({projectDir:project,artifacts:[artifact()],signal:signal()})).rejects.toThrow("escaped");
    expect(await readdir(outside)).toEqual([]);
  } finally {if(dirname(resolve(root))!==parent)throw Error("Unsafe test cleanup");await rm(root,{recursive:true,force:true});}
});
const source:RemotionInlineSource={kind:"native-generated-inline-pcm",id:"native",byteLength:48,nativeFrames:1,sampleRate:48000,channels:2,
  toneFrequency:1,toneFilter:null,maxToneBytes:128,maxDecodedBytes:128,gainApplied:true};
function wav(){const bytes=Buffer.alloc(48);bytes.write("RIFF");bytes.write("WAVE",8);bytes.writeInt16LE(123,44);return bytes;}
test("unit native inline keeps original s16 without media process",async()=>{
  const result=await prepareRemotionInlineSource({source,wav:wav(),sampleRate:48000,decoder:{ffmpeg:"unused",ffprobe:"unused"},signal:signal(),run:async()=>{throw Error("must not run");}});
  expect(result.format).toBe("s16le");expect(result.body.readInt16LE()).toBe(123);
});
test("native tone s16 quantization precedes graph-rate f32 conversion",async()=>{
  const calls:string[][]=[];
  const result=await prepareRemotionInlineSource({source:{...source,toneFrequency:1.1,toneFilter:"asetrate=48000*1.1,aresample=48000,atempo=1/1.1"},
    wav:wav(),sampleRate:44100,decoder:{ffmpeg:resolve("fake-ffmpeg"),ffprobe:resolve("fake-ffprobe")},signal:signal(),run:async options=>{
      calls.push([...options.args]);return Buffer.alloc(calls.length===1?4:8);
    }});
  expect(result.format).toBe("f32le");expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("asetrate=48000*1.1,aresample=48000,atempo=1/1.1");
  expect(calls[0]).toContain("pcm_s16le");expect(calls[1]).toContain("pcm_f32le");expect(calls[1]).toContain("44100");
});
test("produced capture receipts follow screenshot fulfillment and preserve exact frame bytes",async()=>{
  let listener:any;const replies:any[]=[];
  const png=Buffer.from([137,80,78,71,13,10,26,10,1]);
  const browser={onEvent:(fn:any)=>{listener=fn;return ()=>{};},send:async(method:string,params:any)=>{
    if(method==="Page.captureScreenshot")return {data:png.toString("base64")};if(method==="Runtime.evaluate")replies.push(params.expression);return {};
  }};
  const broker=await attachRemotionProducedCaptureBroker({browser:browser as any,session:"session",durationFrames:3,limits:{maxSourceBytes:32,maxTotalBytes:64},signal:signal()});
  listener({sessionId:"session",method:"Runtime.bindingCalled",params:{name:"__rocutProducedCaptureRequest",executionContextId:1,
    payload:JSON.stringify({version:1,kind:"remotion-produced-thumbnail",requestId:1,frameIndex:2})}});
  await broker.check();expect(broker.take().get(2)).toEqual(png);expect(replies[0]).toContain('"ok":true');await broker.dispose();
});
test("late aborted thumbnail screenshot cannot publish output",async()=>{
  let listener:any,finish:(value:any)=>void=()=>{};const controller=new AbortController();
  const browser={onEvent:(fn:any)=>{listener=fn;return ()=>{};},send:async(method:string)=>method==="Page.captureScreenshot"
    ?await new Promise<any>(resolve=>{finish=resolve;}):{}};
  const broker=await attachRemotionProducedCaptureBroker({browser:browser as any,session:"session",durationFrames:3,limits:{maxSourceBytes:32,maxTotalBytes:64},signal:controller.signal});
  listener({sessionId:"session",method:"Runtime.bindingCalled",params:{name:"__rocutProducedCaptureRequest",executionContextId:1,
    payload:JSON.stringify({version:1,kind:"remotion-produced-thumbnail",requestId:1,frameIndex:2})}});
  controller.abort();finish({data:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")});
  await expect(broker.check()).rejects.toThrow();expect(()=>broker.take()).toThrow();await broker.dispose();
});
test("actual browser helper payload and receipt fulfill the Host capture broker",async()=>{
  let listener:any,receive:any;const png=Buffer.from([137,80,78,71,13,10,26,10,2]);
  const window:any={};const parent={postMessage:(message:any)=>listener({sessionId:"session",method:"Runtime.bindingCalled",
    params:{name:"__rocutProducedCaptureRequest",executionContextId:1,payload:message.payload}})};
  window.__rocutProducedCaptureReply=(reply:any)=>receive({source:parent,data:{tag:"rocut-produced-capture-reply",reply}});
  const context={window,parent,checkHtmlMedia(){},document:{images:[],fonts:{ready:Promise.resolve()},getAnimations:()=>[]},failures:[],
    requestAnimationFrame:(fn:any)=>queueMicrotask(fn),setTimeout,clearTimeout,addEventListener:(_name:string,fn:any)=>{receive=fn;},removeEventListener(){}};
  runInNewContext(REMOTION_PRODUCED_THUMBNAIL_CAPTURE,context);
  const browser={onEvent:(fn:any)=>{listener=fn;return ()=>{};},send:async(method:string,params:any)=>{
    if(method==="Page.captureScreenshot")return {data:png.toString("base64")};
    if(method==="Runtime.evaluate")runInNewContext(params.expression,context);return {};
  }};
  const broker=await attachRemotionProducedCaptureBroker({browser:browser as any,session:"session",durationFrames:3,limits:{maxSourceBytes:32,maxTotalBytes:64},signal:signal()});
  await window.rocutRemotionProducedCapture({index:2});await broker.check();expect(broker.take().get(2)).toEqual(png);await broker.dispose();
});
test("dispose drains an outstanding screenshot without waiting for its protocol reply",async()=>{
  let listener:any,finish:(value:any)=>void=()=>{};let replies=0;
  const browser={onEvent:(fn:any)=>{listener=fn;return ()=>{};},send:async(method:string)=>{
    if(method==="Page.captureScreenshot")return await new Promise<any>(resolve=>{finish=resolve;});
    if(method==="Runtime.evaluate")replies++;return {};
  }};
  const broker=await attachRemotionProducedCaptureBroker({browser:browser as any,session:"session",durationFrames:3,limits:{maxSourceBytes:32,maxTotalBytes:64},signal:signal()});
  listener({sessionId:"session",method:"Runtime.bindingCalled",params:{name:"__rocutProducedCaptureRequest",executionContextId:1,
    payload:JSON.stringify({version:1,kind:"remotion-produced-thumbnail",requestId:1,frameIndex:2})}});
  await broker.dispose();expect(()=>broker.take()).toThrow("disposed");
  finish({data:Buffer.from([137,80,78,71,13,10,26,10]).toString("base64")});await Promise.resolve();expect(replies).toBe(0);
});
