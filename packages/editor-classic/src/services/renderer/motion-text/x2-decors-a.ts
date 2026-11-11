import { coreDecorTextBounds } from "./core-decor-geometry";
import { coreDecorPlan } from "./core-decor-timing";
import type { CoreDecorBounds, CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import { enterBOutBack } from "./enter-b-drawing";
import {
	degrees,
	inCubic,
	inOutCubic,
	outCubic,
	randomUnit,
	randomSigned,
	secondsOf,
	smoothNoise,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext, MotionTextPalette } from "./types";

/**
 * JIZURA x2decA — 30 line-work decor parts (frames, brackets, rules, measuring
 * and drafting marks that sit around the lyric), transliterated from
 * `11p_x2_decA.js` onto the rocut decor contract.
 *
 * Semantic simplifications shared with the other x2 ports: the canvas path
 * methods are the optional ones on `MotionTextCanvasContext` (line caps/joins
 * default to butt/miter, dash patterns are emulated by arc-length span
 * subdivision), all small text renders in the item font, and the beat/motion
 * clocks that JIZURA feeds from playback fall back to the packs' own no-signal
 * branches.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

interface X2Env {
	readonly ctx: MotionTextCanvasContext;
	readonly H: number;
	readonly W: number;
	readonly font: {
		readonly family: string;
		readonly style: string;
		readonly weight: number;
	};
	readonly lt: number;
	readonly ltb: number;
	readonly step: number;
	readonly motion: number;
	readonly seed: number;
	readonly sc: {
		readonly fg: string;
		readonly accent: string;
		readonly sub: string;
		readonly bg: string;
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

// eslint-disable-next-line opencut/prefer-object-params -- COL(env, p) mirrors the source pack's accent-vs-ink pick
function colOf(env: X2Env, p: X2Params): string {
	return p.accent ? env.sc.accent : env.sc.fg;
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

/** "along / across" axes of the lyric: tall boxes turn so along = y. */
interface X2Axes {
	readonly AM: number;
	readonly C0: number;
	readonly C1: number;
	readonly CM: number;
	readonly L0: number;
	readonly L1: number;
	readonly M: (along: number, across: number) => readonly [number, number];
	readonly vert: boolean;
}

// eslint-disable-next-line opencut/prefer-object-params
function axes(env: X2Env, bb: CoreDecorBounds, forceH = false): X2Axes {
	const vert = !forceH && bh(bb) > bw(bb) * 1.25;
	// eslint-disable-next-line opencut/prefer-object-params -- the axis mappers mirror the source pack's M(a, c)
	const flip = (a: number, c: number): X2Pt => [c, a];
	// eslint-disable-next-line opencut/prefer-object-params -- the axis mappers mirror the source pack's M(a, c)
	const keep = (a: number, c: number): X2Pt => [a, c];
	return vert
		? { vert, L0: bb.y0, L1: bb.y1, C0: bb.x0, C1: bb.x1, AM: env.H, CM: env.W, M: flip }
		: { vert, L0: bb.x0, L1: bb.x1, C0: bb.y0, C1: bb.y1, AM: env.W, CM: env.H, M: keep };
}

/** A free band of height h beside the lyric on the across axis (plus = below / right). */
interface X2SideBand {
	readonly c: number;
	readonly edge: number;
	readonly h: number;
	readonly room: number;
	readonly s: number;
}

// eslint-disable-next-line opencut/prefer-object-params
function sideBand(env: X2Env, ax: X2Axes, h: number, plus: boolean, gap: number): X2SideBand {
	const m = marginOf(env) * 0.5;
	const rp = ax.CM - m - (ax.C1 + gap);
	const rm = ax.C0 - gap - m;
	let s = plus ? 1 : -1;
	if ((s > 0 ? rp : rm) < h) {
		if ((s > 0 ? rm : rp) >= h) s = -s;
		else s = rp >= rm ? 1 : -1;
	}
	const room = Math.max(s > 0 ? rp : rm, 4);
	const hh = Math.min(h, room);
	const edge = s > 0 ? ax.C1 + gap : ax.C0 - gap;
	return { s, room, edge, c: edge + (s * hh) / 2, h: hh };
}

// eslint-disable-next-line opencut/prefer-object-params -- hit(x0, y0, x1, y1, bb, pad) mirrors the source pack's overlap test
function hit(x0: number, y0: number, x1: number, y1: number, bb: CoreDecorBounds, pad = 0): boolean {
	return !(x1 < bb.x0 - pad || x0 > bb.x1 + pad || y1 < bb.y0 - pad || y0 > bb.y1 + pad);
}

interface X2Spot {
	readonly ok: boolean;
	readonly x: number;
	readonly y: number;
}

/** A free w×h box near the lyric or in a screen corner. */
// eslint-disable-next-line opencut/prefer-object-params
function spot(env: X2Env, bb: CoreDecorBounds, w: number, h: number, p: X2Params, gap: number): X2Spot {
	const { W, H } = env;
	const m = marginOf(env) * 0.7;
	const sx = p.right ? 1 : -1;
	const sy = p.low ? 1 : -1;
	const ord: readonly (readonly [number, number])[] = [
		[sx, sy],
		[-sx, sy],
		[sx, -sy],
		[-sx, -sy],
	];
	const near: X2Pt[] = [];
	const cor: X2Pt[] = [];
	for (const [a, b] of ord) {
		near.push([a > 0 ? bb.x1 + gap : bb.x0 - gap - w, (bb.y0 + bb.y1) / 2 - h / 2]);
		near.push([a > 0 ? bb.x1 - w : bb.x0, b > 0 ? bb.y1 + gap : bb.y0 - gap - h]);
		cor.push([a > 0 ? W - m - w : m, b > 0 ? H - m - h : m]);
	}
	const all = p.corner ? [...cor, ...near] : [...near, ...cor];
	for (const [x, y] of all) {
		if (x < m - 1 || y < m - 1 || x + w > W - m + 1 || y + h > H - m + 1) continue;
		if (!hit(x, y, x + w, y + h, bb, gap * 0.4)) return { x, y, ok: true };
	}
	return {
		x: cl(cor[0]![0], 0, Math.max(0, W - w)),
		y: cl(cor[0]![1], 0, Math.max(0, H - h)),
		ok: false,
	};
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

/** JIZURA `segs`: a batch of disconnected segments in one stroke. */
// eslint-disable-next-line opencut/prefer-object-params -- segs(env, list, c, lw, a) mirrors the source pack's batch stroke
function segs(
	env: X2Env,
	list: readonly (readonly [number, number, number, number])[],
	c: string,
	lw: number,
	a = 1,
): void {
	if (a <= 0.003 || list.length === 0 || !(lw > 0)) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.strokeStyle = c;
	ctx.lineWidth = lw;
	ctx.beginPath();
	for (const s of list) {
		ctx.moveTo?.(s[0], s[1]);
		ctx.lineTo?.(s[2], s[3]);
	}
	ctx.stroke?.();
	ctx.restore();
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

interface X2LabelOptions {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly size?: number;
}

/** JIZURA `label`: small plain text (always the item font in this port). */
// eslint-disable-next-line opencut/prefer-object-params -- label(env, text, x, y, o) mirrors the source pack's call shape
function label(env: X2Env, text: string, x: number, y: number, options?: X2LabelOptions): void {
	const alpha = options?.alpha ?? 1;
	if (alpha <= 0.003 || text === "") return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, alpha);
	ctx.fillStyle = options?.color ?? env.sc.fg;
	ctx.textAlign = options?.align ?? "center";
	ctx.textBaseline = "middle";
	ctx.font = `${env.font.style} ${env.font.weight} ${Math.max(11, options?.size ?? Math.max(11, 15 * unitOf(env)))}px ${quoteFamily(env.font.family)}`;
	ctx.fillText(text, x, y);
	ctx.restore();
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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

/** Rounded rectangle as an open point list, clockwise from the top-left arc. */
// eslint-disable-next-line opencut/prefer-object-params -- rrectPts(x0, y0, x1, y1, r, n) mirrors the source pack
function rrectPts(x0: number, y0: number, x1: number, y1: number, r: number, n = 8): X2Pt[] {
	const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
	if (rr < 0.6) {
		return [
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
		];
	}
	const out: X2Pt[] = [];
	const cs: readonly (readonly [number, number, number])[] = [
		[x0 + rr, y0 + rr, 180],
		[x1 - rr, y0 + rr, 270],
		[x1 - rr, y1 - rr, 0],
		[x0 + rr, y1 - rr, 90],
	];
	for (const [cx, cy, a0] of cs) {
		for (let i = 0; i <= n; i += 1) {
			const a = degrees(a0 + (90 * i) / n);
			out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
		}
	}
	return out;
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

/** Quadratic bezier sampled into points (JIZURA `quad`). */
// eslint-disable-next-line opencut/prefer-object-params -- quad(a, b, c, n) mirrors the source pack
function quad(a: X2Pt, b: X2Pt, c: X2Pt, n = 10): X2Pt[] {
	const out: X2Pt[] = [];
	for (let i = 0; i <= n; i += 1) {
		const t = i / n;
		const k = 1 - t;
		out.push([
			k * k * a[0] + 2 * k * t * b[0] + t * t * c[0],
			k * k * a[1] + 2 * k * t * b[1] + t * t * c[1],
		]);
	}
	return out;
}

/** JIZURA `J.noise1(v, seed)`: deterministic smooth noise on this port's helper. */
// eslint-disable-next-line opencut/prefer-object-params -- noise1(v, seed) mirrors the source pack's argument order
function noise1(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

const X2_DECOR_A_IDS = new Set([
	"xlAccentTicks",
	"xlAngleMark",
	"xlArrowRules",
	"xlBezier",
	"xlBubbleLine",
	"xlCaliper",
	"xlCheckBox",
	"xlCompass",
	"xlCurlyBrace",
	"xlCutLine",
	"xlDashTrack",
	"xlDoubleRule",
	"xlEdgeTether",
	"xlFocusHunt",
	"xlGapFrame",
	"xlHairpin",
	"xlHandArrow",
	"xlHopCorners",
	"xlLadder",
	"xlLevel",
	"xlNestBracket",
	"xlPennant",
	"xlPlumb",
	"xlProtractor",
	"xlRepeatBars",
	"xlSeam",
	"xlSketchBox",
	"xlSlur",
	"xlTransformBox",
	"xlWingLines",
]);

export function drawX2DecorsA(
	options: CoreDecorDraw & { readonly layer: CoreDecorLayer },
): boolean {
	if (!X2_DECOR_A_IDS.has(options.decor)) return false;
	if (options.layer !== "front") return false;
	const part = decorPartOf(options);
	if (part) {
		switch (options.decor) {
			case "xlAccentTicks":
				drawAccentTicks(part);
				break;
			case "xlAngleMark":
				drawAngleMark(part);
				break;
			case "xlArrowRules":
				drawArrowRules(part);
				break;
			case "xlBezier":
				drawBezier(part);
				break;
			case "xlBubbleLine":
				drawBubbleLine(part);
				break;
			case "xlCaliper":
				drawCaliper(part);
				break;
			case "xlCheckBox":
				drawCheckBox(part);
				break;
			case "xlCompass":
				drawCompass(part);
				break;
			case "xlCurlyBrace":
				drawCurlyBrace(part);
				break;
			case "xlCutLine":
				drawCutLine(part);
				break;
			case "xlDashTrack":
				drawDashTrack(part);
				break;
			case "xlDoubleRule":
				drawDoubleRule(part);
				break;
			case "xlEdgeTether":
				drawEdgeTether(part);
				break;
			case "xlFocusHunt":
				drawFocusHunt(part);
				break;
			case "xlGapFrame":
				drawGapFrame(part);
				break;
			case "xlHairpin":
				drawHairpin(part);
				break;
			case "xlHandArrow":
				drawHandArrow(part);
				break;
			case "xlHopCorners":
				drawHopCorners(part);
				break;
			case "xlLadder":
				drawLadder(part);
				break;
			case "xlLevel":
				drawLevel(part);
				break;
			case "xlNestBracket":
				drawNestBracket(part);
				break;
			case "xlPennant":
				drawPennant(part);
				break;
			case "xlPlumb":
				drawPlumb(part);
				break;
			case "xlProtractor":
				drawProtractor(part);
				break;
			case "xlRepeatBars":
				drawRepeatBars(part);
				break;
			case "xlSeam":
				drawSeam(part);
				break;
			case "xlSketchBox":
				drawSketchBox(part);
				break;
			case "xlSlur":
				drawSlur(part);
				break;
			case "xlTransformBox":
				drawTransformBox(part);
				break;
			case "xlWingLines":
				drawWingLines(part);
				break;
		}
	}
	return true;
}

/**
 * The pack's `D` wrapper: main-pass line work that waits until the entrance
 * has mostly settled (rocut has no per-cut inDur, so the wait is zero) and
 * fades out with the cut.
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
		font: {
			family: draw.frame.font.family,
			style: draw.frame.font.style,
			weight: draw.frame.font.weight,
		},
		lt,
		ltb: lt,
		step: Math.floor(lt * 60),
		motion: 1,
		seed: plan.seed,
		sc: {
			fg: palette.foreground,
			accent: palette.accent,
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

/* ============================================================ frames */

/** 途切れ枠 — a frame drawn on by one pen stroke, broken by 2–4 gaps that keep travelling round it. */
function drawGapFrame(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u, 1.15));
	const c = colOf(env, p);
	let pts: X2Pt[] = [
		[f.x0, f.y0],
		[f.x1, f.y0],
		[f.x1, f.y1],
		[f.x0, f.y1],
	];
	pts = pts.slice(p.v % 4).concat(pts.slice(0, p.v % 4));
	if (!p.right) pts = [pts[0]!].concat(pts.slice(1).reverse());
	const pa = mk(pts, true);
	const k = p.n + 1;
	const e = ein(t, 0.55, 0, inOutCubic);
	const cell = pa.L / k;
	const gap = lerpN(cell, cl(pa.L * 0.045, 18 * u, 64 * u), o);
	const mv = env.ltb * 26 * u * (0.5 + env.motion);
	stroke(
		env,
		e >= 1 ? pa.pts : span(pa, 0, pa.L * e),
		c,
		3 * u,
		Math.min(1, o * 1.6),
		{ dash: [Math.max(0.01, cell - gap), gap], off: -mv, close: true },
	);
	if (p.big) {
		const d = 9 * u;
		const pb = mk(
			pts.map((q) => [
				q[0] + (q[0] < f.cx ? -d : d),
				q[1] + (q[1] < f.cy ? -d : d),
			]),
			true,
		);
		const e2 = ein(t, 0.55, 0.15, inOutCubic);
		stroke(
			env,
			e2 >= 1 ? pb.pts : span(pb, 0, pb.L * e2),
			env.sc.sub,
			1.1 * u,
			0.7 * o,
			{ dash: [Math.max(0.01, pb.L / k - gap), gap], off: mv + pb.L / k / 2, close: true },
		);
	}
}

/** 巡る角 — one or two corner marks that hop from corner to corner along the frame, bending round each corner. */
function drawHopCorners(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u));
	const c = colOf(env, p);
	const pa = mk(
		[
			[f.x0, f.y0],
			[f.x1, f.y0],
			[f.x1, f.y1],
			[f.x0, f.y1],
		],
		true,
	);
	const S = pa.cum;
	const T = 0.85;
	const k = Math.floor(t / T);
	const fr = inOutCubic(cl((t - k * T) / 0.4)) * (env.motion > 0.05 ? 1 : 0);
	const dir = p.right ? 1 : -1;
	const arm =
		(Math.min(f.w, f.h) * 0.2 + 10 * u) * ein(t, 0.35) * (1 + 0.7 * Math.sin(Math.PI * fr)) * o;
	for (let j = 0; j < (p.n >= 2 ? 2 : 1); j += 1) {
		const a = mod((env.motion > 0.05 ? k : 0) * dir + j * 2 + p.v, 4);
		const sA = S[a]!;
		const len =
			dir > 0 ? S[a + 1]! - S[a]! : S[mod(a - 1, 4) + 1]! - S[mod(a - 1, 4)]!;
		const s = sA + dir * len * fr;
		stroke(env, span(pa, s - arm, s + arm, true), c, 3.6 * u, 1, { close: true });
	}
	for (let i = 0; i < 4; i += 1) {
		dot(env, pa.pts[i]![0], pa.pts[i]![1], 2.4 * u, env.sc.sub, 0.7 * o * ein(t, 0.3, i * 0.05));
	}
}

/** 下描き枠 — a pencil-sketched box: four overshooting strokes gone over twice, lightly boiling. */
function drawSketchBox(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u, 1.1));
	const c = colOf(env, p);
	const boil = Math.floor(t * 4);
	const sd = p.seed;
	const ed: readonly (readonly [number, number, number, number])[] = [
		[f.x0, f.y0, f.x1, f.y0],
		[f.x1, f.y0, f.x1, f.y1],
		[f.x1, f.y1, f.x0, f.y1],
		[f.x0, f.y1, f.x0, f.y0],
	];
	for (let ps = 0; ps < 2; ps += 1) {
		for (let k = 0; k < 4; k += 1) {
			const e = ein(t, 0.24, k * 0.12 + ps * 0.5, inOutCubic);
			if (e <= 0) continue;
			const [ax, ay, bx, by] = ed[k]!;
			const L = Math.hypot(bx - ax, by - ay) || 1;
			const dx = (bx - ax) / L;
			const dy = (by - ay) / L;
			const nx = -dy;
			const ny = dx;
			const o0 = (6 + 14 * randomUnit(sd, k, ps, 1)) * u;
			const o1 = (6 + 14 * randomUnit(sd, k, ps, 2)) * u;
			const pts: X2Pt[] = [];
			for (let i = 0; i <= 6; i += 1) {
				const s = i / 6;
				const a = -o0 + (L + o0 + o1) * s;
				const j =
					(randomSigned(sd, k, ps, i, 3) * 2.6 +
						randomSigned(sd, k, ps, i, boil, 4) * 1.1 * env.motion +
						(ps ? 3 : -1) * Math.sin(s * Math.PI) +
						randomSigned(sd, k, ps, 5) * 4 * (s - 0.5)) *
					u;
				pts.push([ax + dx * a + nx * j, ay + dy * a + ny * j]);
			}
			const pa = mk(pts);
			stroke(env, span(pa, pa.L * (1 - o), pa.L * e), c, (ps ? 1.8 : 2.8) * u, (ps ? 0.6 : 0.95) * Math.min(1, o * 2));
		}
	}
}

