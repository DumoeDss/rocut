import type { ProgrammaticResource } from "@opencut/editor-contracts";

/** Each prefix is supplied as its complete Unicode string, not a slice index. */
export interface FontAdvanceRequest {
	readonly text: string;
	readonly fontSizePx: number;
	readonly letterSpacingPx: number;
}

export interface FontAdvanceMeasurement extends FontAdvanceRequest {
	readonly width: number;
}

/** Exact native Canvas ink facts; never scaled from the legacy 100px glyphs. */
export interface FontBoundsRequest extends FontAdvanceRequest {
	readonly version: 1;
	readonly align: "left" | "center" | "right";
	readonly baseline:
		| "top"
		| "hanging"
		| "middle"
		| "alphabetic"
		| "ideographic"
		| "bottom";
}

export interface FontBoundsMeasurement extends FontBoundsRequest {
	readonly left: number;
	readonly right: number;
	readonly ascent: number;
	readonly descent: number;
}

/** Rust-generated requests, never persisted with authored source parameters. */
export interface FontMetricRequest {
	readonly resource: ProgrammaticResource;
	readonly glyphs: readonly string[];
	readonly advances?: readonly FontAdvanceRequest[];
	readonly bounds?: readonly FontBoundsRequest[];
}

export interface FontMeasurement {
	readonly resource: ProgrammaticResource;
	readonly glyphs: readonly {
		readonly text: string;
		readonly left: number;
		readonly right: number;
		readonly ascent: number;
		readonly descent: number;
	}[];
	readonly advances?: readonly FontAdvanceMeasurement[];
	readonly bounds?: readonly FontBoundsMeasurement[];
}
