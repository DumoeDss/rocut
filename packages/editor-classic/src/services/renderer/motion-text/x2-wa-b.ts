import type { MotionTextResolvedCut } from "@opencut/editor-contracts";

import {
	enterBDirection,
	enterBGlyphs,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inOutCubic,
	lerp,
	mixHex,
	randomUnit as ru,
	secondsOf,
} from "./exit-hold-geometry";
import type { KineticCameraTransform } from "./kinetic-cameras";
import {
	bell,
	transitionBoundary,
	type TreatTransTransitionDraw,
} from "./treat-trans-transition-drawing";
import type {
	MotionTextCanvasContext,
	MotionTextRenderFrame,
} from "./types";
import {
	drawX2Glyphs,
	x2Bounds,
	x2Stagger,
	type X2Draw,
	type X2Glyph,
	type X2GlyphTransform,
} from "./x2-drawing";

/**
 * JIZURA 追加分2 和風 pack "x2waB": 9 entrances, 5 holds, 8 exits, 5
 * treatments, 3 camera moves, 6 screen accents and 3 transitions built on
 * traditional Japanese objects and gestures.
 *
 * Transliteration notes (same simplifications as the other x2 ports): single
 * line, horizontal writing, `it.seed` collapses to the cut seed, item-local
 * clip paths become per-glyph clip windows, hold amount / fx motion default to
 * their planner defaults (1 / 0.7), and bezier / ellipse canvas ops are
 * sampled as polylines because the canvas contract has neither.
 */

const PI = Math.PI;
const TAU = PI * 2;
const TICKS = 120_000;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's cl(v, lo, hi).
function clampRange(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's lerp(a, b, t).
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress: clamp01(progress) });
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's mix(a, b, t).
function mix(from: string, to: string, progress: number): string {
	return mixHex({ from, to, progress: clamp01(progress) });
}

function oCubic(value: number): number {
	return 1 - (1 - clamp(value)) ** 3;
}

function ioCubic(value: number): number {
	return inOutCubic(value);
}

function inQuad(value: number): number {
	return clamp(value) ** 2;
}

function inCubic(value: number): number {
	return clamp(value) ** 3;
}

function outExpo(value: number): number {
	const progress = clamp(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's oBack(x, s).
function oBack(value: number, overshoot = 1.7): number {
	const progress = clamp(value) - 1;
	return 1 + (overshoot + 1) * progress ** 3 + overshoot * progress ** 2;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's sstep(a, b, x).
function sstep(a: number, b: number, x: number): number {
	const k = clamp((x - a) / (b - a));
	return k * k * (3 - 2 * k);
}

function frac(value: number): number {
	return value - Math.floor(value);
}

/* ------------------------------------------------------------ palette */

type WaPaletteDraw = { readonly frame: MotionTextRenderFrame };

function ownColor(options: WaPaletteDraw): string {
	return options.frame.palette.foreground;
}

function hotColor(options: WaPaletteDraw): string {
	return options.frame.palette.accent;
}

/** vermilion-seal / cloth accent (JIZURA sealOf collapsed to the accent). */
function sealColor(options: WaPaletteDraw): string {
	return options.frame.palette.accent;
}

/** paper tone: one step away from the background (JIZURA paperOf). */
function paperColor(options: WaPaletteDraw): string {
	return mix(options.frame.palette.background, options.frame.palette.foreground, 0.13);
}

function quietColor(options: WaPaletteDraw): string {
	return options.frame.palette.secondary;
}

function seedOf(options: X2Draw): number {
	return options.frame.cut?.seed ?? 0;
}

function lineW(size: number): number {
	return Math.max(2, size * 0.03);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's uv(env, b, m) padding helper.
function waBounds(options: X2Draw, margin: number) {
	const b = x2Bounds(options, margin);
	return {
		bottom: b.bottom,
		centerX: b.centerX,
		centerY: b.centerY,
		left: b.left,
		right: b.right,
		top: b.top,
	};
}

/** Whole-item scale/rotation about the line centre (JIZURA scaleAbout/rotAbout). */
function centeredTransform({
	bounds,
	glyph,
	rotation = 0,
	scale = 1,
}: {
	readonly bounds: {
		readonly centerX: number;
		readonly centerY: number;
	};
	readonly glyph: X2Glyph;
	readonly rotation?: number;
	readonly scale?: number;
}): X2GlyphTransform {
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const dx = glyph.x - bounds.centerX;
	const dy = glyph.y - bounds.centerY;
	return {
		rotation,
		scaleX: scale,
		scaleY: scale,
		translateX: bounds.centerX + cos * scale * dx - sin * scale * dy - glyph.x,
		translateY: bounds.centerY + sin * scale * dx + cos * scale * dy - glyph.y,
	};
}

/* ------------------------------------------------------------ shapes */

// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's compact env.line shape.
function waLine(
	ctx: MotionTextCanvasContext,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	color: string,
	width: number,
	alpha: number,
): void {
	const length = Math.hypot(x1 - x0, y1 - y0);
	if (length <= 0.05 || width <= 0.05 || alpha <= 0.004) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x0, y0);
	ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
	ctx.globalAlpha = baseAlpha * clamp(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(0, -width / 2, length, width);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's compact env.rect shape.
function waRect(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	w: number,
	h: number,
	color: string,
	alpha: number,
): void {
	if (w <= 0 || h <= 0 || alpha <= 0.004) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * clamp(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
	ctx.globalAlpha = baseAlpha;
}

// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's compact env.poly shape.
function waPoly(
	ctx: MotionTextCanvasContext,
	points: readonly (readonly [number, number])[],
	color: string,
	alpha: number,
): void {
	if (points.length < 3 || alpha <= 0.004) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = baseAlpha * clamp(alpha);
	ctx.fillStyle = color;
	if (ctx.beginPath && ctx.moveTo && ctx.lineTo && ctx.fill) {
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.fill();
	} else {
		const xs = points.map((point) => point[0]);
		const ys = points.map((point) => point[1]);
		ctx.fillRect(
			Math.min(...xs),
			Math.min(...ys),
			Math.max(...xs) - Math.min(...xs),
			Math.max(...ys) - Math.min(...ys),
		);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's compact polyline shape.
function waStroke(
	ctx: MotionTextCanvasContext,
	points: readonly (readonly [number, number])[],
	color: string,
	width: number,
	alpha: number,
): void {
	if (alpha <= 0.004) return;
	for (let index = 0; index + 1 < points.length; index += 1) {
		waLine(
			ctx,
			points[index]![0],
			points[index]![1],
			points[index + 1]![0],
			points[index + 1]![1],
			color,
			width,
			alpha,
		);
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's compact env.circle shape.
function waDisc(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	radius: number,
	color: string,
	alpha: number,
): void {
	if (radius <= 0.1 || alpha <= 0.004) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = baseAlpha * clamp(alpha);
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(x, y, radius, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

// eslint-disable-next-line opencut/prefer-object-params -- Sampled ellipse arc (no ctx.ellipse in the contract).
function ellipsePoints(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	rot: number,
	a0: number,
	a1: number,
	n = 20,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	const r = rot * degrees(1);
	for (let index = 0; index <= n; index += 1) {
		const an = lerpN(a0, a1, index / n) * degrees(1);
		const x = Math.cos(an) * rx;
		const y = Math.sin(an) * ry;
		points.push([
			cx + x * Math.cos(r) - y * Math.sin(r),
			cy + x * Math.sin(r) + y * Math.cos(r),
		]);
	}
	return points;
}

// eslint-disable-next-line opencut/prefer-object-params -- Rotated rectangle corners.
function waQuad(
	ctx: MotionTextCanvasContext,
	cx: number,
	cy: number,
	hw: number,
	hh: number,
	rot: number,
	color: string,
	alpha: number,
): void {
	const c = Math.cos(rot);
	const s = Math.sin(rot);
	waPoly(
		ctx,
		[
			[cx + (-hw) * c - (-hh) * s, cy + (-hw) * s + (-hh) * c],
			[cx + hw * c - (-hh) * s, cy + hw * s + (-hh) * c],
			[cx + hw * c - hh * s, cy + hw * s + hh * c],
			[cx + (-hw) * c - hh * s, cy + (-hw) * s + hh * c],
		],
		color,
		alpha,
	);
}

/* =====================================================================
   ENTER
   ===================================================================== */

export function drawX2WaEnter(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "wzChochin":
			drawWzChochinEnter(options);
			return true;
		case "wzFusuma":
			drawWzFusumaEnter(options);
			return true;
		case "wzHanabi":
			drawWzHanabiEnter(options);
			return true;
		case "wzHanko":
			drawWzHankoEnter(options);
			return true;
		case "wzKakejiku":
			drawWzKakejikuEnter(options);
			return true;
		case "wzKamifubuki":
			drawWzKamifubukiEnter(options);
			return true;
		case "wzMisu":
			drawWzMisuEnter(options);
			return true;
		case "wzOrigami":
			drawWzOrigamiEnter(options);
			return true;
		case "wzSeigaiha":
			drawWzSeigaihaEnter(options);
			return true;
		default:
			return false;
	}
}

/** 襖びらき — two sliding paper doors (frame, stile, round pull) stand closed over the line, then slide apart into the sides. */
function drawWzFusumaEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const show = oCubic(p / 0.2);
	const e = ioCubic((p - 0.16) / 0.72);
	const fade = 1 - sstep(0.8, 1, p);
	const b = waBounds(options, size * 0.28);
	const uc = (b.left + b.right) / 2;
	const vc = (b.top + b.bottom) / 2;
	const h = ((b.right - b.left) / 2) * e;
	const lw = lineW(size);
	const col = ownColor(options);
	const acc = hotColor(options);
	const paper = paperColor(options);
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			clipX: [(uc - h - glyph.x) / glyph.width, (uc + h - glyph.x) / glyph.width],
		}),
	});
	const a = fade * clamp(show * 1.5);
	if (a <= 0.01) return;
	const vh = ((b.bottom - b.top) / 2) * show;
	const v0 = vc - vh;
	const v1 = vc + vh;
	for (const sd of [-1, 1]) {
		const uIn = uc + sd * h;
		const uOut = sd < 0 ? b.left : b.right;
		const u0 = Math.min(uIn, uOut);
		const u1 = Math.max(uIn, uOut);
		if (u1 - u0 < 0.5) continue;
		waRect(ctx, u0, v0, u1 - u0, v1 - v0, paper, a);
		waRect(ctx, u0, v0, u1 - u0, lw, col, a);
		waRect(ctx, u0, v1 - lw, u1 - u0, lw, col, a);
		waRect(ctx, sd < 0 ? u1 - lw : u0, v0, lw, v1 - v0, col, a);
		const um = (u0 + u1) / 2;
		waRect(ctx, um - lw * 0.3, v0, lw * 0.6, v1 - v0, col, a * 0.55);
		if (u1 - u0 > size * 0.7) {
			waStroke(
				ctx,
				ellipsePoints(uIn - sd * size * 0.36, vc, size * 0.085 * show, size * 0.085 * show, 0, 0, 360, 16),
				acc,
				lw * 0.75,
				a,
			);
		}
	}
}

/** 掛け軸 — a hanging scroll: the top bar appears, then the weighted rod rolls down and lets the text out line by line. */
function drawWzKakejikuEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const top = oCubic(p / 0.2);
	const e = ioCubic((p - 0.12) / 0.72);
	const fade = 1 - sstep(0.84, 1, p);
	const m = size * 0.3;
	const b = waBounds(options, 0);
	const yOf = lerpN(b.top - m, b.bottom + m, e);
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			clipY: [-3, (yOf - glyph.y) / glyph.height],
		}),
	});
	const a = fade;
	if (a <= 0.01) return;
	const col = ownColor(options);
	const acc = hotColor(options);
	const cx = b.centerX;
	const hw = ((b.right - b.left) / 2 + m) * top;
	const y0 = b.top - m;
	const y = yOf;
	const lw = lineW(size);
	const rod = Math.max(4, size * 0.085);
	waRect(ctx, cx - hw, y0 - lw, hw * 2, lw, col, a);
	waStroke(
		ctx,
		[
			[cx - size * 0.32 * top, y0 - lw],
			[cx, y0 - lw - size * 0.26 * top],
			[cx + size * 0.32 * top, y0 - lw],
		],
		col,
		lw * 0.5,
		a * 0.8,
	);
	if (y - y0 > 1) {
		waRect(ctx, cx - hw, y0, lw * 0.4, y - y0, col, a * 0.45);
		waRect(ctx, cx + hw - lw * 0.4, y0, lw * 0.4, y - y0, col, a * 0.45);
	}
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * a * clamp(top * 2);
	waRect(ctx, cx - hw - rod * 0.4, y - rod / 2, hw * 2 + rod * 0.8, rod, col, 1);
	waRect(ctx, cx - hw - rod * 1.3, y - rod * 0.72, rod * 0.9, rod * 1.44, acc, top);
	waRect(ctx, cx + hw + rod * 0.4, y - rod * 0.72, rod * 0.9, rod * 1.44, acc, top);
	ctx.globalAlpha = baseAlpha;
}

/** 御簾上げ — the text is first seen through the slats of a bamboo blind, which is then drawn up: the slats bunch at the top. */
function drawWzMisuEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const show = clamp(p / 0.16);
	const e = ioCubic((p - 0.14) / 0.66);
	const fade = 1 - sstep(0.8, 1, p);
	const m = size * 0.22;
	const b = waBounds(options, 0);
	const y0 = b.top - m;
	const y1 = b.bottom + m;
	const N = Math.round(clampRange((y1 - y0) / (size * 0.14), 6, 40));
	const pitch = (y1 - y0) / N;
	const th = pitch * 0.5;
	const bp = th * 0.4;
	const yb = lerpN(y1, y0, e);
	const ys: number[] = [];
	for (let index = 0; index < N; index += 1) {
		ys.push(Math.min(y0 + (index + 0.5) * pitch, yb - (N - 1 - index) * bp - th / 2));
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			alpha: show,
			clipY: [(yb - glyph.y) / glyph.height, 3],
		}),
	});
	const a = fade * show;
	if (a <= 0.01) return;
	const slat = quietColor(options);
	const acc = hotColor(options);
	const x0 = b.left - m;
	const w = b.right - b.left + m * 2;
	for (let index = 0; index < N; index += 1) {
		waRect(ctx, x0, ys[index]! - th / 2, w, th, slat, a * 0.9);
	}
	const topY = ys[0]! - th;
	const cw = Math.max(2, size * 0.035);
	for (const f of w > size * 2.4 ? [0.2, 0.8] : [0.5]) {
		const cx = x0 + w * f;
		waRect(ctx, cx - cw / 2, topY, cw, Math.max(0, yb - topY), acc, a);
		waRect(ctx, cx - cw * 1.4, yb, cw * 2.8, size * 0.14, acc, a);
	}
}

