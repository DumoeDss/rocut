import type { MvColor, MvEase, MvSpan } from "./mv-recipe";
import type { MvSpriteAudio } from "./mv-recipe-audio";

export interface MvSpriteEntrance {
	readonly span: MvSpan;
	readonly easing: MvEase;
	/** Frame width/height units; scale and opacity are multipliers. */
	readonly offset: readonly [number, number];
	readonly scale: number;
	readonly rotation: number;
	readonly opacity: number;
}
export interface MvSpriteWave {
	/** Rendered sprite-height units, before rotation and flip. */
	readonly amplitude: number;
	readonly from: number;
	readonly cycles: number;
	readonly frequency: number;
	readonly phase: number;
	readonly strips: number;
}
export interface MvSpriteUnderlay {
	readonly color: MvColor;
	/** Screen-aligned, in frame width/height units. */
	readonly offset: readonly [number, number];
	/** Gaussian blur in output short-side units. */
	readonly blur: number;
}
export interface MvSpriteGlow {
	readonly color: MvColor;
	/** Screen-aligned offset from anchor, in sprite-height units. */
	readonly offset: readonly [number, number];
	readonly radius: number;
}
export interface MvSpriteStyle {
	readonly audio?: readonly MvSpriteAudio[];
	readonly enter?: MvSpriteEntrance;
	readonly exit?: MvSpriteEntrance;
	readonly wave?: MvSpriteWave;
	readonly shadow?: MvSpriteUnderlay;
	readonly rim?: MvSpriteUnderlay;
	readonly silhouette?: MvColor;
	readonly glow?: MvSpriteGlow;
}
