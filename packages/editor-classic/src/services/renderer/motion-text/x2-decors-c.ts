import { coreDecorTextBounds } from "./core-decor-geometry";
import { coreDecorPlan } from "./core-decor-timing";
import type { CoreDecorBounds, CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import { enterBOutBack } from "./enter-b-drawing";
import {
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
 * JIZURA x2decC — 30 typographic / infographic / interface decor parts (small
 * text, numbers and widgets around the lyric), transliterated from
 * `11p_x2_decC.js` onto the rocut decor contract.
 *
 * Semantic simplifications shared with the other x2 ports: every small text
 * renders in the item font (JIZURA's mono / body / display slots do not
 * exist here), text widths use a per-glyph advance estimate instead of real
 * metrics, romaji comes from a compact local kana table, `cut.line` /
 * `cut.index` / `cut.note` derive from the cut seed, and the hide-number /
 * hide-time switches stay off because rocut has no fx layer.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const TICKS_PER_SECOND = 120_000;

interface X2Env {
	readonly ctx: MotionTextCanvasContext;
	readonly H: number;
	readonly W: number;
	readonly dur: number;
	readonly font: {
		readonly family: string;
		readonly style: string;
		readonly weight: number;
	};
	readonly index: number;
	readonly line: number;
	readonly lt: number;
	readonly ltb: number;
	readonly motion: number;
	readonly seed: number;
	readonly step: number;
	readonly text: string;
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

/** JIZURA `FS`: small text size. */
function fsOf(env: X2Env): number {
	return Math.max(12, 17 * unitOf(env));
}

// eslint-disable-next-line opencut/prefer-object-params -- hit(x0, y0, x1, y1, bb, pad) mirrors the source pack's overlap test
function hit(x0: number, y0: number, x1: number, y1: number, bb: CoreDecorBounds, pad = 0): boolean {
	return !(x1 < bb.x0 - pad || x0 > bb.x1 + pad || y1 < bb.y0 - pad || y0 > bb.y1 + pad);
}

// eslint-disable-next-line opencut/prefer-object-params -- pad2(n, k) mirrors the source pack's zero-padded number
function pad2(n: number, k = 2): string {
	return String(Math.max(0, Math.floor(n))).padStart(k, "0");
}

function charsOf(s: string): string[] {
	return Array.from(String(s ?? ""));
}

function glyphsOf(s: string): string[] {
	return charsOf(s).filter((c) => c.trim());
}

// eslint-disable-next-line opencut/prefer-object-params -- clip(s, n) mirrors the source pack's truncation
function clipText(s: string, n: number): string {
	const a = charsOf(String(s || "").replace(/\s+/gu, " ").trim());
	return a.length > n ? `${a.slice(0, Math.max(1, n - 1)).join("")}…` : a.join("");
}

function hasCJK(s: string): boolean {
	return /[぀-ヿ㐀-鿿]/u.test(s);
}

function isKanji(c: string): boolean {
	const k = c.codePointAt(0) ?? 0;
	return (
		(k >= 0x2e80 && k <= 0x2fdf) ||
		(k >= 0x3400 && k <= 0x4dbf) ||
		(k >= 0x4e00 && k <= 0x9fff) ||
		(k >= 0xf900 && k <= 0xfaff) ||
		(k >= 0x20000 && k <= 0x2ffff)
	);
}

function isHira(c: string): boolean {
	const k = c.codePointAt(0) ?? 0;
	return k >= 0x3041 && k <= 0x309f;
}

function isKata(c: string): boolean {
	const k = c.codePointAt(0) ?? 0;
	return k >= 0x30a1 && k <= 0x30ff;
}

function isLatin(c: string): boolean {
	return /^[A-Za-z]$/.test(c);
}

function isPunct(c: string): boolean {
	if (!c.trim()) return true;
	const k = c.codePointAt(0) ?? 0;
	return (k >= 0x3000 && k <= 0x303f) || (k >= 0xff01 && k <= 0xff0f) || "!?,.".includes(c);
}

function isFullWidth(c: string): boolean {
	const k = c.codePointAt(0) ?? 0;
	return (
		(k >= 0x1100 && k <= 0x115f) ||
		(k >= 0x2e80 && k <= 0xa4cf) ||
		(k >= 0xac00 && k <= 0xd7a3) ||
		(k >= 0xf900 && k <= 0xfaff) ||
		(k >= 0xfe30 && k <= 0xfe6f) ||
		(k >= 0xff00 && k <= 0xff60) ||
		(k >= 0xffe0 && k <= 0xffe6) ||
		(k >= 0x3000 && k <= 0x303f)
	);
}

/** Text width estimate standing in for JIZURA's measured `tw` (no measureText on this canvas contract). */
// eslint-disable-next-line opencut/prefer-object-params -- tw(env, text, size, f, tr) mirrors the source pack's measure helper
function textWidth(text: string, size: number, track = 0.06): number {
	if (text === "") return 0;
	const cs = charsOf(text);
	let w = 0;
	for (const c of cs) {
		w += isFullWidth(c) ? size : c === " " ? size * 0.34 : size * 0.58;
	}
	w += Math.max(0, cs.length - 1) * size * track;
	return w;
}

/* ---- approximate kana → romaji (JIZURA's J.romaji is not available) ---- */

const KANA_ROMAJI: Readonly<Record<string, string>> = {
	あ: "a", い: "i", う: "u", え: "e", お: "o",
	か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
	が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
	さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
	ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
	た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
	だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
	な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
	は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
	ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
	ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
	ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
	や: "ya", ゆ: "yu", よ: "yo",
	ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
	わ: "wa", を: "wo", ん: "n",
	ゃ: "ya", ゅ: "yu", ょ: "yo",
	ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
};

function kanaToHira(c: string): string {
	const k = c.codePointAt(0) ?? 0;
	return k >= 0x30a1 && k <= 0x30f6 ? String.fromCodePoint(k - 0x60) : c;
}

function romajiOfGroup(grp: string): string {
	const cs = charsOf(grp).map(kanaToHira);
	let out = "";
	for (let i = 0; i < cs.length; i += 1) {
		const c = cs[i]!;
		const next = cs[i + 1];
		if (c === "っ" && next) {
			const nb = KANA_ROMAJI[next];
			if (nb) {
				const dbl = /^[aiueon]/.test(nb) ? "" : nb === "chi" ? "t" : nb[0]!;
				out += dbl + nb;
				i += 1;
				continue;
			}
		}
		if (c === "ー") {
			out += out.slice(-1);
			continue;
		}
		const base = KANA_ROMAJI[c];
		if (base === undefined) {
			out += c;
			continue;
		}
		if (next && /[ゃゅょ]/u.test(next)) {
			out += base.slice(0, -1) + KANA_ROMAJI[next]!;
			i += 1;
			continue;
		}
		out += base;
	}
	return out;
}

/** Whole-text romaji for footnote / tooltip readings. */
function romajiOf(text: string): string {
	const cs = charsOf(text);
	let out = "";
	for (let i = 0; i < cs.length; i += 1) {
		const c = cs[i]!;
		if (isHira(c) || isKata(c)) {
			let grp = c;
			while (i + 1 < cs.length && /[ゃゅょぁぃぅぇぉ]/u.test(kanaToHira(cs[i + 1]!))) {
				i += 1;
				grp += cs[i]!;
			}
			out += romajiOfGroup(grp);
		} else if (isLatin(c)) {
			out += c.toLowerCase();
		}
	}
	return out;
}

/** 音節分け helper: split the cut into romanized syllable tokens (the pack's `syllables`). */
function syllables(s: string): readonly (readonly [string, boolean])[] {
	const a = charsOf(s);
	const out: (readonly [string, boolean])[] = [];
	for (let i = 0; i < a.length && out.length < 12; i += 1) {
		const c = a[i]!;
		if (!c.trim() || isPunct(c)) continue;
		let tok = c;
		let kana = false;
		if (isHira(c) || isKata(c)) {
			let grp = c;
			while (
				i + 1 < a.length &&
				(/[ゃゅょァィゥェォー]/u.test(a[i + 1]!) ||
					(/[っッ]/u.test(grp) &&
						grp.length === 1 &&
						(isHira(a[i + 1]!) || isKata(a[i + 1]!))))
			) {
				grp += a[++i]!;
			}
			const r = romajiOfGroup(grp);
			if (r && r !== grp) {
				tok = r;
				kana = true;
			} else tok = grp;
		} else if (isLatin(c)) {
			let wd = c;
			while (i + 1 < a.length && a[i + 1]!.trim() && isLatin(a[i + 1]!) && wd.length < 10) {
				wd += a[++i]!;
			}
			tok = wd.toLowerCase();
			kana = true;
		}
		out.push([tok, kana]);
	}
	return out;
}

function fmtTime(rem: number): string {
	return `${Math.floor(rem / 60)}:${pad2(Math.floor(rem % 60))}`;
}

/* ---- drawing helpers (same optional-path contract as the sibling x2 packs) ---- */

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
			if (((mid + phase) % period + period) % period >= on) continue;
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

/** JIZURA `rr`: rounded rectangle, filled and / or stroked. */
// eslint-disable-next-line opencut/prefer-object-params -- rr(env, x, y, w, h, r, fill, a, strokeC, lw) mirrors the source pack
function rr(
	env: X2Env,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	fill: string | null,
	a = 1,
	strokeC?: string,
	lw?: number,
): void {
	if (a <= 0.003 || w <= 0.2 || h <= 0.2) return;
	const pts = rrectPts(x, y, x + w, y + h, r, 6);
	if (fill) fillPoly(env, pts, fill, a);
	if (strokeC && lw && lw > 0) strokePath(env, pts, strokeC, lw, Math.min(1, a), true);
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
			const a = ((a0 + (90 * i) / n) * Math.PI) / 180;
			out.push([cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2]);
		}
	}
	return out;
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
	const head0 = at(pa, ((s0 % L) + L) % L);
	out.push([head0[0], head0[1]]);
	for (let k = Math.floor(s0 / L) * L, g = 0; k < s1 && g < 4; k += L, g += 1) {
		for (let i = 0; i < pts.length - 1; i += 1) {
			const v = cum[i]! + k;
			if (v > s0 && v < s1) out.push(pts[i]!);
		}
	}
	const head1 = at(pa, ((s1 % L) + L) % L || (s1 > 0 ? L : 0));
	out.push([head1[0], head1[1]]);
	return out;
}

/** First fraction e of a polyline by length. */
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

// eslint-disable-next-line opencut/prefer-object-params -- noise1(v, seed) mirrors the source pack's argument order
function noise1(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

/** JIZURA `J.h`: deterministic small integer hash. */
// eslint-disable-next-line opencut/prefer-object-params -- hOf(seed, ...salts) mirrors JIZURA's J.h
function hOf(seed: number, ...salts: number[]): number {
	return Math.floor(randomUnit(seed, ...salts) * 0x10000) | 0;
}

/** Readable ink on a filled chip (JIZURA `onC`, approximated by luminance). */
// eslint-disable-next-line opencut/prefer-object-params -- onC(env, c) mirrors the source pack's contrast pick
function onC(env: X2Env, c: string): string {
	const lum = (hex: string): number | null => {
		const m = /^#([\da-f]{6})$/iu.exec(hex);
		if (!m?.[1]) return null;
		const v = m[1];
		return (
			(0.299 * Number.parseInt(v.slice(0, 2), 16) +
				0.587 * Number.parseInt(v.slice(2, 4), 16) +
				0.114 * Number.parseInt(v.slice(4, 6), 16)) /
			255
		);
	};
	const bg = lum(env.sc.bg);
	const fg = lum(c);
	if (bg !== null && fg !== null && Math.abs(bg - fg) > 0.45) return env.sc.bg;
	return (fg ?? 0.3) > 0.5 ? "#000000" : "#ffffff";
}

interface X2TextOptions {
	readonly a?: number;
	readonly al?: CanvasTextAlign;
	readonly c?: string;
}

/** JIZURA `T`: small secondary text, always in the item font on this port. */
// eslint-disable-next-line opencut/prefer-object-params -- T(env, text, x, y, size, o) mirrors the source pack's text helper
function T(
	env: X2Env,
	text: string,
	x: number,
	y: number,
	size: number,
	options?: X2TextOptions,
): void {
	const a = options?.a ?? 1;
	if (a <= 0.003 || text === "" || text == null) return;
	const ctx = env.ctx;
	ctx.save();
	ctx.globalAlpha = Math.min(1, a);
	ctx.fillStyle = options?.c ?? env.sc.sub;
	ctx.textAlign = options?.al ?? "left";
	ctx.textBaseline = "middle";
	ctx.font = `${env.font.style} ${env.font.weight} ${Math.max(8, size)}px ${quoteFamily(env.font.family)}`;
	ctx.fillText(String(text), x, y);
	ctx.restore();
}

function quoteFamily(family: string): string {
	return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

interface X2Spot {
	readonly ok: boolean;
	readonly x: number;
	readonly y: number;
}

/** A free w×h box near the lyric or in a screen corner → {x, y, ok} (top-left). */
// eslint-disable-next-line opencut/prefer-object-params
function spot(env: X2Env, bb: CoreDecorBounds, w: number, h: number, p: X2Params, gap: number): X2Spot {
	const { W, H } = env;
	const m = marginOf(env) * 0.8;
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
		near.push([a > 0 ? bb.x1 - w : bb.x0, b > 0 ? bb.y1 + gap : bb.y0 - gap - h]);
		near.push([a > 0 ? bb.x1 + gap : bb.x0 - gap - w, (bb.y0 + bb.y1) / 2 - h / 2]);
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

interface X2BandSpot {
	readonly below: boolean;
	readonly ok: boolean;
	readonly x: number;
	readonly y: number;
}

/** A w×h block centred in the free band under (or over) the lyric; falls back to spot(). */
// eslint-disable-next-line opencut/prefer-object-params
function band(env: X2Env, bb: CoreDecorBounds, w: number, h: number, p: X2Params, gap: number): X2BandSpot {
	const { W, H } = env;
	const m = marginOf(env) * 0.8;
	for (const below of p.low ? [true, false] : [false, true]) {
		const y = below ? bb.y1 + gap : bb.y0 - gap - h;
		if (y < m || y + h > H - m || w > W - 2 * m) continue;
		return { x: cl((bb.x0 + bb.x1) / 2 - w / 2, m, W - m - w), y, ok: true, below };
	}
	const s = spot(env, bb, w, h, p, gap);
	return { x: s.x, y: s.y, ok: s.ok, below: false };
}

const X2_DECOR_C_IDS = new Set([
	"xnAsciiGauge",
	"xnAxes",
	"xnBattery",
	"xnBoxCoords",
	"xnBreadcrumb",
	"xnCalendar",
	"xnClock",
	"xnDiff",
	"xnDropdown",
	"xnFootnote",
	"xnGlyphStats",
	"xnKeycaps",
	"xnLegend",
	"xnLevelMeter",
	"xnMicroPara",
	"xnPager",
	"xnPrompt",
	"xnRemain",
	"xnSearch",
	"xnSliders",
	"xnSparkline",
	"xnStars",
	"xnSyllables",
	"xnTicker",
	"xnTimeline",
	"xnTooltip",
	"xnTrackList",
	"xnTyping",
	"xnVersionTags",
	"xnVowels",
]);

export function drawX2DecorsC(
	options: CoreDecorDraw & { readonly layer: CoreDecorLayer },
): boolean {
	if (!X2_DECOR_C_IDS.has(options.decor)) return false;
	if (options.layer !== "front") return false;
	const part = decorPartOf(options);
	if (part) {
		switch (options.decor) {
			case "xnAsciiGauge":
				drawAsciiGauge(part);
				break;
			case "xnAxes":
				drawAxes(part);
				break;
			case "xnBattery":
				drawBattery(part);
				break;
			case "xnBoxCoords":
				drawBoxCoords(part);
				break;
			case "xnBreadcrumb":
				drawBreadcrumb(part);
				break;
			case "xnCalendar":
				drawCalendar(part);
				break;
			case "xnClock":
				drawClock(part);
				break;
			case "xnDiff":
				drawDiff(part);
				break;
			case "xnDropdown":
				drawDropdown(part);
				break;
			case "xnFootnote":
				drawFootnote(part);
				break;
			case "xnGlyphStats":
				drawGlyphStats(part);
				break;
			case "xnKeycaps":
				drawKeycaps(part);
				break;
			case "xnLegend":
				drawLegend(part);
				break;
			case "xnLevelMeter":
				drawLevelMeter(part);
				break;
			case "xnMicroPara":
				drawMicroPara(part);
				break;
			case "xnPager":
				drawPager(part);
				break;
			case "xnPrompt":
				drawPrompt(part);
				break;
			case "xnRemain":
				drawRemain(part);
				break;
			case "xnSearch":
				drawSearch(part);
				break;
			case "xnSliders":
				drawSliders(part);
				break;
			case "xnSparkline":
				drawSparkline(part);
				break;
			case "xnStars":
				drawStars(part);
				break;
			case "xnSyllables":
				drawSyllables(part);
				break;
			case "xnTicker":
				drawTicker(part);
				break;
			case "xnTimeline":
				drawTimeline(part);
				break;
			case "xnTooltip":
				drawTooltip(part);
				break;
			case "xnTrackList":
				drawTrackList(part);
				break;
			case "xnTyping":
				drawTyping(part);
				break;
			case "xnVersionTags":
				drawVersionTags(part);
				break;
			case "xnVowels":
				drawVowels(part);
				break;
		}
	}
	return true;
}

/**
 * The pack's `D` wrapper: main-pass small text + thin widgets that start a
 * moment after the cut (t = lt − 0.04, as in the source) and fade out with
 * the cut.
 */
function decorPartOf(draw: CoreDecorDraw): X2Part | null {
	const cut = draw.frame.cut;
	if (!cut) return null;
	const lt = secondsOf(draw.frame);
	const t = lt - 0.04;
	if (!(t > 0)) return null;
	const o = 1 - inCubic(draw.frame.exitProgress);
	if (o <= 0.003) return null;
	const plan = coreDecorPlan(draw);
	const palette: MotionTextPalette = draw.frame.palette;
	const seed = plan.seed;
	const env: X2Env = {
		ctx: draw.ctx,
		W: draw.width,
		H: draw.height,
		dur: cut.duration / TICKS_PER_SECOND,
		font: {
			family: draw.frame.font.family,
			style: draw.frame.font.style,
			weight: draw.frame.font.weight,
		},
		index: Math.abs(seed >> 3) % 8,
		line: Math.abs(seed) % 8,
		lt,
		ltb: lt,
		motion: 1,
		seed,
		step: Math.floor(lt * 60),
		text: String(cut.text).replace(/\s+/gu, " ").trim(),
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
			r: randomUnit(seed, 11),
			right: plan.right,
			seed,
			v: plan.to,
		},
		t,
		o,
		u: unitOf(env),
	};
}

/* ============================================================ typed / text lines */

/** 入力行 — a shell prompt that types the cut as a command, answers, and leaves a blinking block cursor. */
function drawPrompt(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env);
	const pre = ["$ say", "> print", ">>> sing", "# echo"][p.v % 4]!;
	const body = `"${clipText(env.text, 14)}"`;
	const wp = textWidth(pre, fs) + fs * 0.6;
	const w = wp + textWidth(body, fs) + fs * 0.9;
	const lh = fs * 1.55;
	const h = lh * 3;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const e0 = ein(t, 0.25);
	const cp = charsOf(pre);
	const cb = charsOf(body);
	const nT = cp.length + cb.length;
	const dT = Math.min(0.75, nT * 0.045);
	const k = Math.floor(nT * cl((t - 0.12) / dT) + 1e-6);
	const kb = Math.max(0, k - cp.length);
	const y1 = sp.y + lh * 0.5;
	const sb = cb.slice(0, kb).join("");
	T(env, cp.slice(0, k).join(""), sp.x, y1, fs, { c: env.sc.accent, a: A * e0 });
	T(env, sb, sp.x + wp, y1, fs, { c: env.sc.fg, a: A * 0.9 });
	const done = t > 0.12 + dT + 0.18;
	const blink = Math.floor(env.ltb * 2.6) % 2 === 0;
	if (!done) {
		box(
			env,
			sp.x + (kb > 0 ? wp + textWidth(sb, fs) : textWidth(cp.slice(0, k).join(""), fs)) + fs * 0.15,
			y1 - fs * 0.55,
			fs * 0.55,
			fs * 1.1,
			env.sc.fg,
			A * 0.85 * e0,
		);
	} else {
		const n = glyphsOf(env.text).length;
		const e2 = ein(t, 0.25, 0.12 + dT + 0.18);
		T(env, `[ok] ${n} glyph${n === 1 ? "" : "s"} out`, sp.x, y1 + lh, fs * 0.92, { a: A * e2 });
		T(env, pre.split(" ")[0]!, sp.x, y1 + lh * 2, fs, { c: env.sc.accent, a: A * e2 });
		if (blink) {
			box(
				env,
				sp.x + textWidth(pre.split(" ")[0]!, fs) + fs * 0.5,
				y1 + lh * 2 - fs * 0.55,
				fs * 0.55,
				fs * 1.1,
				env.sc.fg,
				A * 0.85 * e2,
			);
		}
	}
}

/** 小さな段落 — the lyric line repeated as a tiny set paragraph with a pilcrow and a side rule, revealed line by line. */
function drawMicroPara(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const src = glyphsOf(env.text).length ? env.text : "lyric";
	const cj = hasCJK(src);
	const fs = fsOf(env) * 0.82;
	const per = cj ? 12 : 24;
	const nL = 3 + p.n;
	const lh = fs * 1.6;
	const unit = charsOf(src + (cj ? "／" : " / "));
	const lines: string[] = [];
	for (let i = 0; i < nL; i += 1) {
		let s = "";
		for (let j = 0; j < per; j += 1) s += unit[(i * per + j) % unit.length]!;
		lines.push(s.trim());
	}
	let w = 0;
	for (const s of lines) w = Math.max(w, textWidth(s, fs, 0.04));
	const ind = fs * 1.5;
	const W2 = w + ind;
	const h = nL * lh;
	const sp = spot(env, bb, W2, h, p, 24 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const rt = p.right;
	const rx = rt ? sp.x + W2 : sp.x;
	segs(env, [[rx, sp.y, rx, sp.y + h * ein(t, 0.5)]], p.accent ? env.sc.accent : env.sc.sub, Math.max(1, 1.5 * u), A * 0.9);
	T(env, "¶", rt ? sp.x + W2 - ind * 0.45 : sp.x + ind * 0.45, sp.y + lh * 0.5, fs * 1.15, {
		c: env.sc.accent,
		a: A * ein(t, 0.3, 0.1),
		al: "center",
	});
	for (let i = 0; i < nL; i += 1) {
		const e = ein(t, 0.4, 0.08 + i * 0.07, outCubic);
		if (e <= 0) continue;
		T(env, lines[i]!, rt ? sp.x + w + (1 - e) * -10 * u : sp.x + ind + (1 - e) * 10 * u, sp.y + lh * (i + 0.5), fs, {
			a: A * e * (i === 0 ? 0.95 : 0.6),
			c: i === 0 ? env.sc.fg : env.sc.sub,
			al: rt ? "right" : "left",
		});
	}
}

/** 脚注 — a reference mark beside the lyric and its footnote (short rule + note line) at the foot of the screen. */
function drawFootnote(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env);
	const fs = fsOf(env);
	const mk = ["*", "†", "※", "‡"][p.v % 4]!;
	const ac = env.sc.accent;
	const ms = fs * 1.7;
	const e0 = ein(t, 0.35, 0.1, (v) => oBack(v, 1.8));
	let mx = bb.x1 + ms * 0.55;
	let my = bb.y0 + ms * 0.1;
	if (mx > W - m * 0.5) {
		mx = cl((bb.x0 + bb.x1) / 2, m, W - m);
		my = bb.y0 - ms * 0.7;
	}
	if (my > m * 0.4 && e0 > 0) {
		const ctx = env.ctx;
		ctx.save();
		ctx.translate(mx, my);
		ctx.scale(e0, e0);
		T(env, mk, 0, 0, ms, { c: ac, a: o, al: "center" });
		ctx.restore();
	}
	const rj = romajiOf(env.text.replace(/[、。！？!?,.・「」]/gu, " ").trim());
	const note = rj || env.text;
	const txt = clipText(note, hasCJK(note) ? 26 : 44);
	const nw = textWidth(txt, fs * 0.9, 0.05) + fs * 1.4;
	const h = fs * 2.3;
	let below = !(H - bb.y1 < h + m + 16 * u);
	if (!below && bb.y0 < h + m + 16 * u) below = H - bb.y1 > bb.y0;
	const y0 = below ? H - m - h : m;
	const A =
		o *
		(hit(0, y0, W, y0 + h, bb, 4 * u) && bb.x0 < m + nw && bb.x1 > m ? 0.3 : 1);
	const x0 = p.right ? W - m - nw : m;
	const e1 = ein(t, 0.45, 0.25);
	segs(env, [[x0, y0, x0 + Math.min(nw, 150 * u) * e1, y0]], env.sc.sub, Math.max(1, u), A * 0.8);
	T(env, mk, x0, y0 + fs * 1.25, fs * 1.05, { c: ac, a: A * e1 });
	const cs = charsOf(txt);
	const k = Math.ceil(cs.length * cl((t - 0.35) / Math.min(0.7, cs.length * 0.03)));
	T(env, cs.slice(0, k).join(""), x0 + fs * 1.3, y0 + fs * 1.3, fs * 0.9, { a: A * 0.85 });
}

/** 差分表示 — a two-line diff: the old wording struck out, the new one added on a tinted row. */
function drawDiff(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env);
	const lh = fs * 1.7;
	const ac = env.sc.accent;
	const g = charsOf(env.text);
	const neu = clipText(env.text, 14);
	const old =
		g.length > 2
			? clipText(g.slice(0, Math.max(1, g.length - 1 - (p.v % 2))).join(""), 12) +
				(hasCJK(neu) ? "？" : "?")
			: "……";
	const ln = env.line + 1;
	const gut = fs * 2.1;
	const sg = fs * 1.2;
	const w = gut + sg + Math.max(textWidth(neu, fs), textWidth(old, fs)) + fs * 0.8;
	const h = lh * 2 + fs * 1.3;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	T(env, "@@ lyric.txt @@", sp.x, sp.y + fs * 0.5, fs * 0.72, { a: A * 0.7 * ein(t, 0.3) });
	const y1 = sp.y + fs * 1.3 + lh * 0.5;
	const y2 = y1 + lh;
	const e1 = ein(t, 0.35, 0.08);
	const e2 = ein(t, 0.4, 0.32);
	T(env, pad2(ln), sp.x, y1, fs * 0.8, { a: A * 0.6 * e1 });
	T(env, pad2(ln + 1), sp.x, y2, fs * 0.8, { a: A * 0.6 * e2 });
	T(env, "-", sp.x + gut, y1, fs, { a: A * e1 });
	T(env, old, sp.x + gut + sg, y1, fs, { a: A * 0.75 * e1 });
	const ow = textWidth(old, fs);
	segs(
		env,
		[[sp.x + gut + sg - 3 * u, y1, sp.x + gut + sg - 3 * u + (ow + 6 * u) * ein(t, 0.3, 0.45, inOutCubic), y1]],
		env.sc.sub,
		Math.max(1, 1.4 * u),
		A,
	);
	box(env, sp.x + gut - fs * 0.3, y2 - lh * 0.46, (w - gut + fs * 0.3) * e2, lh * 0.92, ac, A * 0.16);
	T(env, "+", sp.x + gut, y2, fs, { c: ac, a: A * e2 });
	const cs = charsOf(neu);
	const k = Math.ceil(cs.length * cl((t - 0.4) / Math.min(0.5, cs.length * 0.04)));
	T(env, cs.slice(0, k).join(""), sp.x + gut + sg, y2, fs, { c: env.sc.fg, a: A * 0.95 });
}

/** 音節分け — the cut respelled glyph by glyph (kana → romaji) as spaced syllable chips joined by mid dots. */
function drawSyllables(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const toks = syllables(env.text);
	if (toks.length === 0) return;
	const { W } = env;
	const m = marginOf(env);
	let fs = fsOf(env) * 1.05;
	let gap = 0;
	let ws: number[] = [];
	let tot = 0;
	for (let it = 0; it < 4; it += 1) {
		gap = fs * 1.1;
		ws = toks.map(([s]) => textWidth(s, fs, 0.04));
		tot = ws.reduce((a, b) => a + b, 0) + gap * (toks.length - 1);
		if (tot <= W - m * 2.4) break;
		fs *= 0.8;
	}
	const h = fs * 2.2;
	const sp = band(env, bb, tot, h, p, 20 * u + bh(bb) * 0.06);
	const A = o * (sp.ok ? 1 : 0.3);
	const y = sp.y + h * 0.42;
	let px = sp.x;
	for (let i = 0; i < toks.length; i += 1) {
		const e = ein(t, 0.3, 0.08 + i * 0.055, outCubic);
		T(env, toks[i]![0], px + ws[i]! / 2, y + (1 - e) * fs * 0.5, fs, {
			a: A * e,
			c: toks[i]![1] ? env.sc.sub : env.sc.fg,
			al: "center",
		});
		if (i < toks.length - 1) {
			dot(env, px + ws[i]! + gap / 2, y, 1.8 * u * e, p.accent ? env.sc.accent : env.sc.sub, A * 0.9);
		}
		px += ws[i]! + gap;
	}
	const e2 = ein(t, 0.5, 0.25);
	const yb = sp.y + h * 0.92;
	stroke(
		env,
		part(
			[
				[sp.x, yb - 5 * u],
				[sp.x, yb],
				[sp.x + tot, yb],
				[sp.x + tot, yb - 5 * u],
			],
			e2,
		),
		env.sc.accent,
		Math.max(1, 1.2 * u),
		A * 0.8,
	);
}

/* ============================================================ readouts */

/** 字種の内訳 — a stacked proportion bar of the cut's kanji / kana / latin glyphs with counted labels. */
function drawGlyphStats(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const g = glyphsOf(env.text).filter((c) => !isPunct(c));
	if (g.length === 0) return;
	const cnt = [0, 0, 0, 0];
	for (const c of g) {
		const idx = isKanji(c) ? 0 : isHira(c) || isKata(c) ? 1 : isLatin(c) ? 2 : 3;
		cnt[idx] = (cnt[idx] ?? 0) + 1;
	}
	const names = ["漢字", "かな", "ABC", "他"];
	const pal = [env.sc.fg, env.sc.accent, env.sc.accent2, env.sc.sub];
	let ci = 0;
	const fs = fsOf(env) * 0.9;
	const w = cl(bw(bb) * 0.6, 220 * u, 340 * u);
	const barH = Math.max(6, 9 * u);
	const h = fs * 1.5 + barH + fs * 1.9;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const e = ein(t, 0.55, 0.05);
	T(env, "GLYPHS", sp.x, sp.y + fs * 0.5, fs * 0.8, { a: A * ein(t, 0.3) });
	T(env, pad2(Math.round(g.length * e)), sp.x + w, sp.y + fs * 0.5, fs, {
		al: "right",
		c: env.sc.fg,
		a: A,
	});
	const by = sp.y + fs * 1.5;
	let px = sp.x;
	let lx = sp.x;
	box(env, sp.x, by, w * e, barH, env.sc.sub, A * 0.18);
	for (let i = 0; i < 4; i += 1) {
		if (!cnt[i]) continue;
		const sw = (w * cnt[i]!) / g.length;
		const e2 = ein(t, 0.45, 0.15 + i * 0.1, outCubic);
		const col = pal[ci++ % 4]!;
		box(env, px + 1, by, Math.max(0, sw * e2 - 2), barH, col, A);
		box(env, lx, by + barH + fs * 0.75, fs * 0.55, fs * 0.55, col, A * e2);
		const lab = `${names[i]!} ${Math.round(cnt[i]! * e2)}`;
		T(env, lab, lx + fs * 0.85, by + barH + fs * 1.03, fs * 0.82, { a: A * e2 * 0.9 });
		lx += fs * 0.85 + textWidth(lab, fs * 0.82) + fs * 0.9;
		px += sw;
	}
}

/** 隅の座標 — coordinates of the bounding-box corners: small crosses with x / y readouts that roll to their values. */
function drawBoxCoords(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env) * 0.5;
	const fs = fsOf(env) * 0.8;
	const pd = 12 * u;
	const c = p.accent ? env.sc.accent : env.sc.fg;
	const k = 6 * u;
	const all: readonly (readonly [number, number, number, number, string])[] = [
		[bb.x0, bb.y0, -1, -1, "TL"],
		[bb.x1, bb.y1, 1, 1, "BR"],
		[bb.x1, bb.y0, 1, -1, "TR"],
		[bb.x0, bb.y1, -1, 1, "BL"],
	];
	const list = p.big ? all : p.v % 2 ? all.slice(2) : all.slice(0, 2);
	list.forEach(([px0, py0, sx, sy, nm], i) => {
		const e = ein(t, 0.45, i * 0.08);
		const px = cl(px0 + sx * pd * (2 - e), m, W - m);
		const py = cl(py0 + sy * pd * (2 - e), m, H - m);
		segs(
			env,
			[
				[px - k, py, px + k, py],
				[px, py - k, px, py + k],
			],
			c,
			Math.max(1, 1.3 * u),
			o * e,
		);
		const txt = `${nm} ${pad2(px0 * e, 4)},${pad2(py0 * e, 4)}`;
		const wt = textWidth(txt, fs);
		let ty = py + sy * (k + fs * 0.9);
		if (ty < m + fs * 0.5 || ty > H - m - fs * 0.5) ty = py - sy * (k + fs * 0.9);
		const tx = sx < 0 ? cl(px - k, m, W - m - wt) : cl(px + k - wt, m, W - m - wt);
		if (!hit(tx, ty - fs * 0.6, tx + wt, ty + fs * 0.6, bb, 0)) {
			T(env, txt, tx, ty, fs, { a: o * e * 0.9 });
		}
	});
}

