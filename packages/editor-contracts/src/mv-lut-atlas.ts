import type { ProgrammaticResource } from "./programmatic-resources";
/** Authored resource binding only. The hash-admitted JSON supplies order and IDs. */
export interface MvLutAtlasSettings {
	readonly paletteResource: string;
	readonly images: readonly {
		readonly path: string;
		readonly resourceId: string;
	}[];
}
export type MvLutAtlasRow =
	| {
			readonly kind: "image";
			readonly row: number;
			readonly resource: ProgrammaticResource;
			readonly sourceRect: readonly [number, number, number, number];
			readonly destinationRect: readonly [number, number, number, number];
	  }
	| {
			readonly kind: "ramp";
			readonly row: number;
			readonly name: string;
			readonly gradientPoints: readonly [number, number, number, number];
			readonly stops: readonly (readonly [number, string])[];
			readonly destinationRect: readonly [number, number, number, number];
	  };
export interface MvLutAtlasPlan {
	readonly version: 1;
	readonly profile: "original-lut-atlas-v1";
	readonly size: readonly [256, 16];
	readonly paletteResource: ProgrammaticResource;
	readonly atlasSha256: string;
	readonly usedRows: number;
	readonly aliases: Readonly<Record<string, number>>;
	readonly palettes: Readonly<Record<string, unknown>>;
	readonly rows: readonly MvLutAtlasRow[];
	readonly allocationBytes: number;
}
/** Rust-issued exact native readback rectangle and original source binding. */
export interface MvLutAtlasRowSample {
	readonly row: number;
	readonly rect: readonly [0, number, 256, 1];
	readonly atlasSha256: string;
	readonly sourceResource: ProgrammaticResource | null;
}
