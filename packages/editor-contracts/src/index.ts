/**
 * The transaction contract — a Host-neutral typed surface for querying and
 * modifying project content.
 *
 * This is the single entry point. Import from `@/editor/contracts` (or the
 * relative equivalent) — never from individual modules.
 *
 * The contract wires nothing. Commands keep committing exactly as they do today.
 * T1/T3 connect the real engine behind these types at the seam.
 */
export type {
	// MediaTime
	MediaTime,
	// FrameRate
	FrameRate,
	// Branded IDs
	TrackId,
	ClipId,
	AssetId,
	MarkerId,
	ProjectId,
	// Entity interfaces
	TrackKind,
	AssetKind,
	Project,
	Track,
	Clip,
	Asset,
	Marker,
} from "./domain";

export {
	// MediaTime
	TICKS_PER_SECOND,
	mediaTime,
	ticksOf,
	// FrameRate
	validateFrameRate,
	frameRate,
	// Branded ID constructors
	trackId,
	clipId,
	assetId,
	markerId,
	projectId,
} from "./domain";

export type {
	ProjectPatch,
	UpdateProjectOperation,
	CreateMotionTextSequenceOperation,
	UpdateMotionTextSequenceOperation,
	DeleteMotionTextSequenceOperation,
	TransactionOperation,
	OperationKind,
} from "./operations";
export { OPERATION_KINDS } from "./operations";

export type {
	Revision,
	TransactionBatch,
	TransactionResult,
	TransactionErrorCode,
} from "./transaction";
export { TransactionError, revisionOf, INITIAL_REVISION } from "./transaction";

export type {
	MotionTextSequenceId,
	MotionTextCueId,
	MotionTextCutId,
	MotionTextFontId,
	MotionTextSourceFormat,
	MotionTextSource,
	MotionTextEngineRef,
	MotionTextAudioAnalysisRef,
	MotionTextAudioBinding,
	MotionTextFontSource,
	MotionTextFontAssetRef,
	MotionTextParameterValue,
	MotionTextPresetSetControls,
	MotionTextCenterDirection,
	MotionTextPlanningControls,
	MotionTextPresetGroup,
	MotionTextPresetSelection,
	MotionTextOverrides,
	MotionTextDefaults,
	MotionTextLock,
	MotionTextCue,
	MotionTextResolvedCut,
	MotionTextResolvedPlan,
	MotionTextSequence,
	MotionTextClipContent,
	MotionTextValidationIssue,
	MotionTextValidationOptions,
} from "./motion-text";
export {
	MOTION_TEXT_SCHEMA_VERSION,
	MOTION_TEXT_PLAN_VERSION,
	MOTION_TEXT_LIMITS,
	DEFAULT_MOTION_TEXT_PLANNING_CONTROLS,
	motionTextSequenceId,
	motionTextCueId,
	motionTextCutId,
	motionTextFontId,
	validateMotionTextSequence,
	isMotionTextSequence,
} from "./motion-text";
export type {
	MotionTextPlannerResolvedCutWire,
	MotionTextPlannerPlanWire,
} from "./motion-text-planner";
export { motionTextResolvedPlanFromPlanner } from "./motion-text-planner";

export type {
	TransactionRead,
	TransactionApply,
	TransactionGetContext,
	TransactionWatch,
} from "./interfaces";

export { createInMemoryTransactionStore } from "./in-memory";
export type { InMemoryTransactionStore } from "./in-memory";

export {
	runTransactionConformance,
	formatConformanceReport,
} from "./conformance";
export type {
	ConformanceReport,
	ConformanceCaseResult,
	ConformanceStatus,
} from "./conformance";
export type {
	ClipEditing,
	EditingValue,
	EditingParams,
	EditingKey,
	EditingChannel,
	EditingAnimations,
	EditingEffect,
	EditingMask,
	EditingPathPoint,
	EditingElementType,
} from "./editing";
export { isEditorTaskRequest, type EditorTaskRequest } from "./editor-tasks";
