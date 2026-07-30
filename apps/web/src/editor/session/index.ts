/**
 * The editor session runtime — entry point.
 *
 * Nothing in the running editor imports this yet. That is the point of a freeze:
 * the shape is settled and testable before six children build on it.
 */
export type {
	CreateEditorSessionArgs,
} from "./create-session";
export { createEditorSession } from "./create-session";
export type {
	DisposalReport,
	GpuResourceHandle,
	ResourceClassReport,
	SessionResourceClass,
	SessionResourceRef,
	SessionResources,
	TimerHandle,
} from "./resources";
export { SESSION_RESOURCE_CLASSES } from "./resources";
export { createSessionResources } from "./session-resources";
export type {
	EditorSession,
	EditorSessionRootHandle,
	EditorSessionSnapshot,
	RootState,
	SessionReadSurface,
	SessionState,
	SessionSubscription,
} from "./session-types";