/** 判子 — pressed like a seal: the line lands white-on-vermilion, then the block lifts off in uneven patches and leaves the text. */
function drawWzHankoEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const seed = seedOf(options);
	const tI = 0.26;
	const dir = enterBDirection(options, 11);
	const down = inQuad(p / tI);
	const t = clamp((p - tI) / (1 - tI));
	const own = ownColor(options);
	const seal = sealColor(options);
	const knock = options.frame.palette.background;
	const lift = sstep(0.4, 0.96, p);
	const scale = p < tI ? lerpN(1.2, 1, down) : 1 - 0.035 * Math.exp(-t * 10) * (1 - t);
	const b = waBounds(options, 0);
	// vermilion block behind the line, lifting off patch by patch
	const m = size * 0.2;
	const x0 = b.left - m;
	const y0 = b.top - m;
	const w = b.right - b.left + m * 2;
	const h = b.bottom - b.top + m * 2;
	const cols = Math.round(clampRange(w / (size * 0.4), 2, 16));
	const rows = Math.round(clampRange(h / (size * 0.4), 2, 7));
	const cw = w / cols;
	const chh = h / rows;
	const blockAlpha = clamp(p * 3);
	for (let j = 0; j < rows; j += 1) {
		for (let index = 0; index < cols; index += 1) {
			const r1 = ru(seed, index, j, 201);
			const a =
				(0.84 + 0.16 * ru(seed, index, j, 202)) *
				(1 - sstep(r1 * 0.68, r1 * 0.68 + 0.3, lift));
			if (a <= 0.01) continue;
			const ex = size * 0.045;
			const ix0 = index === 0 ? ru(seed, j, 203) * ex : 0;
			const ix1 = index === cols - 1 ? ru(seed, j, 204) * ex : 0;
			const iy0 = j === 0 ? ru(seed, index, 205) * ex : 0;
			const iy1 = j === rows - 1 ? ru(seed, index, 206) * ex : 0;
			waRect(
				ctx,
				x0 + index * cw + ix0,
				y0 + j * chh + iy0,
				cw - ix0 - ix1 + 0.6,
				chh - iy0 - iy1 + 0.6,
				seal,
				a * blockAlpha,
			);
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			alpha: clamp(p / 0.1),
			color: mix(knock, own, sstep(0.45, 0.85, p)),
			...centeredTransform({
				bounds: b,
				glyph,
				rotation: degrees(dir * -5 * (1 - down)),
				scale,
			}),
		}),
	});
}

/** 提灯ともし — paper lanterns light up one after another along the line; each glyph glows warm inside its lantern, which then fades. */
function drawWzChochinEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const seed = seedOf(options);
	const own = ownColor(options);
	const warm = hotColor(options);
	const step = Math.floor(secondsOf(options.frame) * 24);
	const count = Math.max(1, Math.round(Array.from(options.text).length));
	// eslint-disable-next-line opencut/prefer-object-params -- Per-glyph stagger mirrors the source charFns shape.
	const qf = (i: number, n: number) => x2Stagger(p, n > 1 ? i / (n - 1) : 0, 0.6);
	// lantern bodies behind each glyph
	const glyphs = options.frame.cut ? enterBGlyphs(options) : [];
	for (const glyph of glyphs) {
		const q = qf(glyph.index, count);
		if (q <= 0 || q >= 1) continue;
		const lit = clamp(q * 4) * (1 - sstep(0.5, 1, q));
		if (lit <= 0.01) continue;
		const lw = Math.max(1.5, size * 0.018);
		const rx = Math.max(glyph.width, size * 0.6) * 0.6;
		const ry = Math.max(glyph.height, size * 0.6) * 0.7;
		const cap = size * 0.07;
		const body = ellipsePoints(glyph.x, glyph.y, rx, ry, 0, 0, 360, 24);
		waPoly(ctx, body, warm, lit * 0.2);
		waStroke(ctx, body, warm, lw, lit * 0.9);
		for (const k of [-0.5, 0, 0.5]) {
			const hw = rx * Math.sqrt(Math.max(0, 1 - k * k));
			waLine(
				ctx,
				glyph.x - hw,
				glyph.y + k * ry,
				glyph.x + hw,
				glyph.y + k * ry,
				warm,
				lw,
				lit * 0.45,
			);
		}
		waRect(ctx, glyph.x - rx * 0.42, glyph.y - ry - cap, rx * 0.84, cap, warm, lit * 0.9);
		waRect(ctx, glyph.x - rx * 0.42, glyph.y + ry, rx * 0.84, cap, warm, lit * 0.9);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index, count);
			if (q <= 0) return null;
			if (q >= 1) return undefined;
			const fl = q < 0.45 ? 0.55 + 0.45 * ru(seed, glyph.index, step, 211) : 1;
			return {
				alpha: clamp(q * 3.5) * fl,
				color: mix(warm, own, sstep(0.45, 1, q)),
			};
		},
	});
}

/** 紙吹雪 — paper confetti flutters down and settles where each glyph belongs; the glyph surfaces as its flakes land. */
function drawWzKamifubukiEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const seed = seedOf(options);
	const sc = options.frame.palette;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	const cols = [hotColor(options), sc.secondary, ownColor(options), quietColor(options)];
	 
	const qf = (i: number) => x2Stagger(p, ru(seed, i, 221), 0.36);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0 || q >= 1) continue;
		const out = 1 - sstep(0.68, 1, q);
		const K = Math.round(clampRange(90 / n, 2, 5));
		for (let k = 0; k < K; k += 1) {
			const r1 = ru(seed, glyph.index, k, 222);
			const tf = clamp((q / 0.62) * (0.78 + 0.22 * r1));
			const ef = 1 - (1 - tf) ** 1.5;
			const ph = ru(seed, glyph.index, k, 223) * TAU;
			const tx = glyph.x + (ru(seed, glyph.index, k, 224) * 2 - 1) * glyph.width * 0.32;
			const ty = glyph.y + (ru(seed, glyph.index, k, 225) * 2 - 1) * glyph.height * 0.32;
			const px =
				tx +
				(1 - ef) * (ru(seed, glyph.index, k, 226) * 2 - 1) * size * 1.5 +
				Math.sin(tf * 9 + ph) * size * 0.24 * (1 - tf);
			const py =
				ty - (1 - ef) * size * (1.5 + 1.7 * ru(seed, glyph.index, k, 227));
			const a = clamp(tf * 5) * out;
			if (a <= 0.01) continue;
			const rot = ph + tf * 8;
			const fl = Math.cos(tf * 11 + ph);
			const hw = size * 0.075 * (0.25 + 0.75 * Math.abs(fl));
			const hh = size * 0.048;
			waQuad(
				ctx,
				px,
				py,
				hw,
				hh,
				rot,
				cols[(glyph.index + k) % 4]!,
				a,
			);
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0.5) return null;
			if (q >= 1) return undefined;
			return {
				alpha: sstep(0.5, 0.85, q),
				scaleX: lerpN(0.82, 1, oCubic((q - 0.5) / 0.5)),
				scaleY: lerpN(0.82, 1, oCubic((q - 0.5) / 0.5)),
			};
		},
	});
}

/** 打ち上げ花火 — a spark climbs to each glyph's place and bursts into a ring of streaks; the glyph pops out of the burst. */
function drawWzHanabiEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const seed = seedOf(options);
	const sc = options.frame.palette;
	const tB = 0.32;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	const c1 = hotColor(options);
	const c2 = sc.secondary;
	 
	const qf = (i: number) =>
		x2Stagger(
			p,
			(n > 1 ? i / (n - 1) : 0) * 0.65 + ru(seed, i, 231) * 0.35,
			0.42,
		);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0 || q >= 1) continue;
		const col = glyph.index % 2 ? c2 : c1;
		if (q < tB) {
			const t = q / tB;
			const e = oCubic(t);
			const y = glyph.y + size * 1.5 * (1 - e);
			const a = clamp(t * 6);
			waLine(
				ctx,
				glyph.x,
				y,
				glyph.x,
				y + size * 0.4 * (1 - t) + 2,
				col,
				Math.max(1.5, size * 0.022),
				a * 0.8,
			);
			waDisc(ctx, glyph.x, y, size * 0.035, col, a);
		} else {
			const u = (q - tB) / (1 - tB);
			const a = 1 - sstep(0.4, 1, u);
			if (a <= 0.01) continue;
			const r0 = size * (0.2 + 0.72 * outExpo(u));
			const len = size * 0.24 * (1 - u) + 1;
			const droop = size * 0.16 * u * u;
			const o = ru(seed, glyph.index, 232) * TAU;
			const R = n > 12 ? 8 : 12;
			for (let k = 0; k < R; k += 1) {
				const an = o + (k / R) * TAU;
				const c = Math.cos(an);
				const s = Math.sin(an);
				const rr = r0 * (k % 2 ? 0.72 : 1);
				waLine(
					ctx,
					glyph.x + c * rr,
					glyph.y + s * rr + droop,
					glyph.x + c * (rr + len),
					glyph.y + s * (rr + len) + droop,
					k % 2 ? c2 : c1,
					Math.max(1.5, size * 0.024),
					a,
				);
			}
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= tB) return null;
			if (q >= 1) return undefined;
			const u = (q - tB) / (1 - tB);
			return {
				alpha: clamp(u * 4),
				scaleX: lerpN(0.3, 1, oBack(u / 0.6, 1.9)),
				scaleY: lerpN(0.3, 1, oBack(u / 0.6, 1.9)),
			};
		},
	});
}