/** 破線トラック — a dashed racetrack (stadium) round the lyric with a start line and a runner lapping it. */
function drawDashTrack(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u, 1.7));
	const dir = p.right ? 1 : -1;
	const pa = mk(rrectPts(f.x0, f.y0, f.x1, f.y1, Math.min(f.w, f.h) / 2, 10), true);
	const e = ein(t, 0.6, 0, inOutCubic);
	stroke(env, e >= 1 ? pa.pts : span(pa, 0, pa.L * e), env.sc.fg, 2.2 * u, 0.9 * o, {
		dash: [11 * u, 8 * u],
		close: true,
	});
	const s0 = pa.L * 0.07;
	const st = at(pa, s0);
	const nx = -Math.sin(st[2]);
	const ny = Math.cos(st[2]);
	const g = ein(t, 0.25, 0.1) * 11 * u;
	segs(
		env,
		[
			[st[0] - nx * g, st[1] - ny * g, st[0] + nx * g, st[1] + ny * g],
			[
				st[0] - nx * g + Math.cos(st[2]) * 4 * u,
				st[1] - ny * g + Math.sin(st[2]) * 4 * u,
				st[0] + nx * g + Math.cos(st[2]) * 4 * u,
				st[1] + ny * g + Math.sin(st[2]) * 4 * u,
			],
		],
		env.sc.fg,
		1.6 * u,
		o,
	);
	const ra = ein(t, 0.25, 0.45) * o;
	if (ra <= 0) return;
	const s = s0 + dir * Math.max(0, t - 0.45) * (90 + 160 * env.motion) * u;
	const q = at(pa, mod(s, pa.L));
	const c = env.sc.accent;
	stroke(
		env,
		span(pa, Math.min(s, s - dir * 80 * u), Math.max(s, s - dir * 80 * u), true),
		c,
		4 * u,
		ra,
		{ close: true },
	);
	const an = q[2] + (dir < 0 ? Math.PI : 0);
	const r = 13 * u;
	fillPoly(
		env,
		[0, 2.5, -2.5].map((k2) => [
			q[0] + Math.cos(an + k2) * r * (k2 ? 0.9 : 1.3),
			q[1] + Math.sin(an + k2) * r * (k2 ? 0.9 : 1.3),
		]),
		c,
		ra,
	);
}

