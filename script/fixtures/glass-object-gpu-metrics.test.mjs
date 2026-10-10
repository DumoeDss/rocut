import assert from "node:assert/strict";
import test from "node:test";
import {acceptGlassGpu,glassPixelDifference} from "./glass-object-gpu-metrics.mjs";
test("independent pixel gates reject no-op controls and opaque background leakage",()=>{
 const yes={mean:12,changed:50},zero={mean:0,changed:0};
 const metrics={backgroundTransmission:yes,backgroundOpaque:zero,roughness:yes,thickness:yes,ior:yes,motion:yes,reverseSeek:zero};
 assert(acceptGlassGpu(metrics));
 for(const name of ["backgroundTransmission","roughness","thickness","ior","motion"])assert.throws(()=>acceptGlassGpu({...metrics,[name]:zero}));
 assert.throws(()=>acceptGlassGpu({...metrics,backgroundOpaque:yes}));
 assert.throws(()=>acceptGlassGpu({...metrics,reverseSeek:yes}));
});
test("ROI difference is exact and excludes unrelated outside pixels",()=>{
 const a=new Uint8Array(100*100*4),b=new Uint8Array(a);b[0]=255;
 assert.equal(glassPixelDifference(a,b,100,100).mean,0);
 b[(50*100+50)*4]=120;assert(glassPixelDifference(a,b,100,100).mean>0);
 assert.throws(()=>glassPixelDifference(a,b,20,20));
});
