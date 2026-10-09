import type { MvColor, MvRole } from "./mv-recipe";
import type { MvBendTransition } from "./mv-bend";
import type { MvMeshVertex } from "./mv-mesh";

export interface MvTransitionEdge {
	readonly color: MvColor;
	/** Fraction of the shorter canvas dimension. */
	readonly width: number;
	readonly role: MvRole;
}
export type MvTransition =
	| MvBendTransition
	| { readonly kind: "cut" | "xfade" | "black" | "zoom" }
	| { readonly kind: "flash"; readonly color: MvColor }
	| {
			readonly kind: "wipe";
			readonly angle: number;
			readonly edge?: MvTransitionEdge;
	  }
	| {
			readonly kind: "iris";
			readonly center: readonly [number, number];
			readonly edge?: MvTransitionEdge;
	  }
	| { readonly kind: "irisClose"; readonly center: readonly [number, number] }
	| {
			readonly kind: "push";
			readonly direction: "left" | "right" | "up" | "down";
	  }
	| { readonly kind: "slices"; readonly count: number }
	| {
			readonly kind: "peel";
			readonly direction: "left" | "right" | "up" | "down";
			/** Cylinder radius relative to the dimension along the fold. */
			readonly curl: number;
			readonly segments: number;
			readonly shading: number;
			readonly perspective: number;
	  }
	| { readonly kind: "ink"; readonly seed: number; readonly blobs: number }
	| {
			readonly kind: "shatter";
			readonly seed: number;
			readonly center: readonly [number, number];
			readonly columns: number;
			readonly rows: number;
			readonly edge?: MvTransitionEdge;
	  }
	| {
			readonly kind: "barrier";
			readonly pivot: readonly [number, number];
			readonly colors: readonly [MvColor, MvColor];
			readonly width: number;
			readonly stripes: number;
			readonly role: MvRole;
	  };

export type MvClipPath =
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
	  }
	| {
			readonly kind: "circle";
			readonly x: number;
			readonly y: number;
			readonly radius: number;
	  }
	| {
			readonly kind: "polygons";
			readonly points: readonly (readonly (readonly [number, number])[])[];
	  };
export type MvMatrix = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
];
/** Rust-generated raster instructions; never accepted as an authored recipe. */
export type MvDrawCommand =
	| {
			readonly kind: "mesh";
			readonly input: "from" | "to";
			readonly vertices: readonly MvMeshVertex[];
			readonly brightness: number;
			readonly opacity: number;
	  }
	| {
			readonly kind: "surface";
			readonly input: "from" | "to";
			readonly opacity: number;
			readonly transform: MvMatrix;
			readonly clip: MvClipPath;
			readonly brightness: number;
	  }
	| {
			readonly kind: "image";
			readonly input: "from" | "to";
			readonly opacity: number;
			readonly transform: MvMatrix;
			readonly clip: MvClipPath | null;
			readonly replace: boolean;
			readonly blend: "source-over" | "lighter";
	  }
	| { readonly kind: "tint"; readonly color: MvColor; readonly opacity: number }
	| {
			readonly kind: "fill";
			readonly color: MvColor;
			readonly opacity: number;
			readonly path: MvClipPath;
			readonly role: MvRole;
	  }
	| {
			readonly kind: "stroke";
			readonly color: MvColor;
			readonly opacity: number;
			readonly path: MvClipPath;
			readonly role: MvRole;
			readonly width: number;
			readonly transform: MvMatrix;
	  };
