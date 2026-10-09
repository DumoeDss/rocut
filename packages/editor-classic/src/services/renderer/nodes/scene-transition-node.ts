import { BaseNode } from "./base-node";

/** Resolved scene-picture crossfade transport, not authored timeline state.
 * Children must be the outgoing and incoming IsolatedGroupNode respectively.
 * Generic tree resolution/cancellation visits both branches, including endpoints.
 * Rust owns branch composition, progress admission and once-only group opacity.
 */
export class SceneTransitionNode extends BaseNode<{ progress: number }> {}
