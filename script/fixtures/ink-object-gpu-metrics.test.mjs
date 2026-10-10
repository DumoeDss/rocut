import assert from "node:assert/strict";
import test from "node:test";
import {acceptInkGpu,inkPixelDifference} from "./ink-object-gpu-metrics.mjs";
test("independent ink gates reject copied/no-op parameter and input captures",()=>{
 const positive={mean:10,changed:120},zero={mean:0,changed:0};
 const metrics=Object.fromEntries(["inkColor","density","paperTexture","paperScale","seed","map","normalMap","motion","contour"].map(name=>[name,positive]));metrics.reverseSeek=zero;
 assert(acceptInkGpu(metrics));for(const name of Object.keys(metrics))assert.throws(()=>acceptInkGpu({...metrics,[name]:name==="reverseSeek"?positive:zero}));
});
test("center and contour regions exclude unrelated outside pixels",()=>{
 const a=new Uint8Array(100*100*4),b=new Uint8Array(a);b[0]=255;assert.equal(inkPixelDifference(a,b,100,100).mean,0);
 b[(50*100+50)*4]=120;assert(inkPixelDifference(a,b,100,100).mean>0);assert.throws(()=>inkPixelDifference(a,b,1,1));
});
