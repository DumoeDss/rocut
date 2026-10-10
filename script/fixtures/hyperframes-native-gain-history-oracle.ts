import assert from "node:assert/strict";

type Frame = {time:number; [key:string]:unknown};
export type NativeHistoryScan = {
  profile:string; canonicalStart:number; canonicalEnd:number; times:number[]; frames:Frame[];
};
type Event = {sequence:number; appliedAuthorGain:number; effectiveElementVolume:number;
  gain:{observedAt:number; source:string; gainBeforeFades:number; fades:{fadeIn:number;fadeOut:number}}};
type History = {instanceId:string;resourceId:string;canonicalStart:number;canonicalEnd:number;events:Event[]};

/** Future real-browser oracle only. The caller compiles the fixture with the
 * pinned adapter, installs normal resource/analysis admissions, and supplies a
 * source-hydrated Rust scan. No browser is created by importing this module. */
export function nativeGainHistoryOracleExpression(scan:NativeHistoryScan):string {
  return `(async()=>{
    const scan=${JSON.stringify(scan).replace(/</g,"\\u003c")};
    const author=window.rocut, bridge=window.rocutHyperframesAudioGraph;
    if (!author || !bridge) throw Error('Native history oracle requires compiled driver and admitted bridge');
    await author.ready;
    bridge.beginNativeHistory(scan);
    const writes=[], snapshots=[];
    for (const frame of scan.frames) {
      await author.renderFrame(frame);
      const snapshot=bridge.snapshot();
      snapshots.push(snapshot);
      writes.push({time:frame.time,volumes:[...document.querySelectorAll('audio')].map(el=>({
        instanceId:el.getAttribute('data-hf-render-id'),authorId:el.id,volume:el.volume}))});
    }
    return {histories:bridge.endNativeHistory(),writes,snapshots};
  })()`;
}

export function assertNativeGainHistoryOracle(result:{histories:History[];writes:unknown[];snapshots:unknown[]},scan:NativeHistoryScan) {
  assert.equal(result.writes.length,scan.frames.length);
  assert.equal(result.snapshots.length,scan.frames.length);
  assert.equal(result.histories.length,3,'dynamic, fractional and inert fallback histories must all survive collection');
  for (const history of result.histories) {
    assert.equal(history.canonicalStart,scan.canonicalStart);
    assert.equal(history.canonicalEnd,scan.canonicalEnd);
    assert.ok(history.events.length>1);
    for (const [index,event] of history.events.entries()) {
      assert.equal(event.sequence,index);
      assert.equal(event.gain.source,'fallback');
      assert.ok(scan.times.includes(event.gain.observedAt));
      assert.ok(Number.isFinite(event.appliedAuthorGain));
      assert.ok(event.effectiveElementVolume>=0 && event.effectiveElementVolume<=1);
      if (index) assert.ok(event.gain.observedAt>=history.events[index-1].gain.observedAt);
    }
  }
  assert.ok(result.histories.some(history=>new Set(history.events.map(event=>event.appliedAuthorGain)).size>2),
    'authored DOM writes and native fades must change captured author gain');
  // Replay oracle deliberately holds the final actual write at equal time;
  // neither frame interpolation nor a second fade belongs in the PCM path.
  return (instanceId:string,time:number)=>{
    const history=result.histories.find(history=>history.instanceId===instanceId);
    assert.ok(history);
    const events=history.events.filter(event=>event.gain.observedAt<=time);
    assert.ok(events.length);
    return events.at(-1)!.appliedAuthorGain;
  };
}
