/** Private module closure. No evaluator, service or claim is placed on window. */
export const LIQUID_OBJECT_BROWSER_RUNTIME = String.raw`
const stopMessage=Function.prototype.call.bind(Event.prototype.stopImmediatePropagation);
let phase='created',claimed=false,terminal,pending,requestId=0,cleanupPromise,phaseTask;
const cleanups=[],evaluations=[],evaluationStates=new WeakMap();
class LiquidEvaluationPromise extends Promise {
 static get [Symbol.species](){return Promise;}
 then(fulfilled,rejected){evaluationStates.get(this).observed=true;return super.then(fulfilled,rejected);}
}
let rejectFailure;
const failure=new Promise((_,reject)=>{rejectFailure=reject;});
failure.catch(()=>{});
const fail=cause=>{
 if(!terminal) {
  terminal=cause instanceof Error ? cause : Error(String(cause)); phase='failed';
  rejectFailure(terminal);
  if(pending) { clearTimeout(pending.timer);const task=pending;pending=undefined;task.reject(terminal); }
 }
 return terminal;
};
const assert=()=>{if(terminal) throw terminal;};
const frameTimer=setTimeout(()=>fail(Error('Liquid browser whole-frame timeout')),policy.frameTimeoutMs);
const send=(json,expected)=>new Promise((resolve,reject)=>{
 try {
  assert();
  if(pending) throw Error('Liquid browser permits one outstanding request');
  const timer=setTimeout(()=>fail(Error('Liquid browser request timeout')),policy.requestTimeoutMs);
  pending={expected,resolve,reject,timer};
  parent.postMessage({tag:'rocut-liquid-object-request',payload:json},'*');
 } catch(error) { reject(fail(error)); }
});
const control=operation=>send(bounded(JSON.stringify({operation,frame}),policy.maxControlJsonBytes),{operation});
const evaluate=input=>{
 const task=(async()=>{
  try {
   assert();
   if(phase!=='active' || pending) throw Error('Liquid request is outside phase or pending');
   const expected=prepare(input,++requestId);
   return await send(expected.json,expected);
  } catch(error) { throw fail(error); }
 })();
 task.catch(()=>{});
 const tracked=new LiquidEvaluationPromise((resolve,reject)=>task.then(resolve,reject));
 const state={observed:false,settled:false};evaluationStates.set(tracked,state);evaluations.push(state);
 Promise.prototype.then.call(tracked,()=>{state.settled=true;},()=>{state.settled=true;});
 return tracked;
};
const check=()=>{
 assert();
 if(phase!=='closed' || pending) throw fail(Error('Liquid browser frame is not closed and settled'));
};
const cleanup=()=>{
 if(cleanupPromise) return cleanupPromise;
 clearTimeout(frameTimer);
 fail(Error('Liquid browser cleanup cancelled the runtime'));
 cleanupPromise=(async()=>{
  // Driver cleanups cancel owned stages; do not acknowledge until they really settle.
  const results=await Promise.allSettled(cleanups.map(fn=>Promise.resolve().then(fn)));
  if(phaseTask) await Promise.allSettled([phaseTask]);
  phase='disposed';
  const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
  if(errors.length) throw new AggregateError(errors,'Liquid browser cleanup failed');
 })();
 cleanupPromise.catch(()=>{}); return cleanupPromise;
};
// Capture listener is registered at module initialization, before authored entry.
// Control ids and transport replies must never reach author message listeners.
addEventListener('message',event=>{
 if(event.source!==parent) return;
 const data=event.data;
 if(data?.tag==='rocut-liquid-object-reply') {
  stopMessage(event);
  if(!pending || terminal) { fail(Error('Late or unsolicited Liquid browser reply'));return; }
  const task=pending;
  try {
   const value=decode(data.reply,task.expected);
   pending=undefined;clearTimeout(task.timer);task.resolve(value);
  } catch(error) { fail(error); }
  return;
 }
 const cleanupRequest=data?.tag==='rocut-liquid-object-cleanup-request';
 if(!cleanupRequest && data?.tag!=='rocut-liquid-object-check-request') return;
 stopMessage(event);
 if(typeof data.id!=='string' || !/^[a-f0-9]{32}$/.test(data.id)) {fail(Error('Invalid Liquid control id'));return;}
 const tag=cleanupRequest ? 'rocut-liquid-object-cleanup-ack' : 'rocut-liquid-object-check-ack';
 Promise.resolve().then(()=>cleanupRequest ? cleanup() : check()).then(
  ()=>parent.postMessage({tag,id:data.id,ok:true},'*'),
  error=>parent.postMessage({tag,id:data.id,ok:false,error:String(error?.message??error)},'*'));
},{capture:true});
const runtime=Object.freeze({failure,fail,check,cleanup,
 registerCleanup(fn){
  try {assert();if(typeof fn!=='function' || phase==='disposed') throw Error('Invalid Liquid cleanup registration');cleanups.push(fn);}
  catch(error){throw fail(error);}
 },
 runPhase(callback){
  const task=(async()=>{
   try {
    assert();if(phase!=='created' || typeof callback!=='function') throw Error('Liquid phase can run once');
    phase='opening';await control('open');assert();phase='active';
    const authorTask=Promise.resolve().then(()=>callback(Object.freeze({frame,evaluate})));
    phaseTask=authorTask;authorTask.catch(()=>{});
    const value=await Promise.race([authorTask,failure]);assert();
    if(pending || evaluations.some(task=>!task.observed || !task.settled))
     throw Error('Liquid callback returned with an unawaited request');
    phase='closing';await control('close');assert();phase='closed';return value;
   } catch(error) {throw fail(error);}
  })();task.catch(()=>{});return task;
 }
});
export function claimLiquidObjectRuntime(){
 if(claimed) throw fail(Error('Liquid runtime can be claimed once'));
 assert();claimed=true;return runtime;
}
`;
