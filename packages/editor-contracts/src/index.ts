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
export { isProgrammaticResource } from "./programmatic-resources";
export type { ProgrammaticBuild } from "./programmatic-build";
export { encodeImageSequenceImageRequest } from "./image-sequence-image";
export { IMAGE_SEQUENCE_RESOURCE_CAPABILITY } from "./image-sequence-capability";
export type {
	ImageSequenceManifest,
	ImageSequenceManifestInput,
	ImageSequenceManifestLimits,
	ImageSequenceManifestValidation,
	MvImageSequenceScene,
	SequenceImage,
	SequenceImageLimits,
	ResolvedSequenceImage,
} from "./image-sequence";
export type {
	MvRecipe,
	MvRole,
	MvScene,
	MvSprite,
	MvTransition,
} from "./mv-recipe";
export type { MvEffect } from "./mv-recipe-post";
export type { MvPostAutomation } from "./mv-recipe-post-automation";
export type { MvLightLeakPlan } from "./mv-light-leak";
export type {
	MvSpriteEntrance,
	MvSpriteWave,
	MvSpriteUnderlay,
	MvSpriteGlow,
} from "./mv-recipe-sprite";
export type {
	MvCompositionScene,
	MvPanel,
	MvTimePoint,
} from "./mv-recipe-composition";
export type { MvRecipePlan } from "./mv-recipe-plan";
export type { MvTitleRiff, MvTitleRiffRecap, MvTitleRiffScene } from "./mv-title-riff";
export type { MvTitleRiffPlan } from "./mv-title-riff-plan";
export type {
	MvEmber,
	MvEmberScene,
	MvEmberPalette,
	MvEmberBeats,
	MvEmberHud,
	MvEmberBreathe,
	MvEmberIgnite,
	MvEmberCollapse,
	MvEmberCollapseKey,
} from "./mv-ember";
export type {
	MvKanjiSlamScene,
	MvKanjiSlam,
	MvKanjiSlamWind,
	MvKanjiSlamSlot,
	MvKanjiSlamReframe,
} from "./mv-kanji-slam";
export type {
	MvEmberPlan,
	MvEmberCommand,
	MvEmberDraw,
	MvEmberSurfaceDraw,
	MvEmberRect,
	MvEmberComposite,
} from "./mv-ember-plan";
export type {
	MvDrawComposite,
	MvDrawPaint,
	MvDrawTextFill,
} from "./mv-draw-paint";
export type {
	MvEmberPathStep,
	MvEmberClip,
	MvEmberDrawingSpace,
} from "./mv-ember-path";
export type {
	MvConverge,
	MvConvergePalette,
	MvConvergeScene,
} from "./mv-converge";
export type {
	MvConvergePlan,
	MvConvergeCommand,
	MvConvergePaint,
	MvConvergeStyle,
	MvConvergePathStep,
	MvConvergeTransform,
	MvConvergeTransformOp,
	MvConvergeGradientStop,
} from "./mv-converge-plan";
export type { MvAsciiSweep, MvAsciiSweepPlan } from "./mv-ascii-sweep";
export type {
	MvTypeCard,
	MvTypeCardQuiet,
	MvTypeCardFlicker,
	MvTypeCardScene,
	MvTypeCardText,
	MvTypeCardPart,
	MvTypeCardLayout,
} from "./mv-type-card";
export type {
	MvTypeCardPlan,
	MvTypeCardTextPlan,
	MvTypeCardRectPlan,
	MvTypeCardGlowPlan,
} from "./mv-type-card-plan";
export type {
	MvAfterimage,
	MvAfterimageGlyph,
	MvAfterimageText,
	MvAfterimageScene,
	MvAfterimageRasterId,
	MvAfterimagePlan,
} from "./mv-afterimage";
export type { MvGrid, MvGridScene, MvGridPlan } from "./mv-grid";
export type { MvShatter, MvShatterScene, MvShatterPlan } from "./mv-shatter";
export type {
	MvCloth,
	MvClothEvent,
	MvClothScene,
	MvClothPlan,
} from "./mv-cloth";
export type {
	MvHexFloat,
	MvHexFloatScene,
	MvHexFloatPlan,
} from "./mv-hex-float";
export type { MvBendTransition } from "./mv-bend";
export type { MvMeshVertex, MvMeshFace, MvMeshImagePlanData } from "./mv-mesh";
export type {
	MvParticleScroll,
	MvParticleScrollScene,
	MvParticleScrollPlanData,
	MvParticleScrollPlan,
} from "./mv-particle-scroll";
export type {
	MvGeneratorScene,
	MvGlyphRain,
	MvParticleReveal,
} from "./mv-recipe-generators";
export type {
	MvAudioBinding,
	MvAudioStop,
	MvAudioStopMetadata,
	MvAudioSignal,
	MvAudioChannel,
	MvCameraAudio,
	MvSpriteAudio,
	MvPostAudio,
} from "./mv-recipe-audio";
export type { MvThread, MvThreadScene } from "./mv-thread";
export type { MvFall, MvFallScene } from "./mv-fall";
export type { MvFlame, MvFlameScene, MvFlamePlan } from "./mv-flame";
export type {
	ProgrammaticResource,
	ProgrammaticResourceLimits,
	ResolvedProgrammaticResource,
} from "./programmatic-resources";
export type {
	ProgrammaticSource,
	ProgrammaticFrameRequest,
} from "./programmatic";
export { isProgrammaticSource } from "./programmatic";
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
export type {
	MvImagePreprocessBinding,
	MvImagePreprocessRoi,
	MvImagePreprocessRequest,
	MvPreparedPatchCommand,
} from "./mv-image-preprocess";