/** 吹き出し線 — the lyric inside a hand-lettered speech balloon outline with a tail (or thought bubbles). */
function drawBubbleLine(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const pop = lerpN(0.9, 1, oBack(cl(t / 0.4), 2));
	const f0 = frameRect(env, bb, padOf(bb, u, 1.5));
	const c = colOf(env, p);
	const m = marginOf(env) * 0.35;
	const f = {
		x0: f0.cx - (f0.w / 2) * pop,
		x1: f0.cx + (f0.w / 2) * pop,
		y0: f0.cy - (f0.h / 2) * pop,
		y1: f0.cy + (f0.h / 2) * pop,
	};
	const r = Math.min(f0.h * 0.38, 44 * u, f0.w / 2);
	const rb = env.H - m - f0.y1;
	const rt = f0.y0 - m;
	let side = p.low
		? rb >= 22 * u
			? 1
			: rt >= 22 * u
				? -1
				: 0
		: rt >= 22 * u
			? -1
			: rb >= 22 * u
				? 1
				: 0;
	const tw = Math.min(46 * u, (f0.w - 2 * r) * 0.6);
	if (tw < 10 * u) side = 0;
	const tl = Math.min((side > 0 ? rb : rt) * 0.8, 64 * u);
	const tx = cl(f0.cx + (p.right ? 0.2 : -0.2) * f0.w, f.x0 + r + tw / 2, f.x1 - r - tw / 2);
	const sk = (p.right ? 1 : -1) * 26 * u;
	const thought = p.v % 2 === 1;
	// eslint-disable-next-line opencut/prefer-object-params -- C(cx, cy, a0) mirrors the source pack's corner-arc closure
	const C = (cx: number, cy: number, a0: number): X2Pt[] =>
		arcPts(cx, cy, r, degrees(a0), degrees(a0 + 90), 8);
	let pts: X2Pt[] = C(f.x0 + r, f.y0 + r, 180);
	if (side < 0 && !thought) {
		pts = pts.concat([
			[tx - tw / 2, f.y0],
			[tx + sk, f.y0 - tl],
			[tx + tw / 2, f.y0],
		]);
	}
	pts = pts.concat(C(f.x1 - r, f.y0 + r, 270), C(f.x1 - r, f.y1 - r, 0));
	if (side > 0 && !thought) {
		pts = pts.concat([
			[tx + tw / 2, f.y1],
			[tx + sk, f.y1 + tl],
			[tx - tw / 2, f.y1],
		]);
	}
	pts = pts.concat(C(f.x0 + r, f.y1 - r, 90));
	const pa = mk(pts, true);
	const e = ein(t, 0.55, 0, inOutCubic);
	stroke(env, e >= 1 ? pa.pts : span(pa, 0, pa.L * e), c, 3.2 * u, Math.min(1, o * 1.5), {
		close: true,
	});
	if (thought && side) {
		const y = side > 0 ? f.y1 : f.y0;
		const bubbles: readonly (readonly [number, number])[] = [
			[0.28, 13],
			[0.66, 8.5],
			[1, 5],
		];
		bubbles.forEach(([k2, rr], i) => {
			ring(
				env,
				tx + sk * k2 * 1.4,
				y + side * tl * k2,
				rr * u * oBack(cl((t - 0.35 - i * 0.1) / 0.25), 2),
				c,
				2.2 * u,
				o,
			);
		});
	}
}

/** 変形ハンドル — a design-tool transform box dragged open from one corner: marching ants, eight handles, a rotate stalk and a size readout. */
function drawTransformBox(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u));
	const e = ein(t, 0.5);
	const sc = env.sc;
	const m = marginOf(env) * 0.35;
	const x0 = f.x0;
	const y0 = f.y0;
	const x1 = lerpN(f.x0 + 24 * u, f.x1, e);
	const y1 = lerpN(f.y0 + 24 * u, f.y1, e);
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	stroke(
		env,
		[
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
		],
		sc.fg,
		1.6 * u,
		0.9 * o,
		{ dash: [7 * u, 5 * u], off: -env.ltb * 18 * u, close: true },
	);
	const hs = 6 * u;
	const ha = ein(t, 0.2, 0.1) * o;
	for (const [hx, hy] of [
		[x0, y0],
		[cx, y0],
		[x1, y0],
		[x1, cy],
		[x1, y1],
		[cx, y1],
		[x0, y1],
		[x0, cy],
	] as const) {
		fillRect(env, hx - hs, hy - hs, hs * 2, hs * 2, sc.bg, ha);
		stroke(
			env,
			[
				[hx - hs, hy - hs],
				[hx + hs, hy - hs],
				[hx + hs, hy + hs],
				[hx - hs, hy + hs],
			],
			sc.fg,
			1.5 * u,
			ha,
			{ close: true },
		);
	}
	const up = y0 - 34 * u > m;
	const ry = up ? y0 - 28 * u * e : y1 + 28 * u * e;
	segs(env, [[cx, up ? y0 - hs : y1 + hs, cx, ry]], sc.fg, 1.2 * u, ha);
	ring(env, cx, ry, 5 * u, env.sc.accent, 1.8 * u, ha);
	const below = y1 + 30 * u < env.H - m;
	label(env, `${Math.round(x1 - x0)} × ${Math.round(y1 - y0)}`, x1, below ? y1 + 18 * u : y0 - 18 * u, {
		align: "right",
		size: Math.max(11, 16 * u),
		color: p.accent ? env.sc.accent : sc.sub,
		alpha: ein(t, 0.3, 0.15) * o,
	});
	const ca = (1 - ein(t, 0.3, 0.55, inCubic)) * o;
	if (ca > 0.01) {
		fillPoly(
			env,
			[
				[x1 + 4 * u, y1 + 4 * u],
				[x1 + 4 * u, y1 + 24 * u],
				[x1 + 9.5 * u, y1 + 18.5 * u],
				[x1 + 18 * u, y1 + 18 * u],
			],
			sc.fg,
			ca,
		);
	}
}

/** ピント枠 — autofocus corners with rounded bends that hunt in and out, then lock with a confirm dot. */
function drawFocusHunt(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const f = frameRect(env, bb, padOf(bb, u, 1.35));
	const a = ein(t, 0.25, 0, outCubic) * o;
	const hunt =
		1 +
		(0.2 * Math.exp(-t * 4.5) * Math.cos(t * 15) + 0.3 * (1 - ein(t, 0.3))) *
			(0.35 + 0.65 * env.motion);
	const hw = (f.w / 2) * hunt;
	const hh = (f.h / 2) * hunt;
	const rr = cl(Math.min(f.w, f.h) * 0.24, 12 * u, 48 * u);
	const lock = t > 0.78;
	const c = lock ? env.sc.accent : env.sc.fg;
	const lw = 2.8 * u;
	for (const [sx, sy, a0] of [
		[-1, -1, 180],
		[1, -1, 270],
		[1, 1, 0],
		[-1, 1, 90],
	] as const) {
		const cx = f.cx + sx * (hw - rr);
		const cy = f.cy + sy * (hh - rr);
		stroke(env, arcPts(cx, cy, rr, degrees(a0), degrees(a0 + 90)), c, lw, a);
	}
	const tk = 9 * u;
	segs(
		env,
		[
			[f.cx, f.cy - hh, f.cx, f.cy - hh - tk],
			[f.cx, f.cy + hh, f.cx, f.cy + hh + tk],
			[f.cx - hw, f.cy, f.cx - hw - tk, f.cy],
			[f.cx + hw, f.cy, f.cx + hw + tk, f.cy],
		],
		c,
		1.4 * u,
		a,
	);
	if (lock) {
		const bl = t < 1.25 ? (Math.floor((t - 0.78) * 10) % 2 === 0 ? 1 : 0.2) : 1;
		const dx = cl(p.right ? f.cx + hw + 14 * u : f.cx - hw - 14 * u, 8 * u, env.W - 8 * u);
		dot(env, dx, f.cy + (p.low ? 1 : -1) * (hh - rr * 0.4), 5.5 * u, c, bl * o);
	}
}

/* ============================================================ brackets */

/** 波括弧 — large curly braces that unfurl from their cusps at both ends of the lyric. */
function drawCurlyBrace(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const m = marginOf(env) * 0.3;
	const c0 = ax.C0 - 8 * u;
	const c1 = ax.C1 + 8 * u;
	const sp = c1 - c0;
	const mid = (c0 + c1) / 2;
	const g = 22 * u;
	const e = ein(t, 0.55);
	const ea = Math.min(e, o);
	for (const sd of [-1, 1]) {
		const base = sd < 0 ? ax.L0 - g : ax.L1 + g;
		const room = sd < 0 ? base - m : ax.AM - m - base;
		const d = Math.min(cl(sp * 0.13, 10 * u, 38 * u), Math.max(5 * u, room / 2));
		const q = Math.min(d * 1.4, sp / 4);
		const sl = (1 - e) * 36 * u;
		const X = (v: number): number => base + sd * (v + sl);
		const raw = quad([X(0), c0], [X(d), c0], [X(d), c0 + q], 6)
			.concat(
				quad([X(d), mid - q], [X(d), mid], [X(2 * d), mid], 6),
				quad([X(2 * d), mid], [X(d), mid], [X(d), mid + q], 6),
				quad([X(d), c1 - q], [X(d), c1], [X(0), c1], 6),
			)
			.map((v) => ax.M(v[0], v[1]));
		const pa = mk(raw);
		stroke(env, span(pa, pa.L * (0.5 - ea / 2), pa.L * (0.5 + ea / 2)), c, (p.big ? 4 : 3) * u, Math.min(1, o * 2));
	}
}

/** 重ね括弧 — three nested square brackets on each side, fanning outward, a pulse running through them. */
function drawNestBracket(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const mid = (ax.C0 + ax.C1) / 2;
	const sp = ax.C1 - ax.C0;
	const m = marginOf(env) * 0.3;
	for (const sd of [-1, 1]) {
		for (let k = 0; k < 3; k += 1) {
			const e = ein(t, 0.4, k * 0.07);
			if (e <= 0) continue;
			const a = cl(
				(sd < 0 ? ax.L0 : ax.L1) +
					sd * (28 * u + k * 18 * u + (1 - e) * 60 * u + (1 - o) * 30 * u),
				m,
				ax.AM - m,
			);
			const hk = (sp * (1 - k * 0.2)) / 2 + 8 * u;
			const arm = 14 * u;
			const pulse = Math.max(0, Math.sin(t * 3.4 - k * 0.9)) ** 2;
			stroke(
				env,
				[
					[a - sd * arm, mid - hk],
					[a, mid - hk],
					[a, mid + hk],
					[a - sd * arm, mid + hk],
				].map((v) => ax.M(v[0], v[1])),
				c,
				(4.6 - k * 1.2) * u,
				e * o * (0.5 + 0.5 * pulse),
			);
		}
	}
}

