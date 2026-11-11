import { coreDecorTextBounds } from "./core-decor-geometry";
import { coreDecorPlan } from "./core-decor-timing";
import type { CoreDecorBounds, CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import { enterBOutBack } from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inCubic,
	inQuad,
	inOutCubic,
	mixHex,
	outCubic,
	randomUnit,
	randomSigned,
	secondsOf,
	smoothNoise,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext, MotionTextPalette } from "./types";

/**
 * JIZURA x2decB — 30 decor parts (rule-driven particles, shapes that build,
 * faint back-layer patterns, beat / energy accents), transliterated from
 * `11p_x2_decB.js` onto the rocut decor contract.
 *
 * Semantic simplifications shared with the other x2 ports: the canvas path
 * methods are the optional ones on `MotionTextCanvasContext` (line caps/joins
 * default to butt/miter, dash patterns are emulated by arc-length span
 * subdivision), the beat / energy / motion clocks that JIZURA feeds from
 * playback fall back to the packs' own no-signal branches (a 0.5 s beat clock,
 * noise-driven energy, motion intensity 1), and `accent2` maps to the palette's
 * secondary colour.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const TICKS_PER_SECOND = 120_000;

interface X2Env {
	readonly ctx: MotionTextCanvasContext;
	readonly H: number;
	readonly W: number;
	readonly dur: number;
	readonly lt: number;
	readonly ltb: number;
	readonly motion: number;
	readonly pOut: number;
	readonly seed: number;
	readonly step: number;
	readonly sc: {
		readonly accent: string;
		readonly accent2: string;
		readonly bg: string;
		readonly fg: string;
		readonly sub: string;
	};
}

interface X2Params {
	readonly accent: boolean;
	readonly big: boolean;
	readonly corner: boolean;
	readonly low: boolean;
	readonly n: number;
	readonly r: number;
	readonly right: boolean;
	readonly seed: number;
	readonly v: number;
}

interface X2Part {
	readonly bb: CoreDecorBounds;
	readonly env: X2Env;
	readonly o: number;
	readonly p: X2Params;
	readonly t: number;
	readonly u: number;
}

/** JIZURA `J.clamp`: `cl(v)` clamps to 0..1, `cl(v, lo, hi)` to a range. */
// eslint-disable-next-line opencut/prefer-object-params -- cl(v) / cl(v, lo, hi) mirrors JIZURA's variadic J.clamp
function cl(value: number, min?: number, max?: number): number {
	if (min === undefined) return Math.min(1, Math.max(0, value));
	return Math.min(max ?? 1, Math.max(min, value));
}

const oBack = enterBOutBack;

// eslint-disable-next-line opencut/prefer-object-params -- lerp(a, b, k) mirrors the source pack's scalar lerp
function lerpN(a: number, b: number, k: number): number {
	return a + (b - a) * k;
}

