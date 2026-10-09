import type { MvConvergeStyle } from "./mv-converge-plan";
import type { MvDrawComposite, MvDrawTextFill } from "./mv-draw-paint";

interface MvEmberTextPlacement {
	readonly font: string;
	readonly text: string;
	readonly fontSize: number;
	readonly tracking: number;
	readonly position: readonly [number, number];
	readonly opacity: number;
	readonly composite: MvDrawComposite;
	readonly align: "left" | "center" | "right";
	readonly baseline:
		| "top"
		| "hanging"
		| "middle"
		| "alphabetic"
		| "ideographic"
		| "bottom";
}

export type MvEmberText = MvEmberTextPlacement &
	(
		| (MvDrawTextFill & { readonly kind: "text" })
		| {
				readonly kind: "textStroke";
				readonly style: MvConvergeStyle;
				readonly width: number;
				readonly cap: "butt" | "round";
				readonly join: "miter" | "round";
				readonly blurPx: number;
				/** Native measured ink + stroke + CTM before blur; budget only. */
				readonly rasterBounds: readonly [number, number, number, number];
		  }
	);