/** 折り紙 — every glyph sits on a folded paper square: a quarter shows first, the right half swings out, then the lower half folds down. */
function drawWzOrigamiEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const sc = options.frame.palette;
	const F = 0.78;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	const papers = [hotColor(options), sc.secondary, quietColor(options)];
	 
	const stage = (q: number) => ({
		scale: lerpN(0.4, 1, oBack(q / 0.2, 1.6)),
		x1: ioCubic((q - 0.2) / 0.38),
		y1: ioCubic((q - 0.58) / 0.42),
	});
	 
	const qf = (i: number) => x2Stagger(p, n > 1 ? i / (n - 1) : 0, 0.5);
	const col = ownColor(options);
	const lw = Math.max(1, size * 0.012);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0 || q >= 1) continue;
		const s = stage(q);
		const hs = Math.max(glyph.width, glyph.height) * 0.56 * s.scale;
		const a = clamp(q * 8) * (1 - sstep(0.8, 1, q));
		if (a <= 0.01) continue;
		const X1 = hs * s.x1;
		const Y1 = hs * s.y1;
		const pc = papers[glyph.index % 3]!;
		waRect(ctx, glyph.x - hs, glyph.y - hs, hs + X1, hs + Y1, pc, a * 0.3);
		if (s.x1 > 0 && s.x1 < 1) {
			waRect(ctx, glyph.x, glyph.y - hs, X1, hs, col, a * 0.22 * (1 - s.x1));
		}
		if (s.y1 > 0 && s.y1 < 1) {
			waRect(ctx, glyph.x - hs, glyph.y, hs * 2, Y1, col, a * 0.22 * (1 - s.y1));
		}
		if (s.x1 > 0) waRect(ctx, glyph.x - lw / 2, glyph.y - hs, lw, hs + Y1, col, a * 0.5);
		if (s.y1 > 0) waRect(ctx, glyph.x - hs, glyph.y - lw / 2, hs + X1, lw, col, a * 0.5);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0) return null;
			if (q >= 1) return undefined;
			const s = stage(q);
			return {
				alpha: clamp(q * 8),
				clipX: [-F, F * s.x1],
				clipY: [-F, F * s.y1],
				scaleX: s.scale,
				scaleY: s.scale,
			};
		},
	});
}

/** 青海波 — the reveal rises from below as rows of overlapping wave scales, each drawn with its double arc. */
function drawWzSeigaihaEnter(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.enterProgress;
	const b = waBounds(options, 0);
	const m = size * 0.25;
	const x0 = b.left - m;
	const x1 = b.right + m;
	const y0 = b.top - m;
	const y1 = b.bottom + m;
	const r = Math.max(size * 0.36, Math.sqrt(((x1 - x0) * (y1 - y0)) / 140));
	const dx = r * 1.5;
	const dy = r * 0.62;
	const rows = Math.ceil((y1 - y0) / dy) + 2;
	const cols = Math.ceil((x1 - x0) / dx) + 2;
	const hot = hotColor(options);
	const lw = Math.max(1.5, size * 0.022);
	// average reveal per column: the arc union is approximated by a
	// bottom-up window whose height follows the column's rows
	const columnQ: number[] = [];
	for (let i = 0; i < cols; i += 1) {
		let sum = 0;
		for (let j = 0; j < rows; j += 1) {
			sum += x2Stagger(
				p,
				(j / Math.max(1, rows - 1)) * 0.75 + (i / Math.max(1, cols - 1)) * 0.25,
				0.62,
			);
		}
		columnQ.push(sum / rows);
	}
	for (let j = 0; j < rows; j += 1) {
		for (let i = 0; i < cols; i += 1) {
			const q = x2Stagger(
				p,
				(j / Math.max(1, rows - 1)) * 0.75 + (i / Math.max(1, cols - 1)) * 0.25,
				0.62,
			);
			if (q <= 0 || q >= 1) continue;
			const cx = x0 + (i - 0.5 + (j % 2 ? 0.5 : 0)) * dx;
			const cy = y1 + r * 0.4 - j * dy;
			const R = r * 1.32 * oCubic(q);
			const a = (1 - q) * 0.9;
			waStroke(ctx, ellipsePoints(cx, cy, R, R, 0, 180, 360, 16), hot, lw, a);
			waStroke(ctx, ellipsePoints(cx, cy, R * 0.62, R * 0.62, 0, 180, 360, 12), hot, lw * 0.7, a * 0.7);
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const column = Math.min(
				cols - 1,
				Math.max(0, Math.round((glyph.x - (x0 - dx / 2)) / dx)),
			);
			const q = columnQ[column] ?? 0;
			return {
				clipY: [1.2 - 2.4 * q, 1.2],
			};
		},
	});
}

/* =====================================================================
   EXIT
   ===================================================================== */

export function drawX2WaExit(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "wzDoron":
			drawWzDoronExit(options);
			return true;
		case "wzFuroshiki":
			drawWzFuroshikiExit(options);
			return true;
		case "wzHanaChiru":
			drawWzHanaChiruExit(options);
			return true;
		case "wzKasumi":
			drawWzKasumiExit(options);
			return true;
		case "wzOrizuru":
			drawWzOrizuruExit(options);
			return true;
		case "wzShojiKage":
			drawWzShojiKageExit(options);
			return true;
		case "wzSumiNijimi":
			drawWzSumiNijimiExit(options);
			return true;
		case "wzToro":
			drawWzToroExit(options);
			return true;
		default:
			return false;
	}
}

/** 障子の影 — a shoji screen slides across; behind its paper the line lingers as a soft shadow until the light goes out. */
function drawWzShojiKageExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const dir = enterBDirection(options, 21);
	const e = ioCubic(p / 0.5);
	const sil = 1 - sstep(0.42, 0.8, p);
	const pa = 1 - sstep(0.74, 1, p);
	const b = waBounds(options, size * 0.25);
	const edge = dir > 0 ? lerpN(b.left, b.right, e) : lerpN(b.right, b.left, e);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (e >= 1) return null;
			const bound = (edge - glyph.x) / glyph.width;
			return dir > 0 ? { clipX: [-3, bound] } : { clipX: [bound, 3] };
		},
	});
	if (pa <= 0.01) return;
	const c0 = dir > 0 ? b.left : edge;
	const c1 = dir > 0 ? edge : b.right;
	if (c1 - c0 < 0.5) return;
	const col = ownColor(options);
	const paper = paperColor(options);
	const lw = Math.max(1.5, size * 0.02);
	waRect(ctx, c0, b.top, c1 - c0, b.bottom - b.top, paper, pa * 0.97);
	if (sil > 0.01) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(c0, b.top, c1 - c0, b.bottom - b.top);
		ctx.clip();
		drawX2Glyphs({
			options,
			resolve: () => ({
				alpha: sil * pa * 0.75,
				color: mix(paper, col, 0.6),
			}),
		});
		ctx.restore();
	}
	const a = pa * 0.85;
	const nv = Math.max(2, Math.round((b.bottom - b.top) / (size * 0.5)));
	const cu = size * 0.78;
	for (let k = 1; k < nv; k += 1) {
		const v = b.top + ((b.bottom - b.top) * k) / nv;
		waRect(ctx, c0, v - lw * 0.35, c1 - c0, lw * 0.7, col, a * 0.7);
	}
	for (let j = 1; j < 60; j += 1) {
		const u = edge - dir * j * cu;
		if (u <= c0 || u >= c1) break;
		waRect(ctx, u - lw * 0.35, b.top, lw * 0.7, b.bottom - b.top, col, a * 0.7);
	}
	waRect(ctx, c0, b.top, c1 - c0, lw, col, a);
	waRect(ctx, c0, b.bottom - lw, c1 - c0, lw, col, a);
	waRect(
		ctx,
		Math.max(c0, Math.min(c1 - lw * 1.6, dir > 0 ? edge - lw * 1.6 : edge)),
		b.top,
		Math.max(0, Math.min(c1, dir > 0 ? edge : edge + lw * 1.6) - Math.max(c0, Math.min(c1 - lw * 1.6, dir > 0 ? edge - lw * 1.6 : edge))),
		b.bottom - b.top,
		col,
		a,
	);
}

/** 墨にじみ — each glyph bleeds into the paper: it swells into an irregular ink blot that thins out to nothing. */
function drawWzSumiNijimiExit(options: EnterBDraw): void {
	const { ctx } = options;
	const p = options.frame.exitProgress;
	const seed = seedOf(options);
	const col = ownColor(options);
	const glyphs = enterBGlyphs(options);
	 
	const qf = (i: number) => x2Stagger(p, ru(seed, i, 31), 0.45);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0 || q >= 1) continue;
		const R =
			Math.max(glyph.width, glyph.height) * lerpN(0.2, 0.72, oCubic(q));
		const a = clamp(q * 3.2) * (1 - q) ** 1.3 * 0.9;
		if (a <= 0.01) continue;
		const pts: (readonly [number, number])[] = [];
		for (let k = 0; k < 10; k += 1) {
			const an = (k / 10) * TAU;
			const rr =
				R *
				(0.76 +
					0.34 * ru(seed, glyph.index, k, 32) +
					0.12 * q * (ru(seed, glyph.index, k, 33) * 2 - 1));
			pts.push([glyph.x + Math.cos(an) * rr, glyph.y + Math.sin(an) * rr]);
		}
		waPoly(ctx, pts, col, a);
		for (let k = 0; k < 3; k += 1) {
			const an = ru(seed, glyph.index, k, 34) * TAU;
			const d = R * (1.05 + 0.5 * ru(seed, glyph.index, k, 35));
			waDisc(
				ctx,
				glyph.x + Math.cos(an) * d,
				glyph.y + Math.sin(an) * d,
				R * (0.07 + 0.09 * ru(seed, glyph.index, k, 36)),
				col,
				a * 0.8,
			);
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0) return undefined;
			if (q >= 1) return null;
			return {
				alpha: 1 - sstep(0.05, 0.5, q),
				scaleX: 1 + 0.12 * q,
				scaleY: 1 + 0.12 * q,
			};
		},
	});
}

const PETAL: readonly (readonly [number, number])[] = [
	[0, -1],
	[0.58, -0.3],
	[0.4, 0.75],
	[0, 0.5],
	[-0.4, 0.75],
	[-0.58, -0.3],
];