function outExpo(value: number): number {
	const progress = cl(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

// eslint-disable-next-line opencut/prefer-object-params -- ein(t, d, delay, ease) mirrors the source pack's eased-entrance helper
function ein(t: number, d = 0.4, delay = 0, ease: (value: number) => number = outExpo): number {
	return ease(cl((t - delay) / d));
}

// eslint-disable-next-line opencut/prefer-object-params
function mod(a: number, n: number): number {
	return ((a % n) + n) % n;
}

/** JIZURA `tri`: 0 → 1 → 0 over one unit. */
function tri(x: number): number {
	return 1 - Math.abs(2 * mod(x, 1) - 1);
}

function bw(bb: CoreDecorBounds): number {
	return bb.x1 - bb.x0;
}

function bh(bb: CoreDecorBounds): number {
	return bb.y1 - bb.y0;
}

/** JIZURA `U`: 1 at a 1080 short side. */
function unitOf(env: X2Env): number {
	return Math.min(env.W, env.H) / 1080;
}

/** JIZURA `MG`: safe margin. */
function marginOf(env: X2Env): number {
	return Math.min(env.W, env.H) * 0.05;
}

/** JIZURA `SP`: speed factor of continuous motion. */
function sp(env: X2Env): number {
	return 0.45 + 0.8 * env.motion;
}

/** Beat clock fallback: the packs' own 0.5 s clock (rocut has no beat signal). */
function bt(t: number): { idx: number; since: number } {
	return { idx: Math.floor(t / 0.5), since: mod(t, 0.5) };
}

/** JIZURA `EN` energy fallback: noise plus a beat-kicked tail. */
// eslint-disable-next-line opencut/prefer-object-params -- en(t, s) mirrors EN(env, t, s)
function en(t: number, s: number): number {
	return cl(0.42 + 0.3 * noise1(t * 1.7, s) + 0.3 * Math.exp(-bt(t).since * 6));
}

// eslint-disable-next-line opencut/prefer-object-params -- noise1(v, seed) mirrors the source pack's argument order
function noise1(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

/** 0 inside the lyric box, 1 once `pad` away from it (JIZURA `keepOut`). */
// eslint-disable-next-line opencut/prefer-object-params -- keepOut(x, y, bb, pad) mirrors the source pack's clearance test
function keepOut(x: number, y: number, bb: CoreDecorBounds, pad: number): number {
	return cl(
		Math.hypot(
			Math.max(bb.x0 - x, 0, x - bb.x1),
			Math.max(bb.y0 - y, 0, y - bb.y1),
		) / pad,
	);
}

/** JIZURA `J.rr`: seeded range random. */
// eslint-disable-next-line opencut/prefer-object-params -- RR(min, max, seed, ...salts) mirrors the source pack's alias
function RR(min: number, max: number, seed: number, ...salts: number[]): number {
	return lerpN(min, max, randomUnit(seed, ...salts));
}

const R = randomUnit;
const RS = randomSigned;

// eslint-disable-next-line opencut/prefer-object-params -- hit(x0, y0, x1, y1, bb, pad) mirrors the source pack's overlap test
function hit(x0: number, y0: number, x1: number, y1: number, bb: CoreDecorBounds, pad = 0): boolean {
	return !(x1 < bb.x0 - pad || x0 > bb.x1 + pad || y1 < bb.y0 - pad || y0 > bb.y1 + pad);
}

/** JIZURA `PAD`: breathing room around the lyric box. */
// eslint-disable-next-line opencut/prefer-object-params
function padOf(bb: CoreDecorBounds, u: number, k = 1): number {
	return (24 * u + Math.min(bw(bb), bh(bb)) * 0.14) * k;
}

interface X2FrameRect {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
	readonly w: number;
	readonly h: number;
	readonly cx: number;
	readonly cy: number;
}

/** Padded frame round the lyric, kept on screen. */
// eslint-disable-next-line opencut/prefer-object-params
function frameRect(env: X2Env, bb: CoreDecorBounds, pad: number): X2FrameRect {
	const m = marginOf(env) * 0.35;
	const x0 = Math.max(m, bb.x0 - pad);
	const y0 = Math.max(m, bb.y0 - pad);
	const x1 = Math.min(env.W - m, bb.x1 + pad);
	const y1 = Math.min(env.H - m, bb.y1 + pad);
	return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

interface X2Spot {
	readonly cx: number;
	readonly cy: number;
	readonly h: number;
	readonly w: number;
	readonly x: number;
	readonly y: number;
}

/** A free w×h box in a screen corner (or at the middle of an edge) that does not touch the lyric; null when there is none. */
// eslint-disable-next-line opencut/prefer-object-params
function spot(env: X2Env, bb: CoreDecorBounds, w: number, h: number, p: X2Params, gap: number): X2Spot | null {
	const { W, H } = env;
	const m = marginOf(env) * 0.8;
	const sx = p.right ? 1 : -1;
	const sy = p.low ? 1 : -1;
	const c: X2Pt[] = [];
	const X = (a: number): number => (a > 0 ? W - m - w : a < 0 ? m : (W - w) / 2);
	const Y = (b: number): number => (b > 0 ? H - m - h : b < 0 ? m : (H - h) / 2);
	for (const [a, b] of [
		[sx, sy],
		[-sx, sy],
		[sx, -sy],
		[-sx, -sy],
		[0, sy],
		[0, -sy],
		[sx, 0],
		[-sx, 0],
	] as const) {
		c.push([X(a), Y(b)]);
	}
	for (const [x, y] of c) {
		if (x >= 0 && y >= 0 && !hit(x, y, x + w, y + h, bb, gap)) {
			return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
		}
	}
	return null;
}

interface X2Band {
	readonly h: number;
	readonly s: number;
	readonly y: number;
}

/** A free horizontal band of height h just below / above the lyric (else along the bottom / top margin); null when there is none. */
// eslint-disable-next-line opencut/prefer-object-params
function band(env: X2Env, bb: CoreDecorBounds, h: number, low: boolean, gap: number, edgeOK = true): X2Band | null {
	const { H } = env;
	const m = marginOf(env) * 0.5;
	const dn = bb.y1 + gap + h <= H - m;
	const up = bb.y0 - gap - h >= m;
	if (low ? dn : up) return low ? { y: bb.y1 + gap, h, s: 1 } : { y: bb.y0 - gap - h, h, s: -1 };
	if (low ? up : dn) return low ? { y: bb.y0 - gap - h, h, s: -1 } : { y: bb.y1 + gap, h, s: 1 };
	if (!edgeOK) return null;
	const m2 = marginOf(env);
	for (const s of low ? [1, -1] : [-1, 1]) {
		const y = s > 0 ? H - m2 - h : m2;
		if (y + h < bb.y0 - gap * 0.5 || y > bb.y1 + gap * 0.5) return { y, h, s };
	}
	return null;
}

type X2Pt = readonly [number, number];

interface X2StrokeOptions {
	readonly close?: boolean;
	readonly dash?: readonly [number, number];
	readonly off?: number;
}

/** JIZURA `stroke`: one pen stroke over a point list; dashes are emulated by span subdivision. */
// eslint-disable-next-line opencut/prefer-object-params -- stroke(env, pts, c, lw, a, o) mirrors the source pack's call shape
function stroke(
	env: X2Env,
	pts: readonly X2Pt[],
	c: string,
	lw: number,
	a = 1,
	options?: X2StrokeOptions,
): void {
	if (a <= 0.003 || pts.length < 2 || !(lw > 0)) return;
	if (options?.dash) {
		const pa = mk(pts, options.close === true);
		if (pa.L <= 0.01) return;
		const [on, off] = options.dash;
		const period = Math.max(0.01, on + off);
		const phase = options.off ?? 0;
		const switches = [0];
		for (
			let k = Math.floor(phase / period) - 1;
			k * period - phase < pa.L + period;
			k += 1
		) {
			for (const d of [0, on]) {
				const s = k * period + d - phase;
				if (s > 0 && s < pa.L) switches.push(s);
			}
		}
		switches.push(pa.L);
		for (let i = 0; i + 1 < switches.length; i += 1) {
			const s0 = switches[i]!;
			const s1 = switches[i + 1]!;
			if (s1 - s0 < 0.01) continue;
			const mid = (s0 + s1) / 2;
			if (mod(mid + phase, period) >= on) continue;
			strokePath(env, span(pa, s0, s1, false), c, lw, Math.min(1, a), false);
		}
		return;
	}
	strokePath(
		env,
		options?.close === true ? [...pts, pts[0]!] : pts,
		c,
		lw,
		Math.min(1, a),
		options?.close === true,
	);
}

// eslint-disable-next-line opencut/prefer-object-params -- strokePath mirrors the source pack's stroke tail
function strokePath(
	env: X2Env,
	pts: readonly X2Pt[],
	c: string,
	lw: number,
	a: number,
	close: boolean,
): void {
	if (pts.length < 2) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.strokeStyle = c;
	ctx.lineWidth = lw;
	ctx.beginPath();
	ctx.moveTo?.(pts[0]![0], pts[0]![1]);
	for (let i = 1; i < pts.length; i += 1) ctx.lineTo?.(pts[i]![0], pts[i]![1]);
	if (close) ctx.closePath?.();
	ctx.stroke?.();
	ctx.restore();
}

/** JIZURA `seg`: one stroke segment. */
// eslint-disable-next-line opencut/prefer-object-params -- seg(env, x0, y0, x1, y1, ...) mirrors the source pack's call shape
function seg(env: X2Env, x0: number, y0: number, x1: number, y1: number, c: string, lw: number, a = 1): void {
	if (a <= 0.003 || !(lw > 0)) return;
	strokePath(env, [[x0, y0], [x1, y1]], c, lw, Math.min(1, a), false);
}

/** JIZURA `fillPoly`: a closed filled polygon. */
// eslint-disable-next-line opencut/prefer-object-params -- fillPoly(env, pts, c, a) mirrors the source pack's call shape
function fillPoly(env: X2Env, pts: readonly X2Pt[], c: string, a = 1): void {
	if (a <= 0.003 || pts.length < 3) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.fillStyle = c;
	ctx.beginPath();
	ctx.moveTo?.(pts[0]![0], pts[0]![1]);
	for (let i = 1; i < pts.length; i += 1) ctx.lineTo?.(pts[i]![0], pts[i]![1]);
	ctx.closePath?.();
	ctx.fill?.();
	ctx.restore();
}

/** JIZURA `box`: an alpha rectangle. */
// eslint-disable-next-line opencut/prefer-object-params -- box(env, x, y, w, h, c, a) mirrors the source pack's call shape
function box(env: X2Env, x: number, y: number, w: number, h: number, c: string, a = 1): void {
	if (a <= 0.003 || w <= 0 || h <= 0) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.fillStyle = c;
	ctx.fillRect(x, y, w, h);
	ctx.restore();
}

/** JIZURA `sq`: a square of half-size r centred on (x, y), rotated. */
// eslint-disable-next-line opencut/prefer-object-params -- sq(env, x, y, r, rot, c, a, lw) mirrors the source pack's call shape
function sq(env: X2Env, x: number, y: number, r: number, rot: number, c: string, a = 1, lw?: number): void {
	if (a <= 0.003 || r <= 0.05) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.translate(x, y);
	if (rot) ctx.rotate(rot);
	ctx.globalAlpha = Math.min(1, a);
	if (lw) {
		ctx.strokeStyle = c;
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.moveTo?.(-r, -r);
		ctx.lineTo?.(r, -r);
		ctx.lineTo?.(r, r);
		ctx.lineTo?.(-r, r);
		ctx.closePath?.();
		ctx.stroke?.();
	} else {
		ctx.fillStyle = c;
		ctx.fillRect(-r, -r, r * 2, r * 2);
	}
	ctx.restore();
}

/** JIZURA `dot`: a filled circle (square fallback when the canvas has no arcs). */
// eslint-disable-next-line opencut/prefer-object-params -- dot(env, x, y, r, c, a) mirrors the source pack's call shape
function dot(env: X2Env, x: number, y: number, r: number, c: string, a = 1): void {
	if (a <= 0.003 || r <= 0.05) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.fillStyle = c;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(x, y, r, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
	ctx.restore();
}

/** JIZURA `ring`: a stroked circle or arc. */
// eslint-disable-next-line opencut/prefer-object-params -- ring(env, x, y, r, c, lw, a, a0, a1) mirrors the source pack's call shape
function ring(
	env: X2Env,
	x: number,
	y: number,
	r: number,
	c: string,
	lw: number,
	a = 1,
	a0 = 0,
	a1 = TAU,
): void {
	if (a <= 0.003 || r <= 0.05 || a1 <= a0) return;
	stroke(env, arcPts(x, y, r, a0, a1, Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.3))), c, lw, a);
}

// eslint-disable-next-line opencut/prefer-object-params -- arcPts(cx, cy, r, a0, a1, n) mirrors the source pack
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 24): X2Pt[] {
	const out: X2Pt[] = [];
	for (let i = 0; i <= n; i += 1) {
		const a = lerpN(a0, a1, i / n);
		out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
	}
	return out;
}

/** Rounded rectangle as an open point list, clockwise from the top-left arc. */
// eslint-disable-next-line opencut/prefer-object-params -- rrectPts(x0, y0, x1, y1, r, n) mirrors the source pack
function rrectPts(x0: number, y0: number, x1: number, y1: number, r: number, n = 8): X2Pt[] {
	const rr2 = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
	if (rr2 < 0.6) {
		return [
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
		];
	}
	const out: X2Pt[] = [];
	const cs: readonly (readonly [number, number, number])[] = [
		[x0 + rr2, y0 + rr2, 180],
		[x1 - rr2, y0 + rr2, 270],
		[x1 - rr2, y1 - rr2, 0],
		[x0 + rr2, y1 - rr2, 90],
	];
	for (const [cx, cy, a0] of cs) {
		for (let i = 0; i <= n; i += 1) {
			const a = degrees(a0 + (90 * i) / n);
			out.push([cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2]);
		}
	}
	return out;
}

/** JIZURA `env.rrect`: a filled rounded rectangle. */
// eslint-disable-next-line opencut/prefer-object-params -- rr(env, x, y, w, h, r, c, a) mirrors the source pack's env.rrect
function rr(env: X2Env, x: number, y: number, w: number, h: number, r: number, c: string, a = 1): void {
	if (a <= 0.003 || w <= 0.2 || h <= 0.2) return;
	fillPoly(env, rrectPts(x, y, x + w, y + h, r, 6), c, a);
}

interface X2Path {
	readonly L: number;
	readonly cum: readonly number[];
	readonly pts: readonly X2Pt[];
}

/** Polyline with cumulative lengths (JIZURA `mk`). */
// eslint-disable-next-line opencut/prefer-object-params -- mk(pts, closed) mirrors the source pack's path builder
function mk(pts: readonly X2Pt[], closed = false): X2Path {
	const q = closed ? [...pts, pts[0]!] : pts;
	const cum: number[] = [0];
	for (let i = 1; i < q.length; i += 1) {
		cum.push(
			cum[i - 1]! + Math.hypot(q[i]![0] - q[i - 1]![0], q[i]![1] - q[i - 1]![1]),
		);
	}
	return { pts: q, cum, L: cum[cum.length - 1] || 1e-6 };
}

/** Point and heading at arc length s (JIZURA `at`). */
// eslint-disable-next-line opencut/prefer-object-params -- at(pa, s) mirrors the source pack's path walker
function at(pa: X2Path, s: number): [number, number, number] {
	const target = cl(s, 0, pa.L);
	let i = 1;
	while (i < pa.cum.length - 1 && pa.cum[i]! < target) i += 1;
	const d = pa.cum[i]! - pa.cum[i - 1]! || 1e-6;
	const k = (target - pa.cum[i - 1]!) / d;
	const a0 = pa.pts[i - 1]!;
	const a1 = pa.pts[i]!;
	return [
		lerpN(a0[0], a1[0], k),
		lerpN(a0[1], a1[1], k),
		Math.atan2(a1[1] - a0[1], a1[0] - a0[0]),
	];
}

/** Sub-polyline between lengths s0..s1; wrap = the path is closed (JIZURA `span`). */
// eslint-disable-next-line opencut/prefer-object-params -- span(pa, s0, s1, wrap) mirrors the source pack's span
function span(pa: X2Path, s0: number, s1: number, wrap = false): X2Pt[] {
	const out: X2Pt[] = [];
	if (!(s1 > s0)) return out;
	const { pts, cum, L } = pa;
	if (!wrap) {
		const a = Math.max(0, s0);
		const b = Math.min(L, s1);
		if (!(b > a)) return out;
		const headA = at(pa, a);
		out.push([headA[0], headA[1]]);
		for (let i = 0; i < pts.length; i += 1) {
			if (cum[i]! > a && cum[i]! < b) out.push(pts[i]!);
		}
		const headB = at(pa, b);
		out.push([headB[0], headB[1]]);
		return out;
	}
	if (s1 - s0 >= L) return [...pts];
	const head0 = at(pa, mod(s0, L));
	out.push([head0[0], head0[1]]);
	for (let k = Math.floor(s0 / L) * L, g = 0; k < s1 && g < 4; k += L, g += 1) {
		for (let i = 0; i < pts.length - 1; i += 1) {
			const v = cum[i]! + k;
			if (v > s0 && v < s1) out.push(pts[i]!);
		}
	}
	const head1 = at(pa, mod(s1, L) || (s1 > 0 ? L : 0));
	out.push([head1[0], head1[1]]);
	return out;
}

/** First fraction e of a polyline by length (the x2decC `part` helper). */
// eslint-disable-next-line opencut/prefer-object-params -- part(pts, e) mirrors the source pack's partial polyline
function part(pts: readonly X2Pt[], e: number): X2Pt[] {
	if (e >= 1) return [...pts];
	if (e <= 0) return [];
	let L = 0;
	const ls: number[] = [];
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
		ls.push(d);
		L += d;
	}
	let rem = L * e;
	const out: X2Pt[] = [pts[0]!];
	for (let i = 1; i < pts.length; i += 1) {
		const d = ls[i - 1]!;
		if (rem >= d) {
			out.push(pts[i]!);
			rem -= d;
			continue;
		}
		const k = d > 0 ? rem / d : 0;
		out.push([lerpN(pts[i - 1]![0], pts[i]![0], k), lerpN(pts[i - 1]![1], pts[i]![1], k)]);
		break;
	}
	return out;
}

// eslint-disable-next-line opencut/prefer-object-params -- smoothstep(e0, e1, x) mirrors JIZURA's J.smooth
function smoothstep(e0: number, e1: number, v: number): number {
	const k = cl((v - e0) / (e1 - e0));
	return k * k * (3 - 2 * k);
}

/** JIZURA `J.h`: deterministic small integer hash. */
// eslint-disable-next-line opencut/prefer-object-params -- hOf(seed, ...salts) mirrors JIZURA's J.h
function hOf(seed: number, ...salts: number[]): number {
	return Math.floor(randomUnit(seed, ...salts) * 0x10000) | 0;
}

const X2_DECOR_B_IDS = new Set([
	"xmBeatSteps",
	"xmBounce",
	"xmContour",
	"xmConveyor",
	"xmDominoes",
	"xmDotWave",
	"xmFountain",
	"xmFuse",
	"xmGauge",
	"xmGears",
	"xmHatch",
	"xmIris",
	"xmIsoCubes",
	"xmMagnet",
	"xmMoire",
	"xmPendulum",
	"xmPie",
	"xmPolyGrow",
	"xmPong",
	"xmScatter",
	"xmSettle",
	"xmSlide",
	"xmSortBars",
	"xmSpiro",
	"xmStairs",
	"xmSwarm",
	"xmTriLattice",
	"xmTruchet",
	"xmWaves",
	"xmWhirl",
]);

const BACK_DECORS = new Set([
	"xmContour",
	"xmDotWave",
	"xmIris",
	"xmMoire",
	"xmPolyGrow",
	"xmSpiro",
	"xmTriLattice",
	"xmTruchet",
	"xmWaves",
	"xmWhirl",
]);

export function drawX2DecorsB(
	options: CoreDecorDraw & { readonly layer: CoreDecorLayer },
): boolean {
	if (!X2_DECOR_B_IDS.has(options.decor)) return false;
	const expectedLayer = BACK_DECORS.has(options.decor) ? "back" : "front";
	if (options.layer !== expectedLayer) return false;
	const part = decorPartOf(options);
	if (part) {
		switch (options.decor) {
			case "xmBeatSteps":
				drawBeatSteps(part);
				break;
			case "xmBounce":
				drawBounce(part);
				break;
			case "xmContour":
				drawContour(part);
				break;
			case "xmConveyor":
				drawConveyor(part);
				break;
			case "xmDominoes":
				drawDominoes(part);
				break;
			case "xmDotWave":
				drawDotWave(part);
				break;
			case "xmFountain":
				drawFountain(part);
				break;
			case "xmFuse":
				drawFuse(part);
				break;
			case "xmGauge":
				drawGauge(part);
				break;
			case "xmGears":
				drawGears(part);
				break;
			case "xmHatch":
				drawHatch(part);
				break;
			case "xmIris":
				drawIris(part);
				break;
			case "xmIsoCubes":
				drawIsoCubes(part);
				break;
			case "xmMagnet":
				drawMagnet(part);
				break;
			case "xmMoire":
				drawMoire(part);
				break;
			case "xmPendulum":
				drawPendulum(part);
				break;
			case "xmPie":
				drawPie(part);
				break;
			case "xmPolyGrow":
				drawPolyGrow(part);
				break;
			case "xmPong":
				drawPong(part);
				break;
			case "xmScatter":
				drawScatter(part);
				break;
			case "xmSettle":
				drawSettle(part);
				break;
			case "xmSlide":
				drawSlide(part);
				break;
			case "xmSortBars":
				drawSortBars(part);
				break;
			case "xmSpiro":
				drawSpiro(part);
				break;
			case "xmStairs":
				drawStairs(part);
				break;
			case "xmSwarm":
				drawSwarm(part);
				break;
			case "xmTriLattice":
				drawTriLattice(part);
				break;
			case "xmTruchet":
				drawTruchet(part);
				break;
			case "xmWaves":
				drawWaves(part);
				break;
			case "xmWhirl":
				drawWhirl(part);
				break;
		}
	}
	return true;
}

/**
 * The pack's `D` wrapper: main-pass graphics; front parts wait until the
 * entrance has mostly settled (rocut has no per-cut inDur, so the wait is
 * zero) and fade out with the cut.
 */
function decorPartOf(draw: CoreDecorDraw): X2Part | null {
	const cut = draw.frame.cut;
	if (!cut) return null;
	const lt = secondsOf(draw.frame);
	const t = lt;
	if (!(t > 0)) return null;
	const o = 1 - inCubic(draw.frame.exitProgress);
	if (o <= 0.003) return null;
	const plan = coreDecorPlan(draw);
	const palette: MotionTextPalette = draw.frame.palette;
	const env: X2Env = {
		ctx: draw.ctx,
		W: draw.width,
		H: draw.height,
		dur: cut.duration / TICKS_PER_SECOND,
		lt,
		ltb: lt,
		motion: 1,
		pOut: draw.frame.exitProgress,
		seed: plan.seed,
		step: Math.floor(lt * 60),
		sc: {
			fg: palette.foreground,
			accent: palette.accent,
			accent2: palette.secondary,
			sub: palette.secondary,
			bg: palette.background,
		},
	};
	return {
		env,
		bb: coreDecorTextBounds(draw),
		p: {
			accent: plan.accent,
			big: plan.big,
			corner: plan.corner,
			low: plan.low,
			n: plan.count,
			r: randomUnit(plan.seed, 11),
			right: plan.right,
			seed: plan.seed,
			v: plan.to,
		},
		t,
		o,
		u: unitOf(env),
	};
}

/* ============================================================ particles that follow a rule */

/** 積もる粒 — small squares fall one by one and pile up on the top edge of the lyric. */
function drawSettle(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const s = p.seed;
	const sz = (p.big ? 17 : 13) * u;
	const gap = 8 * u;
	const top = bb.y0 - gap > sz * 5;
	const xa = top ? bb.x0 : 0;
	const xw = top ? bw(bb) : W;
	const base = top ? bb.y0 - gap : H;
	const nb = cl(Math.round(xw / (sz * 1.2)), 3, 64);
	const N = Math.min(22 + p.n * 10, nb * 4);
	const lev = new Uint8Array(nb);
	const dropSpan = cl(env.dur * 0.32, 0.5, 2);
	const cols = [sc.fg, env.sc.accent, env.sc.accent2];
	const out = 1 - o;
	for (let i = 0; i < N; i += 1) {
		const b = Math.min(nb - 1, Math.floor(R(s, i, 1) * nb));
		const L = lev[b]!;
		lev[b] = L + 1;
		const q = cl((t - R(s, i, 3) * dropSpan) / 0.6);
		if (q <= 0) continue;
		const px = xa + (b + 0.5 + RS(s, i, 2) * 0.16) * (xw / nb);
		const yr = base - (L + 0.5) * sz;
		const b2 = cl((t - R(s, i, 3) * dropSpan - 0.6) / 0.22);
		const y =
			lerpN(Math.min(-sz * 2, yr - H * 0.3), yr, Math.pow(clamp01(q), 2)) -
			Math.sin(Math.PI * b2) * sz * 0.4 -
			out * H * 0.07 * R(s, i, 6);
		const a = (top ? 1 : keepOut(px, y, bb, sz * 2.5)) * o * 0.92;
		sq(
			env,
			px + out * RS(s, i, 5) * W * 0.1,
			y,
			sz * 0.43,
			(1 - q) * RS(s, i, 4) * 5 + out * RS(s, i, 7) * 2,
			cols[i % 5 === 0 ? 1 : i % 7 === 0 ? 2 : 0]!,
			a,
		);
	}
}

/** よける群れ — a stream of short dashes crosses the screen and parts around the lyric like water round a stone. */
function drawSwarm(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const s = p.seed;
	const M = 34 + p.n * 14;
	const dir = p.right ? 1 : -1;
	const gap = 26 * u;
	const cx = (bb.x0 + bb.x1) / 2;
	const cy = (bb.y0 + bb.y1) / 2;
	const a = (bw(bb) / 2) * 1.35 + gap * 2;
	const B = (bh(bb) / 2 + gap) / 0.72;
	const m = 40 * u;
	const track = W + 2 * m;
	const e = ein(t, 0.5, 0, outCubic);
	const spd = sp(env);
	const acc = env.sc.accent;
	// eslint-disable-next-line opencut/prefer-object-params -- pos(i, tt) mirrors the source pack's stream position closure
	const pos = (i: number, tt: number): X2Pt => {
		const px = mod(R(s, i, 1) * track + dir * tt * W * RR(0.1, 0.2, s, i, 2) * spd, track) - m;
		const d = H * RR(0.03, 0.97, s, i, 3) - cy;
		const k = (px - cx) / a;
		const hy = B * Math.exp(-k * k * k * k);
		return [px, cy + (d >= 0 ? 1 : -1) * Math.sqrt(d * d + hy * hy)];
	};
	for (let i = 0; i < M; i += 1) {
		const q = pos(i, t);
		const q0 = pos(i, t - 0.1 * e);
		if (Math.abs(q[0] - q0[0]) > W * 0.5 || q[1] < -20 || q[1] > H + 20) continue;
		seg(env, q0[0], q0[1], q[0], q[1], i % 6 === 0 ? acc : sc.fg, (i % 6 === 0 ? 5.5 : 3.6) * u, 0.8 * e * o);
	}
}

/** 跳ねる玉 — balls hop along the top of the lyric (or a floor line under it), squashing and leaving a mark where they land. */
function drawBounce(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { H, sc } = env;
	const gap = 10 * u;
	const r = (p.big ? 22 : 16) * u;
	const m = marginOf(env) * 0.4;
	const up = bb.y0 - gap - 2 * r - m;
	const dn = H - m - bb.y1 - gap - 2 * r;
	let top = !p.low;
	if ((top ? up : dn) < 44 * u) top = !top;
	const room = top ? up : dn;
	if (room < 16 * u) return;
	const hh = Math.min(130 * u, room);
	const yB = top ? bb.y0 - gap : bb.y1 + gap + hh + 2 * r;
	const xa = bb.x0 + r;
	const xb = Math.max(xa + 1, bb.x1 - r);
	const hops = cl(Math.round((xb - xa) / (150 * u)), 2, 9);
	const Th = 0.5 / (0.6 + 0.6 * env.motion);
	const e = ein(t, 0.45, 0, outCubic);
	const X = (q: number): number => lerpN(xa, xb, tri(q / (2 * hops)));
	if (!top) {
		seg(env, lerpN((xa + xb) / 2, xa - r, e), yB, lerpN((xa + xb) / 2, xb + r, e), yB, env.sc.sub, 1.6 * u, 0.8 * o);
	}
	const ctx = env.ctx;
	for (let k = 0; k < p.n; k += 1) {
		const ph = t / Th + k * (0.37 + (2 * hops) / p.n);
		const j = Math.floor(ph);
		const f = ph - j;
		const c = Math.min(f, 1 - f);
		const s2 = 1 - 0.34 * Math.exp(-c * 20);
		const bx = X(ph);
		const by = yB - r * s2 - hh * 4 * f * (1 - f) - (1 - e) * hh;
		const xl = X(j);
		const col = k === 0 ? (p.accent ? env.sc.accent : sc.fg) : k === 1 ? env.sc.accent : sc.fg;
		seg(env, xl - r * (0.5 + 1.5 * f), yB, xl + r * (0.5 + 1.5 * f), yB, col, 2 * u, (1 - f) * 0.7 * e * o);
		ctx.save();
		ctx.translate(bx, by);
		ctx.scale(1 / s2, s2);
		ctx.globalAlpha = Math.min(1, cl(e * 1.5) * o);
		ctx.fillStyle = col;
		if (ctx.arc && ctx.fill) {
			ctx.beginPath();
			ctx.arc(0, 0, r * o, 0, TAU);
			ctx.fill();
		} else {
			ctx.fillRect(-r * o, -r * o, r * o * 2, r * o * 2);
		}
		ctx.restore();
	}
}

/** 導火線 — a fuse beside the lyric burns down over the cut: a spitting spark eats the line and leaves ash dots. */
function drawFuse(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const s = p.seed;
	const gap = 24 * u;
	const m = marginOf(env) * 0.5;
	const vert = bh(bb) > bw(bb) * 1.25;
	let A: X2Pt;
	let B: X2Pt;
	let nx = 0;
	let ny = 0;
	if (!vert) {
		let low = p.low;
		if (low ? bb.y1 + gap > H - m : bb.y0 - gap < m) low = !low;
		const y = low ? bb.y1 + gap : bb.y0 - gap;
		A = [bb.x0, y];
		B = [bb.x1, y];
		ny = low ? 1 : -1;
	} else {
		let rt = p.low;
		if (rt ? bb.x1 + gap > W - m : bb.x0 - gap < m) rt = !rt;
		const px = rt ? bb.x1 + gap : bb.x0 - gap;
		A = [px, bb.y0];
		B = [px, bb.y1];
		nx = rt ? 1 : -1;
	}
	if (!p.right) {
		const q = A;
		A = B;
		B = q;
	}
	const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
	const n = cl(Math.round(L / (12 * u)), 8, 120);
	const pt = (q: number): X2Pt => {
		const w = Math.sin((q * L) / (40 * u)) * 5 * u;
		return [lerpN(A[0], B[0], q) + nx * w, lerpN(A[1], B[1], q) + ny * w];
	};
	const e = ein(t, 0.4, 0, outCubic);
	const q = cl((t - 0.3) / Math.max(0.6, env.dur - 1)) * 0.93;
	const acc = env.sc.accent;
	const pts: X2Pt[] = [];
	for (let i = 0; i <= n; i += 1) {
		const v = lerpN(q, Math.max(q, e), i / n);
		pts.push(pt(v));
	}
	stroke(env, pts, sc.fg, 3.2 * u, o);
	for (let i = 0, k = Math.floor(q * n); i < k; i += 2) {
		const a = pt(i / n);
		dot(env, a[0], a[1], 2 * u, env.sc.sub, 0.5 * o);
	}
	if (e > 0.98) ring(env, pt(1)[0], pt(1)[1], 5 * u, sc.fg, 2 * u, o);
	if (e <= q) return;
	const h = pt(q);
	for (let i = 0; i < 7; i += 1) {
		const an = R(s, env.step, i, 1) * TAU;
		const l = RR(13, 38, s, env.step, i, 2) * u * o;
		seg(
			env,
			h[0] + Math.cos(an) * 5 * u,
			h[1] + Math.sin(an) * 5 * u,
			h[0] + Math.cos(an) * l,
			h[1] + Math.sin(an) * l,
			i % 3 ? acc : sc.fg,
			2.6 * u,
			o,
		);
	}
	for (let i = 0; i < 6; i += 1) {
		const ph = t * 1.8 + i / 6;
		const a = ph - Math.floor(ph);
		const an = Math.atan2(ny, nx) + RS(s, i, Math.floor(ph), 3) * 1.2;
		dot(
			env,
			h[0] + Math.cos(an) * a * 60 * u,
			h[1] + Math.sin(an) * a * 60 * u,
			3 * u * (1 - a * 0.5),
			acc,
			(1 - a) * o,
		);
	}
	dot(env, h[0], h[1], 6.5 * u * o, acc, 1);
}

/** 吸いつく粒 — scattered dust is pulled in and sticks along an invisible frame round the lyric, then creeps along it. */
function drawMagnet(x: X2Part): void {
	const { env, bb, p, t, u } = x;
	const { W, H, sc } = env;
	const s = p.seed;
	const f = frameRect(env, bb, padOf(bb, u));
	const N = 34 + p.n * 14;
	const Lp = 2 * (f.w + f.h);
	const mn = Math.min(W, H);
	const per = (d: number): readonly [number, number, number, number] => {
		let v = mod(d, Lp);
		if (v < f.w) return [f.x0 + v, f.y0, 0, -1];
		v -= f.w;
		if (v < f.h) return [f.x1, f.y0 + v, 1, 0];
		v -= f.h;
		if (v < f.w) return [f.x1 - v, f.y1, 0, 1];
		v -= f.w;
		return [f.x0, f.y1 - v, -1, 0];
	};
	const out = inCubic(env.pOut);
	const acc = env.sc.accent;
	const dr = t * 12 * u * sp(env) * (p.right ? 1 : -1);
	for (let i = 0; i < N; i += 1) {
		const a = per(((i + R(s, i, 1) * 0.6) / N) * Lp + dr);
		const q = outCubic(cl((t - R(s, i, 2) * 0.45) / 0.6));
		const k = 1 - q + out * 1.2;
		const dist = RR(0.16, 0.5, s, i, 3) * mn * k;
		const tg = RS(s, i, 4) * dist * 0.5;
		const wob = Math.sin(t * 3 + i * 1.7) * 2.5 * u * q;
		const px = a[0] + a[2] * (dist + wob) - a[3] * tg;
		const py = a[1] + a[3] * (dist + wob) + a[2] * tg;
		const al = cl(q * 3) * (1 - out);
		const big = i % 5 === 0;
		if (k > 0.02) {
			seg(
				env,
				px,
				py,
				px + a[2] * dist * 0.22 - a[3] * tg * 0.22,
				py + a[3] * dist * 0.22 + a[2] * tg * 0.22,
				sc.fg,
				1.2 * u,
				0.4 * al,
			);
		}
		dot(env, px, py, (big ? 5.5 : 3.4) * u, big ? acc : sc.fg, al * 0.95);
	}
}

/** 振り子の波 — a row of pendulums of graded length swings in and out of phase, forming travelling wave patterns. */
function drawPendulum(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const gap = 16 * u;
	const rb = 8.5 * u;
	const m = marginOf(env) * 0.5;
	const dn = H - m - bb.y1 - gap - rb * 2;
	const up = bb.y0 - gap - rb * 2 - m;
	let low = p.low;
	if ((low ? dn : up) < 64 * u) low = !low;
	const room = low ? dn : up;
	if (room < 40 * u) return;
	const Lmax = Math.min((p.big ? 200 : 150) * u, room);
	const py = low ? bb.y1 + gap : bb.y0 - gap - rb * 2 - Lmax;
	const cx = (bb.x0 + bb.x1) / 2;
	const wid = Math.min(Math.max(bw(bb), 280 * u), W - m * 4);
	const xa = cl(cx - wid / 2, m * 2, W - m * 2 - wid);
	const xb = xa + wid;
	const N = cl(Math.round(wid / (46 * u)), 5, 17);
	const k0 = 8;
	const Tc = 16 / sp(env);
	const e = ein(t, 0.5, 0, outCubic);
	const acc = env.sc.accent;
	seg(env, lerpN((xa + xb) / 2, xa, e), py, lerpN((xa + xb) / 2, xb, e), py, sc.fg, 2.2 * u, o);
	for (let i = 0; i < N; i += 1) {
		const px = lerpN(xa, xb, (i + 0.5) / N);
		const fq = k0 + (i * 8) / N;
		const L = Lmax * Math.pow(k0 / fq, 2) * e * o;
		const an = 24 * DEG * Math.cos((TAU * fq * t) / Tc);
		const bx = px + Math.sin(an) * L;
		const by = py + Math.cos(an) * L;
		seg(env, px, py, bx, by, env.sc.sub, 1.6 * u, 0.85 * o);
		dot(env, bx, by, rb * cl(e * 1.4), i % 4 === 0 ? acc : sc.fg, o);
	}
}

/** 粒の噴水 — particles jet up from the bottom edge in arcs and fall back, born and dying in a loop. */
function drawFountain(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const s = p.seed;
	const M = 36 + p.n * 12;
	const Tl = 1.25 / sp(env);
	const Tf = Tl * 0.94;
	const acc = env.sc.accent;
	const a2 = env.sc.accent2;
	const ems = p.corner ? [0.12, 0.88] : [p.right ? 0.86 : 0.14];
	for (let k = 0; k < ems.length; k += 1) {
		for (let i = 0; i < M; i += 1) {
			const ph = t / Tl + (i + R(s, i, k, 9)) / M;
			const j = Math.floor(ph);
			const a = (ph - j) * Tl;
			if (t - a < 0 || a > Tf) continue;
			const h = H * RR(0.22, 0.5, s, i, j, k);
			const v = (4 * h) / Tf;
			const g = (2 * v) / Tf;
			const px = W * ems[k]! + RS(s, i, j, k + 4) * Math.min(W, H) * 0.11 * a;
			const py = H + 6 * u - v * a + (g * a * a) / 2;
			const al = keepOut(px, py, bb, 40 * u) * o * cl(a * 8);
			dot(
				env,
				px,
				py,
				RR(5.5, 10, s, i, k + 7) * u * (1 - (0.45 * a) / Tf),
				i % 3 === 0 ? acc : i % 5 === 0 ? a2 : sc.fg,
				al,
			);
		}
	}
}

/** ドミノ倒し — a row of upright bars topples in a chain along the lyric, then stands back up from the far end. */
function drawDominoes(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const gap = 14 * u;
	const h = (p.big ? 68 : 52) * u;
	const w = 8.5 * u;
	const m = marginOf(env) * 0.4;
	const ctx = env.ctx;
	const dn = H - m - bb.y1 - gap - h;
	const up = bb.y0 - gap - h - m;
	let low = p.low;
	if ((low ? dn : up) < 0) low = !low;
	if ((low ? dn : up) < 0) return;
	const yb = low ? bb.y1 + gap + h : bb.y0 - gap;
	const dir = p.right ? 1 : -1;
	let xa = bb.x0 + w;
	let xb = bb.x1 - w;
	if (xb - xa < 220 * u) {
		const c = cl((xa + xb) / 2, m + 110 * u, W - m - 110 * u);
		xa = c - 110 * u;
		xb = c + 110 * u;
	}
	const lenAll = xb - xa - h * 0.9;
	const N = cl(Math.ceil(lenAll / (h * 0.66)) + 1, 4, 40);
	const pitch = lenAll / (N - 1);
	const thMax = Math.min(Math.acos(cl(w / pitch, 0, 1)) * 0.985, 86 * DEG);
	const rate = 15 * sp(env);
	const Tf = (N + 3) / rate;
	const T = 2 * Tf + 1.3;
	const tc = t > 0.5 ? mod(t - 0.5, T) : -1;
	const wf = tc * rate;
	const wr = (tc - Tf - 0.7) * rate;
	seg(
		env,
		lerpN((xa + xb) / 2, xa, ein(t, 0.4)),
		yb,
		lerpN((xa + xb) / 2, xb, ein(t, 0.4)),
		yb,
		env.sc.sub,
		1.4 * u,
		0.7 * o,
	);
	for (let i = 0; i < N; i += 1) {
		const he = h * ein(t, 0.3, i * 0.012, oBack) * o;
		if (he <= 0.5) continue;
		const an =
			tc < 0
				? 0
				: (i === N - 1 ? 90 * DEG : thMax) *
					inQuad(cl((wf - i) / 2.2)) *
					(1 - smoothstep(0, 2.2, wr - (N - 1 - i)));
		const px = dir > 0 ? xa + i * pitch : xb - i * pitch;
		ctx.save();
		ctx.translate(px + (dir * w) / 2, yb);
		ctx.rotate(dir * an);
		ctx.globalAlpha = Math.min(1, o);
		ctx.fillStyle = i === 0 ? env.sc.accent : sc.fg;
		ctx.fillRect(dir > 0 ? -w : 0, -he, w, he);
		ctx.restore();
	}
}

/** ピンポン — a two-paddle rally in the free band beside the lyric: the ball zigzags, the paddles track it. */
function drawPong(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, sc } = env;
	const m = marginOf(env);
	const hB = (p.big ? 210 : 160) * u;
	const bd = band(env, bb, hB, p.low, 20 * u, false);
	if (!bd) return;
	const e = ein(t, 0.45);
	const xa = m * 1.2;
	const xb = W - m * 1.2;
	const pw = 13 * u;
	const ph = 66 * u;
	const bs = 11 * u;
	const spd = sp(env);
	const acc = env.sc.accent;
	const y0 = bd.y + bs;
	const y1 = bd.y + bd.h - bs;
	const mid = (y0 + y1) / 2;
	const ball = (tt: number): readonly [number, number, number] => {
		const k = tri((tt * spd) / 2.3 + p.r);
		return [
			lerpN(xa + pw + bs, xb - pw - bs, k),
			lerpN(y0, y1, tri((tt * spd) / 1.37 + p.r * 3)),
			k,
		];
	};
	const b = ball(t);
	const yl = cl(lerpN(b[1], mid, b[2] * 0.85), y0 + ph / 2 - bs, y1 - ph / 2 + bs);
	const yr = cl(lerpN(mid, b[1], 0.15 + b[2] * 0.85), y0 + ph / 2 - bs, y1 - ph / 2 + bs);
	const off = (1 - e) * 120 * u + (1 - o) * 120 * u;
	box(env, xa - off, yl - ph / 2, pw, ph, b[2] < 0.05 ? acc : sc.fg, o);
	box(env, xb - pw + off, yr - ph / 2, pw, ph, b[2] > 0.95 ? acc : sc.fg, o);
	for (let y = bd.y + 4 * u; y < bd.y + bd.h - 8 * u; y += 22 * u) {
		box(env, W / 2 - 2 * u, y, 4 * u, 11 * u * e, env.sc.sub, 0.55 * o);
	}
	for (let k = 4; k >= 0; k -= 1) {
		const q = ball(t - k * 0.035);
		sq(
			env,
			q[0],
			q[1],
			bs * (1 - k * 0.12),
			0,
			k ? sc.fg : p.accent ? acc : sc.fg,
			(k ? 0.4 - k * 0.08 : 1) * cl(e * 1.2) * o,
		);
	}
}

