import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import {
	drawEnterBDot,
	enterBGlyphs,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	drawExitHoldOutline,
	inCubic,
	inOutCubic,
	inOutSine,
	mixHex,
	outCubic,
	secondsOf,
} from "./exit-hold-geometry";
import { replaceFxBFrame } from "./fx-b-screen-effect-types";
import type { KineticCameraTransform } from "./kinetic-cameras";
import {
	captureLooksSource,
	isLooksPixelContext,
	looksEffectProgress,
	type LooksPixelContext,
	type LooksScreenEffectDraw,
} from "./looks-screen-effect-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import {
	drawX2Glyphs,
	x2Bounds,
	x2Hash,
	x2Hot,
	x2IsKanji,
	x2Random,
	x2Sub,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

/**
 * JIZURA 追加分2 "x2typoB" — typesetting motions (carets, rules, ticks,
 * index numbers, point sizes) across enter / hold / exit / treat, plus four
 * cameras, six screen accents and three transitions.
 *
 * House simplifications shared with the A/B family ports: one text item per
 * cut (JIZURA's solo single-glyph-item branches have no rocut counterpart and
 * are not ported), horizontal writing only (`pt` collapses to x/y), overlays
 * drawn in absolute glyph coordinates instead of item-local space, plan
 * parameters re-derived from the cut seed, and no beat/motion knobs (the
 * source's defaults are used).
 */

const TICKS_PER_SECOND = 120_000;
const TAU = Math.PI * 2;

// eslint-disable-next-line opencut/prefer-object-params
function clamp(value: number, minimum = 0, maximum = 1): number {
	return Math.min(maximum, Math.max(minimum, value));
}

/** JIZURA `HIDE`: this glyph is not on stage. */
function hide(): null {
	return null;
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

function outExpo(value: number): number {
	const progress = clamp(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function isPunct(character: string): boolean {
	return /\p{P}/u.test(character);
}

const SMALL_KANA = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮゕゖ";

function isSmallKana(character: string): boolean {
	return character.length === 1 && SMALL_KANA.includes(character);
}

function isHira(character: string): boolean {
	return /^[ぁ-ゖ]$/u.test(character);
}

function isKata(character: string): boolean {
	return /^[ァ-ヺ]$/u.test(character);
}

function glyphCountOf(text: string): number {
	return Array.from(text).filter((character) => !/\s/u.test(character))
		.length;
}

/** Stable per-cut stand-in for JIZURA `cut.line`. */
function lineNoOf(options: X2Draw): number {
	return (x2Hash(Math.abs(options.frame.cut?.seed ?? 0), 601) % 12) + 1;
}

function glyphsOf(options: X2Draw): X2Glyph[] {
	return enterBGlyphs(options);
}

interface X2TypoLineSpan {
	readonly a0: number;
	readonly a1: number;
	readonly c: number;
}

/** The single text line's extent along and across the reading axis. */
function lineSpanOf(options: X2Draw): X2TypoLineSpan | null {
	const glyphs = glyphsOf(options);
	const first = glyphs[0];
	const last = glyphs.at(-1);
	if (!first || !last) return null;
	return {
		a0: first.x - first.width / 2,
		a1: last.x + last.width / 2,
		c: options.y,
	};
}

/** Hairline segment drawn as a rotated rect (JIZURA `env.line`). */
// eslint-disable-next-line opencut/prefer-object-params
function strokeSeg(ctx: MotionTextCanvasContext, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha: number): void {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length = Math.hypot(dx, dy);
	if (length <= 0.05 || width <= 0.05 || alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x0, y0);
	ctx.rotate(Math.atan2(dy, dx));
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(0, -width / 2, length, width);
	ctx.restore();
	ctx.globalAlpha = base;
}

/** Polyline drawn up to a perimeter fraction (JIZURA `env.polyPartial`). */
// eslint-disable-next-line opencut/prefer-object-params
function polyPartial(ctx: MotionTextCanvasContext, points: readonly [number, number][], progress: number, color: string, width: number, alpha: number): void {
	if (alpha <= 0.003 || width <= 0.05 || points.length < 2) return;
	const lengths: number[] = [];
	let total = 0;
	for (let index = 0; index < points.length - 1; index += 1) {
		const from = points[index]!;
		const to = points[index + 1]!;
		const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
		lengths.push(length);
		total += length;
	}
	if (total <= 0.05) return;
	const limit = clamp(progress) * total;
	let accumulated = 0;
	for (let index = 0; index < lengths.length; index += 1) {
		const length = lengths[index]!;
		const reach = Math.min(length, Math.max(0, limit - accumulated));
		if (reach > 0.05) {
			const from = points[index]!;
			const to = points[index + 1]!;
			const fraction = reach / length;
			strokeSeg(
				ctx,
				from[0],
				from[1],
				lerpN(from[0], to[0], fraction),
				lerpN(from[1], to[1], fraction),
				color,
				width,
				alpha,
			);
		}
		accumulated += length;
		if (accumulated >= limit) break;
	}
}

// eslint-disable-next-line opencut/prefer-object-params
function rectPoints(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): [number, number][] {
	return [
		[x0, y0],
		[x1, y0],
		[x1, y1],
		[x0, y1],
		[x0, y0],
	];
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Small plain label in the frame font (JIZURA `label`). */
// eslint-disable-next-line opencut/prefer-object-params
function labelAt(
	ctx: MotionTextCanvasContext,
	frame: MotionTextRenderFrame,
	{
		align = "left",
		alpha = 1,
		color,
		size,
		text,
		x,
		y,
	}: {
		readonly align?: CanvasTextAlign;
		readonly alpha?: number;
		readonly color: string;
		readonly size: number;
		readonly text: string;
		readonly x: number;
		readonly y: number;
	},
): void {
	if (alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = base * clamp(alpha);
	ctx.fillStyle = color;
	ctx.textAlign = align;
	ctx.textBaseline = "middle";
	ctx.font = `${frame.font.style} ${frame.font.weight} ${Math.max(8, size)}px ${quoteFamily(frame.font.family)}`;
	ctx.fillText(text, x, y);
	ctx.restore();
	ctx.globalAlpha = base;
}

/* ================================================================== ENTRANCES */

export function drawX2TypoEnter(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "tzBaseAlign":
			drawBaseAlign(options);
			return true;
		case "tzCaretSet":
			drawCaretSet(options);
			return true;
		case "tzCloseUp":
			drawCloseUp(options);
			return true;
		case "tzCountSet":
			drawCountSet(options);
			return true;
		case "tzIndexLead":
			drawIndexLead(options);
			return true;
		case "tzPointSize":
			drawPointSize(options);
			return true;
		case "tzRuleSlide":
			drawRuleSlide(options);
			return true;
		case "tzTextFrame":
			drawTextFrame(options);
			return true;
		case "tzWeightUp":
			drawWeightUp(options);
			return true;
		default:
			return false;
	}
}

/** 基線合わせ — glyphs stand at uneven heights; a guide passes and each snaps to the baseline. */
function drawBaseAlign(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const span = lineSpanOf(options);
	const glyphs = glyphsOf(options);
	if (!span) return;
	const sweep = inOutCubic(clamp((progress - 0.14) / 0.66)) * 1.14;
	const alpha = clamp(progress * 8);
	const accent = x2Hot(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const along =
				span.a1 - span.a0 > 1 ? (glyph.x - span.a0) / (span.a1 - span.a0) : 0;
			const u = clamp((sweep - along) / 0.12);
			if (u >= 1) return alpha < 1 ? { alpha } : undefined;
			const offset =
				((x2Hash(seed, glyph.index, 5) & 1) === 1 ? 1 : -1) *
				lerpN(0.16, 0.4, x2Random(options, glyph.index, 6)) *
				options.size *
				(1 - outExpo(u));
			return { alpha, translateY: offset };
		},
	});
	const guideAlpha = clamp(progress / 0.1) * (1 - clamp((progress - 0.84) / 0.16));
	if (guideAlpha <= 0 || glyphs.length === 0) return;
	const lw = Math.max(1.5, options.size * 0.02);
	const pad = options.size * 0.12;
	const position = Math.min(
		span.a1 + pad,
		span.a0 + (span.a1 - span.a0) * (sweep - 0.04),
	);
	const cross = span.c + options.size * 0.56;
	const half = options.size * 0.8;
	if (position > span.a0 - pad + 1) {
		strokeSeg(options.ctx, span.a0 - pad, cross, position, cross, accent, lw, guideAlpha);
	}
	strokeSeg(
		options.ctx,
		position,
		cross - half,
		position,
		cross + half,
		accent,
		lw,
		guideAlpha * (sweep < 1.14 ? 1 : 0.5),
	);
}

/** 植字キャレット — a hairline caret sets the glyphs one by one; the newest sits outlined a moment. */
function drawCaretSet(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = glyphsOf(options);
	const count = glyphs.length;
	if (count === 0) return;
	const accent = x2Hot(options);
	const sweep = clamp(progress) * (count + 1.2);
	const shown = Math.min(count, Math.floor(sweep));
	const newest = shown > 0 ? glyphs[shown - 1] : null;
	const newestOutlined =
		newest !== null && sweep < (newest?.index ?? 0) + 1.6;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (glyph.index >= shown) return hide();
			if (newestOutlined && glyph.index === (newest?.index ?? -1)) {
				return hide();
			}
			return undefined;
		},
	});
	if (newest && newestOutlined) {
		drawExitHoldOutline({
			alpha: 1,
			color: accent,
			glyph: newest,
			lineWidth: Math.max(1.5, options.size * 0.03),
			options,
		});
	}
	const anchor = shown > 0 ? glyphs[shown - 1]! : glyphs[0]!;
	const direction = shown > 0 ? 1 : -1;
	const caretX = anchor.x + direction * (anchor.width / 2 + options.size * 0.07);
	const half = options.size * 0.56;
	strokeSeg(
		options.ctx,
		caretX,
		options.y - half,
		caretX,
		options.y + half,
		accent,
		Math.max(2, options.size * 0.03),
		1,
	);
	if (shown > 0 && newest && sweep < shown + 0.6) {
		const halfAdvance = newest.width / 2;
		const halfCross = options.size * 0.5;
		polyPartial(
			options.ctx,
			rectPoints(
				newest.x - halfAdvance,
				options.y - halfCross,
				newest.x + halfAdvance,
				options.y + halfCross,
			),
			1,
			accent,
			Math.max(1, options.size * 0.012),
			0.7,
		);
	}
}