/** 反復記号 — musical repeat signs: thick + thin bar lines and two dots enclosing the lyric. */
function drawRepeatBars(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const mid = (ax.C0 + ax.C1) / 2;
	const sp = ax.C1 - ax.C0;
	const hh = sp / 2 + 8 * u;
	const m = marginOf(env) * 0.3;
	const bt = Math.max(0, Math.sin(t * 5)) ** 6 * 0.6;
	for (const sd of [-1, 1]) {
		const base = sd < 0 ? ax.L0 : ax.L1;
		const X = (d: number): number => cl(base + sd * d * u, m, ax.AM - m);
		const e1 = ein(t, 0.35, 0.05) * o;
		const e2 = ein(t, 0.35, 0.15) * o;
		const ed = oBack(cl((t - 0.3) / 0.25), 2.5) * o;
		segs(
			env,
			[[...ax.M(X(38), mid - hh * e1), ...ax.M(X(38), mid + hh * e1)]],
			c,
			2.2 * u,
			1,
		);
		segs(
			env,
			[[...ax.M(X(52), mid - hh * e2), ...ax.M(X(52), mid + hh * e2)]],
			c,
			9 * u,
			1,
		);
		for (const dy of [-1, 1]) {
			const q = ax.M(X(20), mid + dy * Math.max(10 * u, sp * 0.14));
			dot(env, q[0], q[1], 6 * u * ed * (1 + 0.4 * bt * env.motion), env.sc.accent, 1);
		}
	}
}

/* ============================================================ rules, underlines, overlines */

/** 太細罫 — thick-and-thin "Oxford" rules above and below: the thick ones open from the centre, the thin ones run in from opposite ends. */
function drawDoubleRule(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const m = marginOf(env) * 0.4;
	const ext = 26 * u + (p.big ? (ax.L1 - ax.L0) * 0.1 : 0);
	const a0 = Math.max(m, ax.L0 - ext);
	const a1 = Math.min(ax.AM - m, ax.L1 + ext);
	const am = (a0 + a1) / 2;
	const g = 16 * u + (ax.C1 - ax.C0) * 0.1;
	const sep = 10 * u;
	const v = p.v % 3;
	const cT = Math.max(m + sep, ax.C0 - g);
	const cB = Math.min(ax.CM - m - sep, ax.C1 + g);
	const e1 = ein(t, 0.5) * o;
	const e2 = ein(t, 0.5, 0.12, inOutCubic);
	const k = v === 1 ? 0.5 : 1;
	// eslint-disable-next-line opencut/prefer-object-params -- S(x0, c0, x1) mirrors the source pack's rule-segment closure
	const S = (x0: number, c0: number, x1: number): readonly [number, number, number, number] => [
		...ax.M(x0, c0),
		...ax.M(x1, c0),
	];
	segs(
		env,
		[
			S(am - (am - a0) * e1 * k, cT - sep, am + (a1 - am) * e1 * k),
			S(am - (am - a0) * e1 * k, cB + sep, am + (a1 - am) * e1 * k),
		],
		c,
		7 * u,
		1,
	);
	segs(
		env,
		[
			S(lerpN(a0, a1, 1 - o), cT, lerpN(a0, a1, e2)),
			S(lerpN(a1, a0, 1 - o), cB, lerpN(a1, a0, e2)),
		],
		c,
		1.8 * u,
		o,
	);
	if (v === 2) {
		for (const [a, cc] of [
			[a0, cT],
			[a1, cT],
			[a0, cB],
			[a1, cB],
		] as const) {
			const q = ax.M(a, cc);
			const r = 5 * u * oBack(cl((t - 0.45) / 0.25), 2) * o;
			fillPoly(
				env,
				[
					[q[0] - r, q[1]],
					[q[0], q[1] - r],
					[q[0] + r, q[1]],
					[q[0], q[1] + r],
				],
				env.sc.accent,
				1,
			);
		}
	}
}

/** 往復矢印 — an arrow shoots along under the lyric, a second one answers above in the opposite direction. */
function drawArrowRules(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const m = marginOf(env) * 0.5;
	const g = 22 * u + (ax.C1 - ax.C0) * 0.08;
	const a0 = Math.max(m, ax.L0 - 30 * u);
	const a1 = Math.min(ax.AM - m, ax.L1 + 30 * u);
	const fl = p.right ? 1 : -1;
	const one = p.v % 3 === 2;
	const rows: readonly (readonly [number, number, number])[] = [
		[Math.min(ax.CM - m, ax.C1 + g), fl, 0],
		[Math.max(m, ax.C0 - g), -fl, 0.2],
	];
	for (const [cc, dir, dl] of one ? [rows[p.low ? 0 : 1]!] : rows) {
		const e = ein(t, 0.5, dl);
		if (e <= 0) continue;
		const from = dir > 0 ? a0 : a1;
		const to = dir > 0 ? a1 : a0;
		const hd = lerpN(from, to, e);
		const tl = lerpN(hd, from, o);
		const hs = 20 * u * Math.min(1, e * 3);
		const H = ax.M(hd, cc);
		const T = ax.M(tl, cc);
		const w1 = ax.M(hd - dir * hs, cc - hs * 0.62);
		const w2 = ax.M(hd - dir * hs, cc + hs * 0.62);
		segs(env, [[T[0], T[1], H[0], H[1]]], c, 3 * u, o);
		stroke(env, [w1, H, w2], c, 3 * u, o);
		const b1 = ax.M(tl, cc - 10 * u);
		const b2 = ax.M(tl, cc + 10 * u);
		segs(env, [[b1[0], b1[1], b2[0], b2[1]]], c, 3 * u, o);
		if (one) {
			const d1 = ax.M(tl, cc + 7 * u * (p.low ? 1 : -1));
			const d2 = ax.M(hd - dir * hs, cc + 7 * u * (p.low ? 1 : -1));
			segs(env, [[d1[0], d1[1], d2[0], d2[1]]], c, 1.2 * u, o * 0.8);
		}
	}
}

/** クレッシェンド — a musical hairpin opening (or closing) along the lyric, with p / f at its ends. */
function drawHairpin(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const len = ax.L1 - ax.L0;
	const m = marginOf(env) * 0.5;
	const hp = cl(len * 0.07, 30 * u, 84 * u);
	const b = sideBand(env, ax, hp + 8 * u, !ax.vert || p.low, 18 * u + (ax.C1 - ax.C0) * 0.06);
	const dec = p.v % 2 === 1;
	const e = ein(t, 0.65, 0, outCubic);
	const open =
		(Math.max(4 * u, Math.min(hp, b.h - 6 * u)) / 2) *
		(0.88 + 0.12 * Math.sin(t * 2.2) * env.motion);
	const A = dec ? ax.L1 : ax.L0;
	const B = dec ? ax.L0 : ax.L1;
	const px = lerpN(A, B, e);
	const xs = lerpN(A, B, 1 - o);
	// eslint-disable-next-line opencut/prefer-object-params -- S(x0, c0, x1, c1) mirrors the source pack's hairpin-segment closure
	const S = (
		x0: number,
		c0: number,
		x1: number,
		c1: number,
	): readonly [number, number, number, number] => [...ax.M(x0, c0), ...ax.M(x1, c1)];
	segs(
		env,
		[
			S(xs, b.c - open * (1 - o), px, b.c - open * e),
			S(xs, b.c + open * (1 - o), px, b.c + open * e),
		],
		c,
		2.6 * u,
		Math.min(1, o * 2),
	);
	const fs = Math.max(16, 30 * u);
	const la = ein(t, 0.3, 0.35) * o;
	if (ax.L0 - fs * 1.4 > m) {
		const q = ax.M(ax.L0 - fs * 0.8, b.c);
		label(env, dec ? "f" : "p", q[0], q[1], { size: fs, color: c, alpha: la });
	}
	if (ax.L1 + fs * 1.4 < ax.AM - m) {
		const q = ax.M(ax.L1 + fs * 0.8, b.c);
		label(env, dec ? "p" : "f", q[0], q[1], { size: fs, color: c, alpha: la });
	}
}

/** スラー — a tapered slur arc swept over the lyric from its first glyph to its last. */
function drawSlur(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const len = ax.L1 - ax.L0;
	const hs = cl(len * 0.07, 16 * u, 56 * u);
	const dash = p.v % 2 === 1;
	const sides = p.big ? [false, true] : [p.low];
	sides.forEach((plus, si) => {
		const b = sideBand(env, ax, hs + 6 * u, plus, 10 * u + (ax.C1 - ax.C0) * 0.05);
		if (si && b.s !== (plus ? 1 : -1)) return;
		const h = Math.min(hs, b.h);
		const a0 = ax.L0 + len * 0.03;
		const a1 = ax.L1 - len * 0.03;
		const e = ein(t, 0.6, si * 0.15, inOutCubic);
		const n = 28;
		const th = 7 * u;
		const s0 = si ? 1 - e : 1 - o;
		const s1 = si ? o : e;
		if (s1 <= s0) return;
		const out: X2Pt[] = [];
		const inn: X2Pt[] = [];
		for (let i = 0; i <= n; i += 1) {
			const s = lerpN(s0, s1, i / n);
			const y = 4 * s * (1 - s);
			out.push(ax.M(lerpN(a0, a1, s), b.edge + b.s * h * y));
			inn.push(
				ax.M(lerpN(a0, a1, s), b.edge + b.s * (h * y - th * Math.sin(Math.PI * s))),
			);
		}
		if (dash) {
			stroke(env, out, c, 2.8 * u, o, { dash: [12 * u, 8 * u] });
		} else {
			fillPoly(env, out.concat(inn.reverse()), c, Math.min(1, o * 2));
			stroke(env, out, c, 1 * u, Math.min(1, o * 2));
		}
	});
}