/** ベルト運搬 — a conveyor belt beside the lyric carries simple shapes along and drops them off the end. */
function drawConveyor(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, sc } = env;
	const s = p.seed;
	const m = marginOf(env);
	const bd = band(env, bb, 140 * u, p.low, 14 * u);
	if (!bd) return;
	const e = ein(t, 0.45, 0, outCubic);
	const dir = p.right ? 1 : -1;
	const sz = 17 * u;
	const v = 90 * u * sp(env);
	const spc = 120 * u;
	let xa = Math.max(m, bb.x0 - 30 * u);
	let xb = Math.min(W - m, bb.x1 + 30 * u);
	if (xb - xa < 340 * u) {
		const c = cl((xa + xb) / 2, m + 170 * u, W - m - 170 * u);
		xa = c - 170 * u;
		xb = c + 170 * u;
	}
	xb -= 50 * u * (dir > 0 ? 1 : 0);
	xa += 50 * u * (dir > 0 ? 0 : 1);
	const len = xb - xa;
	const yT = bd.y + 58 * u;
	const bt = 16 * u;
	const X0 = lerpN((xa + xb) / 2, xa, e);
	const X1 = lerpN((xa + xb) / 2, xb, e);
	stroke(
		env,
		[
			[X0, yT],
			[X1, yT],
			...arcPts(X1, yT + bt / 2, bt / 2, -Math.PI / 2, Math.PI / 2, 8).slice(1),
			[X0, yT + bt],
			...arcPts(X0, yT + bt / 2, bt / 2, Math.PI / 2, (Math.PI * 3) / 2, 8).slice(1),
		],
		sc.fg,
		2.6 * u,
		o,
		{ close: true },
	);
	stroke(env, [[X0, yT + bt / 2], [X1, yT + bt / 2]], env.sc.sub, 3 * u, o, {
		dash: [5 * u, 15 * u],
		off: -dir * t * v,
	});
	const cnt = Math.ceil(len / spc) + 1;
	const loop = cnt * spc;
	const cols = [sc.fg, env.sc.accent, env.sc.accent2];
	for (let i = 0; i < cnt; i += 1) {
		const raw = i * spc + t * v;
		const d = mod(raw, loop);
		const id = i + Math.floor(raw / loop) * cnt;
		const over = d - len;
		let px = (dir > 0 ? xa : xb) + dir * Math.min(d, len);
		let py = yT - sz - 2 * u;
		let rot = 0;
		let a = cl(d / (26 * u));
		const sc2 = oBack(cl(d / (30 * u))) * ein(t, 0.3, 0.1 + (i % 5) * 0.05, oBack);
		if (over > 0) {
			const tt = over / v;
			px += dir * over * 0.75;
			py += Math.min(tt * tt * 900 * u, 60 * u);
			rot = dir * tt * 5;
			a = 1 - cl(over / (spc * 0.55));
		}
		const ty = Math.floor(R(s, id, 1) * 3);
		const c = cols[Math.floor(R(s, id, 2) * 3)]!;
		const r = sz * sc2;
		if (ty === 0) dot(env, px, py, r, c, a * o * e);
		else if (ty === 1) sq(env, px, py, r * 0.9, rot, c, a * o * e);
		else {
			const q: X2Pt[] = [];
			for (let k = 0; k < 3; k += 1) {
				const an = rot - 90 * DEG + (k * TAU) / 3;
				q.push([px + Math.cos(an) * r * 1.2, py + r * 0.2 + Math.sin(an) * r * 1.2]);
			}
			fillPoly(env, q, c, a * o * e);
		}
	}
}

