import {
	drawRotatedRect,
	estimatedTextWidth,
	layoutGlyphs,
} from "./core-layout-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function layoutAText(options: TypographyLayoutOptions): string {
	return options.frame.cut?.text.trim() || "MOTION TEXT";
}

export function layoutAUnits({
	count,
	text,
}: {
	readonly count: number;
	readonly text: string;
}): string[] {
	const words = text.trim().split(/\s+/u).filter(Boolean);
	if (words.length >= count) {
		const units: string[] = [];
		for (let index = 0; index < count; index += 1) {
			const start = Math.floor((index * words.length) / count);
			const end = Math.floor(((index + 1) * words.length) / count);
			units.push(words.slice(start, Math.max(start + 1, end)).join(" "));
		}
		return units;
	}
	const glyphs = layoutGlyphs(text);
	if (glyphs.length === 0) return [text];
	const units: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const start = Math.floor((index * glyphs.length) / count);
		const end = Math.floor(((index + 1) * glyphs.length) / count);
		const unit = glyphs.slice(start, Math.max(start + 1, end)).join("");
		if (unit) units.push(unit);
	}
	return units;
}

export function layoutASize({
	height,
	maxHeightRatio,
	maxWidthRatio,
	text,
	width,
}: {
	readonly height: number;
	readonly maxHeightRatio: number;
	readonly maxWidthRatio: number;
	readonly text: string;
	readonly width: number;
}): number {
	const glyphCount = Math.max(1, layoutGlyphs(text).length);
	return Math.max(
		12,
		Math.min(
			height * maxHeightRatio,
			(width * maxWidthRatio) / Math.max(1, glyphCount * 0.62),
		),
	);
}

export function layoutADrawLine({
	alpha = 1,
	color,
	ctx,
	fromX,
	fromY,
	thickness,
	toX,
	toY,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: TypographyLayoutOptions["ctx"];
	readonly fromX: number;
	readonly fromY: number;
	readonly thickness: number;
	readonly toX: number;
	readonly toY: number;
}): void {
	const dx = toX - fromX;
	const dy = toY - fromY;
	drawRotatedRect({
		alpha,
		color,
		ctx,
		height: thickness,
		rotation: Math.atan2(dy, dx),
		width: Math.hypot(dx, dy),
		x: fromX + dx / 2,
		y: fromY + dy / 2,
	});
}

export function layoutADrawFrame({
	alpha = 1,
	color,
	ctx,
	height,
	left,
	thickness,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: TypographyLayoutOptions["ctx"];
	readonly height: number;
	readonly left: number;
	readonly thickness: number;
	readonly top: number;
	readonly width: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(left, top, width, thickness);
	ctx.fillRect(left, top + height - thickness, width, thickness);
	ctx.fillRect(left, top, thickness, height);
	ctx.fillRect(left + width - thickness, top, thickness, height);
	ctx.globalAlpha = baseAlpha;
}

export function layoutADrawPlate({
	alpha = 1,
	color,
	ctx,
	height,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: TypographyLayoutOptions["ctx"];
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(x - width / 2, y - height / 2, width, height);
	ctx.globalAlpha = baseAlpha;
}

export function layoutATextWidth({
	maxWidth,
	size,
	text,
}: {
	readonly maxWidth: number;
	readonly size: number;
	readonly text: string;
}): number {
	return Math.min(maxWidth, estimatedTextWidth({ size, text }));
}
