import { mediaTime } from "./domain";
import {
	MOTION_TEXT_PLAN_VERSION,
	motionTextCueId,
	motionTextCutId,
	motionTextFontId,
	type MotionTextParameterValue,
	type MotionTextPresetSelection,
	type MotionTextResolvedPlan,
} from "./motion-text";

/** JSON-compatible shape emitted by the Rust/WASM motion-text planner. */
export interface MotionTextPlannerResolvedCutWire {
	readonly id: string;
	readonly cueId: string;
	readonly text: string;
	readonly startTime: number;
	readonly duration: number;
	readonly seed: number;
	readonly preset: MotionTextPresetSelection;
	readonly fontId: string | null;
	readonly parameters: Readonly<Record<string, MotionTextParameterValue>>;
}

/** JSON-compatible plan shape emitted by the Rust/WASM motion-text planner. */
export interface MotionTextPlannerPlanWire {
	readonly version: number;
	readonly sequenceRevision: number;
	readonly cuts: readonly MotionTextPlannerResolvedCutWire[];
}

/**
 * Add the editor contract's nominal IDs and MediaTime brands at the WASM seam.
 * Planning, validation, locking and randomization remain Rust responsibilities.
 */
export function motionTextResolvedPlanFromPlanner(
	plan: MotionTextPlannerPlanWire,
): MotionTextResolvedPlan {
	if (plan.version !== MOTION_TEXT_PLAN_VERSION) {
		throw new RangeError(
			`Unsupported motion-text plan version ${plan.version}`,
		);
	}
	if (!Number.isInteger(plan.sequenceRevision) || plan.sequenceRevision < 0) {
		throw new RangeError(
			`Motion-text sequence revision must be a non-negative integer, got ${plan.sequenceRevision}`,
		);
	}
	return {
		version: MOTION_TEXT_PLAN_VERSION,
		sequenceRevision: plan.sequenceRevision,
		cuts: plan.cuts.map((cut) => ({
			id: motionTextCutId(cut.id),
			cueId: motionTextCueId(cut.cueId),
			text: cut.text,
			startTime: mediaTime({ ticks: cut.startTime }),
			duration: mediaTime({ ticks: cut.duration }),
			seed: cut.seed,
			preset: {
				...cut.preset,
				decor: [...cut.preset.decor],
				fx: [...cut.preset.fx],
			},
			...(cut.fontId === null ? {} : { fontId: motionTextFontId(cut.fontId) }),
			parameters: structuredClone(cut.parameters),
		})),
	};
}
