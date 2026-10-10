import { isMotionTextSequence } from "@opencut/editor-contracts";
import { createMotionTextRenderRuntime,resolveMotionTextRenderFrame } from "../motion-text/runtime";
import { drawMotionTextFrame } from "../motion-text/draw";
import { disposeCoreScreenEffectScratch } from "../motion-text/core-screen-effects";
import { disposeLooksScreenEffectScratch } from "../motion-text/looks-screen-effect-types";
import type { MotionTextCanvasContext,MotionTextResolvedFont } from "../motion-text/types";
export function createJzFixedReplay(sequenceJson:string,fonts:ReadonlyMap<string,MotionTextResolvedFont>,verifyText?:(fontId:string,text:string)=>void) {
	const value:unknown=JSON.parse(sequenceJson);
	if(!isMotionTextSequence(value)||!value.resolvedPlan||value.resolvedPlan.sequenceRevision!==value.revision)
		throw Error("JIZURA native sequence schema/revision invalid");
	const sequence={...value,compositionMode:"scene" as const};
	if(!sequence.defaults.fontId||!fonts.has(sequence.defaults.fontId)||sequence.resolvedPlan?.cuts.some(c=>c.fontId&&!fonts.has(c.fontId)))
		throw Error("JIZURA native physical font binding incomplete");
	const runtime=createMotionTextRenderRuntime({sequence,resolvedFonts:fonts,resourceFingerprint:"native-jz-admitted"});
	for(const cut of runtime.orderedCuts){const frame=resolveMotionTextRenderFrame({runtime,sequenceTime:cut.startTime});
		if(!frame||frame.diagnostics.length)throw Error("JIZURA entire saved plan must use supported presets/resources");}
	return { draw(ctx:MotionTextCanvasContext,sequenceTicks:number){
		if(!Number.isSafeInteger(sequenceTicks)||sequenceTicks<0||sequenceTicks>=sequence.duration)
			throw Error("JIZURA native clock outside sequence");
		const frame=resolveMotionTextRenderFrame({runtime,sequenceTime:sequenceTicks});
		if(!frame||frame.diagnostics.length)throw Error("JIZURA native frame requires fully supported resources/presets");
		// Existing decoration packs occasionally request generic monospace/serif.
		// In the private embedding those labels resolve to the admitted physical
		// face, not the machine's system font; native timeline behavior is unchanged.
		const families=[...fonts.values()].map(f=>f.family);
		const physical=new Proxy(ctx,{get(target,p){const value=Reflect.get(target,p,target);
			if((p==="fillText"||p==="strokeText")&&typeof value==="function")return (text:string,...args:unknown[])=>{
				const entry=[...fonts].find(([,f])=>target.font.includes(f.family));
				if(!entry)throw Error("JIZURA native drawing without physical font");verifyText?.(entry[0],text);
				return Reflect.apply(value,target,[text,...args]);};
			return typeof value==="function"?value.bind(target):value;},
			set(target,p,value){if(p==="font"&&typeof value==="string"&&!families.some(f=>value.includes(f))){
				const match=/^(.+?px)\s+(.+)$/.exec(value);if(!match)throw Error("JIZURA native invalid physical font declaration");
				value=`${match[1]} "${frame.font.family.replaceAll('"','\\"')}"`;
			}return Reflect.set(target,p,value,target);}});
		drawMotionTextFrame({ctx:physical,frame,width:1920,height:1080,compositionMode:"scene"});
	}, disposeSurface(canvas:object){disposeCoreScreenEffectScratch(canvas);disposeLooksScreenEffectScratch(canvas);} };
}
