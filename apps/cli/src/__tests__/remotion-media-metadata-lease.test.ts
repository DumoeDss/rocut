import {expect,test} from "bun:test";
import {runInNewContext} from "node:vm";
import {REMOTION_MEDIA_METADATA_LEASE_SOURCE} from "../programmatic/engines/remotion-media-metadata-lease";
import {REMOTION_MEDIA_WRAPPER} from "../programmatic/engines/remotion-media";

function fixture() {
  const state={releases:0,removes:0,loads:0,durations:[] as number[],errors:[] as unknown[],signal:undefined as AbortSignal|undefined};
  let resolve!:(duration:number)=>void,reject!:(error:unknown)=>void;
  const pending=new Promise<number>((yes,no)=>{resolve=yes;reject=no;});
  const context={AbortController,lease:undefined as unknown as (options:unknown)=>()=>void};
  runInNewContext(REMOTION_MEDIA_METADATA_LEASE_SOURCE+";lease=rocutNativeMediaMetadataLease;",context);
  const options={element:{removeAttribute:()=>{state.removes++;},load:()=>{state.loads++;}},
    read:(_element:unknown,signal:AbortSignal)=>{state.signal=signal;return pending;},
    apply:(duration:number)=>{state.durations.push(duration);},release:()=>{state.releases++;},
    cancel:(error:unknown)=>{state.errors.push(error);throw error;}};
  return {state,resolve,reject,options,lease:context.lease};
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();};

test("native video/audio metadata cleanup prevents late publish and releases once",async()=>{
  const f=fixture(),cleanup=f.lease(f.options);
  cleanup();cleanup();f.resolve(1.25);await settle();
  expect(f.state.signal?.aborted).toBe(true);
  expect(f.state.durations).toEqual([]);
  expect(f.state.errors).toEqual([]);
  expect([f.state.releases,f.state.removes,f.state.loads]).toEqual([1,1,1]);
});
test("success followed by ref cleanup cannot double-continue native handle",async()=>{
  const f=fixture(),cleanup=f.lease(f.options);
  f.resolve(2.5);await settle();cleanup();
  expect(f.state.durations).toEqual([2.5]);expect(f.state.releases).toBe(1);
});
test("native cancelRender intentional throw still releases without late rejection",async()=>{
  const f=fixture(),cleanup=f.lease(f.options),error=Error("decode failure");
  f.reject(error);await settle();cleanup();
  expect(f.state.errors).toEqual([error]);expect(f.state.releases).toBe(1);
});
test("aborted old source rejection cannot cancel the replacement composition",async()=>{
  const old=fixture(),next=fixture(),cleanup=old.lease(old.options);
  next.lease(next.options);cleanup();old.reject(Error("old source"));next.resolve(3);await settle();
  expect(old.state.errors).toEqual([]);expect(old.state.durations).toEqual([]);
  expect(next.state.durations).toEqual([3]);expect(next.state.releases).toBe(1);
});
test("sync read/apply errors and cleanup decoder errors retain exactly-once release",async()=>{
  const f=fixture();f.lease({...f.options,read:()=>{throw Error("syncread");}});await settle();
  expect(f.state.errors.length).toBe(1);expect(f.state.releases).toBe(1);
  const g=fixture();g.lease({...g.options,apply:()=>{throw Error("context retired");}});g.resolve(1);await settle();
  expect(g.state.errors.length).toBe(1);expect(g.state.releases).toBe(1);
  const h=fixture(),cleanup=h.lease({...h.options,element:{removeAttribute:()=>{},load:()=>{throw Error("load");}}});
  expect(cleanup).toThrow("load");h.resolve(1);await settle();expect(h.state.releases).toBe(1);
});
test("both native wrappers embed lease in archived compiler fingerprint source",()=>{
  expect(REMOTION_MEDIA_WRAPPER.startsWith(REMOTION_MEDIA_METADATA_LEASE_SOURCE)).toBe(true);
  expect(REMOTION_MEDIA_WRAPPER.match(/return rocutNativeMediaMetadataLease\(/g)?.length).toBe(2);
});
