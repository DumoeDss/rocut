import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "../programmatic/hyperframes-audio-graph-bootstrap";
import { HYPERFRAMES_AUDIO_GRAPH_PATCH } from "../programmatic/engines/hyperframes-audio-graph-patch";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
test.skipIf(!toolchain)("pinned original native post-fade assignment exposes every author write", () => {
  const context = {patched:readFileSync(join(toolchain!, "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"), "utf8")};
  runInNewContext(HYPERFRAMES_AUDIO_GRAPH_PATCH, context);
  expect(context.patched).toContain("r.volume=k,js.set(r,k),window.rocutHyperframesAudioGraph?.collectAppliedAuthorGain(r,n,e.timeSeconds,H,k),e.onElementVolume?.(r,k,H),");
});

function realm() {
  const context = { window: {}, result: undefined };
  runInNewContext(`class Media {
    src='source'; currentSrc='source'; tagName='AUDIO';
    getAttribute(name) { return name==='data-hf-render-id'?'track':null; }
    hasAttribute(){return false;} closest(){return null;}
  }
  globalThis.HTMLMediaElement=Media;
  globalThis.media=new Media();
  globalThis.document={querySelectorAll:selector=>selector==='audio,video'?[media]:[]};
  ` + HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP + `
  globalThis.bridge=window.rocutHyperframesAudioGraph;
  bridge.registerMedia(media,{resourceId:'source',authoredMuted:false});
  globalThis.clip={el:media,start:0,end:1,duration:1,mediaStart:0,sourceDuration:1,
    playbackRate:1,rate:1,loop:false,volume:null,fades:{fadeIn:0,fadeOut:0}};
  globalThis.write=(time,gain,previous=null)=>{
    bridge.collectTrack(media,clip,time);
    bridge.collectResolvedAuthorGain(media,clip,time,{source:'fallback',gainBeforeFades:gain,
      points:null,fades:clip.fades,fallback:{routed:false,previousRuntimeVolume:previous,
      currentElementVolume:gain,baselineGain:1}});
    bridge.collectAppliedAuthorGain(media,clip,time,gain,gain);
  };
  bridge.beginNativeHistory({profile:'hyperframes-native-sync-all-author-writes-v1',
    canonicalStart:0,canonicalEnd:1,times:[0,0.5,1]});`, context);
  return context;
}

test("native history keeps every actual write, including duplicate-clock writes", () => {
  const context = realm();
  runInNewContext(`bridge.begin({time:0});write(0,0.3);write(0,0.4,0.3);
    bridge.begin({time:0.5});write(0.5,0.2,0.4);
    bridge.begin({time:1});write(1,0.1,0.2);
    result=JSON.stringify(bridge.endNativeHistory());`, context);
  const history = JSON.parse(context.result as unknown as string)[0];
  expect(history.events.map((event: {sequence:number}) => event.sequence)).toEqual([0,1,2,3]);
  expect(history.events.map((event: {appliedAuthorGain:number}) => event.appliedAuthorGain)).toEqual([0.3,0.4,0.2,0.1]);
  expect(history.events.map((event: {gain:{observedAt:number}}) => event.gain.observedAt)).toEqual([0,0,0.5,1]);
});

test("native history fails closed on skipped schedule or omitted original write", () => {
  expect(() => runInNewContext(`bridge.begin({time:0.5});`,realm())).toThrow("deviated");
  expect(() => runInNewContext(`bridge.begin({time:0});bridge.collectTrack(media,clip,0);
    bridge.collectResolvedAuthorGain(media,clip,0,{source:'fallback',gainBeforeFades:1,
      points:null,fades:clip.fades,fallback:{routed:false,previousRuntimeVolume:null,
      currentElementVolume:1,baselineGain:1}});bridge.begin({time:0.5});`,realm())).toThrow("omitted");
  expect(() => runInNewContext(`bridge.begin({time:0});write(0,1);bridge.endNativeHistory();`,realm())).toThrow("incomplete");
});
