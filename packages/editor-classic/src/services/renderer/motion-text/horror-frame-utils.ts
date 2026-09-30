import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export const TICKS_PER_SECOND = 120_000;

export interface HorrorTextBounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly width: number;
	readonly height: number;
}

export function horrorTextBounds({
	frame,
	height,
	width,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}): HorrorTextBounds {
	const characters = Array.from(frame.cut?.text ?? "");
	const size = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	const vertical = frame.cut?.preset.layout === "vcols";
	const textWidth = vertical
		? size * 1.2
		: Math.min(width * 0.86, Math.max(size, characters.length * size * 0.62));
	const textHeight = vertical
		? Math.min(height * 0.8, Math.max(size, characters.length * size * 1.05))
		: size * 1.25;
	return {
		x0: width / 2 - textWidth / 2,
		x1: width / 2 + textWidth / 2,
		y0: height / 2 - textHeight / 2,
		y1: height / 2 + textHeight / 2,
		width: textWidth,
		height: textHeight,
	};
}

export function drawHorrorSegment({
	alpha,
	color,
	ctx,
	thickness,
	x0,
	x1,
	y0,
	y1,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly thickness: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): void {
	const length = Math.hypot(x1 - x0, y1 - y0);
	if (length <= 0.01 || thickness <= 0.01 || alpha <= 0.001) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x0, y0);
	ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
	ctx.fillStyle = color;
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillRect(0, -thickness / 2, length, thickness);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

export function activeHorrorAlpha(frame: MotionTextRenderFrame): number {
	return smooth(frame.enterProgress) * smooth(1 - frame.exitProgress);
}

export function localSeconds(frame: MotionTextRenderFrame): number {
	return frame.localTime / TICKS_PER_SECOND;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function lerp({
	start,
	end,
	progress,
}: {
	readonly start: number;
	readonly end: number;
	readonly progress: number;
}): number {
	return start + (end - start) * progress;
}

export function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

export function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}

export function outBack({
	value,
	overshoot = 1.7,
}: {
	readonly value: number;
	readonly overshoot?: number;
}): number {
	const shifted = clamp01(value) - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

export function smooth(value: number): number {
	const progress = clamp01(value);
	return progress * progress * (3 - 2 * progress);
}
