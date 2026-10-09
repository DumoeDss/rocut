import type { MvColor, MvRole, MvSpan } from "./mv-recipe";

/** Complete authored kanjiSlam inputs; Rust owns all defaults-free timing,
 * layout, glyph art, wind, particles, fire and scene-side finishing decisions. */
export interface MvKanjiSlamScene {
	readonly kind: "kanjiSlam";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvKanjiSlam;
}
export interface MvKanjiSlam {
	readonly variant: "default" | "night" | "hand";
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
	/** Resource IDs; exact family/style/weight are declared on each font asset. */
	readonly fonts: {
		readonly monument: string;
		readonly lyric: string;
		readonly counter: string;
	};
	readonly fire: boolean;
	readonly char: string;
	readonly bg: string | null;
	readonly glyphs: readonly string[];
	readonly charX: number;
	readonly charY: number;
	readonly charH: number;
	readonly face: readonly [number, number];
	/** Normalized RGBA; all authored colors must be opaque. */
	readonly color: MvColor;
	readonly sky: "sunset" | "night" | "day";
	/** Required only for day with bg:null; otherwise omitted or null. */
	readonly skyGrad?: readonly (readonly [number, MvColor])[] | null;
	readonly rim: MvColor;
	readonly rimOff: readonly [number, number];
	readonly rimA: number;
	readonly haloA: number;
	readonly voiceDir: number | null;
	readonly wind: MvKanjiSlamWind;
	readonly slots: readonly MvKanjiSlamSlot[];
	readonly frames: readonly MvKanjiSlamReframe[];
	readonly lines: "ink" | "light";
	readonly noFlash: boolean;
}
export interface MvKanjiSlamWind {
	readonly axis: "col" | "row";
	readonly from: number;
	readonly dir: -1 | 1;
	readonly amp: number;
	readonly freq: number;
	readonly speed: number;
	readonly q: number;
}
export interface MvKanjiSlamSlot {
	readonly x: number;
	readonly y: number;
	readonly s: number;
	readonly r: number;
}
export interface MvKanjiSlamReframe {
	readonly z: number;
	readonly dx: number;
	readonly dy: number;
}