/** 詰め組み — the line appears loosely spaced; gaps close one after another from the head. */
function drawCloseUp(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const glyphs = glyphsOf(options);
	const alpha = clamp(progress * 8);
	if (glyphs.length <= 1) {
		const eased = outExpo(clamp((progress - 0.2) / 0.6));
		const scale = 1 + 0.3 * (1 - eased);
		drawX2Glyphs({
			options,
			resolve: (glyph) => ({
				alpha,
				scaleX: scale,
				scaleY: scale,
				translateX: (options.x - glyph.x) * (1 - scale),
				translateY: (options.y - glyph.y) * (1 - scale),
			}),
		});
		return;
	}
	const width = options.maxWidth / 0.86;
	const first = glyphs[0]!;
	const last = glyphs.at(-1)!;
	const extent = last.x + last.width / 2 - (first.x - first.width / 2);
	const n = glyphs.length;
	const gap = clamp(
		(width * 0.92 - extent) / (n - 1),
		options.size * 0.22,
		options.size * 0.55,
	);
	const cumulative: number[] = [0];
	let total = 0;
	for (let index = 1; index < n; index += 1) {
		total +=
			gap *
			(1 -
				outExpo(
					clamp(
						(progress - (0.12 + ((index - 1) / (n - 1)) * 0.58)) / 0.26,
					),
				));
		cumulative.push(total);
	}
	const base = -total / 2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const shift = base + (cumulative[glyph.index] ?? 0);
			return Math.abs(shift) < 0.01
				? alpha < 1
					? { alpha }
					: undefined
				: { alpha, translateX: shift };
		},
	});
}

/** 計数から組む — every slot holds a small running figure; the figures lock to the glyphs from the head. */
function drawCountSet(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const tick = Math.floor(secondsOf(options.frame) * 60) >> 1;
	const sub = x2Sub(options);
	const accent = x2Hot(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const t0 = glyph.order * 0.2;
			const lock = 0.38 + glyph.order * 0.52;
			if (progress < t0) return hide();
			if (progress < lock) {
				if (isPunct(glyph.character) || isSmallKana(glyph.character)) {
					return hide();
				}
				return {
					alpha: clamp((progress - t0) / 0.06),
					character: String((x2Hash(seed, glyph.index, 3) + tick) % 10),
					color: sub,
					scaleX: 0.5,
					scaleY: 0.5,
				};
			}
			return progress < lock + 0.07 ? { color: accent } : undefined;
		},
	});
}

/** 番号が導く — a line number appears first, a hairline runs over the line, glyphs cut on as it passes. */
function drawIndexLead(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const span = lineSpanOf(options);
	if (!span) return;
	const accent = x2Hot(options);
	const sub = x2Sub(options);
	const q = inOutCubic(clamp((progress - 0.14) / 0.62));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (q >= 1) return undefined;
			const distance = lerpN(span.a0, span.a1, q) - glyph.x;
			if (distance < 0) return hide();
			return distance < options.size * 0.6 ? { color: accent } : undefined;
		},
	});
	const retract = inCubic(clamp((progress - 0.8) / 0.2));
	const numberAlpha =
		(progress > 0.03 ? 1 : 0) * (1 - clamp((progress - 0.82) / 0.18));
	const lw = Math.max(1.5, options.size * 0.02);
	const over = span.c - options.size * 0.62;
	const h0 = lerpN(span.a0, span.a1, retract);
	const h1 = lerpN(span.a0, span.a1, q);
	if (h1 - h0 > 1) {
		strokeSeg(options.ctx, h0, over, h1, over, accent, lw, 1);
	}
	if (numberAlpha > 0.01) {
		const fs = Math.max(12, options.size * 0.2);
		labelAt(options.ctx, options.frame, {
			alpha: numberAlpha,
			color: sub,
			size: fs,
			text: pad2(lineNoOf(options) % 100),
			x: span.a0,
			y: over - fs * 0.8,
		});
	}
}

/** 級数上げ — the line steps up through point sizes (hard cuts) to its size; a size note counts along. */
function drawPointSize(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const steps = [0.34, 0.52, 0.76, 1] as const;
	const stepIndex = Math.min(3, Math.floor(clamp(progress) * 4));
	const scale = steps[stepIndex] ?? 1;
	const alpha = clamp(progress * 10);
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			alpha,
			scaleX: scale,
			scaleY: scale,
			translateX: (options.x - glyph.x) * (1 - scale),
			translateY: (options.y - glyph.y) * (1 - scale),
		}),
	});
	const noteAlpha = 1 - clamp((progress - 0.86) / 0.14);
	if (noteAlpha <= 0) return;
	const width = options.maxWidth / 0.86;
	const unit = Math.min(width, options.size * 4) / 1080;
	const fs = Math.max(11, 16 * unit);
	const margin = Math.round(Math.min(width, options.size * 4) * 0.05);
	const sub = x2Sub(options);
	const bounds = x2Bounds(options);
	const text = `${Math.max(1, Math.round((options.size * scale) / unit / 4))}Q`;
	const x = bounds.left;
	const y = Math.max(margin + fs * 0.6, bounds.top - fs * 1.1);
	labelAt(options.ctx, options.frame, {
		alpha: noteAlpha,
		color: sub,
		size: fs,
		text,
		x,
		y,
	});
	strokeSeg(
		options.ctx,
		x,
		y + fs * 0.78,
		x + bounds.width * scale,
		y + fs * 0.78,
		sub,
		Math.max(1, 1.5 * unit),
		noteAlpha,
	);
}

/** 罫上スライド — a hairline shoots out under the line; the text slides along it and stops on a tick. */
function drawRuleSlide(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const seed = options.frame.cut?.seed ?? 0;
	const span = lineSpanOf(options);
	if (!span) return;
	const direction = (x2Hash(seed, 61) & 1) === 1 ? 1 : -1;
	const width = options.maxWidth / 0.86;
	const distance = Math.min(width * 0.3, options.size * 4);
	const eased = outExpo(clamp(progress / 0.72));
	const offset = -direction * distance * (1 - eased);
	const alpha = clamp(progress * 7);
	drawX2Glyphs({
		options,
		resolve: () => ({ alpha, translateX: offset }),
	});
	const accent = x2Hot(options);
	const ruleBack = outExpo(clamp(progress / 0.3));
	const ruleFront = inCubic(clamp((progress - 0.76) / 0.24));
	const lw = Math.max(1.5, options.size * 0.022);
	const pad = options.size * 0.14;
	const tick =
		direction > 0 ? span.a1 + pad : span.a0 - pad;
	const far = tick - direction * (span.a1 - span.a0 + pad * 2 + distance * 0.6);
	const a = lerpN(far, tick, ruleFront);
	const b = lerpN(far, tick, ruleBack);
	const under = span.c + options.size * 0.6;
	if (Math.abs(b - a) > 1) {
		strokeSeg(options.ctx, a, under, b, under, accent, lw, 1);
	}
	if (ruleBack > 0.9 && ruleFront < 1) {
		const half = options.size * 0.16 * (1 - ruleFront);
		strokeSeg(options.ctx, tick, under - half, tick, under + half, accent, lw * 1.4, 1);
	}
}

