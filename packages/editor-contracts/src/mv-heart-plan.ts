import type { MvColor } from "./mv-recipe";
import type { MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberCommand } from "./mv-ember-plan";
import type { MvEmberDrawingSpace, MvEmberPathStep } from "./mv-ember-path";
import type { MvHeartPreparedImageCommand } from "./mv-heart-prepared";

export type MvHeartPathStep =
	| MvEmberPathStep
	| {
			readonly kind: "quadraticCurveTo";
			readonly control: readonly [number, number];
			readonly point: readonly [number, number];
	  };
/** Native Canvas state only; never a JavaScript scene algorithm. */
export type MvHeartCommand =
	| Exclude<
			MvEmberCommand,
			{ readonly kind: "path" | "surface" | "appendSurface" }
	  >
	| MvHeartPreparedImageCommand
	| (MvEmberDrawingSpace & {
			readonly kind: "path";
			readonly path: readonly MvHeartPathStep[];
			readonly paints: readonly MvDrawPaint[];
	  })
	| (MvEmberDrawingSpace & {
			readonly kind: "shadowPath";
			readonly path: readonly MvEmberPathStep[];
			readonly paints: readonly MvDrawPaint[];
			readonly shadow: {
				readonly color: MvColor;
				readonly blurPx: number;
				readonly offset: readonly [number, number];
			};
	  })
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly MvHeartCommand[];
	  }
	| {
			readonly kind: "appendSurface";
			readonly surface: string;
			readonly commands: readonly MvHeartCommand[];
	  };
