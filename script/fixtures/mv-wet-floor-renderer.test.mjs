import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync('packages/editor-classic/src/services/renderer/programmatic/mv-wet-floor.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('exports',code)(module.exports);
const {renderWetFloor}=module.exports;
function environment(){
 const calls=[],allocated=[];function canvas(){const object={width:1920,height:1080};const ctx=new Proxy({}, {get(_,key){if(key==='createImageData')return (w,h)=>({data:new Uint8ClampedArray(w*h*4)});if(key==='createRadialGradient'||key==='createLinearGradient')return (...args)=>{calls.push([key,...args]);return {addColorStop:(...v)=>calls.push(['addColorStop',...v])};};return (...args)=>calls.push([key,...args]);},set(_,key,value){calls.push(['set',key,value]);return true;}});object.getContext=()=>ctx;return object;}
 globalThis.document={createElement:()=>{const c=canvas();allocated.push(c);return c;},fonts:{has:()=>true}};
 const fonts=[{resourceId:'primary',face:{status:'loaded',family:'exact-primary'}},{resourceId:'fallback',face:{status:'loaded',family:'exact-fallback'}}];
 const plan={version:1,profile:'night-wet-floor-v1',fontStacks:[{role:'dot400',resources:[{id:'primary'},{id:'fallback'}],aliases:['exact-primary','exact-fallback']}],surfaces:[],operations:[]};
 return {calls,allocated,canvas:canvas(),fonts,plan,image:{resourceId:'bg',image:{width:1672,height:941}}};
}
test('wetFloor transport executes exact native clips, cropped images, gradients, text and raw pixels',()=>{
 const env=environment();env.plan.surfaces=[{id:'raw',size:[2,1],operations:[{op:'putAlpha',size:[2,1],bytes:[0,123]}]}];
 env.plan.operations=[{op:'save'},{op:'translate',point:[12,34]},{op:'linearGradient',id:'g',points:[0,0,0,100],stops:[[0,'#000'],[1,'#fff']]},{op:'fillStyle',brush:{kind:'gradient',id:'g'}},{op:'beginPath'},{op:'ellipse',center:[2,3],radii:[4,5],rotation:0,start:0,end:6.28},{op:'clip',rule:'evenodd'},{op:'drawImage',image:{kind:'surface',id:'raw'},sourceRect:[0,0,1,1],destinationRect:[10,20,30,40]},{op:'font',role:'dot400',weight:400,size:124},{op:'shadowBlur',value:22},{op:'fillText',text:'02',point:[1,2]},{op:'restore'}];
 renderWetFloor(env);assert.ok(env.calls.some(c=>c[0]==='clip'&&c[1]==='evenodd'));assert.ok(env.calls.some(c=>c[0]==='drawImage'&&c.length===10&&c.slice(2).join(',')==='0,0,1,1,10,20,30,40'));assert.ok(env.calls.some(c=>c[0]==='set'&&c[1]==='font'&&c[2]==='400 124px "exact-primary","exact-fallback"'));const pixels=env.calls.find(c=>c[0]==='putImageData')[1].data;assert.deepEqual(Array.from(pixels),[255,255,255,0,255,255,255,123]);assert.ok(env.allocated.every(c=>c.width===1&&c.height===1));
});
test('wetFloor transport fails closed without exact loaded font bindings',()=>{const env=environment();env.fonts[0].face.family='generic-serif';assert.throws(()=>renderWetFloor(env),/FontFace unavailable/);assert.equal(env.allocated.length,0);});
test('wetFloor transport releases partial surface on invalid forward sample',()=>{const env=environment();env.plan.surfaces=[{id:'bad',size:[2,2],operations:[{op:'drawImage',image:{kind:'surface',id:'bad'},sourceRect:null,destinationRect:[0,0,2,2]}]}];assert.throws(()=>renderWetFloor(env),/unbound native image/);assert.ok(env.allocated.every(c=>c.width===1&&c.height===1));});