/* ============================================================ shapes that build */

/** 階段ブロック — blocks drop into a screen corner and build a staircase; a dot keeps hopping up the steps. */
function drawStairs(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H, sc } = env;
	const b = (p.big ? 56 : 44) * u;
	const S = 4 + p.n;
	const g = 3 * u;
	const sx = p.right ? -1 : 1;
	const sy = p.low ? -1 : 1;
	const X0 = p.right ? W : 0;
	const Y0 = p.low ? H : 0;
	const out = 1 - o;
	const acc = env.sc.accent;
	const cellX = (j: number): number => (sx > 0 ? X0 + j * b : X0 - (j + 1) * b);
	const cellY = (i: number): number => (sy > 0 ? Y0 + i * b : Y0 - (i + 1) * b);
	let idx = 0;
	for (let i = 0; i < S; i += 1) {
		for (let j = 0; j < S - i; j += 1, idx += 1) {
			const q = cl((t - idx * 0.022) / 0.34);
			if (q <= 0) continue;
			const px = cellX(j);
			const py = cellY(i) + sy * (1 - outCubic(q)) * b * 3 - sy * out * b * (S + 1);
			if (hit(px, py, px + b, py + b, bb, 8 * u)) continue;
			box(
				env,
				px + g / 2,
				py + g / 2,
				b - g,
				b - g,
				i === S - 1 - j ? acc : sc.fg,
				cl(q * 2) * (i === S - 1 - j ? 1 : 0.86),
			);
		}
	}
	const ph = (t - 0.5 - S * S * 0.018) / (0.34 / sp(env));
	if (ph < 0) return;
	const jj = Math.floor(ph) % (S + 1);
	const f = ph - Math.floor(ph);
	const r = 9.5 * u;
	if (jj >= S - 1) return;
	const ja = S - 1 - jj;
	const jb = ja - 1;
	const top = (j: number): number => Y0 + sy * ((S - j) * b + r + 2 * u);
	const cxs = (j: number): number => X0 + sx * (j + 0.5) * b;
	const px = lerpN(cxs(ja), cxs(jb), f);
	const py = lerpN(top(ja), top(jb), f) + sy * 4 * f * (1 - f) * b * 0.7;
	if (keepOut(px, py, bb, 10 * u) > 0.5) dot(env, px, py, r, sc.fg, o);
}

