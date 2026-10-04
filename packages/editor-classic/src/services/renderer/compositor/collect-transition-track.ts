import type { CanvasRenderer } from "../canvas-renderer";
import type { AnyBaseNode } from "../nodes/base-node";
import type { TransitionTrackNode } from "../nodes/transition-track-node";
import type { FrameItemDescriptor, TextureUploadDescriptor } from "./types";

type Context = {
	renderer: Pick<CanvasRenderer, "width" | "height">;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
};
type Collector = (args: Context & { node: AnyBaseNode }) => Promise<void>;

export async function collectTransitionTrack({
	node,
	context,
	collectNode,
}: {
	node: TransitionTrackNode;
	context: Context;
	collectNode: Collector;
}): Promise<void> {
	for (const item of node.resolved ?? []) {
		if (item.type === "node") {
			await collectNode({
				...context,
				node: item.node,
				path: context.path + ":" + item.index,
			});
			continue;
		}
		const branches = [];
		for (const children of [item.outgoing, item.incoming]) {
			const items: FrameItemDescriptor[] = [];
			for (const child of children) {
				const index = node.children.indexOf(child);
				if (index < 0)
					throw new Error("Transition branch is outside its track");
				await collectNode({
					...context,
					node: child,
					items,
					path: context.path + ":" + index,
				});
			}
			branches.push(
				items.map((item) => {
					if (item.type !== "layer")
						throw new Error(
							"Transition branches must contain picture layers only",
						);
					const { type: _type, ...layer } = item;
					return layer;
				}),
			);
		}
		context.items.push({
			type: "transition",
			outgoing: branches[0],
			incoming: branches[1],
			progress: item.progress,
		});
	}
}
