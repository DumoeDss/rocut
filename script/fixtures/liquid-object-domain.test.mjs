import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {realm, input} from './liquid-object-browser-realm.mjs';
const esbuild = await import(pathToFileURL(process.env.LIQUID_ESBUILD_MODULE).href);
const built = await esbuild.build({entryPoints:[new URL('../../apps/cli/src/programmatic/engines/three-liquid-object-transport-wire.ts',import.meta.url).pathname.replace(/^\//,'')],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const wire = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const frame={sessionId:'domain-cpu',index:2,time:.25,seed:7},identity={frame,requestId:1};
const policy={maxRequestJsonBytes:2048,maxRequestEnvelopeBytes:4096};
const base=()=>input(frame),domain={min:[-2,-1,-3],max:[4,5,6]};
const workerSource=fs.readFileSync(new URL('../../apps/cli/src/programmatic/liquid-object-worker-entry.mjs',import.meta.url),'utf8');
function worker(){
 const context=vm.createContext({Buffer,frame,policy:{...policy,maxResponseJsonBytes:2048,maxResponseEnvelopeBytes:4096},sameFrame:value=>JSON.stringify(value)===JSON.stringify(frame),pending:null,send:()=>{},calls:[],wasm:{evaluateLiquidObjectFrameJson:payload=>{context.calls.push(payload);return '{}';}}});
 vm.runInContext(workerSource.slice(workerSource.indexOf('function shape('),workerSource.indexOf('function text('))+workerSource.slice(workerSource.indexOf('function text('),workerSource.indexOf('function sameFrame('))+workerSource.slice(workerSource.indexOf('function reservedText('),workerSource.indexOf('process.on("disconnect"')),context);
 return {context,async evaluate(payload){const payloadJson=JSON.stringify(payload),json=JSON.stringify({version:1,identity,payloadJson});context.pending={identity,vertices:payload.positions.length/3,requestJsonBytes:Buffer.byteLength(payloadJson),requestEnvelopeBytes:Buffer.byteLength(json),reservation:{maxResponseJsonBytes:2048,maxResponseEnvelopeBytes:4096}};await context.evaluate(json,JSON.parse(json));return context.calls.at(-1);}};
}
test('optional domain passes browser, wire and fixed worker payload gates with unchanged exact JSON and vertex accounting',async()=>{
 const r=realm();try{
  for(const positions of [[-2,-1,-3],[4,5,6]]){
   const request={...base(),positions,domain},json=JSON.stringify(request);
   const prepared=wire.prepareLiquidTransportRequest({requestJson:json,identity,policy});
   assert.equal(prepared.vertices,1);assert.equal(prepared.requestJsonBytes,Buffer.byteLength(json));
   assert.equal(prepared.requestEnvelopeBytes,Buffer.byteLength(prepared.encode()));
   assert.equal(JSON.parse(prepared.encode()).payloadJson,json);
   const browser=vm.runInContext('prepare',r.context)(request,1);assert.equal(JSON.parse(browser.json).payloadJson,json);
   assert.equal(await worker().evaluate(request),json);
  }
  const old=JSON.stringify(base()),prepared=wire.prepareLiquidTransportRequest({requestJson:old,identity,policy});
  assert.equal(JSON.parse(prepared.encode()).payloadJson,old);assert.equal(await worker().evaluate(base()),old);
  assert.equal(JSON.parse(vm.runInContext('prepare',r.context)(base(),1).json).payloadJson,old);
 }finally{r.finish();}
});
test('three payload gates reject domain shape/extra keys and trusted-clock override before evaluator',async()=>{
 const bad=[null,[],3,{}, {min:[0,0,0]}, {...domain,extra:1}, {min:[0,0],max:domain.max},
  {min:[0,0,0,0],max:domain.max}, {min:[0,'0',0],max:domain.max}, {min:[0,null,0],max:domain.max}];
 for(const value of [...bad.map(domain=>({...base(),domain})),{...base(),domain,time:9},{...base(),domain,seed:99},{...base(),domain,extra:1}]){
  const r=realm(),w=worker();try{
   assert.throws(()=>vm.runInContext('prepare',r.context)(value,1));
   assert.throws(()=>wire.prepareLiquidTransportRequest({requestJson:JSON.stringify(value),identity,policy}));
   await assert.rejects(w.evaluate(value));assert.equal(w.context.calls.length,0);
  }finally{r.finish();}
 }
 const r=realm();try{for(const value of [NaN,Infinity])assert.throws(()=>vm.runInContext('prepare',r.context)({...base(),domain:{min:[0,value,0],max:domain.max}},1));
  assert.throws(()=>vm.runInContext('prepare',r.context)({...base(),domain:{...domain,[Symbol('extra')]:1}},1));
 }finally{r.finish();}
});
