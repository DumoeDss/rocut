type Point = readonly [number, number];
type Rect = readonly [number, number, number, number];
type Color = readonly [number, number, number, number];
type Stop = readonly [number, Color];
export type MvRoadStyle =
	| { readonly kind: "solid"; readonly color: Color }
	| {
			readonly kind: "linear";
			readonly from: Point;
			readonly to: Point;
			readonly stops: readonly Stop[];
	  }
	| {
			readonly kind: "radial";
			readonly from: readonly [number, number, number];
			readonly to: readonly [number, number, number];
			readonly stops: readonly Stop[];
	  };

/** Native Canvas tape. No serialized scene code or derived-pixel resource URLs. */
export type MvRoadAction =
	| {
			readonly kind:
				| "save"
				| "restore"
				| "beginPath"
				| "closePath"
				| "clip"
				| "fill"
				| "stroke";
	  }
	| { readonly kind: "translate"; readonly offset: Point }
	| { readonly kind: "rotate"; readonly radians: number }
	| { readonly kind: "scale"; readonly factors: Point }
	| {
			readonly kind: "transform";
			readonly matrix: readonly [
				number,
				number,
				number,
				number,
				number,
				number,
			];
	  }
	| { readonly kind: "alpha" | "lineWidth"; readonly value: number }
	| { readonly kind: "composite"; readonly value: string }
	| { readonly kind: "filter"; readonly blurPx: number }
	| { readonly kind: "smoothing"; readonly quality: "low" | "medium" | "high" }
	| { readonly kind: "fillStyle" | "strokeStyle"; readonly style: MvRoadStyle }
	| { readonly kind: "lineCap"; readonly value: "butt" | "round" | "square" }
	| { readonly kind: "lineJoin"; readonly value: "miter" | "round" | "bevel" }
	| { readonly kind: "moveTo" | "lineTo"; readonly point: Point }
	| {
			readonly kind: "bezierCurveTo";
			readonly control1: Point;
			readonly control2: Point;
			readonly point: Point;
	  }
	| {
			readonly kind: "arc";
			readonly center: Point;
			readonly radius: number;
			readonly start: number;
			readonly end: number;
	  }
	| {
			readonly kind: "ellipse";
			readonly center: Point;
			readonly radii: Point;
			readonly rotation: number;
			readonly start: number;
			readonly end: number;
	  }
	| { readonly kind: "rectPath" | "fillRect"; readonly rect: Rect }
	| {
			readonly kind: "image";
			readonly source: string;
			readonly sourceKind: "asset" | "surface";
			readonly sourceRect: Rect | null;
			readonly destinationRect: Rect;
			readonly intrinsic: boolean;
	  };

export type MvRoadCommand =
	| {
			readonly kind: "surface";
			readonly id: string;
			readonly size: readonly [number, number];
	  }
	| { readonly kind: "release"; readonly surface: string }
	| {
			readonly kind: "native";
			readonly target: string;
			readonly action: MvRoadAction;
	  }
	| {
			readonly kind: "capture";
			readonly surface: string;
			readonly sourceRect: Rect;
			readonly destinationRect: Rect;
	  }
	| { readonly kind: "foreground"; readonly surface: string };
export type MvRoadPlan = {
	readonly commands: readonly MvRoadCommand[];
	readonly rasterBudgetBytes: number;
};
