import type { BlendMode } from "../../../rendering";
import type { EffectPass } from "../../../effects/types";
import { BaseNode } from "./base-node";

/** Resolved renderer transport, not an authored timeline/track-group schema.
 * Children share an isolated transparent backdrop; post and opacity run once
 * after all children. Rust owns graph admission, composition and effect order. */
export type IsolatedGroupNodeParams = {
	effectPassGroups: EffectPass[][];
	opacity: number;
	blendMode: BlendMode;
};

export class IsolatedGroupNode extends BaseNode<IsolatedGroupNodeParams> {}