/** 積む立方体 — isometric cubes drop in one after another and stack into a small pile in a free corner. */
function drawIsoCubes(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const s = p.seed;
	const a = (p.big ? 46 : 36) * u;
	const sp2 = spot(env, bb, a * 5.4, a * 6.2, p, 14 * u);
	if (!sp2) return;
	const ox = sp2.cx;
	const oy = sp2.y + a * 3.6;
	const kx = a * 0.866;
	const acc = env.sc.accent;
	const cL = mixHex({ from: sc.fg, to: sc.bg, progress: 0.55 });
	const cR = mixHex({ from: sc.fg, to: sc.bg, progress: 0.28 });
	for (let x = 0; x < 3; x += 1) {
		for (let y = 0; y < 3; y += 1) {
			const hgt = x + y === 0 ? 3 : cl(3 - x - y + Math.floor(R(s, x, y, 1) * 2.3), 0, 3);
			for (let z = 0; z < hgt; z += 1) {
				const q = cl((t - (z + (x + y) * 0.3) * 0.2) / 0.36);
				if (q <= 0) continue;
				const cx = ox + (x - y) * kx;
				const cy = oy + ((x + y) * a) / 2 - z * a - a - (1 - outCubic(q)) * a * 2.5 - (1 - o) * a * 1.5;
				const al = cl(q * 2.5) * o;
				fillPoly(
					env,
					[
						[cx - kx, cy],
						[cx, cy + a / 2],
						[cx, cy + a * 1.5],
						[cx - kx, cy + a],
					],
					cL,
					al,
				);
				fillPoly(
					env,
					[
						[cx + kx, cy],
						[cx, cy + a / 2],
						[cx, cy + a * 1.5],
						[cx + kx, cy + a],
					],
					cR,
					al,
				);
				fillPoly(
					env,
					[
						[cx, cy - a / 2],
						[cx + kx, cy],
						[cx, cy + a / 2],
						[cx - kx, cy],
					],
					z === hgt - 1 && R(s, x, y, 2) < 0.3 ? acc : sc.fg,
					al,
				);
			}
		}
	}
}

/** スライドパズル — a 3×3 tile puzzle in a free corner; one tile at a time slides into the empty cell. */
function drawSlide(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const s = p.seed;
	const ts = (p.big ? 60 : 46) * u;
	const g = 7 * u;
	const wd = ts * 3 + g * 2;
	const spotBox = spot(env, bb, wd, wd, p, 16 * u);
	if (!spotBox) return;
	const grid = [0, 1, 2, 3, 4, 5, 6, 7, -1];
	const stepT = 0.48 / sp(env);
	const ph = Math.max(0, (t - 0.55) / stepT);
	const m = Math.min(Math.floor(ph), 400);
	let hole = 8;
	let prev = -1;
	let mvFrom = -1;
	const next = (q: number): number => {
		const c: number[] = [];
		const hx = hole % 3;
		const hy = Math.floor(hole / 3);
		if (hx > 0) c.push(hole - 1);
		if (hx < 2) c.push(hole + 1);
		if (hy > 0) c.push(hole - 3);
		if (hy < 2) c.push(hole + 3);
		const d = c.filter((k) => k !== prev);
		return d[hOf(s, q, 7) % d.length]!;
	};
	for (let q = 0; q <= m; q += 1) {
		const k = next(q);
		if (q === m) {
			mvFrom = k;
			break;
		}
		grid[hole] = grid[k]!;
		grid[k] = -1;
		prev = hole;
		hole = k;
	}
	const f = t < 0.55 ? 0 : inOutCubic(cl((ph - m) / 0.62));
	const acc = env.sc.accent;
	for (let c = 0; c < 9; c += 1) {
		const id = grid[c]!;
		if (id < 0) continue;
		const dst = c === mvFrom ? hole : c;
		const e = ein(t, 0.3, id * 0.035, oBack) * o;
		const px =
			spotBox.x + lerpN(c % 3, dst % 3, c === mvFrom ? f : 0) * (ts + g) + ts / 2;
		const py =
			spotBox.y + lerpN(Math.floor(c / 3), Math.floor(dst / 3), c === mvFrom ? f : 0) * (ts + g) + ts / 2;
		rr(
			env,
			px - (ts / 2) * e,
			py - (ts / 2) * e,
			ts * e,
			ts * e,
			7 * u,
			id === 0 ? acc : sc.fg,
			id === 0 ? 1 : 0.6 + 0.3 * (id % 2),
		);
	}
}

