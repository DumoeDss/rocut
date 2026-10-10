import type { MvRole, MvSpan, MvColor } from "./mv-recipe";
import type { MvEmberPlan } from "./mv-ember-plan";
export type MvBurstView = { zoom?: number; x?: number; y?: number; rot?: number };
export type MvBurst = {
	cuts: readonly { bg?: string; color?: MvColor; view?: MvBurstView; viewTo?: MvBurstView;
		character?: { image: string; x?: number; y?: number; h?: number; anchor?: readonly [number,number]; flip?: boolean;
			rot?: number; sway?: number; breathe?: number; phase?: number; alpha?: number; disableWave?: boolean;
			wave?: { amp: number; from: number; freq: number; speed: number; drawingFps: number } };
		dir?: -1|1; lineColor?: MvColor; rim?: MvColor; disableRim?: boolean; rimDir?: -1|1; rimA?: number;
		lamps?: { a: readonly (readonly [number,number])[]; b: readonly (readonly [number,number])[]; radius: number };
		tint?: readonly { color: MvColor; amount: number; composite: "multiply"|"screen"|"soft-light"|"overlay"|"color"|"source-over"|"lighter" }[];
	}[];
	every?: number; lead?: number; flash?: "alt"|"all"|"none"|readonly number[]|boolean; flashColor?: MvColor;
	speed?: boolean; grade?: "night2dawn"; roll?: number; rim?: MvColor; disableRim?: boolean; hudFont?: string;
};
export type MvBurstScene = { kind: "burst"; role: MvRole; settings: MvBurst; bpm: number; span: MvSpan };
export type MvBurstPlan = {
	before: MvEmberPlan; after: MvEmberPlan; overlay: MvEmberPlan;
	character: null | { image: string; transform: readonly number[]; opacity: number; rim: MvColor|null;
		rimOffset: readonly [number,number]; rimOpacity: number; strips: readonly { source: readonly [number,number,number,number]; destination: readonly [number,number,number,number] }[] };
	placements: readonly { transform: readonly number[]; opacity: number }[];
	cutIndex: number; cutStartTicks: number; cutEndTicks: number; allocationBytes: number;
};
export type MvBurstPlanNode = { kind: "burst"; role: MvRole; data: MvBurstPlan };
