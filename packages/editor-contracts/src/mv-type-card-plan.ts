import type { MvColor } from "./mv-recipe";

/** All geometry is evaluated pixels. Canvas uses center/middle and the declared font. */
export interface MvTypeCardTextPlan {
	readonly font: string;
	readonly text: string;
	readonly position: readonly [number, number];
	readonly fontSize: number;
	readonly tracking: number;
	readonly color: MvColor;
	readonly opacity: number;
	readonly blur: number;
}
export interface MvTypeCardRectPlan {
	readonly rect: readonly [number, number, number, number];
	readonly color: MvColor;
	readonly opacity: number;
}
/** Additive radial gradient, identity transform. */
export interface MvTypeCardGlowPlan {
	readonly center: readonly [number, number];
	readonly radius: number;
	readonly rect: readonly [number, number, number, number];
	readonly stops: readonly {
		readonly offset: number;
		readonly color: MvColor;
	}[];
}
export interface MvTypeCardPlan {
	readonly mode: "quiet" | "flicker";
	readonly background: MvColor;
	/** Draw glyphs, rule rectangles, subtitle, then grain. */
	readonly quiet: {
		readonly glyphs: readonly MvTypeCardTextPlan[];
		readonly rule: readonly MvTypeCardRectPlan[];
		readonly subtitle: MvTypeCardTextPlan | null;
	} | null;
	readonly flicker: {
		/** Only RGB text uses this CRT transform on one full-size scratch surface. */
		readonly transform: readonly [
			number,
			number,
			number,
			number,
			number,
			number,
		];
		readonly text: readonly MvTypeCardTextPlan[];
		/** Draw viewfinder/indicator at identity, then destination-out erasers. */
		readonly frame: {
			readonly rect: readonly [number, number, number, number];
			readonly color: MvColor;
			readonly width: number;
		} | null;
		readonly indicator: MvTypeCardRectPlan | null;
		readonly erasers: readonly {
			readonly rect: readonly [number, number, number, number];
			readonly opacity: number;
		}[];
		/** Blit scratch bands source-over, then additive blocks and kickGlow. */
		readonly bands: readonly {
			readonly sourceRect: readonly [number, number, number, number];
			readonly destinationRect: readonly [number, number, number, number];
			readonly opacity: number;
		}[];
		readonly blocks: readonly MvTypeCardRectPlan[];
		readonly kickGlow: MvTypeCardGlowPlan | null;
		readonly idleScan: MvTypeCardRectPlan | null;
		/** Morse always follows the flicker/idle phase, before grain. */
		readonly morse: {
			readonly elements: readonly MvTypeCardRectPlan[];
			readonly label: MvTypeCardTextPlan;
		};
	} | null;
	/** Selected seeded opaque grayscale tile; repeat using screen, at identity. */
	readonly grain: {
		readonly size: readonly [number, number];
		readonly gray: readonly number[];
		readonly offset: readonly [number, number];
		readonly opacity: number;
	} | null;
	/** After grain: additive flood, source-over white fill, then source-over negative. */
	readonly flood: MvTypeCardGlowPlan | null;
	readonly white: MvColor | null;
	readonly negative: MvTypeCardTextPlan | null;
}
