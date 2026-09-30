import { layoutADrawFrame, layoutADrawPlate } from "./layouts-a-utils";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function layoutDColor({
	index,
	options,
}: {
	readonly index: number;
	readonly options: TypographyLayoutOptions;
}): string {
	const { palette } = options.frame;
	return [palette.accent, palette.secondary, palette.foreground][
		((index % 3) + 3) % 3
	]!;
}

export function layoutDDrawText({
	align = "center",
	alpha = 1,
	color,
	maxWidth,
	options,
	size,
	text,
	x,
	y,
}: {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color: string;
	readonly maxWidth: number;
	readonly options: TypographyLayoutOptions;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx, drawText, setFontSize } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	setFontSize(size);
	drawText({ text, x, y, maxWidth, size });
	ctx.globalAlpha = baseAlpha;
}

export function layoutDDrawCard({
	alpha = 1,
	color,
	frameAlpha = 0.5,
	height,
	options,
	rotation = 0,
	text,
	textColor,
	textSize,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly frameAlpha?: number;
	readonly height: number;
	readonly options: TypographyLayoutOptions;
	readonly rotation?: number;
	readonly text: string;
	readonly textColor: string;
	readonly textSize: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx } = options;
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(rotation);
	layoutADrawPlate({ alpha, color, ctx, height, width, x: 0, y: 0 });
	layoutADrawFrame({
		alpha: alpha * frameAlpha,
		color: textColor,
		ctx,
		height,
		left: -width / 2,
		thickness: Math.max(1, Math.min(width, height) * 0.025),
		top: -height / 2,
		width,
	});
	layoutDDrawText({
		alpha,
		color: textColor,
		maxWidth: width * 0.82,
		options,
		size: textSize,
		text,
		x: 0,
		y: textSize * 0.04,
	});
	ctx.restore();
}

export function layoutDDrawSquareDot({
	alpha = 1,
	color,
	options,
	size,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: TypographyLayoutOptions;
	readonly size: number;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(x - size / 2, y - size / 2, size, size);
	ctx.globalAlpha = baseAlpha;
}

export function layoutDDrawPanel({
	alpha = 1,
	color,
	height,
	left,
	options,
	top,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly height: number;
	readonly left: number;
	readonly options: TypographyLayoutOptions;
	readonly top: number;
	readonly width: number;
}): void {
	const { ctx, frame } = options;
	layoutADrawPlate({
		alpha: alpha * 0.24,
		color: frame.palette.foreground,
		ctx,
		height,
		width,
		x: left + width / 2 + Math.max(2, width * 0.012),
		y: top + height / 2 + Math.max(2, width * 0.012),
	});
	layoutADrawPlate({
		alpha,
		color,
		ctx,
		height,
		width,
		x: left + width / 2,
		y: top + height / 2,
	});
	layoutADrawFrame({
		alpha: alpha * 0.55,
		color: frame.palette.secondary,
		ctx,
		height,
		left,
		thickness: Math.max(1, Math.min(width, height) * 0.012),
		top,
		width,
	});
}
