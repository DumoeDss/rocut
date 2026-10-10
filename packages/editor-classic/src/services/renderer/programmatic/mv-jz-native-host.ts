import * as wasm from "opencut-wasm";
import type { MvRecipePlan,ProgrammaticResource } from "@opencut/editor-contracts";
import type { HeartNativeImageInput } from "./mv-heart-native-pixels";
import { key } from "./mv-heart-owner-provider-protocol";
import { digest } from "./mv-memories-owner-protocol";
import { jzNativeRequests,type JzNativeFramePacket } from "./mv-jz-native-transport";
import { createJzFixedReplay } from "./mv-jz-renderer";
import type { MotionTextResolvedFont } from "../motion-text/types";
import { createJzNativeOwner } from "./mv-jz-owner-api";
import { readJzNativeBytes } from "./mv-jz-binary";
export async function prepareJzNativeFrames({plan,input,signal}:{plan:MvRecipePlan;input:HeartNativeImageInput;signal?:AbortSignal}) {
	signal?.throwIfAborted();const nodes=jzNativeRequests(plan.root);if(!nodes.length)return undefined;
	if(nodes.length>4)throw Error("JIZURA native expanded session limit exceeded");
	const host=nodes[0]!.request.host;
	if(!host||host.maxLiveSessions!==nodes.length||nodes.some(n=>key(n.request.host)!==key(host)))throw Error("JIZURA complete graph host reservation required");
	const owner=createJzNativeOwner(Reflect.get(wasm,"MvJzOwner")),transfers:ImageBitmap[]=[],faces:FontFace[]=[];
	let disposed=false;
	const dispose=async()=>{if(disposed)return;disposed=true;for(const bitmap of transfers)bitmap.close();for(const face of faces)document.fonts.delete(face);try{owner.dispose();}finally{owner.free();}};
	const bytes=(r:ProgrammaticResource)=>readJzNativeBytes({resources:input.resources,resource:r,signal});
	try{
		const packets:JzNativeFramePacket[]=[],seen=new Set<string>();
		for(const node of nodes){const requestKey=JSON.stringify(node);if(seen.has(requestKey))continue;seen.add(requestKey);
			const r=node.request,parts=[bytes(r.sequence),...r.fonts.map(f=>bytes(f.resource))];
			let offset=0;const ranges=parts.map(part=>{const range={offset,length:part.byteLength};offset+=part.byteLength;return range;});
			if(offset>64*1024*1024)throw Error("JIZURA ingress exceeds bound");
			const packet=new Uint8Array(offset);for(let i=0;i<parts.length;i++)packet.set(parts[i]!,ranges[i]!.offset);
			const session=owner.prepare(JSON.stringify({request:r,sequence:ranges[0],fonts:r.fonts.map((font,i)=>({font,encoded:ranges[i+1]}))}),packet);
			const firstFace=faces.length;
			const prepared:unknown=JSON.parse(owner.preparedJson(session));
			if(!prepared||typeof prepared!=="object"||!("sequenceJson" in prepared)||typeof prepared.sequenceJson!=="string")throw Error("Invalid JIZURA owner preparation");
			const fonts=new Map<string,MotionTextResolvedFont>();
			for(let i=0;i<r.fonts.length;i++){signal?.throwIfAborted();const f=r.fonts[i]!,d=f.resource.font;if(!d)throw Error("JIZURA physical font descriptor absent");
				const family=`__mv_jz_${f.resource.sha256}_${session}_${i}`;
				const face=new FontFace(family,parts[i+1]!.slice().buffer,{style:d.style,weight:String(d.weight),variationSettings:Object.entries(d.axes??{}).map(([tag,v])=>`"${tag}" ${v}`).join(",")||"normal"});
				await face.load();faces.push(face);signal?.throwIfAborted();document.fonts.add(face);
				fonts.set(f.fontId,{family,style:d.style,weight:d.weight,fingerprint:key(f.resource)});
			}
			const replay=createJzFixedReplay(prepared.sequenceJson,fonts,(id,text)=>owner.checkText(session,id,text)),canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;
			let serial:number|undefined;
			try{const frame:unknown=JSON.parse(owner.frame(session,JSON.stringify(r)));
				if(!frame||typeof frame!=="object"||!("serial" in frame)||typeof frame.serial!=="number"||!("sequenceTicks" in frame)||frame.sequenceTicks!==r.sequenceTicks)throw Error("Invalid JIZURA owner frame binding");serial=frame.serial;
				const ctx=canvas.getContext("2d",{colorSpace:"srgb",willReadFrequently:true});if(!ctx)throw Error("JIZURA native Canvas2D unavailable");
				replay.draw(ctx,r.sequenceTicks);signal?.throwIfAborted();
				const rgbaSha256=await digest(new Uint8Array(ctx.getImageData(0,0,1920,1080).data.buffer));signal?.throwIfAborted();
				const bitmap=await createImageBitmap(canvas);transfers.push(bitmap);signal?.throwIfAborted();packets.push({requestKey,bitmap,width:1920,height:1080,rgbaSha256});
			}finally{replay.disposeSurface(canvas);canvas.width=canvas.height=1;if(serial!==undefined)owner.finishFrame(session,serial);}
			for(const face of faces.splice(firstFace))document.fonts.delete(face);
			owner.release(session);
		}
		return {packets,transfers,rasterByteLimit:host.rasterByteLimit,dispose};
	}catch(error){await dispose();throw error;}
}
