import type { MvColor, MvRole } from "./mv-recipe";

export interface MvGlyphRain {
	readonly font: string;
	/** 1..64 Unicode scalar values, each drawn as an individual glyph. */
	readonly glyphs: string;
	readonly columns: number;
	readonly rows: number;
	readonly trail: number;
	/** Cells/second on the quantized song clock. */
	readonly speed: number;
	readonly drawingFps: number;
	readonly color: MvColor;
	readonly headColor: MvColor;
	readonly opacity: number;
}

export interface MvGlyphRainScene {
	readonly kind: "glyphRain";
	readonly role: MvRole;
	readonly settings: MvGlyphRain;
}

export interface MvGlyphRainPlan {
	readonly kind: "glyphRain";
	readonly role: MvRole;
	readonly data: {
		readonly font: string;
		readonly fontSize: number;
		readonly cellWidth: number;
		readonly color: MvColor;
		readonly headColor: MvColor;
		readonly glyphs: readonly {
			readonly text: string;
			readonly x: number;
			readonly y: number;
			readonly opacity: number;
			readonly head: boolean;
		}[];
	};
}
