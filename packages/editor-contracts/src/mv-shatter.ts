import type { MvEase, MvRole, MvSpan } from "./mv-recipe";
import type { MvMeshImagePlanData } from "./mv-mesh";

export interface MvShatter {
	readonly image: string;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** 4..512 seeded Voronoi cells; eight charged primitives per cell. */
	readonly fragments: number;
	/** Burst origin within the authored rect. */
	readonly center: readonly [number, number];
	/** 0..2 rect short sides of burst travel. */
	readonly spread: number;
	/** 0..2*pi radians of rigid fragment rotation. */
	readonly spin: number;
	/** 0..2 rect short sides of downward quadratic displacement. */
	readonly gravity: number;
	/** 0..1 rect short sides of fragment elevation. */
	readonly depth: number;
	readonly perspective: number;
	/** 0..0.08 rect short sides of normal-driven RGB refraction; alpha is unchanged. */
	readonly refraction: number;
	readonly shading: number;
	readonly shadow: number;
	readonly opacity: number;
}

export interface MvShatterScene {
	readonly kind: "shatter";
	readonly role: MvRole;
	readonly settings: MvShatter;
	readonly span: MvSpan;
	readonly easing: MvEase;
}

/** Distinct from the existing A/B recipe shatter transition. */
export interface MvShatterPlan {
	readonly kind: "shatter";
	readonly role: MvRole;
	readonly data: MvMeshImagePlanData;
}
