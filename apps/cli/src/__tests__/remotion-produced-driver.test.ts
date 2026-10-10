import {expect,test} from "bun:test";
import {metadataDriverFixture} from "./remotion-metadata-driver-fixture";
import {runInNewContext} from "node:vm";
import {REMOTION_AUDIO_BOOTSTRAP} from "../programmatic/remotion-audio-bootstrap";
test("continuous native produced driver preserves root and awaits exact-frame captures",async()=>{
  const fixture=metadataDriverFixture(),captures:number[]=[];let current=0;
  fixture.window.rocutRemotionAudio={enabled:true,analysisOnly:true,maxProducedObservationBytes:32000,
    snapshot:()=>[],producedSnapshot:()=>[{type:"artifact",id:"same-native-id",contentType:"thumbnail",frame:current}],unregister(){},register(){}};
  fixture.window.rocutRemotionProducedCapture=async(frame:{index:number})=>{await Promise.resolve();current=frame.index;captures.push(frame.index);};
  const frames=Array.from({length:10},(_,index)=>({index,seed:42,durationFrames:10,frameRate:fixture.spec.frameRate}));
  const scan={profile:"remotion-4.0.440-native-produced-frames-v1",canonicalStartFrame:0,canonicalEndFrameExclusive:10,nativeSampleRate:48000,frames};
  const result=await (fixture.window.__rocutRenderRemotionProducedFrames as any)(scan);
  expect(result.frames.map((item:any)=>item.frameIndex)).toEqual([0,1,2,3,4,5,6,7,8,9]);
  expect(captures).toEqual([0,1,2,3,4,5,6,7,8,9]);expect(fixture.state.releases).toBe(1);
  expect(fixture.state.unmounts).toBe(0);expect(fixture.state.selections).toBe(1);
  expect(fixture.state.calls).toHaveLength(1);
});
test("continuous produced driver rejects incomplete source history before output",async()=>{
  const fixture=metadataDriverFixture();fixture.window.rocutRemotionAudio={producedSnapshot:()=>[]};
  await expect((fixture.window.__rocutRenderRemotionProducedFrames as any)({profile:"remotion-4.0.440-native-produced-frames-v1",
    canonicalStartFrame:0,canonicalEndFrameExclusive:10,frames:[{index:0}]})).rejects.toThrow("full Rust canonical");
  expect(fixture.state.releases).toBe(0);
});
test("ordinary pictures tolerate native Artifact without claiming produced outputs",()=>{
  for(const audioAnalysis of [null,{mode:"picture",sources:[],limits:{maxAssetsPerFrame:2}}]) {
    const window:any={};runInNewContext(REMOTION_AUDIO_BOOTSTRAP,{window,audioAnalysis});
    expect(()=>window.rocutRemotionAudio.register({type:"artifact",id:"native",contentType:"thumbnail"})).not.toThrow();
    expect(window.rocutRemotionAudio.producedEnabled).toBe(false);
    expect(()=>window.rocutRemotionAudio.producedSnapshot()).toThrow("not requested");
  }
});
test("picture inline registration still requires native soundtrack integration",()=>{
  const window:any={};runInNewContext(REMOTION_AUDIO_BOOTSTRAP,{window,audioAnalysis:null});
  expect(()=>window.rocutRemotionAudio.register({type:"inline-audio"})).toThrow("mixing integration");
  const handled:any={};runInNewContext(REMOTION_AUDIO_BOOTSTRAP,{window:handled,audioAnalysis:{mode:"picture",sources:[],limits:{maxAssetsPerFrame:2}}});
  expect(()=>handled.rocutRemotionAudio.register({type:"inline-audio"})).not.toThrow();
  expect(()=>handled.rocutRemotionAudio.producedSnapshot()).toThrow("not requested");
});
