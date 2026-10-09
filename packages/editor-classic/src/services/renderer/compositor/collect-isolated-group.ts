import type { CanvasRenderer } from "../canvas-renderer";
import type { AnyBaseNode } from "../nodes/base-node";
import type { IsolatedGroupNode } from "../nodes/isolated-group-node";
import type { FrameItemDescriptor, TextureUploadDescriptor } from "./types";

type Context = {
	renderer: Pick<CanvasRenderer, "width" | "height">;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
};

export async function collectIsolatedGroup({
	node,
	context,
	collectNode,
}: {
	node: IsolatedGroupNode;
	context: Context;
	collectNode: (args: Context & { node: AnyBaseNode }) => Promise<void>;
}): Promise<void> {
	const items: FrameItemDescriptor[] = [];
	for (const [index, child] of node.children.entries()) {
		await collectNode({
			...context,
			node: child,
			items,
			path: `${context.path}:group:${index}`,
		});
	}
	context.items.push({
		type: "group",
		items,
		effectPassGroups: node.params.effectPassGroups,
		opacity: node.params.opacity,
		blendMode: node.params.blendMode,
	});
}
