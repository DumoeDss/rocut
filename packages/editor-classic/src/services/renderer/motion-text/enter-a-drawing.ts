import {
	clamp01,
	clipEnterBPolygon,
	degrees,
	drawEnterBClipped,
	drawEnterBDot,
	drawEnterBGlyph,
	drawEnterBGlyphs,
	drawEnterBLine,
	drawEnterBRing,
	drawEnterBWhole,
	enterBBounds,
	enterBDirection,
	enterBGlyphs,
	enterBOutBack,
	enterBOutQuart,
	enterBOutQuint,
	enterBPhase,
	enterBRandom,
	enterBRandomSigned,
	enterBSeconds,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	type EnterBDraw,
	type EnterBGlyph,
	type EnterBGlyphTransform,
} from "./enter-b-drawing";
import { mixHex } from "./exit-hold-geometry";

export type EnterADraw = EnterBDraw;
export type EnterAGlyph = EnterBGlyph;
export type EnterAGlyphTransform = EnterBGlyphTransform;

export {
	clamp01,
	clipEnterBPolygon as clipEnterAPolygon,
	degrees,
	drawEnterBClipped as drawEnterAClipped,
	drawEnterBDot as drawEnterADot,
	drawEnterBGlyph as drawEnterAGlyph,
	drawEnterBGlyphs as drawEnterAGlyphs,
	drawEnterBLine as drawEnterALine,
	drawEnterBRing as drawEnterARing,
	drawEnterBWhole as drawEnterAWhole,
	enterBBounds as enterABounds,
	enterBDirection as enterADirection,
	enterBGlyphs as enterAGlyphs,
	enterBOutBack as enterAOutBack,
	enterBOutQuart as enterAOutQuart,
	enterBOutQuint as enterAOutQuint,
	enterBPhase as enterAPhase,
	enterBRandom as enterARandom,
	enterBRandomSigned as enterARandomSigned,
	enterBSeconds as enterASeconds,
	inOutCubic,
	inOutSine,
	lerp,
	mixHex,
	outCubic,
};

export function enterAOutExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

export function enterAInQuad(value: number): number {
	return clamp01(value) ** 2;
}

export function enterAInCubic(value: number): number {
	return clamp01(value) ** 3;
}

export function enterAInOutQuart(value: number): number {
	const progress = clamp01(value);
	return progress < 0.5 ? 8 * progress ** 4 : 1 - (-2 * progress + 2) ** 4 / 2;
}

export function enterASmooth({
	end,
	start,
	value,
}: {
	readonly end: number;
	readonly start: number;
	readonly value: number;
}): number {
	const progress = clamp01((value - start) / Math.max(0.0001, end - start));
	return progress * progress * (3 - 2 * progress);
}

export function enterACenterOrder(glyph: EnterAGlyph): number {
	return Math.abs(glyph.order - 0.5) * 2;
}

export function enterAFrameStep(options: EnterADraw): number {
	return Math.floor(enterBSeconds(options) * 24);
}

export function drawEnterAOutlineGlyph({
	alpha = 1,
	color,
	glyph,
	lineWidth,
	options,
	transform = {},
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly glyph: EnterAGlyph;
	readonly lineWidth: number;
	readonly options: EnterADraw;
	readonly transform?: EnterAGlyphTransform;
}): void {
	const {
		alpha: transformAlpha = 1,
		character = glyph.character,
		clipX,
		clipY,
		rotation = 0,
		scaleX = 1,
		scaleY = 1,
		skewX = 0,
		translateX = 0,
		translateY = 0,
	} = transform;
	if (
		alpha * transformAlpha <= 0.003 ||
		Math.abs(scaleX) < 0.004 ||
		Math.abs(scaleY) < 0.004
	) {
		return;
	}
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const baseStroke = ctx.strokeStyle;
	const baseWidth = ctx.lineWidth;
	ctx.save();
	ctx.translate(glyph.x + translateX, glyph.y + translateY);
	if (rotation) ctx.rotate(rotation);
	if (skewX) ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	ctx.scale(scaleX, scaleY);
	if (clipX || clipY) {
		const left = (clipX?.[0] ?? -1.6) * glyph.width;
		const right = (clipX?.[1] ?? 1.6) * glyph.width;
		const top = (clipY?.[0] ?? -1.2) * glyph.height;
		const bottom = (clipY?.[1] ?? 1.2) * glyph.height;
		if (right <= left || bottom <= top) {
			ctx.restore();
			return;
		}
		ctx.beginPath();
		ctx.rect(left, top, right - left, bottom - top);
		ctx.clip();
	}
	ctx.globalAlpha = baseAlpha * alpha * transformAlpha;
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth / Math.max(0.05, Math.abs(scaleX));
	ctx.textAlign = "center";
	ctx.strokeText(
		character,
		0,
		0,
		options.size * Math.max(0.76, Math.abs(scaleX)),
	);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
	ctx.strokeStyle = baseStroke;
	ctx.lineWidth = baseWidth;
}

export function drawEnterAWholeOutline({
	alpha = 1,
	color,
	lineWidth,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	translateX = 0,
	translateY = 0,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly lineWidth: number;
	readonly options: EnterADraw;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	const baseStroke = ctx.strokeStyle;
	const baseWidth = ctx.lineWidth;
	ctx.save();
	ctx.translate(options.x + translateX, options.y + translateY);
	if (rotation) ctx.rotate(rotation);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth / Math.max(0.05, Math.abs(scaleX));
	ctx.strokeText(options.text, 0, 0, options.maxWidth);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
	ctx.strokeStyle = baseStroke;
	ctx.lineWidth = baseWidth;
}
