import type { MvCamera, MvEase, MvSpan } from "./mv-recipe";
import type { MvTransitionEdge } from "./mv-recipe-transition";

/** Integer source-frame knots; hold outside endpoints, floor interpolated
 * source frames. Nested maps each quantize once. Never changes the song audio. */
export interface MvTimePoint {
	readonly atFrame: number;
	readonly sourceFrame: number;
}
export interface MvPanel {
	readonly input: string;
	readonly polygon: readonly (readonly [number, number])[];
	readonly opening: {
		readonly span: MvSpan;
		readonly angle: number;
		readonly easing: MvEase;
	};
	readonly camera: {
		readonly motion: MvSpan;
		readonly from: MvCamera;
		readonly to: MvCamera;
		readonly easing: MvEase;
	};
}
export type MvCompositionScene =
	| {
			readonly kind: "ref";
			readonly input: string;
			readonly timeMap: readonly MvTimePoint[];
	  }
	| {
			readonly kind: "sequence";
			readonly items: readonly {
				readonly input: string;
				readonly span: MvSpan;
				readonly timeMap: readonly MvTimePoint[];
			}[];
	  }
	| {
			readonly kind: "panels";
			readonly panels: readonly MvPanel[];
			readonly collapse?: {
				readonly span: MvSpan;
				readonly hero: number;
				readonly easing: MvEase;
			};
			readonly border?: MvTransitionEdge;
	  };
