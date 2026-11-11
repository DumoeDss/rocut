import {
	clipEnterBPolygon,
	drawEnterBDot,
	drawEnterBLine,
	drawEnterBRing,
	enterBGlyphs,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inCubic,
	inOutCubic,
	mixHex,
	outCubic,
	secondsOf,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext } from "./types";
import {
	x2Bounds,
	x2IsKanji,
	x2Random,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

/**
 * JIZURA pack `x2treat` (追加分2, v0.12) — forty text treatments: fills,
 * outlines, depth, plates & marks, per-glyph alternation and print looks.
 *
 * Each part transliterates its JIZURA definition onto the x2 surface with the
 * house simplifications: single-line horizontal runs, no item gradients or
 * pattern fills (banded clipped passes and contour hatches stand in), no
 * extrude layer (stepped offset copies), no dash/round-cap/ellipse canvas
 * features (hand-drawn dashes, dot caps, scaled arcs), and the planner's
 * per-cut `plan` parameters re-derived deterministically from the cut seed.
 * Glyphs are painted directly so a treatment never re-enters the treatment
 * dispatch while entrance/hold passes draw glyph by glyph.
 */
const TAU = Math.PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

/** Out-back easing (JIZURA `E.outBack`). */
// eslint-disable-next-line opencut/prefer-object-params
function outBackOf(value: number, overshoot = 1.70158): number {
	const v = clamp(value) - 1;
	return 1 + (overshoot + 1) * v ** 3 + overshoot * v ** 2;
}

function outExpoOf(value: number): number {
	const v = clamp(value);
	return v >= 1 ? 1 : 1 - 2 ** (-10 * v);
}

function glyphsOf(options: X2Draw): readonly X2Glyph[] {
	return enterBGlyphs(options);
}

/** Enter window in seconds (JIZURA `cut.inDur` approximation from the cut duration). */
function enterWindowOf(options: X2Draw): number {
	const duration = options.frame.cut?.duration ?? 0;
	return duration > 0 ? Math.min(0.3, duration / 120_000) : 0.3;
}

/** Effect fade-in (JIZURA `inP`): seconds since the cut started over `len`. */
// eslint-disable-next-line opencut/prefer-object-params
function inProgress(options: X2Draw, delay: number, len: number): number {
	return clamp((secondsOf(options.frame) - delay) / len);
}

/** Effect fade-out with the exit (JIZURA `outK`). */
function exitFade(options: X2Draw): number {
	return 1 - inCubic(clamp01(options.frame.exitProgress));
}

/* ------------------------------------------------------------------ */
/* planner parameters — deterministic from the cut seed               */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line opencut/prefer-object-params
function pickOf<T>(options: X2Draw, salt: number, values: readonly T[]): T {
	return values[
		Math.floor(x2Random(options, 0, salt) * values.length) % values.length
	]!;
}

// eslint-disable-next-line opencut/prefer-object-params
function rangeOf(options: X2Draw, salt: number, lo: number, hi: number): number {
	return lo + (hi - lo) * x2Random(options, 0, salt);
}

// eslint-disable-next-line opencut/prefer-object-params
function chanceOf(options: X2Draw, salt: number, probability: number): boolean {
	return x2Random(options, 0, salt) < probability;
}

// eslint-disable-next-line opencut/prefer-object-params
function intOf(options: X2Draw, salt: number, lo: number, hi: number): number {
	return Math.floor(lo + (hi - lo + 1) * x2Random(options, 0, salt));
}

/* ------------------------------------------------------------------ */
/* colour helpers (JIZURA scheme math over the four-slot palette)      */
/* ------------------------------------------------------------------ */

function isHexColor(color: string): boolean {
	return /^#[0-9a-f]{3}|^#[0-9a-f]{6}/iu.test(color);
}

function rgbOf(color: string): readonly [number, number, number] {
	const hex = color.replace("#", "");
	const full =
		hex.length === 3
			? hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!
			: hex.slice(0, 6);
	const value = Number.parseInt(full, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminanceOf(color: string): number {
	if (!isHexColor(color)) return 0.5;
	const [r, g, b] = rgbOf(color);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function channelOf(value: number): number {
	const v = value / 255;
	return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG contrast ratio (JIZURA `J.contrast`). */
// eslint-disable-next-line opencut/prefer-object-params
function contrastOf(a: string, b: string): number {
	if (!isHexColor(a) || !isHexColor(b)) return 1;
	const pa = rgbOf(a);
	const pb = rgbOf(b);
	const la =
		0.2126 * channelOf(pa[0]) +
		0.7152 * channelOf(pa[1]) +
		0.0722 * channelOf(pa[2]);
	const lb =
		0.2126 * channelOf(pb[0]) +
		0.7152 * channelOf(pb[1]) +
		0.0722 * channelOf(pb[2]);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nudge a colour away from the background until it reads (JIZURA
 * `J.fitContrast`); mixing toward the extreme stands in for the lightness walk.
 */
// eslint-disable-next-line opencut/prefer-object-params
function fitContrastOf(color: string, background: string, min: number): string {
	if (contrastOf(color, background) >= min) return color;
	const toward = luminanceOf(background) < 0.5 ? "#FFFFFF" : "#111111";
	let current = color;
	for (let index = 0; index < 24; index += 1) {
		current = mixHex({ from: current, progress: 0.035, to: toward });
		if (contrastOf(current, background) >= min) return current;
	}
	return toward;
}

// eslint-disable-next-line opencut/prefer-object-params
function bestOf(colors: readonly string[], against: string): string {
	let best = colors[0] ?? against;
	let bestValue = -1;
	for (const color of colors) {
		if (!isHexColor(color)) continue;
		const value = contrastOf(color, against);
		if (value > bestValue) {
			bestValue = value;
			best = color;
		}
	}
	return best;
}

/** An accent that differs from the text colour and still reads on the background. */
// eslint-disable-next-line opencut/prefer-object-params
function accentForOf(options: X2Draw, min: number): string {
	const palette = options.frame.palette;
	for (const candidate of [palette.accent, palette.secondary]) {
		if (
			contrastOf(candidate, palette.foreground) >= min &&
			contrastOf(candidate, palette.background) >= 1.5
		) {
			return candidate;
		}
	}
	return fitContrastOf(
		palette.accent,
		palette.foreground,
		min + 0.3,
	);
}

/** Second fill colour for two-tone glyphs (JIZURA `twoTone`). */
function twoToneOf(options: X2Draw): string {
	const palette = options.frame.palette;
	for (const candidate of [palette.accent, palette.secondary]) {
		if (
			contrastOf(candidate, palette.foreground) >= 1.5 &&
			contrastOf(candidate, palette.background) >= 2
		) {
			return candidate;
		}
	}
	return mixHex({
		from: palette.foreground,
		progress: 0.45,
		to: palette.background,
	});
}

/** Text colour for glyphs sitting on a plate of the text colour (JIZURA `textOn`). */
function textOnOf(options: X2Draw): string {
	const { background, foreground } = options.frame.palette;
	if (contrastOf(background, foreground) >= 3) return background;
	return bestOf([background, foreground, "#111111", "#FFFFFF"], foreground);
}

/** A colour that stands out from the background for marks next to the text. */
function markColorOf(options: X2Draw): string {
	const palette = options.frame.palette;
	for (const candidate of [palette.accent, palette.secondary]) {
		if (contrastOf(candidate, palette.background) >= 2) return candidate;
	}
	return palette.foreground;
}

/** A quiet shadow tone on the background (JIZURA `shadeCol`). */
function shadeColorOf(options: X2Draw): string {
	const palette = options.frame.palette;
	return luminanceOf(palette.background) < 0.45
		? mixHex({
				from: palette.background,
				progress: 0.5,
				to: accentForOf(options, 1.5),
			})
		: mixHex({
				from: palette.background,
				progress: 0.32,
				to: palette.foreground,
			});
}

/** The text colour sits on a layout plate of its own: marks would vanish (JIZURA `onPlate`). */
function onPlateOf(options: X2Draw): boolean {
	return (
		contrastOf(options.frame.palette.foreground, options.frame.palette.background) <
		1.5
	);
}

/** A whole line or block: marks drawn around the item make sense (JIZURA `lineLike`). */
function lineLike(options: X2Draw): boolean {
	const cutGlyphs = Array.from(options.frame.cut?.text ?? "").filter(
		(character) => character.trim().length > 0,
	);
	return glyphsOf(options).length >= 2 || cutGlyphs.length <= 1;
}

const PUNCT = /[、。，．,.!?！？…‥・「」『』（）()【】〈〉《》〔〕［］[\]'"“”‘’ー〜～:：;；\-—―]/u;

function isPunct(character: string): boolean {
	return PUNCT.test(character);
}

function isKata(character: string): boolean {
	return /[゠-ヿㇰ-ㇿｦ-ﾟ]/u.test(character);
}

function isLatin(character: string): boolean {
	return /[A-Za-z0-9]/u.test(character);
}

/* ------------------------------------------------------------------ */
/* glyph / run painters (raw canvas — never re-enter the treatments)   */
/* ------------------------------------------------------------------ */

interface GlyphPaint {
	readonly alpha?: number;
	readonly character?: string;
	readonly clipX?: readonly [number, number];
	readonly clipY?: readonly [number, number];
	readonly color?: string;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}

function clipGlyphOrSkip({
	ctx,
	glyph,
	paint,
}: {
	readonly ctx: MotionTextCanvasContext;
	readonly glyph: X2Glyph;
	readonly paint: GlyphPaint;
}): boolean {
	const x0 = (paint.clipX?.[0] ?? -1.6) * glyph.width;
	const x1 = (paint.clipX?.[1] ?? 1.6) * glyph.width;
	const y0 = (paint.clipY?.[0] ?? -1.2) * glyph.height;
	const y1 = (paint.clipY?.[1] ?? 1.2) * glyph.height;
	if (x1 <= x0 || y1 <= y0) return false;
	if (paint.clipX || paint.clipY) {
		ctx.beginPath();
		ctx.rect(x0, y0, x1 - x0, y1 - y0);
		ctx.clip();
	}
	return true;
}

function fillGlyphOf({
	glyph,
	options,
	paint = {},
}: {
	readonly glyph: X2Glyph;
	readonly options: X2Draw;
	readonly paint?: GlyphPaint;
}): void {
	const alpha = paint.alpha ?? 1;
	const scaleX = paint.scaleX ?? 1;
	const scaleY = paint.scaleY ?? 1;
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const { ctx } = options;
	ctx.save();
	ctx.translate(glyph.x + (paint.translateX ?? 0), glyph.y + (paint.translateY ?? 0));
	if (paint.rotation) ctx.rotate(paint.rotation);
	ctx.scale(scaleX, scaleY);
	if (!clipGlyphOrSkip({ ctx, glyph, paint })) {
		ctx.restore();
		return;
	}
	ctx.globalAlpha *= alpha;
	ctx.textAlign = "center";
	ctx.fillStyle = paint.color ?? options.frame.palette.foreground;
	ctx.fillText(
		paint.character ?? glyph.character,
		0,
		0,
		options.size * Math.max(0.76, Math.abs(scaleX)),
	);
	ctx.restore();
}

function strokeGlyphOf({
	color,
	glyph,
	lineWidth,
	options,
	paint = {},
}: {
	readonly color: string;
	readonly glyph: X2Glyph;
	readonly lineWidth: number;
	readonly options: X2Draw;
	readonly paint?: GlyphPaint;
}): void {
	const alpha = paint.alpha ?? 1;
	const scaleX = paint.scaleX ?? 1;
	const scaleY = paint.scaleY ?? 1;
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const { ctx } = options;
	ctx.save();
	ctx.translate(glyph.x + (paint.translateX ?? 0), glyph.y + (paint.translateY ?? 0));
	if (paint.rotation) ctx.rotate(paint.rotation);
	ctx.scale(scaleX, scaleY);
	if (!clipGlyphOrSkip({ ctx, glyph, paint })) {
		ctx.restore();
		return;
	}
	ctx.globalAlpha *= alpha;
	ctx.lineWidth = lineWidth / Math.max(0.05, Math.abs(scaleX));
	ctx.strokeStyle = color;
	ctx.textAlign = "center";
	ctx.strokeText(
		paint.character ?? glyph.character,
		0,
		0,
		options.size * Math.max(0.76, Math.abs(scaleX)),
	);
	ctx.restore();
}

function fillRunOf({
	alpha = 1,
	color,
	offsetX = 0,
	offsetY = 0,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly offsetX?: number;
	readonly offsetY?: number;
	readonly options: X2Draw;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
}): void {
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const { ctx } = options;
	ctx.save();
	ctx.translate(options.x + offsetX, options.y + offsetY);
	if (rotation) ctx.rotate(rotation);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha *= alpha;
	ctx.textAlign = "center";
	ctx.fillStyle = color;
	ctx.fillText(options.text, 0, 0, options.maxWidth);
	ctx.restore();
}

function strokeRunOf({
	alpha = 1,
	color,
	lineWidth,
	offsetX = 0,
	offsetY = 0,
	options,
	rotation = 0,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly lineWidth: number;
	readonly offsetX?: number;
	readonly offsetY?: number;
	readonly options: X2Draw;
	readonly rotation?: number;
}): void {
	if (alpha <= 0.003 || lineWidth <= 0.05) return;
	const { ctx } = options;
	ctx.save();
	ctx.translate(options.x + offsetX, options.y + offsetY);
	if (rotation) ctx.rotate(rotation);
	ctx.globalAlpha *= alpha;
	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = color;
	ctx.textAlign = "center";
	ctx.strokeText(options.text, 0, 0, options.maxWidth);
	ctx.restore();
}

function fillRectOf({
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
	readonly options: X2Draw;
	readonly top: number;
	readonly width: number;
}): void {
	if (width <= 0.05 || height <= 0.05 || alpha <= 0.003) return;
	const { ctx } = options;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = color;
	ctx.fillRect(left, top, width, height);
	ctx.restore();
}

function fillPolyOf({
	alpha = 1,
	color,
	options,
	points,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly options: X2Draw;
	readonly points: readonly (readonly [number, number])[];
}): void {
	if (points.length < 3 || alpha <= 0.003) return;
	const { ctx } = options;
	if (ctx.moveTo && ctx.lineTo && ctx.fill) {
		ctx.save();
		ctx.globalAlpha *= alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.fill();
		ctx.restore();
		return;
	}
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	fillRectOf({
		alpha,
		color,
		height: Math.max(...ys) - top,
		left,
		options,
		top,
		width: Math.max(...xs) - left,
	});
}

/** A polyline drawn up to a fraction of its total length (JIZURA `polyPartial`). */
function drawPartialPolyline({
	alpha,
	color,
	options,
	points,
	progress,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: X2Draw;
	readonly points: readonly (readonly [number, number])[];
	readonly progress: number;
	readonly width: number;
}): void {
	if (points.length < 2 || alpha <= 0.003 || width <= 0.05) return;
	const lengths: number[] = [];
	let total = 0;
	for (let index = 0; index + 1 < points.length; index += 1) {
		const length = Math.hypot(
			points[index + 1]![0] - points[index]![0],
			points[index + 1]![1] - points[index]![1],
		);
		lengths.push(length);
		total += length;
	}
	if (total <= 0.05) return;
	let remaining = total * clamp01(progress);
	for (let index = 0; index < lengths.length && remaining > 0.05; index += 1) {
		const length = lengths[index]!;
		const fraction = Math.min(1, remaining / length);
		const from = points[index]!;
		const to = points[index + 1]!;
		drawEnterBLine({
			alpha,
			color,
			from,
			options,
			to: [
				from[0] + (to[0] - from[0]) * fraction,
				from[1] + (to[1] - from[1]) * fraction,
			],
			width,
		});
		remaining -= length;
	}
}

function ellipseOf({
	alpha,
	color,
	options,
	radiusX,
	radiusY,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: X2Draw;
	readonly radiusX: number;
	readonly radiusY: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radiusX <= 0.05 || radiusY <= 0.05 || alpha <= 0.003) return;
	const { ctx } = options;
	ctx.save();
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.translate(x, y);
		ctx.scale(1, radiusY / radiusX);
		ctx.beginPath();
		ctx.arc(0, 0, radiusX, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(x - radiusX, y - radiusY, radiusX * 2, radiusY * 2);
	}
	ctx.restore();
}

/** A marching dash pattern walked along a rect perimeter (JIZURA `strokeDash`). */
function drawDashedRect({
	alpha,
	color,
	dashOff,
	dashOn,
	height,
	left,
	lineWidth,
	offset,
	options,
	top,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly dashOff: number;
	readonly dashOn: number;
	readonly height: number;
	readonly left: number;
	readonly lineWidth: number;
	readonly offset: number;
	readonly options: X2Draw;
	readonly top: number;
	readonly width: number;
}): void {
	const total = 2 * (width + height);
	if (total <= 0.05 || dashOn <= 0.05) return;
	const period = dashOn + dashOff;
	const start = (((offset % period) + period) % period) - period;
	const pointAt = (s: number): readonly [number, number] => {
		const v = ((s % total) + total) % total;
		if (v < width) return [left + v, top];
		if (v < width + height) return [left + width, top + v - width];
		if (v < width * 2 + height) {
			return [left + width - (v - width - height), top + height];
		}
		return [left, top + height - (v - width * 2 - height)];
	};
	for (let x = start; x < total; x += period) {
		const a = Math.max(x, 0);
		const b = Math.min(x + dashOn, total);
		if (b <= a) continue;
		drawEnterBLine({
			alpha,
			color,
			from: pointAt(a),
			options,
			to: pointAt(b),
			width: lineWidth,
		});
	}
}

/** Contour-hatch stand-in for a JIZURA pattern fill (dots / grid / lines). */
function hatchGlyphOf({
	clipY,
	color,
	glyph,
	horizontalOnly,
	options,
}: {
	readonly clipY?: readonly [number, number];
	readonly color: string;
	readonly glyph: X2Glyph;
	readonly horizontalOnly: boolean;
	readonly options: X2Draw;
}): void {
	const step = options.size * 0.09;
	const lineWidth = Math.max(1, options.size * 0.012);
	for (const k of [-2, -1, 1, 2]) {
		if (!horizontalOnly) {
			strokeGlyphOf({
				color,
				glyph,
				lineWidth,
				options,
				paint: { alpha: 0.5, clipY, translateX: k * step },
			});
		}
		strokeGlyphOf({
			color,
			glyph,
			lineWidth,
			options,
			paint: { alpha: 0.5, clipY, translateY: k * step },
		});
	}
}

/** Glyph positions with a tracking offset between neighbours (JIZURA `it.track`). */
function trackedGlyphsOf({
	options,
	tracking,
}: {
	readonly options: X2Draw;
	readonly tracking: number;
}): readonly X2Glyph[] {
	const characters = Array.from(options.text);
	const advances = characters.map((character) =>
		/\s/u.test(character) ? options.size * 0.34 : options.size * 0.62,
	);
	const visible = characters.filter(
		(character) => !/\s/u.test(character),
	).length;
	const natural = advances.reduce((sum, advance) => sum + advance, 0);
	const trackingWidth = Math.max(0, visible - 1) * tracking;
	const scale =
		natural + trackingWidth > 0
			? Math.min(1, options.maxWidth / (natural + trackingWidth))
			: 1;
	const width = (natural + trackingWidth) * scale;
	const startX =
		options.ctx.textAlign === "left" || options.ctx.textAlign === "start"
			? options.x
			: options.ctx.textAlign === "right" || options.ctx.textAlign === "end"
				? options.x - width
				: options.x - width / 2;
	let cursor = startX;
	const glyphs: X2Glyph[] = [];
	for (const [index, character] of characters.entries()) {
		const advance = (advances[index] ?? 0) * scale;
		if (/\s/u.test(character)) {
			cursor += advance;
			continue;
		}
		glyphs.push({
			character,
			height: options.size,
			index: glyphs.length,
			order: 0,
			width: options.size * 0.62 * scale,
			x: cursor + advance / 2,
			y: options.y,
		});
		cursor += advance + tracking * scale;
	}
	const denominator = Math.max(1, glyphs.length - 1);
	return glyphs.map((glyph) => ({ ...glyph, order: glyph.index / denominator }));
}

function spanOf(glyphs: readonly X2Glyph[]): number {
	const first = glyphs[0];
	const last = glyphs.at(-1);
	if (!first || !last) return 0;
	return last.x + last.width / 2 - (first.x - first.width / 2);
}

/** A thick round-capped stroke (round caps via dot ends; the context has none). */
function drawCappedLine({
	alpha = 1,
	color,
	from,
	options,
	to,
	width,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly from: readonly [number, number];
	readonly options: X2Draw;
	readonly to: readonly [number, number];
	readonly width: number;
}): void {
	drawEnterBLine({ alpha, color, from, options, to, width });
	for (const point of [from, to]) {
		drawEnterBDot({
			alpha,
			color,
			options,
			radius: width / 2,
			x: point[0],
			y: point[1],
		});
	}
}

export function drawX2Treatment(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "xoAccentTicks":
		case "xoAltHollow":
		case "xoAltWeight":
		case "xoBandExtrude":
		case "xoBeltBand":
		case "xoBlobKnock":
		case "xoBlowUp":
		case "xoBorderBands":
		case "xoContour":
		case "xoCropMarks":
		case "xoCutLine":
		case "xoDiagSplit":
		case "xoDimLine":
		case "xoDoublePrint":
		case "xoEmboss":
		case "xoFadeHem":
		case "xoFloorShadow":
		case "xoFoldHalf":
		case "xoGlyphCorners":
		case "xoGlyphUnders":
		case "xoGraphFill":
		case "xoGroundDots":
		case "xoHalfKnock":
		case "xoHalfScreen":
		case "xoHiliter":
		case "xoHollowBlock":
		case "xoLeadBar":
		case "xoMixedFills":
		case "xoOffsetFrame":
		case "xoOverlapKern":
		case "xoRampAcross":
		case "xoRuler":
		case "xoSeparators":
		case "xoSwoosh":
		case "xoTallWide":
		case "xoTapedNote":
		case "xoThread":
		case "xoTopCrop":
		case "xoTrackRamp":
		case "xoTwinOutline":
			return drawX2TreatmentPart(options);
		default:
			return false;
	}
}

function drawX2TreatmentPart(options: EnterBDraw): boolean {
	const state = {
		fillStyle: options.ctx.fillStyle,
		filter: options.ctx.filter,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		strokeStyle: options.ctx.strokeStyle,
		textAlign: options.ctx.textAlign,
	} as const;
	options.ctx.save();
	try {
		switch (options.frame.cut?.preset.treat) {
			case "xoAccentTicks":
				return drawAccentTicks(options);
			case "xoAltHollow":
				return drawAltHollow(options);
			case "xoAltWeight":
				return drawAltWeight(options);
			case "xoBandExtrude":
				return drawBandExtrude(options);
			case "xoBeltBand":
				return drawBeltBand(options);
			case "xoBlobKnock":
				return drawBlobKnock(options);
			case "xoBlowUp":
				return drawBlowUp(options);
			case "xoBorderBands":
				return drawBorderBands(options);
			case "xoContour":
				return drawContour(options);
			case "xoCropMarks":
				return drawCropMarks(options);
			case "xoCutLine":
				return drawCutLine(options);
			case "xoDiagSplit":
				return drawDiagSplit(options);
			case "xoDimLine":
				return drawDimLine(options);
			case "xoDoublePrint":
				return drawDoublePrint(options);
			case "xoEmboss":
				return drawEmboss(options);
			case "xoFadeHem":
				return drawFadeHem(options);
			case "xoFloorShadow":
				return drawFloorShadow(options);
			case "xoFoldHalf":
				return drawFoldHalf(options);
			case "xoGlyphCorners":
				return drawGlyphCorners(options);
			case "xoGlyphUnders":
				return drawGlyphUnders(options);
			case "xoGraphFill":
				return drawGraphFill(options);
			case "xoGroundDots":
				return drawGroundDots(options);
			case "xoHalfKnock":
				return drawHalfKnock(options);
			case "xoHalfScreen":
				return drawHalfScreen(options);
			case "xoHiliter":
				return drawHiliter(options);
			case "xoHollowBlock":
				return drawHollowBlock(options);
			case "xoLeadBar":
				return drawLeadBar(options);
			case "xoMixedFills":
				return drawMixedFills(options);
			case "xoOffsetFrame":
				return drawOffsetFrame(options);
			case "xoOverlapKern":
				return drawOverlapKern(options);
			case "xoRampAcross":
				return drawRampAcross(options);
			case "xoRuler":
				return drawRuler(options);
			case "xoSeparators":
				return drawSeparators(options);
			case "xoSwoosh":
				return drawSwoosh(options);
			case "xoTallWide":
				return drawTallWide(options);
			case "xoTapedNote":
				return drawTapedNote(options);
			case "xoThread":
				return drawThread(options);
			case "xoTopCrop":
				return drawTopCrop(options);
			case "xoTrackRamp":
				return drawTrackRamp(options);
			case "xoTwinOutline":
				return drawTwinOutline(options);
			default:
				return false;
		}
	} finally {
		options.ctx.restore();
		options.ctx.fillStyle = state.fillStyle;
		options.ctx.filter = state.filter;
		options.ctx.globalAlpha = state.globalAlpha;
		options.ctx.lineWidth = state.lineWidth;
		options.ctx.strokeStyle = state.strokeStyle;
		options.ctx.textAlign = state.textAlign;
	}
}

/* ------------------------------------------------------------------ */
/* FILLS                                                              */
/* ------------------------------------------------------------------ */

/** 横流し色 — the colour runs from the text colour to an accent glyph by glyph along the line. */
function drawRampAcross(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const second = twoToneOf(options);
	const glyphs = glyphsOf(options);
	if (glyphs.length < 2) return false;
	const reverse = chanceOf(options, 801, 0.4);
	const mid = pickOf(options, 802, ["ramp", "ramp", "mid"] as const) === "mid";
	for (const glyph of glyphs) {
		const u = reverse ? 1 - glyph.order : glyph.order;
		const fillWeight = mid ? 1 - Math.abs(u * 2 - 1) : u;
		fillGlyphOf({
			glyph,
			options,
			paint: {
				color:
					fillWeight <= 0.01
						? palette.foreground
						: mixHex({
								from: palette.foreground,
								progress: fillWeight,
								to: second,
							}),
			},
		});
	}
	return true;
}

/** 中帯色 — a belt of accent colour through the waist of every glyph, set off by hairline gaps. */
function drawBeltBand(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const second = twoToneOf(options);
	const at = rangeOf(options, 811, 0.36, 0.43);
	const bandHeight = rangeOf(options, 812, 0.2, 0.26);
	const gap = onPlateOf(options) ? 0 : 0.02;
	const low = at;
	const high = at + bandHeight;
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({ glyph, options, paint: { color: palette.foreground } });
		fillGlyphOf({
			glyph,
			options,
			paint: {
				clipY: [low + gap - 0.5, high - gap - 0.5],
				color: second,
			},
		});
		if (gap > 0) {
			fillGlyphOf({
				glyph,
				options,
				paint: { clipY: [low - 0.5, low + gap - 0.5], color: palette.background },
			});
			fillGlyphOf({
				glyph,
				options,
				paint: { clipY: [high - gap - 0.5, high - 0.5], color: palette.background },
			});
		}
	}
	return true;
}

/** 折り目 — every glyph split down the middle: one half in a shaded tone, like folded paper. */
function drawFoldHalf(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const variant = pickOf(options, 821, ["tone", "tone", "acc"] as const);
	const at = rangeOf(options, 822, -0.04, 0.04);
	let second =
		variant === "acc"
			? twoToneOf(options)
			: luminanceOf(palette.foreground) < 0.5
				? mixHex({
						from: palette.foreground,
						progress: 0.42,
						to: "#FFFFFF",
					})
				: mixHex({
						from: palette.foreground,
						progress: 0.36,
						to: "#000000",
					});
	if (
		contrastOf(second, palette.background) < 1.6 ||
		contrastOf(second, palette.foreground) < 1.25
	) {
		second = mixHex({
			from: palette.foreground,
			progress: 0.5,
			to: palette.background,
		});
	}
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({ glyph, options, paint: { color: second } });
		fillGlyphOf({
			glyph,
			options,
			paint: { clipX: [-0.8, at], color: palette.foreground },
		});
	}
	return true;
}

/** 斜め二色 — one slanted edge crosses the whole lyric; past it prints the second colour. */
function drawDiagSplit(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const second = twoToneOf(options);
	const angleDeg = pickOf(options, 831, [24, 32, 40, 148, 156] as const);
	const at = rangeOf(options, 832, -0.12, 0.12);
	fillRunOf({ color: palette.foreground, options });
	const q =
		outCubic(inProgress(options, enterWindowOf(options) * 0.3, 0.5)) *
		exitFade(options);
	if (q <= 0.01) return true;
	const bounds = x2Bounds(options);
	const reach = Math.hypot(bounds.width / 2, bounds.height / 2) + options.size;
	const angle = degrees(angleDeg);
	const nx = Math.cos(angle);
	const ny = Math.sin(angle);
	const off = reach * (1 - q) + at * bounds.width;
	const px = bounds.centerX + nx * off;
	const py = bounds.centerY + ny * off;
	const tx = -ny;
	const ty = nx;
	const long = reach * 4;
	clipEnterBPolygon({
		draw: () => fillRunOf({ color: second, options }),
		options,
		points: [
			[px + tx * long, py + ty * long],
			[px - tx * long, py - ty * long],
			[px - tx * long + nx * long, py - ty * long + ny * long],
			[px + tx * long + nx * long, py + ty * long + ny * long],
		],
	});
	return true;
}

/** 方眼塗り — graph-paper fill: a fine grid in the text colour over a pale tone, held by a keyline. */
function drawGraphFill(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const variant = pickOf(options, 841, ["tone", "tone", "duo"] as const);
	const tone =
		variant === "duo"
			? accentForOf(options, 1.6)
			: mixHex({ from: palette.foreground, progress: 0.7, to: palette.background });
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({ glyph, options, paint: { color: tone } });
		hatchGlyphOf({ color: palette.foreground, glyph, horizontalOnly: false, options });
		strokeGlyphOf({
			color: palette.foreground,
			glyph,
			lineWidth: Math.max(1.3, options.size * 0.022),
			options,
		});
	}
	return true;
}

/** 裾ぼかし — the glyphs dissolve toward their feet (or heads) into nothing. */
function drawFadeHem(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const up = chanceOf(options, 851, 0.3);
	const fade = rangeOf(options, 852, 0.34, 0.46);
	const lowAlpha = rangeOf(options, 853, 0.06, 0.14);
	const midAlpha = (1 + lowAlpha) / 2;
	const bands = up
		? ([
				[-0.5, 0.08 - 0.5, lowAlpha],
				[0.08 - 0.5, 1 - fade - 0.5, midAlpha],
				[1 - fade - 0.5, 0.5, 1],
			] as const)
		: ([
				[-0.5, fade - 0.5, 1],
				[fade - 0.5, 0.92 - 0.5, midAlpha],
				[0.92 - 0.5, 0.5, lowAlpha],
			] as const);
	for (const glyph of glyphsOf(options)) {
		for (const [from, to, alpha] of bands) {
			fillGlyphOf({
				glyph,
				options,
				paint: {
					alpha,
					clipY: [from, to],
					color: palette.foreground,
				},
			});
		}
	}
	return true;
}

/** 半分網点 — the top of every glyph is solid ink, the lower part screened into dots or lines. */
function drawHalfScreen(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const at = rangeOf(options, 861, -0.02, 0.09);
	const pattern = pickOf(options, 862, ["dots", "dots", "lines"] as const);
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({
			glyph,
			options,
			paint: { clipY: [-0.8, at], color: palette.foreground },
		});
		hatchGlyphOf({
			clipY: [at, 0.8],
			color: palette.foreground,
			glyph,
			horizontalOnly: pattern === "lines",
			options,
		});
		strokeGlyphOf({
			color: palette.foreground,
			glyph,
			lineWidth: Math.max(1.2, options.size * 0.016),
			options,
		});
	}
	return true;
}

/** ボーダー柄 — broad horizontal bands of two colours, like a striped shirt. */
function drawBorderBands(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const second = twoToneOf(options);
	const count = pickOf(options, 871, [5, 5, 6, 7] as const);
	const first = chanceOf(options, 872, 0.5);
	const low = 0.07;
	const span = 0.86;
	for (let band = 0; band < count; band += 1) {
		const color =
			(band % 2 === 0) === first ? palette.foreground : second;
		const from = low + (span * band) / count - 0.5;
		const to = low + (span * (band + 1)) / count - 0.5;
		for (const glyph of glyphsOf(options)) {
			fillGlyphOf({ glyph, options, paint: { clipY: [from, to], color } });
		}
	}
	return true;
}

/* ------------------------------------------------------------------ */
/* OUTLINES                                                           */
/* ------------------------------------------------------------------ */

/** 等高線 — hollow glyphs drawn as three concentric contour lines. */
function drawContour(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const unitScale = rangeOf(options, 881, 0.016, 0.02);
	const accentOuter = chanceOf(options, 882, 0.4);
	const outer = accentOuter ? accentForOf(options, 1.4) : palette.foreground;
	const unit = Math.max(1.3, options.size * unitScale);
	const small =
		options.size <
		Math.min(options.maxWidth / 0.86, options.size * 4) * 0.085;
	if (!small) {
		strokeRunOf({ color: outer, lineWidth: unit * 9, options });
		strokeRunOf({ color: palette.background, lineWidth: unit * 7, options });
	}
	strokeRunOf({
		color: small ? outer : palette.foreground,
		lineWidth: unit * 5,
		options,
	});
	strokeRunOf({ color: palette.background, lineWidth: unit * 3, options });
	strokeRunOf({ color: palette.foreground, lineWidth: unit * 1.15, options });
	return true;
}

/** 切り取り線 — solid glyphs with a dashed coupon line running around them at a distance. */
function drawCutLine(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const distance = rangeOf(options, 891, 0.15, 0.19);
	const ringColor = intOf(options, 892, 0, 1)
		? markColorOf(options)
		: accentForOf(options, 1.3);
	fillRunOf({ color: palette.foreground, options });
	const q = outCubic(inProgress(options, 0.05, 0.4)) * exitFade(options);
	if (q <= 0.02) return true;
	const size = options.size;
	const offset = size * distance * (0.55 + 0.45 * q);
	const lineWidth = Math.max(1.6, size * 0.022);
	for (const glyph of glyphsOf(options)) {
		drawDashedRect({
			alpha: q,
			color: ringColor,
			dashOff: size * 0.065,
			dashOn: size * 0.085,
			height: glyph.height + offset * 2,
			left: glyph.x - glyph.width / 2 - offset,
			lineWidth,
			offset: 0,
			options,
			top: glyph.y - glyph.height / 2 - offset,
			width: glyph.width + offset * 2,
		});
	}
	return true;
}

/** 交互袋 — solid and hollow glyphs take turns (or: kana hollow, kanji solid). */
function drawAltHollow(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const variant = pickOf(options, 901, ["alt", "alt", "kana"] as const);
	const first = chanceOf(options, 902, 0.5);
	const lineWidth = Math.max(1.3, options.size * 0.024);
	const characters = Array.from(options.text).filter(
		(character) => character.trim().length > 0,
	);
	const isK = (character: string): boolean =>
		x2IsKanji(character) || isKata(character) || isLatin(character);
	const kanaMode =
		variant === "kana" &&
		characters.some(isK) &&
		characters.some((character) => !isK(character) && !isPunct(character));
	for (const glyph of glyphsOf(options)) {
		const hollow = kanaMode
			? !isK(glyph.character) && !isPunct(glyph.character)
			: (glyph.index + (first ? 0 : 1)) % 2 === 1;
		if (hollow) {
			strokeGlyphOf({ color: palette.foreground, glyph, lineWidth, options });
		} else {
			fillGlyphOf({ glyph, options, paint: { color: palette.foreground } });
		}
	}
	return true;
}

/** 二重線字 — no fill at all: two hairline outlines in two colours, knocked apart. */
function drawTwinOutline(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const distanceScale = rangeOf(options, 911, 0.045, 0.065);
	const dir = pickOf(options, 912, [
		[1, 1],
		[1, 1],
		[-1, 1],
		[1, 0],
		[0.5, -1],
	] as const);
	const lineWidthScale = rangeOf(options, 913, 0.024, 0.03);
	const second = accentForOf(options, 1.3);
	const lineWidth = Math.max(1.5, options.size * lineWidthScale);
	const q = outCubic(inProgress(options, 0.02, 0.4)) * exitFade(options);
	const distance = options.size * distanceScale * q;
	strokeRunOf({
		color: second,
		lineWidth,
		offsetX: dir[0] * distance,
		offsetY: dir[1] * distance,
		options,
	});
	strokeRunOf({ color: palette.foreground, lineWidth, options });
	return true;
}

/** 塊抜き — a fat rim fuses the line into one blob of text colour; the glyphs knock out of it. */
function drawBlobKnock(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const rimScale = rangeOf(options, 921, 0.26, 0.34);
	const ink = textOnOf(options);
	strokeRunOf({
		color: palette.foreground,
		lineWidth: options.size * rimScale,
		options,
	});
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({ glyph, options, paint: { color: ink } });
	}
	return true;
}

/* ------------------------------------------------------------------ */
/* DEPTH                                                              */
/* ------------------------------------------------------------------ */

/** 浮き彫り — a light edge one side, a dark edge the other: the glyphs stand out like a relief. */
function drawEmboss(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const depthScale = rangeOf(options, 931, 0.028, 0.038);
	const flip = chanceOf(options, 932, 0.25);
	let high = mixHex({ from: palette.foreground, progress: 0.7, to: "#FFFFFF" });
	let low = mixHex({ from: palette.foreground, progress: 0.62, to: "#000000" });
	if (contrastOf(high, palette.foreground) < 1.3) {
		high = accentForOf(options, 1.3);
	}
	if (contrastOf(low, palette.foreground) < 1.3) {
		low = accentForOf(options, 1.3);
	}
	if (contrastOf(low, palette.background) < 1.15) {
		low = mixHex({ from: palette.background, progress: 0.35, to: palette.foreground });
	}
	if (contrastOf(high, palette.background) < 1.15) {
		high = mixHex({ from: palette.background, progress: 0.3, to: palette.foreground });
	}
	const depth = options.size * depthScale * (flip ? -1 : 1);
	fillRunOf({
		color: low,
		offsetX: depth,
		offsetY: depth,
		options,
	});
	fillRunOf({
		color: high,
		offsetX: -depth,
		offsetY: -depth,
		options,
	});
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 縞立体 — the extruded side is built from bands of alternating colour. */
function drawBandExtrude(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const depthScale = rangeOf(options, 941, 0.15, 0.2);
	const dir = pickOf(options, 942, [
		[1, 1],
		[1, 1],
		[-1, 1],
		[1, 0.5],
	] as const);
	const glyphs = glyphsOf(options);
	const bandA = accentForOf(options, 1.6);
	const bandB =
		contrastOf(palette.secondary, bandA) >= 1.4 &&
		contrastOf(palette.secondary, palette.foreground) >= 1.3 &&
		contrastOf(palette.secondary, palette.background) >= 1.3
			? palette.secondary
			: mixHex({
					from: bandA,
					progress: 0.45,
					to: luminanceOf(bandA) < 0.45 ? "#FFFFFF" : "#000000",
				});
	const step = (options.size * depthScale) / 3;
	const layers = Math.min(
		glyphs.length > 10 ? 4 : 7,
		Math.max(2, Math.round(step / 2.5)),
	);
	for (let layer = layers; layer >= 1; layer -= 1) {
		fillRunOf({
			color: layer % 2 === 0 ? bandA : bandB,
			offsetX: dir[0] * step * layer,
			offsetY: dir[1] * step * layer,
			options,
		});
	}
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 床影 — the glyphs stand on a floor and throw a slanted, fading shadow toward the viewer. */
function drawFloorShadow(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const lengthScale = rangeOf(options, 951, 0.42, 0.56);
	const skew = rangeOf(options, 952, 0.55, 0.9) * (chanceOf(options, 953, 0.5) ? 1 : -1);
	const alphaScale = rangeOf(options, 954, 0.7, 0.9);
	const shade = shadeColorOf(options);
	fillRunOf({ color: palette.foreground, options });
	const q = outCubic(inProgress(options, 0.04, 0.45)) * exitFade(options);
	if (q <= 0.01) return true;
	const bounds = x2Bounds(options);
	const size = options.size;
	const length = lengthScale * q;
	const baseline = bounds.bottom - size * 0.075;
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	ctx.rect(
		options.x - options.maxWidth,
		baseline,
		options.maxWidth * 2,
		size * Math.max(0.05, length) * 1.05,
	);
	ctx.clip();
	ctx.translate(0, baseline);
	ctx.transform(1, 0, skew, 1, 0, 0);
	ctx.scale(1, -Math.max(0.02, length));
	ctx.translate(0, -baseline);
	ctx.globalAlpha *= alphaScale * q * 0.55;
	ctx.textAlign = "center";
	ctx.fillStyle = shade;
	ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
	return true;
}

/** 接地影 — a small oval contact shadow under every glyph. */
function drawGroundDots(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const widthScale = rangeOf(options, 961, 0.4, 0.48);
	const heightScale = rangeOf(options, 962, 0.05, 0.065);
	const shade = shadeColorOf(options);
	fillRunOf({ color: palette.foreground, options });
	const q = outCubic(inProgress(options, 0.02, 0.3)) * exitFade(options);
	if (q <= 0.01) return true;
	for (const glyph of glyphsOf(options)) {
		if (isPunct(glyph.character)) continue;
		const radiusX = Math.max(glyph.width, options.size * 0.5) * widthScale;
		const radiusY = options.size * heightScale;
		ellipseOf({
			alpha: q * 0.85,
			color: shade,
			options,
			radiusX,
			radiusY,
			x: glyph.x,
			y: glyph.y + glyph.height * 0.5 + radiusY * 0.9,
		});
	}
	return true;
}

/** 白抜き立体 — sign-painter block: paper-coloured face with a keyline, solid colour side. */
function drawHollowBlock(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const depthScale = rangeOf(options, 971, 0.09, 0.13);
	const dir = pickOf(options, 972, [
		[1, 1],
		[1, 1],
		[-1, 1],
		[1, 0.5],
	] as const);
	const keyScale = rangeOf(options, 973, 0.026, 0.034);
	const glyphs = glyphsOf(options);
	const depth = options.size * depthScale;
	const layers = Math.min(
		glyphs.length > 10 ? 10 : 18,
		Math.max(4, Math.round(depth / 2.5)),
	);
	for (let layer = layers; layer >= 1; layer -= 1) {
		fillRunOf({
			color: palette.foreground,
			offsetX: dir[0] * depth * layer,
			offsetY: dir[1] * depth * layer,
			options,
		});
	}
	for (const glyph of glyphs) {
		fillGlyphOf({ glyph, options, paint: { color: palette.background } });
		strokeGlyphOf({
			color: palette.foreground,
			glyph,
			lineWidth: Math.max(1.5, options.size * keyScale),
			options,
		});
	}
	return true;
}

/** 拡大写し — a pale blown-up copy of the lyric swells out behind it. */
function drawBlowUp(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const scale = rangeOf(options, 981, 1.24, 1.4);
	const alphaScale = rangeOf(options, 982, 0.1, 0.15);
	if (options.size > Math.min(options.maxWidth / 0.86, options.size * 4) * 0.5) {
		return false;
	}
	const q = outCubic(inProgress(options, 0, 0.7)) * exitFade(options);
	if (q > 0.02) {
		const growth =
			1 + (scale - 1) * q * (1 + 0.04 * Math.sin(secondsOf(options.frame) * 1.7));
		fillRunOf({
			alpha: alphaScale * q,
			color: palette.foreground,
			options,
			scaleX: growth,
			scaleY: growth,
		});
	}
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/* ------------------------------------------------------------------ */
/* PLATES & MARKS                                                     */
/* ------------------------------------------------------------------ */

/** 頭バー — a heading marker in front of the lyric: a solid bar, pointer triangle or square. */
function drawLeadBar(options: EnterBDraw): boolean {
	if (!lineLike(options)) return false;
	const palette = options.frame.palette;
	const variant = pickOf(options, 1001, ["bar", "bar", "tri", "sq"] as const);
	const barScale = rangeOf(options, 1002, 0.1, 0.15);
	const color = markColorOf(options);
	const q = outExpoOf(inProgress(options, 0.04, 0.4)) * exitFade(options);
	if (q <= 0.01) return false;
	const bounds = x2Bounds(options);
	const size = options.size;
	const edge = bounds.left - size * 0.2;
	const middle = options.y;
	const half = (size * 0.96 * q) / 2;
	if (variant === "tri") {
		const tip = size * 0.4 * q;
		fillPolyOf({
			color,
			options,
			points: [
				[edge - tip * 0.95, middle - tip],
				[edge, middle],
				[edge - tip * 0.95, middle + tip],
			],
		});
	} else if (variant === "sq") {
		const tip = size * 0.17 * q;
		fillPolyOf({
			color,
			options,
			points: [
				[edge - tip * 2, middle - tip],
				[edge, middle - tip],
				[edge, middle + tip],
				[edge - tip * 2, middle + tip],
			],
		});
	} else {
		const barWidth = size * barScale;
		fillPolyOf({
			color,
			options,
			points: [
				[edge - barWidth, middle - half],
				[edge, middle - half],
				[edge, middle + half],
				[edge - barWidth, middle + half],
			],
		});
	}
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 寸法線 — a thin dimension line under the line, closed by ticks, dots or arrow heads. */
function drawDimLine(options: EnterBDraw): boolean {
	if (glyphsOf(options).length < 2) return false;
	const palette = options.frame.palette;
	const variant = pickOf(options, 1011, ["tick", "tick", "dot", "arrow"] as const);
	const color = markColorOf(options);
	fillRunOf({ color: palette.foreground, options });
	const q = outExpoOf(inProgress(options, 0.1, 0.5));
	const alpha = exitFade(options);
	if (q <= 0.01 || alpha <= 0.01) return true;
	const bounds = x2Bounds(options);
	const size = options.size;
	const lineWidth = Math.max(1.5, size * 0.022);
	const offset = options.y + size * 0.64;
	const from = bounds.centerX - (bounds.width / 2) * q;
	const to = bounds.centerX + (bounds.width / 2) * q;
	drawEnterBLine({
		alpha,
		color,
		from: [from, offset],
		options,
		to: [to, offset],
		width: lineWidth,
	});
	const tick = size * 0.1;
	for (const [u, direction] of [
		[from, -1],
		[to, 1],
	] as const) {
		if (variant === "dot") {
			drawEnterBDot({ alpha, color, options, radius: size * 0.045, x: u, y: offset });
		} else if (variant === "arrow") {
			fillPolyOf({
				alpha,
				color,
				options,
				points: [
					[u + direction * tick * 0.5, offset],
					[u - direction * tick * 0.9, offset - tick * 0.55],
					[u - direction * tick * 0.9, offset + tick * 0.55],
				],
			});
		} else {
			drawEnterBLine({
				alpha,
				color,
				from: [u, offset - tick],
				options,
				to: [u, offset + tick],
				width: lineWidth,
			});
		}
	}
	return true;
}

/** トンボ — printer's crop marks sit off the four corners of the lyric block. */
function drawCropMarks(options: EnterBDraw): boolean {
	if (!lineLike(options)) return false;
	const palette = options.frame.palette;
	const lengthScale = rangeOf(options, 1021, 0.24, 0.32);
	const withReg = chanceOf(options, 1022, 0.6);
	let color = palette.foreground;
	for (const candidate of [palette.secondary, palette.foreground]) {
		if (contrastOf(candidate, palette.background) >= 2.2) {
			color = candidate;
			break;
		}
	}
	fillRunOf({ color: palette.foreground, options });
	const q = outCubic(inProgress(options, enterWindowOf(options) * 0.4, 0.4));
	const alpha = q * exitFade(options);
	if (alpha <= 0.01) return true;
	const bounds = x2Bounds(options);
	const size = options.size;
	const pad = size * 0.12;
	const gap = size * (0.1 + 0.25 * (1 - q));
	const arm = size * lengthScale;
	const lineWidth = Math.max(1.2, size * 0.013);
	const x0 = bounds.left - pad;
	const x1 = bounds.right + pad;
	const y0 = bounds.top - pad;
	const y1 = bounds.bottom + pad;
	for (const [x, y, dx, dy] of [
		[x0, y0, -1, -1],
		[x1, y0, 1, -1],
		[x1, y1, 1, 1],
		[x0, y1, -1, 1],
	] as const) {
		drawEnterBLine({
			alpha,
			color,
			from: [x + dx * gap, y],
			options,
			to: [x + dx * (gap + arm), y],
			width: lineWidth,
		});
		drawEnterBLine({
			alpha,
			color,
			from: [x, y + dy * gap],
			options,
			to: [x, y + dy * (gap + arm)],
			width: lineWidth,
		});
	}
	if (withReg) {
		const radius = size * 0.085;
		const tx = x0 - gap - arm * 0.5;
		const ty = bounds.centerY;
		drawEnterBRing({
			alpha,
			color,
			options,
			radius,
			width: lineWidth,
			x: tx,
			y: ty,
		});
		drawEnterBLine({
			alpha,
			color,
			from: [tx - radius * 1.7, ty],
			options,
			to: [tx + radius * 1.7, ty],
			width: lineWidth,
		});
		drawEnterBLine({
			alpha,
			color,
			from: [tx, ty - radius * 1.7],
			options,
			to: [tx, ty + radius * 1.7],
			width: lineWidth,
		});
	}
	return true;
}

/** 区切り点 — the glyphs are spaced out and a small mark sits in every gap. */
function drawSeparators(options: EnterBDraw): boolean {
	const glyphs = glyphsOf(options);
	if (glyphs.length < 2) return false;
	const variant = pickOf(options, 1031, ["dot", "dot", "slash", "rule"] as const);
	const track = rangeOf(options, 1032, 0.26, 0.34);
	const color = markColorOf(options);
	const tracked = trackedGlyphsOf({ options, tracking: options.size * track });
	const sizeScale = Math.min(
		1,
		Math.max(0.6, (x2Bounds(options).width * 1.05) / Math.max(1, spanOf(tracked))),
	);
	for (const glyph of tracked) {
		fillGlyphOf({
			glyph,
			options,
			paint: { scaleX: sizeScale, scaleY: sizeScale },
		});
	}
	const size = options.size;
	const cross = size;
	const lineWidth = Math.max(1.3, size * 0.02);
	for (let index = 0; index + 1 < tracked.length; index += 1) {
		const a = tracked[index]!;
		const b = tracked[index + 1]!;
		if (isPunct(a.character) || isPunct(b.character)) continue;
		const q =
			outBackOf(
				inProgress(options, enterWindowOf(options) * 0.4 + index * 0.03, 0.24),
				1.8,
			) * exitFade(options);
		const alpha = Math.min(1, q);
		if (q <= 0.01 || alpha <= 0.01) continue;
		const x = (a.x + a.width / 2 + b.x - b.width / 2) / 2;
		const y = options.y;
		if (variant === "dot") {
			drawEnterBDot({ alpha, color, options, radius: size * 0.05 * q, x, y });
		} else if (variant === "slash") {
			const h = cross * 0.34 * q;
			const w = cross * 0.09 * q;
			drawEnterBLine({
				alpha,
				color,
				from: [x - w, y + h],
				options,
				to: [x + w, y - h],
				width: lineWidth * 1.2,
			});
		} else {
			const h = cross * 0.46 * q;
			drawEnterBLine({
				alpha,
				color,
				from: [x, y - h],
				options,
				to: [x, y + h],
				width: lineWidth * 0.8,
			});
		}
	}
	return true;
}

/** 字ごと下線 — every glyph gets its own short underscore, like the blanks of a form. */
function drawGlyphUnders(options: EnterBDraw): boolean {
	const color = markColorOf(options);
	fillRunOf({ color: options.frame.palette.foreground, options });
	const thickness = Math.max(2, options.size * rangeOf(options, 1041, 0.045, 0.06));
	const widthScale = rangeOf(options, 1042, 0.74, 0.84);
	for (const glyph of glyphsOf(options)) {
		if (isPunct(glyph.character)) continue;
		const q =
			outExpoOf(inProgress(options, 0.06 + glyph.index * 0.035, 0.3)) *
			exitFade(options);
		if (q <= 0.01) continue;
		const length =
			Math.max(glyph.width, options.size * 0.45) * widthScale * q;
		fillRectOf({
			color,
			height: thickness,
			left: glyph.x - length / 2,
			options,
			top: glyph.y + options.size * 0.6 - thickness / 2,
			width: length,
		});
	}
	return true;
}

/** ずらし枠 — a hairline frame draws itself around the lyric over a knocked-off-register tint plate. */
function drawOffsetFrame(options: EnterBDraw): boolean {
	if (!lineLike(options) || onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const distanceScale = rangeOf(options, 1051, 0.1, 0.15);
	const dir = pickOf(options, 1052, [
		[1, 1],
		[1, 1],
		[-1, 1],
		[1, -1],
	] as const);
	const tinted = intOf(options, 1053, 0, 1);
	const base = tinted ? palette.secondary : palette.accent;
	let tone = mixHex({ from: palette.background, progress: 0.34, to: base });
	if (contrastOf(palette.foreground, tone) < 3) {
		tone = mixHex({ from: palette.background, progress: 0.16, to: base });
	}
	const lineColor =
		contrastOf(palette.foreground, palette.background) >= 2
			? palette.foreground
			: markColorOf(options);
	const q = outExpoOf(inProgress(options, 0, 0.5));
	const q2 = inOutCubic(inProgress(options, 0.08, 0.6));
	const fade = exitFade(options);
	if (fade <= 0.01 || q <= 0.005) return false;
	const bounds = x2Bounds(options);
	const size = options.size;
	const pad = size * 0.2;
	const distance = size * distanceScale;
	const x0 = bounds.left - pad;
	const y0 = bounds.top - pad;
	const width = (bounds.width / 2 + pad) * 2;
	const height = (bounds.height / 2 + pad) * 2;
	fillRectOf({
		alpha: fade,
		color: tone,
		height,
		left: x0 + distance * dir[0],
		options,
		top: y0 + distance * dir[1],
		width: width * q,
	});
	drawPartialPolyline({
		alpha: fade,
		color: lineColor,
		options,
		points: [
			[x0, y0],
			[x0 + width, y0],
			[x0 + width, y0 + height],
			[x0, y0 + height],
			[x0, y0],
			[x0 + width * 0.02, y0],
		],
		progress: q2,
		width: Math.max(1.5, size * 0.022),
	});
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 字の角印 — viewfinder ticks hug two opposite corners of every glyph. */
function drawGlyphCorners(options: EnterBDraw): boolean {
	const color = markColorOf(options);
	fillRunOf({ color: options.frame.palette.foreground, options });
	const tickScale = rangeOf(options, 1061, 0.15, 0.2);
	const flip = chanceOf(options, 1062, 0.5);
	const size = options.size;
	const fade = exitFade(options);
	for (const glyph of glyphsOf(options)) {
		if (isPunct(glyph.character)) continue;
		const q = outCubic(inProgress(options, 0.05 + glyph.index * 0.04, 0.3));
		if (q <= 0.01 || fade <= 0.01) continue;
		const halfWidth = Math.max(glyph.width, size * 0.5) * 0.5;
		const halfHeight = size * 0.5;
		const tick = size * tickScale;
		const side = flip ? -1 : 1;
		const growth = 1 + (1 - q) * 0.45;
		const alpha = q * fade;
		const lineWidth = Math.max(1.3, size * 0.02);
		for (const corner of [-1, 1] as const) {
			const cx = corner * side * halfWidth * growth;
			const cy = corner * halfHeight * growth;
			drawEnterBLine({
				alpha,
				color,
				from: [glyph.x + cx, glyph.y + cy - corner * tick * growth],
				options,
				to: [glyph.x + cx, glyph.y + cy],
				width: lineWidth,
			});
			drawEnterBLine({
				alpha,
				color,
				from: [glyph.x + cx, glyph.y + cy],
				options,
				to: [
					glyph.x + cx - corner * side * tick * growth,
					glyph.y + cy,
				],
				width: lineWidth,
			});
		}
	}
	return true;
}

/** 目盛り — a ruler lies under the line: a hairline with short ticks, every fifth one longer. */
function drawRuler(options: EnterBDraw): boolean {
	if (glyphsOf(options).length < 2) return false;
	const color = markColorOf(options);
	fillRunOf({ color: options.frame.palette.foreground, options });
	const fade = exitFade(options);
	if (fade <= 0.01) return true;
	const pitchScale = rangeOf(options, 1071, 0.09, 0.12);
	const up = chanceOf(options, 1072, 0.3);
	const sign = up ? -1 : 1;
	const size = options.size;
	const lineWidth = Math.max(1.2, size * 0.014);
	const bounds = x2Bounds(options);
	const q = outCubic(inProgress(options, 0.08, 0.6));
	if (q <= 0.01) return true;
	const pitch = Math.max(4, size * pitchScale);
	const from = bounds.left - size * 0.05;
	const length = bounds.right + size * 0.05 - from;
	const ticks = Math.min(160, Math.floor(length / pitch));
	const step = length / Math.max(1, ticks);
	const shown = Math.floor(ticks * q);
	const offset = options.y + sign * size * 0.62;
	drawEnterBLine({
		alpha: fade,
		color,
		from: [from, offset],
		options,
		to: [from + step * shown, offset],
		width: lineWidth,
	});
	for (let tick = 0; tick <= shown; tick += 1) {
		const u = from + step * tick;
		const h = size * (tick % 5 === 0 ? 0.13 : 0.065);
		drawEnterBLine({
			alpha: fade,
			color,
			from: [u, offset],
			options,
			to: [u, offset + sign * h],
			width: lineWidth,
		});
	}
	return true;
}

/** 貫き線 — a thin line threads through the text and runs on past both ends; the glyphs sit in front. */
function drawThread(options: EnterBDraw): boolean {
	if (!lineLike(options) || onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const extend = rangeOf(options, 1081, 0.4, 0.7);
	const lineWidthScale = rangeOf(options, 1082, 0.022, 0.03);
	const withDots = chanceOf(options, 1083, 0.6);
	const color = markColorOf(options);
	const lineWidth = Math.max(1.5, options.size * lineWidthScale);
	const q = outExpoOf(inProgress(options, 0, 0.55));
	const out = inCubic(clamp01(options.frame.exitProgress));
	const bounds = x2Bounds(options);
	const size = options.size;
	if (q > 0.005 && out < 1) {
		const from = bounds.left - size * extend;
		const length = bounds.width + size * extend * 2;
		const p0 = from + length * out;
		const p1 = from + length * q;
		const c = options.y + size * 0.02;
		if (p1 - p0 >= 1) {
			drawEnterBLine({
				color,
				from: [p0, c],
				options,
				to: [p1, c],
				width: lineWidth,
			});
			if (withDots) {
				for (const u of [p0, p1]) {
					drawEnterBDot({ color, options, radius: lineWidth * 1.9, x: u, y: c });
				}
			}
		}
	}
	strokeRunOf({
		color: palette.background,
		lineWidth: Math.max(2, size * 0.1),
		options,
	});
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 払い下線 — a tapered brush-pen swoosh under the line: fat where it lands, fine where it lifts. */
function drawSwoosh(options: EnterBDraw): boolean {
	if (glyphsOf(options).length < 2) return false;
	const color = markColorOf(options);
	fillRunOf({ color: options.frame.palette.foreground, options });
	const alpha = exitFade(options);
	if (alpha <= 0.01) return true;
	const brushScale = rangeOf(options, 1091, 0.11, 0.15);
	const bow = rangeOf(options, 1092, 0.05, 0.1);
	const reverse = chanceOf(options, 1093, 0.25);
	const bounds = x2Bounds(options);
	const size = options.size;
	const q = outCubic(inProgress(options, 0.1, 0.45));
	if (q <= 0.01) return true;
	const from = bounds.left - size * 0.08;
	const length = bounds.right + size * 0.14 - from;
	const offset = options.y + size * 0.66;
	const samples = 22;
	const top: [number, number][] = [];
	const bottom: [number, number][] = [];
	for (let sample = 0; sample <= samples; sample += 1) {
		const t = (sample / samples) * q;
		const tt = reverse ? 1 - t : t;
		const thickness =
			size *
			brushScale *
			(0.08 + 0.92 * (1 - t) ** 0.8) *
			Math.sqrt(Math.min(1, t / 0.05 + 0.15));
		const v =
			offset +
			size * bow * (1 - Math.sin(t * Math.PI * 0.85)) -
			size * bow * 0.5;
		top.push([from + length * tt, v - thickness / 2]);
		bottom.push([from + length * tt, v + thickness / 2]);
	}
	fillPolyOf({ alpha, color, options, points: [...top, ...bottom.reverse()] });
	return true;
}

/** 貼り紙 — the lyric sits on a slip of paper held by two strips of tape. */
function drawTapedNote(options: EnterBDraw): boolean {
	if (!lineLike(options) || onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const tilt = rangeOf(options, 1101, 1, 2.4) * (chanceOf(options, 1102, 0.5) ? 1 : -1);
	const tapeBase = intOf(options, 1103, 0, 1) ? palette.secondary : palette.accent;
	const single = chanceOf(options, 1104, 0.3);
	let paper = mixHex({ from: palette.background, progress: 0.16, to: palette.foreground });
	if (contrastOf(palette.foreground, paper) < 2.6) {
		paper = mixHex({ from: palette.background, progress: 0.08, to: palette.foreground });
	}
	const tape = mixHex({ from: tapeBase, progress: 0.25, to: palette.background });
	const q = outBackOf(inProgress(options, 0, 0.36), 1.3);
	const fade = exitFade(options);
	if (q <= 0.01 || fade <= 0.01) return false;
	const bounds = x2Bounds(options);
	const size = options.size;
	const pad = size * 0.24;
	const halfWidth = bounds.width / 2 + pad;
	const halfHeight = bounds.height / 2 + pad * 0.8;
	const alpha = fade * Math.min(1, q * 1.4);
	const { ctx } = options;
	ctx.save();
	ctx.translate(bounds.centerX, bounds.centerY);
	ctx.rotate(degrees(tilt) * (1 + (1 - q) * 3));
	const shrink = 0.9 + 0.1 * q;
	ctx.scale(shrink, shrink);
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = paper;
	ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
	const tapeWidth = Math.min(size * 0.62, halfWidth * 0.9);
	const tapeHeight = size * 0.19;
	const tapeQ = outCubic(inProgress(options, 0.18, 0.25));
	ctx.globalAlpha *= 0.82 * Math.max(0, tapeQ);
	ctx.fillStyle = tape;
	for (const [x, y, rotation] of single
		? ([[0, -halfHeight, -3]] as const)
		: ([
				[-halfWidth, -halfHeight, -40],
				[halfWidth, -halfHeight, 40],
			] as const)) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(degrees(rotation));
		ctx.fillRect(-tapeWidth / 2, -tapeHeight / 2, tapeWidth, tapeHeight);
		ctx.restore();
	}
	ctx.restore();
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 蛍光ペン — two overlapping round-ended passes of a translucent highlighter. */
function drawHiliter(options: EnterBDraw): boolean {
	if (!lineLike(options) || onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const variant = intOf(options, 1111, 0, 1);
	const tilt = rangeOf(options, 1112, -0.035, 0.035);
	const widthScale = rangeOf(options, 1113, 0.46, 0.56);
	const candidates = variant ? [palette.secondary, palette.accent] : [palette.accent, palette.secondary];
	let base = palette.accent;
	for (const candidate of candidates) {
		if (contrastOf(candidate, palette.foreground) >= 2) {
			base = candidate;
			break;
		}
	}
	const ink = fitContrastOf(base, palette.foreground, 2.4);
	const dark = luminanceOf(palette.background) < 0.45;
	fillRunOf({ color: palette.foreground, options });
	const alpha = exitFade(options);
	if (alpha <= 0.01) return true;
	const bounds = x2Bounds(options);
	const size = options.size;
	const length = bounds.width;
	const width1 = size * widthScale;
	const width2 = width1 * 0.8;
	const tiltOffset = length * tilt;
	const passes: readonly {
		readonly delay: number;
		readonly from: readonly [number, number];
		readonly to: readonly [number, number];
		readonly width: number;
	}[] = [
		{
			delay: 0.06,
			from: [bounds.left + width1 * 0.2, options.y - size * 0.06 + tiltOffset],
			to: [bounds.right + size * 0.06, options.y - size * 0.06 - tiltOffset],
			width: width1,
		},
		{
			delay: 0.22,
			from: [bounds.right - width2 * 0.1, options.y + size * 0.26 - tiltOffset * 0.6],
			to: [bounds.left + length * 0.12, options.y + size * 0.3 + tiltOffset * 0.6],
			width: width2,
		},
	];
	for (const pass of passes) {
		const q = outCubic(inProgress(options, pass.delay, 0.3));
		if (q <= 0.01) continue;
		const to: readonly [number, number] = [
			pass.from[0] + (pass.to[0] - pass.from[0]) * q,
			pass.from[1] + (pass.to[1] - pass.from[1]) * q,
		];
		drawCappedLine({
			alpha: alpha * (dark ? 0.8 : 0.62),
			color: ink,
			from: pass.from,
			options,
			to,
			width: pass.width,
		});
	}
	return true;
}

/** 強調線 — three short ticks burst from the top corner of the lyric, like a comic accent. */
function drawAccentTicks(options: EnterBDraw): boolean {
	if (!lineLike(options)) return false;
	const color = markColorOf(options);
	fillRunOf({ color: options.frame.palette.foreground, options });
	const q = outBackOf(inProgress(options, enterWindowOf(options) * 0.6, 0.28), 2.2);
	const fade = exitFade(options);
	if (q <= 0.01 || fade <= 0.01) return true;
	const left = chanceOf(options, 1121, 0.35);
	const count = pickOf(options, 1122, [3, 3, 2] as const);
	const lengthScale = rangeOf(options, 1123, 0.42, 0.56);
	const bounds = x2Bounds(options);
	const size = options.size;
	const sign = left ? -1 : 1;
	const originX = bounds.centerX + sign * (bounds.width / 2 + size * 0.02);
	const originY = bounds.centerY - bounds.height / 2 + size * 0.04;
	const pulse = 1 + 0.07 * Math.sin(secondsOf(options.frame) * 5);
	const lineWidth = Math.max(2.5, size * 0.065);
	const alpha = fade * Math.min(1, q);
	const angles = count === 2 ? [-62, -28] : [-76, -45, -14];
	for (let tick = 0; tick < count; tick += 1) {
		const angle = degrees(angles[tick] ?? 0);
		const r0 = size * 0.22;
		const r1 =
			r0 +
			size * lengthScale * (tick === 1 || count === 2 ? 1 : 0.7) * q * pulse;
		drawCappedLine({
			alpha,
			color,
			from: [
				originX + sign * Math.cos(angle) * r0,
				originY + Math.sin(angle) * r0,
			],
			options,
			to: [
				originX + sign * Math.cos(angle) * r1,
				originY + Math.sin(angle) * r1,
			],
			width: lineWidth,
		});
	}
	return true;
}

/* ------------------------------------------------------------------ */
/* PER-GLYPH ALTERNATION                                              */
/* ------------------------------------------------------------------ */

/** 太細交互 — heavy and light glyphs take turns: every other one fattened, the rest pared down. */
function drawAltWeight(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const weightScale = rangeOf(options, 1131, 0.9, 1.15);
	const first = chanceOf(options, 1132, 0.5);
	const family = options.frame.font.family;
	const black = /black|dela|reggae|potta|pop|brush|rampart/u.test(family);
	const fine =
		/light|^mincho$|mincho_bold|klee|tokumin|shippori|mono|kiwi|sansui|med/u.test(
			family,
		);
	const fatScale = (black ? 0.026 : fine ? 0.062 : 0.045) * weightScale;
	const pareScale = (black ? 0.046 : fine ? 0 : 0.022) * weightScale;
	const heavy = (glyph: X2Glyph): boolean =>
		(glyph.index + (first ? 0 : 1)) % 2 === 0;
	for (const glyph of glyphsOf(options)) {
		if (isPunct(glyph.character)) continue;
		if (heavy(glyph)) {
			strokeGlyphOf({
				color: palette.foreground,
				glyph,
				lineWidth: options.size * fatScale,
				options,
			});
		}
	}
	fillRunOf({ color: palette.foreground, options });
	if (pareScale > 0 && !onPlateOf(options)) {
		for (const glyph of glyphsOf(options)) {
			if (isPunct(glyph.character) || heavy(glyph)) continue;
			strokeGlyphOf({
				color: palette.background,
				glyph,
				lineWidth: options.size * pareScale,
				options,
			});
		}
	}
	return true;
}

/** 長平交互 — condensed-tall and flat-wide glyphs alternate. */
function drawTallWide(options: EnterBDraw): boolean {
	const squeeze = rangeOf(options, 1141, 0.76, 0.82);
	const first = chanceOf(options, 1142, 0.5);
	const stretch = 1.13;
	for (const glyph of glyphsOf(options)) {
		if (isPunct(glyph.character)) {
			fillGlyphOf({ glyph, options, paint: { color: options.frame.palette.foreground } });
			continue;
		}
		const tall = (glyph.index + (first ? 0 : 1)) % 2 === 0;
		fillGlyphOf({
			glyph,
			options,
			paint: tall
				? { scaleX: squeeze, scaleY: stretch }
				: { scaleX: stretch, scaleY: squeeze },
		});
	}
	return true;
}

/** 柄違い — the glyphs cycle through three fills: solid ink, screened dots and ruled lines. */
function drawMixedFills(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const patternB = pickOf(options, 1152, ["lines", "stripes", "hatch"] as const);
	const offset = intOf(options, 1153, 0, 2);
	const tone = mixHex({ from: palette.foreground, progress: 0.72, to: palette.background });
	const keyLine = Math.max(1.2, options.size * 0.02);
	for (const glyph of glyphsOf(options)) {
		const slot = (glyph.index + offset) % 3;
		if (slot === 0) {
			fillGlyphOf({ glyph, options, paint: { color: palette.foreground } });
			continue;
		}
		fillGlyphOf({ glyph, options, paint: { color: tone } });
		hatchGlyphOf({
			color: palette.foreground,
			glyph,
			horizontalOnly: slot === 2 && patternB !== "hatch",
			options,
		});
		strokeGlyphOf({ color: palette.foreground, glyph, lineWidth: keyLine, options });
	}
	return true;
}

/** 字間漸増 — the gaps between glyphs grow step by step along the line, keeping its length. */
function drawTrackRamp(options: EnterBDraw): boolean {
	const glyphs = glyphsOf(options);
	if (glyphs.length < 3) return false;
	const track = rangeOf(options, 1161, 0.3, 0.44);
	const reverse = chanceOf(options, 1162, 0.35);
	const squeeze = 1 / (1 + track);
	const bounds = x2Bounds(options);
	const size = options.size;
	const total = track * bounds.width;
	const center = bounds.centerX;
	const weightSum = Math.max(1, ((glyphs.length - 1) * (glyphs.length - 2)) / 2);
	let cumulative = 0;
	for (let index = 0; index < glyphs.length; index += 1) {
		const glyph = glyphs[index]!;
		const positioned = glyph.x + cumulative;
		const moved =
			center + (positioned - (center + total / 2)) * squeeze;
		fillGlyphOf({
			glyph,
			options,
			paint: {
				scaleX: squeeze,
				scaleY: squeeze,
				translateX: ((moved - glyph.x) / size) * (glyph.height / size),
			},
		});
		if (index < glyphs.length - 1) {
			cumulative +=
				(total * (reverse ? glyphs.length - 2 - index : index)) / weightSum;
		}
	}
	return true;
}

/* ------------------------------------------------------------------ */
/* PRINT LOOKS                                                        */
/* ------------------------------------------------------------------ */

/** 二度刷り — the sheet went through the press twice: a faint second impression, off and askew. */
function drawDoublePrint(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const offsetScale = rangeOf(options, 1171, 0.05, 0.075);
	const rotation = rangeOf(options, 1172, 0.7, 1.5) * (chanceOf(options, 1173, 0.5) ? 1 : -1);
	const alphaScale = rangeOf(options, 1174, 0.34, 0.44);
	const up = chanceOf(options, 1175, 0.5);
	const q = outCubic(inProgress(options, 0.02, 0.35)) * exitFade(options);
	if (q > 0.02) {
		const distance = options.size * offsetScale * q;
		const bounds = x2Bounds(options);
		const along = Math.max(bounds.width, bounds.height);
		fillRunOf({
			alpha: alphaScale,
			color: palette.foreground,
			offsetX: distance,
			offsetY: distance * (up ? -0.45 : 0.45),
			options,
			rotation: degrees(rotation * q * Math.min(1, 700 / Math.max(1, along))),
		});
	}
	fillRunOf({ color: palette.foreground, options });
	return true;
}

/** 半抜き — a solid bar of the text colour covers the lower half; glyphs crossing it flip to the paper colour. */
function drawHalfKnock(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const at = rangeOf(options, 1181, -0.04, 0.1);
	const top = chanceOf(options, 1182, 0.25);
	const ink = textOnOf(options);
	const out = inCubic(clamp01(options.frame.exitProgress));
	const q = outExpoOf(inProgress(options, 0.03, 0.4));
	const bounds = x2Bounds(options);
	const size = options.size;
	const pad = size * 0.16;
	const from = bounds.left - pad;
	const length = bounds.width + pad * 2;
	const p0 = from + length * out;
	const p1 = from + length * q;
	const [v0, v1] = top
		? [options.y - size * 0.62, options.y - size * at]
		: [options.y + size * at, options.y + size * 0.62];
	if (p1 - p0 >= 1) {
		fillRectOf({
			color: palette.foreground,
			height: v1 - v0,
			left: p0,
			options,
			top: v0,
			width: p1 - p0,
		});
	}
	fillRunOf({ color: palette.foreground, options });
	if (p1 - p0 >= 1) {
		const { ctx } = options;
		ctx.save();
		ctx.beginPath();
		ctx.rect(p0, v0, p1 - p0, v1 - v0);
		ctx.clip();
		fillRunOf({ color: ink, options });
		ctx.restore();
	}
	return true;
}

/** 頭切り — the tops of the glyphs are trimmed off along a hairline, as if the sheet were cut there. */
function drawTopCrop(options: EnterBDraw): boolean {
	const palette = options.frame.palette;
	const cropScale = rangeOf(options, 1191, 0.19, 0.24);
	const foot = chanceOf(options, 1192, 0.3);
	const color = markColorOf(options);
	const crop =
		cropScale *
		outCubic(inProgress(options, enterWindowOf(options) * 0.5, 0.35)) *
		exitFade(options);
	if (crop < 0.004) return false;
	const side = foot ? 1 : -1;
	const clipY: readonly [number, number] =
		side > 0 ? [-0.8, 0.5 - crop] : [-0.5 + crop, 0.8];
	for (const glyph of glyphsOf(options)) {
		fillGlyphOf({
			glyph,
			options,
			paint: { clipY, color: palette.foreground },
		});
	}
	if (lineLike(options)) {
		const bounds = x2Bounds(options);
		const size = options.size;
		const q = outExpoOf(
			inProgress(options, enterWindowOf(options) * 0.5, 0.4),
		);
		if (q > 0.01) {
			const lineWidth = Math.max(1.4, size * 0.018);
			const alpha = Math.min(1, (crop / cropScale) * 1.5);
			const from = bounds.left - size * 0.3;
			const length = bounds.width + size * 0.6;
			const v = options.y + side * (0.5 - crop) * size;
			drawEnterBLine({
				alpha,
				color,
				from: [from, v],
				options,
				to: [from + length * q, v],
				width: lineWidth,
			});
		}
	}
	return true;
}

/** 重ね詰め — poster kerning: glyphs overlap, cut apart by a paper-coloured edge. */
function drawOverlapKern(options: EnterBDraw): boolean {
	if (onPlateOf(options)) return false;
	const palette = options.frame.palette;
	const glyphs = glyphsOf(options);
	if (glyphs.length < 2) return false;
	const track = rangeOf(options, 1201, 0.13, 0.17);
	const edgeScale = rangeOf(options, 1202, 0.05, 0.065);
	const latin = /[A-Za-z0-9]/u.test(options.text);
	const tracked = trackedGlyphsOf({
		options,
		tracking: -options.size * track * (latin ? 0.4 : 1),
	});
	const sizeScale = Math.min(
		1.16,
		Math.max(1, x2Bounds(options).width / Math.max(1, spanOf(tracked))),
	);
	const lineWidth = Math.max(2, options.size * edgeScale);
	for (const glyph of tracked) {
		strokeGlyphOf({
			color: palette.background,
			glyph,
			lineWidth,
			options,
			paint: { scaleX: sizeScale, scaleY: sizeScale },
		});
		fillGlyphOf({
			glyph,
			options,
			paint: { color: palette.foreground, scaleX: sizeScale, scaleY: sizeScale },
		});
	}
	return true;
}
