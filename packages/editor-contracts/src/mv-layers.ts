import type { MvRole } from "./mv-recipe";
import type { MvPlanNode } from "./mv-recipe-plan";

/** Graph-local same-clock composition, not capture of surrounding timeline clips. */
export interface MvLayersScene {
	readonly kind: "layers";
	/** 1–16 items. Roles are a nonempty unique selection, not reassignment. */
	readonly items: readonly { readonly input: string; readonly roles: readonly MvRole[] }[];
}

/** Rust-owned evaluated graph; each role is source-over composited in item order. */
export interface MvLayersPlanNode {
	readonly kind: "layers";
	readonly items: readonly { readonly input: MvPlanNode; readonly roles: readonly MvRole[] }[];
}
