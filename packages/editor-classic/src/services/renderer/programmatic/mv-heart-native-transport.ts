import type {
	MvHeartNativeOwnerFrame,
	MvHeartPreparedImage,
	MvHeartRecipeRequestNode,
	MvRecipePlan,
	MvHeartOwnerCommand,
	MvHeartSkyCommand,
} from "@opencut/editor-contracts";

export interface HeartNativeFramePacket {
	readonly requestKey: string;
	readonly frame: MvHeartNativeOwnerFrame;
	readonly images: readonly {
		readonly image: MvHeartPreparedImage;
		readonly bitmap: ImageBitmap;
	}[];
}
/** Traverse only canonical scene edges, never authored functions or source text. */
export function heartNativeRequests(
	node: MvRecipePlan["root"],
): MvHeartRecipeRequestNode[] {
	switch (node.kind) {
		case "heartOwnerRequest":
			return [node];
		case "ref":
		case "freeze":
		case "melt":
			return heartNativeRequests(node.input);
		case "rewind":
			return node.input ? heartNativeRequests(node.input) : [];
		case "panels":
			return node.panels.flatMap((panel) => heartNativeRequests(panel.input));
		case "layers":
			return node.items.flatMap((item) => heartNativeRequests(item.input));
		case "panelsNative":
			return node.inputs.flatMap(input => input ? heartNativeRequests(input) : []);
		case "transition":
			return [
				...heartNativeRequests(node.from),
				...heartNativeRequests(node.to),
			];
		default:
			return [];
	}
}
export function heartNativePreparedImages(
	frame: MvHeartNativeOwnerFrame,
): MvHeartPreparedImage[] {
	const images = new Map<string, MvHeartPreparedImage>();
	const visit = (
		commands: readonly (MvHeartOwnerCommand | MvHeartSkyCommand)[],
	) => {
		for (const command of commands) {
			if (command.kind === "preparedImage")
				images.set(JSON.stringify(command.image), command.image);
			if (command.kind === "surface" || command.kind === "appendSurface")
				visit(command.commands);
		}
	};
	visit(frame.plan.commands);
	return [...images.values()];
}

/** Lexical factory in the fixed realm. Functions/leases never cross the port;
 * only owner-validated plans and transferred native bitmaps are transported. */
export const MV_HEART_NATIVE_FRAMES_SOURCE = String.raw`
function mvHeartNativeFrames(plan, packets, owned, check) {
  // Resource struct serialization and serde_json::Value have different key
  // order. Transport identity compares the complete value, not insertion order.
  function resourceKey(value) {
    if(Array.isArray(value))return '['+value.map(resourceKey).join(',')+']';
    if(value && typeof value==='object')return '{'+Object.keys(value).sort()
      .map(key=>JSON.stringify(key)+':'+resourceKey(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  const nodes=[];
  function visit(node) {
    if(node.kind==='heartOwnerRequest')nodes.push(node);
    else if(node.kind==='ref'||node.kind==='freeze'||node.kind==='melt')visit(node.input);
    else if(node.kind==='rewind'){if(node.input)visit(node.input);}
    else if(node.kind==='panels')for(const p of node.panels)visit(p.input);
    else if(node.kind==='layers')for(const p of node.items)visit(p.input);
    else if(node.kind==='panelsNative'){for(const input of node.inputs)if(input)visit(input);}
    else if(node.kind==='transition'){visit(node.from);visit(node.to);}
  }
  visit(plan.root);
  if(Array.isArray(packets))for(const packet of packets)if(packet && Array.isArray(packet.images))
    for(const entry of packet.images)if(entry && entry.bitmap instanceof ImageBitmap)owned.add(entry.bitmap);
  if(!nodes.length && packets===undefined)return undefined;
  if(!Array.isArray(packets)||packets.length!==new Set(nodes.map(n=>JSON.stringify(n))).size)
    throw Error('Heart native ready-frame coverage mismatch');
  const expected=new Map(nodes.map(n=>[JSON.stringify(n),n])), ready=new Map();
  for(const packet of packets) {
    check();
    if(!packet||!Array.isArray(packet.images))throw Error('Invalid Heart native frame packet');
    const node=expected.get(packet.requestKey);
    if(!node||ready.has(packet.requestKey)||!packet.frame||!packet.frame.plan||!packet.frame.identity)
      throw Error('Heart native frame request identity mismatch');
    const isSky=node.request.frame.scene.kind==='skyShatter';
    if(isSky!==(packet.frame.kind==='skyShatter'))throw Error('Heart native frame variant mismatch');
    if(resourceKey(packet.frame.identity.binding.source)!==resourceKey(node.request.source))
      throw Error('Heart native frame source binding mismatch');
    const images=new Map();
    for(const entry of packet.images) {
      const id=JSON.stringify(entry.image), bitmap=entry.bitmap;
      if(!entry.image||images.has(id)||!(bitmap instanceof ImageBitmap)||bitmap.width!==entry.image.width||bitmap.height!==entry.image.height)
        throw Error('Heart native prepared image identity/dimensions mismatch');
      images.set(id,bitmap);
    }
    ready.set(packet.requestKey,Object.freeze({status:'readyNativeOwner',frame:packet.frame,
      preparedImage(image){check();const bitmap=images.get(JSON.stringify(image));if(!bitmap)throw Error('Heart native prepared image is not owned');return bitmap;}}));
  }
  return ready;
}
`;
