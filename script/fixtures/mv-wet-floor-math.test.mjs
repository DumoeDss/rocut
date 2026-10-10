import {readFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
// Test-only execution of unchanged original function bodies, never production.
const reference=process.env.ROCUT_WET_FLOOR_REFERENCE ?? resolve('../vocaloid-style-mv-pipeline/skills/vocaloid-style-mv/template/engine');
function oracle(){
 const context=vm.createContext({window:{},console});
 vm.runInContext(readFileSync(join(reference,'core/util.js'),'utf8'),context);
 const marker="  Z.scene('wetFloor', {";
 const source=readFileSync(join(reference,'scenes/night.js'),'utf8');
 assert.equal(source.split(marker).length,2);
 vm.runInContext(source.replace(marker,"  window.wetFloorMath = {cntRings, rippleRings, puddlePath, fallPlan, countPlan};\n"+marker),context);
 return {Z:context.window.Z,wet:context.window.wetFloorMath};
}
function near(actual,expected,label){assert.ok(Math.abs(actual-expected)<=1e-10*Math.max(1,Math.abs(expected)),`${label}: ${actual} != ${expected}`);}
test('native wetFloor pure maths agree with independent original function bodies',()=>{
 const {Z,wet}=oracle();const directory=mkdtempSync(join(tmpdir(),'rocut-wet-floor-math-'));const executable=join(directory,process.platform==='win32'?'math.exe':'math');
 const build=spawnSync('rustc',['--edition=2021','-Awarnings','script/fixtures/mv-wet-floor-math.rs','-o',executable],{encoding:'utf8',timeout:30000});assert.equal(build.status,0,build.stderr);
 const run=spawnSync(executable,[],{encoding:'utf8',timeout:30000});assert.equal(run.status,0,run.stderr);
 const beats=[.25,.76,1.37,1.91,2.58,3.06,3.8];const clock=Z.makeClock(beats,123,2);const puddle=wet.puddlePath();let mathIndex=-20;let checked=0;
 for(const line of run.stdout.trim().split(/\r?\n/)){const [kind,...parts]=line.split(',');const values=parts.map(Number);
  if(kind==='math'){const x=mathIndex++*.137;[Z.hash(x,71),Z.rnd(x,71),Z.noise1(x,17),Z.fbm1(x,11)].forEach((v,i)=>near(values[i],v,kind));}
  else if(kind==='count'||kind==='fall'){const [age,r,a,j]=values;const ring=(kind==='count'?wet.cntRings(age):wet.rippleRings(age,128,true)).find(v=>v.j===j);assert.ok(ring);near(r,ring.r,kind+' radius');near(a,ring.A,kind+' alpha');}
  else if(kind==='clock'){const t=values[0];near(values[1],clock.phase(t),'clock phase');near(values[2],clock.pulse(t,6),'clock pulse');assert.equal(parts[3],String(clock.inBar(t+1e-4)===0));}
  else if(kind==='puddle'){near(values[1],puddle[values[0]][0],'puddle x');near(values[2],puddle[values[0]][1],'puddle y');}
  else assert.fail('unexpected native evidence row');checked++;
 }assert.ok(checked>200);
});
test('original wetFloor plans retain irregular actual beats and strict shot boundaries',()=>{
 const {Z,wet}=oracle();Z.clock=Z.makeClock([.2,.25,.76,1.37,1.91,2.02,2.69,2.7],123,0);
 const S={args:{},shot:{id:'boundary',t0:0,t1:2}};
 assert.deepEqual(Array.from(wet.countPlan(S),d=>d.t),[.2,.25,.76,1.37,1.91,2.02,2.69]);
 assert.deepEqual(Array.from(wet.fallPlan(S),d=>d.t),[.25,.76,1.37,1.91]);
});
