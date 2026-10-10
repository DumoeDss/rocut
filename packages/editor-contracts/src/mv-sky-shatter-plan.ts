import type { MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberDrawingSpace } from "./mv-ember-path";
import type { MvHeartCommand, MvHeartPathStep } from "./mv-heart-plan";

/** Native-only sky graph. filteredPath is CSS filter, distinct from Canvas shadow state. */
export type MvSkyShatterCommand =
	| Exclude<
			MvHeartCommand,
			{ readonly kind: "surface" | "appendSurface" | "preparedImage" }
	  >
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly MvSkyShatterCommand[];
	  }
	| (Pick<MvEmberDrawingSpace, "transform" | "operations"> & {
			readonly kind: "filteredPath";
			readonly path: readonly MvHeartPathStep[];
			readonly paints: readonly MvDrawPaint[];
			readonly blurPx: number;
	  });

export type MvSkyShatterPlan = {
	readonly commands: readonly MvSkyShatterCommand[];
	readonly rasterBudgetBytes: number;
};