/** 花びらに散る — the glyphs thin out while petals lift off them and ride the wind away. */
function drawWzHanaChiruExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const seed = seedOf(options);
	const dir = enterBDirection(options, 41);
	const W = options.maxWidth / 0.86;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	 
	const qf = (i: number) =>
		x2Stagger(p, clamp(dir > 0 ? 1 - i / (n - 1) : i / (n - 1)), 0.45);
	const c1 = hotColor(options);
	const c2 = mix(c1, options.frame.palette.foreground, 0.35);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0) continue;
		const K = Math.round(clampRange(90 / n, 2, 6));
		for (let k = 0; k < K; k += 1) {
			const r1 = ru(seed, glyph.index, k, 42);
			const t = clamp(q * 1.28 - 0.28 * ru(seed, glyph.index, k, 43));
			if (t <= 0 || t >= 1) continue;
			const a = sstep(0, 0.12, t) * (1 - sstep(0.55, 1, t));
			if (a <= 0.01) continue;
			const ph = ru(seed, glyph.index, k, 44) * TAU;
			const px =
				glyph.x +
				(ru(seed, glyph.index, k, 45) * 2 - 1) * glyph.width * 0.3 +
				dir *
					(size * 2 + W * 0.1) *
					t ** 1.4 *
					(0.55 + 0.8 * r1) +
				Math.sin(t * 7 + ph) * size * 0.18;
			const py =
				glyph.y +
				(ru(seed, glyph.index, k, 46) * 2 - 1) * glyph.height * 0.3 -
				size * 0.55 * Math.sin(t * PI * 0.9) * r1 +
				size * 0.9 * t * t * (0.4 + ru(seed, glyph.index, k, 47));
			const rot = ph + t * 6 * (r1 < 0.5 ? -1 : 1);
			const fl = 0.3 + 0.7 * Math.abs(Math.cos(t * 9 + ph));
			const s = size * 0.12 * (0.7 + 0.6 * ru(seed, glyph.index, k, 48));
			const c = Math.cos(rot);
			const sn = Math.sin(rot);
			waPoly(
				ctx,
				PETAL.map(
					([u, v]) =>
						[
							px + (u * fl * c - v * sn) * s,
							py + (u * fl * sn + v * c) * s,
						] as const,
				),
				k % 2 ? c2 : c1,
				a,
			);
		}
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0) return undefined;
			if (q >= 1) return null;
			return {
				alpha: 1 - sstep(0.05, 0.5, q),
				scaleX: 1 - 0.25 * q,
				scaleY: 1 - 0.25 * q,
				translateX: dir * size * 0.3 * q * q,
				translateY: -size * 0.08 * q,
			};
		},
	});
}

/** 霞に隠れる — bands of mist with rounded heads drift in from alternating sides, row by row, until nothing of the line is left. */
function drawWzKasumiExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const seed = seedOf(options);
	const m = size * 0.3;
	const b = waBounds(options, 0);
	const Y0 = b.top - m;
	const Y1 = b.bottom + m;
	const R = Math.round(clampRange((Y1 - Y0) / (size * 0.36), 4, 18));
	const h = (Y1 - Y0) / R;
	const r = h / 2;
	const X0 = b.left - m;
	const X1 = b.right + m;
	const rows: {
		readonly e: number;
		readonly hx: number;
		readonly sd: number;
	}[] = [];
	for (let j = 0; j < R; j += 1) {
		const sd = (j + (seed & 1)) % 2 ? 1 : -1;
		const e = ioCubic(x2Stagger(p, frac(j * 0.618 + ru(seed, 51)), 0.42));
		rows.push({
			e,
			hx: sd > 0 ? lerpN(X0 - r * 2, X1 + 1, e) : lerpN(X1 + r * 2, X0 - 1, e),
			sd,
		});
	}
	// clip approximation: the row bands collapse into a centre-shrinking window
	let leftCover = X0 - 1;
	let rightCover = X1 + 1;
	for (const row of rows) {
		if (row.sd > 0) leftCover = Math.max(leftCover, row.hx);
		else rightCover = Math.min(rightCover, row.hx);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			clipX: [(leftCover - glyph.x) / glyph.width, (rightCover - glyph.x) / glyph.width],
		}),
	});
	const lc = quietColor(options);
	const lw = Math.max(2, size * 0.026);
	const tail = size * 2.6;
	for (let j = 0; j < R; j += 1) {
		const row = rows[j]!;
		if (row.e <= 0 || row.e >= 1) continue;
		const a = sstep(0, 0.12, row.e) * (1 - sstep(0.82, 1, row.e));
		const yc = Y0 + (j + 0.5) * h;
		const rr = r - lw / 2;
		waStroke(
			ctx,
			ellipsePoints(row.hx, yc, rr, rr, 0, row.sd > 0 ? -90 : 90, row.sd > 0 ? 90 : 270, 12),
			lc,
			lw,
			a,
		);
		waLine(ctx, row.hx, yc - rr, row.hx - row.sd * tail, yc - rr, lc, lw, a);
		waLine(ctx, row.hx, yc + rr, row.hx - row.sd * tail * 0.6, yc + rr, lc, lw, a);
	}
}

/** 風呂敷 — four corners of a wrapping cloth fold in over the line one after another; the tied bundle is lifted away. */
function drawWzFuroshikiExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const tW = 0.64;
	const dir = enterBDirection(options, 61);
	const cloth = sealColor(options);
	const cloth2 = mix(cloth, options.frame.palette.background, 0.24);
	const seam = mix(cloth, "#000000", 0.3);
	 
	const fold = (k: number) => ioCubic(x2Stagger(clamp(p / tW), k / 3, 0.5));
	const wrap = clamp((p - tW) / (1 - tW));
	const s = 1 - inCubic(wrap);
	drawX2Glyphs({
		options,
		resolve: () => (p >= tW ? null : { alpha: 1 - sstep(0.25, tW, p) }),
	});
	if (s <= 0.003) return;
	const b = waBounds(options, 0);
	const mg = size * 0.28;
	const hw = (b.right - b.left) / 2 + mg;
	const hh = (b.bottom - b.top) / 2 + mg;
	const lw = Math.max(1.5, size * 0.02);
	ctx.save();
	ctx.translate(b.centerX, b.centerY - size * 0.7 * Math.sin((wrap * PI) / 2));
	ctx.rotate(dir * 0.3 * wrap);
	ctx.scale(s, s);
	const flaps: (readonly (readonly [number, number])[])[] = [
		[
			[-hw, -hh],
			[-hw, hh],
			[-hw, 0],
		],
		[
			[hw, -hh],
			[hw, hh],
			[hw, 0],
		],
		[
			[-hw, -hh],
			[hw, -hh],
			[0, -hh],
		],
		[
			[-hw, hh],
			[hw, hh],
			[0, hh],
		],
	];
	flaps.forEach(([p0, p1, mid], k) => {
		const f = fold(k);
		if (f <= 0.002) return;
		const ap: readonly [number, number] = [
			mid[0] * (1 - f),
			mid[1] * (1 - f),
		];
		waPoly(ctx, [p0, p1, ap], k % 2 ? cloth2 : cloth, 1);
		waStroke(ctx, [p0, ap, p1], seam, lw, 0.8);
	});
	if (wrap > 0) {
		const kk = Math.min(1, wrap * 4);
		const e = size * 0.34 * kk;
		waPoly(
			ctx,
			[
				[0, -hh * 0.1],
				[-e * 1.3, -hh * 0.1 - e],
				[-e * 0.3, -hh * 0.1 - e * 0.2],
			],
			cloth2,
			1,
		);
		waPoly(
			ctx,
			[
				[0, -hh * 0.1],
				[e * 1.3, -hh * 0.1 - e],
				[e * 0.3, -hh * 0.1 - e * 0.2],
			],
			cloth2,
			1,
		);
		waDisc(ctx, 0, -hh * 0.1, e * 0.3, seam, 1);
	}
	ctx.restore();
}

/** 折り鶴 — each glyph folds itself into a small paper crane that flaps off up and away. */
// eslint-disable-next-line opencut/prefer-object-params -- Crane assembly mirrors the source crane() helper's call shape.
function drawCrane(
	ctx: MotionTextCanvasContext,
	cx: number,
	cy: number,
	s: number,
	dir: number,
	flap: number,
	rot: number,
	c1: string,
	c2: string,
	a: number,
): void {
	const c = Math.cos(rot);
	const sn = Math.sin(rot);
	const T = (pts: readonly (readonly [number, number])[]) =>
		pts.map(([u, v]) => {
			const x = u * dir * s;
			const y = v * s;
			return [cx + x * c - y * sn, cy + x * sn + y * c] as const;
		});
	const f = 0.25 + 0.75 * flap;
	waPoly(ctx, T([[-0.12, 0], [0.2, 0], [-0.02, -0.72 * f]]), c2, a);
	waPoly(ctx, T([[-0.2, 0], [-0.72, -0.3], [-0.3, 0.1]]), c1, a);
	waPoly(ctx, T([[0.2, 0.02], [0.62, -0.4], [0.3, 0.12]]), c1, a);
	waPoly(ctx, T([[0.62, -0.4], [0.8, -0.28], [0.58, -0.3]]), c1, a);
	waPoly(ctx, T([[-0.34, 0], [0.34, 0], [0, 0.26]]), c1, a);
	waPoly(ctx, T([[-0.2, 0.02], [0.14, 0.02], [0.1, -0.62 * f + 0.06]]), c1, a);
}

function drawWzOrizuruExit(options: EnterBDraw): void {
	const size = options.size;
	const p = options.frame.exitProgress;
	const seed = seedOf(options);
	const dir = enterBDirection(options, 71);
	const W = options.maxWidth / 0.86;
	const H = options.size * 4;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	 
	const qf = (i: number) => x2Stagger(p, n > 1 ? i / (n - 1) : 0, 0.42);
	const every = Math.max(1, Math.ceil(n / 16));
	const c1 = ownColor(options);
	const c2 = mix(c1, hotColor(options), 0.55);
	const { ctx } = options;
	for (const glyph of glyphs) {
		if (glyph.index % every) continue;
		const q = qf(glyph.index);
		if (q <= 0.06 || q >= 1) continue;
		const k1 = sstep(0.06, 0.3, q);
		const t = clamp((q - 0.22) / 0.78);
		const a = k1 * (1 - sstep(0.7, 1, t));
		if (a <= 0.01) continue;
		const r1 = ru(seed, glyph.index, 72);
		const px =
			glyph.x + dir * (size * 0.6 + W * 0.3) * t ** 1.8 * (0.7 + 0.6 * r1);
		const py =
			glyph.y -
			(size * 0.5 + H * 0.2) * t ** 1.4 +
			Math.sin(t * 10 + glyph.index) * size * 0.07;
		drawCrane(
			ctx,
			px,
			py,
			size * 0.56 * k1 * (1 - 0.3 * t),
			dir,
			0.5 + 0.5 * Math.sin(q * 40 + glyph.index * 1.7),
			-dir * 0.22 * t,
			c1,
			c2,
			a,
		);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0) return undefined;
			if (q >= 0.3) return null;
			return {
				alpha: 1 - sstep(0.1, 0.3, q),
				scaleX: lerpN(1, 0.3, oCubic(q / 0.3)),
				scaleY: lerpN(1, 0.3, oCubic(q / 0.3)),
			};
		},
	});
}

