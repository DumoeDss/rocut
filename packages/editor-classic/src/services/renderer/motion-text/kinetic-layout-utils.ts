import { unitRandom } from "./deterministic-random";
import { approximateTextWidth, kineticWordSegments } from "./kinetic-words";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export interface KineticLayoutText {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly maxWidth?: number;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}

export interface KineticRowItem {
	readonly text: string;
	readonly width: number;
	readonly x: number;
}

export function kineticUnits({
	text,
	maximum = 6,
}: {
	readonly text: string;
	readonly maximum?: number;
}): readonly string[] {
	return kineticWordSegments({ text, maximum });
}

export function compactGlyphs(text: string): readonly string[] {
	return Array.from(text).filter((character) => !/\s/u.test(character));
}

export function fitKineticText({
	height,
	maxSize,
	text,
	width,
}: {
	readonly height: number;
	readonly maxSize?: number;
	readonly text: string;
	readonly width: number;
}): number {
	const widthAtOne = Math.max(0.62, approximateTextWidth({ text, size: 1 }));
	return Math.max(12, Math.min(maxSize ?? height, height, width / widthAtOne));
}

export function kineticRow({
	centerX,
	gap,
	size,
	units,
}: {
	readonly centerX: number;
	readonly gap: number;
	readonly size: number;
	readonly units: readonly string[];
}): readonly KineticRowItem[] {
	const widths = units.map((text) => approximateTextWidth({ text, size }));
	const total =
		widths.reduce((sum, width) => sum + width, 0) +
		Math.max(0, units.length - 1) * gap;
	let cursor = centerX - total / 2;
	return units.map((text, index) => {
		const width = widths[index];
		const item = { text, width, x: cursor + width / 2 };
		cursor += width + gap;
		return item;
	});
}

export function drawKineticLayoutText({
	options,
	text,
}: {
	readonly options: TypographyLayoutOptions;
	readonly text: KineticLayoutText;
}): void {
	const {
		align = "center",
		alpha = 1,
		color = options.frame.palette.foreground,
		maxWidth = options.width * 0.9,
		rotation = 0,
		scaleX = 1,
		scaleY = 1,
		size,
		x,
		y,
	} = text;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseAlign = ctx.textAlign;
	const baseFill = ctx.fillStyle;
	options.setFontSize(size);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	const transformed =
		Math.abs(rotation) > Number.EPSILON ||
		Math.abs(scaleX - 1) > Number.EPSILON ||
		Math.abs(scaleY - 1) > Number.EPSILON;
	if (transformed) {
		ctx.save();
		ctx.translate(x, y);
		if (rotation) ctx.rotate(rotation);
		ctx.scale(scaleX, scaleY);
		options.drawText({ text: text.text, x: 0, y: 0, maxWidth, size });
		ctx.restore();
	} else {
		options.drawText({ text: text.text, x, y, maxWidth, size });
	}
	ctx.globalAlpha = baseAlpha;
	ctx.textAlign = baseAlign;
	ctx.fillStyle = baseFill;
}

export function drawKineticRule({
	alpha = 1,
	color,
	height,
	options,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly options: TypographyLayoutOptions;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = options.ctx.globalAlpha;
	const baseFill = options.ctx.fillStyle;
	options.ctx.globalAlpha = baseAlpha * alpha;
	options.ctx.fillStyle = color;
	options.ctx.fillRect(x, y, width, height);
	options.ctx.globalAlpha = baseAlpha;
	options.ctx.fillStyle = baseFill;
}

export function stableIndex({
	count,
	options,
	salt,
}: {
	readonly count: number;
	readonly options: TypographyLayoutOptions;
	readonly salt: number;
}): number {
	if (count <= 1) return 0;
	return Math.min(
		count - 1,
		Math.floor(
			unitRandom({ seed: options.frame.cut?.seed ?? 0, salt }) * count,
		),
	);
}

export function degrees(value: number): number {
	return (value * Math.PI) / 180;
}

export function bell(value: number): number {
	return Math.sin(Math.PI * clamp01(value));
}

export function outCubic(value: number): number {
	return 1 - (1 - clamp01(value)) ** 3;
}

export function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
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

export function inOutCubic(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
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

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
