import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export type CoreDecorLayer = "back" | "front";

export interface CoreDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly decor: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export interface CoreDecorPlan {
	readonly accent: boolean;
	readonly big: boolean;
	readonly corner: boolean;
	readonly count: number;
	readonly from: number;
	readonly low: boolean;
	readonly mode: "count" | "index";
	readonly right: boolean;
	readonly seed: number;
	readonly to: number;
}

export interface CoreDecorBounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly width: number;
	readonly height: number;
}

export interface CoreDecorPoint {
	readonly x: number;
	readonly y: number;
}
