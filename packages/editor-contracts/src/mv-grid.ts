import type { MvEase, MvRole, MvSpan } from "./mv-recipe";
import type { MvMeshImagePlanData } from "./mv-mesh";

export interface MvGrid {
	readonly image: string;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** 1..64 each; two triangles per tile count toward the expanded 4096 budget. */
	readonly columns: number;
	readonly rows: number;
	/** Wave center in normalized authored-rect coordinates, each 0..1. */
	readonly center: readonly [number, number];
	/** 0.05..2 authored-rect short sides. */
	readonly wavelength: number;
	/** 0..8 wave cycles over the explicit source-frame span. */
	readonly cycles: number;
	/** 0..1 authored-rect short sides of maximum tile elevation. */
	readonly lift: number;
	/** 0..60 degrees of maximum radial tile tilt. */
	readonly tilt: number;
	/** 0..0.6 of each tile side, modulated by the progress envelope. */
	readonly gap: number;
	readonly perspective: number;
	readonly shading: number;
	readonly opacity: number;
}

export interface MvGridScene {
	readonly kind: "grid";
	readonly role: MvRole;
	readonly settings: MvGrid;
	readonly span: MvSpan;
	readonly easing: MvEase;
}

/** Rust supplies projected geometry and deterministic far-to-near face order. */
export interface MvGridPlan {
	readonly kind: "grid";
	readonly role: MvRole;
	readonly data: MvMeshImagePlanData;
}
