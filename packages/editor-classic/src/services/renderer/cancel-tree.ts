import type { AnyBaseNode } from "./nodes/base-node";

/** Keep teardown independent of concrete renderers (and their GPU imports). */
export function cancelPendingRenderFrames(node: AnyBaseNode | null): void {
	if (!node) return;
	if (
		"cancelPendingFrames" in node &&
		typeof node.cancelPendingFrames === "function"
	) {
		node.cancelPendingFrames();
	}
	for (const child of node.children ?? []) cancelPendingRenderFrames(child);
}