/** 歯車 — two meshed gears in a free corner turn against each other at their tooth ratio. */
function drawGears(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const k = p.big ? 1.9 : 1.5;
	const R1 = 56 * u * k;
	const N1 = 12;
	const N2 = 7;
	const R2 = (R1 * N2) / N1;
	const md = 9 * u * k;
	const phi = -28 * DEG;
	const w = R1 + (R1 + R2) * Math.cos(phi) + R2 + md * 2 + 8 * u;
	const h = R1 * 2 + md * 2 + 26 * u * k;
	const spotBox = spot(env, bb, w, h, p, 14 * u);
	if (!spotBox) return;
	const fl = p.right ? -1 : 1;
	const c1x = fl > 0 ? spotBox.x + md + 4 * u + R1 : spotBox.x + w - md - 4 * u - R1;
	const c1y = spotBox.y + h - md - 4 * u - R1;
	const c2x = c1x + fl * (R1 + R2) * Math.cos(phi);
	const c2y = c1y + (R1 + R2) * Math.sin(phi);
	const ph2 = fl > 0 ? phi : Math.PI - phi;
	const e = ein(t, 0.5, 0, oBack) * o;
	const e2 = ein(t, 0.5, 0.12, oBack) * o;
	const w0 = t * 0.75 * sp(env) + (1 - ein(t, 0.9, 0, outCubic)) * 3;
	// eslint-disable-next-line opencut/prefer-object-params -- gear(...) mirrors the source pack's tooth-path closure
	const gear = (cx: number, cy: number, Rp: number, N: number, th: number, sc1: number): X2Pt[] => {
		const ro = (Rp + md * 0.5) * sc1;
		const ri = (Rp - md * 0.6) * sc1;
		const Pt = TAU / N;
		const pts: X2Pt[] = [];
		for (let i = 0; i < N; i += 1) {
			for (const [fr, rr2] of [
				[0.2, ri],
				[0.31, ro],
				[0.69, ro],
				[0.8, ri],
			] as const) {
				const a = th + (i + fr) * Pt;
				pts.push([cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2]);
			}
		}
		return pts;
	};
	const th1 = ph2 + w0;
	const th2 = ph2 + Math.PI - (0.5 * TAU) / N2 - (w0 * N1) / N2;
	if (e > 0.01) {
		strokePath(env, gear(c1x, c1y, R1, N1, th1, e), sc.fg, 2.4 * u, cl(e), true);
		for (let i = 0; i < 3; i += 1) {
			const a = th1 + (i * TAU) / 3;
			seg(
				env,
				c1x + Math.cos(a) * R1 * 0.2 * e,
				c1y + Math.sin(a) * R1 * 0.2 * e,
				c1x + Math.cos(a) * (R1 - md) * e,
				c1y + Math.sin(a) * (R1 - md) * e,
				sc.fg,
				2 * u,
				cl(e),
			);
		}
		ring(env, c1x, c1y, R1 * 0.2 * e, sc.fg, 2.4 * u, cl(e));
	}
	if (e2 > 0.01) {
		fillPoly(env, gear(c2x, c2y, R2, N2, th2, e2), p.accent ? sc.fg : env.sc.accent, cl(e2));
		dot(env, c2x, c2y, R2 * 0.26 * e2, sc.bg, cl(e2));
	}
}

/** 並べ替え棒 — a row of shuffled bars sorts itself: neighbours light up and swap places until the heights are in order. */
function drawSortBars(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const s = p.seed;
	const N = 8 + p.n * 2;
	const k = p.big ? 1.9 : 1.5;
	const bwid = 9 * u * k;
	const pit = 15 * u * k;
	const hm = 84 * u * k;
	const sp = spot(env, bb, N * pit, hm + 8 * u, p, 14 * u);
	if (!sp) return;
	const arr: number[] = [];
	for (let i = 0; i < N; i += 1) arr.push(i);
	for (let i = N - 1; i > 0; i -= 1) {
		const j = hOf(s, i, 3) % (i + 1);
		const q = arr[i]!;
		arr[i] = arr[j]!;
		arr[j] = q;
	}
	const sw: number[] = [];
	const c = arr.slice();
	for (let a = 0; a < N; a += 1) {
		for (let b = 0; b < N - 1 - a; b += 1) {
			if (c[b]! > c[b + 1]!) {
				const q = c[b]!;
				c[b] = c[b + 1]!;
				c[b + 1] = q;
				sw.push(b);
			}
		}
	}
	const stepT = cl((env.dur - 1.3) / Math.max(1, sw.length), 0.05, 0.2);
	const ph = Math.max(0, (t - 0.5) / stepT);
	const m = Math.min(Math.floor(ph), sw.length);
	for (let i = 0; i < m; i += 1) {
		const b = sw[i]!;
		const q = arr[b]!;
		arr[b] = arr[b + 1]!;
		arr[b + 1] = q;
	}
	const cur = m < sw.length && t > 0.5 ? sw[m]! : -1;
	const f = inOutCubic(cl((ph - m) / 0.8));
	const acc = env.sc.accent;
	const yb = sp.y + sp.h - 3 * u;
	const done = cur < 0 && t > 0.5 ? (ph - sw.length) * stepT * 14 : -9;
	seg(env, sp.x, yb + 3 * u, sp.x + N * pit * ein(t, 0.4), yb + 3 * u, env.sc.sub, 1.4 * u, 0.8 * o);
	for (let i = 0; i < N; i += 1) {
		const h = (hm * (arr[i]! + 1)) / N * ein(t, 0.35, i * 0.02, oBack) * o;
		const dx = i === cur ? f : i === cur + 1 && cur >= 0 ? -f : 0;
		const lit = i === cur || (cur >= 0 && i === cur + 1) || Math.abs(done - i) < 1;
		box(
			env,
			sp.x + (i + dx) * pit + (pit - bwid) / 2,
			yb - h,
			bwid,
			h,
			lit ? acc : sc.fg,
			lit ? 1 : 0.85,
		);
	}
}

/** 分割パイ — a segmented donut assembles wedge by wedge in a free corner; one wedge sits apart and kicks out on the beat. */
function drawPie(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const s = p.seed;
	const Rd = (p.big ? 124 : 96) * u;
	const spotBox = spot(env, bb, Rd * 2 + 50 * u, Rd * 2 + 50 * u, p, 14 * u);
	if (!spotBox) return;
	const K = 3 + p.n;
	const fr: number[] = [];
	let sum = 0;
	for (let i = 0; i < K; i += 1) {
		fr.push(RR(0.6, 1.7, s, i, 1));
		sum += fr[i]!;
	}
	const pulse = Math.exp(-bt(t).since * 7);
	const cols = [env.sc.accent, sc.fg, env.sc.sub, sc.fg, env.sc.accent2, env.sc.sub];
	let a0 = t * 9 * DEG * sp(env) * (p.right ? 1 : -1) + p.r * TAU;
	for (let i = 0; i < K; i += 1) {
		const a1 = a0 + (fr[i]! / sum) * TAU;
		const e = ein(t, 0.36, i * 0.07, oBack) * o;
		const am = (a0 + a1) / 2;
		const off = (i === 0 ? 12 + 14 * pulse : 0) * u;
		if (e > 0.01) {
			const cx = spotBox.cx + Math.cos(am) * off;
			const cy = spotBox.cy + Math.sin(am) * off;
			const gp = 1.6 * DEG;
			fillPoly(
				env,
				arcPts(cx, cy, Rd * e, a0 + gp, a1 - gp, 14).concat(
					arcPts(cx, cy, Rd * 0.44 * e, a1 - gp * 2, a0 + gp * 2, 14),
				),
				cols[i % cols.length]!,
				cl(e) * (i === 0 ? 1 : i % 2 ? 0.88 : 0.7),
			);
		}
		a0 = a1;
	}
}

/** 散布図 — a small chart in a free corner: axes draw on, data points pop in one by one, then a trend line runs through them. */
function drawScatter(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const s = p.seed;
	const w = (p.big ? 330 : 260) * u;
	const h = w * 0.72;
	const sp = spot(env, bb, w, h, p, 14 * u);
	if (!sp) return;
	const x0 = sp.x + 10 * u;
	const y0 = sp.y + h - 10 * u;
	const pw = w - 18 * u;
	const phh = h - 18 * u;
	const M = 10 + p.n * 5;
	const up = p.v % 2 === 0;
	const e = ein(t, 0.45, 0, outCubic);
	const fy = (v: number): number => (up ? 0.14 + 0.7 * v : 0.86 - 0.7 * v);
	stroke(
		env,
		part(
			[
				[x0, y0 - phh],
				[x0, y0],
				[x0 + pw, y0],
			],
			e,
		),
		sc.fg,
		2.6 * u,
		o,
	);
	for (let i = 1; i <= 4; i += 1) {
		seg(env, x0 + (pw * i) / 4.4, y0, x0 + (pw * i) / 4.4, y0 + 5 * u * e, sc.fg, 1.4 * u, o * e);
		seg(env, x0, y0 - (phh * i) / 4.4, x0 - 5 * u * e, y0 - (phh * i) / 4.4, sc.fg, 1.4 * u, o * e);
	}
	for (let i = 0; i < M; i += 1) {
		const vx = 0.06 + 0.88 * R(s, i, 1);
		const vy = cl(fy(vx) + RS(s, i, 2) * 0.15, 0.04, 0.97);
		const q = ein(t, 0.26, 0.3 + i * 0.05, oBack);
		dot(env, x0 + vx * pw, y0 - vy * phh, 5.5 * u * q * o, i % 6 === 2 ? env.sc.accent2 : sc.fg, 0.95);
	}
	const l = ein(t, 0.5, 0.45 + M * 0.05, inOutCubic);
	if (l > 0) {
		seg(
			env,
			x0 + 0.03 * pw,
			y0 - fy(0.03) * phh,
			x0 + lerpN(0.03, 0.97, l) * pw,
			y0 - fy(lerpN(0.03, 0.97, l)) * phh,
			env.sc.accent,
			3.2 * u,
			o,
		);
	}
}

/* ============================================================ accents that react */

/** 拍ステップ — a step-sequencer row beside the lyric: the lit square advances one step on every beat. */
function drawBeatSteps(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, sc } = env;
	const K = 8;
	const s2 = (p.big ? 40 : 30) * u;
	const g = s2 * 0.55;
	const wid = K * s2 + (K - 1) * g;
	const m = marginOf(env);
	const bd = band(env, bb, s2 * 1.7, p.low, 18 * u);
	if (!bd) return;
	const cx = cl((bb.x0 + bb.x1) / 2, m + wid / 2, W - m - wid / 2);
	const yc = bd.y + bd.h / 2;
	const b = bt(t);
	const idx = mod(b.idx, K);
	const pulse = Math.exp(-b.since * 7);
	const acc = env.sc.accent;
	for (let i = 0; i < K; i += 1) {
		const e = ein(t, 0.3, i * 0.03, oBack) * o;
		const px = cx - wid / 2 + i * (s2 + g) + s2 / 2;
		if (e <= 0.01) continue;
		if (i === idx) sq(env, px, yc, (s2 / 2) * (1 + 0.4 * pulse) * e, 0, acc, 1);
		else if (i < idx) sq(env, px, yc, s2 * 0.4 * e, 0, sc.fg, 0.6);
		else sq(env, px, yc, s2 * 0.4 * e, 0, sc.fg, 0.8, 2.2 * u);
		if (i % 4 === 0) {
			seg(env, px - s2 / 2, yc + bd.s * s2 * 0.82, px + s2 / 2, yc + bd.s * s2 * 0.82, env.sc.sub, 1.6 * u, 0.8 * cl(e));
		}
	}
}

