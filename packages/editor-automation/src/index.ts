/**
 * @opencutSurface experimental — the S06 automation integration layer; the 0.x
 * surface may move until the host-start shape ratifies
 */
export {
	createAutomation,
	permissiveDraftRetentionPolicy,
} from "./automation";
export type {
	AutomationApi,
	AutomationDependencies,
	AutomationDraftOptions,
} from "./automation";
