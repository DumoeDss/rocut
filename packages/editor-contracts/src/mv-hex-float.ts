import type { MvEase, MvRole, MvSpan } from "./mv-recipe";
import type { MvMeshImagePlanData } from "./mv-mesh";

export interface MvHexFloat {
	readonly image: string;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** Regular hexagon circumradius / authored rect's pixel short side: 0.02..0.5. */
	readonly size: number;
	/** Maximum camera-facing depth / rect short side: 0..1. */
	readonly lift: number;
	/** Maximum local x/y rotation in radians: 0..1.2. */
	readonly tilt: number;
	/** Envelope-scaled contraction of each hexagon: 0..0.75. */
	readonly gap: number;
	readonly cycles: number;
	readonly perspective: number;
	readonly shading: number;
	readonly opacity: number;
}

export interface MvHexFloatScene {
	readonly kind: "hexFloat";
	readonly role: MvRole;
	readonly settings: MvHexFloat;
	readonly span: MvSpan;
	readonly easing: MvEase;
}

export interface MvHexFloatPlan {
	readonly kind: "hexFloat";
	readonly role: MvRole;
	readonly data: MvMeshImagePlanData;
}
