import test from 'node:test';
import assert from 'node:assert/strict';
import {realm,tick,input,moduleSource} from './liquid-object-browser-realm.mjs';
test('private module phases exchange exact controls and identities; checks local settled state',async()=>{
 const r=realm();try{
  let result;
  const phase=r.runtime.runPhase(async service=>{assert.equal(service.frame.index,2);result=await service.evaluate(input(r.frame));});
  assert.equal(r.sent.length,1);assert.equal(r.answer().operation,'open');await tick();
  const request=r.answer();assert.equal(request.identity.requestId,1);await tick();
  assert.equal(r.answer().operation,'close');await phase;
  r.runtime.check();assert.equal(JSON.parse(result).frame.positions.length,3);
  assert.equal(r.context.window.claimLiquidObjectRuntime,undefined);
  assert.equal(r.context.window.evaluate,undefined);
  assert.equal(r.listeners[0].options.capture,true);
  await r.runtime.cleanup();
 }finally{r.finish();}
});
test('outside phase, duplicate phase, pending forgotten awaits and concurrent evaluate are terminal',async()=>{
 for(const kind of ['outside','duplicate','forgotten','concurrent']){
  const r=realm();try{
   if(kind==='outside') {
    let service;const phase=r.runtime.runPhase(value=>{service=value;});r.answer();await tick();r.answer();await phase;
    await assert.rejects(service.evaluate(input(r.frame)),/outside phase/);
   }
   else {
    const phase=r.runtime.runPhase(async service=>{
     if(kind==='duplicate') await r.runtime.runPhase(()=>{});
     else if(kind==='forgotten') void service.evaluate(input(r.frame));
     else {void service.evaluate(input(r.frame));await service.evaluate(input(r.frame));}
    });
    r.answer();await assert.rejects(phase);assert.throws(()=>r.runtime.check());
   }
  }finally{await r.runtime.cleanup();r.finish();}
 }
});
test('unsolicited, late and mismatched replies poison runtime; other source is ignored',async()=>{
 for(const kind of ['unsolicited','late','identity']){
  const r=realm();try{
   assert.equal(r.dispatch('{}',{}),false);
   if(kind==='unsolicited'){assert.equal(r.dispatch('{}'),true);assert.throws(()=>r.runtime.check());}
   else {
    const phase=r.runtime.runPhase(service=>service.evaluate(input(r.frame)));r.answer();await tick();
    if(kind==='identity')r.answer(value=>({...value,identity:{...value.identity,requestId:9}}));
    else {r.answer();await tick();r.answer();await phase;r.dispatch('{}');}
    if(kind==='identity')await assert.rejects(phase);
    assert.throws(()=>r.runtime.check());
   }
  }finally{await r.runtime.cleanup();r.finish();}
 }
});
test('cleanup acknowledgement waits real asynchronous disposal and rejects failed disposal',async()=>{
 for(const failure of [false,true]){
  const r=realm();try{
   let release;const held=new Promise(resolve=>{release=resolve;});
   r.runtime.registerCleanup(async()=>{await held;if(failure)throw Error('dispose failed');});
   assert.equal(r.control('rocut-liquid-object-cleanup-request'),true);await tick();
   assert.equal(r.sent.length,0);release();await tick();
   const ack=r.sent.shift();assert.equal(ack.tag,'rocut-liquid-object-cleanup-ack');assert.equal(ack.ok,!failure);
   assert.equal(r.runtime.cleanup(),r.runtime.cleanup());
  }finally{r.finish();}
 }
});
test('even an already-completed discarded evaluation is rejected when callback settles',async()=>{
 const r=realm();try{
  let release;const held=new Promise(resolve=>{release=resolve;});
  const phase=r.runtime.runPhase(async service=>{void service.evaluate(input(r.frame));await held;});
  r.answer();await tick();r.answer();await tick();release();
  await assert.rejects(phase,/unawaited request/);assert.equal(r.sent.length,0);
 }finally{await r.runtime.cleanup();r.finish();}
});
test('capture listener hides ids/replies; timeout is terminal; cleanup waits phase callback',async()=>{
 const r=realm({requestTimeoutMs:5});try{
  let observed=0;r.listeners.push({fn(){observed++;}});
  const phase=r.runtime.runPhase(()=>{});await assert.rejects(phase,/request timeout/);
  r.dispatch('{}');assert.equal(observed,0);
 }finally{await r.runtime.cleanup();r.finish();}
 const held=realm();try{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const phase=held.runtime.runPhase(()=>gate);held.answer();await tick();
  const disposed=held.runtime.cleanup();await assert.rejects(phase,/cancelled/);
  let finished=false;disposed.then(()=>{finished=true;});await tick();assert.equal(finished,false);
  release();await disposed;assert.equal(finished,true);
 }finally{held.finish();}
});
test('captured stop intrinsic hides cleanup ids after author overrides Event prototype; no forged ack',async()=>{
 for(const vulnerable of [true,false]){
 const source=vulnerable ? moduleSource.replaceAll('stopMessage(event);','event.stopImmediatePropagation();') : moduleSource;
 const r=realm({},source);try{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  r.runtime.registerCleanup(()=>gate);
  r.context.Event.prototype.stopImmediatePropagation=function(){};
  let leaked=0;
  r.listeners.push({fn(event){
   leaked++;r.parent.postMessage({tag:'rocut-liquid-object-cleanup-ack',id:event.data.id,ok:true});
  }});
  assert.equal(r.control('rocut-liquid-object-cleanup-request'),!vulnerable);await tick();
  assert.equal(leaked,vulnerable?1:0);assert.equal(r.sent.length,vulnerable?1:0);
  release();await tick();assert.equal(r.sent.length,vulnerable?2:1);assert.equal(r.sent[0].ok,true);
  if(!vulnerable){assert.equal(r.dispatch('{}'),true);assert.equal(leaked,0);}
 }finally{r.finish();}
 }
});
test('preallocation vertex bounds, UTF-8 bounds, missing policy and cancellation are enforced',async()=>{
 for(const limits of [{maxVerticesPerRequest:1},{maxRequestJsonBytes:20}]){
  const r=realm(limits);try{
   const phase=r.runtime.runPhase(service=>service.evaluate({...input(r.frame),positions:[0,0,0,1,1,1]}));
   r.answer();await assert.rejects(phase);assert.equal(r.sent.length,0);
  }finally{await r.runtime.cleanup();r.finish();}
 }
 const r=realm();try{
  const phase=r.runtime.runPhase(()=>{});r.runtime.fail(Error('cancelled'));await assert.rejects(phase,/cancelled/);
  assert.throws(()=>r.context.claim(),/claimed once|cancelled/);
 }finally{await r.runtime.cleanup();r.finish();}
 assert.match(moduleSource,/policyKeys/);
 assert.throws(()=>realm({maxRequestJsonBytes:undefined}),/Invalid Liquid browser (policy|transport shape)/);
});
