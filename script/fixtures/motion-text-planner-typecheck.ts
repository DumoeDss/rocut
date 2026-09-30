import type { MotionTextPlan as WasmMotionTextPlan } from "../../rust/wasm/pkg/opencut_wasm.js";

import type { MotionTextResolvedPlan } from "../../packages/editor-contracts/src/motion-text";
import { motionTextResolvedPlanFromPlanner } from "../../packages/editor-contracts/src/motion-text-planner";

declare const wasmPlan: WasmMotionTextPlan;

const editorPlan: MotionTextResolvedPlan =
	motionTextResolvedPlanFromPlanner(wasmPlan);

void editorPlan;