/** 針メーター — an analogue dial in a free corner; the needle follows the loudness of the music. */
function drawGauge(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { sc } = env;
	const Rd = (p.big ? 140 : 108) * u;
	const sp = spot(env, bb, Rd * 2 + 24 * u, Rd + 30 * u, p, 14 * u);
	if (!sp) return;
	const cx = sp.cx;
	const cy = sp.y + sp.h - 14 * u;
	const e = ein(t, 0.5, 0, outCubic);
	const acc = env.sc.accent;
	const al = o;
	ring(env, cx, cy, Rd, sc.fg, 2.6 * u, al, Math.PI, Math.PI + Math.PI * e);
	if (e > 0.72) ring(env, cx, cy, Rd - 7 * u, acc, 6 * u, al, Math.PI * 1.72, Math.PI + Math.PI * e);
	for (let i = 0; i <= 10; i += 1) {
		if (i / 10 > e) break;
		const a = Math.PI * (1 + i / 10);
		const l = (i % 5 === 0 ? 22 : 12) * u;
		seg(
			env,
			cx + Math.cos(a) * (Rd - 3 * u),
			cy + Math.sin(a) * (Rd - 3 * u),
			cx + Math.cos(a) * (Rd - 3 * u - l),
			cy + Math.sin(a) * (Rd - 3 * u - l),
			i >= 8 ? acc : sc.fg,
			(i % 5 === 0 ? 2.4 : 1.5) * u,
			al,
		);
	}
	const v = lerpN(1 - Math.abs(1 - cl(t / 0.5) * 2), en(t, p.seed), cl((t - 0.45) / 0.25));
	const a = Math.PI * (1 + cl(v, 0.02, 0.98));
	seg(
		env,
		cx - Math.cos(a) * 10 * u,
		cy - Math.sin(a) * 10 * u,
		cx + Math.cos(a) * Rd * 0.84 * o,
		cy + Math.sin(a) * Rd * 0.84 * o,
		v > 0.75 ? acc : sc.fg,
		4 * u,
		al * cl(t / 0.15),
	);
	dot(env, cx, cy, 8 * u * e, sc.fg, al);
}

/** 斜線の影 — an offset drop shadow of the lyric block made only of diagonal hatching that sweeps on and creeps. */
function drawHatch(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const f = frameRect(env, bb, padOf(bb, u, 0.8));
	const d = (18 + p.n * 11) * u;
	const dx = p.right ? d : -d;
	const dy = p.low ? d : -d;
	const ctx = env.ctx;
	const e = ein(t, 0.55, 0, inOutCubic);
	const spd = 11 * u;
	const x0 = f.x0 + dx;
	const y0 = f.y0 + dy;
	const cnt = Math.ceil((f.w + f.h) / spd) + 1;
	const off = mod(t * 9 * u * sp(env), spd);
	ctx.save();
	ctx.beginPath();
	ctx.rect(x0, y0, f.w, f.h);
	ctx.clip();
	ctx.beginPath();
	ctx.rect(-10, -10, W + 20, H + 20);
	ctx.rect(f.x0, f.y0, f.w, f.h);
	ctx.clip("evenodd");
	ctx.globalAlpha = Math.min(1, 0.9 * o);
	ctx.strokeStyle = p.accent ? env.sc.accent : env.sc.fg;
	ctx.lineWidth = 2.2 * u;
	ctx.beginPath();
	const lim = cnt * e;
	for (let k = 0; k < lim && k < 600; k += 1) {
		const kk = p.right ? k : cnt - 1 - k;
		const xs = x0 + kk * spd + off;
		ctx.moveTo?.(xs, y0);
		ctx.lineTo?.(xs - f.h, y0 + f.h);
	}
	ctx.stroke?.();
	ctx.restore();
}

/* ============================================================ back-layer patterns (kept faint) */

/** 増える角 — a large faint polygon behind the lyric keeps gaining and losing a corner: triangle → square → … → octagon. */
function drawPolyGrow(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const dir = p.right ? 1 : -1;
	const cx = p.corner ? W * (p.right ? 0.8 : 0.2) : W * 0.5;
	const cy = p.corner ? H * (p.low ? 0.74 : 0.26) : H * 0.5;
	const R0 = mn * (p.corner ? 0.25 : 0.4) * (p.big ? 1.12 : 1) * ein(t, 0.5, 0, outCubic);
	const ph = t / (0.95 / sp(env));
	const k = Math.floor(ph);
	const f = inOutCubic(cl((ph - k) / 0.5));
	const sq2 = (n: number): number => {
		const v = mod(n + p.v, 10);
		return 3 + (v < 5 ? v : 10 - v);
	};
	const ne = lerpN(sq2(k), sq2(k + 1), f);
	// eslint-disable-next-line opencut/prefer-object-params -- poly(rad, rot) mirrors the source pack's polygon closure
	const poly = (rad: number, rot: number): X2Pt[] => {
		const q: X2Pt[] = [];
		const mm = Math.ceil(ne - 1e-6);
		for (let i = 0; i < mm; i += 1) {
			const a = rot + (i * TAU) / ne;
			q.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
		}
		return q;
	};
	const A = poly(R0, -90 * DEG + dir * t * 6 * DEG);
	const B = poly(R0 * 0.62, -90 * DEG - dir * t * 9 * DEG);
	stroke(env, A, c, 4.5 * u, 0.9 * o, { close: true });
	stroke(env, B, c, 2.4 * u, 0.8 * o, { close: true });
	for (const q of A) dot(env, q[0], q[1], 9 * u, c, o);
}

/** 三角タイル — a triangle lattice spreads from a screen corner; cells fill in, breathe and empty again. */
function drawTriLattice(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const s = p.seed;
	const mn = Math.min(W, H);
	const sd = mn * 0.088 * (p.big ? 1.2 : 1);
	const hT = sd * 0.866;
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.2 });
	const acc = env.sc.accent;
	const ox = p.right ? W : 0;
	const oy = p.low ? H : 0;
	const sx = p.right ? -1 : 1;
	const sy = p.low ? -1 : 1;
	const reach = mn * (0.5 + 0.06 * p.n);
	const rows = Math.ceil(reach / hT);
	const cols = Math.ceil(reach / (sd / 2));
	for (let r = 0; r < rows; r += 1) {
		for (let q = -1; q < cols; q += 1) {
			const upT = (q + r) % 2 === 0;
			const gx = ((q + 1) * sd) / 2;
			const gy = (r + 0.5) * hT;
			const dd = Math.hypot(gx, gy) / reach;
			const fall = cl((1 - dd) * 1.6);
			if (fall <= 0) continue;
			const e = ein(t, 0.36, dd * 0.5 + R(s, r, q, 1) * 0.22, outCubic);
			if (e <= 0) continue;
			const ya = (upT ? r + 1 : r) * hT;
			const yb = (upT ? r : r + 1) * hT;
			const pts: readonly X2Pt[] = [
				[(q * sd) / 2, ya],
				[((q + 2) * sd) / 2, ya],
				[gx, yb],
			];
			const cy2 = (ya * 2 + yb) / 3;
			const P2: X2Pt[] = pts.map(
				(v): X2Pt => [
					ox + sx * (gx + (v[0] - gx) * e * 0.9),
					oy + sy * (cy2 + (v[1] - cy2) * e * 0.9),
				],
			);
			const h = R(s, r, q, 2);
			const tg = 0.5 + 0.5 * Math.sin(t * 0.9 * sp(env) + R(s, r, q, 3) * TAU);
			if (h < 0.05) fillPoly(env, P2, acc, fall * e * o * 0.3 * tg);
			else if (h < 0.48) fillPoly(env, P2, c, fall * e * o * (0.25 + 0.7 * tg));
			else stroke(env, P2, c, 1.6 * u, fall * e * o * 0.8, { close: true });
		}
	}
}

/** 点灯ドット — a dot-matrix panel behind the lyric; a diagonal wave of larger, brighter dots keeps rolling through it. */
function drawDotWave(x: X2Part): void {
	const { env, p, t, o } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const d = mn * 0.042;
	const strip = p.v >= 3;
	const dir = p.right ? 1 : -1;
	const cols = Math.min(64, Math.floor((W * 0.92) / d));
	const rows = Math.min(26, Math.max(3, Math.round((H * (strip ? 0.2 : 0.52)) / d)));
	const cy = strip ? H * (p.low ? 0.82 : 0.18) : H * 0.5;
	const x0 = W / 2 - ((cols - 1) * d) / 2;
	const y0 = cy - ((rows - 1) * d) / 2;
	const spd = sp(env);
	const ctx = env.ctx;
	const dim = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.2 });
	const cells: (readonly [number, number, number])[] = [];
	const lit: number[] = [];
	// eslint-disable-next-line opencut/prefer-object-params -- push(x, y, r, wv) mirrors the source pack's cell-emit closure
	const push = (x: number, y: number, r: number, wv: number): void => {
		cells.push([x, y, r]);
		if (wv > 0.7) lit.push(x, y, r * 0.62);
	};
	for (let j = 0; j < rows; j += 1) {
		for (let i = 0; i < cols; i += 1) {
			const nx = (i - (cols - 1) / 2) / cols;
			const ny = (j - (rows - 1) / 2) / rows;
			const e = cl(t * 2.6 - Math.hypot(nx, ny) * 2.2);
			if (e <= 0) continue;
			const wv = Math.pow(0.5 + 0.5 * Math.sin(i * 0.33 * dir + j * 0.52 - t * 2.6 * spd), 3);
			const r = d * (0.085 + 0.2 * wv) * e;
			push(x0 + i * d, y0 + j * d, r, wv);
		}
	}
	ctx.save();
	ctx.globalAlpha = Math.min(1, 0.95 * o);
	ctx.fillStyle = dim;
	if (ctx.arc && ctx.fill && ctx.moveTo) {
		ctx.beginPath();
		for (const [x, y, r] of cells) {
			ctx.moveTo(x + r, y);
			ctx.arc(x, y, r, 0, TAU);
		}
		ctx.fill();
	} else {
		for (const [x, y, r] of cells) ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
	ctx.restore();
	ctx.save();
	ctx.globalAlpha = Math.min(1, 0.3 * o);
	ctx.fillStyle = p.accent ? env.sc.accent : env.sc.fg;
	if (ctx.arc && ctx.fill && ctx.moveTo) {
		ctx.beginPath();
		for (let k = 0; k < lit.length; k += 3) {
			ctx.moveTo(lit[k]! + lit[k + 2]!, lit[k + 1]!);
			ctx.arc(lit[k]!, lit[k + 1]!, lit[k + 2]!, 0, TAU);
		}
		ctx.fill();
	} else {
		for (let k = 0; k < lit.length; k += 3) {
			ctx.fillRect(lit[k]! - lit[k + 2]!, lit[k + 1]! - lit[k + 2]!, lit[k + 2]! * 2, lit[k + 2]! * 2);
		}
	}
	ctx.restore();
}