/** はしご罫 — a ladder rule: two rails with rungs laid one by one, one lit rung climbing along it. */
function drawLadder(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const b = sideBand(env, ax, 26 * u, p.low, 16 * u + (ax.C1 - ax.C0) * 0.08);
	const m = marginOf(env) * 0.5;
	const a0 = Math.max(m, ax.L0 - 10 * u);
	const a1 = Math.min(ax.AM - m, ax.L1 + 10 * u);
	const hw = Math.min(12 * u, b.h / 2);
	const e = ein(t, 0.6, 0, outCubic);
	const step = Math.max(26 * u, (a1 - a0) / 110);
	const n = Math.max(1, Math.floor((a1 - a0) / step));
	const st = (a1 - a0) / n;
	const dir = p.right ? -1 : 1;
	const x0 = dir > 0 ? a0 : a1;
	const xe = x0 + dir * (a1 - a0) * e;
	const xo = x0 + dir * (a1 - a0) * (1 - o);
	// eslint-disable-next-line opencut/prefer-object-params -- S(v, c0, v2, c1) mirrors the source pack's rung-segment closure
	const S = (
		v: number,
		c0: number,
		v2: number,
		c1: number,
	): readonly [number, number, number, number] => [...ax.M(v, c0), ...ax.M(v2, c1)];
	segs(
		env,
		[S(xo, b.c - hw, xe, b.c - hw), S(xo, b.c + hw, xe, b.c + hw)],
		env.sc.fg,
		2 * u,
		0.9 * o,
	);
	const list: (readonly [number, number, number, number])[] = [];
	const lit = Math.floor(t * (5 + 8 * env.motion)) % (n + 1);
	for (let i = 0; i <= n; i += 1) {
		if (i / n > e || i / n < 1 - o) continue;
		const v = x0 + dir * i * st;
		list.push(S(v, b.c - hw, v, b.c + hw));
	}
	segs(env, list, env.sc.fg, 1.6 * u, 0.8 * o);
	for (let k = 0; k < 3; k += 1) {
		const i = lit - k;
		if (i < 0 || i / n > e) continue;
		const v = x0 + dir * i * st;
		segs(env, [S(v, b.c - hw - 3 * u, v, b.c + hw + 3 * u)], env.sc.accent, 4 * u, o * (1 - k * 0.35));
	}
}

/** 翼の線 — feathered stacks of parallel lines shooting out from both ends of the lyric like wings. */
function drawWingLines(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const c = colOf(env, p);
	const m = marginOf(env) * 0.5;
	const mid = (ax.C0 + ax.C1) / 2;
	const sp = ax.C1 - ax.C0;
	const len = ax.L1 - ax.L0;
	const K = 5;
	const gc = cl(sp / 6, 9 * u, 22 * u);
	const sym = p.v % 2 === 1;
	for (const sd of [-1, 1]) {
		const base = (sd < 0 ? ax.L0 : ax.L1) + sd * 16 * u;
		const room = sd < 0 ? base - m : ax.AM - m - base;
		const Lm = Math.min(room, len * 0.25 + 70 * u, 260 * u);
		if (Lm < 22 * u) continue;
		const list: (readonly [number, readonly [number, number, number, number]])[] = [];
		for (let i = 0; i < K; i += 1) {
			const e = ein(t, 0.45, i * 0.05);
			if (e <= 0) continue;
			const f = sym ? 1 - Math.abs(i - 2) * 0.3 : 1 - i * 0.17;
			const L =
				Lm * f * (1 + 0.07 * Math.sin(t * 3 - i * 0.7) * env.motion);
			const cc = mid + (i - 2) * gc;
			const hd = base + sd * L * e;
			const tl = lerpN(hd, base, o);
			list.push([i, [...ax.M(tl, cc), ...ax.M(hd, cc)]]);
		}
		for (const [i, s] of list) {
			segs(
				env,
				[s],
				i === (sym ? 2 : 0) && p.accent ? env.sc.accent : c,
				(sym ? 4 - Math.abs(i - 2) * 0.8 : 4.2 - i * 0.55) * u,
				Math.min(1, o * 2),
			);
		}
	}
}

/* ============================================================ measuring & drafting */

/** ノギス — a vernier caliper: a graduated beam, a fixed jaw and a sliding jaw that closes on the lyric's width. */
function drawCaliper(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const m = marginOf(env) * 0.45;
	const hB = 22 * u;
	const c = env.sc.fg;
	const len = ax.L1 - ax.L0;
	const sp = ax.C1 - ax.C0;
	const M = ax.M;
	const b = sideBand(env, ax, hB + 36 * u, p.low, 18 * u + sp * 0.06);
	const s = b.s;
	const ci = b.edge;
	const co = b.edge + s * hB;
	const jl = 18 * u + sp * 0.06 + Math.min(sp * 0.45, 80 * u);
	const a = ein(t, 0.3, 0, outCubic) * o;
	const sw = 44 * u;
	const xa = Math.max(m + 14 * u, ax.L0 - 10 * u);
	const xbT = Math.min(ax.AM - m - sw, ax.L1 + 10 * u);
	const xb = lerpN(
		Math.min(ax.AM - m - sw, xbT + Math.max(140 * u, len * 0.35)),
		xbT,
		oBack(cl((t - 0.15) / 0.55), 1.1),
	);
	const X0 = xa - 14 * u;
	const X1 = lerpN(X0, Math.min(ax.AM - m, xbT + 110 * u), ein(t, 0.45));
	stroke(
		env,
		[M(X1, ci), M(X0, ci), M(X0, co), M(X1, co), M(X1, ci)],
		c,
		1.8 * u,
		a,
		{ close: true },
	);
	const tk: (readonly [number, number, number, number])[] = [];
	for (let i = 0, v = xa; v < X1 - 2 * u && i < 240; i += 1, v += 11 * u) {
		tk.push([...M(v, ci), ...M(v, ci + s * (i % 5 ? 6 : 12) * u)]);
	}
	segs(env, tk, c, 1.2 * u, 0.8 * a);
	// eslint-disable-next-line opencut/prefer-object-params -- jaw(v, d) mirrors the source pack's caliper-jaw closure
	const jaw = (v: number, d: number): X2Pt[] => [
		M(v - d * 13 * u, ci),
		M(v - d * 13 * u, ci - s * jl * 0.55),
		M(v, ci - s * jl),
		M(v, ci),
	];
	stroke(env, jaw(xa, 1), c, 2.4 * u, a);
	stroke(env, jaw(xb, -1), env.sc.accent, 2.4 * u, a);
	stroke(
		env,
		[
			M(xb, ci - 4 * u * s),
			M(xb + sw, ci - 4 * u * s),
			M(xb + sw, co + 4 * u * s),
			M(xb, co + 4 * u * s),
		],
		env.sc.accent,
		2.4 * u,
		a,
		{ close: true },
	);
	const vt: (readonly [number, number, number, number])[] = [];
	for (let i = 1; i < 6; i += 1) {
		vt.push([...M(xb + i * 7 * u, co + 4 * u * s), ...M(xb + i * 7 * u, co - s * 5 * u)]);
	}
	segs(env, vt, env.sc.accent, 1.2 * u, a);
	const lp = M(xb + sw / 2, co + s * 22 * u);
	label(env, ((xb - xa) / 10).toFixed(1), lp[0], lp[1], {
		size: Math.max(11, 16 * u),
		color: p.accent ? env.sc.accent : c,
		alpha: ein(t, 0.3, 0.3) * o,
	});
}

/** 分度器 — a half-disc protractor standing on the lyric: the scale sweeps on and a needle swings to an angle. */
function drawProtractor(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const sp = ax.C1 - ax.C0;
	const len = ax.L1 - ax.L0;
	const b = sideBand(env, ax, 180 * u, p.low, 18 * u + sp * 0.05);
	if (b.room < 44 * u) return;
	const R = cl(Math.min(len * 0.45, b.room - 28 * u), 34 * u, 260 * u);
	const ca = cl((ax.L0 + ax.L1) / 2, R + 10 * u, ax.AM - R - 10 * u);
	const c = env.sc.fg;
	// eslint-disable-next-line opencut/prefer-object-params -- pt(d, r) mirrors the source pack's protractor-point closure
	const pt = (d: number, r: number): X2Pt =>
		ax.M(ca + Math.cos(degrees(d)) * r, b.edge + b.s * Math.sin(degrees(d)) * r);
	const e = ein(t, 0.65, 0, inOutCubic);
	const a = Math.min(1, o * 1.5);
	const k = R / (150 * u);
	const eb = ein(t, 0.4);
	segs(env, [[...ax.M(ca - R * eb, b.edge), ...ax.M(ca + R * eb, b.edge)]], c, 1.8 * u, a);
	const arc: X2Pt[] = [];
	for (let i = 0; i <= 40; i += 1) arc.push(pt((180 * e * i) / 40, R));
	stroke(env, arc, c, 2.2 * u, a);
	const tk: (readonly [number, number, number, number])[] = [];
	for (let d = 0; d <= 180; d += 5) {
		if (d > 180 * e) break;
		const l = (d % 30 === 0 ? 17 : d % 10 === 0 ? 10 : 6) * u * cl(k, 0.6, 1.2);
		const A = pt(d, R);
		const B = pt(d, R - l);
		tk.push([A[0], A[1], B[0], B[1]]);
	}
	segs(env, tk, c, 1.2 * u, 0.85 * a);
	const tg = 25 + p.r * 130;
	const ang = tg * oBack(cl((t - 0.3) / 0.6), 1.5) + 2 * Math.sin(t * 2.1) * env.motion;
	const na = ein(t, 0.2, 0.3) * o;
	const N = pt(ang, R * 0.84);
	const O = pt(0, 0);
	segs(env, [[O[0], O[1], N[0], N[1]]], env.sc.accent, 3 * u, na);
	ring(env, O[0], O[1], 5 * u, env.sc.accent, 2.2 * u, na);
	const Lp = pt(ang, R + 20 * u);
	if (R > 60 * u) {
		label(env, `${Math.round(ang)}°`, Lp[0], Lp[1], {
			size: Math.max(11, 15 * u),
			color: env.sc.sub,
			alpha: ein(t, 0.3, 0.5) * o,
		});
	}
}

