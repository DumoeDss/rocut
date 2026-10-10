import type { MvRole, MvSpan } from "./mv-recipe";
import type { MvEmberPlan } from "./mv-ember-plan";

/** Complete native Ink; authored paths and visual palette remain the original scene. */
export interface MvInk {
	readonly char: string;
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
	/** Original seed||7: zero and omission select 7; source.seed is not added. */
	readonly seed?: number;
	readonly h?: number;
	readonly x?: number;
	readonly y?: number;
}
export interface MvInkScene {
	readonly kind: "ink";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvInk;
}
export type MvInkPlan = MvEmberPlan;
