import type { MvColor } from "./mv-recipe";
import type {
	MvConvergeTransform,
	MvConvergeTransformOp,
} from "./mv-converge-transform";
export type {
	MvConvergeTransform,
	MvConvergeTransformOp,
} from "./mv-converge-transform";

export type MvConvergePathStep =
	| {
			readonly kind: "moveTo" | "lineTo";
			readonly point: readonly [number, number];
	  }
	| { readonly kind: "close" }
	| {
			readonly kind: "arc";
			readonly center: readonly [number, number];
			readonly radius: number;
			readonly start: number;
			readonly end: number;
	  }
	| {
			readonly kind: "ellipse";
			readonly center: readonly [number, number];
			readonly radii: readonly [number, number];
			readonly rotation: number;
			readonly start: number;
			readonly end: number;
	  };
export interface MvConvergeGradientStop {
	readonly offset: number;
	readonly color: MvColor;
}
export type MvConvergeStyle =
	| { readonly kind: "solid"; readonly color: MvColor }
	| {
			readonly kind: "linear";
			readonly from: readonly [number, number];
			readonly to: readonly [number, number];
			readonly stops: readonly MvConvergeGradientStop[];
	  }
	| {
			readonly kind: "radial";
			readonly from: readonly [number, number, number];
			readonly to: readonly [number, number, number];
			readonly stops: readonly MvConvergeGradientStop[];
	  };
export type MvConvergePaint = {
	readonly style: MvConvergeStyle;
	readonly composite: "source-over" | "lighter";
	readonly opacity: number;
} & (
	| { readonly kind: "fill" }
	| {
			readonly kind: "stroke";
			readonly width: number;
			readonly cap: "butt" | "round";
			readonly join: "miter" | "round";
	  }
);
/** Apply the absolute output-pixel base CTM, then native operations in order;
 * create gradients and paths only after both steps. Do not flatten operations. */
export type MvConvergeCommand =
	| {
			readonly kind: "path";
			readonly transform: MvConvergeTransform;
			readonly operations?: readonly MvConvergeTransformOp[];
			readonly path: readonly MvConvergePathStep[];
			readonly paints: readonly MvConvergePaint[];
	  }
	| {
			readonly kind: "rect";
			readonly transform: MvConvergeTransform;
			readonly operations?: readonly MvConvergeTransformOp[];
			readonly rect: readonly [number, number, number, number];
			readonly paint: MvConvergePaint & { readonly kind: "fill" };
	  }
	| {
			readonly kind: "grain";
			readonly transform: MvConvergeTransform;
			readonly rect: readonly [number, number, number, number];
			readonly size: readonly [number, number];
			/** Opaque grayscale bytes, already seeded and rounded by Rust. */
			readonly gray: readonly number[];
			readonly opacity: number;
	  };
/** Replay in order. Grain uses overlay; every other operation specifies its compositing state. */
export interface MvConvergePlan {
	readonly commands: readonly MvConvergeCommand[];
}
