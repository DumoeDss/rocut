import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {captureSource,tick} from './liquid-object-browser-realm.mjs';
function outer(timeout=100){
 const listeners=[],posts=[],requests=[];
 const iframe={style:{},contentWindow:{postMessage(value){posts.push(value);}}};
 const window={__rocutLiquidObjectRequest(value){requests.push(value);}};
 const context=vm.createContext({window,document:{documentElement:{style:{}},body:{style:{},appendChild(){}},
  createElement(){return iframe;}},crypto:{getRandomValues(array){array.fill(posts.length+1);return array;}},
  setTimeout,clearTimeout,requestAnimationFrame(fn){fn();},addEventListener(name,fn){listeners.push(fn);}});
 const config={version:1,frame:{sessionId:'x',index:0,time:0,seed:1},policy:{requestTimeoutMs:timeout,cleanupTimeoutMs:timeout}};
 const promise=vm.runInContext('('+captureSource+')',context)(config,'bootstrap();','<script>author()</script>','default-src none');
 promise.catch(()=>{});
 const dispatch=(data,source=iframe.contentWindow)=>listeners.forEach(fn=>fn({data,source}));
 const acknowledge=(change={})=>{const control=posts.shift();dispatch({tag:control.tag.replace('request','ack'),id:control.id,ok:true,...change});};
 return {iframe,window,posts,requests,promise,dispatch,acknowledge};
}
test('outer accepts only own iframe and success requires two independent check acknowledgements',async()=>{
 const r=outer();assert.equal(r.iframe.sandbox,'allow-scripts');assert.match(r.iframe.srcdoc,/__rocutLiquidObjectConfig/);
 r.dispatch({tag:'rocut-liquid-object-request',payload:'ignored'},{});assert.equal(r.requests.length,0);
 r.dispatch({tag:'rocut-liquid-object-request',payload:'exact-json'});assert.deepEqual(r.requests,['exact-json']);
 r.window.__rocutLiquidObjectReply('host-reply');assert.equal(r.posts.shift().reply,'host-reply');
 r.dispatch({tag:'rocut-html-frame',ok:true});let resolved=false;r.promise.then(()=>{resolved=true;});
 await tick();assert.equal(resolved,false);r.acknowledge();await tick();assert.equal(resolved,false);
 r.acknowledge();assert.equal(await r.promise,true);
});
test('outer cleanup is idempotent, real acknowledgement required, wrong ids/sources ignored',async()=>{
 const r=outer();const cleanup=r.window.__rocutLiquidObjectCleanup();assert.equal(cleanup,r.window.__rocutLiquidObjectCleanup());
 const control=r.posts[0];let finished=false;cleanup.then(()=>{finished=true;});
 r.dispatch({tag:'rocut-liquid-object-cleanup-ack',id:control.id,ok:true},{});
 r.dispatch({tag:'rocut-liquid-object-cleanup-ack',id:'wrong',ok:true});await tick();assert.equal(finished,false);
 r.acknowledge();await cleanup;assert.equal(finished,true);await assert.rejects(r.window.__rocutLiquidObjectCheck(),/closing/);
});
test('cleanup timeout/failure never reports released and rejects screenshot frame failure',async()=>{
 const timed=outer(5);await assert.rejects(timed.window.__rocutLiquidObjectCleanup(),/timed out/);
 const failed=outer();const cleanup=failed.window.__rocutLiquidObjectCleanup();failed.acknowledge({ok:false,error:'still held'});
 await assert.rejects(cleanup,/still held/);
 failed.dispatch({tag:'rocut-html-frame',ok:false,error:'frame failed'});await assert.rejects(failed.promise,/frame failed/);
});
