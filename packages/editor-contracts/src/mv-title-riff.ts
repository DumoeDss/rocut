import type { MvRole, MvSpan } from "./mv-recipe";

/** Authored native titleRiff inputs.
 * All clock/cue/text/recap decisions belong to Rust; these are data only.
 */
export interface MvTitleRiffScene {
	readonly kind: "titleRiff";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvTitleRiff;
}
export interface MvTitleRiff {
	readonly variant: "intro" | "outro";
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
	readonly credit: string;
	readonly fonts: {
		readonly title: string;
		readonly hud: string;
		readonly ruby: string;
		readonly subtitle: string;
	};
	readonly char: string;
	readonly sky: string;
	readonly glyphs: readonly [string, string];
	readonly ruby: false | readonly [string, string];
	readonly sub: string;
	readonly hud: Readonly<Record<"title" | "when" | "bpm" | "geo" | "place" | "len", string>>;
	readonly cues: Readonly<Record<"sun" | "hud" | "hud2" | "zan" | "cross" | "ko" | "split" | "neg" | "sil" | "lock" | "exit", number>>;
	/** false suppresses sun expansion/wash only, not glyph exit or lockup fade. */
	readonly exit: boolean;
	readonly grain: number;
	readonly recap?: readonly MvTitleRiffRecap[];
	readonly final?: string;
}
export interface MvTitleRiffRecap {
	readonly bg: string;
	readonly char?: string;
	readonly view: {
		readonly zoom: number;
		readonly x: number;
		readonly y: number;
		readonly rot: number;
	};
	readonly h: number;
	readonly cx: number;
	readonly cy: number;
}
