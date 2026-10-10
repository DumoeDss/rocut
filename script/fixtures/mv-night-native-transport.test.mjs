import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const text = readFileSync(new URL("../../packages/editor-classic/src/services/renderer/programmatic/mv-night-native-transport.ts", import.meta.url), "utf8");
const source = text.match(/String\.raw`([\s\S]*)`;\s*$/)[1];
class Bitmap { width = 1920; height = 1080; }
const transport = new Function("ImageBitmap", `${source};return mvNightNativeFrames;`)(Bitmap);
function key(v) { if (Array.isArray(v)) return `[${v.map(key).join(",")}]`; if(v && typeof v === "object")return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${key(v[k])}`).join(",")}}`;return JSON.stringify(v); }
const node = (id,ticks) => ({kind:"nightOwnerRequest",nodeId:"wet",role:"scene",request:{occurrenceId:id,songTicks:ticks,requiresOriginalP4Post:false}});
const packet = n => ({requestKey:key(n),bitmap:new Bitmap(),frame:{frameId:1,postRequired:false,scene:{songTicks:n.request.songTicks}}});
test("same source node at two mapped refs remains two native output occurrences",()=>{
    const a=node(1,0),b=node(2,60000), owned=new Set();
    const ready=transport({root:{kind:"transition",from:{kind:"ref",input:a},to:{kind:"ref",input:b}}},[packet(a),packet(b)],owned,()=>{});
    assert.equal(ready.size,2);assert.equal(owned.size,2);
    assert.equal(ready.getFor(a),ready.get(key(a)));
    assert.throws(()=>ready.getFor(node(3,0)));
});
test("duplicate, missing, foreign, wrong sample and missing original P4 reject",()=>{
    const a=node(1,0),b=node(2,60000),plan={root:{kind:"transition",from:a,to:b}};
    for(const packets of [[packet(a)],[packet(a),packet(a)],[packet(a),packet(node(3,60000))]])assert.throws(()=>transport(plan,packets,new Set(),()=>{}));
    const bad=packet(a);bad.frame.scene.songTicks=123;assert.throws(()=>transport({root:a},[bad],new Set(),()=>{}));
    const train=node(1,0);train.request.requiresOriginalP4Post=true;const p=packet(train);p.frame.postRequired=true;
    assert.throws(()=>transport({root:train},[p],new Set(),()=>{}));
});
