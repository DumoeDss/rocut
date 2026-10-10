import {expect,test} from "bun:test";
import {runInNewContext} from "node:vm";
import {REMOTION_PRODUCED_ASSET_BOOTSTRAP} from "../programmatic/remotion-produced-asset-bootstrap";

function fixture(overrides:Record<string,number>={},mediaCount=()=>0) {
  const context={Int16Array,TextEncoder,atob,limits:{maxSourceBytes:32,maxTotalBytes:64,
    maxAssetsPerFrame:4,maxObservationBytes:4096,...overrides},mediaCount,collector:undefined as any};
  runInNewContext(REMOTION_PRODUCED_ASSET_BOOTSTRAP+"collector=createRocutRemotionProducedAssetCollector(limits,mediaCount);",context);
  return context.collector;
}
const inline=(audio=new Int16Array([1,-2,3,-4]))=>({type:"inline-audio",id:"pcm",audio,frame:3,timestamp:999000,duration:41.6666667,toneFrequency:1});
test("empty text and canonical empty binary retain native produced registration",()=>{
  const collector=fixture();
  for(const [index,contentType,content] of [[0,"text",""],[1,"text"," \n\t"],[2,"binary",""]] as const)
    collector.register({type:"artifact",id:String(index),filename:String(index)+".txt",frame:0,contentType,content,downloadBehavior:null});
  expect(collector.snapshot().map((asset:any)=>asset.content)).toEqual([""," \n\t",""]);
  expect(collector.size()).toBe(3);
});
const text=(id="artifact",content="中文😀\n")=>({type:"artifact",id,filename:"sidecars/caption.txt",frame:-2,
  contentType:"text",content,downloadBehavior:null});

test("native produced copies own PCM/text/download facts without URLs or source-clock guessing",()=>{
  const collector=fixture(),asset=inline();collector.register(asset);collector.register(text());
  asset.audio[0]=999;
  const snapshot=collector.snapshot();expect(snapshot[0].audio).toEqual([1,-2,3,-4]);
  expect(snapshot[0].timestamp).toBe(999000);expect(snapshot[0].frame).toBe(3);
  expect(snapshot[1].content).toBe("中文😀\n");expect(snapshot[1].frame).toBe(-2);
  snapshot[0].audio[0]=777;expect(collector.snapshot()[0].audio[0]).toBe(1);
  collector.unregister("pcm");expect(collector.size()).toBe(1);
});
test("native replacement/unregister conserves bounded bytes and shared media count",()=>{
  const collector=fixture({maxSourceBytes:8,maxTotalBytes:8});collector.register(inline());collector.register(inline());
  collector.unregister("pcm");collector.register(text("next","12345678"));expect(collector.size()).toBe(1);
  expect(()=>collector.register(text("more","x"))).toThrow("bytes");
  const shared=fixture({},()=>4);expect(()=>shared.register(inline())).toThrow("count");
});
test("thumbnail remains a request, never fake picture bytes; binary native bytes preserved",()=>{
  const collector=fixture();collector.register({...text(),contentType:"binary",content:"AP+A"});
  collector.register({type:"artifact",id:"thumb",filename:"sidecars/frame.png",frame:3,contentType:"thumbnail",downloadBehavior:{type:"download",fileName:null}});
  const snapshot=collector.snapshot();expect(snapshot[0].content).toBe("AP+A");expect(snapshot[1].content).toBeUndefined();
  expect(snapshot[1].downloadBehavior).toEqual({type:"download",fileName:null});
  expect(()=>fixture().register({...text(),contentType:"thumbnail"})).toThrow("pretend");
});
test("oversized raw/UTF8, unsupported/nonfinite facts, overtransport and disposed owners fail closed",()=>{
  expect(()=>fixture().register(inline(new Int16Array(18)))).toThrow("bytes");
  expect(()=>fixture({maxSourceBytes:4}).register(text())).toThrow("byte");
  expect(()=>fixture().register({...inline(),audio:[Infinity,0]})).toThrow("Nonfinite");
  expect(()=>fixture().register({...inline(),audio:new Float32Array([1,2])})).toThrow("Int16Array");
  expect(()=>fixture().register({type:"audio",src:"https://example.com"})).toThrow("produced");
  expect(()=>fixture({maxObservationBytes:1024}).register(inline())).toThrow("transport");
  const collector=fixture();collector.dispose();expect(()=>collector.register(inline())).toThrow("disposed");
});
