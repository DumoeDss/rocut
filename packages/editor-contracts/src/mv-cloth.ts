import type { MvRole, MvSpan } from "./mv-recipe";
import type { MvMeshImagePlanData } from "./mv-mesh";

export interface MvClothEvent {
	/** Nonnegative safe-integer simulation ticks, at most 3_600_000. */
	readonly atTicks: number;
	/** Normalized position on the authored cloth, each component in 0..1. */
	readonly center: readonly [number, number];
	/** 0.01..2 authored-rect short sides. */
	readonly radius: number;
	/** Each component is -3..3 authored-rect short sides per second. */
	readonly velocity: readonly [number, number, number];
}

export interface MvCloth {
	readonly image: string;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** Integer mesh resolution, each in 2..24. */
	readonly columns: number;
	readonly rows: number;
	readonly pins: "topEdge" | "topCorners" | "leftEdge";
	/** 0..4 downward authored-rect short sides per second squared. */
	readonly gravity: number;
	/** Each component is -4..4 authored-rect short sides per second squared. */
	readonly wind: readonly [number, number, number];
	/** 0..2 gust strength. */
	readonly gust: number;
	/** 0..5 Hz. */
	readonly gustFrequency: number;
	/** 0..10 inverse seconds. */
	readonly damping: number;
	/** 0..0.001 XPBD stretch compliance. */
	readonly stretchCompliance: number;
	/** 0..0.1 XPBD bend compliance. */
	readonly bendCompliance: number;
	/** Integer iteration count in 2..12 for every fixed simulation step. */
	readonly solverIterations: number;
	/** 0..0.8. */
	readonly perspective: number;
	/** 0..1. */
	readonly shading: number;
	/** 0..1. */
	readonly opacity: number;
	/** At most 16 impulses, in nondecreasing atTicks order. */
	readonly events: readonly MvClothEvent[];
}

export interface MvClothScene {
	readonly kind: "cloth";
	readonly role: MvRole;
	readonly settings: MvCloth;
	/** Source-clock simulation starts here, uses 1_000-tick steps and freezes at the end. */
	readonly span: MvSpan;
}

export interface MvClothPlan {
	readonly kind: "cloth";
	readonly role: MvRole;
	readonly data: MvMeshImagePlanData;
}
