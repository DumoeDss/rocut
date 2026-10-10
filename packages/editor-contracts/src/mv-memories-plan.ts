import type { MvColor } from "./mv-recipe";
import type { MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberDrawingSpace } from "./mv-ember-path";
import type { MvHeartCommand, MvHeartPathStep } from "./mv-heart-plan";

/** Identity only. Raw RGBA travels through the admitted owner, never recipe JSON. */
export type MvMemoriesRaster = {
	readonly bindingSha256: string;
	readonly part: string;
	readonly width: number;
	readonly height: number;
	readonly rgbaSha256: string;
};
type Space = Pick<MvEmberDrawingSpace, "transform" | "operations">;

/** Produced by Rust; the UI only measures these exact strings using admitted fonts. */
export type MvMemoriesFontMeasurementRequest = {
	readonly font: string;
	readonly fontSize: number;
	readonly weight: 400 | 600;
	readonly texts: readonly string[];
};

export type MvMemoriesCommand =
	| Exclude<
			MvHeartCommand,
			{
				readonly kind:
					| "surface"
					| "appendSurface"
					| "preparedImage"
					| "filteredRect";
			}
	  >
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly MvMemoriesCommand[];
	  }
	| { readonly kind: "pixels"; readonly raster: MvMemoriesRaster }
	| (Space & {
			readonly kind: "preparedImage";
			readonly raster: MvMemoriesRaster;
			readonly destinationRect: readonly [number, number, number, number];
			readonly composite: string;
			readonly opacity: number;
			readonly smoothingQuality: "low" | "medium" | "high";
	  })
	| (Space & {
			readonly kind: "roundRect";
			readonly rect: readonly [number, number, number, number];
			readonly radius: number;
			readonly paint: MvDrawPaint;
	  })
	| (Space & {
			readonly kind: "filteredRect";
			readonly affine: MvEmberDrawingSpace["transform"] | null;
			readonly rect: readonly [number, number, number, number];
			readonly paint: MvDrawPaint;
			readonly blurPx: number;
	  })
	| (Space & {
			readonly kind: "filteredPath";
			readonly path: readonly MvHeartPathStep[];
			readonly paints: readonly MvDrawPaint[];
			readonly blurPx: number;
	  })
	| (Space & {
			readonly kind: "clippedText";
			readonly font: string;
			readonly text: string;
			readonly fontSize: number;
			readonly position: readonly [number, number];
			readonly clip: MvEmberDrawingSpace["clip"] | null;
			readonly color: MvColor;
			readonly opacity: number;
	  });

export type MvMemoriesPlan = {
	readonly commands: readonly MvMemoriesCommand[];
	readonly rasterBudgetBytes: number;
};
