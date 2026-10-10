import assert from "node:assert/strict";

export function checkObjectWasm(module) {
 const results = [];
 const call = (name, input, ok) => {
  assert.equal(typeof module[name], "function", name);
  const value = JSON.parse(module[name](typeof input === "string" ? input : JSON.stringify(input)));
  assert.equal(value.version, 1); assert.equal(value.ok, ok);
  results.push({name, input, response:value}); return value;
 };
 const glass = "resolveGlassObjectParamsJson", ink = "resolveInkObjectParamsJson";
 const liquid = "resolveLiquidObjectParamsJson", frame = "evaluateLiquidObjectFrameJson";
 assert.deepEqual(call(glass,{version:1},true).params,{version:1,transmission:1,ior:1.5,thickness:0.5,roughness:0.1,dispersion:0,attenuationDistance:1000,environmentIntensity:1,color:"#ffffff"});
 assert.equal(call(glass,{version:1,roughness:0.123456789012345,ior:1.625,dispersion:0.125},true).params.roughness,0.123456789012345);
 for (const input of [{version:1,ior:9},{version:1,frameTime:1},'{"version":1,"roughness":1e999}','{"version":1,"ior":1.5,"ior":1.6}']) call(glass,input,false);
 const inkParams = call(ink,{version:1},true).params;
 assert.equal(inkParams.contourWidth,2); assert.equal(inkParams.seed,19);
 assert.equal(call(ink,{version:1,contourWidth:1.125,seed:65535},true).params.contourWidth,1.125);
 for (const input of [{version:1,seed:1.5},{version:1,seed:-1},{version:1,inkDensity:2},{version:1,time:1},'{"version":1,"seed":1,"seed":2}']) call(ink,input,false);
 const params = call(liquid,{version:1},true).params;
 assert.deepEqual(params,{version:1,enabled:true,amount:0.35,frequency:4,speed:1,twist:0.5});
 for (const input of [{version:1,amount:2},{version:1,seed:19},{version:1,time:1},'{"version":1,"speed":1e999}','{"version":1,"amount":0.2,"amount":0.3}']) call(liquid,input,false);
 const request = {version:1,params,time:0.25,seed:19,positions:[-1,-1,-1,1,1,1,1,-1,0,-1,1,0]};
 const early = call(frame,request,true).frame;
 assert.equal(early.restore,false); assert.notDeepEqual(early.positions,request.positions);
 assert(early.positions.every(Number.isFinite)); assert.equal(early.positions.length,request.positions.length);
 const late = call(frame,{...request,time:0.75},true).frame;
 assert.notDeepEqual(late.positions,early.positions);
 assert.deepEqual(call(frame,request,true).frame,early);
 for (const overrides of [{params:{...params,enabled:false}},{params:{...params,amount:0}}]) {
  assert.deepEqual(call(frame,{...request,...overrides},true).frame,{positions:request.positions,restore:true});
 }
 for (const overrides of [{seed:1.5},{seed:-1},{time:-1},{time:86401},{dt:0.1},{positions:[1,2]},{positions:[1000001,0,0]}]) call(frame,{...request,...overrides},false);
 return {ok:true,calls:results.length,results};
}