/** 煙玉 — ドロン: a puff of round smoke bursts over the line, the text is gone behind it, and the smoke drifts up and thins out. */
function drawWzDoronExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const seed = seedOf(options);
	const tH = 0.2;
	const grow = outExpo(p / 0.3);
	const dis = clamp((p - 0.3) / 0.7);
	const col = ownColor(options);
	const smoke = mix(options.frame.palette.background, col, 0.2);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (p >= tH) return null;
			return centeredTransform({
				bounds: waBounds(options, 0),
				glyph,
				scale: 1 - 0.08 * inQuad(p / tH),
			});
		},
	});
	const a = 1 - sstep(0.4, 1, dis);
	if (a <= 0.01) return;
	const b = waBounds(options, 0);
	const tall = b.bottom - b.top > b.right - b.left;
	const len = Math.max(b.right - b.left, b.bottom - b.top);
	const th = Math.min(b.right - b.left, b.bottom - b.top);
	const n = Math.round(clampRange(len / (size * 0.7) + 2, 4, 14));
	const lw = Math.max(1.5, size * 0.022);
	const puffs: (readonly [number, number, number])[] = [];
	const R0 = Math.max(size * 0.62, th * 0.62);
	for (let k = 0; k < n; k += 1) {
		const r =
			R0 *
			(0.8 + 0.45 * ru(seed, k, 81)) *
			grow *
			(1 - inCubic(dis));
		if (r < 0.5) continue;
		const al =
			-size * 0.15 +
			((k + 0.5) / n) * (len + size * 0.3) +
			(ru(seed, k, 82) * 2 - 1) * size * (0.15 + 0.5 * dis);
		const cr = (ru(seed, k, 83) * 2 - 1) * th * 0.2;
		const up = size * 0.7 * dis * (0.4 + ru(seed, k, 84));
		puffs.push(
			tall
				? [b.centerX + cr, b.top + al - up, r]
				: [b.left + al, b.centerY + cr - up, r],
		);
	}
	for (const [px, py, r] of puffs) {
		waStroke(ctx, ellipsePoints(px, py, r + lw, r + lw, 0, 0, 360, 20), col, lw, a);
	}
	for (const [px, py, r] of puffs) {
		waDisc(ctx, px, py, r, smoke, a);
	}
	for (const [px, py, r] of puffs) {
		waStroke(
			ctx,
			ellipsePoints(px - r * 0.1, py + r * 0.05, r * 0.55, r * 0.55, 0, 200, 320, 12),
			col,
			lw * 0.7,
			a * 0.6,
		);
	}
}

/** 灯籠流し — the glyphs are set afloat one by one: they glow, bob on short ripples and drift off downstream, growing small. */
function drawWzToroExit(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const p = options.frame.exitProgress;
	const dir = enterBDirection(options, 91);
	const own = ownColor(options);
	const warm = hotColor(options);
	const W = options.maxWidth / 0.86;
	const glyphs = enterBGlyphs(options);
	const n = Math.max(1, glyphs.length);
	 
	const qf = (i: number) =>
		x2Stagger(p, dir > 0 ? 1 - i / (n - 1) : i / (n - 1), 0.4);
	// eslint-disable-next-line opencut/prefer-object-params -- Drift values mirror the source mv(q, i) helper.
	const drift = (q: number, i: number) => ({
		dx: dir * (size * 0.8 + W * 0.12) * q ** 1.5,
		dy:
			-size * 0.35 * q +
			Math.sin(q * 9 + i) * size * 0.045 * Math.min(1, q * 4),
		scale: 1 - 0.5 * q,
	});
	const lc = quietColor(options);
	const lw = Math.max(1.5, size * 0.018);
	for (const glyph of glyphs) {
		const q = qf(glyph.index);
		if (q <= 0 || q >= 1) continue;
		const M = drift(q, glyph.index);
		const a = clamp(q * 5) * (1 - sstep(0.5, 1, q)) * 0.8;
		if (a <= 0.01) continue;
		const cx = glyph.x + M.dx;
		const y = glyph.y + M.dy + glyph.height * M.scale * 0.6;
		const w = glyph.width * (0.5 + 0.7 * q);
		waLine(ctx, cx - w / 2, y, cx + w / 2, y, lc, lw, a);
		waLine(
			ctx,
			cx - w * 0.3 - dir * size * 0.1,
			y + size * 0.08,
			cx + w * 0.3 - dir * size * 0.1,
			y + size * 0.08,
			lc,
			lw,
			a * 0.6,
		);
	}
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const q = qf(glyph.index);
			if (q <= 0) return undefined;
			if (q >= 1) return null;
			const M = drift(q, glyph.index);
			return {
				alpha: 1 - sstep(0.45, 1, q),
				color: mix(own, warm, 0.7 * Math.sin(q * PI)),
				scaleX: M.scale,
				scaleY: M.scale,
				translateX: M.dx,
				translateY: M.dy,
			};
		},
	});
}

/* =====================================================================
   HOLD
   ===================================================================== */

export function drawX2WaHold(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "wzFurin":
			drawWzFurinHold(options);
			return true;
		case "wzMikoshi":
			drawWzMikoshiHold(options);
			return true;
		case "wzNotan":
			drawWzNotanHold(options);
			return true;
		case "wzShishiodoshi":
			drawWzShishiodoshiHold(options);
			return true;
		case "wzTanzaku":
			drawWzTanzakuHold(options);
			return true;
		default:
			return false;
	}
}

/** 風鈴 — now and then a breeze passes along the line: each glyph swings from a point above it and rings down at its own pace. */
function drawWzFurinHold(options: EnterBDraw): void {
	const t = secondsOf(options.frame);
	const seed = seedOf(options);
	const T = 2.3;
	const cphase = ((seed | 0) % 97) / 97;
	const ph = (0.75 + 0.2 * cphase) * T;
	const L = options.size * 0.85;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const tt = frac((t + ph - glyph.index * 0.08) / T) * T;
			const w = 7.5 + 3 * ru(seed, glyph.index, 301);
			const th =
				10 *
				Math.exp(-1.2 * tt) *
				Math.sin(tt * w) *
				Math.min(1, tt * 8) *
				(1 - sstep(0.8, 1, tt / T)) *
				(0.7 + 0.6 * ru(seed, glyph.index, 302));
			return {
				rotation: degrees(th),
				translateX: -L * Math.sin(degrees(th)),
				translateY: L * (Math.cos(degrees(th)) - 1),
			};
		},
	});
}

/** 鹿威し — the line slowly tips as if filling with water, drops back with a knock, rocks once and starts again. */
function drawWzShishiodoshiHold(options: EnterBDraw): void {
	const t = secondsOf(options.frame);
	const seed = seedOf(options);
	const T = 3.4;
	const u = frac(t / T + ((seed | 0) % 97) / 97);
	const dir = enterBDirection(options, 311);
	let a: number;
	if (u < 0.7) {
		a = inQuad(u / 0.7);
	} else if (u < 0.76) {
		a = lerpN(1, -0.45, inCubic((u - 0.7) / 0.06));
	} else {
		const v = (u - 0.76) / 0.24;
		a = -0.45 * Math.exp(-5 * v) * Math.cos(v * TAU * 1.5) * (1 - v);
	}
	const b = waBounds(options, 0);
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			centeredTransform({
				bounds: b,
				glyph,
				rotation: degrees(dir * 2.4 * a),
			}),
	});
}

/** 神輿 — わっしょい: two quick shoulder bounces and a rest, leaning left then right. */
function drawWzMikoshiHold(options: EnterBDraw): void {
	const t = secondsOf(options.frame);
	const seed = seedOf(options);
	const u = frac(t / 1.1 + ((seed | 0) % 97) / 97);
	const h1 = u < 0.3 ? Math.sin((PI * u) / 0.3) : 0;
	const h2 = u > 0.34 && u < 0.64 ? Math.sin((PI * (u - 0.34)) / 0.3) : 0;
	const size = options.size;
	const b = waBounds(options, 0);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const transform = centeredTransform({
				bounds: b,
				glyph,
				rotation: degrees(1.3 * (h1 - h2)),
			});
			return {
				...transform,
				translateY:
					(transform.translateY ?? 0) - size * 0.08 * (h1 + h2 * 0.8),
			};
		},
	});
}

/** 短冊 — paper strips turning in a light breeze: a slow twist travels along the line, each glyph narrowing and opening again. */
function drawWzTanzakuHold(options: EnterBDraw): void {
	const t = secondsOf(options.frame);
	const seed = seedOf(options);
	const ph = (((seed | 0) % 97) / 97) * TAU;
	const size = options.size;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const f = t * 1.9 - glyph.index * 0.6 + ph;
			const tw = Math.max(0, Math.sin(f)) ** 2;
			return {
				rotation: degrees(2.2 * Math.sin(f + 0.9)),
				scaleX: 1 - 0.34 * tw,
				translateY: -size * 0.015 * tw,
			};
		},
	});
}

/** 墨の濃淡 — a slow wave of ink density: glyph after glyph pales to a thin wash and comes back to full black. */
function drawWzNotanHold(options: EnterBDraw): void {
	const t = secondsOf(options.frame);
	const seed = seedOf(options);
	const ph = (((seed | 0) % 97) / 97) * TAU;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const w = 0.5 + 0.5 * Math.sin(t * 1.3 - glyph.index * 0.7 + ph);
			const d = w * w;
			return {
				alpha: 1 - 0.45 * d,
				scaleX: 1 - 0.02 * d,
				scaleY: 1 - 0.02 * d,
			};
		},
	});
}

/* =====================================================================
   TREAT
   ===================================================================== */

export function drawX2WaTreat(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.treat) {
		case "wzBinsen":
			drawWzBinsenTreat(options);
			return true;
		case "wzKasure":
			drawWzKasureTreat(options);
			return true;
		case "wzKinpaku":
			drawWzKinpakuTreat(options);
			return true;
		case "wzObi":
			drawWzObiTreat(options);
			return true;
		case "wzRakkan":
			drawWzRakkanTreat(options);
			return true;
		default:
			return false;
	}
}

/** 落款 — a small vermilion seal set beside the end of the line, as on a finished piece of calligraphy. */
function drawWzRakkanTreat(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const seed = seedOf(options);
	const t = secondsOf(options.frame);
	const v = Math.floor(ru(seed, 301) * 3);
	const rot = (ru(seed, 302) - 0.5) * 10;
	const k = 0.36 + ru(seed, 303) * 0.08;
	const s = size * k;
	const seal = sealColor(options);
	const knock = options.frame.palette.background;
	const b = waBounds(options, 0);
	const exitFade = 1 - inCubic(options.frame.exitProgress);
	const q = clamp((t - 0.225) / 0.26);
	const pop = lerpN(1.45, 1, oCubic(q));
	const a = clamp(q * 3) * exitFade;
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			centeredTransform({ bounds: b, glyph, scale: 0.94 }),
	});
	if (a <= 0.01) return;
	const cx = b.right + s * 0.72;
	const cy = b.bottom - s * 0.5;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(rot * degrees(1));
	ctx.scale(pop, pop);
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * a;
	ctx.fillStyle = seal;
	ctx.fillRect(-s / 2, -s / 2, s, s);
	const i = s * 0.3;
	const lw = s * 0.085;
	// eslint-disable-next-line opencut/prefer-object-params -- Knock mark rects mirror the source R(x0, y0, w, h) helper.
	const mark = (x0: number, y0: number, w: number, h: number) => {
		ctx.fillRect(x0, y0, w, h);
	};
	ctx.fillStyle = knock;
	if (v === 1) {
		for (const y of [-i, 0, i]) mark(-i, y - lw / 2, i * 2, lw);
		mark(-lw / 2, -i, lw, i * 2);
	} else {
		mark(-i, -i, i * 2, lw);
		mark(-i, i - lw, i * 2, lw);
		mark(-i, -i, lw, i * 2);
		mark(i - lw, -i, lw, i * 2);
		if (v === 0) {
			mark(-i, -lw / 2, i * 2, lw);
			mark(-lw / 2, -i, lw, i * 2);
		} else {
			mark(-i * 0.42, -i * 0.42, i * 0.84, i * 0.84);
		}
	}
	ctx.restore();
}