/** テキスト枠 — a DTP text frame is drawn with handles, the text flows in, then the frame is deselected. */
function drawTextFrame(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const bounds = x2Bounds(options);
	const accent = x2Hot(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			progress < 0.3 + glyph.order * 0.42 ? hide() : undefined,
	});
	const pad = options.size * 0.16;
	const lw = Math.max(1.5, options.size * 0.018);
	const a0 = bounds.left - pad;
	const a1 = bounds.right + pad;
	const c0 = options.y - options.size * 0.5 - pad;
	const c1 = options.y + options.size * 0.5 + pad;
	const points = rectPoints(a0, c0, a1, c1);
	const drawFrame = inOutCubic(clamp(progress / 0.38));
	const retract = inCubic(clamp((progress - 0.8) / 0.2));
	if (retract <= 0) {
		polyPartial(options.ctx, points, drawFrame, accent, lw, 1);
	} else {
		polyPartial(
			options.ctx,
			[...points].reverse(),
			1 - retract,
			accent,
			lw,
			1,
		);
	}
	if (progress > 0.36 && progress < 0.8) {
		const handle = Math.max(4, options.size * 0.05);
		const midA = (a0 + a1) / 2;
		const midC = (c0 + c1) / 2;
		const ctx = options.ctx;
		ctx.fillStyle = accent;
		for (const [a, c] of [
			[a0, c0],
			[midA, c0],
			[a1, c0],
			[a1, midC],
			[a1, c1],
			[midA, c1],
			[a0, c1],
			[a0, midC],
		]) {
			ctx.fillRect(a - handle / 2, c - handle / 2, handle, handle);
		}
	}
}

/** 細字から太字 — the line starts as a hairline-weight skeleton and gains weight to its real face. */
function drawWeightUp(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const eased = outCubic(clamp((progress - 0.06) / 0.94));
	const alpha = clamp(progress * 6);
	drawX2Glyphs({
		options,
		resolve: () => (alpha < 1 ? { alpha } : undefined),
	});
	const stroke = options.size * 0.1 * (1 - eased);
	if (stroke <= 0.05) return;
	const ctx = options.ctx;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = base * clamp(alpha);
	ctx.lineWidth = stroke;
	ctx.strokeStyle = options.frame.palette.background;
	ctx.textAlign = "center";
	for (const glyph of glyphsOf(options)) {
		ctx.strokeText(glyph.character, glyph.x, glyph.y, options.size * 0.76);
	}
	ctx.restore();
	ctx.globalAlpha = base;
}

/* ================================================================== EXITS */

export function drawX2TypoExit(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "tzCondense":
			drawCondense(options);
			return true;
		case "tzHalfCut":
			drawHalfCut(options);
			return true;
		case "tzOverset":
			drawOverset(options);
			return true;
		case "tzProofDelete":
			drawProofDelete(options);
			return true;
		case "tzRulesClose":
			drawRulesClose(options);
			return true;
		case "tzSelectDelete":
			drawSelectDelete(options);
			return true;
		case "tzToFootnote":
			drawToFootnote(options);
			return true;
		case "tzToTofu":
			drawToTofu(options);
			return true;
		default:
			return false;
	}
}

/** 縦罫に畳む — the line condenses onto its centre until it is one upright hairline, which shortens away. */
function drawCondense(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const span = lineSpanOf(options);
	if (!span) return;
	const eased = inOutCubic(clamp(progress / 0.55));
	const mid = (span.a0 + span.a1) / 2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress >= 0.55) return hide();
			return {
				scaleX: Math.max(0.04, 1 - 0.96 * eased),
				translateX: (mid - glyph.x) * eased,
			};
		},
	});
	const ruleAlpha = clamp((progress - 0.28) / 0.2);
	const shorten = 1 - inCubic(clamp((progress - 0.6) / 0.4));
	const half = options.size * 0.58 * shorten;
	if (half > 0.5) {
		strokeSeg(
			options.ctx,
			mid,
			options.y - half,
			mid,
			options.y + half,
			x2Hot(options),
			Math.max(2, options.size * 0.028),
			ruleAlpha,
		);
	}
}

/** 半分ずつ断つ — a hairline runs through the middle; alternate half-glyphs are cut away, then the rest. */
function drawHalfCut(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const span = lineSpanOf(options);
	if (!span) return;
	const accent = x2Hot(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress < 0.26) return undefined;
			if (progress >= 0.54) return hide();
			const top = (glyph.index & 1) === 0;
			return { clipY: top ? [0, 0.7] : [-0.7, 0] };
		},
	});
	const grow = outExpo(clamp(progress / 0.24));
	const shorten = 1 - inCubic(clamp((progress - 0.56) / 0.44));
	const pad = options.size * 0.14;
	const a0 = span.a0 - pad;
	const a1 = span.a1 + pad;
	const mid = (a0 + a1) / 2;
	const a = progress < 0.56 ? a0 : mid - (mid - a0) * shorten;
	const b =
		progress < 0.56 ? lerpN(a0, a1, grow) : mid + (a1 - mid) * shorten;
	if (b - a > 1) {
		strokeSeg(options.ctx, a, options.y, b, options.y, accent, Math.max(1.5, options.size * 0.022), 1);
	}
}

/** あふれ送り — the line is pushed a step at a time past a margin rule and lost there, like overset text. */
function drawOverset(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const bounds = x2Bounds(options);
	const accent = x2Hot(options);
	const pad = options.size * 0.1;
	const count = clamp(glyphCountOf(options.frame.cut?.text ?? options.text), 2, 7);
	const position = clamp(progress / 0.9) * count;
	const stepIndex = Math.min(count, Math.floor(position));
	const step = Math.min(
		1,
		(stepIndex + outExpo(clamp((position - stepIndex) * 2.4))) / count,
	);
	const distance = bounds.width + options.size * 0.2;
	const windowX0 = bounds.left - pad;
	const windowX1 = bounds.right + pad;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (progress >= 0.9) return hide();
			const clip0 = (windowX0 - glyph.x) / glyph.width;
			const clip1 = (windowX1 - glyph.x) / glyph.width;
			if (clip1 <= clip0) return hide();
			return { clipX: [clip0, clip1], translateX: distance * step };
		},
	});
	const appear = outExpo(clamp(progress / 0.12));
	const retract = inCubic(clamp((progress - 0.88) / 0.12));
	const lw = Math.max(1.5, options.size * 0.022);
	const extend = options.size * 0.15;
	const x = bounds.right + pad;
	const y0 = bounds.top - extend;
	const y1 = bounds.bottom + extend;
	if (appear > retract) {
		strokeSeg(
			options.ctx,
			x,
			lerpN(y0, y1, retract),
			x,
			lerpN(y0, y1, appear),
			accent,
			lw,
			1,
		);
	}
	if (progress > 0.1 && progress < 0.9) {
		const handle = Math.max(6, options.size * 0.16);
		const cy = y1 + handle * 0.8;
		const ctx = options.ctx;
		polyPartial(
			ctx,
			rectPoints(x - handle / 2, cy - handle / 2, x + handle / 2, cy + handle / 2),
			1,
			accent,
			lw,
			1,
		);
		strokeSeg(ctx, x - handle * 0.28, cy, x + handle * 0.28, cy, accent, lw, 1);
		strokeSeg(ctx, x, cy - handle * 0.28, x, cy + handle * 0.28, accent, lw, 1);
	}
}

/** 校正で削る — a proofreader's slash strikes each glyph in turn; glyph and slash are taken out together. */
function drawProofDelete(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const accent = x2Hot(options);
	const glyphs = glyphsOf(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			progress >= glyph.order * 0.5 + 0.16 ? hide() : undefined,
	});
	const lw = Math.max(2, options.size * 0.035);
	for (const glyph of glyphs) {
		const t = glyph.order * 0.5;
		if (progress <= t || progress >= t + 0.42) continue;
		const draw = clamp((progress - t) / 0.09);
		const retract = clamp((progress - t - 0.32) / 0.1);
		const halfWidth = glyph.width * 0.5;
		const halfHeight = glyph.height * 0.56;
		strokeSeg(
			options.ctx,
			glyph.x - halfWidth + 2 * halfWidth * retract,
			options.y + halfHeight - 2 * halfHeight * retract,
			glyph.x - halfWidth + 2 * halfWidth * draw,
			options.y + halfHeight - 2 * halfHeight * draw,
			accent,
			lw,
			1,
		);
	}
}

