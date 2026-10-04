import type { TransitionClip, TransitionLink } from "opencut-wasm";
import { BaseNode, type AnyBaseNode } from "./base-node";

export type ResolvedTransitionTrackItem =
	| { type: "node"; node: AnyBaseNode; index: number }
	| {
			type: "transition";
			outgoing: AnyBaseNode[];
			incoming: AnyBaseNode[];
			progress: number;
			linkIndex: number;
	  };

export interface TransitionTrackParams {
	clips: TransitionClip[];
	links: TransitionLink[];
	/** Visibility is presentation state, not a reason to invalidate a stored link. */
	visibleClipIds: ReadonlySet<string>;
}

export class TransitionTrackNode extends BaseNode<
	TransitionTrackParams,
	ResolvedTransitionTrackItem[]
> {}