/** 金箔 — flecks of gold leaf scattered through the body of the glyphs. */
function drawWzKinpakuTreat(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const seed = seedOf(options);
	const col = ownColor(options);
	const gold = hotColor(options);
	const gold2 = mix(gold, col, 0.45);
	const d = ru(seed, 311);
	const glyphs = enterBGlyphs(options);
	drawX2Glyphs({
		options,
		resolve: () => undefined,
	});
	const baseAlpha = ctx.globalAlpha;
	for (const glyph of glyphs) {
		const count = Math.round(10 + 9 * d);
		ctx.save();
		ctx.beginPath();
		ctx.rect(
			glyph.x - glyph.width / 2,
			glyph.y - glyph.height / 2,
			glyph.width,
			glyph.height,
		);
		ctx.clip();
		for (let k = 0; k < count; k += 1) {
			const fx = glyph.x + (ru(seed, glyph.index, k, 401) * 2 - 1) * glyph.width * 0.42;
			const fy = glyph.y + (ru(seed, glyph.index, k, 402) * 2 - 1) * glyph.height * 0.42;
			const R = (size * 0.02) * (0.5 + ru(seed, glyph.index, k, 403));
			const a0 = ru(seed, glyph.index, k, 404) * TAU;
			const color = ru(seed, glyph.index, k, 405) < 0.7 ? gold : gold2;
			const pts: (readonly [number, number])[] = [];
			for (let q = 0; q < 4; q += 1) {
				const an = a0 + (q * TAU) / 4;
				const rr = R * (0.55 + 0.6 * ru(seed, glyph.index, q, 406 + k * 4));
				pts.push([fx + Math.cos(an) * rr, fy + Math.sin(an) * rr]);
			}
			waPoly(ctx, pts, color, 0.5);
		}
		ctx.restore();
	}
	ctx.globalAlpha = baseAlpha;
}

/** 墨のかすれ — a dry brush: thin streaks along the stroke direction where the bristles ran out of ink. */
function drawWzKasureTreat(options: EnterBDraw): void {
	const { ctx } = options;
	const seed = seedOf(options);
	const bg = options.frame.palette.background;
	const d = ru(seed, 321);
	const glyphs = enterBGlyphs(options);
	drawX2Glyphs({
		options,
		resolve: () => undefined,
	});
	for (const glyph of glyphs) {
		const count = Math.round(8 + 8 * d);
		for (let k = 0; k < count; k += 1) {
			const band = ((k % 4) + ru(seed, glyph.index, k, 411)) * 0.25;
			const y = glyph.y + (band - 0.5 + (ru(seed, glyph.index, k, 412) * 2 - 1) * 0.06) * glyph.height;
			const h = Math.max(
				1,
				options.size * 0.03 * (0.4 + ru(seed, glyph.index, k, 413) ** 2),
			);
			const x = glyph.x - glyph.width / 2 + ru(seed, glyph.index, k, 414) * glyph.width * 0.7;
			const len = glyph.width * (0.3 + 0.5 * ru(seed, glyph.index, k, 415));
			waPoly(
				ctx,
				[
					[x, y],
					[x + len * 0.5, y - h / 2],
					[x + len, y],
					[x + len * 0.5, y + h / 2],
				],
				bg,
				0.75,
			);
		}
	}
}

/** 和柄の帯 — a narrow band of a traditional repeat (市松 / 鱗 / 青海波 / 菱) laid along the foot of the line. */
function drawWzObiTreat(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const seed = seedOf(options);
	const t = secondsOf(options.frame);
	const v = Math.floor(ru(seed, 331) * 4);
	const hb = size * (0.2 + ru(seed, 332) * 0.06);
	const mc = sealColor(options);
	const exitFade = 1 - inCubic(options.frame.exitProgress);
	const q = oCubic(clamp((t - 0.05) / 0.5));
	const b = waBounds(options, 0);
	const U0 = b.left - size * 0.08;
	const L = b.right - b.left + size * 0.16;
	const V0 = b.bottom + size * 0.14;
	drawX2Glyphs({
		options,
		resolve: () => ({ translateY: -size * 0.14 }),
	});
	if (q <= 0.005 || exitFade <= 0.01) return;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * exitFade;
	ctx.save();
	ctx.beginPath();
	ctx.rect(U0, V0 - 2, L * q, hb + 4);
	ctx.clip();
	ctx.fillStyle = mc;
	if (v === 0) {
		const c = hb / 2;
		const cells = Math.min(600, Math.ceil(L / c));
		for (let index = 0; index < cells; index += 1) {
			ctx.fillRect(U0 + index * c, V0 + (index % 2 ? c : 0), c + 0.4, c);
		}
	} else if (v === 1) {
		const cells = Math.min(400, Math.ceil(L / hb));
		for (let index = 0; index < cells; index += 1) {
			waPoly(
				ctx,
				[
					[U0 + index * hb, V0 + hb],
					[U0 + (index + 0.5) * hb, V0],
					[U0 + (index + 1) * hb, V0 + hb],
				],
				mc,
				1,
			);
		}
	} else if (v === 2) {
		const lw = Math.max(1, hb * 0.1);
		const cells = Math.min(300, Math.ceil(L / (hb * 2)) + 1);
		for (let index = 0; index < cells; index += 1) {
			for (const rr of [1, 0.66, 0.33]) {
				waStroke(
					ctx,
					ellipsePoints(U0 + (index + 0.5) * hb * 2, V0 + hb, hb * rr, hb * rr, 0, 180, 360, 12),
					mc,
					lw,
					1,
				);
			}
		}
	} else {
		const w = hb * 1.3;
		const cells = Math.min(400, Math.ceil(L / w));
		ctx.fillRect(U0, V0, L, hb * 0.1);
		ctx.fillRect(U0, V0 + hb * 0.9, L, hb * 0.1);
		for (let index = 0; index < cells; index += 1) {
			const cx = U0 + (index + 0.5) * w;
			const cy = V0 + hb / 2;
			waPoly(
				ctx,
				[
					[cx - w * 0.38, cy],
					[cx, cy - hb * 0.27],
					[cx + w * 0.38, cy],
					[cx, cy + hb * 0.27],
				],
				mc,
				1,
			);
		}
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

/** 便箋 — letter paper: a ruled line for every line of text, one more left empty, and a coloured head rule. */
function drawWzBinsenTreat(options: EnterBDraw): void {
	const { ctx } = options;
	const size = options.size;
	const seed = seedOf(options);
	const t = secondsOf(options.frame);
	const rule = quietColor(options);
	const head = sealColor(options);
	const extra = ru(seed, 341) < 0.5 ? 2 : 1;
	const lead = size * 1.3;
	const exitFade = 1 - inCubic(options.frame.exitProgress);
	const b = waBounds(options, 0);
	const U0 = b.left - size * 0.3;
	const U1 = b.right + size * 0.3;
	const lw = Math.max(1.5, size * 0.014);
	drawX2Glyphs({
		options,
		resolve: () => ({ translateY: -lead * 0.25 }),
	});
	if (exitFade <= 0.01) return;
	const vs = [b.bottom + lead / 2];
	for (let j = 1; j < extra; j += 1) {
		vs.push(b.bottom + lead / 2 + lead * j);
	}
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * exitFade;
	vs.forEach((v, j) => {
		const q = oCubic(clamp((t - 0.04 * (j + 1)) / 0.45));
		waRect(ctx, U0, v - lw / 2, Math.max(0, lerpN(U0, U1, q) - U0), lw, rule, 0.75);
	});
	const hv = b.top - lead / 2;
	const qh = oCubic(clamp(t / 0.45));
	waRect(ctx, U0, hv - lw, Math.max(0, lerpN(U0, U1, qh) - U0), lw * 2, head, 1);
	if (extra > 1) {
		waRect(
			ctx,
			U0,
			hv - lw * 4.5,
			Math.max(0, lerpN(U0, U1, qh) - U0),
			lw,
			head,
			0.8,
		);
	}
	ctx.globalAlpha = baseAlpha;
}

/* =====================================================================
   CAMERA
   ===================================================================== */

interface X2WaCamInput {
	readonly cut: MotionTextResolvedCut;
	readonly localTime: number;
}

/**
 * 和風 camera moves, following the bgcam-cameras resolver contract: the
 * returned transform is applied by the runtime camera chain, `null` means the
 * preset was not handled (and is falsy for boolean dispatch wiring).
 */
export function drawX2WaCam(
	input: X2WaCamInput,
): KineticCameraTransform | null {
	switch (input.cut.preset.cam) {
		case "wzByobuPan":
			return byobuPan(input);
		case "wzKakejikuView":
			return kakejikuView(input);
		case "wzOjigi":
			return ojigi(input);
		default:
			return null;
	}
}

/** fx.motion default 0.7 scaled like the source KM() helper. */
const CAM_K = 0.875;

function inOutSine(value: number): number {
	return -(Math.cos(PI * clamp(value)) - 1) / 2;
}

/** 掛け軸を眺める — starts close on the upper part, lets the eye travel down the scroll while stepping back to the whole picture. */
function kakejikuView({ cut, localTime }: X2WaCamInput): KineticCameraTransform {
	const seconds = localTime / TICKS;
	const a = 0.06 + ru(cut.seed, 3501) * 0.025;
	const y = 0.026 + ru(cut.seed, 3502) * 0.01;
	const e = inOutSine(seconds / Math.max(0.6, (cut.duration / TICKS) * 0.72));
	return {
		scale: 1 + a * CAM_K * (1 - e),
		translateY: y * CAM_K * Math.cos(e * PI) * (1 - e),
	};
}

/** 屏風 — the view walks past a folding screen: it pans in three or four steps, and each panel faces a slightly different way. */
function byobuPan({ cut, localTime }: X2WaCamInput): KineticCameraTransform {
	const seconds = localTime / TICKS;
	const dir = ru(cut.seed, 3511) < 0.5 ? -1 : 1;
	const n = ru(cut.seed, 3512) < 0.67 ? 3 : 4;
	const a = 0.024 + ru(cut.seed, 3513) * 0.008;
	const u = clamp(seconds / Math.max(0.5, cut.duration / TICKS)) * n;
	const i = Math.min(n - 1, Math.floor(u));
	const f = ioCubic(clamp((u - i) / 0.55));
	const pos = ((i + f) / n) * 2 - 1;
	const faceAt = (j: number) => (j < 0 || j >= n - 1 ? 0 : j % 2 ? 1 : -1);
	const face = lerpN(faceAt(i - 1), faceAt(i), f);
	return {
		scale: 1.03,
		scaleX: 1 - 0.014 * CAM_K * bell(f),
		skewX: degrees(face * 1.1 * CAM_K),
		translateX: dir * pos * a * CAM_K,
	};
}

/** お辞儀 — the frame makes a small bow at the top of the cut: it dips and shortens, holds for a breath and straightens up. */
function ojigi({ cut, localTime }: X2WaCamInput): KineticCameraTransform {
	const seconds = localTime / TICKS;
	const a = 0.026 + ru(cut.seed, 3521) * 0.01;
	const h = 0.16 + ru(cut.seed, 3522) * 0.1;
	const T = clampRange((cut.duration / TICKS) * 0.6, 0.5, 1.25);
	const u = seconds / T;
	const b = ioCubic(u / 0.3) * (1 - ioCubic((u - 0.3 - h) / (0.7 - h)));
	return {
		scale: 1 + 0.008 * CAM_K * b,
		scaleY: 1 - 0.04 * CAM_K * b,
		translateY: a * CAM_K * b,
	};
}

/* =====================================================================
   FX (device pixels)
   ===================================================================== */

interface X2WaFxDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly effect: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

export function drawX2WaFx(options: X2WaFxDraw): boolean {
	switch (options.effect) {
		case "wzHanafubuki":
			drawWzHanafubukiFx(options);
			return true;
		case "wzHyoshigi":
			drawWzHyoshigiFx(options);
			return true;
		case "wzMaku":
			drawWzMakuFx(options);
			return true;
		case "wzOrime":
			drawWzOrimeFx(options);
			return true;
		case "wzShojiPass":
			drawWzShojiPassFx(options);
			return true;
		case "wzSumiShibuki":
			drawWzSumiShibukiFx(options);
			return true;
		default:
			return false;
	}
}

function fxState(options: X2WaFxDraw): {
	readonly ch: number;
	readonly cw: number;
	readonly ink: string;
	readonly k: number;
	readonly mn: number;
	readonly pop: string;
	readonly seed: number;
} {
	const cut = options.frame.cut;
	const duration = Math.max(1, cut?.duration ?? TICKS);
	return {
		ch: options.height,
		cw: options.width,
		ink: options.frame.palette.foreground,
		k: clamp(options.frame.localTime / duration),
		mn: Math.min(options.width, options.height),
		pop: options.frame.palette.accent,
		seed: cut?.seed ?? 0,
	};
}

// eslint-disable-next-line opencut/prefer-object-params -- Attack/decay window mirrors the source ahr(k, a, b).
function ahr(k: number, a: number, b: number): number {
	if (k < a) return oCubic(k / a);
	if (k > b) return 1 - inCubic((k - b) / Math.max(1e-3, 1 - b));
	return 1;
}

/** 拍子木 — two wooden clappers fly in and strike: a sharp crack of rays at the meeting point, and they spring apart. */
function drawWzHyoshigiFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, ink, k, mn, pop, seed } = fxState(options);
	const tS = 0.3;
	const L = mn * 0.5;
	const th = mn * 0.065;
	const cx = cw / 2 + (ru(seed, 1) * 2 - 1) * cw * 0.14;
	const cy = ch / 2 + (ru(seed, 2) * 2 - 1) * ch * 0.1;
	const tilt = (ru(seed, 3) < 0.5 ? 1 : -1) * (10 + 14 * ru(seed, 4)) * degrees(1);
	const u = clamp((k - tS) / (1 - tS));
	const d = k < tS ? lerpN(mn * 0.8, th / 2, inCubic(k / tS)) : th / 2 + mn * 0.1 * oCubic(u);
	const al = k < tS ? clamp((k / tS) * 4) : 1 - inQuad(u);
	if (k >= tS) {
		const f = (1 - oCubic(u / 0.5)) * 1;
		if (f > 0.01) {
			const baseAlpha = ctx.globalAlpha;
			ctx.globalAlpha = baseAlpha * 0.2 * f;
			ctx.fillStyle = pop;
			ctx.fillRect(0, 0, cw, ch);
			ctx.globalAlpha = baseAlpha;
		}
	}
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(tilt);
	for (const sd of [-1, 1]) {
		waRect(ctx, sd * d - th / 2, -L / 2, th, L, ink, al);
		waRect(ctx, sd * d - th / 2, -L / 2 + L * 0.1, th, L * 0.045, pop, al);
	}
	ctx.restore();
	if (k >= tS) {
		const f = 1 - sstep(0.1, 0.75, u);
		if (f <= 0.01) return;
		for (let index = 0; index < 12; index += 1) {
			const an = (index / 12) * TAU + 0.26;
			const c = Math.cos(an);
			const sn = Math.sin(an);
			const r0 = mn * (0.09 + 0.26 * outExpo(u)) * (index % 2 ? 0.8 : 1);
			const len = mn * 0.11 * (1 - u);
			waLine(
				ctx,
				cx + c * r0,
				cy + sn * r0 * 1.6,
				cx + c * (r0 + len),
				cy + sn * (r0 + len) * 1.6,
				pop,
				Math.max(2, mn * 0.009),
				f,
			);
		}
	}
}

