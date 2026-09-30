import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export interface TypographyTextDraw {
	readonly text: string;
	readonly x: number;
	readonly y: number;
	readonly maxWidth: number;
	readonly size: number;
}

export interface TypographyLayoutOptions {
	readonly ctx: MotionTextCanvasContext;
	readonly drawText: (draw: TypographyTextDraw) => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly setFontSize: (size: number) => void;
	readonly width: number;
}