/** 角度記号 — a geometry angle mark at a corner of the lyric: a dashed base ray, a ray that swings open, the arc and its degrees. */
function drawAngleMark(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env) * 0.6;
	const c = colOf(env, p);
	let sx = p.right ? 1 : -1;
	let sy = p.low ? 1 : -1;
	const vx = (s: number): number => (s > 0 ? bb.x1 + 10 * u : bb.x0 - 10 * u);
	const rm = (s: number): number => (s > 0 ? W - m - vx(s) : vx(s) - m);
	const vy = (s: number): number => (s > 0 ? bb.y1 + 10 * u : bb.y0 - 10 * u);
	const rv = (s: number): number => (s > 0 ? H - m - vy(s) : vy(s) - m);
	if (rv(sy) < 34 * u && rv(-sy) > rv(sy)) sy = -sy;
	let dir = sx;
	let len: number;
	if (rm(sx) >= 120 * u) len = rm(sx);
	else if (rm(-sx) >= 120 * u) {
		sx = -sx;
		dir = sx;
		len = rm(sx);
	} else {
		dir = -sx;
		len = bw(bb) * 0.55;
	}
	len = cl(len * 0.8, 90 * u, 230 * u);
	const V: X2Pt = [vx(sx), vy(sy)];
	const room = Math.max(8 * u, rv(sy));
	const th = cl(
		Math.min(22 + p.r * 38, Math.atan2(room, len * 0.85) / DEG),
		7,
		60,
	);
	const the = th * oBack(cl((t - 0.2) / 0.5), 1.7);
	const a = Math.min(1, o * 1.5);
	// eslint-disable-next-line opencut/prefer-object-params -- ray(d, r) mirrors the source pack's ray closure
	const ray = (d: number, r: number): X2Pt => [
		V[0] + dir * Math.cos(degrees(d)) * r,
		V[1] + sy * Math.sin(degrees(d)) * r,
	];
	const e = ein(t, 0.4);
	const A = ray(0, len * e * o);
	stroke(env, [V, A], env.sc.fg, 1.8 * u, a * 0.7, { dash: [8 * u, 6 * u] });
	const B = ray(the, len * e * o);
	segs(env, [[V[0], V[1], B[0], B[1]]], c, 3 * u, a);
	const ra = len * 0.42 * e;
	const arc: X2Pt[] = [];
	for (let i = 0; i <= 14; i += 1) arc.push(ray((the * i) / 14, ra));
	stroke(env, arc, c, 2 * u, a);
	dot(env, V[0], V[1], 5 * u, env.sc.accent, a);
	const Lp = ray(the / 2, ra + 30 * u);
	label(env, `${Math.round(Math.abs(the))}°`, Lp[0], Lp[1], {
		size: Math.max(11, 17 * u),
		color: c,
		alpha: ein(t, 0.3, 0.4) * o,
	});
}

/** 水準器 — a spirit level beside the lyric: the bubble sloshes and settles between its two lines. */
function drawLevel(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb, true);
	const b = sideBand(env, ax, 40 * u, p.low, 16 * u + bh(bb) * 0.07);
	const c = env.sc.fg;
	const m = marginOf(env) * 0.5;
	const cx = (bb.x0 + bb.x1) / 2;
	const e = ein(t, 0.45);
	const w = cl(bw(bb) * 0.4, 150 * u, 290 * u) * e;
	const h = Math.min(34 * u, b.h);
	const y = b.c;
	const a = Math.min(1, o * 1.5);
	stroke(
		env,
		rrectPts(cx - w / 2, y - h / 2, cx + w / 2, y + h / 2, h / 2, 6),
		c,
		2.4 * u,
		a,
		{ close: true },
	);
	segs(
		env,
		[
			[cx - 24 * u * e, y - h / 2, cx - 24 * u * e, y + h / 2],
			[cx + 24 * u * e, y - h / 2, cx + 24 * u * e, y + h / 2],
		],
		c,
		1.8 * u,
		a,
	);
	const x0 = Math.max(m, bb.x0 - 6 * u);
	const x1 = Math.min(env.W - m, bb.x1 + 6 * u);
	const e2 = ein(t, 0.5, 0.1) * o;
	if (x1 - x0 > w + 40 * u) {
		segs(
			env,
			[
				[cx - w / 2 - 10 * u, y, lerpN(cx - w / 2 - 10 * u, x0, e2), y],
				[cx + w / 2 + 10 * u, y, lerpN(cx + w / 2 + 10 * u, x1, e2), y],
				[x0, y - 6 * u * e2, x0, y + 6 * u * e2],
				[x1, y - 6 * u * e2, x1, y + 6 * u * e2],
			],
			env.sc.sub,
			1.6 * u,
			a,
		);
	}
	const bx =
		cx +
		((w / 2 - 30 * u) * Math.exp(-t * 1.5) * Math.cos(t * 5.5) * (p.right ? 1 : -1) +
			2.5 * u * Math.sin(t * 1.3)) *
			(0.3 + 0.7 * env.motion);
	const ba = ein(t, 0.25, 0.15) * o;
	const bwd = 19 * u;
	const bhh = Math.max(2 * u, Math.min(11 * u, h / 2 - 4 * u));
	stroke(env, rrectPts(bx - bwd, y - bhh, bx + bwd, y + bhh, bhh, 6), env.sc.accent, 2.6 * u, ba, {
		close: true,
	});
	segs(
		env,
		[[bx - bwd * 0.45, y - bhh * 0.35, bx - bwd * 0.05, y - bhh * 0.35]],
		env.sc.accent,
		1.3 * u,
		ba,
	);
}

/** 下げ振り — a plumb line dropped from the top edge: the bob swings like a pendulum and comes to rest. */
function drawPlumb(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env);
	const c = env.sc.fg;
	const wr = W - bb.x1;
	const wl = bb.x0;
	const bob = 46 * u;
	let anchorX: number;
	let L: number;
	let lim: number;
	const side = p.right ? (wr >= 90 * u ? 1 : -1) : wl < 90 * u ? 1 : -1;
	if (Math.max(wr, wl) >= 90 * u) {
		const sp = side > 0 ? wr : wl;
		anchorX = side > 0 ? bb.x1 + sp * 0.5 : sp * 0.5;
		L = cl((bb.y0 + bb.y1) / 2 + bh(bb) * 0.2, H * 0.25, H * 0.72);
		lim = sp * 0.5 - 16 * u;
	} else if (bb.y0 >= 110 * u) {
		anchorX = (bb.x0 + bb.x1) / 2 + (p.right ? 1 : -1) * bw(bb) * 0.3;
		L = bb.y0 - 22 * u - bob;
		lim = L * 0.3;
	} else {
		anchorX = p.right ? W - m * 0.5 : m * 0.5;
		L = H * 0.4;
		lim = m * 0.3;
	}
	L *= oBack(cl(t / 0.55), 1.2) * lerpN(0.2, 1, o);
	if (L < 4) return;
	const A = Math.min(9 * DEG, Math.atan2(Math.max(2, lim), L));
	const th =
		(A * Math.exp(-t * 0.9) * Math.cos(t * 4.2) + 1.2 * DEG * Math.sin(t * 1.7)) *
		(0.25 + 0.75 * env.motion) *
		(p.low ? -1 : 1);
	const dx = Math.sin(th);
	const dy = Math.cos(th);
	const bx = anchorX + dx * L;
	const by = dy * L;
	const nx = dy;
	const ny = -dx;
	const a = Math.min(1, o * 1.6);
	segs(env, [[anchorX, 0, bx, by]], c, 1.8 * u, a);
	segs(env, [[anchorX - 12 * u, 2 * u, anchorX + 12 * u, 2 * u]], c, 4 * u, a);
	const w = 13 * u;
	// eslint-disable-next-line opencut/prefer-object-params -- T(k, d) mirrors the source pack's bob-outline closure
	const T = (k: number, d: number): X2Pt => [bx + nx * k + dx * d, by + ny * k + dy * d];
	fillPoly(
		env,
		[T(-w, 0), T(w, 0), T(w, bob * 0.35), T(0, bob), T(-w, bob * 0.35)],
		colOf(env, p),
		a,
	);
	dot(env, bx + dx * bob * 0.2, by + dy * bob * 0.2, 3.2 * u, env.sc.bg, a);
}

/** コンパス — a drafting compass in free space: the needle leg stays put while the pencil leg draws a full circle. */
function drawCompass(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const mn = Math.min(env.W, env.H);
	const R = cl(mn * 0.095, 50 * u, 112 * u);
	const hg = R * 2.1;
	const w = R * 2 + 12 * u;
	const h = hg + R + 28 * u;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const px = sp.x + w / 2;
	const py = sp.y + h - R - 6 * u;
	const dir = p.right ? 1 : -1;
	const a = ein(t, 0.3, 0, outCubic) * o;
	const ph0 = degrees(-90 + p.r * 360);
	const sw =
		(TAU * inOutCubic(cl((t - 0.25) / 1.2)) + Math.max(0, t - 1.45) * 0.25 * env.motion) * dir;
	const ph = ph0 + sw;
	const qx = px + Math.cos(ph) * R;
	const qy = py + Math.sin(ph) * R;
	const hx = (px + qx) / 2;
	const hy = py - hg * ein(t, 0.35);
	const n = Math.max(2, Math.ceil(Math.min(Math.abs(sw), TAU) / 0.12));
	stroke(
		env,
		arcPts(px, py, R, ph - Math.sign(sw || 1) * Math.min(Math.abs(sw), TAU), ph, n),
		colOf(env, p),
		3 * u,
		a,
	);
	stroke(
		env,
		[
			[px, py],
			[hx, hy],
			[qx, qy],
		],
		env.sc.fg,
		2.6 * u,
		a,
	);
	segs(env, [[hx, hy, hx, hy - 18 * u]], env.sc.fg, 6 * u, a);
	dot(env, hx, hy, 7 * u, env.sc.bg, a);
	ring(env, hx, hy, 7 * u, env.sc.fg, 2.2 * u, a);
	dot(env, hx, hy, 2.6 * u, env.sc.accent, a);
	segs(
		env,
		[
			[px - 6 * u, py, px + 6 * u, py],
			[px, py - 6 * u, px, py + 6 * u],
		],
		env.sc.sub,
		1 * u,
		a,
	);
	dot(env, qx, qy, 4.5 * u, env.sc.accent, a);
}

