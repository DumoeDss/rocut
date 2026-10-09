import type { CanvasRenderer } from "../canvas-renderer";
import type { AnyBaseNode } from "../nodes/base-node";
import { IsolatedGroupNode } from "../nodes/isolated-group-node";
import type { SceneTransitionNode } from "../nodes/scene-transition-node";
import type {
	FrameGroupDescriptor,
	FrameItemDescriptor,
	TextureUploadDescriptor,
} from "./types";

type Context = {
	renderer: Pick<CanvasRenderer, "width" | "height">;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
};

export async function collectSceneTransition({
	node,
	context,
	collectNode,
}: {
	node: SceneTransitionNode;
	context: Context;
	collectNode: (args: Context & { node: AnyBaseNode }) => Promise<void>;
}): Promise<void> {
	if (
		node.children.length !== 2 ||
		node.children.some((child) => !(child instanceof IsolatedGroupNode))
	)
		throw Error("Scene transition requires two isolated group children");
	const branches: FrameGroupDescriptor[] = [];
	for (const [index, side] of ["outgoing", "incoming"].entries()) {
		const items: FrameItemDescriptor[] = [];
		await collectNode({
			...context,
			node: node.children[index],
			items,
			path: `${context.path}:${side}`,
		});
		if (items.length !== 1 || items[0].type !== "group")
			throw Error("Scene transition collector lost its isolated branch");
		const { type: _type, ...group } = items[0];
		branches.push(group);
	}
	context.items.push({
		type: "sceneTransition",
		outgoing: branches[0],
		incoming: branches[1],
		progress: node.params.progress,
	});
}
