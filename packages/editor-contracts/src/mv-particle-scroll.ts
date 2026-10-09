import type { MvEase, MvRole, MvSpan } from "./mv-recipe";

export interface MvParticleScroll {
	readonly image: string;
	readonly columns: number;
	readonly rows: number;
	/** Normalized [left, top, width, height]. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** Width of the moving fragment band in fitted-image scan coordinates. */
	readonly band: number;
	/** Fragment travel relative to the authored rect dimensions. */
	readonly scatter: number;
	readonly spin: number;
	readonly opacity: number;
	readonly direction:
		| "left-to-right"
		| "right-to-left"
		| "top-to-bottom"
		| "bottom-to-top";
}

export interface MvParticleScrollScene {
	readonly kind: "particleScroll";
	readonly role: MvRole;
	readonly settings: MvParticleScroll;
	readonly span: MvSpan;
	readonly easing: MvEase;
}

/** Rust-resolved geometry; the Worker only applies image fit and rasterization. */
export interface MvParticleScrollPlanData {
	readonly image: string;
	/** Absolute frame pixels. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: MvParticleScroll["fit"];
	readonly opacity: number;
	readonly fullImage: boolean;
	readonly frontier: number;
	/** Normalized fitted-image UV regions, never time-dependent raster rules. */
	readonly intactUv: readonly [number, number, number, number] | null;
	readonly particleClipUv: readonly [number, number, number, number] | null;
	readonly particles: readonly {
		readonly cell: readonly [number, number];
		readonly uv: readonly [number, number, number, number];
		/** Absolute frame pixel offsets from the original fragment center. */
		readonly offset: readonly [number, number];
		readonly scale: number;
		readonly rotation: number;
		readonly opacity: number;
	}[];
}

export interface MvParticleScrollPlan {
	readonly kind: "particleScroll";
	readonly role: MvRole;
	readonly data: MvParticleScrollPlanData;
}