/** ベジェ曲線 — a vector-tool curve beside the lyric: anchor points, control handles that slowly swing, the curve following them. */
function drawBezier(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const len = ax.L1 - ax.L0;
	const hh0 = cl(len * 0.14, 54 * u, 130 * u);
	const m = marginOf(env) * 0.5;
	const b = sideBand(env, ax, hh0 + 8 * u, p.low, 18 * u + (ax.C1 - ax.C0) * 0.06);
	const hh = Math.max(6 * u, b.h - 8 * u);
	const s = b.s;
	const mo = 0.3 + 0.7 * env.motion;
	const a0 = Math.max(m, ax.L0 - 10 * u);
	const a1 = Math.min(ax.AM - m, ax.L1 + 10 * u);
	const e1 = ein(t, 0.3, 0.1);
	const ph = p.r * 6;
	const A: X2Pt = [a0, b.edge];
	const B: X2Pt = [a1, b.edge];
	const HA: X2Pt = [
		a0 + len * (0.28 + 0.06 * Math.sin(t * 0.9 + ph) * mo) * e1,
		b.edge + s * hh * (0.6 + 0.38 * Math.sin(t * 1.3 + ph) * mo) * e1,
	];
	const HB: X2Pt = [
		a1 - len * (0.28 + 0.06 * Math.cos(t * 1.1 + ph) * mo) * e1,
		b.edge + s * hh * (0.6 + 0.38 * Math.sin(t * 1.3 + ph + 2.3) * mo) * e1,
	];
	const cv: X2Pt[] = [];
	for (let i = 0; i <= 32; i += 1) {
		const q = i / 32;
		const k = 1 - q;
		cv.push(
			ax.M(
				k * k * k * A[0] + 3 * k * k * q * HA[0] + 3 * k * q * q * HB[0] + q * q * q * B[0],
				k * k * k * A[1] + 3 * k * k * q * HA[1] + 3 * k * q * q * HB[1] + q * q * q * B[1],
			),
		);
	}
	const pa = mk(cv);
	const e = ein(t, 0.55, 0.2, inOutCubic);
	const a = Math.min(1, o * 1.5);
	stroke(env, span(pa, pa.L * (1 - o), pa.L * e), colOf(env, p), 3 * u, a);
	const mA = ax.M(A[0], A[1]);
	const mB = ax.M(B[0], B[1]);
	const mHA = ax.M(HA[0], HA[1]);
	const mHB = ax.M(HB[0], HB[1]);
	const pa2 = oBack(cl(t / 0.25), 2) * o;
	segs(
		env,
		[
			[mA[0], mA[1], mHA[0], mHA[1]],
			[mB[0], mB[1], mHB[0], mHB[1]],
		],
		env.sc.sub,
		1.6 * u,
		a,
	);
	for (const q of [mA, mB]) {
		const r = 6 * u * pa2;
		fillPoly(
			env,
			[
				[q[0] - r, q[1] - r],
				[q[0] + r, q[1] - r],
				[q[0] + r, q[1] + r],
				[q[0] - r, q[1] + r],
			],
			env.sc.accent,
			1,
		);
	}
	for (const q of [mHA, mHB]) {
		dot(env, q[0], q[1], 6 * u * e1, env.sc.bg, o);
		ring(env, q[0], q[1], 6 * u * e1, env.sc.accent, 2 * u, o);
	}
}

/* ============================================================ connectors, pointers, marks */

/** 張り糸 — strings stretched taut from the lyric's frame to the screen edges, twanging like plucked strings. */
function drawEdgeTether(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const f = frameRect(env, bb, padOf(bb, u, 0.8));
	const c = env.sc.fg;
	const dirs: readonly (readonly [number, number])[] = [
		[1, 0],
		[-1, 0],
		[0, -1],
		[0, 1],
	];
	const n = p.n + 1;
	for (let k = 0; k < n; k += 1) {
		const [dx, dy] = dirs[(k + p.v + (p.right ? 0 : 1)) % 4]!;
		const lat = randomSigned(p.seed, k, 1) * 0.3;
		const ax = dx ? (dx > 0 ? f.x1 : f.x0) : f.cx + lat * f.w;
		const ay = dy ? (dy > 0 ? f.y1 : f.y0) : f.cy + lat * f.h;
		const ex = dx ? (dx > 0 ? W : 0) : ax;
		const ey = dy ? (dy > 0 ? H : 0) : ay;
		const L = Math.hypot(ex - ax, ey - ay);
		if (L < 12 * u) continue;
		const dl = k * 0.07;
		const e = ein(t, 0.3, dl, outCubic);
		if (e <= 0) continue;
		const tau = t - 0.3 - dl;
		const cyc = tau > 0 ? tau % 1.9 : 99;
		const amp = 10 * u * Math.exp(-cyc * 3) * Math.sin(cyc * 40) * env.motion * (e >= 1 ? 1 : 0);
		const pts: X2Pt[] = [];
		for (let i = 0; i <= 16; i += 1) {
			const s = lerpN(1 - o, e, i / 16);
			const d = amp * Math.sin(Math.PI * s);
			pts.push([lerpN(ax, ex, s) - dy * d, lerpN(ay, ey, s) + dx * d]);
		}
		stroke(env, pts, c, 2 * u, 0.9);
		dot(env, ax, ay, 5.5 * u, env.sc.bg, e * o);
		ring(env, ax, ay, 5.5 * u, env.sc.accent, 2.2 * u, e * o);
		if (e >= 1) {
			const q = 7 * u;
			fillRect(
				env,
				ex - (dx > 0 ? q * 2 : dx < 0 ? 0 : q),
				ey - (dy > 0 ? q * 2 : dy < 0 ? 0 : q),
				q * 2,
				q * 2,
				env.sc.accent,
				o,
			);
		}
	}
}

/** 手描き矢印 — a hand-drawn arrow swooping in from the free space, its head flicked on at the end. */
function drawHandArrow(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env) * 0.8;
	const c = colOf(env, p);
	const sx = p.right ? 1 : -1;
	const sy = p.low ? 1 : -1;
	type Side = "b" | "l" | "r" | "t";
	const rooms: Record<Side, number> = {
		r: W - m - bb.x1,
		l: bb.x0 - m,
		t: bb.y0 - m,
		b: H - m - bb.y1,
	};
	const hs: Side[] = sx > 0 ? ["r", "l"] : ["l", "r"];
	const vs: Side[] = sy > 0 ? ["b", "t"] : ["t", "b"];
	const ord: Side[] = p.v % 2
		? [hs[0]!, vs[0]!, hs[1]!, vs[1]!]
		: [vs[0]!, hs[0]!, vs[1]!, hs[1]!];
	let sd = ord.find((k) => rooms[k] >= 110 * u);
	if (!sd) {
		sd = ord.slice().sort((a, b) => rooms[b] - rooms[a])[0];
	}
	const room = Math.max(rooms[sd], 30 * u);
	const len = cl(room * 0.75, 30 * u, 240 * u);
	const cx = (bb.x0 + bb.x1) / 2;
	const cy = (bb.y0 + bb.y1) / 2;
	let T: X2Pt;
	let S: X2Pt;
	let C: X2Pt;
	if (sd === "r" || sd === "l") {
		const d = sd === "r" ? 1 : -1;
		T = [(d > 0 ? bb.x1 : bb.x0) + d * 16 * u, cy + sy * bh(bb) * 0.15];
		S = [T[0] + d * len, cl(T[1] + sy * len * 0.6, m, H - m)];
		C = [lerpN(T[0], S[0], 0.8), T[1] - sy * len * 0.1];
	} else {
		const d = sd === "b" ? 1 : -1;
		T = [cx + sx * bw(bb) * 0.2, (d > 0 ? bb.y1 : bb.y0) + d * 16 * u];
		S = [cl(T[0] + sx * len * 0.7, m, W - m), T[1] + d * len];
		C = [T[0] - sx * len * 0.12, lerpN(T[1], S[1], 0.8)];
	}
	const raw: X2Pt[] = quad(S, C, T, 26).map((q, i): X2Pt => {
		const k = Math.sin((i / 26) * Math.PI) * 2.6 * u;
		return [q[0] + noise1(i * 0.45, p.seed) * k, q[1] + noise1(i * 0.45 + 9, p.seed) * k];
	});
	const pa = mk(raw);
	const e = ein(t, 0.5, 0, inOutCubic);
	const a = Math.min(1, o * 1.6);
	stroke(env, span(pa, pa.L * (1 - o), pa.L * e), c, 3.2 * u, a);
	const eh = ein(t, 0.2, 0.45);
	if (eh <= 0) return;
	const an = Math.atan2(C[1] - T[1], C[0] - T[0]);
	const hl = Math.min(26 * u, len * 0.4) * eh;
	for (const k of [-0.52, 0.48]) {
		stroke(
			env,
			[
				T,
				[
					T[0] + Math.cos(an + k) * hl * (k < 0 ? 1 : 0.85),
					T[1] + Math.sin(an + k) * hl * (k < 0 ? 1 : 0.85),
				],
			],
			c,
			3.2 * u,
			a,
		);
	}
}

/** ちょん線 — three short strokes that flick outward from the lyric's corners, and flick again now and then. */
function drawAccentTicks(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const sx = p.right ? 1 : -1;
	const c = colOf(env, p);
	const k0 = cl(bh(bb) / (170 * u), 0.8, 1.7);
	const allCorners: readonly (readonly [number, number])[] = [
		[sx, -1],
		[-sx, 1],
		[-sx, -1],
	];
	const cs = allCorners.slice(0, p.n);
	cs.forEach(([cxs, cys], ci) => {
		const ox = (cxs > 0 ? bb.x1 : bb.x0) - cxs * 6 * u;
		const oy = (cys > 0 ? bb.y1 : bb.y0) - cys * 6 * u;
		const base = Math.atan2(cys * 0.75, cxs);
		const tau = t - ci * 0.12;
		if (tau <= 0) return;
		const cyc = tau % 1.5;
		const nud = 7 * u * Math.exp(-cyc * 7) * (tau > 1.5 ? 1 : 0) * env.motion;
		[-0.46, 0, 0.46].forEach((da, i) => {
			const an = base + da * cxs * cys;
			const L = (i === 1 ? 42 : 30) * u * k0;
			const rb = 20 * u * k0 + nud;
			const r1 = rb + L * ein(tau, 0.28, i * 0.03);
			const r0 = lerpN(r1, rb, o);
			if (r1 - r0 < 0.5) return;
			segs(
				env,
				[[
					ox + Math.cos(an) * r0,
					oy + Math.sin(an) * r0,
					ox + Math.cos(an) * r1,
					oy + Math.sin(an) * r1,
				]],
				c,
				4.4 * u * Math.min(k0, 1.3),
				Math.min(1, o * 2),
			);
		});
	});
}

