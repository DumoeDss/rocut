import type { AnyBaseNode } from "./nodes/base-node";
import type { RenderResidencyDomain } from "./render-residency-domain";

/** Keep teardown independent of concrete renderers (and their GPU imports). */
// eslint-disable-next-line opencut/prefer-object-params -- preserve the established recursive tree teardown entry point.
export function cancelPendingRenderFrames(
	node: AnyBaseNode | null,
	options?: { rasterResidencyDomain: RenderResidencyDomain },
): void {
	if (!node) return;
	options?.rasterResidencyDomain.closeTree(node);
	if (
		"cancelPendingFrames" in node &&
		typeof node.cancelPendingFrames === "function"
	) {
		node.cancelPendingFrames();
	}
	for (const child of node.children ?? []) cancelPendingRenderFrames(child);
}
