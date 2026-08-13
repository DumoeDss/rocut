/**
 * Surface embedding contract — public barrel.
 *
 * Re-exports the frozen public types and the lifecycle binding constant.
 * R1 (mount/focus/lifecycle) and R2 (CSS/React/a11y) consume from this barrel.
 */

export type {
	CssNamespaceStrategy,
	EditorSurfaceProps,
	FocusMode,
	OnSurfaceReady,
	SurfaceCommitBinding,
	SurfaceLifecycleEntry,
} from "./types";

export { SurfaceLifecycleBinding } from "./types";
export { EditorSurface } from "./editor-surface";
