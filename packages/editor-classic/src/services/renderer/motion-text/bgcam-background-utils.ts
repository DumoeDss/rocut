import { signedRandom, unitRandom } from "./deterministic-random";
import {
	clamp01,
	drawHorrorSegment,
	localSeconds,
	outCubic,
} from "./horror-frame-utils";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export interface BgcamBackgroundDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function backgroundSeconds(frame: MotionTextRenderFrame): number {
	return localSeconds(frame);
}

export function backgroundFade(frame: MotionTextRenderFrame): number {
	return outCubic(frame.localTime / 72_000);
}

export function backgroundUnit(options: BgcamBackgroundDraw): number {
	return Math.min(options.width, options.height);
}

export function phaseOffset({
	frame,
	salt,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly salt: number;
}): number {
	const seed = frame.cut?.seed ?? 0;
	return unitRandom({ seed, salt }) * Math.PI * 2;
}

export function randomUnit({
	frame,
	salt,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly salt: number;
}): number {
	return unitRandom({ seed: frame.cut?.seed ?? 0, salt });
}

export function randomSigned({
	frame,
	salt,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly salt: number;
}): number {
	return signedRandom({ seed: frame.cut?.seed ?? 0, salt });
}

export function drawBackgroundSegment({
	alpha,
	color,
	options,
	thickness,
	x0,
	x1,
	y0,
	y1,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: BgcamBackgroundDraw;
	readonly thickness: number;
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}): void {
	drawHorrorSegment({
		ctx: options.ctx,
		x0,
		y0,
		x1,
		y1,
		thickness,
		color,
		alpha,
	});
}

export function drawBackgroundRing({
	alpha,
	centerX,
	centerY,
	color,
	options,
	radiusX,
	radiusY = radiusX,
	rotation = 0,
	segments = 24,
	thickness,
}: {
	readonly alpha: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly color: string;
	readonly options: BgcamBackgroundDraw;
	readonly radiusX: number;
	readonly radiusY?: number;
	readonly rotation?: number;
	readonly segments?: number;
	readonly thickness: number;
}): void {
	let previousX = centerX + Math.cos(rotation) * radiusX;
	let previousY = centerY + Math.sin(rotation) * radiusY;
	for (let index = 1; index <= segments; index += 1) {
		const angle = rotation + (index / segments) * Math.PI * 2;
		const x = centerX + Math.cos(angle) * radiusX;
		const y = centerY + Math.sin(angle) * radiusY;
		drawBackgroundSegment({
			alpha,
			color,
			options,
			thickness,
			x0: previousX,
			y0: previousY,
			x1: x,
			y1: y,
		});
		previousX = x;
		previousY = y;
	}
}

export function drawBackgroundPolygon({
	alpha,
	color,
	options,
	points,
	thickness,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: BgcamBackgroundDraw;
	readonly points: readonly (readonly [number, number])[];
	readonly thickness: number;
}): void {
	for (let index = 0; index < points.length; index += 1) {
		const current = points[index]!;
		const next = points[(index + 1) % points.length]!;
		drawBackgroundSegment({
			alpha,
			color,
			options,
			thickness,
			x0: current[0],
			y0: current[1],
			x1: next[0],
			y1: next[1],
		});
	}
}

export function fillBackgroundRect({
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
	readonly options: BgcamBackgroundDraw;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.globalAlpha = baseAlpha * clamp01(alpha);
	options.ctx.fillStyle = color;
	options.ctx.fillRect(x, y, width, height);
	options.ctx.globalAlpha = baseAlpha;
}

export function fillRotatedRect({
	alpha,
	color,
	height,
	options,
	rotation,
	width,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly height: number;
	readonly options: BgcamBackgroundDraw;
	readonly rotation: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = options.ctx.globalAlpha;
	options.ctx.save();
	options.ctx.translate(x, y);
	options.ctx.rotate(rotation);
	options.ctx.globalAlpha = baseAlpha * clamp01(alpha);
	options.ctx.fillStyle = color;
	options.ctx.fillRect(-width / 2, -height / 2, width, height);
	options.ctx.restore();
	options.ctx.globalAlpha = baseAlpha;
}

export function wrap({
	modulus,
	value,
}: {
	readonly modulus: number;
	readonly value: number;
}): number {
	return ((value % modulus) + modulus) % modulus;
}

export function smoothPulse({
	frame,
	rate,
	salt,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly rate: number;
	readonly salt: number;
}): number {
	return (
		0.5 +
		Math.sin(
			backgroundSeconds(frame) * Math.PI * 2 * rate +
				phaseOffset({ frame, salt }),
		) *
			0.5
	);
}