/** 残り時間 — a countdown of the time left in the cut over a rule that shortens toward zero. */
function drawRemain(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env);
	const dur = Math.max(0.2, env.dur || 1);
	const rem = Math.max(0, dur - env.lt);
	const fr = cl(rem / dur);
	const w = 230 * u;
	const h = fs * 3.6;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const e = ein(t, 0.45);
	const hot = fr < 0.22;
	const c = hot ? env.sc.accent : env.sc.fg;
	T(env, "REMAIN", sp.x, sp.y + fs * 0.45, fs * 0.72, { a: A * e * 0.8 });
	T(env, `-${fmtTime(rem)}`, sp.x + w, sp.y + fs * 1.6 + (1 - e) * fs * 0.4, fs * 1.45, {
		al: "right",
		c,
		a: A * e,
	});
	const y = sp.y + h - fs * 0.5;
	const n = Math.min(12, Math.ceil(dur));
	const tk: (readonly [number, number, number, number])[] = [];
	for (let i = 0; i <= n; i += 1) {
		const px = sp.x + w - w * Math.min(1, i / dur);
		tk.push([px, y - 4 * u, px, y + 4 * u]);
	}
	segs(env, tk, env.sc.sub, Math.max(1, u), A * 0.6 * e);
	segs(env, [[sp.x, y, sp.x + w * e, y]], env.sc.sub, Math.max(1, u), A * 0.35);
	segs(env, [[sp.x + w - w * fr * e, y, sp.x + w, y]], c, Math.max(2, 3 * u), A);
	dot(env, sp.x + w - w * fr * e, y, 4 * u, c, A);
}

