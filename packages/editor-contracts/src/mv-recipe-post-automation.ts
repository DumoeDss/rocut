import type { MvEase } from "./mv-recipe";

export interface MvPostAutomation {
	/** Zero-based amount-bearing effect. Curves replace its static amount. */
	readonly effect: number;
	/** 1..256 strictly increasing source frames, including durationFrames as
	 * a possible final endpoint. Hold outside the keys; no child-ref remapping. */
	readonly keyframes: readonly {
		readonly frame: number;
		readonly value: number;
		/** Easing of the segment leaving this key; the last key holds. */
		readonly easing: MvEase;
	}[];
}
