import type { MotionTextSequence } from "@opencut/editor-contracts";

import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export type LooksScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface LooksPixelContext extends MotionTextCanvasContext {
	readonly canvas: LooksScratchCanvas;
	globalCompositeOperation: GlobalCompositeOperation;
	imageSmoothingEnabled: boolean;
	clearRect(x: number, y: number, width: number, height: number): void;
	drawImage(image: CanvasImageSource, dx: number, dy: number): void;
	drawImage(
		image: CanvasImageSource,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	): void;
	drawImage(
		image: CanvasImageSource,
		sx: number,
		sy: number,
		sWidth: number,
		sHeight: number,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	): void;
}

export interface LooksScreenEffectDraw {
	readonly compositionMode: MotionTextSequence["compositionMode"];
	readonly ctx: MotionTextCanvasContext;
	readonly effect: string;
	readonly effectIndex: number;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export interface LooksScratchSurface {
	readonly canvas: LooksScratchCanvas;
	readonly context: LooksPixelContext;
}

export interface LooksPixelEffectDraw extends LooksScreenEffectDraw {
	readonly ctx: LooksPixelContext;
	readonly source: LooksScratchCanvas;
}

const scratchByCanvas = new WeakMap<object, LooksScratchSurface>();

export function looksEffectProgress(options: LooksScreenEffectDraw): number {
	const seconds = options.frame.localTime / 120_000;
	const cycle = seconds * 0.68 + options.effectIndex * 0.173;
	return ((cycle % 1) + 1) % 1;
}

export function looksEffectPulse(options: LooksScreenEffectDraw): number {
	return Math.sin(Math.PI * looksEffectProgress(options));
}

export function isLooksPixelContext(
	ctx: MotionTextCanvasContext,
): ctx is LooksPixelContext {
	return (
		ctx.canvas !== undefined &&
		typeof ctx.clearRect === "function" &&
		typeof ctx.drawImage === "function" &&
		typeof ctx.globalCompositeOperation === "string" &&
		typeof ctx.imageSmoothingEnabled === "boolean"
	);
}

export function captureLooksSource({
	ctx,
	height,
	width,
}: {
	readonly ctx: LooksPixelContext;
	readonly height: number;
	readonly width: number;
}): LooksScratchSurface | null {
	const surface = scratchSurface({ ctx, height, width });
	if (!surface) return null;
	resizeScratch({ canvas: surface.canvas, height, width });
	surface.context.save();
	surface.context.setTransform(1, 0, 0, 1, 0, 0);
	surface.context.clearRect(0, 0, width, height);
	surface.context.globalAlpha = 1;
	surface.context.globalCompositeOperation = "copy";
	surface.context.filter = "none";
	surface.context.drawImage(ctx.canvas, 0, 0, width, height);
	surface.context.restore();
	return surface;
}

export function restoreLooksSource({
	ctx,
	height,
	source,
	width,
}: {
	readonly ctx: LooksPixelContext;
	readonly height: number;
	readonly source: LooksScratchCanvas;
	readonly width: number;
}): void {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, width, height);
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = "source-over";
	ctx.filter = "none";
	ctx.drawImage(source, 0, 0, width, height);
	ctx.restore();
}

export function fillLooksEffectRect({
	alpha,
	color,
	height,
	options,
	width,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly height: number;
	readonly options: LooksScreenEffectDraw;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	options.ctx.save();
	options.ctx.globalAlpha *= Math.min(1, Math.max(0, alpha));
	if (
		options.compositionMode === "overlay" &&
		typeof options.ctx.globalCompositeOperation === "string"
	) {
		options.ctx.globalCompositeOperation = "source-atop";
	}
	options.ctx.fillStyle = color;
	options.ctx.fillRect(x, y, width, height);
	options.ctx.restore();
}

function scratchSurface({
	ctx,
	height,
	width,
}: {
	readonly ctx: LooksPixelContext;
	readonly height: number;
	readonly width: number;
}): LooksScratchSurface | null {
	const cached = scratchByCanvas.get(ctx.canvas);
	if (cached) return cached;
	const canvas = createScratchCanvas({ height, source: ctx.canvas, width });
	if (!canvas) return null;
	const context = canvas.getContext("2d");
	if (!context || !isLooksPixelContext(context)) return null;
	const surface = { canvas, context };
	scratchByCanvas.set(ctx.canvas, surface);
	return surface;
}

function createScratchCanvas({
	height,
	source,
	width,
}: {
	readonly height: number;
	readonly source: LooksScratchCanvas;
	readonly width: number;
}): LooksScratchCanvas | null {
	if (
		typeof OffscreenCanvas !== "undefined" &&
		source instanceof OffscreenCanvas
	) {
		return new OffscreenCanvas(width, height);
	}
	if ("ownerDocument" in source) {
		const canvas = source.ownerDocument.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(width, height);
	}
	return null;
}

function resizeScratch({
	canvas,
	height,
	width,
}: {
	readonly canvas: LooksScratchCanvas;
	readonly height: number;
	readonly width: number;
}): void {
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
}