/** 文字ゲージ — an ASCII progress gauge [####----] with a spinner glyph and percent, set character by character. */
function drawAsciiGauge(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 1.05;
	const N = 12 + 4 * (p.n - 1);
	const cw = fs * 0.66;
	const dur = Math.max(0.3, env.dur || 1);
	const pr = cl((env.lt - 0.2) / Math.max(0.2, dur * 0.88 - 0.2));
	const k = Math.floor(pr * N + 1e-6);
	const w = cw * (N + 2) + fs * 3.4;
	const h = fs * 2.9;
	const sp = band(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const y = sp.y + fs * 2.1;
	const fillC = ["#", "=", "|", "■"][p.v % 4]!;
	const ac = env.sc.accent;
	const spin = pr >= 1 ? "✓" : "|/-\\"[Math.floor(env.ltb * 9) % 4] ?? "|";
	T(env, spin, sp.x + cw * 0.5, sp.y + fs * 0.6, fs * 0.85, { al: "center", c: ac, a: A * ein(t, 0.3) });
	T(env, pr >= 1 ? "done" : "rendering", sp.x + cw * 1.4, sp.y + fs * 0.6, fs * 0.8, { a: A * ein(t, 0.3) });
	for (let i = 0; i < N + 2; i += 1) {
		const e = ein(t, 0.2, i * 0.018, outCubic);
		if (e <= 0) continue;
		const ch = i === 0 ? "[" : i === N + 1 ? "]" : i - 1 < k ? fillC : "-";
		const on = i > 0 && i <= N && i - 1 < k;
		const hop = on && i - 1 === k - 1 && pr < 1 ? fs * 0.3 * Math.exp(-((pr * N) % 1) * 5) : 0;
		T(env, ch, sp.x + cw * (i + 0.5), y - hop, fs, {
			al: "center",
			c: on ? ac : i === 0 || i === N + 1 ? env.sc.fg : env.sc.sub,
			a: A * e * (on || i === 0 || i === N + 1 ? 1 : 0.6),
		});
	}
	T(env, `${pad2(pr * 100, 3)}%`, sp.x + w, y, fs, {
		al: "right",
		c: env.sc.fg,
		a: A * ein(t, 0.3, 0.2),
	});
}

/** パンくず — a breadcrumb path (song › line › cut › word) whose levels slide in one after another. */
function drawBreadcrumb(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.95;
	const items: readonly (readonly [string, number])[] = [
		[["song", "lyrics", "home", "track"][p.v % 4]!, 0],
		[`line ${pad2(env.line + 1)}`, 0],
		[`cut ${pad2(env.index + 1)}`, 0],
		[clipText(env.text, 7), 0],
	];
	const gap = fs * 1.5;
	const ws = items.map(([s]) => textWidth(s, fs));
	const tot = ws.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
	const h = fs * 1.6;
	const sp = band(env, bb, tot, h, p, 22 * u + bh(bb) * 0.05);
	const A = o * (sp.ok ? 1 : 0.3);
	const y = sp.y + h / 2;
	let px = sp.x;
	items.forEach(([s], i) => {
		const e = ein(t, 0.35, i * 0.13);
		const last = i === items.length - 1;
		T(env, s, px - (1 - e) * 14 * u, y, fs, {
			a: A * e * (last ? 1 : 0.8),
			c: last ? env.sc.fg : env.sc.sub,
		});
		if (last) {
			segs(env, [[px, y + fs * 0.75, px + ws[i]! * ein(t, 0.4, 0.55), y + fs * 0.75]], env.sc.accent, Math.max(1.5, 2 * u), A);
		} else {
			const cx = px + ws[i]! + gap / 2;
			const k = fs * 0.24;
			stroke(
				env,
				[
					[cx - k * 0.6, y - k],
					[cx + k * 0.6, y],
					[cx - k * 0.6, y + k],
				],
				env.sc.accent,
				Math.max(1, 1.4 * u),
				A * e,
			);
		}
		px += ws[i]! + gap;
	});
}

/** 版数タグ — version / file-name style pills (v1.03, take 02, draft) that pop open in a row. */
function drawVersionTags(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.9;
	const ln = env.line + 1;
	const ix = env.index + 1;
	const ac = env.sc.accent;
	const word = ["draft", "final", "beta", "wip", "stable", "demo"][p.v % 6]!;
	const tags = [`v${1 + (ln % 3)}.${pad2(ix)}`, word, `take ${pad2(ln)}`].slice(0, 1 + p.n);
	const ph = fs * 1.9;
	const px = fs * 0.8;
	const gap = fs * 0.55;
	const ws = tags.map((s) => textWidth(s, fs) + px * 2);
	const tot = ws.reduce((a, b) => a + b, 0) + gap * (tags.length - 1);
	const sp = spot(env, bb, tot, ph, p, 20 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	let x0 = sp.x;
	tags.forEach((s, i) => {
		const e = ein(t, 0.4, 0.05 + i * 0.12, (z) => oBack(z, 1.4));
		const w = ws[i]! * cl(e, 0, 1.06);
		const fill = i === ((p.accent ? 0 : 1) % tags.length);
		rr(env, x0, sp.y, w, ph, p.big ? 4 * u : ph / 2, fill ? ac : null, A * cl(e * 2), fill ? undefined : env.sc.sub, Math.max(1, 1.2 * u));
		T(env, s, x0 + ws[i]! / 2, sp.y + ph / 2, fs, {
			al: "center",
			c: fill ? onC(env, ac) : env.sc.fg,
			a: A * ein(t, 0.25, 0.2 + i * 0.12),
		});
		x0 += ws[i]! + gap;
	});
}

/** ヒント吹き出し — a small filled tooltip with a pointer aimed at the lyric, naming the font or the reading. */
function drawTooltip(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env);
	const fs = fsOf(env) * 0.9;
	const rj = romajiOf(env.text.replace(/[、。！？!?,.・「」]/gu, " ").trim());
	const cj = hasCJK(env.text);
	const txt =
		p.v % 3 === 0
			? env.font.family.replace(/_/gu, " ")
			: p.v % 3 === 1
				? cj
					? "クリックして編集"
					: "click to edit"
				: rj
					? clipText(rj, 22)
					: cj
						? "テキストレイヤー"
						: "text layer";
	const w = textWidth(txt, fs) + fs * 1.6;
	const h = fs * 2;
	const tip = 9 * u;
	const gap = 10 * u + bh(bb) * 0.04;
	let below = p.low;
	if (below ? bb.y1 + gap + tip + h > H - m : bb.y0 - gap - tip - h < m) below = !below;
	const ok = below
		? bb.y1 + gap + tip + h <= H - m * 0.6
		: bb.y0 - gap - tip - h >= m * 0.6;
	const A = o * (ok ? 1 : 0.3);
	const ax = cl(lerpN(bb.x0, bb.x1, p.right ? 0.72 : 0.28), m + 20 * u, W - m - 20 * u);
	const ay = below ? bb.y1 + gap : bb.y0 - gap;
	const e = ein(t, 0.35, 0.3, (z) => oBack(z, 1.7));
	if (e <= 0) return;
	const bob = Math.sin(env.ltb * 2.2) * 2 * u * env.motion;
	const s = below ? 1 : -1;
	const x0 = cl(ax - w / 2, m, W - m - w);
	const ctx = env.ctx;
	const c = env.sc.fg;
	ctx.save();
	ctx.translate(ax, ay + bob);
	ctx.scale(e, e);
	ctx.translate(-ax, -ay);
	fillPoly(env, [[ax, ay], [ax - tip * 0.8, ay + s * (tip + 1)], [ax + tip * 0.8, ay + s * (tip + 1)]], c, A);
	rr(env, x0, below ? ay + tip : ay - tip - h, w, h, 5 * u, c, A);
	T(env, txt, x0 + w / 2, (below ? ay + tip : ay - tip - h) + h / 2, fs, {
		al: "center",
		c: onC(env, c),
		a: A,
	});
	ctx.restore();
}

/* ============================================================ charts */

/** スパークライン — a tiny trend line that draws on, with its low / high marked and the latest value at the head. */
function drawSparkline(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.85;
	const w = 190 * u + 40 * u * p.n;
	const gh = 46 * u;
	const h = gh + fs * 1.6;
	const n = 18;
	const sp = spot(env, bb, w + fs * 3.2, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const vals: number[] = [];
	let lo = 0;
	let hi = 0;
	for (let i = 0; i < n; i += 1) {
		const v =
			0.5 +
			0.42 * noise1(i * 0.55, p.seed) +
			(i / n - 0.5) * 0.35 * (p.right ? 1 : -1) +
			randomSigned(p.seed, i, 3) * 0.07;
		vals.push(v);
		if (v < vals[lo]!) lo = i;
		if (v > vals[hi]!) hi = i;
	}
	const mn = vals[lo]!;
	const mx = vals[hi]!;
	const Y = (v: number): number => sp.y + fs * 1.4 + gh * (1 - (v - mn) / Math.max(0.001, mx - mn));
	const X = (i: number): number => sp.x + (w * i) / (n - 1);
	const pts: X2Pt[] = vals.map((v, i): X2Pt => [X(i), Y(v)]);
	const e = ein(t, 0.8, 0.1, inOutCubic);
	const head = part(pts, e);
	T(env, ["TREND", "PULSE", "MOOD", "TEMPO"][p.v % 4]!, sp.x, sp.y + fs * 0.5, fs * 0.82, {
		a: A * ein(t, 0.3),
	});
	stroke(
		env,
		[
			[sp.x, sp.y + fs * 1.4 + gh],
			[sp.x + w * ein(t, 0.4), sp.y + fs * 1.4 + gh],
		],
		env.sc.sub,
		Math.max(1, u),
		A * 0.5,
		{ dash: [2 * u, 4 * u] },
	);
	stroke(env, head, env.sc.fg, Math.max(1.4, 2 * u), A);
	if (e > lo / (n - 1)) ring(env, X(lo), Y(mn), 3.5 * u, env.sc.sub, Math.max(1, 1.2 * u), A);
	if (e > hi / (n - 1)) ring(env, X(hi), Y(mx), 3.5 * u, ac, Math.max(1, 1.2 * u), A);
	if (head.length) {
		const q = head[head.length - 1]!;
		const cur = 0.12 + 0.8 * cl(1 - (q[1] - sp.y - fs * 1.4) / gh);
		dot(env, q[0], q[1], 4 * u, ac, A);
		T(env, (cur * 100).toFixed(1), sp.x + w + fs * 0.5, cl(q[1], sp.y + fs * 1.4, sp.y + fs * 1.4 + gh), fs, {
			c: env.sc.fg,
			a: A * ein(t, 0.3, 0.2),
		});
	}
}

/** 母音グラフ — horizontal bars counting the vowels (A I U E O) sung in the lyric line; glyph counts when there are none. */
function drawVowels(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const g = glyphsOf(env.text.toLowerCase()).filter((c) => !isPunct(c));
	if (g.length === 0) return;
	const cv: Record<string, number> = { a: 0, i: 0, u: 0, e: 0, o: 0 };
	let tot = 0;
	for (const c of g) {
		const r = isHira(c) || isKata(c) ? romajiOfGroup(c) : /^[a-z]$/.test(c) ? c : null;
		if (r) {
			for (const ch of r) {
				if (cv[ch] != null) {
					cv[ch] = cv[ch]! + 1;
					tot += 1;
				}
			}
		}
	}
	let rows: (readonly [string, number])[];
	const vow = tot >= 2;
	if (vow) {
		const vowRows: (readonly [string, number])[] = [];
		for (const v of ["a", "i", "u", "e", "o"]) vowRows.push([v.toUpperCase(), cv[v] ?? 0]);
		rows = vowRows;
	} else {
		const map = new Map<string, number>();
		g.forEach((c) => map.set(c, (map.get(c) ?? 0) + 1));
		rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3 + p.n);
	}
	const mx = Math.max(1, ...rows.map((r2) => r2[1]));
	const top = rows.findIndex((r2) => r2[1] === mx);
	const fs = fsOf(env);
	const rh = fs * 1.45;
	const barW = 150 * u;
	const w = fs * 1.6 + barW + fs * 1.8;
	const h = rows.length * rh;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const x0 = sp.x + fs * 1.6;
	segs(env, [[x0 - 4 * u, sp.y, x0 - 4 * u, sp.y + h * ein(t, 0.4)]], env.sc.sub, Math.max(1, u), A * 0.7);
	rows.forEach(([c, n], i) => {
		const e = ein(t, 0.5, 0.1 + i * 0.07);
		const y = sp.y + rh * (i + 0.5);
		const bwd = Math.max(2 * u, barW * (n / mx)) * e;
		T(env, c, sp.x + fs * 0.6, y, fs, { al: "center", c: env.sc.fg, a: A * cl(e * 2) * 0.9 });
		box(env, x0, y - rh * 0.26, bwd, rh * 0.52, i === top ? env.sc.accent : env.sc.sub, A * (i === top ? 1 : 0.55));
		T(env, String(Math.round(n * e)), x0 + bwd + fs * 0.4, y, fs * 0.85, { a: A * e });
	});
}

/** 凡例 — a chart legend: line / dash / dot samples keyed to pieces of the cut. */
function drawLegend(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const txt = env.text;
	const g = glyphsOf(txt);
	if (g.length === 0) return;
	let labs: string[];
	const wds = txt.split(" ").filter(Boolean);
	if (wds.length >= 2) {
		const k = Math.min(3, wds.length);
		const per = Math.ceil(wds.length / k);
		labs = [];
		for (let i = 0; i < wds.length; i += per) labs.push(wds.slice(i, i + per).join(" "));
	} else {
		const k = Math.min(3, g.length);
		const per = Math.ceil(g.length / k);
		labs = [];
		for (let i = 0; i < g.length; i += per) labs.push(g.slice(i, i + per).join(""));
	}
	labs = labs.slice(0, 3).map((s) => clipText(s, 9));
	const fs = fsOf(env) * 0.95;
	const rh = fs * 1.7;
	const sw = 34 * u;
	const pd = p.big ? fs * 0.8 : 0;
	const w = sw + fs * 0.7 + Math.max(...labs.map((s) => textWidth(s, fs))) + pd * 2;
	const h = labs.length * rh + pd * 2;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const cols = [env.sc.fg, env.sc.accent, env.sc.accent2];
	if (p.big) rr(env, sp.x, sp.y, w, h, 3 * u, null, A * 0.6 * ein(t, 0.3), env.sc.sub, Math.max(1, u));
	labs.forEach((s, i) => {
		const e = ein(t, 0.45, 0.08 + i * 0.12);
		const y = sp.y + pd + rh * (i + 0.5);
		const x0 = sp.x + pd;
		const k = (i + p.v) % 3;
		if (k === 0) segs(env, [[x0, y, x0 + sw * e, y]], cols[i]!, Math.max(2, 2.6 * u), A);
		else if (k === 1) {
			stroke(env, [[x0, y], [x0 + sw * e, y]], cols[i]!, Math.max(2, 2.6 * u), A, { dash: [6 * u, 4 * u] });
		} else {
			segs(env, [[x0, y, x0 + sw * e, y]], cols[i]!, Math.max(1, 1.2 * u), A);
			dot(env, x0 + sw * 0.5 * e, y, 4.5 * u * e, cols[i]!, A);
		}
		T(env, s, x0 + sw + fs * 0.7 + (1 - e) * 8 * u, y, fs, { a: A * e * 0.9 });
	});
}

/** グラフ軸 — x / y chart axes drawn round the lyric: ticks per glyph, arrow heads and axis titles. */
function drawAxes(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const m = marginOf(env) * 0.5;
	const fs = fsOf(env) * 0.78;
	const pd = 18 * u + Math.min(bw(bb), bh(bb)) * 0.1;
	const c = p.accent ? env.sc.accent : env.sc.fg;
	const lw = Math.max(1, 1.4 * u);
	const ox = Math.max(m, bb.x0 - pd);
	const oy = Math.min(H - m - fs * 1.7, bb.y1 + pd);
	const xe = Math.min(W - m, bb.x1 + pd * 1.7);
	const ye = Math.max(m, bb.y0 - pd * 1.7);
	if (oy < bb.y1 + 4 * u || ox > bb.x0 - 4 * u) return;
	const e1 = ein(t, 0.5, 0, inOutCubic);
	const e2 = ein(t, 0.5, 0.12, inOutCubic);
	const ah = 6 * u;
	const xx = lerpN(ox, xe, e1);
	const yy = lerpN(oy, ye, e2);
	segs(env, [[ox, oy, xx, oy], [ox, oy, ox, yy]], c, lw, o);
	stroke(env, [[xx - ah, oy - ah * 0.7], [xx, oy], [xx - ah, oy + ah * 0.7]], c, lw, o * cl(e1 * 3));
	stroke(env, [[ox - ah * 0.7, yy + ah], [ox, yy], [ox + ah * 0.7, yy + ah]], c, lw, o * cl(e2 * 3));
	const n = Math.max(
		1,
		Math.min(glyphsOf(env.text).length, 12, Math.floor(bw(bb) / (fs * 1.5))),
	);
	const tk: (readonly [number, number, number, number])[] = [];
	for (let i = 0; i < n; i += 1) {
		const px = bb.x0 + (bw(bb) * (i + 0.5)) / n;
		if (px > xx) break;
		tk.push([px, oy, px, oy + 6 * u]);
		if (n <= 8 || i % 2 === 0) {
			T(env, String(i + 1), px, oy + 6 * u + fs * 0.8, fs, {
				al: "center",
				a: o * ein(t, 0.3, 0.25 + i * 0.03) * 0.85,
			});
		}
	}
	for (let i = 0; i < 3; i += 1) {
		const y = lerpN(bb.y1, bb.y0, i / 2);
		if (y >= yy) tk.push([ox, y, ox - 6 * u, y]);
	}
	segs(env, tk, c, lw, o * 0.9);
	const cj = hasCJK(env.text);
	const e3 = ein(t, 0.35, 0.45);
	const tx = cj ? ["とき", "ことば"] : ["time", "words"];
	const ty = cj ? ["想い", "声"] : ["feeling", "voice"];
	if (xe - bb.x1 > 10 * u) T(env, tx[p.v % 2]!, xe, oy - fs * 0.9, fs, { al: "right", a: o * e3 * 0.9 });
	if (bb.y0 - ye > fs * 1.7) T(env, ty[p.v % 2]!, ox + 9 * u, ye + fs * 0.6, fs, { a: o * e3 * 0.9 });
}

/* ============================================================ meters / media */

/** レベルメーター — stereo L / R segment meters with a dB scale and peak-hold ticks, following the audio level. */
function drawLevelMeter(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.8;
	const N = 16;
	const sw = 12 * u;
	const sg = 4 * u;
	const shh = 12 * u;
	const rg = 8 * u;
	const lab = fs * 1.4;
	const w = lab + N * (sw + sg);
	const h = shh * 2 + rg + fs * 1.6;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const e = ein(t, 0.45);
	const ac = env.sc.accent;
	const x0 = sp.x + lab;
	// eslint-disable-next-line opencut/prefer-object-params -- lvl(ch, tt) mirrors the source pack's level closure
	const lvl = (ch: number, tt: number): number =>
		cl(
			(0.52 +
				0.36 * noise1(tt * 3.1 + ch * 7.3, p.seed + ch) +
				0.1 * Math.sin(tt * 9 + ch)) *
				e,
		);
	for (let ch = 0; ch < 2; ch += 1) {
		const y = sp.y + ch * (shh + rg);
		const L = lvl(ch, env.ltb);
		const k = Math.round(L * N);
		let pk = L;
		for (let j = 1; j <= 6; j += 1) pk = Math.max(pk, lvl(ch, env.ltb - j * 0.07) - j * 0.02);
		const pi = Math.min(N - 1, Math.round(pk * N));
		T(env, ch ? "R" : "L", sp.x, y + shh / 2, fs, { a: A * e, c: env.sc.fg });
		const nShow = Math.ceil(N * e);
		for (let i = 0; i < nShow; i += 1) {
			const on = i < k;
			const hotc = i >= N * 0.75;
			box(env, x0 + i * (sw + sg), y, sw, shh, on ? (hotc ? ac : env.sc.fg) : env.sc.sub, A * (on ? 1 : 0.22));
		}
		if (pi >= k) box(env, x0 + pi * (sw + sg), y, sw, shh, pi >= N * 0.75 ? ac : env.sc.fg, A * 0.9);
	}
	const ys = sp.y + shh * 2 + rg + fs * 0.95;
	const scale: readonly (readonly [string, number])[] = [
		["-24", 0.2],
		["-12", 0.5],
		["-6", 0.75],
		["0", 1],
	];
	for (const [s, f] of scale) {
		T(env, s, x0 + (N * (sw + sg) - sg) * f, ys, fs * 0.85, {
			al: f === 1 ? "right" : "center",
			a: A * e * 0.8,
		});
	}
	T(env, "dB", x0, ys, fs * 0.85, { a: A * e * 0.8 });
}

/** タイムライン — an editor's mini timeline: tracks of clips, the current clip lit, a playhead crossing it. */
function drawTimeline(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.72;
	const nT = 2 + (p.n > 1 ? 1 : 0);
	const th = 15 * u;
	const tg = 6 * u;
	const lab = fs * 2;
	const w = 340 * u;
	const ruler = 13 * u;
	const h = ruler + nT * (th + tg);
	const sp = spot(env, bb, w + lab, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const x0 = sp.x + lab;
	const ac = env.sc.accent;
	const e = ein(t, 0.5);
	const tk: (readonly [number, number, number, number])[] = [];
	for (let i = 0; i <= 30; i += 1) {
		const px = x0 + (w * i) / 30;
		if (px > x0 + w * e) break;
		tk.push([px, sp.y + ruler - 3 * u, px, sp.y + ruler - (i % 5 ? 6 : 10) * u]);
	}
	segs(env, tk, env.sc.sub, Math.max(1, u), A * 0.6);
	let c0 = 0.3;
	let c1 = 0.7;
	for (let k = 0; k < nT; k += 1) {
		const y = sp.y + ruler + k * (th + tg);
		T(env, ["V1", "A1", "A2"][k]!, sp.x, y + th / 2, fs, { a: A * e * 0.8 });
		let px = randomUnit(p.seed, k, 1) * 0.08;
		let i = 0;
		while (px < 0.98 && i < 6) {
			const len = Math.min(1 - px, 0.14 + randomUnit(p.seed, k, i, 2) * 0.26);
			const cur = k === 0 && i === 1;
			const ee = ein(t, 0.45, 0.05 + i * 0.05 + k * 0.04);
			const off = (1 - ee) * 40 * u;
			if (cur) {
				c0 = px;
				c1 = px + len;
			}
			rr(
				env,
				x0 + px * w + off,
				y,
				Math.max(2, len * w - 3 * u),
				th,
				2.5 * u,
				cur ? ac : k ? env.sc.sub : env.sc.fg,
				A * ee * (cur ? 0.95 : k ? 0.3 : 0.38),
			);
			px += len + 0.012;
			i += 1;
		}
	}
	const pr = cl(env.lt / Math.max(0.2, env.dur || 1));
	const px = x0 + w * lerpN(c0, c1, pr) * e;
	const c = env.sc.fg;
	segs(env, [[px, sp.y + ruler - 2 * u, px, sp.y + h - tg]], c, Math.max(1.2, 1.6 * u), A);
	fillPoly(
		env,
		[
			[px - 5 * u, sp.y],
			[px + 5 * u, sp.y],
			[px + 5 * u, sp.y + 5 * u],
			[px, sp.y + ruler - 2 * u],
			[px - 5 * u, sp.y + 5 * u],
		],
		c,
		A * e,
	);
}

/** 曲順リスト — a playlist: skeleton rows, the current row carrying the lyric line and bouncing now-playing bars. */
function drawTrackList(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.9;
	const rows = 3 + (p.n > 2 ? 1 : 0);
	const rh = fs * 1.9;
	const w = 290 * u;
	const h = rows * rh;
	const cur = 1;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const base = env.line + 1;
	const nx = fs * 1.9;
	for (let i = 0; i < rows; i += 1) {
		const e = ein(t, 0.4, i * 0.08);
		const y = sp.y + rh * (i + 0.5);
		const dx = (1 - e) * 18 * u;
		const is = i === cur;
		if (i > 0) segs(env, [[sp.x, sp.y + rh * i, sp.x + w * e, sp.y + rh * i]], env.sc.sub, Math.max(1, 0.8 * u), A * 0.3);
		if (is) {
			const b: (readonly [number, number, number, number])[] = [];
			for (let k = 0; k < 3; k += 1) {
				const hh = fs * (0.25 + 0.6 * Math.abs(Math.sin(env.ltb * (5 + k * 1.7) + k * 2))) * e;
				b.push([sp.x + k * 5 * u + 1.5 * u, y + fs * 0.45, sp.x + k * 5 * u + 1.5 * u, y + fs * 0.45 - hh]);
			}
			segs(env, b, ac, 3 * u, A);
			T(env, clipText(env.text, hasCJK(env.text) ? 11 : 20), sp.x + nx + dx, y, fs, {
				c: env.sc.fg,
				a: A * e * 0.95,
			});
		} else {
			T(env, pad2(Math.max(1, base - cur + i)), sp.x + dx, y, fs * 0.85, { a: A * e * 0.7 });
			rr(env, sp.x + nx + dx, y - fs * 0.22, w * (0.25 + 0.3 * randomUnit(p.seed, i, 5)) * e, fs * 0.44, fs * 0.22, env.sc.sub, A * 0.32);
		}
		T(env, `${2 + (hOf(p.seed, i, 7) % 3)}:${pad2(hOf(p.seed, i, 8) % 60)}`, sp.x + w, y, fs * 0.82, {
			al: "right",
			a: A * e * (is ? 0.9 : 0.55),
		});
	}
}

/** 星評価 — a five-star rating whose stars fill one by one (half stars included) with its score. */
const STAR: readonly X2Pt[] = (() => {
	const a: X2Pt[] = [];
	for (let i = 0; i < 10; i += 1) {
		const an = -90 * DEG + (i * TAU) / 10;
		const r = i % 2 ? 0.42 : 1;
		a.push([Math.cos(an) * r, Math.sin(an) * r]);
	}
	return a;
})();

function drawStars(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const R = 13 * u + 3 * u * p.n;
	const gap = R * 2.35;
	const fs = fsOf(env);
	const rating = 3.5 + (hOf(p.seed, 3) % 4) * 0.5;
	const w = gap * 4 + R * 2 + fs * 2.4;
	const h = R * 2.1;
	const sp = spot(env, bb, w, h, p, 20 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const ctx = env.ctx;
	for (let i = 0; i < 5; i += 1) {
		const cx = sp.x + R + i * gap;
		const cy = sp.y + h / 2 + R * 0.06;
		const e = ein(t, 0.35, i * 0.06, (z) => oBack(z, 1.6));
		if (e <= 0) continue;
		const ft = 0.45 + i * 0.16;
		const f = cl(rating - i) * cl((t - ft) / 0.12);
		const pop = 1 + 0.35 * Math.sin(Math.PI * cl((t - ft) / 0.3));
		const pts: X2Pt[] = STAR.map(([sx, sy]): X2Pt => [
			cx + sx * R * e * pop,
			cy + sy * R * e * pop,
		]);
		if (f > 0) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(cx - R * 1.5, cy - R * 1.5, R * 1.5 + (f >= 1 ? R * 1.5 : 0), R * 3);
			ctx.clip();
			fillPoly(env, pts, ac, A);
			ctx.restore();
		}
		stroke(env, pts, f > 0 ? ac : env.sc.sub, Math.max(1.2, 1.6 * u), A, { close: true });
	}
	T(env, (rating * cl((t - 0.4) / 0.55)).toFixed(1), sp.x + w, sp.y + h / 2, fs * 1.15, {
		al: "right",
		c: env.sc.fg,
		a: A * ein(t, 0.3, 0.3),
	});
}

/** 電池残量 — phone status icons: signal bars lighting up, a clock, a battery that drains over the cut. */
function drawBattery(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.9;
	const hh = fs * 1.05;
	const sigW = 26 * u;
	const batW = 34 * u;
	const pcW = fs * 2.5;
	const tmW = fs * 3.2;
	const g = fs * 0.7;
	const w = sigW + g + tmW + g + pcW + batW + 4 * u;
	const sp = spot(env, bb, w, hh, { ...p, corner: true }, 20 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const c = env.sc.fg;
	const cy = sp.y + hh / 2;
	let x0 = sp.x;
	for (let i = 0; i < 4; i += 1) {
		const e = ein(t, 0.25, 0.1 + i * 0.12, outCubic);
		const bhh = hh * (0.3 + 0.23 * i);
		box(env, x0 + i * 7 * u, sp.y + hh - bhh * (0.4 + 0.6 * e), 4.5 * u, bhh * (0.4 + 0.6 * e), c, A * (0.25 + 0.75 * e));
	}
	x0 += sigW + g;
	const mm = hOf(p.seed, 2) % 60;
	const hr = 1 + (hOf(p.seed, 1) % 12);
	T(env, `${hr}:${pad2((mm + Math.floor(env.lt / 2)) % 60)}`, x0, cy, fs, {
		c,
		a: A * ein(t, 0.3, 0.1),
	});
	x0 += tmW + g;
	const lvl = cl(1 - (0.85 * cl(env.lt)) / Math.max(0.3, env.dur || 1)) * ein(t, 0.5, 0.15);
	const low = lvl < 0.3;
	T(env, `${Math.round(lvl * 100)}%`, x0 + pcW - fs * 0.4, cy, fs * 0.9, {
		al: "right",
		c,
		a: A * ein(t, 0.3, 0.15),
	});
	x0 += pcW;
	rr(env, x0, sp.y + hh * 0.08, batW, hh * 0.84, 3 * u, null, A * ein(t, 0.3), c, Math.max(1, 1.3 * u));
	box(env, x0 + batW + 1.5 * u, cy - hh * 0.16, 2.5 * u, hh * 0.32, c, A * ein(t, 0.3));
	const blink = low && Math.floor(env.lt * 4) % 2 === 0 ? 0.45 : 1;
	rr(
		env,
		x0 + 3 * u,
		sp.y + hh * 0.08 + 3 * u,
		Math.max(0, (batW - 6 * u) * lvl),
		hh * 0.84 - 6 * u,
		1.5 * u,
		low ? env.sc.accent : c,
		A * blink,
	);
}

/* ============================================================ widgets */

/** スライダー — labelled range sliders whose knobs glide to their values, with a readout each. */
const SL_LABS: readonly (readonly string[])[] = [
	["TEMPO", "PITCH", "REVERB"],
	["GAIN", "PAN", "ECHO"],
	["WARMTH", "BLUR", "GRAIN"],
	["想い", "距離", "温度"],
	["きもち", "ことば", "おと"],
];

function drawSliders(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.85;
	const n = Math.min(3, 1 + p.n);
	const labs = SL_LABS[p.v % (hasCJK(env.text) ? 5 : 3)]!;
	const rh = fs * 2.1;
	const tr = 150 * u;
	const lw0 = Math.max(...labs.slice(0, n).map((s) => textWidth(s, fs, 0.1))) + fs * 0.9;
	const w = lw0 + tr + fs * 2.2;
	const h = n * rh;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	for (let i = 0; i < n; i += 1) {
		const e = ein(t, 0.4, i * 0.08);
		const y = sp.y + rh * (i + 0.5);
		const x0 = sp.x + lw0;
		const tgt = 0.2 + 0.7 * randomUnit(p.seed, i, 4);
		const v =
			tgt * ein(t, 0.6, 0.3 + i * 0.18, (z) => oBack(z, 1.3)) +
			0.03 * Math.sin(env.ltb * 1.7 + i * 2) * env.motion * cl(t - 1);
		const kx = x0 + tr * cl(v) * e;
		T(env, labs[i]!, sp.x, y, fs, { a: A * e * 0.9 });
		segs(env, [[x0, y, x0 + tr * e, y]], env.sc.sub, Math.max(2, 3 * u), A * 0.4);
		segs(env, [[x0, y, kx, y]], ac, Math.max(2, 3 * u), A);
		dot(env, kx, y, 7 * u * e, env.sc.fg, A);
		dot(env, kx, y, 3 * u * e, env.sc.bg, A);
		T(env, pad2(cl(v) * 100), sp.x + w, y, fs, { al: "right", c: env.sc.fg, a: A * e });
	}
}

/** プルダウン — a select box that drops open, runs its highlight down the options, picks one and closes. */
const DD_OPTS: readonly (readonly string[])[] = [
	["Verse", "Chorus", "Bridge"],
	["Soft", "Normal", "Loud"],
	["Slow", "Mid", "Fast"],
	["きのう", "きょう", "あした"],
	["ひとり", "ふたり", "みんな"],
];

function drawDropdown(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.92;
	const opts = DD_OPTS[p.v % (hasCJK(env.text) ? 5 : 3)]!;
	const rh = fs * 1.9;
	const sel = 1 + (hOf(p.seed, 2) % 2);
	const w = Math.max(...opts.map((s) => textWidth(s, fs))) + fs * 3.4;
	const h = rh * 4 + 6 * u;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const c = env.sc.fg;
	const lw = Math.max(1, 1.3 * u);
	const dur = Math.max(0.6, env.dur || 1);
	const tc = Math.min(1.45, dur * 0.62);
	const open = ein(t, 0.3, 0.3) * (1 - ein(t, 0.25, tc, inOutCubic));
	const closed = t > tc + 0.1;
	const e = ein(t, 0.35);
	rr(env, sp.x, sp.y, w * e, rh, 5 * u, null, A, closed ? ac : c, lw);
	T(env, opts[closed ? sel : 0]!, sp.x + fs * 0.8, sp.y + rh / 2, fs, { c, a: A * ein(t, 0.3, 0.1) });
	const kx = sp.x + w - fs * 1.1;
	const ky = sp.y + rh / 2;
	const k = fs * 0.28;
	const fl = 1 - 2 * open;
	stroke(
		env,
		[
			[kx - k, ky - k * 0.5 * fl],
			[kx, ky + k * 0.5 * fl],
			[kx + k, ky - k * 0.5 * fl],
		],
		closed ? ac : c,
		lw * 1.2,
		A * e,
	);
	if (open > 0.01) {
		const ly = sp.y + rh + 6 * u;
		const lh = rh * 3 * open;
		const ctx = env.ctx;
		ctx.save();
		ctx.beginPath();
		ctx.rect(sp.x - 2, ly - 1, w + 4, lh + 2);
		ctx.clip();
		rr(env, sp.x, ly, w, rh * 3, 5 * u, null, A, env.sc.sub, lw);
		const hl = lerpN(0, sel, ein(t, 0.45, 0.6, inOutCubic));
		rr(env, sp.x + 3 * u, ly + rh * hl + 3 * u, w - 6 * u, rh - 6 * u, 3 * u, ac, A * 0.9);
		for (const [i, s] of opts.entries()) {
			T(env, s, sp.x + fs * 0.8, ly + rh * (i + 0.5), fs, {
				c: Math.abs(hl - i) < 0.5 ? onC(env, ac) : env.sc.sub,
				a: A,
			});
		}
		ctx.restore();
	}
}

/** ページ送り — pagination: ‹ 1 2 3 4 5 › with the active box sliding onto the current line's page. */
function drawPager(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.95;
	const c = fs * 1.9;
	const g = fs * 0.35;
	const n = 5;
	const ln = env.line;
	const base = Math.floor(ln / n) * n;
	const act = ln % n;
	const w = (n + 2) * c + (n + 1) * g;
	const sp = band(env, bb, w, c, p, 24 * u + bh(bb) * 0.05);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const lw = Math.max(1, 1.3 * u);
	const cxs = (i: number): number => sp.x + (i + 1) * (c + g) + c / 2;
	const cy = sp.y + c / 2;
	const k = fs * 0.3;
	const eA = ein(t, 0.3);
	const eB = ein(t, 0.3, 0.1);
	stroke(
		env,
		[
			[sp.x + c / 2 + k * 0.5, cy - k],
			[sp.x + c / 2 - k * 0.5, cy],
			[sp.x + c / 2 + k * 0.5, cy + k],
		],
		env.sc.sub,
		lw * 1.2,
		A * eA,
	);
	stroke(
		env,
		[
			[sp.x + w - c / 2 - k * 0.5, cy - k],
			[sp.x + w - c / 2 + k * 0.5, cy],
			[sp.x + w - c / 2 - k * 0.5, cy + k],
		],
		env.sc.fg,
		lw * 1.2,
		A * eB,
	);
	const from = act === 0 ? 0 : act - 1;
	const hx = lerpN(cxs(from), cxs(act), ein(t, 0.4, 0.4, (z) => oBack(z, 1.5)));
	rr(env, hx - c / 2, sp.y, c, c, p.big ? c / 2 : 4 * u, ac, A * ein(t, 0.3, 0.15));
	for (let i = 0; i < n; i += 1) {
		const e = ein(t, 0.3, 0.04 * i, outCubic);
		const on = Math.abs(lerpN(from, act, ein(t, 0.4, 0.4, (z) => oBack(z, 1.5))) - i) < 0.5;
		if (!on) rr(env, cxs(i) - c / 2, sp.y, c, c, p.big ? c / 2 : 4 * u, null, A * e * 0.5, env.sc.sub, lw);
		T(env, String(base + i + 1), cxs(i), cy, fs, {
			al: "center",
			c: on ? onC(env, ac) : env.sc.sub,
			a: A * e,
		});
	}
}

/** 検索窓 — a search field: magnifier, the cut typed in with a caret, then a hit count below. */
function drawSearch(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env);
	const q = clipText(env.text, 12);
	const cj = hasCJK(q);
	const hgt = fs * 2.3;
	const w = cl(textWidth(q, fs) + fs * 4.2, 230 * u, 420 * u);
	const h = hgt + fs * 1.7;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const c = env.sc.fg;
	const lw = Math.max(1, 1.4 * u);
	const e = ein(t, 0.4);
	rr(env, sp.x + (w * (1 - e)) / 2, sp.y, w * e, hgt, p.big ? 5 * u : hgt / 2, null, A, c, lw);
	const mx = sp.x + fs * 1.3;
	const my = sp.y + hgt / 2;
	const mr = fs * 0.36;
	ring(env, mx, my - mr * 0.2, mr * e, env.sc.sub, lw * 1.2, A);
	segs(env, [[mx + mr * 0.7, my + mr * 0.5, mx + mr * 1.35, my + mr * 1.15]], env.sc.sub, lw * 1.4, A * e);
	const cs = charsOf(q);
	const dT = Math.min(0.7, cs.length * 0.07);
	const k = Math.floor(cs.length * cl((t - 0.3) / dT) + 1e-6);
	const s = cs.slice(0, k).join("");
	const tx = sp.x + fs * 2.4;
	T(env, s, tx, my, fs, { c, a: A * 0.9 });
	const done = t > 0.3 + dT + 0.15;
	if (!done || Math.floor(env.lt * 2.4) % 2 === 0) {
		segs(
			env,
			[
				[
					tx + textWidth(s, fs) + 3 * u,
					my - fs * 0.6,
					tx + textWidth(s, fs) + 3 * u,
					my + fs * 0.6,
				],
			],
			env.sc.accent,
			Math.max(1.5, 2 * u),
			A * cl((t - 0.2) * 5),
		);
	}
	if (done) {
		const e2 = ein(t, 0.3, 0.3 + dT + 0.15);
		const n = 100 + (hOf(p.seed, 9) % 9000);
		const ns = n.toLocaleString("en-US");
		T(env, cj ? `約 ${ns} 件` : `${ns} results`, sp.x + fs, sp.y + hgt + fs, fs * 0.8, {
			a: A * e2 * 0.85,
		});
	}
}

/** キーの列 — keycaps spelling the cut's reading, pressed one after another, ending on Enter. */
function drawKeycaps(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const rj = syllables(env.text)
		.filter((q) => q[1])
		.map((q) => q[0])
		.join("");
	let ks = charsOf(rj.toUpperCase()).filter((c) => /[A-Z]/.test(c)).slice(0, 8);
	if (ks.length === 0) ks = charsOf("LYRIC");
	const fs = fsOf(env) * 0.9;
	const k = fs * 2;
	const g = fs * 0.35;
	const n = ks.length;
	const ew = k * 1.8;
	const w = n * (k + g) + ew;
	const h = k + 5 * u;
	const sp = band(env, bb, w, h, p, 22 * u + bh(bb) * 0.05);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const c = env.sc.fg;
	const lw = Math.max(1, 1.3 * u);
	for (let i = 0; i <= n; i += 1) {
		const e = ein(t, 0.3, i * 0.035, (z) => oBack(z, 1.5));
		if (e <= 0) continue;
		const tp = 0.4 + i * 0.13;
		const dt = t - tp;
		const pr = dt > 0 ? Math.exp(-dt * 9) : 0;
		const kw = i === n ? ew : k;
		const x0 = sp.x + i * (k + g);
		const y = sp.y + pr * 4 * u + (1 - e) * 8 * u;
		const ent = i === n;
		rr(env, x0, sp.y + 5 * u, kw, k, 5 * u, null, A * e * 0.6, env.sc.sub, lw);
		rr(env, x0, y, kw, k, 5 * u, env.sc.bg, A * e);
		rr(env, x0, y, kw, k, 5 * u, ac, A * e * pr * 0.9, ent && dt > 0 ? ac : c, lw);
		if (ent) {
			stroke(
				env,
				[
					[x0 + kw * 0.7, y + k * 0.3],
					[x0 + kw * 0.7, y + k * 0.58],
					[x0 + kw * 0.3, y + k * 0.58],
					[x0 + kw * 0.42, y + k * 0.45],
					[x0 + kw * 0.3, y + k * 0.58],
					[x0 + kw * 0.42, y + k * 0.71],
				],
				pr > 0.5 ? onC(env, ac) : c,
				lw * 1.2,
				A * e,
			);
		} else {
			T(env, ks[i]!, x0 + kw / 2, y + k / 2, fs, {
				al: "center",
				c: pr > 0.5 ? onC(env, ac) : c,
				a: A * e,
			});
		}
	}
}

/** 入力中 — a chat "typing" bubble: three dots rolling in a wave, with a small status caption. */
function drawTyping(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.8;
	const R = 5 * u + 1.5 * u * p.n;
	const bwid = R * 11;
	const bht = R * 5.4;
	const cj = hasCJK(env.text);
	const h = bht + fs * 1.7;
	const sp = spot(env, bb, bwid + R, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const rt = p.right;
	const e = ein(t, 0.4, 0.05, (z) => oBack(z, 1.5));
	if (e <= 0) return;
	const x0 = sp.x + (rt ? 0 : R);
	const ax = rt ? x0 + bwid : x0;
	const ay = sp.y + bht;
	const ctx = env.ctx;
	const fillC = p.accent ? env.sc.accent : env.sc.fg;
	ctx.save();
	ctx.translate(ax, ay);
	ctx.scale(e, e);
	ctx.translate(-ax, -ay);
	rr(env, x0, sp.y, bwid, bht, bht / 2, fillC, A * (p.accent ? 0.95 : 0.14), p.accent ? undefined : env.sc.sub, Math.max(1, 1.2 * u));
	dot(env, ax + (rt ? 1 : -1) * R * 0.3, ay - R * 0.2, R * 0.8, fillC, A * (p.accent ? 0.95 : 0.3));
	for (let i = 0; i < 3; i += 1) {
		const ph = ((env.ltb * 1.5 - i * 0.16) % 1 + 1) % 1;
		const b = ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI) : 0;
		dot(env, x0 + bwid / 2 + (i - 1) * R * 2.6, sp.y + bht / 2 - b * R * 1.3, R * (0.85 + 0.15 * b), p.accent ? onC(env, fillC) : env.sc.fg, A * (0.55 + 0.45 * b));
	}
	ctx.restore();
	T(env, cj ? "入力中…" : "typing…", rt ? x0 + bwid - R : x0 + R, sp.y + bht + fs, fs, {
		al: rt ? "right" : "left",
		a: A * ein(t, 0.3, 0.3) * 0.85,
	});
}

/* ============================================================ calendar / clock / ticker */

/** カレンダー — a mini month grid whose days fill in row by row; the cut's day gets circled. */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

function drawCalendar(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.72;
	const cw = fs * 1.75;
	const chh = fs * 1.5;
	const mo = hOf(p.seed, 1) % 12;
	const off = hOf(p.seed, 2) % 7;
	const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo]!;
	const rowsN = Math.ceil((off + days) / 7);
	const w = cw * 7;
	const h = fs * 1.9 + chh * (rowsN + 1);
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const ac = env.sc.accent;
	const today = 1 + ((env.line * 7 + env.index * 3 + hOf(p.seed, 3)) % days);
	const e0 = ein(t, 0.4);
	T(env, MONTHS[mo]!, sp.x + cw * 0.15, sp.y + fs * 0.6, fs * 1.25, { c: env.sc.fg, a: A * e0 });
	segs(env, [[sp.x, sp.y + fs * 1.55, sp.x + w * e0, sp.y + fs * 1.55]], env.sc.sub, Math.max(1, u), A * 0.7);
	const y0 = sp.y + fs * 1.9;
	"SMTWTFS".split("").forEach((d, i) => {
		T(env, d, sp.x + cw * (i + 0.5), y0 + chh * 0.5, fs * 0.85, {
			al: "center",
			a: A * ein(t, 0.3, 0.05 + i * 0.02) * (i === 0 ? 1 : 0.7),
			c: i === 0 ? ac : env.sc.sub,
		});
	});
	for (let d = 1; d <= days; d += 1) {
		const k = off + d - 1;
		const col = k % 7;
		const row = Math.floor(k / 7);
		const e = ein(t, 0.3, 0.12 + row * 0.07 + col * 0.012, outCubic);
		if (e <= 0) continue;
		const px = sp.x + cw * (col + 0.5);
		const py = y0 + chh * (row + 1.5);
		const is = d === today;
		if (is) {
			const ce = ein(t, 0.4, 0.65, inOutCubic);
			ring(env, px, py, chh * 0.62, ac, Math.max(1.2, 1.6 * u), A, -Math.PI / 2, -Math.PI / 2 + TAU * ce);
		}
		T(env, String(d), px, py + (1 - e) * 4 * u, fs, {
			al: "center",
			c: is ? env.sc.fg : env.sc.sub,
			a: A * e * (is ? 1 : col === 0 ? 0.85 : 0.7),
		});
	}
}

/** 時計 — an analogue clock face: ticks draw on, the hands sweep to a time, the second hand ticks. */
function drawClock(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const fs = fsOf(env) * 0.85;
	const R = 38 * u + 9 * u * p.n;
	const w = R * 2.1;
	const h = R * 2.1 + fs * 1.7;
	const sp = spot(env, bb, w, h, p, 22 * u);
	const A = o * (sp.ok ? 1 : 0.3);
	const cx = sp.x + w / 2;
	const cy = sp.y + R * 1.05;
	const c = env.sc.fg;
	const ac = env.sc.accent;
	const lw = Math.max(1, 1.4 * u);
	const e = ein(t, 0.55, 0, inOutCubic);
	ring(env, cx, cy, R, c, lw, A, -Math.PI / 2, -Math.PI / 2 + TAU * e);
	const tk: (readonly [number, number, number, number])[] = [];
	const tk2: (readonly [number, number, number, number])[] = [];
	for (let i = 0; i < 60; i += 1) {
		if (i / 60 > e) break;
		if (i % 5 && !p.big) continue;
		const a = -Math.PI / 2 + (i / 60) * TAU;
		const r0 = R * (i % 15 === 0 ? 0.8 : i % 5 === 0 ? 0.86 : 0.93);
		const seg: readonly [number, number, number, number] = [
			cx + Math.cos(a) * r0,
			cy + Math.sin(a) * r0,
			cx + Math.cos(a) * R * 0.96,
			cy + Math.sin(a) * R * 0.96,
		];
		if (i % 5) tk2.push(seg);
		else tk.push(seg);
	}
	segs(env, tk, c, lw, A * 0.9);
	segs(env, tk2, env.sc.sub, Math.max(1, u), A * 0.5);
	const hr = 1 + (hOf(p.seed, 1) % 12);
	const mm = (hOf(p.seed, 2) % 12) * 5;
	const sw2 = ein(t, 0.9, 0.2, (z) => oBack(z, 1.1));
	const aM = -Math.PI / 2 + (mm / 60) * TAU * sw2;
	const aH = -Math.PI / 2 + ((hr % 12 + mm / 60) / 12) * TAU * sw2;
	segs(env, [[cx, cy, cx + Math.cos(aH) * R * 0.48, cy + Math.sin(aH) * R * 0.48]], c, Math.max(2.4, 3.6 * u), A * e);
	segs(env, [[cx, cy, cx + Math.cos(aM) * R * 0.74, cy + Math.sin(aM) * R * 0.74]], c, Math.max(1.6, 2.4 * u), A * e);
	const s0 = Math.floor(env.ltb);
	const fr = env.ltb - s0;
	const aS = -Math.PI / 2 + (s0 + oBack(cl(fr / 0.2), 2.2)) / 60 * TAU;
	segs(
		env,
		[
			[
				cx - Math.cos(aS) * R * 0.16,
				cy - Math.sin(aS) * R * 0.16,
				cx + Math.cos(aS) * R * 0.84,
				cy + Math.sin(aS) * R * 0.84,
			],
		],
		ac,
		Math.max(1, 1.3 * u),
		A * e,
	);
	dot(env, cx, cy, 3.5 * u, ac, A * e);
	T(env, `${pad2(hr)}:${pad2(mm)}`, cx, sp.y + R * 2.1 + fs * 0.95, fs, { al: "center", a: A * ein(t, 0.3, 0.5) * 0.9 });
}

/** ティッカー — a ticker tape along a screen edge: the lyric line scrolling between rules with up / down marks and deltas. */
function drawTicker(x: X2Part): void {
	const { env, bb, p, t, o, u } = x;
	const { W, H } = env;
	const fs = fsOf(env);
	const bhh = fs * 2.4;
	const src = clipText(env.text || "lyric", 30);
	let top = !p.low;
	if ((top ? bb.y0 : H - bb.y1) < bhh + 14 * u) top = !top;
	const A = o * ((top ? bb.y0 : H - bb.y1) < bhh + 4 * u ? 0.3 : 1);
	const e = ein(t, 0.45);
	const y0 = top ? -bhh * (1 - e) : H - bhh * e;
	const cy = y0 + bhh / 2;
	box(env, 0, y0, W, bhh, env.sc.fg, A * 0.07);
	const ry = top ? y0 + bhh : y0;
	const ex = W * ein(t, 0.6, 0.05, inOutCubic);
	const rule: readonly [number, number, number, number] = p.right
		? [W - ex, ry, W, ry]
		: [0, ry, ex, ry];
	segs(env, [rule], p.accent ? env.sc.accent : env.sc.fg, Math.max(1.2, 1.6 * u), A * 0.9);
	const wl = textWidth(src, fs, 0.05);
	const g = fs * 1.1;
	const tri = fs * 0.5;
	const wd = fs * 3.2;
	const per = wl + g + tri + (wd ? fs * 0.5 + wd : 0) + g * 1.6;
	const dir = p.right ? 1 : -1;
	const sc0 = env.ltb * (50 + 60 * env.motion) * u;
	const k0 = Math.floor(sc0 / per);
	const offx = sc0 - k0 * per;
	const cnt = Math.min(40, Math.ceil(W / per) + 2);
	for (let j = -1; j < cnt; j += 1) {
		const px = dir > 0 ? j * per + offx : W - (j * per + offx) - per;
		const id = j - k0;
		if (px > W || px + per < 0) continue;
		const up = randomUnit(p.seed, id, 1) < 0.6;
		const c = up ? env.sc.accent : env.sc.sub;
		const txx = px + wl + g;
		const s = up ? -1 : 1;
		T(env, src, px, cy, fs, { c: env.sc.fg, a: A * e * 0.8 });
		fillPoly(
			env,
			[
				[txx, cy - s * tri * 0.45],
				[txx + tri, cy - s * tri * 0.45],
				[txx + tri / 2, cy + s * tri * 0.45],
			],
			c,
			A * e,
		);
		T(env, `${up ? "+" : "-"}${(0.1 + randomUnit(p.seed, id, 2) * 4.8).toFixed(2)}`, txx + tri + fs * 0.5, cy, fs * 0.88, {
			c,
			a: A * e,
		});
	}
}
