#!/usr/bin/env node
/** Actual isolated binary gate; no shared installation. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {parseArgs} from "node:util";
const {values}=parseArgs({options:{"out-dir":{type:"string"}}});
assert.ok(values["out-dir"]);
const out=resolve(values["out-dir"]),binary=new WebAssembly.Module(readFileSync(join(out,"opencut_wasm_bg.wasm")));
assert.ok(WebAssembly.Module.exports(binary).some(e=>e.name==="queryMediaInstanceClockJson"));
const native=await import(pathToFileURL(join(out,"opencut_wasm_sync.js")).href);
const document={revision:3,project:{id:"project",sceneState:{currentSceneId:"main",scenes:[{id:"main",isMain:true},{id:"other",isMain:false}]}},tracks:[{id:"track",sceneId:"other"}],clips:[{id:"clip",trackId:"track",assetId:"video",startTime:120000,duration:120000,trimStart:120000,trimEnd:0}],assets:[{id:"video",kind:"video",sourceSha256:"a".repeat(64),duration:360000}]};
const frames=Array.from({length:90},(_,i)=>({ptsMicroseconds:Math.round(i*1e6/30),durationMicroseconds:Math.round((i+1)*1e6/30)-Math.round(i*1e6/30)}));
const request={expectedNativeRevision:3,nativeProjectId:"project",sceneId:"other",clipId:"clip",sourceSha256:"a".repeat(64),sceneTick:180000,decodedEndMicroseconds:3000000,timestampToleranceMicroseconds:2,frames,director:{rangeStartTick:48000,rangeEndTick:192000,fps:30,totalFrames:90}};
const query=()=>JSON.parse(native.queryMediaInstanceClockJson(JSON.stringify({document,request})));
let result=query();assert.equal(result.status,"ready",JSON.stringify(result));assert.equal(result.frame.index,45);assert.equal(result.director.tick,120000);assert.equal(result.projectGlobal.status,"not-asserted");
document.clips[0].retime={rate:1,reverse:true};result=query();assert.equal(result.source.tick,179999);assert.equal(result.frame.index,44);
document.clips[0].freezeFrame=160001;assert.equal(query().source.tick,160001);
request.sceneTick=240000;assert.equal(query().reason,"media-instance-query-outside-half-open-clip");request.sceneTick=180000;
request.expectedNativeRevision=2;assert.equal(query().status,"conflict");
console.info("media-instance WASM: binary/JS exports, nonactive scene, Native trim/reverse/freeze, containing frames, Director range and revision/half-open guards passed");
