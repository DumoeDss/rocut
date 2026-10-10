import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {createRemotionArtifactSink,type RemotionAdmittedArtifact} from "../programmatic/remotion-artifact-sink";
const limits={maxSourceBytes:32,maxTotalBytes:64,maxSources:4};
test("empty and whitespace native artifacts are owned outputs, not missing results",async()=>{
  for(const [kind,content] of [["text",""],["text"," \n\t"],["binary",""]] as const) {
    const sink=createRemotionArtifactSink({limits,signal:new AbortController().signal});
    const input=artifact(content);input.contentType=kind;input.body!.encoding=kind==="binary"?"base64":"utf8";
    await sink.accept(input);await sink.accept(input);const outputs=sink.take();
    expect(outputs).toHaveLength(1);expect(outputs[0].body).toEqual(Buffer.from(content));expect(outputs[0].sha256).toBe(input.sha256!);
  }
});
const artifact=(content="中文😀\n"):RemotionAdmittedArtifact=>({id:"native",filename:"sidecars/caption.txt",nativeLocalFrame:-2,
  collectionFrame:3,contentType:"text",downloadBehavior:null,body:{encoding:"utf8",data:content},
  byteLength:Buffer.byteLength(content),sha256:createHash("sha256").update(content).digest("hex"),
  requiresCapture:null,outputStatus:"requires-owned-host-artifact-sink"});
test("owned artifacts retain actual admitted bytes and filename conflicts cannot silently overwrite",async()=>{
  const sink=createRemotionArtifactSink({limits,signal:new AbortController().signal});
  await sink.accept(artifact());await sink.accept(artifact());
  await expect(sink.accept(artifact("changed"))).rejects.toThrow("Conflicting");
  const out=sink.take();expect(out.length).toBe(1);expect(out[0].body.toString("utf8")).toBe("中文😀\n");
  expect(out[0].nativeLocalFrame).toBe(-2);expect(sink.take()).toEqual([]);
});
test("thumbnail is not successful without real captured PNG bytes",async()=>{
  const input={...artifact(),filename:"frame.png",contentType:"thumbnail" as const,body:null,byteLength:0,sha256:null,requiresCapture:"exact-frame-png" as const};
  await expect(createRemotionArtifactSink({limits,signal:new AbortController().signal}).accept(input)).rejects.toThrow("exact-frame");
  const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
  const sink=createRemotionArtifactSink({limits,signal:new AbortController().signal,captureFramePng:async frame=>{expect(frame).toBe(3);return png;}});
  await sink.accept(input);expect(sink.take()[0].body).toEqual(png);
});
test("mutated bytes, nonPNG capture and late aborted capture cannot publish",async()=>{
  const input={...artifact(),body:{encoding:"utf8" as const,data:"mutated"}};
  await expect(createRemotionArtifactSink({limits,signal:new AbortController().signal}).accept(input)).rejects.toThrow("changed");
  const thumb={...artifact(),body:null,byteLength:0,sha256:null,requiresCapture:"exact-frame-png" as const};
  await expect(createRemotionArtifactSink({limits,signal:new AbortController().signal,captureFramePng:async()=>Buffer.from("fake")}).accept(thumb)).rejects.toThrow("PNG");
  const controller=new AbortController();let release!:(body:Buffer)=>void;
  const sink=createRemotionArtifactSink({limits,signal:controller.signal,captureFramePng:()=>new Promise(resolve=>{release=resolve;})});
  const pending=sink.accept(thumb);controller.abort();release(Buffer.from([137,80,78,71,13,10,26,10]));
  await expect(pending).rejects.toThrow();expect(()=>sink.take()).toThrow();
});