/** 罫が閉じる — hairlines above and below close in on each other, taking the text between them. */
function drawRulesClose(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const bounds = x2Bounds(options);
	const accent = x2Hot(options);
	const pad = options.size * 0.14;
	const eased = inOutCubic(clamp((progress - 0.16) / 0.5));
	const lo = lerpN(bounds.top - pad, bounds.centerY, eased);
	const hi = lerpN(bounds.bottom + pad, bounds.centerY, eased);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (eased >= 1) return hide();
			const clip0 = (lo - glyph.y) / glyph.height;
			const clip1 = (hi - glyph.y) / glyph.height;
			if (clip1 <= clip0) return hide();
			return { clipY: [clip0, clip1] };
		},
	});
	const half =
		(bounds.width / 2 + pad) *
		outExpo(clamp(progress / 0.2)) *
		(1 - inCubic(clamp((progress - 0.7) / 0.3)));
	if (half < 0.5) return;
	const lw = Math.max(1.5, options.size * 0.022);
	for (const y of eased >= 1 ? [lo] : [lo, hi]) {
		strokeSeg(
			options.ctx,
			bounds.centerX - half,
			y,
			bounds.centerX + half,
			y,
			accent,
			lw,
			1,
		);
	}
}

/** 選択して削除 — the line is swept by a selection highlight, deleted in one cut, a caret blinks once. */
function drawSelectDelete(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const span = lineSpanOf(options);
	if (!span) return;
	const accent = x2Hot(options);
	const sweep = inOutCubic(clamp(progress / 0.5));
	const gone = progress >= 0.62;
	if (!gone) {
		const pad = options.size * 0.08;
		const a = span.a0 - pad;
		const b = lerpN(a, span.a1 + pad, sweep);
		const half = options.size * 0.6;
		const ctx = options.ctx;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * 0.42;
		ctx.fillStyle = accent;
		ctx.fillRect(a, options.y - half, b - a, half * 2);
		ctx.globalAlpha = base;
	}
	drawX2Glyphs({
		options,
		resolve: () => (gone ? hide() : undefined),
	});
	if (gone && progress < 0.96 && !(progress >= 0.76 && progress < 0.86)) {
		const a = span.a0 - options.size * 0.08;
		const half = options.size * 0.56;
		strokeSeg(
			options.ctx,
			a,
			options.y - half,
			a,
			options.y + half,
			accent,
			Math.max(2, options.size * 0.03),
			1,
		);
	}
}

/** 脚注になる — the line shrinks to note size at its starting corner; a separator rule is drawn over it. */
function drawToFootnote(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const bounds = x2Bounds(options);
	const sub = x2Sub(options);
	const eased = inOutCubic(clamp(progress / 0.45));
	const scale = lerpN(1, 0.3, eased);
	const shiftX = -(bounds.width * (1 - scale)) / 2;
	const shiftY = (bounds.height * (1 - scale)) / 2;
	const color = mixHex({
		from: options.frame.palette.foreground,
		progress: eased * 0.7,
		to: sub,
	});
	drawX2Glyphs({
		options,
		resolve: () => {
			if (progress >= 0.8) return hide();
			return {
				color,
				scaleX: scale,
				scaleY: scale,
				translateX: shiftX,
				translateY: shiftY,
			};
		},
	});
	const draw = outExpo(clamp((progress - 0.25) / 0.3));
	const retract = inCubic(clamp((progress - 0.8) / 0.2));
	if (draw <= retract) return;
	const lw = Math.max(1.5, options.size * 0.02);
	const y = bounds.bottom - bounds.height * 0.3 - options.size * 0.12;
	const length = Math.min(bounds.width * 0.5, options.size * 2.4);
	strokeSeg(
		options.ctx,
		bounds.left + length * retract,
		y,
		bounds.left + length * draw,
		y,
		sub,
		lw,
		1,
	);
}

/** 字枠に還る — each glyph in turn is replaced by its empty hairline body box, then taken away. */
function drawToTofu(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const color = options.frame.palette.foreground;
	const glyphs = glyphsOf(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			progress >= glyph.order * 0.45 + 0.05 ? hide() : undefined,
	});
	const lw = Math.max(1.5, options.size * 0.022);
	for (const glyph of glyphs) {
		const t = glyph.order * 0.45;
		if (progress < t || progress >= t + 0.42) continue;
		const u = (progress - t) / 0.42;
		const shrink = u > 0.8 ? 1 - inCubic((u - 0.8) / 0.2) * 0.6 : 1;
		const halfWidth = glyph.width * 0.42 * shrink;
		const halfHeight = glyph.height * 0.42 * shrink;
		polyPartial(
			options.ctx,
			rectPoints(
				glyph.x - halfWidth,
				options.y - halfHeight,
				glyph.x + halfWidth,
				options.y + halfHeight,
			),
			1,
			color,
			lw,
			1,
		);
	}
}

/* ================================================================== HOLDS */

export function drawX2TypoHold(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "tzCaretBlink":
			drawCaretBlink(options);
			return true;
		case "tzCounterRules":
			drawCounterRules(options);
			return true;
		case "tzIndexCount":
			drawIndexCount(options);
			return true;
		case "tzKernNudge":
			drawKernNudge(options);
			return true;
		case "tzUnderGrow":
			drawUnderGrow(options);
			return true;
		default:
			return false;
	}
}

function drawPlainGlyphs(options: EnterBDraw): void {
	drawX2Glyphs({ options, resolve: () => undefined });
}

/** 末尾キャレット — a hairline caret blinks after the last glyph, as if the line were still being written. */
function drawCaretBlink(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const lt = secondsOf(options.frame);
	if (lt % 1.06 >= 0.6) return;
	const glyphs = glyphsOf(options);
	const last = glyphs.at(-1);
	if (!last) return;
	const accent = x2Hot(options);
	const a = last.x + last.width / 2 + options.size * 0.09;
	const half = options.size * 0.54;
	strokeSeg(
		options.ctx,
		a,
		options.y - half,
		a,
		options.y + half,
		accent,
		Math.max(2, options.size * 0.03),
		1,
	);
}

/** 行き違う罫 — a short hairline over the line and one under it travel slowly in opposite directions. */
function drawCounterRules(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const lt = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const accent = x2Hot(options);
	const u = 0.5 - 0.5 * Math.cos(lt * 1.4 + (Math.abs(seed) % 7));
	const lw = Math.max(1.5, options.size * 0.02);
	const length = span.a1 - span.a0;
	const segment = length * 0.3;
	const p1 = span.a0 + (length - segment) * u;
	const p2 = span.a0 + (length - segment) * (1 - u);
	strokeSeg(options.ctx, p1, span.c - options.size * 0.64, p1 + segment, span.c - options.size * 0.64, accent, lw, 1);
	strokeSeg(options.ctx, p2, span.c + options.size * 0.64, p2 + segment, span.c + options.size * 0.64, accent, lw, 1);
}

/** 数える番号 — a small tabular number over the end of the line counts up quietly. */
function drawIndexCount(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const lt = secondsOf(options.frame);
	const per = 0.5;
	const text = pad2((1 + Math.floor(Math.max(0, lt) / per)) % 100);
	const width = options.maxWidth / 0.86;
	const unit = Math.min(width, options.size * 4) / 1080;
	const sub = x2Sub(options);
	const fs = Math.max(14 * unit, options.size * 0.24);
	labelAt(options.ctx, options.frame, {
		align: "right",
		color: sub,
		size: fs,
		text,
		x: span.a1,
		y: span.c - options.size * 0.5 - fs * 0.8,
	});
}

/** 字詰めの手直し — now and then one gap is kerned a hair wider or tighter (a tick marks it), then put back. */
function drawKernNudge(options: EnterBDraw): void {
	const glyphs = glyphsOf(options);
	if (glyphs.length < 3) {
		drawPlainGlyphs(options);
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const lt = secondsOf(options.frame);
	const accent = x2Hot(options);
	const per = 1.3;
	const t = lt / per;
	const cycle = Math.floor(t);
	const fraction = t - cycle;
	const n = glyphs.length;
	const gapIndex = 1 + (x2Hash(seed, cycle, 71) % (n - 1));
	const sign = (x2Hash(seed, cycle, 72) & 1) === 1 ? 1 : -1;
	const profile =
		outExpo(clamp((fraction - 0.12) / 0.1)) *
		(1 - inOutCubic(clamp((fraction - 0.68) / 0.2)));
	const shift = sign * options.size * 0.09 * profile;
	if (Math.abs(shift) < 0.2) {
		drawPlainGlyphs(options);
		return;
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			translateX: glyph.index >= gapIndex ? shift / 2 : -shift / 2,
		}),
	});
	const after = glyphs[gapIndex];
	const before = glyphs[gapIndex - 1];
	if (!after || !before) return;
	const gapX = (before.x + before.width / 2 + (after.x - after.width / 2)) / 2;
	strokeSeg(
		options.ctx,
		gapX,
		options.y + options.size * 0.56,
		gapX,
		options.y + options.size * 0.74,
		accent,
		Math.max(1.5, options.size * 0.02),
		clamp(profile),
	);
}