/** 障子の影 — the shadow of a shoji lattice slides slantwise across the picture, as if a lamp were carried past outside. */
function drawWzShojiPassFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, k, mn, seed } = fxState(options);
	const fg = options.frame.palette.foreground;
	const dir = ru(seed, 1) < 0.5 ? 1 : -1;
	const a = 0.3 * ahr(k, 0.25, 0.7) * 1;
	if (a < 0.01) return;
	const cu = mn * 0.21;
	const cv = mn * 0.15;
	const lw = Math.max(2, mn * 0.012);
	const sk = 0.32 * dir;
	const sh = dir * lerpN(-cw * 0.14, cw * 0.14, k);
	ctx.save();
	ctx.transform(1, 0, sk, 1, (-sk * ch) / 2 + sh, 0);
	for (const [w, al] of [
		[2.6, 0.35],
		[1, 1],
	] as const) {
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * a * al;
		ctx.fillStyle = fg;
		for (let x = -cw * 0.5, i = 0; x < cw * 1.5 && i < 80; x += cu, i += 1) {
			const t = (i % 3 === 0 ? 2.2 : 1) * lw * w;
			ctx.fillRect(x - t / 2, -10, t, ch + 20);
		}
		for (let y = cv * 0.5, i = 0; y < ch && i < 60; y += cv, i += 1) {
			ctx.fillRect(-cw, y - (lw * w) / 2, cw * 3, lw * w);
		}
		ctx.globalAlpha = baseAlpha;
	}
	ctx.restore();
}

/** 墨しぶき — a loaded brush is flicked at the screen: a blot lands near one edge and throws a fan of drops across it. */
function drawWzSumiShibukiFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, k, mn, seed } = fxState(options);
	const ink = options.frame.palette.foreground;
	const g = outExpo(k / 0.3);
	const al = 1 - inQuad(clamp((k - 0.42) / 0.58));
	if (al <= 0.01) return;
	const left = ru(seed, 1) < 0.5;
	const ox = cw * (left ? 0.1 + 0.1 * ru(seed, 2) : 0.9 - 0.1 * ru(seed, 2));
	const oy = ch * (0.2 + 0.6 * ru(seed, 3));
	const base = Math.atan2(ch / 2 - oy, cw / 2 - ox);
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * al;
	ctx.fillStyle = ink;
	for (let index = 0; index < 7; index += 1) {
		const an = ru(seed, index, 4) * TAU;
		const d = mn * 0.035 * ru(seed, index, 5) * g;
		const r = mn * (0.03 + 0.035 * ru(seed, index, 6)) * g;
		waDisc(ctx, ox + Math.cos(an) * d, oy + Math.sin(an) * d, r, ink, al);
	}
	for (let index = 0; index < 34; index += 1) {
		const r1 = ru(seed, index, 7);
		const an = base + (ru(seed, index, 8) * 2 - 1) * 0.95;
		const d = mn * (0.09 + 0.85 * r1 * r1) * g;
		const r = mn * 0.02 * (1 - r1 * 0.8) * (0.4 + 0.6 * ru(seed, index, 9));
		const rx = r * (1.4 + 2.2 * r1);
		waPoly(
			ctx,
			ellipsePoints(ox + Math.cos(an) * d, oy + Math.sin(an) * d, rx, r, an, 0, 360, 10),
			ink,
			al,
		);
	}
}

/** 紙の折り目 — for a moment the picture is a sheet folded in thirds and across: panels shade alternately and the creases catch the light. */
function drawWzOrimeFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, k, mn } = fxState(options);
	const e = ahr(k, 0.14, 0.55) * 1;
	if (e < 0.01) return;
	const fg = options.frame.palette.foreground;
	const bg = options.frame.palette.background;
	const nx = cw >= ch ? 3 : 2;
	const ny = cw >= ch ? 2 : 3;
	const wB = mn * 0.2;
	const lw = Math.max(1, mn * 0.003);
	const baseAlpha = ctx.globalAlpha;
	for (let i = 0; i < nx; i += 1) {
		for (let j = 0; j < ny; j += 1) {
			if ((i + j) % 2) {
				ctx.globalAlpha = baseAlpha * 0.09 * e;
				ctx.fillStyle = fg;
				ctx.fillRect((cw * i) / nx, (ch * j) / ny, cw / nx, ch / ny);
			}
		}
	}
	ctx.globalAlpha = baseAlpha;
	// eslint-disable-next-line opencut/prefer-object-params -- Crease mirrors the source crease(vert, pos, flip) helper.
	const crease = (vert: boolean, pos: number, flip: number) => {
		for (const sd of [-1, 1]) {
			const c = sd * flip > 0 ? fg : bg;
			const a = (sd * flip > 0 ? 0.3 : 0.2) * e;
			const band = wB / 3;
			for (let step = 0; step < 3; step += 1) {
				const a0 = a * (1 - step * 0.32);
				if (vert) {
					waRect(
						ctx,
						sd > 0 ? pos + band * step : pos - band * (step + 1),
						0,
						band,
						ch,
						c,
						a0,
					);
				} else {
					waRect(
						ctx,
						0,
						sd > 0 ? pos + band * step : pos - band * (step + 1),
						cw,
						band,
						c,
						a0,
					);
				}
			}
		}
		waRect(ctx, vert ? pos - lw / 2 : 0, vert ? 0 : pos - lw / 2, vert ? lw : cw, vert ? ch : lw, fg, 0.45 * e);
	};
	for (let i = 1; i < nx; i += 1) crease(true, (cw * i) / nx, i % 2 ? 1 : -1);
	for (let j = 1; j < ny; j += 1) crease(false, (ch * j) / ny, j % 2 ? -1 : 1);
}

/** 花吹雪 — one gust carries a flurry of petals slantwise across the whole picture. */
function drawWzHanafubukiFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, k, mn, seed } = fxState(options);
	const dir = ru(seed, 1) < 0.5 ? 1 : -1;
	const N = Math.round(34 + 16 * 1);
	const pop = options.frame.palette.accent;
	const c1 = pop;
	const c2 = ru(seed, 11) < 0.5 ? options.frame.palette.secondary : c1;
	const c3 = mix(c1, "#ffffff", 0.45);
	const cols = [c1, c2, c3];
	for (let index = 0; index < N; index += 1) {
		const kk = clamp(k * 1.4 - 0.4 * ru(seed, index, 2));
		if (kk <= 0 || kk >= 1) continue;
		const a = sstep(0, 0.1, kk) * (1 - sstep(0.85, 1, kk)) * 0.92;
		const ph = ru(seed, index, 3) * TAU;
		const y0 = ch * (-0.25 + 1.05 * ru(seed, index, 4));
		const x = (dir > 0 ? -0.08 : 1.08) * cw + dir * cw * 1.16 * kk;
		const y = y0 + ch * 0.36 * kk + Math.sin(kk * 9 + ph) * mn * 0.035;
		const sp = mn * (0.016 + 0.022 * ru(seed, index, 5));
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(ph + kk * 8 * (index % 2 ? 1 : -1));
		ctx.scale(0.3 + 0.7 * Math.abs(Math.cos(kk * 12 + ph)), 1);
		waPoly(
			ctx,
			petalPoints(sp),
			cols[index % 3]!,
			a,
		);
		ctx.restore();
	}
}

