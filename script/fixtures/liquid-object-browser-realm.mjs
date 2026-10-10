import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const base=new URL('../../apps/cli/src/programmatic/',import.meta.url);
const raw=name=>readFileSync(new URL(name,base),'utf8').match(/String\.raw`([\s\S]*?)`;/)[1];
export const moduleSource=raw('liquid-object-browser-codec.ts')+raw('liquid-object-browser-runtime.ts');
export const captureSource=raw('liquid-object-page-capture.ts');
export function realm(overrides={},source=moduleSource){
 const policy={version:1,maxControlJsonBytes:2048,maxVerticesPerRequest:20,maxRequestJsonBytes:2048,
  maxResponseJsonBytes:2048,maxRequestEnvelopeBytes:4096,maxResponseEnvelopeBytes:4096,
  maxMeshesPerFrame:20,maxVerticesPerFrame:200,maxRequestsPerFrame:20,maxEncodedBytesPerFrame:20000,
  maxRetainedPayloadBytesPerFrame:20000,maxInFlight:1,requestTimeoutMs:1000,frameTimeoutMs:10000,
  cleanupTimeoutMs:1000,initTimeoutMs:1000,terminationTimeoutMs:1000,...overrides};
 const frame={sessionId:'test',index:2,time:.25,seed:7};
 const sent=[],listeners=[];const timers=new Set();
 const parent={postMessage(message){sent.push(message);}};
 class MessageEvent {stopImmediatePropagation(){this.stopped=true;}}
 const context=vm.createContext({window:{__rocutLiquidObjectConfig:{version:1,frame,policy}},parent,Event:MessageEvent,
  TextEncoder,console,addEventListener(name,fn,options){listeners.push({fn,options});},
  setTimeout(fn,ms){const timer=setTimeout(fn,ms);timers.add(timer);return timer;},
  clearTimeout(timer){clearTimeout(timer);timers.delete(timer);}});
 vm.runInContext(source.replace('export function claimLiquidObjectRuntime','function claimLiquidObjectRuntime')+
  '\nthis.claim=claimLiquidObjectRuntime;',context);
 const dispatch=(reply,source=parent)=>{
  const event=Object.assign(new MessageEvent(),{source,data:{tag:'rocut-liquid-object-reply',reply},stopped:false});
  for(const {fn} of listeners){fn(event);if(event.stopped)break;}return event.stopped;
 };
 const answer=(change=value=>value)=>{
  const request=JSON.parse(sent.shift().payload);
  const reply=request.operation ? {operation:request.operation,frame:request.frame,ok:true} :
   {version:1,identity:request.identity,payloadJson:JSON.stringify({version:1,ok:true,
    frame:{restore:false,positions:JSON.parse(request.payloadJson).positions}})};
  dispatch(JSON.stringify(change(reply)));return request;
 };
 const control=(tag,id='0123456789abcdef0123456789abcdef')=>{
  const event=Object.assign(new MessageEvent(),{source:parent,data:{tag,id},stopped:false});
  for(const {fn} of listeners){fn(event);if(event.stopped)break;}return event.stopped;
 };
 return {context,frame,policy,sent,parent,listeners,dispatch,answer,control,runtime:context.claim(),
  finish(){for(const timer of timers)clearTimeout(timer);}};
}
export const tick=()=>new Promise(resolve=>setImmediate(resolve));
export const input=frame=>({version:1,params:{},positions:[0,0,0],time:frame.time,seed:frame.seed});
