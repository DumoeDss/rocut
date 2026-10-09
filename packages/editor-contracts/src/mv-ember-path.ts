import type { MvConvergePathStep } from "./mv-converge-plan";
import type {
	MvConvergeTransform,
	MvConvergeTransformOp,
} from "./mv-converge-transform";

/** Reversed inner arcs retain nonzero-winding annular clipping. */
export type MvEmberPathStep =
	| Exclude<MvConvergePathStep, { readonly kind: "arc" | "ellipse" }>
	| (Extract<MvConvergePathStep, { readonly kind: "arc" | "ellipse" }> & {
			readonly anticlockwise?: boolean;
	  })
	| {
			readonly kind: "rect";
			readonly rect: readonly [number, number, number, number];
	  };
export interface MvEmberClip {
	readonly transform: MvConvergeTransform;
	readonly operations?: readonly MvConvergeTransformOp[];
	readonly path: readonly MvEmberPathStep[];
}
/** Clip in its own CTM first; then apply this absolute base and native operations. */
export interface MvEmberDrawingSpace {
	readonly transform: MvConvergeTransform;
	readonly operations?: readonly MvConvergeTransformOp[];
	readonly clip?: MvEmberClip | null;
}