/** 等高線 — nested wobbly closed curves like a contour map draw themselves behind the lyric and drift slowly. */
function drawContour(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const s = p.seed;
	const mn = Math.min(W, H);
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const ax = W > H ? 1.4 : 1;
	const ay = H > W ? 1.4 : 1;
	const spd = sp(env);
	const M = 60;
	for (let hI = 0; hI < (p.n >= 2 ? 2 : 1); hI += 1) {
		const cx = W * (hI ? RR(0.12, 0.88, s, hI, 1) : RR(0.38, 0.62, s, 0, 1));
		const cy = H * (hI ? RR(0.15, 0.85, s, hI, 2) : RR(0.4, 0.6, s, 0, 2));
		const Rm = mn * (hI ? 0.24 : 0.5);
		const K = hI ? 4 : p.big ? 7 : 6;
		const f1 = R(s, hI, 3) * TAU;
		const f2 = R(s, hI, 4) * TAU;
		const f3 = R(s, hI, 5) * TAU;
		for (let k = 0; k < K; k += 1) {
			const e = ein(t, 0.8, (K - 1 - k) * 0.06 + hI * 0.2, inOutCubic);
			if (e <= 0) continue;
			const rad = (Rm * (k + 0.6)) / K;
			const pts: X2Pt[] = [];
			const cnt = Math.ceil(M * e);
			const wk = 0.5 + (0.5 * k) / K;
			for (let i = 0; i <= cnt && i <= M; i += 1) {
				const th = (i / M) * TAU + f1;
				const wob =
					0.17 * Math.sin(2 * th + f1 + k * 0.25 + t * 0.12 * spd) +
					0.1 * Math.sin(3 * th + f2 - k * 0.2 - t * 0.09 * spd) +
					0.05 * Math.sin(5 * th + f3 + k * 0.3);
				pts.push([
					cx + Math.cos(th) * rad * (1 + wob * wk) * ax,
					cy + Math.sin(th) * rad * (1 + wob * wk) * ay,
				]);
			}
			stroke(env, pts, c, (k % 3 === 0 ? 3.4 : 2) * u, 0.9 * o);
		}
	}
}

/** モアレ — two sets of fine concentric rings slide over each other; the interference bands swing round. */
function drawMoire(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const K = 12 + p.n * 2;
	const spc = mn * 0.03;
	const cx = p.corner ? W * (p.right ? 0.78 : 0.22) : W * 0.5;
	const cy = p.corner ? H * (p.low ? 0.72 : 0.28) : H * 0.5;
	const an = t * 0.4 * sp(env) * (p.right ? 1 : -1) + p.r * TAU;
	const d = spc * 1.5 * ein(t, 0.8, 0, outCubic);
	for (let q = 0; q < 2; q += 1) {
		const x = cx + Math.cos(an) * d * (q ? 1 : -1);
		const y = cy + Math.sin(an) * d * (q ? 1 : -1);
		for (let k = 0; k < K; k += 1) {
			const e = ein(t, 0.5, k * 0.025, outCubic);
			if (e <= 0) continue;
			ring(env, x, y, spc * (k + 1) * (0.6 + 0.4 * e), c, 2.4 * u, 0.8 * o * e * (1 - 0.5 * (k / K)));
		}
	}
}

/** 円弧タイル — a patch of quarter-arc tiles grows from a corner; tiles keep turning a quarter so the paths re-route. */
function drawTruchet(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const s = p.seed;
	const mn = Math.min(W, H);
	const c = mn * 0.092 * (p.big ? 1.2 : 1);
	const col = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const ctx = env.ctx;
	const ox = p.right ? W : 0;
	const oy = p.low ? H : 0;
	const sx = p.right ? -1 : 1;
	const sy = p.low ? -1 : 1;
	const reach = mn * (0.5 + 0.05 * p.n);
	const nn = Math.ceil(reach / c);
	const T = 2.8 / sp(env);
	ctx.save();
	ctx.strokeStyle = col;
	ctx.lineWidth = 3.6 * u;
	for (let j = 0; j < nn; j += 1) {
		for (let i = 0; i < nn; i += 1) {
			const gx = (i + 0.5) * c;
			const gy = (j + 0.5) * c;
			const dd = Math.hypot(gx, gy) / reach;
			const fall = cl((1 - dd) * 1.7);
			if (fall <= 0) continue;
			const e = ein(t, 0.4, dd * 0.55 + R(s, i, j, 1) * 0.2, oBack);
			if (e <= 0.01) continue;
			const ph = (t + R(s, i, j, 2) * T) / T;
			const fl = Math.floor(ph);
			const turn = (hOf(s, i, j, 3) & 1) + fl - 1 + inOutCubic(cl(((ph - fl) * T) / 0.4));
			ctx.save();
			ctx.translate(ox + sx * gx, oy + sy * gy);
			ctx.rotate(turn * 90 * DEG);
			ctx.scale(e, e);
			ctx.globalAlpha = Math.min(1, fall * o * 0.9);
			ctx.beginPath();
			ctx.arc?.(-c / 2, -c / 2, c / 2, 0, 90 * DEG);
			ctx.moveTo?.(0, c / 2);
			ctx.arc?.(c / 2, c / 2, c / 2, 180 * DEG, 270 * DEG);
			ctx.stroke?.();
			ctx.restore();
		}
	}
	ctx.restore();
}

/** スピログラフ — a faint spirograph curve is traced by a moving pen behind the lyric, then turns slowly. */
function drawSpiro(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const table: readonly (readonly [number, number, number])[] = [
		[5, 3, 2.2],
		[7, 3, 2.4],
		[8, 5, 3.6],
		[7, 2, 1.6],
		[9, 4, 3],
		[10, 3, 2.4],
	];
	const [a, b, d] = table[mod(p.v, 6)]!;
	const cx = p.corner ? W * (p.right ? 0.78 : 0.22) : W * 0.5;
	const cy = p.corner ? H * (p.low ? 0.72 : 0.28) : H * 0.5;
	const S = (mn * (p.corner ? 0.25 : 0.4) * (p.big ? 1.1 : 1)) / (a - b + d);
	const n = 64 * b;
	const q = inOutCubic(cl(t / 1.9));
	const cnt = Math.ceil(n * q);
	const rot = t * 4 * DEG * sp(env) * (p.right ? 1 : -1) + p.r * TAU;
	const cr = Math.cos(rot);
	const sr = Math.sin(rot);
	const pts: X2Pt[] = [];
	for (let i = 0; i <= cnt; i += 1) {
		const th = (Math.min(i, n * q) / n) * TAU * b;
		const px = (a - b) * Math.cos(th) + d * Math.cos(((a - b) / b) * th);
		const py = (a - b) * Math.sin(th) - d * Math.sin(((a - b) / b) * th);
		pts.push([cx + (px * cr - py * sr) * S, cy + (px * sr + py * cr) * S]);
	}
	stroke(env, pts, mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 }), 2.6 * u, 0.95 * o);
	if (q < 1 && pts.length) {
		const last = pts[pts.length - 1]!;
		dot(env, last[0], last[1], 7 * u, env.sc.sub, 0.7 * o);
	}
}

/** 絞り羽根 — a camera-iris of straight blades behind the lyric opens on entry, breathes with the beat and closes on exit. */
function drawIris(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const N = 5 + p.n;
	const cx = p.corner ? W * (p.right ? 0.78 : 0.22) : W * 0.5;
	const cy = p.corner ? H * (p.low ? 0.7 : 0.3) : H * 0.5;
	const Rd = mn * (p.corner ? 0.27 : 0.42) * (p.big ? 1.08 : 1);
	const e = ein(t, 0.6, 0, outCubic);
	const pulse = Math.exp(-bt(t).since * 5) * 0.4;
	const open = cl(e * (0.4 + 0.08 * Math.sin(t * 0.8) + 0.1 * pulse) * (0.15 + 0.85 * o), 0.02, 0.9);
	const r = Rd * open;
	const rot = (t * 8 * sp(env) + (1 - e) * 70) * DEG * (p.right ? 1 : -1);
	const I: X2Pt[] = [];
	for (let k = 0; k < N; k += 1) {
		const a = rot + (k * TAU) / N;
		I.push([Math.cos(a) * r, Math.sin(a) * r]);
	}
	ring(env, cx, cy, Rd, c, 4 * u, 0.9 * o * e);
	ring(env, cx, cy, Rd * 1.05, c, 1.8 * u, 0.7 * o * e);
	for (let k = 0; k < N; k += 1) {
		const a = I[k]!;
		const b = I[(k + 1) % N]!;
		const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
		const dx = (a[0] - b[0]) / L;
		const dy = (a[1] - b[1]) / L;
		const pd = a[0] * dx + a[1] * dy;
		const sN = -pd + Math.sqrt(Math.max(0, pd * pd - (r * r - Rd * Rd)));
		seg(env, cx + b[0], cy + b[1], cx + a[0] + dx * sN, cy + a[1] + dy * sN, c, 3 * u, 0.9 * o * e);
	}
}

/** 渦巻く四角 — squares nested corner-to-edge inside each other form a whirl whose twist slowly tightens and relaxes. */
function drawWhirl(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const mn = Math.min(W, H);
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.36 });
	const K = 11 + p.n * 2;
	const cx = p.corner ? W * (p.right ? 0.8 : 0.2) : W * 0.5;
	const cy = p.corner ? H * (p.low ? 0.72 : 0.28) : H * 0.5;
	const dl = (8 + 5 * Math.sin(t * 0.5 * sp(env) + p.r * TAU)) * DEG * (p.right ? 1 : -1);
	const k2 = 1 / (Math.cos(Math.abs(dl)) + Math.sin(Math.abs(dl)));
	let hf = mn * (p.corner ? 0.22 : 0.37) * (p.big ? 1.1 : 1) * Math.SQRT2;
	for (let k = 0; k < K; k += 1, hf *= k2) {
		const e = ein(t, 0.45, k * 0.035, outCubic);
		if (e <= 0) continue;
		const rot = 45 * DEG + k * dl + t * 3 * DEG;
		const pts: X2Pt[] = [];
		for (let i = 0; i < 4; i += 1) {
			pts.push([
				cx + Math.cos(rot + (i * TAU) / 4) * hf * (0.85 + 0.15 * e),
				cy + Math.sin(rot + (i * TAU) / 4) * hf * (0.85 + 0.15 * e),
			]);
		}
		stroke(env, pts, c, (k % 4 === 0 ? 3 : 2) * u, 0.9 * o * e, { close: true });
	}
}

/** 重なる波 — three flat layers of filled waves rise from the bottom (or hang from the top) edge and roll at different speeds. */
function drawWaves(x: X2Part): void {
	const { env, p, t, o } = x;
	const { W, H } = env;
	const c = mixHex({ from: env.sc.bg, to: env.sc.fg, progress: 0.2 });
	const sy = p.low ? 1 : -1;
	const edge = p.low ? H + 4 : -4;
	const spd = sp(env);
	const n = 48;
	for (let k = 0; k < 3; k += 1) {
		const e = ein(t, 0.6, k * 0.08, outCubic) * o;
		const yb = H * (p.low ? 0.8 + 0.055 * k : 0.2 - 0.055 * k) + sy * (1 - e) * H * 0.26;
		const wl = W / (1.25 + 0.55 * k + 0.2 * p.n);
		const amp = H * 0.02 * (1 + 0.25 * k);
		const ph =
			t * (0.9 + 0.5 * k) * spd * (k % 2 ? -1 : 1) * (p.right ? 1 : -1) + k * 1.7 + p.r * 6;
		const pts: X2Pt[] = [[0, edge]];
		for (let i = 0; i <= n; i += 1) {
			const px = (W * i) / n;
			pts.push([
				px,
				yb + Math.sin((px / wl) * TAU + ph) * amp + Math.sin((px / wl) * TAU * 0.47 - ph * 0.6) * amp * 0.5,
			]);
		}
		pts.push([W, edge]);
		fillPoly(env, pts, c, 0.5);
	}
}