/** 花吹雪 petal outline, sampled from the source quadratic-curve path. */
function petalPoints(sp: number): (readonly [number, number])[] {
	const q1: (readonly [number, number])[] = [];
	for (let index = 0; index <= 10; index += 1) {
		const t = index / 10;
		const u = 1 - t;
		q1.push([
			u * u * 0 + 2 * u * t * (sp * 0.95) + t * t * (sp * 0.22),
			u * u * -sp + 2 * u * t * (-sp * 0.1) + t * t * sp,
		]);
	}
	const q2: (readonly [number, number])[] = [];
	for (let index = 0; index <= 10; index += 1) {
		const t = index / 10;
		const u = 1 - t;
		q2.push([
			u * u * (-sp * 0.22) + 2 * u * t * (-sp * 0.95) + t * t * 0,
			u * u * sp + 2 * u * t * (-sp * 0.1) + t * t * -sp,
		]);
	}
	return [
		[0, -sp],
		...q1,
		[0, sp * 0.72],
		[-sp * 0.22, sp],
		...q2,
	];
}

/** 定式幕 — the striped stage curtain is run across the picture and straight off again (closed exactly at the cut). */
function drawWzMakuFx(options: X2WaFxDraw): void {
	const { ctx } = options;
	const { ch, cw, k, seed } = fxState(options);
	const dir = ru(seed, 1) < 0.5 ? 1 : -1;
	const sw = Math.max(8, cw / 13);
	const c1 = options.frame.palette.foreground;
	const c2 = options.frame.palette.accent;
	const c3 =
		ru(seed, 2) < 0.5
			? options.frame.palette.secondary
			: mix(c1, c2, 0.5);
	const cols = [c1, c2, c3];
	// the curtain only runs closed across the cut: k is folded into its
	// first half so the picture is covered exactly at the cut boundary
	const kk = clamp(k) * 0.5;
	const x1 = kk < 0.5 ? cw * ioCubic(kk / 0.5) : cw;
	const x0 = 0;
	if (x1 - x0 < 0.5) return;
	ctx.save();
	if (dir < 0) {
		ctx.translate(cw, 0);
		ctx.scale(-1, 1);
	}
	ctx.beginPath();
	ctx.rect(x0, 0, x1 - x0, ch);
	ctx.clip();
	const an = x1;
	for (let index = 0, x = an - sw; x > x0 - sw && index < 40; index += 1, x -= sw) {
		ctx.fillStyle = cols[index % 3]!;
		ctx.fillRect(x, 0, sw + 0.6, ch);
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * 0.16;
		ctx.fillStyle = "#000000";
		ctx.fillRect(x, 0, sw * 0.14, ch);
		ctx.globalAlpha = baseAlpha;
	}
	ctx.fillStyle = c1;
	ctx.fillRect(x0, 0, x1 - x0, Math.max(3, ch * 0.03));
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * 0.3;
	ctx.fillStyle = "#000000";
	ctx.fillRect(x1 - sw * 0.2, 0, sw * 0.2, ch);
	ctx.globalAlpha = baseAlpha;
	ctx.restore();
}

/* =====================================================================
   TRANS (device pixels; p = 0 is exactly A, p = 1 exactly B)
   ===================================================================== */

export function drawX2WaTrans(options: TreatTransTransitionDraw): boolean {
	if (transitionBoundary(options)) return true;
	switch (options.frame.cut?.preset.trans) {
		case "wzFusumaPass":
			drawWzFusumaPassTrans(options);
			return true;
		case "wzMakimonoRoll":
			drawWzMakimonoRollTrans(options);
			return true;
		case "wzMawariButai":
			drawWzMawariButaiTrans(options);
			return true;
		default:
			return false;
	}
}

/** 襖渡し — two sliding doors close over the old cut, meet, and open again on the new one. */
function drawWzFusumaPassTrans(options: TreatTransTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height, width } = options;
	const p = clamp(frame.enterProgress);
	const seed = frame.cut?.seed ?? 0;
	const mn = Math.min(width, height);
	const c =
		p < 0.44
			? ioCubic(p / 0.44)
			: p < 0.56
				? 1
				: 1 - ioCubic((p - 0.56) / 0.44);
	if (p < 0.5) drawPrevious();
	else drawCurrent();
	if (c <= 0.001) return;
	const paper = paperColor(options);
	const inkColor = frame.palette.foreground;
	const acc = frame.palette.accent;
	const lw = Math.max(2, mn * 0.012);
	const pw = width / 2;
	const half = pw * c;
	const mist = ru(seed, 3601) < 0.6;
	const middleStile = ru(seed, 3602) < 0.5 ? 1 : 2;
	for (const sd of [-1, 1]) {
		const x0 = sd < 0 ? half - pw : width - half;
		waRect(ctx, x0, 0, pw, height, paper, 1);
		if (mist) {
			for (const [fy, f0, f1] of [
				[0.24, 0.1, 0.7],
				[0.3, 0.35, 0.95],
				[0.72, 0.05, 0.55],
			] as const) {
				const y = height * fy;
				const h = height * 0.035;
				const xa = x0 + pw * (sd < 0 ? f0 : 1 - f1);
				const w = pw * (f1 - f0);
				const baseAlpha = ctx.globalAlpha;
				ctx.globalAlpha = baseAlpha * 0.16;
				ctx.fillStyle = acc;
				ctx.fillRect(xa + h / 2, y, Math.max(0, w - h), h);
				waDisc(ctx, xa + h / 2, y + h / 2, h / 2, acc, 0.16);
				waDisc(ctx, xa + w - h / 2, y + h / 2, h / 2, acc, 0.16);
				ctx.globalAlpha = baseAlpha;
			}
		}
		waRect(ctx, x0, 0, pw, lw * 2.2, inkColor, 1);
		waRect(ctx, x0, height - lw * 2.2, pw, lw * 2.2, inkColor, 1);
		waRect(ctx, x0, 0, lw * 1.6, height, inkColor, 1);
		waRect(ctx, x0 + pw - lw * 1.6, 0, lw * 1.6, height, inkColor, 1);
		if (middleStile > 1) {
			waRect(ctx, x0 + pw / 2 - lw * 0.6, 0, lw * 1.2, height, inkColor, 1);
		}
		const hx = sd < 0 ? x0 + pw - mn * 0.075 : x0 + mn * 0.075;
		const r = mn * 0.024;
		waDisc(ctx, hx, height / 2, r, inkColor, 1);
		waStroke(
			ctx,
			ellipsePoints(hx, height / 2, r, r, 0, 0, 360, 16),
			acc,
			lw * 0.7,
			1,
		);
	}
}

/** 巻物送り — a scroll roller travels across the picture, winding the old cut onto itself and leaving the new one flat behind it. */
function drawWzMakimonoRollTrans(options: TreatTransTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height, width } = options;
	const p = clamp(frame.enterProgress);
	const seed = frame.cut?.seed ?? 0;
	const mn = Math.min(width, height);
	const dir = ru(seed, 3611) < 0.5 ? -1 : 1;
	const d = Math.max(12, mn * 0.09);
	const e = ioCubic(p);
	const X = dir > 0 ? lerpN(-d, width + d, e) : lerpN(width + d, -d, e);
	const xa = X - d / 2;
	const xb = X + d / 2;
	drawPrevious();
	ctx.save();
	ctx.beginPath();
	if (dir > 0) {
		ctx.rect(0, 0, Math.max(0, xa), height);
	} else {
		ctx.rect(xb, 0, Math.max(0, width - xb), height);
	}
	ctx.clip();
	drawCurrent();
	ctx.restore();
	// cast shadow on the freshly laid side (stepped bands approximate the gradient)
	const sw = d * 1.3;
	const band = sw / 3;
	for (let step = 0; step < 3; step += 1) {
		const a = 0.32 * (1 - step * 0.32);
		const b0 = band * step;
		waRect(
			ctx,
			dir > 0 ? xa - sw + b0 : xb + b0,
			0,
			band + 1,
			height,
			"#000000",
			a,
		);
	}
	// the roll: paper body, the next strip of the old cut wrapped round it, shading, caps
	waRect(ctx, xa, 0, d, height, paperColor(options), 1);
	const sx0 = dir > 0 ? xb : xa - d * 1.6;
	const s0 = Math.max(0, Math.min(width - 1, sx0));
	const s1 = Math.max(1, Math.min(width, sx0 + d * 1.6));
	if (s1 - s0 > 1) {
		ctx.save();
		if (dir > 0) {
			ctx.translate(xa - s0, 0);
			ctx.scale(d / (s1 - s0), 1);
		} else {
			ctx.translate(xa + d - s1, 0);
			ctx.scale(d / (s1 - s0), 1);
		}
		ctx.beginPath();
		ctx.rect(s0, 0, s1 - s0, height);
		ctx.clip();
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * 0.85;
		drawPrevious();
		ctx.globalAlpha = baseAlpha;
		ctx.restore();
	}
	waRect(ctx, xa, 0, d * 0.3, height, "#000000", 0.62);
	waRect(ctx, xa + d * 0.3, 0, d * 0.25, height, "#000000", 0.08);
	waRect(ctx, xa + d * 0.55, 0, d * 0.2, height, "#000000", 0.12);
	waRect(ctx, xa + d * 0.75, 0, d * 0.25, height, "#000000", 0.66);
	const capH = Math.max(4, height * 0.035);
	const inkColor = frame.palette.foreground;
	const pop = frame.palette.accent;
	waRect(ctx, xa - d * 0.12, 0, d * 1.24, capH, inkColor, 1);
	waRect(ctx, xa - d * 0.12, height - capH, d * 1.24, capH, inkColor, 1);
	waRect(ctx, xa - d * 0.12, capH, d * 1.24, capH * 0.22, pop, 1);
	waRect(ctx, xa - d * 0.12, height - capH * 1.22, d * 1.24, capH * 0.22, pop, 1);
}

/** 回り舞台 — the revolving stage: both cuts stand on one great turntable below the frame; the old one swings out as the new one swings in. */
function drawWzMawariButaiTrans(options: TreatTransTransitionDraw): void {
	const { ctx, drawCurrent, drawPrevious, frame, height, width } = options;
	const p = clamp(frame.enterProgress);
	const seed = frame.cut?.seed ?? 0;
	const dir = ru(seed, 3621) < 0.5 ? -1 : 1;
	const e = ioCubic(p);
	const R = Math.max(width, height) * 1.9;
	const px = width / 2;
	const py = height / 2 + R;
	const al = 2 * Math.atan(width / 2 / (R - height / 2)) * 1.32;
	const prevBg = frame.previousPalette?.background ?? frame.palette.background;
	const floor = mix(mix(prevBg, frame.palette.background, p), "#000000", 0.55);
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = floor;
	ctx.fillRect(0, 0, width, height);
	// eslint-disable-next-line opencut/prefer-object-params -- Stage wedge mirror of the source put(C, ang, dim) helper.
	const put = (ang: number, dim: number, draw: () => void) => {
		ctx.save();
		ctx.translate(px, py);
		ctx.rotate(ang);
		ctx.translate(-px, -py);
		draw();
		if (dim > 0.003) {
			const innerAlpha = ctx.globalAlpha;
			ctx.globalAlpha = innerAlpha * dim;
			ctx.fillStyle = "#000000";
			ctx.fillRect(-R * 2, -R * 2, R * 4, R * 4);
			ctx.globalAlpha = innerAlpha;
		}
		ctx.restore();
	};
	put(-dir * al * e, 0.4 * e, drawPrevious);
	put(dir * al * (1 - e), 0.4 * (1 - e), drawCurrent);
	// the seam of the turntable between the two sets
	ctx.save();
	ctx.translate(px, py);
	ctx.rotate(dir * al * (0.5 - e));
	ctx.fillStyle = frame.palette.foreground;
	const lw = Math.max(2, Math.min(width, height) * 0.008);
	ctx.globalAlpha = baseAlpha * bell(p);
	ctx.fillRect(-lw / 2, -R - height, lw, height * 2);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}
