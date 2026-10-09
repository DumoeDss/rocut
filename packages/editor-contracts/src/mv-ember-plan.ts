import type { MvDrawComposite, MvDrawPaint } from "./mv-draw-paint";
import type { MvEmberDrawingSpace, MvEmberPathStep } from "./mv-ember-path";
import type { MvEmberText } from "./mv-ember-text";
import type { MvEmberPixels } from "./mv-ember-pixels";
import type { MvConvergeStyle } from "./mv-converge-plan";
import type { MvConvergeTransform } from "./mv-converge-transform";
import type { MvPreparedPatchCommand } from "./mv-image-preprocess";

export type MvEmberRect = readonly [number, number, number, number];
export type MvEmberComposite = MvDrawComposite;
export type MvEmberDraw = MvEmberDrawingSpace &
	(
		| {
				readonly kind: "path";
				readonly path: readonly MvEmberPathStep[];
				readonly paints: readonly MvDrawPaint[];
		  }
		| {
				/** Lossless path transport: one beginPath, then moveTo(x+r,y)
				 * and clockwise arc(x,y,r,0,2π) per circle. Rust charges two
				 * path steps per circle; paints share that single native path. */
				readonly kind: "circleBatch";
				readonly circles: readonly (readonly [number, number, number])[];
				readonly paints: readonly MvDrawPaint[];
		  }
		| {
				readonly kind: "rect";
				readonly rect: MvEmberRect;
				readonly paint: MvDrawPaint;
		  }
		| {
				/** Direct filtered fillRect: identity transform only, no operations
				 * or clip. Does not blur existing target contents. Rust charges
				 * target lifetime and filter scratch independently. */
				readonly kind: "filteredRect";
				readonly transform: readonly [1, 0, 0, 1, 0, 0];
				readonly operations?: readonly [];
				readonly clip?: null;
				readonly rect: MvEmberRect;
				readonly paint: MvDrawPaint & {
					readonly kind: "fill";
					readonly composite: "source-over" | "lighter";
				};
				/** Finite CSS pixel sigma in [0,16]. */
				readonly blurPx: number;
		  }
		| {
				/** Ordered independent fillRect calls, never a merged path. */
				readonly kind: "rectBatch";
				readonly rects: readonly MvEmberRect[];
				readonly paint: MvDrawPaint & { readonly kind: "fill" };
		  }
		| {
				readonly kind: "grain";
				readonly rect: MvEmberRect;
				readonly size: readonly [number, number];
				readonly gray: readonly number[];
				readonly opacity: number;
				/** Replay a real prior fillStyle assignment in its creation CTM.
				 * No draw, extra surface or authoring/effect parameter is implied;
				 * omitted history preserves the previous raster contract. */
				readonly fillHistory?: {
					readonly transform: MvConvergeTransform;
					readonly style: MvConvergeStyle;
				};
		  }
		| {
				readonly kind: "image";
				readonly image: string;
				readonly sourceRect?: MvEmberRect;
				/** Rust already applied decoded image dimensions and cover policy. */
				readonly destinationRect: MvEmberRect;
				readonly composite: MvEmberComposite;
				readonly opacity: number;
				readonly smoothing: boolean;
				readonly smoothingQuality: "low" | "medium" | "high";
		  }
		| MvEmberText
	);
/** Surface lifecycle operations are root-only and frame-owned. Drawing children
 * may sample only other completed live surfaces, never their own target. */
export type MvEmberCommand =
	| MvEmberSurfaceDraw
	| { readonly kind: "releaseSurface"; readonly surface: string }
	| {
			/** Append in place without clearing, copying, resizing or reallocating.
			 * The target is unavailable for sampling until all children complete. */
			readonly kind: "appendSurface";
			readonly surface: string;
			readonly commands: readonly MvEmberSurfaceDraw[];
	  }
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
			readonly commands: readonly MvEmberSurfaceDraw[];
	  };
export type MvEmberSurfaceDraw =
	| MvEmberDraw
	| MvPreparedPatchCommand
	| MvEmberPixels
	| (MvEmberDrawingSpace & {
			readonly kind: "surfacePatternRect";
			readonly surface: string;
			readonly rect: MvEmberRect;
			readonly composite: MvEmberComposite;
			readonly opacity: number;
			readonly smoothing: boolean;
			readonly smoothingQuality: "low" | "medium" | "high";
	  })
	| (MvEmberDrawingSpace & {
			readonly kind: "blit";
			readonly surface: string;
			readonly sourceRect: MvEmberRect;
			readonly destinationRect: MvEmberRect;
			readonly composite: MvEmberComposite;
			readonly opacity: number;
			readonly raster?: {
				readonly blurPx: number;
				readonly smoothing: boolean;
				readonly smoothingQuality: "low" | "medium" | "high";
			};
	  });
/** Internal raster transport: all timing, geometry, grain bytes and strip offsets come from Rust. */
export interface MvEmberPlan {
	readonly commands: readonly MvEmberCommand[];
}
