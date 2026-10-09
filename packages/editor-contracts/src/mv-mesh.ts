export interface MvMeshVertex {
	/** Projected canvas pixels. */
	readonly position: readonly [number, number];
	/** UV in the complete, transparent canvas-sized source texture. */
	readonly uv: readonly [number, number];
	/** Positive homogeneous divisor for perspective-correct interpolation. */
	readonly w: number;
}

export interface MvMeshFace {
	/** Ordered convex polygon. */
	readonly vertices: readonly MvMeshVertex[];
	readonly brightness: number;
	readonly opacity: number;
	/** Rust sorts far to near; the raster backend preserves this order. */
	readonly depth: number;
	/** Refracted RGB offset in full-canvas UV. Original UV retains source alpha. */
	readonly colorOffset?: readonly [number, number];
}

export interface MvMeshImagePlanData {
	readonly image: string;
	/** Absolute canvas pixels, including the source image fit. */
	readonly rect: readonly [number, number, number, number];
	readonly fit: "contain" | "cover" | "stretch";
	/** Only the fullImage path uses this; faces carry complete opacity. */
	readonly opacity: number;
	readonly fullImage: boolean;
	readonly faces: readonly MvMeshFace[];
}
