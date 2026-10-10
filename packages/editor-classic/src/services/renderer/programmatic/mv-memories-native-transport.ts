import type { MvRecipePlan } from "@opencut/editor-contracts";
import type { MvMemoriesRecipeRequestNode } from "../../../../../editor-contracts/src/mv-memories-recipe";
export type MemoriesNativeFramePacket = { requestKey: string; bitmap: ImageBitmap; width: 1920; height: 1080; rgbaSha256: string };
export function memoriesNativeRequests(node: MvRecipePlan["root"]): MvMemoriesRecipeRequestNode[] {
	if (node.kind === "memoriesOwnerRequest") return [node];
	if (node.kind === "ref" || node.kind === "freeze" || node.kind === "melt") return memoriesNativeRequests(node.input);
	if (node.kind === "rewind") return node.input ? memoriesNativeRequests(node.input) : [];
	if (node.kind === "panels") return node.panels.flatMap(p => memoriesNativeRequests(p.input));
	if (node.kind === "layers") return node.items.flatMap(p => memoriesNativeRequests(p.input));
	if (node.kind === "panelsNative") return node.inputs.flatMap(input => input ? memoriesNativeRequests(input) : []);
	if (node.kind === "transition") return [...memoriesNativeRequests(node.from), ...memoriesNativeRequests(node.to)];
	return [];
}
/** Full native frame is baked with the fixed production replay while the owner
 * publication is alive. Only the resulting bitmap crosses the native port. */
export const MV_MEMORIES_NATIVE_FRAMES_SOURCE = String.raw`
function mvMemoriesNativeFrames(plan,packets,owned,check) {
  const expected=new Map();
  function visit(n){if(n.kind==='memoriesOwnerRequest')expected.set(JSON.stringify(n),n);
    else if(n.kind==='ref'||n.kind==='freeze'||n.kind==='melt')visit(n.input);else if(n.kind==='rewind'){if(n.input)visit(n.input);}else if(n.kind==='panels')for(const p of n.panels)visit(p.input);
    else if(n.kind==='panelsNative'){for(const input of n.inputs)if(input)visit(input);}
    else if(n.kind==='layers')for(const p of n.items)visit(p.input);
    else if(n.kind==='transition'){visit(n.from);visit(n.to);}}
  visit(plan.root);
  if(Array.isArray(packets))for(const p of packets)if(p&&p.bitmap instanceof ImageBitmap)owned.add(p.bitmap);
  if(!expected.size&&packets===undefined)return undefined;
  if(!Array.isArray(packets)||packets.length!==expected.size)throw Error('Memories native frame coverage mismatch');
  const ready=new Map();
  for(const p of packets){check();
    if(!p||!expected.has(p.requestKey)||ready.has(p.requestKey)||!(p.bitmap instanceof ImageBitmap)
      ||p.width!==1920||p.height!==1080||p.bitmap.width!==p.width||p.bitmap.height!==p.height
      ||typeof p.rgbaSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.rgbaSha256))
      throw Error('Memories native frame identity/dimensions mismatch');
    ready.set(p.requestKey,Object.freeze({status:'readyNativeOwner',draw(ctx){check();ctx.drawImage(p.bitmap,0,0);}}));
  }
  return ready;
}
`;
