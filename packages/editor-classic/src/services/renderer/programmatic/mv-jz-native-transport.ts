import type { MvRecipePlan } from "@opencut/editor-contracts";
import type { MvJzRequestNode } from "../../../../../editor-contracts/src/mv-jz";
export type JzNativeFramePacket = {requestKey:string;bitmap:ImageBitmap;width:1920;height:1080;rgbaSha256:string};
export function jzNativeRequests(node:MvRecipePlan["root"]):MvJzRequestNode[] {
	if (node.kind === "jzOwnerRequest") return [node];
	if (node.kind === "ref"||node.kind === "freeze"||node.kind === "melt") return jzNativeRequests(node.input);
	if (node.kind === "rewind") return node.input?jzNativeRequests(node.input):[];
	if (node.kind === "panels") return node.panels.flatMap(p=>jzNativeRequests(p.input));
	if (node.kind === "layers") return node.items.flatMap(p=>jzNativeRequests(p.input));
	if (node.kind === "panelsNative") return node.inputs.flatMap(input=>input?jzNativeRequests(input):[]);
	if (node.kind === "transition") return [...jzNativeRequests(node.from),...jzNativeRequests(node.to)];
	return [];
}
export const MV_JZ_NATIVE_FRAMES_SOURCE = String.raw`
function mvJzNativeFrames(plan,packets,owned,check){
 const expected=new Map();function visit(n){if(n.kind==='jzOwnerRequest')expected.set(JSON.stringify(n),n);
 else if(n.kind==='ref'||n.kind==='freeze'||n.kind==='melt'||n.kind==='rewind'){if(n.input)visit(n.input);}else if(n.kind==='panels')for(const p of n.panels)visit(p.input);
 else if(n.kind==='panelsNative'){for(const input of n.inputs)if(input)visit(input);}
 else if(n.kind==='layers')for(const p of n.items)visit(p.input);
 else if(n.kind==='transition'){visit(n.from);visit(n.to);}}visit(plan.root);
 if(Array.isArray(packets))for(const p of packets)if(p&&p.bitmap instanceof ImageBitmap)owned.add(p.bitmap);
 if(!expected.size&&packets===undefined)return undefined;
 if(!Array.isArray(packets)||packets.length!==expected.size)throw Error('JIZURA native packet coverage mismatch');
 const ready=new Map();for(const p of packets){check();
 if(!p||!expected.has(p.requestKey)||ready.has(p.requestKey)||!(p.bitmap instanceof ImageBitmap)
 ||p.width!==1920||p.height!==1080||p.bitmap.width!==1920||p.bitmap.height!==1080
 ||typeof p.rgbaSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.rgbaSha256))throw Error('JIZURA native packet identity mismatch');
 ready.set(p.requestKey,Object.freeze({status:'readyNativeOwner',draw(ctx){check();ctx.drawImage(p.bitmap,0,0);}}));}
 return ready;
}
`;
