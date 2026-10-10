import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvRole, MvSpan } from "./mv-recipe";

/** Exact original scenes/night.js train authoring. Times are song seconds;
 * motion velocity derives from actual beat intervals, never a synthetic grid. */
export interface MvTrain {
	readonly bg: string;
	readonly fonts: {
		readonly mincho800: string;
		readonly noto800: string;
		readonly mincho700: string;
		readonly noto700: string;
		readonly dot400: string;
		readonly noto400: string;
	};
	readonly chars?: readonly string[];
	readonly windowChars?: readonly string[];
	readonly freeze?: readonly [number, number];
	readonly exitAt?: number;
	readonly heroX?: number;
	readonly hero?: number;
	readonly cars?: number;
	readonly shutter?: number;
	readonly taps?: number;
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
	readonly beats:
		| { readonly kind: "manual"; readonly songTicks: readonly number[] }
		| { readonly kind: "analysis" };
	readonly bpm: number;
	readonly downbeatIndex0: number;
}
export interface MvTrainScene {
	readonly kind: "train";
	readonly role: MvRole;
	readonly span: MvSpan;
	readonly settings: MvTrain;
}
export interface MvTrainFontStack {
	readonly role: "mincho800" | "mincho700" | "dot400";
	readonly resources: readonly [ProgrammaticResource, ProgrammaticResource];
	readonly aliases: readonly [string, string];
	readonly routes: Readonly<Record<string, string>>;
}
type Brush =
	| { readonly kind: "color"; readonly value: string }
	| { readonly kind: "gradient"; readonly id: string };
/** Native Canvas ABI transcript. No timing, randomness, image analysis, text
 * routing, expression language or scene helper executes in the TS consumer. */
export type MvTrainOperation =
	| {
			readonly op: "arc";
			readonly center: readonly [number, number];
			readonly radius: number;
			readonly start: number;
			readonly end: number;
	  }
	| {
			readonly op: "roundRect";
			readonly rect: readonly [number, number, number, number];
			readonly radius: number;
	  }
	| {
			readonly op: "strokeRect";
			readonly rect: readonly [number, number, number, number];
	  }
	| {
			readonly op: "quadraticCurveTo";
			readonly points: readonly [number, number, number, number];
	  }
	| {
			readonly op: "bezierCurveTo";
			readonly points: readonly [
				number,
				number,
				number,
				number,
				number,
				number,
			];
	  }
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
			readonly role: "mincho800" | "mincho700" | "dot400";
			readonly size: number;
			readonly weight: 800 | 700 | 400;
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
export interface MvTrainSurface {
	readonly id: string;
	readonly size: readonly [number, number];
	readonly operations: readonly MvTrainOperation[];
}
export interface MvTrainPlan {
	readonly version: 1;
	readonly profile: "night-train-v1";

	readonly logicalSize: readonly [1920, 1080];
	readonly songTicks: number;
	readonly frozen: boolean;
	readonly heldSongSeconds: number;
	readonly front: number;
	readonly tail: number;
	readonly velocity: number;
	readonly heroWindow: number | null;
	readonly post: {
		readonly required: true;
		readonly lutA: "P4";
		readonly lutMix: 0.18;
		readonly bloom: 0.55;
		readonly bloomThreshold: 0.6;
		readonly grain: number;
		readonly vignette: 0.28;
		readonly ca: number;
		readonly saturation: number;
		readonly contrast: 1.05;
		readonly boil: number;
	};
	readonly fontStacks: readonly MvTrainFontStack[];
	readonly surfaces: readonly MvTrainSurface[];
	readonly operations: readonly MvTrainOperation[];
	readonly allocationBytes: number;
	readonly operationCount: number;
}