/** 旗ピン — a pin planted at a corner of the lyric: the pole rises and a pennant unfurls and flutters. */
function drawPennant(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env) * 0.5;
	const rt = bb.y0 - m;
	const rb = H - m - bb.y1;
	const sy = rt >= 60 * u || rt >= rb ? -1 : 1;
	const room = sy < 0 ? rt : rb;
	const hgt = cl(room * 0.8, 24 * u, 120 * u);
	const xs = p.big ? [p.right ? 1 : -1, p.right ? -1 : 1] : [p.right ? 1 : -1];
	const c = p.accent ? env.sc.fg : env.sc.accent;
	xs.forEach((sx, k) => {
		const px = cl(sx > 0 ? bb.x1 + 6 * u : bb.x0 - 6 * u, m, W - m);
		const y0 = sy < 0 ? bb.y0 - 6 * u : bb.y1 + 6 * u;
		const rise = oBack(cl((t - k * 0.12) / 0.4), 1.4) * o;
		if (rise <= 0) return;
		const yT = y0 + sy * hgt * rise;
		segs(env, [[px, y0, px, yT]], env.sc.fg, 2.4 * u, 1);
		dot(env, px, y0, 3.6 * u, env.sc.fg, 1);
		const fl = cl(hgt * 0.8, 26 * u, 96 * u) * ein(t, 0.45, 0.2 + k * 0.12) * o;
		const fh = cl(hgt * 0.42, 14 * u, 50 * u) * Math.min(1, rise);
		if (fl < 1) return;
		const dir = sx > 0 ? (px + fl * 1.05 < W - m * 0.6 ? 1 : -1) : px - fl * 1.05 < m * 0.6 ? 1 : -1;
		const yB = yT - sy * fh;
		const ym = (yT + yB) / 2;
		const wv = (s: number): number =>
			Math.sin(s * 5 - env.ltb * 6) * fh * 0.16 * s * (0.3 + 0.7 * env.motion);
		const A: X2Pt[] = [];
		const B: X2Pt[] = [];
		for (let i = 0; i <= 8; i += 1) {
			const s = i / 8;
			A.push([px + dir * fl * s, lerpN(yT, ym, s) + wv(s)]);
			B.push([px + dir * fl * s, lerpN(yB, ym, s) + wv(s)]);
		}
		fillPoly(env, A.concat(B.reverse()), c, 0.95);
	});
}

/** チェック欄 — a drawn check box (or circle) beside the lyric, ticked by hand with an overshooting stroke. */
function drawCheckBox(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const s = cl(Math.min(bw(bb), bh(bb)) * 0.5, 46 * u, 92 * u);
	const sp = spot(env, bb, s * 1.25, s * 1.25, { ...p, corner: false }, 18 * u);
	const boxX = sp.x + s * 0.05;
	const y = sp.y + s * 0.2;
	const sd = p.seed;
	const j = (k: number): number => randomSigned(sd, k) * s * 0.035;
	const a = Math.min(1, o * 1.6);
	const k = s / (44 * u);
	let pts: X2Pt[];
	if (p.v % 2) {
		pts = [];
		for (let i = 0; i <= 30; i += 1) {
			const an = -2 + (i / 30) * TAU * 1.07;
			const r = s * 0.5 * (1 + 0.04 * Math.sin(i * 0.9 + (sd % 7)));
			pts.push([boxX + s / 2 + Math.cos(an) * r, y + s / 2 + Math.sin(an) * r]);
		}
	} else {
		pts = [
			[boxX + j(1), y + j(2)],
			[boxX + s + j(3), y + j(4)],
			[boxX + s + j(5), y + s + j(6)],
			[boxX + j(7), y + s + j(8)],
			[boxX + j(1) - 1, y + j(2) - s * 0.08],
		];
	}
	const pa = mk(pts);
	stroke(env, span(pa, 0, pa.L * ein(t, 0.4, 0, inOutCubic)), env.sc.fg, 2.4 * u * Math.max(0.8, k), a);
	const pc = mk(
		quad([boxX + s * 0.2, y + s * 0.5], [boxX + s * 0.34, y + s * 0.62], [boxX + s * 0.44, y + s * 0.8], 4).concat(
			quad([boxX + s * 0.44, y + s * 0.8], [boxX + s * 0.66, y + s * 0.2], [boxX + s * 1.12, y - s * 0.14], 8),
		),
	);
	stroke(
		env,
		span(pc, 0, pc.L * ein(t, 0.28, 0.42, inOutCubic)),
		env.sc.accent,
		4.6 * u * Math.max(0.8, k),
		a,
	);
}

/** 切り取り線 — a dashed cut line across the screen, opened by a pair of scissors that keeps snipping. */
function drawCutLine(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const ax = axes(env, bb);
	const b = sideBand(env, ax, 56 * u, p.low, 16 * u + (ax.C1 - ax.C0) * 0.08);
	const c = env.sc.fg;
	const rev = p.right;
	const mv = inOutCubic(cl(t / 0.85));
	const s = ax.AM * lerpN(0.03, 0.88, mv) + Math.max(0, t - 0.85) * 5 * u * env.motion;
	const X = (a: number): number => (rev ? ax.AM - a : a);
	const A = ax.M(X(ax.AM * (1 - o) * 0.9), b.c);
	const B = ax.M(X(Math.max(0, s - 28 * u)), b.c);
	const a = Math.min(1, o * 1.6);
	if (s - 28 * u > ax.AM * (1 - o) * 0.9) {
		stroke(env, [A, B], c, 2.2 * u, 0.9 * a, { dash: [14 * u, 9 * u] });
	}
	const q = ax.M(X(s), b.c);
	const ang =
		(9 + 15 * Math.abs(Math.sin(t * (mv < 1 ? 11 : 3.5)))) *
		DEG *
		(0.4 + 0.6 * env.motion);
	const ctx = env.ctx;
	ctx.save();
	ctx.translate(q[0], q[1]);
	ctx.rotate((ax.vert ? Math.PI / 2 : 0) + (rev ? Math.PI : 0));
	ctx.scale(u * 1.7, u * 1.7);
	ctx.globalAlpha = Math.min(1, a * ein(t, 0.2));
	ctx.strokeStyle = p.accent ? env.sc.accent : c;
	ctx.lineWidth = 2.2;
	for (const sg of [-1, 1]) {
		ctx.save();
		ctx.rotate(sg * ang);
		ctx.beginPath();
		ctx.moveTo?.(24, 0);
		ctx.lineTo?.(-13, 0);
		ctx.stroke?.();
		if (ctx.arc && ctx.stroke) {
			ctx.beginPath();
			ctx.arc(-19.5, sg * -2.5, 6.5, 0, TAU);
			ctx.stroke();
		}
		ctx.restore();
	}
	ctx.fillStyle = ctx.strokeStyle;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(0, 0, 1.8, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(-1.8, -1.8, 3.6, 3.6);
	}
	ctx.restore();
}

/** 縫い目 — a seam stitched round the screen margin (running, zig-zag or cross stitch) by a travelling needle. */
function drawSeam(x: X2Part): void {
	const { env, p, t, o, u } = x;
	const { W, H } = env;
	const ins = marginOf(env) * 0.55;
	const c = colOf(env, p);
	const v = p.v % 3;
	const pa = mk(rrectPts(ins, ins, W - ins, H - ins, 20 * u, 5), true);
	const L = pa.L;
	const a = 0.85 * Math.min(1, o * 1.5);
	const st0 = pa.L * ((p.right ? 0.25 : 0) + (p.low ? 0.5 : 0));
	const spans: (readonly [number, number])[] = [];
	if (p.corner) {
		const ln = Math.min(W, H) * 0.34 * ein(t, 0.7, 0, inOutCubic) * o;
		for (const cc of [st0, st0 + L / 2]) spans.push([cc - ln, cc + ln]);
	} else {
		const e = ein(t, 1.0, 0, inOutCubic);
		spans.push([st0 + L * e * (1 - o), st0 + L * e]);
	}
	for (const [s0, s1] of spans) {
		if (!(s1 > s0)) continue;
		if (v === 0) {
			stroke(env, span(pa, s0, s1, true), c, 2.8 * u, a, { dash: [17 * u, 11 * u] });
		} else {
			const step =
				(v === 1 ? 12 : 27) * u * Math.max(1, L / (400 * (v === 1 ? 12 : 27) * u));
			const zz: X2Pt[] = [];
			const xs: (readonly [number, number, number, number])[] = [];
			for (let i = Math.ceil(s0 / step), g = 0; i * step <= s1 && g < 420; i += 1, g += 1) {
				const q = at(pa, mod(i * step, L));
				const nx = -Math.sin(q[2]);
				const ny = Math.cos(q[2]);
				const tx = Math.cos(q[2]);
				const ty = Math.sin(q[2]);
				const d = 5 * u;
				if (v === 1) {
					zz.push([q[0] + nx * d * (i % 2 ? 1 : -1), q[1] + ny * d * (i % 2 ? 1 : -1)]);
				} else {
					xs.push(
						[q[0] - tx * d - nx * d, q[1] - ty * d - ny * d, q[0] + tx * d + nx * d, q[1] + ty * d + ny * d],
						[q[0] - tx * d + nx * d, q[1] - ty * d - ny * d, q[0] + tx * d - nx * d, q[1] + ty * d + ny * d],
					);
				}
			}
			if (v === 1) stroke(env, zz, c, 2.2 * u, a);
			else segs(env, xs, c, 2.2 * u, a);
		}
	}
	if (!p.corner) {
		const e = ein(t, 1.0, 0, inOutCubic);
		const na = (1 - ein(t, 0.3, 0.95, inCubic)) * o;
		if (na <= 0.01) return;
		const q = at(pa, mod(st0 + L * e, L));
		const tx = Math.cos(q[2] - 0.35);
		const ty = Math.sin(q[2] - 0.35);
		segs(env, [[q[0], q[1], q[0] + tx * 50 * u, q[1] + ty * 50 * u]], env.sc.fg, 2 * u, na);
		ring(env, q[0] + tx * 5 * u, q[1] + ty * 5 * u, 2.6 * u, env.sc.fg, 1.2 * u, na);
	}
}

/** JIZURA `env.rect`: an alpha rectangle. */
// eslint-disable-next-line opencut/prefer-object-params -- fillRect(env, x, y, w, h, c, a) mirrors the source pack's env.rect
function fillRect(env: X2Env, x: number, y: number, w: number, h: number, c: string, a = 1): void {
	if (a <= 0.003 || w <= 0 || h <= 0) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.fillStyle = c;
	ctx.fillRect(x, y, w, h);
	ctx.restore();
}
