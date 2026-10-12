import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as baseFixture} from './hyperframes-native-seek-test-fixture.mjs';
function fixture(){
 const f=baseFixture(),other=f.createVideo(),timers=new Map();let timerId=0;
 f.context.setTimeout=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};
 f.context.clearTimeout=id=>timers.delete(id);
 const signal=new AbortController(),scope=f.begin({videos:[f.video,other],signal:signal.signal});
 return {...f,other,scope,signal,
  seek:(target=.37,video=f.video)=>f.context.rocutMedia.nativeSeek(video,target).catch(error=>error),
  submit:(data,video=f.video)=>{const [id,callback]=f.callbacksFor(video)[0];f.callbacks.delete(id);callback(0,data);return callback;},
  expire:()=>{f.setNow(8000);timers.get(1)?.fn();}};
}
const fresh={mediaTime:.37,presentationTime:11,presentedFrames:2};
async function pending(f,result){assert.equal(f.scope.presentations.size,0);f.expire();assert.match((await result).message,/timed out|deadline expired/);f.close();}
test('one fresh seeking callback is not admitted until seeked; frozen primitive candidate survives mutation',async()=>{
 const f=fixture(),result=f.seek();f.setNow(10);let settled=false;result.then(()=>settled=true);
 const data={...fresh};f.submit(data);assert.equal(f.video.seeking,true);assert.equal(f.scope.presentations.size,0);await Promise.resolve();assert.equal(settled,false);
 data.mediaTime=NaN;data.presentationTime=0;data.presentedFrames=0;f.video.land();
 assert.equal(f.scope.presentations.size,1,'fresh seeking candidate should settle at seeked');
 const actual=await result;assert.equal(actual.target,.37);assert.equal(actual.mediaTime,.37);assert.equal(actual.presentedFrames,2);assert.equal(f.callbacks.size,0);f.close();
});
test('seeking low-ready candidate still requires final ready state and seeked',async()=>{
 const f=fixture(),result=f.seek();f.video.readyState=1;f.submit({...fresh});f.video.land();assert.equal(f.scope.presentations.size,0);
 f.video.readyState=2;f.video.emit('canplay');assert.equal(f.scope.presentations.size,1);assert.equal((await result).target,.37);f.close();
});
test('loadeddata/canplay and clearing seeking cannot replace absent seeked',async()=>{
 const f=fixture(),result=f.seek();f.submit({...fresh});f.video.seeking=false;f.video.emit('loadeddata');f.video.emit('canplay');await pending(f,result);
});
for(const change of ['source','markup','wrong-command-time','paused','decode']){
 test('final seeked rejects '+change,async()=>{
  const f=fixture(),result=f.seek();f.submit({...fresh});
  if(change==='source')f.video.currentSrc='data:video/webm;base64,BAUG';
  if(change==='markup')f.video.src='data:video/webm;base64,BAUG';
  if(change==='wrong-command-time')f.video._time=.23;
  if(change==='paused')f.video.paused=false;
  if(change==='decode')f.video.error={code:3};
  f.video.land();assert.match((await result).message,/source changed|target changed|paused|decode failed/);assert.equal(f.scope.presentations.size,0);f.close();
 });
}
for(const blocked of ['still-seeking','still-unready']){
 test('final seeked cannot accept '+blocked,async()=>{
  const f=fixture(),result=f.seek();f.submit({...fresh});
  f.video.seeking=blocked==='still-seeking';if(blocked==='still-unready')f.video.readyState=1;
  f.video.emit('seeked');await pending(f,result);
 });
}
for(const stale of ['submission-before-assignment','nonincreasing-framecounter']){
 test('candidate cannot retain '+stale,async()=>{
  const f=fixture();f.setNow(10);if(stale==='nonincreasing-framecounter')f.scope.presentations.set(f.video,{presentedFrames:2});
  const result=f.seek();f.submit({...fresh,presentationTime:stale==='submission-before-assignment'?9:11});f.video.land();
  assert.notEqual(f.scope.presentations.get(f.video)?.target,.37);f.expire();assert.match((await result).message,/timed out/);f.close();
 });
}
test('candidate counter is revalidated at event against a newer accepted presentation',async()=>{
 const f=fixture(),result=f.seek();f.submit({...fresh});f.scope.presentations.set(f.video,{target:.1,presentedFrames:2});f.video.land();
 assert.equal(f.scope.presentations.get(f.video).target,.1);f.expire();assert.match((await result).message,/timed out/);f.close();
});
for(const key of ['mediaTime','presentationTime','presentedFrames']){
 test('invalid candidate '+key+' is not evidence',async()=>{
  const f=fixture(),result=f.seek();f.submit({...fresh,[key]:NaN});assert.match((await result).message,/omitted presentation/);assert.equal(f.scope.presentations.size,0);f.close();
 });
 test('seeking candidate '+key+' accessor is never invoked or retained',async()=>{
  const f=fixture(),result=f.seek(),data={...fresh};let reads=0;
  Object.defineProperty(data,key,{get(){reads++;throw Error('must-not-read');}});
  f.submit(data);f.video.land();assert.equal(reads,0);await pending(f,result);
 });
}
for(const event of ['abort','emptied']){
 test('healthy same-source '+event+' retires seeking candidate',async()=>{
  const f=fixture(),result=f.seek();f.submit({...fresh});f.video.emit(event);f.video.land();await pending(f,result);
 });
}
test('wrong video callback/event cannot fulfill another video candidate',async()=>{
 const f=fixture(),first=f.seek(.37,f.video),second=f.seek(.23,f.other);
 f.submit({...fresh,mediaTime:.23},f.other);f.other.land();assert.equal((await second).target,.23);
 assert.equal(f.scope.presentations.has(f.video),false);assert.equal(f.scope.presentations.get(f.other).target,.23);
 f.video.land();assert.equal(f.scope.presentations.has(f.video),false);
 f.expire();assert.match((await first).message,/timed out/);f.close();
});
test('cancel aborts seeking candidate and cannot be revived by seeked',async()=>{
 const f=fixture(),result=f.seek();f.submit({...fresh});const reason=Error('owned-abort');f.signal.abort(reason);f.video.land();
 assert.equal(await result,reason);assert.equal(f.scope.presentations.size,0);assert.equal(f.callbacks.size,0);f.close();
});
test('scope close retires candidate and delivered obsolete callback',async()=>{
 const f=fixture(),result=f.seek();const callback=f.submit({...fresh});f.close();callback(0,fresh);f.video.land();
 assert.match((await result).message,/fence closed/);assert.equal(f.scope.presentations.size,0);
});
test('superseding seek retires candidate and delivered old callback',async()=>{
 const f=fixture(),first=f.seek();const callback=f.submit({...fresh});const second=f.seek(.23);assert.equal(await first,undefined);
 callback(0,fresh);assert.equal(f.scope.presentations.size,0);
 f.submit({...fresh,mediaTime:.23,presentedFrames:3});f.video.land();assert.equal(f.scope.presentations.size,1);assert.equal((await second).target,.23);f.close();
});
test('next stale callback retires earlier candidate rather than resurrecting it',async()=>{
 const f=fixture();f.setNow(10);const result=f.seek();f.submit({...fresh});f.submit({...fresh,presentationTime:9});f.video.land();await pending(f,result);
});
test('original8000 deadline is not renewed by candidate or seeked',async()=>{
 const f=fixture(),result=f.seek();f.submit({...fresh});f.setNow(8000);f.video.land();
 assert.match((await result).message,/deadline expired/);assert.equal(f.scope.presentations.size,0);f.close();
});
test('source/cursor mismatch is rejected even before seeking candidate is collected',async()=>{
 for(const change of ['source','target']){
  const f=fixture(),result=f.seek();if(change==='source')f.video.currentSrc='data:video/webm;base64,BAUG';else f.video._time=.23;
  f.submit({...fresh});assert.match((await result).message,/source changed|target changed/);assert.equal(f.scope.presentations.size,0);f.close();
 }
});
