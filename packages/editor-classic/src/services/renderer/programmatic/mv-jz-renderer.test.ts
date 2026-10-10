import {test} from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {createJzFixedReplay} from "./mv-jz-renderer";
import {MV_JZ_NATIVE_FRAMES_SOURCE} from "./mv-jz-native-transport";
import type {MotionTextCanvasContext} from "../motion-text/types";
function fixture(){
	const preset={style:"noir",layout:"center",enter:"cut",hold:"still",exit:"cut",decor:[],treat:"none",bg:"none",cam:"static",fx:[],trans:null};
	return {id:"sequence:test",schemaVersion:1,revision:3,source:{format:"plain",text:""},language:"en",duration:120000,compositionMode:"overlay",seed:7,
		engine:{id:"jizura",version:"0.9.0",catalogHash:"fixture-catalog",plannerVersion:1,tokenizerVersion:"unicode-v1"},
		fonts:[{id:"main",source:"project",family:"Test",style:"normal",weight:400,assetId:"font:test",contentDigest:"fixture"}],
		defaults:{preset,fontId:"main",colors:{background:"#010203"},parameters:{}},cues:[],resolvedPlan:{version:1,sequenceRevision:3,cuts:[]}};
}
test("JIZURA fixed existing replay keeps blank scene background and rejects out-of-domain/fallback/stale plan",()=>{
	const calls:unknown[][]=[];
	const ctx={save(){},restore(){},setTransform(){},fillRect(...v:unknown[]){calls.push(v);},fillStyle:""} as unknown as MotionTextCanvasContext;
	const replay=createJzFixedReplay(JSON.stringify(fixture()),new Map([["main",{family:"physical",style:"normal",weight:400,fingerprint:"physical-font"}]]));
	for(const ticks of [119999,0,119999])replay.draw(ctx,ticks);
	assert.equal(calls.length,3);assert.deepEqual(calls[0],[0,0,1920,1080]);assert.equal(ctx.fillStyle,"#010203");
	assert.throws(()=>replay.draw(ctx,120000),/outside/);assert.throws(()=>replay.draw(ctx,-1),/outside/);
	assert.throws(()=>createJzFixedReplay(JSON.stringify(fixture()),new Map()),/physical font/);
	const stale=fixture();stale.resolvedPlan.sequenceRevision=2;assert.throws(()=>createJzFixedReplay(JSON.stringify(stale),new Map()),/schema\/revision/);
});
test("JIZURA packet binding covers native subtrees and owns transferred bitmaps on rejection",()=>{
	class Bitmap{width=1920;height=1080;}
	const apply=runInNewContext(MV_JZ_NATIVE_FRAMES_SOURCE+";mvJzNativeFrames",{ImageBitmap:Bitmap}) as (plan:unknown,packets:unknown,owned:Set<unknown>,check:()=>void)=>Map<string,{draw(ctx:{drawImage(...v:unknown[]):void}):void}>;
	const node={kind:"jzOwnerRequest",nodeId:"shot",role:"background",request:{sequenceTicks:1}};
	const plan={root:{kind:"panels",panels:[{input:{kind:"ref",input:node}},{input:node}]}};
	const bitmap=new Bitmap(),packet={requestKey:JSON.stringify(node),bitmap,width:1920,height:1080,rgbaSha256:"a".repeat(64)},owned=new Set<unknown>();
	let active=true;const check=()=>{if(!active)throw Error("cancelled");};
	const ready=apply(plan,[packet],owned,check);assert.equal(ready.size,1);assert.equal(owned.has(bitmap),true);
	let draws=0;ready.get(packet.requestKey)!.draw({drawImage(){draws++;}});assert.equal(draws,1);
	active=false;assert.throws(()=>ready.get(packet.requestKey)!.draw({drawImage(){}}),/cancelled/);
	const rejected=new Set<unknown>();assert.throws(()=>apply(plan,[{...packet,requestKey:"wrong"}],rejected,()=>{}),/identity/);assert.equal(rejected.has(bitmap),true);
});
test("JIZURA live text replay checks the selected physical face for actual drawn glyphs",()=>{
	const source:Record<string,unknown>=fixture(),preset=fixture().defaults.preset;
	source.source={format:"plain",text:"X"};
	source.cues=[{id:"cue",text:"X",startTime:0,duration:120000,interlude:false,gapBefore:false,impact:false,emphasis:[],segments:["X"],locks:[],overrides:{}}];
	source.resolvedPlan={version:1,sequenceRevision:3,cuts:[{id:"cut",cueId:"cue",text:"X",startTime:0,duration:120000,seed:7,preset,parameters:{}}]};
	const checks:string[][]=[],calls:string[]=[];
	const data:Record<string,unknown>={font:"10px monospace",measureText:()=>({width:100}),fillText:(text:string)=>calls.push(text),strokeText:(text:string)=>calls.push(text)};
	const ctx=new Proxy(data,{get(target,p){return p in target?Reflect.get(target,p):()=>{};}}) as unknown as MotionTextCanvasContext;
	const replay=createJzFixedReplay(JSON.stringify(source),new Map([["main",{family:"physical",style:"normal",weight:400,fingerprint:"actual"}]]),(id,text)=>checks.push([id,text]));
	replay.draw(ctx,60000);
	assert.ok(calls.includes("X"));assert.ok(checks.some(([id,text])=>id==="main"&&text==="X"));
	const refusing=createJzFixedReplay(JSON.stringify(source),new Map([["main",{family:"physical",style:"normal",weight:400,fingerprint:"actual"}]]),()=>{throw Error("missing physical glyph");});
	assert.throws(()=>refusing.draw(ctx,60000),/missing physical glyph/);
});