/** 伸びる下線 — a hairline underline grows slowly under the line for as long as the cut rests. */
function drawUnderGrow(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const lt = secondsOf(options.frame);
	const duration = (options.frame.cut?.duration ?? 240_000) / TICKS_PER_SECOND;
	const g = clamp(lt / Math.max(0.8, duration));
	const e = 0.1 + 0.9 * (1 - (1 - g) ** 1.5);
	const accent = x2Hot(options);
	const lw = Math.max(1.5, options.size * 0.02);
	const b = lerpN(span.a0, span.a1, e);
	const under = span.c + options.size * 0.6;
	strokeSeg(options.ctx, span.a0, under, b, under, accent, lw, 1);
	const half = options.size * 0.09;
	strokeSeg(options.ctx, b, under - half, b, under + half, accent, lw, 1);
}

/* ================================================================== TREATMENTS */

export function drawX2TypoTreat(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "tzKanaSmall":
			drawKanaSmall(options);
			return true;
		case "tzLineNo":
			drawLineNo(options);
			return true;
		case "tzSuperNote":
			drawSuperNote(options);
			return true;
		case "tzTocLeader":
			drawTocLeader(options);
			return true;
		case "tzTypeGuides":
			drawTypeGuides(options);
			return true;
		default:
			return false;
	}
}

/** かな小組み — hiragana are set a size smaller than kanji / katakana on the same baseline, closed up. */
function drawKanaSmall(options: EnterBDraw): void {
	const glyphs = glyphsOf(options);
	const reference = options.frame.cut?.text ?? options.text;
	const hasBig = [...reference].some(
		(character) =>
			x2IsKanji(character) ||
			isKata(character) ||
			/[A-Za-z0-9]/u.test(character),
	);
	const hasSmall = [...reference].some((character) => isHira(character));
	if (!hasBig || !hasSmall || glyphs.length === 0) {
		drawPlainGlyphs(options);
		return;
	}
	const k = 0.8;
	let cumulative = 0;
	const shifts: number[] = [];
	for (const glyph of glyphs) {
		if (isHira(glyph.character)) {
			const free = (1 - k) * glyph.width;
			shifts.push(-(cumulative + free / 2));
			cumulative += free;
		} else {
			shifts.push(-cumulative);
		}
	}
	const base = -cumulative / 2;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const shift = (shifts[glyph.index] ?? 0) + base;
			if (isHira(glyph.character)) {
				return {
					scaleX: k,
					scaleY: k,
					translateX: shift,
					translateY: (1 - k) * glyph.height * 0.36,
				};
			}
			return Math.abs(shift) < 0.01 ? undefined : { translateX: shift };
		},
	});
}

/** 行番号 — a small tabular line number is set before the line, divided from it by a hairline. */
function drawLineNo(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const seed = options.frame.cut?.seed ?? 0;
	const lt = secondsOf(options.frame);
	const q = outExpo(clamp((lt - 0.1) / 0.45));
	const alpha = clamp(q * 1.5) * (1 - inCubic(options.frame.exitProgress));
	if (alpha <= 0.01) return;
	const color = x2Unit2(seed, 1) < 0.5 ? x2Hot(options) : x2Sub(options);
	const text = pad2(lineNoOf(options) % 100);
	const fs = Math.max(12, options.size * 0.24);
	const gap = options.size * 0.16;
	const lw = Math.max(1, options.size * 0.014);
	const width = options.maxWidth / 0.86;
	const margin = Math.round(Math.min(width, options.size * 4) * 0.05) * 0.8;
	const numberWidth = fs * 1.35;
	if (span.a0 - margin >= numberWidth + gap * 2) {
		labelAt(options.ctx, options.frame, {
			align: "right",
			alpha,
			color,
			size: fs,
			text,
			x: span.a0 - gap * 2,
			y: options.y + options.size * 0.36 - fs * 0.36,
		});
		const half = options.size * 0.42 * q;
		strokeSeg(
			options.ctx,
			span.a0 - gap,
			options.y - half,
			span.a0 - gap,
			options.y + half,
			color,
			lw,
			alpha,
		);
		return;
	}
	const y = options.y - options.size * 0.5 - fs * 0.85;
	labelAt(options.ctx, options.frame, {
		alpha,
		color,
		size: fs,
		text,
		x: span.a0 + fs * 0.05,
		y,
	});
	strokeSeg(
		options.ctx,
		span.a0,
		y + fs * 0.62,
		span.a0 + numberWidth * q,
		y + fs * 0.62,
		color,
		lw,
		alpha,
	);
}

/** Deterministic unit roll from a bare seed (plan-parameter stand-in). */
// eslint-disable-next-line opencut/prefer-object-params
function x2Unit2(seed: number, salt: number): number {
	return x2Hash(seed, salt + 611) / 0x10000;
}

/** 注番号 — one small superscript reference mark (a number or an asterisk) after the last glyph. */
function drawSuperNote(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const seed = options.frame.cut?.seed ?? 0;
	const lt = secondsOf(options.frame);
	const q = outExpo(clamp((lt - 0.2) / 0.4));
	const alpha = clamp(q * 2) * (1 - inCubic(options.frame.exitProgress));
	if (alpha <= 0.01) return;
	const star = x2Unit2(seed, 2) < 0.35;
	const accent = x2Unit2(seed, 3) < 0.7;
	const text = star ? "＊" : String(((lineNoOf(options) - 1) % 9) + 1);
	const fs = Math.max(12, options.size * 0.3);
	const rise = (1 - q) * fs * 0.3;
	const width = options.maxWidth / 0.86;
	const margin = Math.round(Math.min(width, options.size * 4) * 0.05) * 0.6;
	const color = accent ? x2Hot(options) : options.frame.palette.foreground;
	const x = span.a1 + fs * 0.12;
	if (x + fs * 0.75 <= width - margin) {
		labelAt(options.ctx, options.frame, {
			alpha,
			color,
			size: fs,
			text,
			x,
			y: options.y - options.size * 0.36 + rise,
		});
		return;
	}
	const y = options.y - options.size * 0.5 - fs * 0.7;
	labelAt(options.ctx, options.frame, {
		align: "right",
		alpha,
		color,
		size: fs,
		text,
		x: span.a1,
		y: y + rise,
	});
}

/** 目次リーダー — dot leaders run on from the end of the line to a small tabular number. */
function drawTocLeader(options: EnterBDraw): void {
	drawPlainGlyphs(options);
	const span = lineSpanOf(options);
	if (!span) return;
	const seed = options.frame.cut?.seed ?? 0;
	const lt = secondsOf(options.frame);
	const q = outExpo(clamp((lt - 0.15) / 0.6)) * (1 - inCubic(options.frame.exitProgress));
	if (q <= 0.01) return;
	const color = x2Unit2(seed, 4) < 0.5 ? x2Hot(options) : x2Sub(options);
	const text = pad2(lineNoOf(options) % 100);
	const fs = Math.max(12, options.size * 0.26);
	const width = options.maxWidth / 0.86;
	const margin = Math.round(Math.min(width, options.size * 4) * 0.05) * 0.9;
	const pitch = options.size * 0.2;
	const radius = Math.max(1.2, options.size * 0.024);
	const numberWidth = fs * 1.4;
	const room = width - margin - (span.a1 + options.size * 0.2) - numberWidth - options.size * 0.1;
	let start: number;
	let length: number;
	let c: number;
	if (room >= options.size * 0.8) {
		start = span.a1 + options.size * 0.2;
		length = Math.min(room, options.size * 1.8);
		c = options.y + options.size * 0.3;
	} else {
		start = span.a0;
		length = span.a1 - span.a0 - numberWidth - options.size * 0.08;
		c = options.y + options.size * 0.7;
	}
	if (length < options.size * 0.5) return;
	const count = Math.min(40, Math.floor(length / pitch));
	const shown = Math.ceil(count * clamp(q * 1.4));
	for (let index = 0; index < shown; index += 1) {
		drawEnterBDot({
			alpha: 1,
			color,
			options,
			radius,
			x: start + pitch * (index + 0.5),
			y: c,
		});
	}
	const numberAlpha = clamp(q * 3 - 2);
	if (numberAlpha <= 0.01) return;
	labelAt(options.ctx, options.frame, {
		alpha: numberAlpha,
		color,
		size: fs,
		text,
		x: start + count * pitch + options.size * 0.08,
		y: c - fs * 0.06,
	});
}

