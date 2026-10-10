import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../packages/editor-classic/src/services/renderer/programmatic/mv-meta-panels-renderer.ts", import.meta.url), "utf8").match(/String.raw`([\s\S]*)`;/)[1];
const render = new Function(`${source};return mvMetaPanels;`)();
function harness() {
  const calls = [], surfaces = [];
  function context(label) {
    return new Proxy({}, { get(target, key) {
      if (key in target) return target[key];
      if (key === "createImageData") return (w,h) => ({data:new Uint8ClampedArray(w*h*4)});
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({addColorStop(){}});
      return (...args) => calls.push([label,key,...args]);
    }});
  }
  function make(width,height) {
    const c={width,height,getContext:()=>context(`surface${surfaces.length}`)};
    surfaces.push(c); return c;
  }
  return {calls,surfaces,make,ctx:context("root")};
}
const color=[1,1,1,1];
function panel(fields={}) {return {child:null,tone:null,lines:[],pen:null,clip:[[0,0],[1920,0],[1920,1080],[0,1080]],translate:[0,0],transform:[1,0,0,1,0,0],flash:"none",leading:null,leadingColor:color,keyline:null,...fields};}
function plan(panels, paper=null) {return {background:color,pageShift:[0,0],panels,paper,collapseFlash:0,finalFrame:null,scratchPixels:0};}
test("Panels native dot field stays one path/fill and releases tone raster",()=>{
  const h=harness();
  const tone={c0:color,c1:color,sun:null,sunColor:color,dotColor:color,dots:[[10,10,2],[20,20,4]],paperAlpha:0};
  render(h.ctx,plan([panel({tone})]),()=>null,h.make,()=>{});
  assert.equal(h.calls.filter(c=>c[1]==="arc").length,2);
  assert.equal(h.calls.filter(c=>c[1]==="fill").length,1);
  assert.equal(h.surfaces.length,1);
  assert.deepEqual(h.surfaces.map(c=>[c.width,c.height]),[[0,0]]);
});
test("Panels mapped children follow actual plan order and do not retain child ownership",()=>{
  const h=harness(), indices=[];const input={width:1920,height:1080};
  render(h.ctx,plan([panel({child:{input:"second",songTicks:120000}}),panel({child:{input:"first",songTicks:60000}})]),(i,phase)=>{indices.push([i,phase]);return input;},h.make,()=>{});
  assert.deepEqual(indices,[[0,"background"],[0,"foreground"],[1,"background"],[1,"foreground"]]);assert.equal(input.width,1920);assert.equal(h.surfaces.length,0);
});
test("Panels lines interleave between genuine background and remaining child roles",()=>{
  const h=harness(),background={width:1920,height:1080,name:"background"},foreground={width:1920,height:1080,name:"foreground"};
  const lines=[{color,triangles:[[[0,0],[1,1],[2,0]]]}];
  render(h.ctx,plan([panel({child:{input:"layered",songTicks:0},lines})]),(_i,phase)=>phase==="background"?background:foreground,h.make,()=>{});
  const relevant=h.calls.filter(c=>c[0]==="root"&&(c[1]==="drawImage"||c[1]==="fill"));
  assert.deepEqual(relevant.map(c=>c[1]==="drawImage"?c[2].name:"lines"),["background","lines","foreground"]);
});
test("Panels malformed paper and missing child release allocated native scratch",()=>{
  const h=harness();
  assert.throws(()=>render(h.ctx,plan([], {rgba:"AA==",blotches:[],fibers:[]}),()=>null,h.make,()=>{}),/byte count/);
  assert.deepEqual(h.surfaces.map(c=>[c.width,c.height]),[[0,0]]);
  const h2=harness();const paper={rgba:Buffer.alloc(960*540*4).toString("base64"),blotches:[],fibers:[]};
  assert.throws(()=>render(h2.ctx,plan([panel({child:{input:"missing",songTicks:0}})],paper),()=>null,h2.make,()=>{}),/mapped child/);
  assert.deepEqual(h2.surfaces.map(c=>[c.width,c.height]),[[0,0]]);
});
