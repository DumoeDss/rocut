/** Test transport only. No production node imports this original-code oracle. */
export const AFTERIMAGE_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/intro.js",
] as const;

export interface AfterimageReference {
	readonly version: 1;
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}

export interface AfterimageReferenceFrame {
	/** Explicit song time and shot origin in seconds; no wall clock. */
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly a?: { readonly color?: string; readonly grain?: number };
	readonly includePng?: boolean;
}

export interface AfterimageReferenceFonts {
	/** Registered as the original families at weights 900 / 300 / 400. */
	readonly title: ArrayBuffer;
	readonly subtitle: ArrayBuffer;
	readonly credit: ArrayBuffer;
}

export const AFTERIMAGE_REFERENCE_TEXT = {
	text: "AB",
	sub: "afterglow",
	credit: "fixture",
	char: "fixture/synthetic-character",
	seed: 0,
} as const;

export const AFTERIMAGE_FONT_FACES = [
	{ role: "title", family: "Zen Old Mincho", weight: "900", sample: "AB" },
	{
		role: "subtitle",
		family: "Noto Serif JP",
		weight: "300",
		sample: "afterglow",
	},
	{
		role: "credit",
		family: "Zen Kaku Gothic New",
		weight: "400",
		sample: "fixture",
	},
] as const;