/** 字面ガイド — type-design guide lines behind the text, running past both ends. */
function drawTypeGuides(options: EnterBDraw): void {
	const span = lineSpanOf(options);
	if (!span) {
		drawPlainGlyphs(options);
		return;
	}
	const seed = options.frame.cut?.seed ?? 0;
	const lt = secondsOf(options.frame);
	const mid = x2Unit2(seed, 5) < 0.6;
	const extend = 0.3 + x2Unit2(seed, 6) * 0.25;
	const color = x2Unit2(seed, 7) < 0.3 ? x2Hot(options) : x2Sub(options);
	const lw = Math.max(1.5, options.size * 0.015);
	const margin = options.size * extend;
	const q = outExpo(clamp(lt / 0.55));
	const out = inCubic(options.frame.exitProgress);
	const a0 = span.a0 - margin;
	const a1 = span.a1 + margin;
	const center = (a0 + a1) / 2;
	const half = ((a1 - a0) / 2) * q * (1 - out);
	if (half >= 1) {
		for (const c of [-0.56, 0.56]) {
			strokeSeg(
				options.ctx,
				center - half,
				options.y + options.size * c,
				center + half,
				options.y + options.size * c,
				color,
				lw,
				0.8,
			);
		}
		if (mid) {
			dashLine(
				options.ctx,
				center - half,
				options.y,
				center + half,
				options.y,
				color,
				lw,
				0.42,
				options.size * 0.07,
			);
		}
		if (q > 0.6 && out < 0.4) {
			for (const x of [span.a0, span.a1]) {
				strokeSeg(
					options.ctx,
					x,
					options.y - options.size * 0.56 - options.size * 0.1,
					x,
					options.y - options.size * 0.56,
					color,
					lw,
					0.8,
				);
			}
		}
	}
	drawPlainGlyphs(options);
}

/** Dashed segment without setLineDash: repeated short strokes. */
// eslint-disable-next-line opencut/prefer-object-params
function dashLine(ctx: MotionTextCanvasContext, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha: number, on: number): void {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length = Math.hypot(dx, dy);
	if (length <= 0.05 || alpha <= 0.003) return;
	const unit = Math.max(0.1, on * 2);
	const steps = Math.ceil(length / unit);
	for (let index = 0; index < steps; index += 1) {
		const from = (index * unit) / length;
		const to = Math.min(1, (index * unit + on) / length);
		if (to <= from) continue;
		strokeSeg(
			ctx,
			x0 + dx * from,
			y0 + dy * from,
			x0 + dx * to,
			y0 + dy * to,
			color,
			width,
			alpha,
		);
	}
}

/* ================================================================== CAMERA */

export interface X2TypoCameraDraw {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
	/** Canvas extents; resolvers that never read them may be called without. */
	readonly width?: number;
	readonly height?: number;
}

/**
 * JIZURA 追加分2 "x2typoB" camera pack. Mirrors bgcam-cameras.ts: resolves the
 * preset to a camera transform (null when the preset is not ours), because
 * rocut applies cameras through the runtime resolver chain rather than
 * drawing them; translations are frame fractions, skew is radians.
 */
export function drawX2TypoCam(
	options: X2TypoCameraDraw,
): KineticCameraTransform | null {
	switch (options.cut.preset.cam) {
		case "tzGridStep":
			return gridStepCamera(options);
		case "tzItalicSet":
			return italicSetCamera(options);
		case "tzMeasureZoom":
			return measureZoomCamera(options);
		case "tzTabStep":
			return tabStepCamera(options);
		default:
			return null;
	}
}

/** JIZURA `KM` with the default motion preference (0.7). */
const CAM_MOTION = clamp01(0.7 * 1.25);

function cameraSeconds(options: X2TypoCameraDraw): number {
	return options.localTime / TICKS_PER_SECOND;
}

function cameraWhole(options: X2TypoCameraDraw): number {
	return clamp01(
		cameraSeconds(options) /
			Math.max(0.3, options.cut.duration / TICKS_PER_SECOND),
	);
}

/** タブ送り — the frame sits a few tab stops off and moves to centre one exact stop at a time. */
function tabStepCamera(options: X2TypoCameraDraw): KineticCameraTransform {
	const seed = options.cut.seed;
	const lt = cameraSeconds(options);
	const n = 2 + (x2Hash(seed, 621) % 2);
	const direction = (x2Hash(seed, 622) & 1) === 1 ? 1 : -1;
	const vertical = x2Hash(seed, 623) % 2 === 1;
	const amplitude = 0.014 + (x2Hash(seed, 624) % 7) * 0.001;
	const duration = options.cut.duration / TICKS_PER_SECOND;
	const gap = Math.min(0.6, Math.max(0.2, (duration * 0.6) / n));
	let done = 0;
	for (let index = 0; index < n; index += 1) {
		done += inOutCubic(clamp((lt - 0.18 - index * gap) / 0.16));
	}
	const offset = -direction * amplitude * (n - done) * CAM_MOTION;
	return vertical
		? { scale: 1.02, translateY: offset }
		: { scale: 1.02, translateX: offset };
}

/** 斜体から正体 — the frame starts slanted like an italic and is set upright in one clean move. */
function italicSetCamera(options: X2TypoCameraDraw): KineticCameraTransform {
	const seed = options.cut.seed;
	const lt = cameraSeconds(options);
	const direction = (x2Hash(seed, 631) & 1) === 1 ? 1 : -1;
	const amplitude = 5.5 + (x2Hash(seed, 632) % 6) * 0.5;
	const duration = options.cut.duration / TICKS_PER_SECOND;
	const e = outExpo(clamp(lt / Math.min(0.55, Math.max(0.25, duration * 0.4))));
	const whole = cameraWhole(options);
	const skew =
		-direction * amplitude * CAM_MOTION * (1 - e) +
		direction * 0.9 * CAM_MOTION * whole * e;
	return { scale: 1.02, skewX: degrees(skew) };
}

/** 行長合わせ — only the width of the frame changes: a little wide (or narrow), closing to true measure. */
function measureZoomCamera(options: X2TypoCameraDraw): KineticCameraTransform {
	const seed = options.cut.seed;
	const wide = x2Hash(seed, 641) % 3 !== 0;
	const amplitude = 0.045 + (x2Hash(seed, 642) % 7) * 0.0025;
	const u = inOutSine(cameraWhole(options));
	const a = amplitude * CAM_MOTION * (1 - u);
	return {
		scale: 1.015,
		scaleX: wide ? 1 + a : 1 - a * 0.7,
		scaleY: 1,
	};
}

/** 方眼ステップ — the frame is moved like a plotter head: one small exact step at a time around a square. */
function gridStepCamera(options: X2TypoCameraDraw): KineticCameraTransform {
	const seed = options.cut.seed;
	const lt = cameraSeconds(options);
	const corners: readonly [number, number][] = [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	];
	const direction = (x2Hash(seed, 651) & 1) === 1 ? 1 : -1;
	const startCorner = x2Hash(seed, 652) % 4;
	const period = 0.45 + (x2Hash(seed, 653) % 7) * 0.02;
	const step = Math.floor(lt / period);
	const e = inOutCubic(clamp((lt - step * period) / 0.14));
	const at = (index: number): readonly [number, number] =>
		corners[(((startCorner + direction * index) % 4) + 4) % 4] ?? [0, 0];
	const from = at(Math.max(0, step - 1));
	const to = at(step);
	const amplitude = (0.01 + (x2Hash(seed, 654) % 4) * 0.001) * CAM_MOTION;
	return {
		scale: 1.03,
		translateX: lerpN(from[0], to[0], e) * amplitude,
		translateY: lerpN(from[1], to[1], e) * amplitude * 0.9,
	};
}

/* ============================================================ SCREEN EFFECTS */

const X2_TYPO_FX_IDS = new Set([
	"tzColumnShift",
	"tzFrameStep",
	"tzGridFlash",
	"tzKnockBand",
	"tzRegTicks",
	"tzRuleFlash",
]);

interface X2TypoPixelEffectDraw extends LooksScreenEffectDraw {
	readonly ctx: LooksPixelContext;
	readonly source: HTMLCanvasElement | OffscreenCanvas;
}

/** JIZURA 追加分2 "x2typoB" screen accents, mirroring the screen-effects conventions. */
export function drawX2TypoFx(options: LooksScreenEffectDraw): boolean {
	if (!X2_TYPO_FX_IDS.has(options.effect)) return false;
	options.ctx.save();
	try {
		switch (options.effect) {
			case "tzGridFlash":
				drawGridFlash(options);
				return true;
			case "tzRegTicks":
				drawRegTicks(options);
				return true;
			case "tzRuleFlash":
				drawRuleFlash(options);
				return true;
			default:
				break;
		}
		if (!isLooksPixelContext(options.ctx)) {
			drawFxSignature(options);
			return true;
		}
		const surface = captureLooksSource({
			ctx: options.ctx,
			height: options.height,
			width: options.width,
		});
		if (!surface) {
			drawFxSignature(options);
			return true;
		}
		const pixelOptions = {
			...options,
			ctx: options.ctx,
			source: surface.canvas,
		};
		switch (options.effect) {
			case "tzColumnShift":
				drawColumnShift(pixelOptions);
				break;
			case "tzFrameStep":
				drawFrameStep(pixelOptions);
				break;
			case "tzKnockBand":
				drawKnockBand(pixelOptions);
				break;
			default:
				break;
		}
		return true;
	} finally {
		options.ctx.restore();
	}
}

