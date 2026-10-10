import {expect,test} from "bun:test";
import {assertNativeGainHistoryOracle,nativeGainHistoryOracleExpression} from "../../../../script/fixtures/hyperframes-native-gain-history-oracle";

test("unstarted browser oracle keeps Rust descriptors and last duplicate write",()=>{
  const scan={profile:"hyperframes-native-sync-all-author-writes-v1",canonicalStart:0,canonicalEnd:1,
    times:[0,0.5,1],frames:[0,0.5,1].map(time=>({time,index:7,seed:42,sourceTime:123,sampleTime:123}))};
  const history=(instanceId:string)=>({instanceId,resourceId:"a".repeat(64),canonicalStart:0,canonicalEnd:1,
    events:[{time:0,gain:0.1},{time:0.5,gain:0.8},{time:0.5,gain:0.3},{time:1,gain:0.6}].map((entry,sequence)=>({
      sequence,appliedAuthorGain:entry.gain,effectiveElementVolume:entry.gain,
      gain:{observedAt:entry.time,source:"fallback",gainBeforeFades:entry.gain,fades:{fadeIn:0,fadeOut:0}}}))});
  const replay=assertNativeGainHistoryOracle({histories:[history("dynamic"),history("fractional"),history("inert")],
    writes:[{},{},{}],snapshots:[{},{},{}]},scan);
  expect(replay("dynamic",0.25)).toBe(0.1);
  expect(replay("dynamic",0.5)).toBe(0.3);
  expect(replay("dynamic",0.75)).toBe(0.3);
  const expression=nativeGainHistoryOracleExpression(scan);
  expect(expression).toContain('"seed":42,"sourceTime":123,"sampleTime":123');
  expect(expression).toContain("await author.renderFrame(frame)");
  expect(()=>new Function("return "+expression)).not.toThrow();
});
