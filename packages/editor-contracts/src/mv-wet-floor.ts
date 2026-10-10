import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvRole, MvSpan } from "./mv-recipe";

/** Closed night.js wetFloor authoring. Absolute song beats are never generated
 * from BPM; BPM is used only for the final beat's phase fallback. */
export interface MvWetFloor {
	readonly mode: "fall" | "count";
	readonly bg: string;
	readonly fonts: {
		readonly mincho800: string;
		readonly noto800: string;
		readonly dot400: string;
		readonly noto400: string;
	};
	readonly words?: readonly string[];
	readonly spots?: readonly (readonly [number, number])[];
	readonly heroSpot?: readonly [number, number];
	readonly heroAt?: number;
	readonly lead?: number;
	readonly shimmer?: number;
	readonly from?: {
		readonly zoom?: number;
		readonly x?: number;
		readonly y?: number;
		readonly rot?: number;
	};
	readonly to?: {
		readonly zoom?: number;
		readonly x?: number;
		readonly y?: number;
		readonly rot?: number;
	};
	readonly hudColor?: string;
	readonly hudAlpha?: number;
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
}
export interface MvWetFloorScene {
	readonly kind: "wetFloor";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvWetFloor;
}
export interface MvWetFloorFontStack {
	readonly role: "mincho800" | "dot400";
	readonly resources: readonly [ProgrammaticResource, ProgrammaticResource];
	readonly aliases: readonly [string, string];
	readonly routes: Readonly<Record<string, string>>;
}
type Brush =
	| { readonly kind: "color"; readonly value: string }
	| { readonly kind: "gradient"; readonly id: string };
/** Native Canvas ABI transcript. No timing, randomness, image analysis, text
 * routing, expression language or scene helper executes in the TS consumer. */
export type MvWetFloorOperation =
	| { readonly op: "save" | "restore" | "beginPath" | "closePath" }
	| {
			readonly op: "translate" | "scale" | "moveTo" | "lineTo";
			readonly point: readonly [number, number];
	  }
	| { readonly op: "rotate"; readonly angle: number }
	| {
			readonly op: "setTransform";
			readonly matrix: readonly [
				number,
				number,
				number,
				number,
				number,
				number,
			];
	  }
	| {
			readonly op: "alpha" | "lineWidth" | "shadowBlur";
			readonly value: number;
	  }
	| {
			readonly op:
				| "composite"
				| "filter"
				| "shadowColor"
				| "lineCap"
				| "textAlign"
				| "textBaseline";
			readonly value: string;
	  }
	| { readonly op: "lineDash"; readonly values: readonly number[] }
	| { readonly op: "fillStyle" | "strokeStyle"; readonly brush: Brush }
	| {
			readonly op: "linearGradient";
			readonly id: string;
			readonly points: readonly [number, number, number, number];
			readonly stops: readonly (readonly [number, string])[];
	  }
	| {
			readonly op: "radialGradient";
			readonly id: string;
			readonly points: readonly [
				number,
				number,
				number,
				number,
				number,
				number,
			];
			readonly stops: readonly (readonly [number, string])[];
	  }
	| {
			readonly op: "rect" | "fillRect" | "clearRect";
			readonly rect: readonly [number, number, number, number];
	  }
	| {
			readonly op: "ellipse";
			readonly center: readonly [number, number];
			readonly radii: readonly [number, number];
			readonly rotation: number;
			readonly start: number;
			readonly end: number;
	  }
	| { readonly op: "clip" | "fill"; readonly rule: "nonzero" | "evenodd" }
	| { readonly op: "stroke" }
	| {
			readonly op: "drawImage";
			readonly image: {
				readonly kind: "resource" | "surface";
				readonly id: string;
			};
			readonly sourceRect: readonly [number, number, number, number] | null;
			readonly destinationRect: readonly [number, number, number, number];
	  }
	| {
			readonly op: "font";
			readonly role: "mincho800" | "dot400";
			readonly size: number;
			readonly weight: 800 | 400;
	  }
	| {
			readonly op: "fillText";
			readonly text: string;
			readonly point: readonly [number, number];
	  }
	| {
			readonly op: "putRgba";
			readonly size: readonly [number, number];
			readonly bytes: readonly number[];
	  }
	| {
			readonly op: "putAlpha";
			readonly size: readonly [number, number];
			readonly bytes: readonly number[];
	  };
export interface MvWetFloorSurface {
	readonly id: string;
	readonly size: readonly [number, number];
	readonly operations: readonly MvWetFloorOperation[];
}
export interface MvWetFloorPlan {
	readonly version: 1;
	readonly profile: "night-wet-floor-v1";
	readonly mode: "fall" | "count";
	readonly logicalSize: readonly [1920, 1080];
	readonly songTicks: number;
	readonly fontStacks: readonly MvWetFloorFontStack[];
	readonly surfaces: readonly MvWetFloorSurface[];
	readonly operations: readonly MvWetFloorOperation[];
	readonly allocationBytes: number;
	readonly operationCount: number;
}