/** Deterministic per-instant seed (JIZURA `evS`). */
function evSOf(options: LooksScreenEffectDraw): number {
	return x2Hash(
		Math.round((options.frame.localTime / TICKS_PER_SECOND) * 1000),
		7717,
	);
}

function fxPhase(options: LooksScreenEffectDraw): number {
	return looksEffectProgress(options);
}

function popColor(options: LooksScreenEffectDraw): string {
	return options.frame.palette.accent;
}

function hairPixels(options: LooksScreenEffectDraw): number {
	return Math.max(1, Math.round(Math.min(options.width, options.height) * 0.0024));
}

/** Fallback signature when no pixel canvas is available (house convention). */
function drawFxSignature(options: LooksScreenEffectDraw): void {
	const phase = fxPhase(options);
	options.ctx.globalAlpha *= 0.3 + phase * 0.5;
	options.ctx.fillStyle = popColor(options);
	const index = [...X2_TYPO_FX_IDS].indexOf(options.effect);
	for (let marker = 0; marker < 3; marker += 1) {
		options.ctx.fillRect(
			options.width * (((index * 0.11 + marker * 0.29 + phase * 0.33) % 0.9) + 0.02),
			options.height * (((index * 0.17 + marker * 0.21 + phase * 0.27) % 0.84) + 0.04),
			options.width * 0.05,
			options.height * 0.012,
		);
	}
}

/** 罫線フラッシュ — two or three hairlines (one heavier) shoot across the frame and retract from their tails. */
function drawRuleFlash(options: LooksScreenEffectDraw): void {
	const { ctx, height, width } = options;
	const s = evSOf(options);
	const k = fxPhase(options);
	const n = 2 + (x2Hash(s, 1) % 2);
	const lineWeight = hairPixels(options);
	const vertical = x2Hash(s, 2) % 5 === 0;
	const longSide = vertical ? width : height;
	const crossSide = vertical ? height : width;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * 1;
	ctx.fillStyle = popColor(options);
	for (let index = 0; index < n; index += 1) {
		const position = Math.round(
			(longSide * (1 + ((x2Hash(s, 3) % 3) + index * 4) % 11)) / 12,
		);
		const u = clamp(k * 1.25 - index * 0.1);
		const head = outExpo(clamp(u / 0.45));
		const tail = inCubic(clamp((u - 0.5) / 0.5));
		const length = crossSide * (head - tail);
		if (length < 1) continue;
		const start =
			(index + (s & 1)) % 2 === 1 ? crossSide - crossSide * head : crossSide * tail;
		const thickness = index === 0 ? lineWeight * 3 : lineWeight;
		if (vertical) {
			ctx.fillRect(position - thickness / 2, start, thickness, length);
		} else {
			ctx.fillRect(start, position - thickness / 2, length, thickness);
		}
	}
	ctx.globalAlpha = base;
}

/** 字抜き帯 — one band of the picture is knocked out: a plate in the text colour, the type in the background. */
function drawKnockBand(options: X2TypoPixelEffectDraw): void {
	const { ctx, frame, height, width } = options;
	const s = evSOf(options);
	const k = fxPhase(options);
	const sc = frame.palette;
	const dk = isDarkColor(sc.background);
	const bandHeight = Math.max(
		4,
		Math.round(
			height * (0.14 + 0.1 * (x2Hash(s, 1) % 10) / 10) * (k < 0.55 ? 1 : 0.34),
		),
	);
	const signed = (x2Hash(s, 2) % 10) / 10 - 0.5;
	const y0 = Math.round(
		clamp(height * (0.5 + 0.14 * signed * 2) - bandHeight / 2, 0, height - bandHeight),
	);
	const surface = captureLooksSource({ ctx, height, width });
	if (!surface) return;
	const band = surface.context;
	band.save();
	band.setTransform(1, 0, 0, 1, 0, 0);
	band.globalCompositeOperation = "copy";
	band.drawImage(ctx.canvas, 0, y0, width, bandHeight, 0, 0, width, bandHeight);
	band.globalCompositeOperation = "difference";
	band.fillStyle = sc.background;
	band.fillRect(0, 0, width, bandHeight);
	band.globalCompositeOperation = "saturation";
	band.fillStyle = "#808080";
	band.fillRect(0, 0, width, bandHeight);
	band.globalCompositeOperation = "multiply";
	band.drawImage(surface.canvas, 0, 0);
	band.globalCompositeOperation = "color-dodge";
	band.fillStyle = "#d0d0d0";
	band.fillRect(0, 0, width, bandHeight);
	if (dk) {
		band.globalCompositeOperation = "difference";
		band.fillStyle = "#ffffff";
		band.fillRect(0, 0, width, bandHeight);
	}
	band.restore();
	ctx.fillStyle = sc.foreground;
	ctx.fillRect(0, y0, width, bandHeight);
	ctx.globalCompositeOperation = dk ? "multiply" : "screen";
	ctx.drawImage(surface.canvas, 0, 0, width, bandHeight, 0, y0, width, bandHeight);
	ctx.globalCompositeOperation = dk ? "lighten" : "darken";
	ctx.fillStyle = sc.background;
	ctx.fillRect(0, y0, width, bandHeight);
	ctx.globalCompositeOperation = "source-over";
}

/** Simple sRGB luma test for the knockout band's polarity (JIZURA `isDark`). */
function isDarkColor(color: string): boolean {
	const match = /^#([\da-f]{6})$/iu.exec(color);
	if (!match?.[1]) return false;
	const value = Number.parseInt(match[1], 16);
	const red = (value >> 16) & 0xff;
	const green = (value >> 8) & 0xff;
	const blue = value & 0xff;
	return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.45;
}

/** 段ずらし — the frame is ruled into text columns; alternate columns step a line up / down and back. */
function drawColumnShift(options: X2TypoPixelEffectDraw): void {
	const { ctx, height, width } = options;
	const s = evSOf(options);
	const k = fxPhase(options);
	const n = 4 + (x2Hash(s, 1) % 3);
	const direction = (s & 1) === 1 ? 1 : -1;
	const shift = height * 0.04;
	const level =
		k < 0.18 ? 0.5 : k < 0.5 ? 1 : 1 - inOutCubic((k - 0.5) / 0.5);
	if (level < 0.004) return;
	replaceFxBFrame(options, () => {
		for (let index = 0; index < n; index += 1) {
			const x0 = Math.round((index * width) / n);
			const x1 = Math.round(((index + 1) * width) / n);
			ctx.drawImage(
				options.source,
				x0,
				0,
				x1 - x0,
				height,
				x0,
				Math.round((index % 2 === 1 ? 1 : -1) * direction * shift * level),
				x1 - x0,
				height,
			);
		}
		const weight = hairPixels(options);
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * clamp(0.7 * Math.min(1, level * 2));
		ctx.fillStyle = popColor(options);
		for (let index = 1; index < n; index += 1) {
			ctx.fillRect(Math.round((index * width) / n) - weight / 2, 0, weight, height);
		}
		ctx.globalAlpha = base;
	});
}

/** トンボ点滅 — printer's crop marks in the corners and register marks on the edge centres blink on twice. */
function drawRegTicks(options: LooksScreenEffectDraw): void {
	const k = fxPhase(options);
	if (!(k < 0.3 || (k >= 0.45 && k < 0.82))) return;
	const { ctx, height, width } = options;
	const margin = Math.min(width, height);
	const weight = hairPixels(options);
	const inset = margin * 0.07;
	const length = margin * 0.04;
	const gap = margin * 0.012;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * 1;
	ctx.fillStyle = popColor(options);
	ctx.strokeStyle = popColor(options);
	ctx.lineWidth = weight;
	for (const sideX of [-1, 1]) {
		for (const sideY of [-1, 1]) {
			const x = sideX < 0 ? inset : width - inset;
			const y = sideY < 0 ? inset : height - inset;
			ctx.fillRect(
				sideX < 0 ? x - gap - length : x + gap,
				y - weight / 2,
				length,
				weight,
			);
			ctx.fillRect(
				x - weight / 2,
				sideY < 0 ? y - gap - length : y + gap,
				weight,
				length,
			);
		}
	}
	const radius = length * 0.32;
	const center = inset * 0.55;
	for (const [x, y] of [
		[width / 2, center],
		[width / 2, height - center],
		[center, height / 2],
		[width - center, height / 2],
	]) {
		ctx.fillRect(x - length * 0.6, y - weight / 2, length * 1.2, weight);
		ctx.fillRect(x - weight / 2, y - length * 0.6, weight, length * 1.2);
		if (ctx.arc && ctx.stroke && ctx.beginPath) {
			ctx.beginPath();
			ctx.arc(x, y, radius, 0, TAU);
			ctx.stroke();
		}
	}
	ctx.globalAlpha = base;
}

