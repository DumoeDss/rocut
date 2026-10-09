import type { MvRole, MvSpan } from "./mv-recipe";
import type { MvEmberCommand } from "./mv-ember-plan";

export interface MvFlame {
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
	readonly mode?: "breathe" | "grow" | "dark";
	readonly img?: string | null;
	readonly face?: string | null;
	readonly flameAt?:
		| readonly [number, number, number, number, number, number]
		| null;
	readonly stops?: readonly (readonly [number, number])[];
	readonly zoomAt?: number | null;
	readonly zoomTo?: number;
	readonly igniteAt?: number | null;
	readonly h?: number;
	readonly faceAt?: readonly [number, number];
	readonly facePos?: readonly [number, number];
	readonly vocal?: "analysis" | "zero";
}

export interface MvFlameScene {
	readonly kind: "flame";
	readonly role: MvRole;
	readonly settings: MvFlame;
	readonly span: MvSpan;
}

/** Rust's actual per-frame scratch accounting, never an author budget. */
export interface MvFlamePlan {
	readonly commands: readonly MvEmberCommand[];
	readonly rasterBudgetBytes: number;
}
