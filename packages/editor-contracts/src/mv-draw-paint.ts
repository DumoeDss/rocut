import type { MvColor } from "./mv-recipe";
import type { MvConvergeStyle } from "./mv-converge-plan";

/** Explicit Canvas compositing used inside a native-generated scene plan.
 * This is not the editor's group/master post-processing contract. */
export type MvDrawComposite =
	| "source-over"
	| "lighter"
	| "multiply"
	| "soft-light"
	| "source-atop"
	| "source-in"
	| "destination-in"
	| "destination-out"
	| "difference";
export type MvDrawPaint = {
	readonly style: MvConvergeStyle;
	readonly composite: MvDrawComposite;
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
export type MvDrawTextFill =
	| { readonly color: MvColor; readonly style?: never }
	| { readonly style: MvConvergeStyle; readonly color?: never };
