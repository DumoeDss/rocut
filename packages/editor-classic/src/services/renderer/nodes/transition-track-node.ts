import type { TransitionClip, TransitionLink } from "opencut-wasm";
import type { FrameTransitionStyle } from "../compositor/types";
import { BaseNode, type AnyBaseNode } from "./base-node";

export type ResolvedTransitionTrackItem =
	| { type: "node"; node: AnyBaseNode; index: number }
	| {
			type: "transition";
			outgoing: AnyBaseNode[];
			incoming: AnyBaseNode[];
			progress: number;
			linkIndex: number;
			style?: FrameTransitionStyle;
	  };

export interface TransitionTrackParams {
	clips: TransitionClip[];
	links: TransitionLink[];
	/** Presentation style never changes the authoritative Rust sampling graph. */
	styles?: ReadonlyMap<number, FrameTransitionStyle>;
	/** Visibility is presentation state, not a reason to invalidate a stored link. */
	visibleClipIds: ReadonlySet<string>;
}

export class TransitionTrackNode extends BaseNode<
	TransitionTrackParams,
	ResolvedTransitionTrackItem[]
> {}
