import { MV_MEMORIES_RENDERER_SOURCE } from "./mv-memories-renderer";

/** Embed once in the trusted native realm's lexical scope. Call the zero-arg
 * factory there and pass its result as createMemoriesNativePlatform's replay.
 * This is fixed shipped code; project JSON cannot supply source or functions.
 * No eval, global function lookup, or transferable function identity is needed. */
export const MV_MEMORIES_NATIVE_REPLAY_SOURCE =
	MV_MEMORIES_RENDERER_SOURCE +
	String.raw`
function createMvMemoriesReplay() {
  return Object.freeze({draw:drawMvMemories,measure:measureMvMemoriesFonts});
}
`;
