import type { MvRecipePlan } from "../../../../../editor-contracts/src/mv-recipe-plan";
import type { MvNightPreparationRequest } from "../../../../../editor-contracts/src/mv-night";
import type { NightFrame } from "./mv-night-native";
export interface NightRequestNode {
    readonly kind: "nightOwnerRequest";
    readonly nodeId: string;
    readonly role: string;
    readonly request: MvNightPreparationRequest;
}
export interface NightNativeFramePacket { readonly requestKey: string; readonly frame: NightFrame; readonly bitmap: ImageBitmap }
export function nightNativeRequests(node: MvRecipePlan["root"]): NightRequestNode[] {
    // Public union registration is owned by the root integrator.
    if ((node as {kind:string}).kind === "nightOwnerRequest") return [node as unknown as NightRequestNode];
    switch (node.kind) {
        case "ref": return nightNativeRequests(node.input);
        case "freeze": case "melt": return nightNativeRequests(node.input);
        case "rewind": return node.input ? nightNativeRequests(node.input) : [];
        case "panels": return node.panels.flatMap(panel => nightNativeRequests(panel.input));
        case "layers": return node.items.flatMap(item => nightNativeRequests(item.input));
        case "panelsNative": return node.inputs.flatMap(input => input ? nightNativeRequests(input) : []);
        case "transition": return [...nightNativeRequests(node.from), ...nightNativeRequests(node.to)];
        default: return [];
    }
}
export const MV_NIGHT_NATIVE_FRAMES_SOURCE = String.raw`
function mvNightNativeFrames(plan, packets, owned, check) {
  function key(v){if(Array.isArray(v))return '['+v.map(key).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+key(v[k])).join(',')+'}';return JSON.stringify(v);}
  const nodes=[];function visit(n){if(n.kind==='nightOwnerRequest')nodes.push(n);else if(n.kind==='ref'||n.kind==='freeze'||n.kind==='melt')visit(n.input);else if(n.kind==='rewind'){if(n.input)visit(n.input);}else if(n.kind==='panels')for(const p of n.panels)visit(p.input);else if(n.kind==='layers')for(const p of n.items)visit(p.input);else if(n.kind==='panelsNative'){for(const input of n.inputs)if(input)visit(input);}else if(n.kind==='transition'){visit(n.from);visit(n.to);}}
  visit(plan.root);
  if(Array.isArray(packets))for(const p of packets)if(p&&p.bitmap instanceof ImageBitmap)owned.add(p.bitmap);
  if(!nodes.length&&packets===undefined)return undefined;
  if(!Array.isArray(packets)||packets.length!==nodes.length)throw Error('Night native occurrence coverage mismatch');
  const expected=new Map(nodes.map(n=>[key(n),n])),ready=new Map();
  for(const p of packets){check();const n=expected.get(p.requestKey),f=p.frame;
    if(!n||ready.has(p.requestKey)||!(p.bitmap instanceof ImageBitmap)||p.bitmap.width!==1920||p.bitmap.height!==1080||!f||!f.scene||f.scene.songTicks!==n.request.songTicks||f.postRequired!==n.request.requiresOriginalP4Post||!Number.isSafeInteger(f.frameId)||f.frameId<1)throw Error('Night native frame identity mismatch');
    if(f.postRequired&&(!f.post||!f.lut||f.lut.alias!=='P4'))throw Error('Night original P4 post missing');
    ready.set(p.requestKey,Object.freeze({status:'readyNativeOwner',frame:f,bitmap:p.bitmap}));
  }
  Object.defineProperty(ready,'getFor',{value(node){check();const id=key(node);if(!expected.has(id))throw Error('Night node is outside prepared graph');return ready.get(id);}});
  return ready;
}
`;
