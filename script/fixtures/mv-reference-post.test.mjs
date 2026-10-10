import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const base='packages/editor-classic/src/services/renderer/programmatic/';
function load(name,dependencies={}) {
 const code=ts.transpileModule(readFileSync(base+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 // Only trusted locally authored modules are executed; archived JS is never executed.
 new Function('exports','require',code)(module.exports,key=>{assert.ok(key in dependencies);return dependencies[key];});
 return module.exports;
}
const shaders=load('mv-reference-post-shaders');
const backend=load('mv-reference-post',{'./mv-reference-post-shaders':shaders});
function fixture({bloom=false}={}) {
 const width=64,height=32;
 const targets=[{name:'comp',width,height}];
 for(let level=1;level<=3;level++) for(const suffix of ['','b']) targets.push({name:'b'+level+suffix,width:width>>level,height:height>>level});
 const passes=[{shader:'comp',target:'comp',uniforms:{res:[width,height]},textures:{scene:'scene',text:'text',fg:'fg',lut:'lut'}}];
 if(bloom) {
  passes.push({shader:'bright',target:'b1',uniforms:{thr:.72},textures:{src:'comp'}});
  for(let level=1;level<=3;level++) {
   const a='b'+level,b=a+'b',w=width>>level,h=height>>level;
   if(level>1) passes.push({shader:'blur',target:a,uniforms:{dir:[.5/(width>>(level-1)),.5/(height>>(level-1))]},textures:{src:'b'+(level-1)}});
   for(let n=0;n<(level===1?1:2);n++) passes.push({shader:'blur',target:b,uniforms:{dir:[1/w,0]},textures:{src:a}},{shader:'blur',target:a,uniforms:{dir:[0,1/h]},textures:{src:b}});
  }
 }
 passes.push({shader:'final',target:null,uniforms:{bloom:bloom?.35:0},textures:{comp:'comp',b1:'b1',b2:'b2',b3:'b3'}});
 return {profile:'tunnel-original-gl-v1',required:true,width,height,songTicks:0,allocationBytes:targets.reduce((n,t)=>n+t.width*t.height*8,0)+width*height*16+16384,lutAtlasRequired:false,targets,passes};
}
function mock({extension=true,framebuffer=true,compile=true,error=false}={}) {
 const calls=[],constants=new Map();let id=1;
 const api={getExtension:()=>extension?{}:null,getParameter:()=>8192,getShaderParameter:()=>compile,getProgramParameter:()=>true,checkFramebufferStatus:()=>framebuffer?gl.FRAMEBUFFER_COMPLETE:-1,getUniformLocation:(_,name)=>({name}),isContextLost:()=>false,getError:()=>error?-1:gl.NO_ERROR};
 const gl=new Proxy(api,{has:(_,key)=>key==='createVertexArray',get:(target,key)=>{
  if(key in target)return target[key];
  if(typeof key==='string' && /^[A-Z_0-9]+$/.test(key)) {if(!constants.has(key))constants.set(key,id++);return constants.get(key);}
  return (...args)=>{calls.push([key,...args]);if(String(key).startsWith('create'))return {id:id++};return null;};
 }});
 return {gl,calls};
}
function run(plan,options={}) {
 const {gl,calls}=mock(options);const canvas={width:64,height:32,getContext:()=>gl};
 backend.renderReferencePost({canvas,scene:{width:64,height:32},plan});return {gl,calls};
}
test('RGBA16F allocations and original 15 draw bloom schedule execute and clean up',()=>{
 const {gl,calls}=run(fixture({bloom:true}));
 assert.equal(calls.filter(c=>c[0]==='drawArrays').length,15);
 assert.equal(calls.filter(c=>c[0]==='texImage2D' && c[3]===gl.RGBA16F).length,7);
 for(const [operation,count] of [['deleteTexture',11],['deleteFramebuffer',7],['deleteProgram',4],['deleteShader',8],['deleteVertexArray',1],['deleteBuffer',1]])assert.equal(calls.filter(c=>c[0]===operation).length,count);
 assert.equal(calls.filter(c=>c[0]==='uniform2fv' && c[1].name==='dir').length,12);
 assert.equal(run(fixture()).calls.filter(c=>c[0]==='drawArrays').length,2);
});
test('missing native capabilities and tampered budgets fail closed',()=>{
 for(const options of [{extension:false},{framebuffer:false},{compile:false},{error:true}])assert.throws(()=>run(fixture(),options));
 for(const mutate of [p=>p.profile='other',p=>p.required=false,p=>p.allocationBytes--,p=>p.targets[0].width=8192,p=>p.songTicks=-1,p=>p.passes[0].shader='other',p=>p.passes[0].textures.scene='comp',p=>p.passes[0].uniforms.res=[NaN,1],p=>p.lutAtlasRequired=true]) {
  const plan=fixture();mutate(plan);assert.throws(()=>run(plan));
 }
});
test('trusted embedded backend is self-contained and executable',()=>{
 const {gl,calls}=mock();const canvas={width:64,height:32,getContext:()=>gl};
 new Function('inputs',backend.MV_REFERENCE_POST_SOURCE+';renderReferencePost(inputs);')({canvas,scene:{width:64,height:32},plan:fixture()});
 assert.equal(calls.filter(c=>c[0]==='drawArrays').length,2);
});
test('independent archived shader extraction equals static shader bytes (no pixel claim)',()=>{
 const source=readFileSync('../vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine/core/gl.js','utf8');
 function extract(name){const value=source.match(new RegExp('const '+name+' = (?:COMMON \\+ )?`([\\s\\S]*?)`;'));assert.ok(value);return value[1];}
 assert.equal(shaders.REFERENCE_POST_SHADERS.vertex,extract('VS'));
 for(const name of ['comp','bright','blur','final'])assert.equal(shaders.REFERENCE_POST_SHADERS[name],extract('COMMON')+extract('FS_'+name.toUpperCase()));
});
