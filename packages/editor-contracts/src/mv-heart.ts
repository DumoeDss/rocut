import type { MvHeartCommand } from "./mv-heart-plan";

/** Whole-song seconds; the original defaults differ between shatter and burn. */
export interface MvHeartBreakSettings {
	readonly heart: string;
	readonly bg?: string | null;
	readonly breakBeat?: number;
	readonly breakAt?: number | null;
	readonly x?: number;
	readonly y?: number;
}
export type MvHeartImplementedMode = "shatter" | "burn";
/** Prepared references are resolved only through the current admitted session. */
export interface MvHeartPlan {
	readonly commands: readonly MvHeartCommand[];
	readonly rasterBudgetBytes: number;
}
/** Rust-computed transient facts, not authored controls or a caller-assigned label map. */
export interface MvHeartPreparationAdmission {
	readonly ceilingBytes: number;
	readonly encodedSourceBytes: number;
	readonly decodedSourceBytes: number;
	readonly nativeSourceBytes: number;
	readonly fractureBytes: number;
	readonly identityBytes: number;
	readonly maxParts: number;
	readonly componentBudgetBytes: number;
}
