import type { MvColor } from "./mv-recipe";

export interface MvAsciiSweep {
	readonly font: string;
	/** Unicode scalar cells; LF separates at most 32 lines of at most 128 cells. */
	readonly textA: string;
	readonly textB: string;
	/** 1..64 Unicode scalar values for the active scan band. */
	readonly glyphs: string;
	/** Normalized [left, top, width, height], entirely inside the frame. */
	readonly rect: readonly [number, number, number, number];
	/** Pixel size; the complete grid must fit rect without truncation. */
	readonly fontSize: number;
	/** Fraction of rect width. */
	readonly bandWidth: number;
	readonly color: MvColor;
	readonly activeColor: MvColor;
	readonly opacity: number;
	readonly direction: "leftToRight" | "rightToLeft";
}

/** Rust-produced data. Neither text selection nor time is evaluated by the raster adapter. */
export interface MvAsciiSweepPlan {
	readonly font: string;
	readonly fontSize: number;
	readonly cellWidth: number;
	readonly lineHeight: number;
	readonly color: MvColor;
	readonly activeColor: MvColor;
	readonly glyphs: readonly {
		readonly text: string;
		readonly x: number;
		readonly y: number;
		readonly opacity: number;
		readonly active: boolean;
	}[];
}
