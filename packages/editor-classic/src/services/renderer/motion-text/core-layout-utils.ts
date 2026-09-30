import { signedRandom, unitRandom } from "./deterministic-random";
import type { MotionTextCanvasContext } from "./types";

export function layoutGlyphs(text: string): string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}

export function estimatedTextWidth({
	size,
	text,
}: {
	readonly size: number;
	readonly text: string;
}): number {
	return Array.from(text).reduce(
		(width, character) => width + size * (/\s/u.test(character) ? 0.34 : 0.62),
		0,
	);
}

// Variadic salts keep deterministic layout call sites compact and readable.
// eslint-disable-next-line opencut/prefer-object-params
export function layoutUnit(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x45d9f3b) | 0;
		value ^= value >>> 16;
	}
	return unitRandom({ seed: value, salt: salts.length + 701 });
}

// Variadic salts keep deterministic layout call sites compact and readable.
// eslint-disable-next-line opencut/prefer-object-params
export function layoutSigned(seed: number, ...salts: number[]): number {
	let value = seed | 0;
	for (const salt of salts) {
		value = Math.imul(value ^ (salt | 0), 0x119de1f3) | 0;
		value ^= value >>> 13;
	}
	return signedRandom({ seed: value, salt: salts.length + 709 });
}

export function drawRotatedRect({
	alpha = 1,
	color,
	ctx,
	height,
	rotation,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly height: number;
	readonly rotation: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(-width / 2, -height / 2, width, height);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function drawDiscBands({
	alpha = 1,
	color,
	ctx,
	radius,
	scaleX = 1,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly scaleX?: number;
	readonly x: number;
	readonly y: number;
}): void {
	const bands = 22;
	const bandHeight = (radius * 2) / bands;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	for (let band = 0; band < bands; band += 1) {
		const centerY = -radius + (band + 0.5) * bandHeight;
		const normalized = centerY / radius;
		const halfWidth =
			radius * Math.sqrt(Math.max(0, 1 - normalized * normalized)) * scaleX;
		ctx.fillRect(
			x - halfWidth,
			y + centerY - bandHeight / 2,
			halfWidth * 2,
			bandHeight + 0.6,
		);
	}
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
