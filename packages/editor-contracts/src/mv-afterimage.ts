import type { MvColor, MvRole, MvSpan } from "./mv-recipe";

export interface MvAfterimageGlyph {
	/** Exactly one Unicode scalar; no control characters. */
	readonly text: string;
	/** Ink-box center: x / frame width, y / frame height. */
	readonly center: readonly [number, number];
	/** Fraction of frame height. */
	readonly fontSize: number;
}

export interface MvAfterimageText {
	readonly font: string;
	/** 1..256 Unicode scalars; no control characters. */
	readonly text: string;
	/** Center/middle alignment: x / frame width, y / frame height. */
	readonly position: readonly [number, number];
	/** Fractions of frame height. */
	readonly fontSize: number;
	readonly tracking: number;
	readonly opacity: number;
}

export interface MvAfterimage {
	readonly cutout: {
		readonly image: string;
		/** Explicit normalized destination rect; preserve source aspect ratio when authoring. */
		readonly rect: readonly [number, number, number, number];
	};
	readonly titleFont: string;
	/** 1..16 individually ink-centered glyphs. */
	readonly glyphs: readonly MvAfterimageGlyph[];
	readonly circle: {
		readonly center: readonly [number, number];
		/** Fraction of frame height. */
		readonly radius: number;
	};
	readonly subtitle: MvAfterimageText;
	readonly credit: MvAfterimageText & { readonly color: MvColor };
	readonly color: MvColor;
	readonly fringeColor: MvColor;
	readonly background: MvColor;
	readonly grain: number;
	/** Scales both elapsed and total span seconds; grain uses remapped song time. */
	readonly timeScale: number;
	/** Multiplies drift, rotation and scale increment, not blur or opacity. */
	readonly motionScale: number;
}

export interface MvAfterimageScene {
	readonly kind: "afterimage";
	readonly role: MvRole;
	readonly settings: MvAfterimage;
	readonly span: MvSpan;
}

export type MvAfterimageRasterId = "sharp" | "mid" | "soft" | "halo" | "fringe";

/** Rust evaluates all time, noise, geometry and opacity. All plan lengths are pixels. */
export interface MvAfterimagePlan {
	readonly mask: {
		readonly circle: {
			readonly center: readonly [number, number];
			readonly radius: number;
		};
		readonly cutout: MvAfterimage["cutout"];
		readonly titleFont: string;
		/** Measure at 1000px, alphabetic baseline; draw centered on actual ink bounds. */
		readonly glyphs: readonly MvAfterimageGlyph[];
		readonly subtitle: MvAfterimageText;
	};
	readonly background: MvColor;
	readonly color: MvColor;
	readonly fringeColor: MvColor;
	readonly transform: readonly [number, number, number, number, number, number];
	/** Construct in order. Blur pixels belong to each downsampled raster. */
	readonly rasters: readonly {
		readonly id: MvAfterimageRasterId;
		readonly source: "mask" | "sharp";
		readonly size: readonly [number, number];
		readonly blur: number;
		/** Source-in tint applied after blur; null preserves input color. */
		readonly tint: MvColor | null;
	}[];
	/** Additive (lighter), in authored plan order, under transform. */
	readonly layers: readonly {
		readonly raster: MvAfterimageRasterId;
		readonly opacity: number;
		readonly rect: readonly [number, number, number, number];
	}[];
	/** Opaque grayscale tile, repeated with overlay after restoring identity transform. */
	readonly grain: {
		readonly size: readonly [number, number];
		readonly gray: readonly number[];
		readonly offset: readonly [number, number];
		readonly opacity: number;
	} | null;
	/** Draw after grain, at identity transform, source-over. */
	readonly credit: MvAfterimageText & { readonly color: MvColor };
}
