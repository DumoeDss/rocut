import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { HEART_SPRITE_READBACK_CONTROL_SOURCE } from "./mv-heart-sprite-diagnostic-readback";

test("controlled Char scheduling reads only after actual publication and shares one unread body per pair", () => {
	const events: string[] = [];
	const context = createContext({ events });
	runInContext(HEART_SPRITE_READBACK_CONTROL_SOURCE + String.raw`
  const body={kind:'surface',id:'body',commands:[{kind:'preparedImage'}]};
  const command={kind:'surface',commands:Array.from({length:6},()=>({kind:'path'}))};
  let sequence=0,cleanups=0;
  function* drawMvEmberSteps(ctx,data,assets,createSurface) {
    let liveBody;
    try {
      for(const [index,surface] of data.commands.entries()) {
        const canvas=createSurface(2,2);canvas.id=sequence++;canvas.arm=index;canvas.published=false;
        if(index===0)liveBody=canvas;
        else canvas.sourceBody=liveBody;
        for(const child of surface.commands){events.push('child/'+canvas.id);yield;}
        canvas.published=true;events.push('publish/'+canvas.id);yield;
      }
    } finally {cleanups++;}
  }
  const make=(w,h)=>({width:w,height:h,getContext:()=>({})});
  const counts=new Map(),readOrder=[];
  const pixels=c=>{
    if(c.id!==undefined){const n=counts.get(c.id)||0;counts.set(c.id,n+1);readOrder.push({id:c.id,arm:c.arm,published:c.published,bodyId:c.sourceBody?.id});}
    return new Uint8ClampedArray([0,0,0,0]);
  };
  const result=heartControlledCharReadback({body,command,preparedImage:()=>{},original:{},originalBody:{},pixels,
    diff:()=>({max:0,changed:0}),make});
  globalThis.inspection={result,readOrder,cleanups};
  `, context);
	const inspection: unknown = runInContext("inspection", context);
	expect(inspection).toEqual({
		result: {
			available: true, shard: 0, variant: "char",
			scope: "same native prepared-image handle and one unread live body per counterbalanced pair; no causal conclusion about acceptance realm",
			experiments: [
				{ order: ["publishOnly", "perYield"], sharedNativeBody: true, noBodyReadBeforeBothChars: true,
					bodyPublishYield: 2, charPublishYields: [9, 16], readCounts: { publishOnly: 1, perYield: 7, body: 1 },
					publishOnlyVsOriginal: { max: 0, changed: 0 }, perYieldVsOriginal: { max: 0, changed: 0 },
					publishOnlyVsPerYield: { max: 0, changed: 0 }, bodyRgbaBytes: 4, bodyDifference: { max: 0, changed: 0 } },
				{ order: ["perYield", "publishOnly"], sharedNativeBody: true, noBodyReadBeforeBothChars: true,
					bodyPublishYield: 2, charPublishYields: [9, 16], readCounts: { publishOnly: 1, perYield: 7, body: 1 },
					publishOnlyVsOriginal: { max: 0, changed: 0 }, perYieldVsOriginal: { max: 0, changed: 0 },
					publishOnlyVsPerYield: { max: 0, changed: 0 }, bodyRgbaBytes: 4, bodyDifference: { max: 0, changed: 0 } },
			],
		},
		readOrder: [
			{ id: 1, arm: 1, published: true, bodyId: 0 },
			...Array.from({ length: 7 }, (_, index) => ({ id: 2, arm: 2, published: index === 6, bodyId: 0 })),
			{ id: 0, arm: 0, published: true, bodyId: undefined },
			...Array.from({ length: 7 }, (_, index) => ({ id: 4, arm: 1, published: index === 6, bodyId: 3 })),
			{ id: 5, arm: 2, published: true, bodyId: 3 },
			{ id: 3, arm: 0, published: true, bodyId: undefined },
		],
		cleanups: 2,
	});
});

test("controlled scheduling marks Char unavailable rather than inventing a substitute", () => {
	const context = createContext({});
	runInContext(HEART_SPRITE_READBACK_CONTROL_SOURCE, context);
	expect(runInContext("heartControlledCharReadback({body:{},command:null})", context)).toEqual({
		available: false, reason: "No Char command in the actual frame",
	});
});
