/** @opencutSurface provider — Runtime editing catalogue and Rust/WASM policies. */
export { editingCatalog } from "./editor/transactions/opencut/editing-catalog";
export {
	openCutEditingPolicy,
	validateDocumentEditing,
} from "./editor/transactions/opencut/editing-policy";
export { openCutMediaPolicy } from "./editor/transactions/opencut/media-policy";
export { planSceneMutation } from "./editor/transactions/opencut/scene-policy";
export {
	isMusicGridAvailable,
	captureMusicGridDocument,
	verifyMusicGridSources,
	musicGridNativeFunction,
	queryMusicGrid,
	planMusicGridEdit,
	editMusicGrid,
} from "./editor/transactions/opencut/music-grid";
export {
	planMediaFolderMutation,
	isMediaFolderEditingAvailable,
} from "./editor/transactions/opencut/media-folder-policy";
export { validateCutPlan } from "./editor/transactions/opencut/cut-plan";
export { queryMediaInstanceClock } from "./editor/transactions/opencut/media-instance-clock";