/** 方眼フラッシュ — a hairline baseline grid with column rules draws itself over the frame, then fades. */
function drawGridFlash(options: LooksScreenEffectDraw): void {
	const { ctx, height, width } = options;
	const s = evSOf(options);
	const k = fxPhase(options);
	const weight = hairPixels(options);
	const landscape = width > height;
	const rows = landscape ? 12 : 18;
	const columns = landscape ? 6 : 4;
	const reversed = (s & 1) === 1;
	const base = ctx.globalAlpha;
	ctx.globalAlpha =
		base *
		clamp(0.5 * (k < 0.65 ? 1 : 1 - inCubic((k - 0.65) / 0.35)));
	ctx.fillStyle = popColor(options);
	for (let row = 1; row < rows; row += 1) {
		const length = width * outExpo(clamp((k - (row / rows) * 0.3) / 0.3));
		if (length < 1) continue;
		ctx.fillRect(
			reversed ? width - length : 0,
			Math.round((row * height) / rows) - weight / 2,
			length,
			weight,
		);
	}
	for (let column = 1; column < columns; column += 1) {
		const length = height * outExpo(clamp((k - 0.12 - (column / columns) * 0.2) / 0.3));
		if (length < 1) continue;
		ctx.fillRect(Math.round((column * width) / columns) - weight / 2, 0, weight, length);
	}
	ctx.globalAlpha = base;
}

/** コマ位置送り — the whole frame is re-registered: three small exact hard steps around a square. */
function drawFrameStep(options: X2TypoPixelEffectDraw): void {
	const { ctx, height, width } = options;
	const s = evSOf(options);
	const k = fxPhase(options);
	const amplitude = Math.min(width, height) * 0.024;
	const step = Math.min(3, Math.floor(k * 4));
	if (step >= 3) return;
	const path: readonly [number, number][] = [
		[1, 0],
		[1, 1],
		[0, 1],
	];
	const signX = (s & 1) === 1 ? 1 : -1;
	const signY = (s & 2) === 1 ? 1 : -1;
	const leg = path[step] ?? [0, 0];
	const offset: [number, number] =
		(s & 4) === 0 ? [leg[0], leg[1]] : [leg[1], leg[0]];
	replaceFxBFrame(options, () => {
		ctx.drawImage(
			options.source,
			Math.round(offset[0] * signX * amplitude),
			Math.round(offset[1] * signY * amplitude),
		);
	});
}

/* ================================================================== TRANSITIONS */

interface X2TypoTransitionDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly drawCurrent: () => void;
	readonly drawPrevious: () => void;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

/** JIZURA 追加分2 "x2typoB" transitions, mirroring the typography-transitions dispatch shape. */
export function drawX2TypoTrans(options: X2TypoTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	switch (options.frame.cut?.preset.trans) {
		case "tzBaselineFold":
			drawBaselineFold(options);
			return true;
		case "tzColumnReplace":
			drawColumnReplace(options);
			return true;
		case "tzRuleSplit":
			drawRuleSplit(options);
			return true;
		default:
			return false;
	}
}

/** Clip one region and paint the incoming cut inside it (JIZURA `part`). */
// eslint-disable-next-line opencut/prefer-object-params
function paintPart(
	options: X2TypoTransitionDraw,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const x0 = Math.max(0, Math.floor(x));
	const y0 = Math.max(0, Math.floor(y));
	const x1 = Math.min(options.width, Math.ceil(x + width));
	const y1 = Math.min(options.height, Math.ceil(y + height));
	if (x1 - x0 < 1 || y1 - y0 < 1) return;
	options.ctx.save();
	options.ctx.beginPath();
	options.ctx.rect(x0, y0, x1 - x0, y1 - y0);
	options.ctx.clip();
	options.drawCurrent();
	options.ctx.restore();
}

/** 罫割り — a hairline is drawn across the frame, splits in two, and the new cut is uncovered between the rules. */
function drawRuleSplit(options: X2TypoTransitionDraw): void {
	const { ctx, frame, height, width } = options;
	const progress = frame.enterProgress;
	if (progress <= 0) {
		options.drawPrevious();
		return;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return;
	}
	const seed = frame.cut?.seed ?? 0;
	const vertical = x2Hash(seed, 701) % 10 < 3;
	const longSide = vertical ? width : height;
	const crossSide = vertical ? height : width;
	const center = Math.round(longSide * (0.42 + (x2Hash(seed, 702) % 17) * 0.01));
	const accent = frame.palette.accent;
	const weight = Math.max(2, Math.round(Math.min(width, height) * 0.003));
	options.drawPrevious();
	const q1 = inOutCubic(clamp(progress / 0.3));
	const q2 = inOutCubic(clamp((progress - 0.24) / 0.76));
	const lo = lerpN(center, 0, q2);
	const hi = lerpN(center, longSide, q2);
	if (hi - lo >= 1) {
		if (vertical) {
			paintPart(options, lo, 0, hi - lo, height);
		} else {
			paintPart(options, 0, lo, width, hi - lo);
		}
	}
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * (1 - clamp((q2 - 0.85) / 0.15));
	ctx.fillStyle = accent;
	const half = (crossSide / 2) * q1;
	for (const y of q2 > 0 ? [lo, hi] : [center]) {
		if (vertical) {
			ctx.fillRect(y - weight / 2, crossSide / 2 - half, weight, half * 2);
		} else {
			ctx.fillRect(crossSide / 2 - half, y - weight / 2, half * 2, weight);
		}
	}
	ctx.globalAlpha = base;
}

/** 段ごと差し替え — the frame is set in text columns; column after column is replaced in a hard cut. */
function drawColumnReplace(options: X2TypoTransitionDraw): void {
	const { ctx, frame, height, width } = options;
	const progress = frame.enterProgress;
	if (progress <= 0) {
		options.drawPrevious();
		return;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return;
	}
	const seed = frame.cut?.seed ?? 0;
	const n = 4 + (x2Hash(seed, 711) % 4);
	const rtl = x2Hash(seed, 712) % 10 < 4;
	const accent = frame.palette.accent;
	const weight = Math.max(2, Math.round(Math.min(width, height) * 0.0028));
	options.drawPrevious();
	for (let index = 0; index < n; index += 1) {
		const order = rtl ? n - 1 - index : index;
		const u = clamp((progress - (index / n) * 0.78) / 0.22);
		if (u <= 0) continue;
		const x0 = Math.round((order * width) / n);
		const x1 = Math.round(((order + 1) * width) / n);
		paintPart(options, x0, 0, x1 - x0, height);
		if (u < 1) {
			ctx.fillStyle = accent;
			ctx.fillRect(x0, Math.round(height * outCubic(u)) - weight / 2, x1 - x0, weight);
			ctx.fillRect(x0, 0, weight, height);
			ctx.fillRect(x1 - weight, 0, weight, height);
		}
	}
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp(0.5 * Math.sin(Math.PI * clamp(progress)));
	ctx.fillStyle = accent;
	for (let index = 1; index < n; index += 1) {
		ctx.fillRect(Math.round((index * width) / n) - weight / 4, 0, weight / 2, height);
	}
	ctx.globalAlpha = base;
}

/** 基線に畳む — the old cut folds flat onto a baseline hairline; the new cut unfolds from the same line. */
function drawBaselineFold(options: X2TypoTransitionDraw): void {
	const { ctx, frame, height, width } = options;
	const progress = frame.enterProgress;
	if (progress <= 0) {
		options.drawPrevious();
		return;
	}
	if (progress >= 0.999) {
		options.drawCurrent();
		return;
	}
	const seed = frame.cut?.seed ?? 0;
	const baseline = Math.round(height * (0.5 + (x2Hash(seed, 721) % 17) * 0.01));
	const accent = frame.palette.accent;
	const weight = Math.max(2, Math.round(Math.min(width, height) * 0.003));
	const first = progress < 0.5;
	const scaleY = Math.max(
		0.002,
		first ? 1 - inCubic(progress / 0.5) : outCubic((progress - 0.5) / 0.5),
	);
	const previousBackground =
		frame.previousPalette?.background ?? frame.palette.background;
	ctx.fillStyle = mixHex({
		from: previousBackground,
		progress: clamp(progress),
		to: frame.palette.background,
	});
	ctx.fillRect(0, 0, width, height);
	ctx.save();
	ctx.transform(1, 0, 0, scaleY, 0, baseline * (1 - scaleY));
	if (first) {
		options.drawPrevious();
	} else {
		options.drawCurrent();
	}
	ctx.restore();
	const base = ctx.globalAlpha;
	ctx.globalAlpha =
		base * clamp(progress / 0.2) * (1 - clamp((progress - 0.8) / 0.2));
	ctx.fillStyle = accent;
	ctx.fillRect(0, baseline - weight / 2, width, weight);
	ctx.globalAlpha = base;
}
