import { estimatedTextWidth } from "./core-layout-utils";
import { enterBOutBack } from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inCubic,
	inOutCubic,
	lerp,
	outCubic,
	randomUnit,
	secondsOf,
	TICKS_PER_SECOND,
} from "./exit-hold-geometry";
import { layoutADrawFrame, layoutADrawLine } from "./layouts-a-utils";
import { x2Hash } from "./x2-drawing";
import type { TypographyLayoutOptions } from "./typography-layout-types";

/**
 * JIZURA 追加分2 layouts A (x2layA) — editorial / print / typographic
 * compositions: page furniture, forms and plates.
 *
 * Faithful transliteration of `11p_x2_layA.js` into the rocut layout
 * contract. The packs' render math is kept line for line; the source's env
 * helpers (`R`, `Ln`, `label`, `J.measure`, …) map onto local helpers below.
 * Semantic simplifications match the existing x2 port family: one font per
 * cut (mono/body roles are ignored), plan() params re-derived from the cut
 * seed, `env.lt` in seconds, and no per-glyph metrics beyond the house
 * advance heuristic (0.62 per glyph, 0.34 per space).
 */

const PI = Math.PI;

/** JIZURA sc: rocut has no ink/accent2 slots, so ink≈fg and accent2≈sub. */
interface X2LayPalette {
	readonly bg: string;
	readonly fg: string;
	readonly ink: string;
	readonly accent: string;
	readonly accent2: string;
	readonly sub: string;
}

interface X2LayEnv {
	readonly ctx: TypographyLayoutOptions["ctx"];
	readonly drawText: TypographyLayoutOptions["drawText"];
	readonly setFontSize: TypographyLayoutOptions["setFontSize"];
	readonly W: number;
	readonly H: number;
	readonly M: number;
	readonly port: boolean;
	readonly txt: string;
	readonly seed: number;
	readonly lt: number;
	readonly pOut: number;
	readonly out: number;
	readonly lw: number;
	readonly ls: number;
	readonly no: number;
	readonly dur: number;
	readonly inDur: number;
	readonly start: number;
	readonly sc: X2LayPalette;
}

interface LabelOptions {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly rot?: number;
	readonly size?: number;
	readonly vertical?: boolean;
}

interface MainItem {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color: string;
	readonly lead?: number;
	readonly rot?: number;
	readonly size: number;
	readonly text: string;
	readonly track?: number;
	readonly x: number;
	readonly y: number;
}

interface GlyphPt {
	readonly ch: string;
	readonly h: number;
	readonly li: number;
	readonly w: number;
	readonly x: number;
	readonly y: number;
}

type Pt = readonly [number, number];

/* ------------------------------------------------------------------ base */

function baseOf(options: TypographyLayoutOptions): X2LayEnv {
	const cut = options.frame.cut;
	const seed = cut?.seed ?? 0;
	const duration = (cut?.duration ?? 0) / TICKS_PER_SECOND;
	const palette = options.frame.palette;
	return {
		ctx: options.ctx,
		drawText: options.drawText,
		setFontSize: options.setFontSize,
		W: options.width,
		H: options.height,
		M: Math.min(options.width, options.height),
		port: options.width < options.height,
		txt: (cut?.text ?? "").trim(),
		seed,
		lt: secondsOf(options.frame),
		pOut: options.frame.exitProgress,
		out: 1 - inCubic(options.frame.exitProgress),
		lw: Math.max(1, Math.min(options.width, options.height) * 0.0016),
		ls: Math.min(24, Math.max(11, Math.min(options.width, options.height) * 0.019)),
		no: (Math.abs(seed) % 97) + 1,
		dur: duration,
		inDur: Math.min(0.3, duration / 3),
		start: (cut?.startTime ?? 0) / TICKS_PER_SECOND,
		sc: {
			bg: palette.background,
			fg: palette.foreground,
			ink: palette.foreground,
			accent: palette.accent,
			accent2: palette.secondary,
			sub: palette.secondary,
		},
	};
}

function clamp(value: number): number {
	return clamp01(value);
}

function outExpoE(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

function inExpoE(value: number): number {
	const progress = clamp01(value);
	return progress <= 0 ? 0 : 2 ** (10 * progress - 10);
}

// eslint-disable-next-line opencut/prefer-object-params
function oBack(value: number, overshoot = 1.9): number {
	return enterBOutBack(value, overshoot);
}

// eslint-disable-next-line opencut/prefer-object-params
function inE(env: X2LayEnv, duration = 0.35, delay = 0): number {
	return outExpoE(clamp((env.lt - delay) / duration));
}

// eslint-disable-next-line opencut/prefer-object-params
function inC(env: X2LayEnv, duration = 0.35, delay = 0): number {
	return outCubic(clamp((env.lt - delay) / duration));
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

/* ------------------------------------------------------ plan() stand-ins */
/* JIZURA plan(rng, …) params are planner-side; the renderer re-derives the
 * same choices deterministically from the cut seed. */

// eslint-disable-next-line opencut/prefer-object-params
function pickOf<T>(seed: number, salt: number, values: readonly T[]): T {
	return values[x2Hash(seed, salt) % values.length]!;
}

// eslint-disable-next-line opencut/prefer-object-params
function chanceOf(seed: number, salt: number, probability: number): boolean {
	return randomUnit(seed, salt) < probability;
}

// eslint-disable-next-line opencut/prefer-object-params
function intOf(seed: number, salt: number, low: number, high: number): number {
	return low + (x2Hash(seed, salt) % (high - low + 1));
}

// eslint-disable-next-line opencut/prefer-object-params
function rangeOf(seed: number, salt: number, low: number, high: number): number {
	return low + (high - low) * randomUnit(seed, salt);
}

/* --------------------------------------------------------------- language */

const PUNCT_source = /[、。，．,.!?！？…‥・「」『』（）()【】〈〉《》〔〕［］[\]'"“”‘’ー〜～:：;；\-—―]/u;
const KANJI_source = /[㐀-鿿豈-﫿々〆ヶ]/u;
const HIRA_source = /[ぁ-ゟ]/u;
const KATA_source = /[゠-ヿㇰ-ㇿｦ-ﾟ]/u;
const SMALL_KANA = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ";

function isPunctCh(character: string): boolean {
	return PUNCT_source.test(character);
}

function isKanjiCh(character: string): boolean {
	return KANJI_source.test(character);
}

function isHiraCh(character: string): boolean {
	return HIRA_source.test(character);
}

function isKataCh(character: string): boolean {
	return KATA_source.test(character);
}

function isLatinCh(character: string): boolean {
	return /[A-Za-z0-9]/u.test(character);
}

function isSmallKana(character: string): boolean {
	return SMALL_KANA.includes(character);
}

function isSp(character: string): boolean {
	return character === " " || character === "　";
}

function isLatinText(text: string): boolean {
	const squashed = String(text ?? "").replace(/\s/gu, "");
	if (!squashed) return false;
	const matches = squashed.match(/[A-Za-zÀ-ɏ]/gu);
	return (matches ? matches.length : 0) / Array.from(squashed).length >= 0.6;
}

function slotsOf(text: string): string[] {
	return Array.from(String(text ?? "").trim().replace(/\s+/gu, " "));
}

function glyphCountOf(text: string): number {
	return Array.from(String(text ?? "").replace(/\s/gu, "")).length;
}

// eslint-disable-next-line opencut/prefer-object-params
function shortOf(text: string, keep: number): string {
	const chars = Array.from(String(text ?? "").replace(/\s+/gu, " ").trim());
	return chars.length > keep
		? `${chars.slice(0, keep).join("")}…`
		: chars.join("");
}

/* ----------------------------------------------------------------- lines */

/** J.splitLines: even split with closing punctuation riding the prior line. */
// eslint-disable-next-line opencut/prefer-object-params
function splitL(text: string, per: number): string {
	const glyphs = Array.from(text);
	if (glyphs.length <= Math.max(1, per)) return text;
	const lineCount = Math.ceil(glyphs.length / per);
	const perLine = glyphs.length / lineCount;
	const lines: string[] = [];
	let start = 0;
	for (let line = 1; line < lineCount; line += 1) {
		let cut = Math.round(perLine * line);
		while (
			cut < glyphs.length &&
			cut > start &&
			(isPunctCh(glyphs[cut] ?? "") ||
				isSmallKana(glyphs[cut] ?? "") ||
				glyphs[cut] === "ー")
		) {
			cut += 1;
		}
		lines.push(glyphs.slice(start, cut).join("").trim());
		start = cut;
	}
	lines.push(glyphs.slice(start).join("").trim());
	return lines.join("\n");
}

// eslint-disable-next-line opencut/prefer-object-params
function linesOf(text: string, lineCount: number): string {
	const squashed = String(text ?? "").trim();
	const length = Array.from(squashed).length;
	if (lineCount <= 1) return squashed;
	return splitL(squashed, Math.ceil(length / lineCount));
}

/** J.evenSplit: C runs of even length, not starting on punctuation/small kana. */
// eslint-disable-next-line opencut/prefer-object-params
function evenSplit(text: string, count: number): string[] {
	const squashed = String(text ?? "").trim();
	if (isLatinText(squashed) || count <= 1) {
		return splitL(
			squashed,
			Math.ceil(Array.from(squashed).length / Math.max(1, count)),
		).split("\n");
	}
	const chars = Array.from(squashed.replace(/\s+/gu, ""));
	const total = chars.length;
	const out: string[] = [];
	let start = 0;
	for (let i = 1; i <= count; i += 1) {
		let cut = i === count ? total : Math.round((i * total) / count);
		while (
			cut < total &&
			cut > start &&
			(isPunctCh(chars[cut] ?? "") ||
				isSmallKana(chars[cut] ?? "") ||
				chars[cut] === "ー")
		) {
			cut += 1;
		}
		if (cut > start) out.push(chars.slice(start, cut).join(""));
		start = cut;
	}
	return out;
}

/** J.smartSplit: at most C runs at natural breaks, falling back to even. */
// eslint-disable-next-line opencut/prefer-object-params
function smartSplit(text: string, count: number, strict: boolean): string[] {
	const squashed = String(text ?? "").trim();
	const length = Array.from(squashed).length;
	if (count <= 1 || length <= 1) return [squashed];
	for (const target of strict ? [count] : [count, count - 1]) {
		if (target < 2) break;
		const segments = splitL(
			squashed,
			Math.ceil(length / target),
		).split("\n");
		const widest = Math.max(
			...segments.map((segment) => Array.from(segment).length),
		);
		if (
			segments.length <= target &&
			widest <= Math.ceil(length / target) * 1.45 + 0.5
		) {
			return segments;
		}
	}
	return evenSplit(squashed, count);
}

/** J.fitBox: the line count (1..maxL) that yields the biggest type in a box. */
// eslint-disable-next-line opencut/prefer-object-params
function fitBox(
	text: string,
	boxWidth: number,
	boxHeight: number,
	lead: number,
	track: number,
	maxLines: number,
): { readonly size: number; readonly text: string } {
	const squashed = String(text ?? "").trim();
	const length = Array.from(squashed).length;
	let best: { readonly size: number; readonly text: string } | null = null;
	for (let lines = 1; lines <= Math.min(maxLines, Math.max(1, length)); lines += 1) {
		const candidate = linesOf(squashed, lines);
		if (candidate.split("\n").length < lines && best) continue;
		const size = fitSize(candidate, boxWidth, boxHeight, lead, track);
		if (!best || size > best.size * 1.04) best = { size, text: candidate };
	}
	return best ?? { size: 10, text: squashed };
}

/** J.mainLines: portrait/landscape target run length, then splitL. */
// eslint-disable-next-line opencut/prefer-object-params
function mainLines(text: string, width: number, height: number, perL: number, perP: number): string {
	const squashed = String(text ?? "").trim();
	const count = glyphCountOf(squashed);
	const per = width < height ? perP : perL;
	return count <= per
		? squashed
		: splitL(squashed, Math.ceil(count / Math.ceil(count / per)));
}

/* ------------------------------------------------------------- measuring */

// eslint-disable-next-line opencut/prefer-object-params
function measure(text: string, size: number, lead = 1.3, track = 0): { h: number; w: number } {
	const lines = text.split("\n");
	let width = 0;
	for (const line of lines) {
		const extra = track * size * Math.max(0, Array.from(line).length - 1);
		width = Math.max(width, estimatedTextWidth({ size, text: line }) + extra);
	}
	return { h: lines.length * lead * size, w: width };
}

// eslint-disable-next-line opencut/prefer-object-params
function fitSize(text: string, maxWidth: number, maxHeight: number, lead = 1.3, track = 0): number {
	const probe = measure(text, 100, lead, track);
	return (
		100 *
		Math.min(maxWidth / Math.max(1, probe.w), maxHeight / Math.max(1, probe.h))
	);
}

/* ---------------------------------------------------------------- colours */

function hexOf(color: string): readonly [number, number, number] {
	const value = String(color ?? "#000").replace("#", "");
	const full =
		value.length === 3
			? Array.from(value, (part) => part.repeat(2)).join("")
			: value;
	const parsed = Number.parseInt(full.slice(0, 6), 16);
	if (!Number.isFinite(parsed)) return [128, 128, 128];
	return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function lumOf(color: string): number {
	const [r, g, b] = hexOf(color);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// eslint-disable-next-line opencut/prefer-object-params
function contrastOf(a: string, b: string): number {
	const channel = (color: string): number => {
		const parts = hexOf(color).map((part) => {
			const scaled = part / 255;
			return scaled <= 0.03928
				? scaled / 12.92
				: ((scaled + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]!;
	};
	const x = channel(a);
	const y = channel(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// eslint-disable-next-line opencut/prefer-object-params
function mixOf(from: string, to: string, amount: number): string {
	const left = hexOf(from);
	const right = hexOf(to);
	const mixed = left.map((part, index) =>
		Math.round(lerpN(part, right[index]!, amount)),
	);
	return `#${mixed.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** J.onCol: the palette entry with the best contrast against a fill. */
// eslint-disable-next-line opencut/prefer-object-params
function onCol(sc: X2LayPalette, fill: string): string {
	let best: string | null = null;
	let bestValue = 0;
	for (const color of [sc.bg, sc.fg, sc.ink, sc.sub]) {
		if (!color || color === fill) continue;
		const value = contrastOf(color, fill);
		if (value > bestValue) {
			bestValue = value;
			best = color;
		}
	}
	if (best && bestValue >= 3) return best;
	return lumOf(fill) > 0.45 ? "#000000" : "#ffffff";
}

// eslint-disable-next-line opencut/prefer-object-params
function plateCol(sc: X2LayPalette, preferred: readonly (string | null)[]): string {
	for (const color of preferred) {
		if (color && contrastOf(color, sc.bg) >= 1.7) return color;
	}
	return sc.fg;
}

function paperOf(sc: X2LayPalette): string {
	return plateCol(sc, [sc.fg, sc.ink, sc.accent]);
}

// eslint-disable-next-line opencut/prefer-object-params
function accOn(sc: X2LayPalette, fill: string): string {
	if (contrastOf(sc.accent, fill) >= 2) return sc.accent;
	if (sc.accent2 && contrastOf(sc.accent2, fill) >= 2) return sc.accent2;
	return onCol(sc, fill);
}

function accentOn(sc: X2LayPalette): string {
	return accOn(sc, sc.bg);
}

function dimOf(sc: X2LayPalette): string {
	return mixOf(sc.bg, sc.fg, 0.17);
}

// eslint-disable-next-line opencut/prefer-object-params
function pickPlate(sc: X2LayPalette, kind: string): string {
	if (kind === "accent") return plateCol(sc, [sc.accent, sc.ink, sc.fg]);
	if (kind === "ink") return plateCol(sc, [sc.ink, sc.accent, sc.fg]);
	return plateCol(sc, [sc.fg, sc.ink]);
}

/* ---------------------------------------------------------------- drawing */
/* The rocut canvas contract has no dash or path guarantees, so the source's
 * env helpers land on fillRect primitives (rotated rects, scanline polygons,
 * banded discs) that render identically in canvas and minimal contexts. */

// eslint-disable-next-line opencut/prefer-object-params
function R(env: X2LayEnv, x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
	if (alpha <= 0.003 || w <= 0 || h <= 0) return;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
	ctx.globalAlpha = base;
}

// eslint-disable-next-line opencut/prefer-object-params
function Ln(env: X2LayEnv, x0: number, y0: number, x1: number, y1: number, color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003) return;
	layoutADrawLine({
		alpha,
		color,
		ctx: env.ctx,
		fromX: x0,
		fromY: y0,
		thickness,
		toX: x1,
		toY: y1,
	});
}

/** JIZURA dashL: an [on, off] dash walked along the segment. */
// eslint-disable-next-line opencut/prefer-object-params
function dashL(env: X2LayEnv, x0: number, y0: number, x1: number, y1: number, color: string, thickness: number, alpha: number, pattern: readonly [number, number]): void {
	if (alpha <= 0.003) return;
	const length = Math.hypot(x1 - x0, y1 - y0);
	if (length < 0.5) return;
	const ux = (x1 - x0) / length;
	const uy = (y1 - y0) / length;
	const [on, off] = pattern;
	let distance = 0;
	let index = 0;
	while (distance < length) {
		const span = index % 2 === 0 ? on : off;
		const end = Math.min(length, distance + span);
		if (index % 2 === 0) {
			Ln(env, x0 + ux * distance, y0 + uy * distance, x0 + ux * end, y0 + uy * end, color, thickness, alpha);
		}
		distance = end;
		index += 1;
	}
}

// eslint-disable-next-line opencut/prefer-object-params
function frameR(env: X2LayEnv, x: number, y: number, w: number, h: number, color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003 || w <= 0 || h <= 0) return;
	layoutADrawFrame({
		alpha,
		color,
		ctx: env.ctx,
		height: h,
		left: x,
		thickness,
		top: y,
		width: w,
	});
}

/** Scanline polygon fill: real polygon shape with fillRect only. */
// eslint-disable-next-line opencut/prefer-object-params
function poly(env: X2LayEnv, points: readonly Pt[], color: string, alpha = 1): void {
	if (alpha <= 0.003 || points.length < 3) return;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = color;
	let top = Infinity;
	let bottom = -Infinity;
	for (const point of points) {
		top = Math.min(top, point[1]);
		bottom = Math.max(bottom, point[1]);
	}
	const step = Math.max(1.25, (bottom - top) / 140);
	const crossings: number[] = [];
	for (let y = top; y <= bottom + step * 0.5; y += step) {
		crossings.length = 0;
		for (let i = 0; i < points.length; i += 1) {
			const a = points[i]!;
			const b = points[(i + 1) % points.length]!;
			if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
				crossings.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
			}
		}
		crossings.sort((m, n) => m - n);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			const width = crossings[k + 1]! - crossings[k]!;
			if (width > 0.1) {
				ctx.fillRect(crossings[k]!, y - step * 0.5, width, step + 0.65);
			}
		}
	}
	ctx.globalAlpha = base;
}

// eslint-disable-next-line opencut/prefer-object-params
function polyLine(env: X2LayEnv, points: readonly Pt[], color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003) return;
	for (let i = 0; i + 1 < points.length; i += 1) {
		Ln(env, points[i]![0], points[i]![1], points[i + 1]![0], points[i + 1]![1], color, thickness, alpha);
	}
}

/** JIZURA env.polyPartial: the polyline drawn up to a fraction of its length. */
// eslint-disable-next-line opencut/prefer-object-params
function polyPartial(env: X2LayEnv, points: readonly Pt[], progress: number, color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003 || points.length < 2) return;
	const lengths: number[] = [];
	let total = 0;
	for (let i = 0; i + 1 < points.length; i += 1) {
		total += Math.hypot(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1]);
		lengths.push(total);
	}
	const limit = total * clamp01(progress);
	let drawn = 0;
	for (let i = 0; i + 1 < points.length && drawn < limit; i += 1) {
		const segment = lengths[i]! - (i > 0 ? lengths[i - 1]! : 0);
		if (segment <= 0) continue;
		const take = Math.min(segment, limit - drawn);
		const fraction = take / segment;
		const a = points[i]!;
		const b = points[i + 1]!;
		Ln(env, a[0], a[1], a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, color, thickness, alpha);
		drawn += take;
	}
}

// eslint-disable-next-line opencut/prefer-object-params
function disc(env: X2LayEnv, cx: number, cy: number, radius: number, color: string, alpha = 1): void {
	if (alpha <= 0.003 || radius <= 0.3) return;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = color;
	const bands = 26;
	const bandHeight = (radius * 2) / bands;
	for (let band = 0; band < bands; band += 1) {
		const centerY = -radius + (band + 0.5) * bandHeight;
		const normalized = centerY / radius;
		const halfWidth = radius * Math.sqrt(Math.max(0, 1 - normalized * normalized));
		if (halfWidth > 0.1) {
			ctx.fillRect(cx - halfWidth, cy + centerY - bandHeight / 2, halfWidth * 2, bandHeight + 0.65);
		}
	}
	ctx.globalAlpha = base;
}

// eslint-disable-next-line opencut/prefer-object-params
function ringS(env: X2LayEnv, cx: number, cy: number, radius: number, color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003 || radius <= 0.3) return;
	const steps = Math.max(14, Math.min(72, Math.round((2 * PI * radius) / Math.max(3, thickness * 3))));
	for (let i = 0; i < steps; i += 1) {
		const a0 = ((i / steps) * 2) % 2 * PI;
		const a1 = (((i + 1) / steps) * 2) % 2 * PI;
		Ln(
			env,
			cx + Math.cos(a0) * radius,
			cy + Math.sin(a0) * radius,
			cx + Math.cos(a1) * radius,
			cy + Math.sin(a1) * radius,
			color,
			thickness,
			alpha,
		);
	}
}

/** JIZURA env.rrect: rounded rect (path) with a square fillRect fallback. */
// eslint-disable-next-line opencut/prefer-object-params
function rrect(env: X2LayEnv, x: number, y: number, w: number, h: number, r: number, fill: string | null, alpha = 1, stroke: string | null = null, strokeW = 0): void {
	if (alpha <= 0.003 || w <= 0 || h <= 0) return;
	const ctx = env.ctx;
	const fallback = (): void => {
		if (fill) R(env, x, y, w, h, fill, alpha);
		if (stroke) frameR(env, x, y, w, h, stroke, strokeW, alpha);
	};
	if (
		typeof ctx.moveTo !== "function" ||
		typeof ctx.lineTo !== "function" ||
		typeof ctx.arc !== "function"
	) {
		fallback();
		return;
	}
	const moveTo = ctx.moveTo;
	const lineTo = ctx.lineTo;
	const arc = ctx.arc;
	const fillPath = ctx.fill;
	const strokePath = ctx.stroke;
	if (fill && typeof fillPath !== "function") {
		fallback();
		return;
	}
	if (stroke && typeof strokePath !== "function") {
		fallback();
		return;
	}
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = base * alpha;
	ctx.beginPath();
	moveTo.call(ctx, x + r, y);
	lineTo.call(ctx, x + w - r, y);
	arc.call(ctx, x + w - r, y + r, r, -PI / 2, 0);
	lineTo.call(ctx, x + w, y + h - r);
	arc.call(ctx, x + w - r, y + h - r, r, 0, PI / 2);
	lineTo.call(ctx, x + r, y + h);
	arc.call(ctx, x + r, y + h - r, r, PI / 2, PI);
	lineTo.call(ctx, x, y + r);
	arc.call(ctx, x + r, y + r, r, PI, PI * 1.5);
	ctx.closePath?.();
	if (fill) {
		ctx.fillStyle = fill;
		ctx.fill?.();
	}
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = strokeW;
		ctx.stroke?.();
	}
	ctx.restore();
	ctx.globalAlpha = base;
}

// eslint-disable-next-line opencut/prefer-object-params
function tilted(env: X2LayEnv, cx: number, cy: number, deg: number, fn: () => void): void {
	if (!deg) {
		fn();
		return;
	}
	const ctx = env.ctx;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(degrees(deg));
	ctx.translate(-cx, -cy);
	try {
		fn();
	} finally {
		ctx.restore();
	}
}

/** J.greek: rows of body-text bars. */
// eslint-disable-next-line opencut/prefer-object-params
function greek(env: X2LayEnv, x: number, y: number, w: number, rows: number, pitch: number, color: string, alpha: number, seed: number, ease = 1): void {
	for (let row = 0; row < Math.min(rows, 60); row += 1) {
		const k =
			row === rows - 1
				? 0.35 + 0.3 * randomUnit(seed, row, 3)
				: 0.82 + 0.18 * randomUnit(seed, row, 5);
		R(env, x, y + row * pitch, w * k * ease, pitch * 0.36, color, alpha);
	}
}

/** J barcode strip: hashed bar widths along a 96-unit strip. */
// eslint-disable-next-line opencut/prefer-object-params
function barcode(env: X2LayEnv, x: number, y: number, w: number, h: number, color: string, alpha: number, seed: number, ease = 1): void {
	let px = 0;
	const unit = w / 96;
	for (let i = 0; i < 48 && px < 96 * ease; i += 1) {
		const barWidth = 1 + (x2Hash(seed, i, 41) % 3);
		const gap = 1 + (x2Hash(seed, i, 43) % 2);
		if (px + barWidth > 96) break;
		R(env, x + px * unit, y, barWidth * unit * 0.8, h, color, alpha);
		px += barWidth + gap;
	}
}

function fmtTime(seconds: number): string {
	const t = Math.max(0, seconds);
	const minutes = Math.floor(t / 60);
	const secs = Math.floor(t % 60);
	const centis = Math.floor((t % 1) * 100);
	return `${pad2(minutes)}:${pad2(secs)}.${pad2(centis)}`;
}

/** JIZURA label: small mono furniture text. */
// eslint-disable-next-line opencut/prefer-object-params
function label(env: X2LayEnv, text: string, x: number, y: number, options: LabelOptions = {}): void {
	const alpha = options.alpha ?? 1;
	if (alpha <= 0.003) return;
	const size = options.size ?? env.ls;
	const color = options.color ?? env.sc.sub;
	const align = options.align ?? "left";
	const rot = options.rot ?? 0;
	const maxWidth = Math.max(size * 3, estimatedTextWidth({ size, text }) * 1.25);
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	env.setFontSize(size);
	if (options.vertical) {
		const chars = Array.from(text);
		chars.forEach((character, index) => {
			env.drawText({
				text: character,
				x,
				y: y + (index - (chars.length - 1) / 2) * size * 1.05,
				maxWidth,
				size,
			});
		});
	} else if (rot) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(degrees(rot));
		env.drawText({ text, x: 0, y: 0, maxWidth, size });
		ctx.restore();
	} else {
		env.drawText({ text, x, y, maxWidth, size });
	}
	ctx.globalAlpha = base;
}

/** J.mainDraw: a laid-out text item (enter/exit presets apply via drawText). */
// eslint-disable-next-line opencut/prefer-object-params
function mainDraw(env: X2LayEnv, item: MainItem): void {
	const alpha = item.alpha ?? 1;
	if (alpha <= 0.003) return;
	const lead = item.lead ?? 1.3;
	const track = item.track ?? 0;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = item.color;
	ctx.textAlign = item.align ?? "center";
	env.setFontSize(item.size);
	const rot = item.rot ?? 0;
	if (rot) {
		ctx.save();
		ctx.translate(item.x, item.y);
		ctx.rotate(degrees(rot));
		ctx.textAlign = "center";
		env.drawText({
			text: item.text,
			x: 0,
			y: 0,
			maxWidth: measure(item.text, item.size, lead, track).w * 1.25,
			size: item.size,
		});
		ctx.restore();
		ctx.globalAlpha = base;
		return;
	}
	const lines = item.text.split("\n");
	const measured = measure(item.text, item.size, lead, track);
	let y = item.y - measured.h / 2 + (lead * item.size) / 2;
	for (const line of lines) {
		const lineWidth = measure(line, item.size, lead, track).w;
		const maxWidth = Math.max(item.size * 2, lineWidth * 1.25);
		env.drawText({ text: line, x: item.x, y, maxWidth, size: item.size });
		y += lead * item.size;
	}
	ctx.globalAlpha = base;
}

/** J.glyphPts: glyph centres of a laid-out item (tracked draws go per glyph). */
// eslint-disable-next-line opencut/prefer-object-params
function glyphPts(text: string, x: number, y: number, size: number, lead: number, track: number, align: CanvasTextAlign): GlyphPt[] {
	const out: GlyphPt[] = [];
	const lines = text.split("\n");
	const blockHeight = lines.length * lead * size;
	let lineY = y - blockHeight / 2 + (lead * size) / 2;
	for (let li = 0; li < lines.length; li += 1) {
		const line = lines[li]!;
		const chars = Array.from(line);
		const lineWidth =
			estimatedTextWidth({ size, text: line }) +
			track * size * Math.max(0, chars.length - 1);
		let gx = align === "left" ? x : align === "right" ? x - lineWidth : x - lineWidth / 2;
		for (const character of chars) {
			const w = size * (isSp(character) ? 0.34 : 0.62) + track * size;
			if (!isSp(character)) {
				out.push({ ch: character, h: size, li, w, x: gx + w / 2, y: lineY });
			}
			gx += w;
		}
		lineY += lead * size;
	}
	return out;
}

/** mainDraw with real letterspacing: per-glyph placement at glyphPts. */
// eslint-disable-next-line opencut/prefer-object-params
function mainDrawTracked(env: X2LayEnv, item: MainItem): void {
	const alpha = item.alpha ?? 1;
	if (alpha <= 0.003) return;
	const lead = item.lead ?? 1.3;
	const track = item.track ?? 0;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.fillStyle = item.color;
	ctx.textAlign = "center";
	env.setFontSize(item.size);
	for (const glyph of glyphPts(item.text, item.x, item.y, item.size, lead, track, item.align ?? "center")) {
		env.drawText({
			text: glyph.ch,
			x: glyph.x,
			y: glyph.y,
			maxWidth: glyph.w * 1.6,
			size: item.size,
		});
	}
	ctx.globalAlpha = base;
}

/* -------------------------------------------------------------- dispatch */

export function drawX2LayoutA(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "xaPullQuote":
		case "xaReceipt":
		case "xaCatalogCard":
		case "xaTimetable":
		case "xaThumbIndex":
		case "xaColumns":
		case "xaInitialPlate":
		case "xaSplitBaseline":
		case "xaHalfKnock":
		case "xaFormCombs":
		case "xaWaybill":
		case "xaErrata":
		case "xaTabStops":
		case "xaTriBand":
		case "xaAirmail":
		case "xaFigure":
		case "xaLineNumbers":
		case "xaPunchCard":
		case "xaSpacers":
		case "xaCutLine":
		case "xaChecklist":
		case "xaBlockquote":
		case "xaScreenplay":
		case "xaTearTabs":
		case "xaBrace":
		case "xaNutrition":
		case "xaDogEar":
		case "xaRuleSpecimen":
		case "xaLetterhead":
		case "xaSwatchFan":
			drawX2LayoutAPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2LayoutAPart(options: TypographyLayoutOptions): void {
	switch (options.frame.cut?.preset.layout) {
		case "xaPullQuote":
			drawPullQuote(options);
			return;
		case "xaReceipt":
			drawReceipt(options);
			return;
		case "xaCatalogCard":
			drawCatalogCard(options);
			return;
		case "xaTimetable":
			drawTimetable(options);
			return;
		case "xaThumbIndex":
			drawThumbIndex(options);
			return;
		case "xaColumns":
			drawColumns(options);
			return;
		case "xaInitialPlate":
			drawInitialPlate(options);
			return;
		case "xaSplitBaseline":
			drawSplitBaseline(options);
			return;
		case "xaHalfKnock":
			drawHalfKnock(options);
			return;
		case "xaFormCombs":
			drawFormCombs(options);
			return;
		case "xaWaybill":
			drawWaybill(options);
			return;
		case "xaErrata":
			drawErrata(options);
			return;
		case "xaTabStops":
			drawTabStops(options);
			return;
		case "xaTriBand":
			drawTriBand(options);
			return;
		case "xaAirmail":
			drawAirmail(options);
			return;
		case "xaFigure":
			drawFigure(options);
			return;
		case "xaLineNumbers":
			drawLineNumbers(options);
			return;
		case "xaPunchCard":
			drawPunchCard(options);
			return;
		case "xaSpacers":
			drawSpacers(options);
			return;
		case "xaCutLine":
			drawCutLine(options);
			return;
		case "xaChecklist":
			drawChecklist(options);
			return;
		case "xaBlockquote":
			drawBlockquote(options);
			return;
		case "xaScreenplay":
			drawScreenplay(options);
			return;
		case "xaTearTabs":
			drawTearTabs(options);
			return;
		case "xaBrace":
			drawBrace(options);
			return;
		case "xaNutrition":
			drawNutrition(options);
			return;
		case "xaDogEar":
			drawDogEar(options);
			return;
		case "xaRuleSpecimen":
			drawRuleSpecimen(options);
			return;
		case "xaLetterhead":
			drawLetterhead(options);
			return;
		case "xaSwatchFan":
			drawSwatchFan(options);
			return;
		default:
			return;
	}
}

/* ==================================================================== parts */

/** 抜き書き — the lyric as a pull quote between rules; greeked columns wrap it. */
function drawPullQuote(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const side = pickOf(seed, 1, ["c", "c", "l", "r"] as const);
	const rule = pickOf(seed, 2, ["thick", "double", "thinthick"] as const);
	const colsPlan = pickOf(seed, 3, [3, 4] as const);
	const acc = chanceOf(seed, 4, 0.6);
	const cols = port ? 2 : colsPlan;
	const mx = W * 0.07;
	const my = H * 0.08;
	const gut = W * 0.035;
	const colW = (W - mx * 2 - gut * (cols - 1)) / cols;
	const bw = port ? W - mx * 2 : W * 0.56;
	const f = fitBox(txt, bw * 0.9, H * (port ? 0.3 : 0.4), 1.25, 0.03, 3);
	const size = Math.min(f.size, M * 0.2);
	const m = measure(f.text, size, 1.25, 0.03);
	const bh = m.h + size * 1.15;
	const bx0 =
		port || side === "c"
			? (W - bw) / 2
			: side === "l"
				? mx
				: W - mx - bw;
	const by0 = H / 2 - bh / 2;
	const bx1 = bx0 + bw;
	const by1 = by0 + bh;
	const pitch = M * 0.032;
	const rows = Math.floor((H - my * 2) / pitch);
	const dim = dimOf(sc);
	const padX = gut * 0.7;
	for (let c = 0; c < cols; c += 1) {
		const x = mx + c * (colW + gut);
		for (let r = 0; r < rows; r += 1) {
			const ease = inC(env, 0.4, 0.012 * r + 0.05 * c) * out;
			if (ease <= 0) continue;
			const y = my + r * pitch;
			const k =
				randomUnit(seed, c, r, 7) < 0.1
					? 0.3 + 0.4 * randomUnit(seed, c, r, 8)
					: 1;
			let segments: Pt[] = [[x, x + colW * k]];
			if (y + pitch > by0 - pitch * 0.6 && y < by1 + pitch * 0.6) {
				segments = [
					[x, Math.min(x + colW * k, bx0 - padX)],
					[Math.max(x, bx1 + padX), x + colW * k],
				];
			}
			for (const [a, b] of segments) {
				if (b - a > colW * 0.14) R(env, a, y, (b - a) * ease, pitch * 0.36, dim, 0.9);
			}
		}
	}
	const rc = acc ? accentOn(sc) : sc.fg;
	const e2 = inE(env, 0.55, 0.05) * out;
	const th = Math.max(3, size * 0.05);
	if (e2 > 0) {
		const xa = bx0;
		const xb = bx0 + bw * e2;
		if (rule === "thick") {
			R(env, xa, by0, xb - xa, th, rc);
			R(env, bx1 - (xb - xa), by1 - th, xb - xa, th, rc);
		} else if (rule === "double") {
			for (const y of [by0, by0 + th * 0.9, by1 - th * 0.9, by1]) {
				Ln(env, xa, y, xb, y, rc, Math.max(lw, th * 0.3));
			}
		} else {
			Ln(env, xa, by0, xb, by0, rc, lw);
			R(env, xa, by0 + th * 0.7, xb - xa, th, rc);
			R(env, bx1 - (xb - xa), by1 - th * 1.7, xb - xa, th, rc);
			Ln(env, bx1 - (xb - xa), by1, bx1, by1, rc, lw);
		}
	}
	mainDraw(env, { color: sc.fg, lead: 1.25, size, text: f.text, track: 0.03, x: bx0 + bw / 2, y: H / 2 });
	label(env, `Q.${pad2(no)}`, bx0, by0 - ls * 1.1, { alpha: inC(env, 0.3, 0.3) * out, color: rc });
}

/** レシート — a printed till roll: mono rows, dashed dividers, total, zigzag tear. */
function drawReceipt(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, port, txt, out, lw, ls, seed, sc } = env;
	const tilt = pickOf(seed, 11, [0, 0, -2, 2.5] as const);
	const bar = chanceOf(seed, 12, 0.7);
	const rowsPlan = intOf(seed, 13, 2, 3);
	const pw = port ? W * 0.8 : Math.min(W * 0.46, H * 0.84);
	const ph = H * 0.86;
	const x0 = (W - pw) / 2;
	const y0 = (H - ph) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.45);
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.5);
		const hh = ph * e;
		const yb = y0 + hh;
		const nT = 22;
		const d = pw * 0.014;
		const pts: Pt[] = [[x0, y0], [x0 + pw, y0]];
		for (let i = 0; i <= nT * 2; i += 1) {
			pts.push([x0 + pw - (pw * i) / (nT * 2), yb + (i % 2 ? d : 0)]);
		}
		poly(env, pts, paper, out);
		const vis = (fy: number): number =>
			clamp((hh - ph * fy) / (ph * 0.05)) * out;
		const Y = (fy: number): number => y0 + ph * fy;
		const xl = x0 + pw * 0.08;
		const xr = x0 + pw * 0.92;
		label(env, "RECEIPT", W / 2, Y(0.065), { align: "center", alpha: vis(0.065), color: ink, size: ls * 1.35 });
		label(env, `No.${String(1000 + (x2Hash(seed, 3) % 9000))}`, xl, Y(0.115), { alpha: vis(0.115), color: faint, size: ls * 0.9 });
		label(env, fmtTime(env.start), xr, Y(0.115), { align: "right", alpha: vis(0.115), color: faint, size: ls * 0.9 });
		dashL(env, xl, Y(0.15), xr, Y(0.15), ink, lw * 1.3, vis(0.15), [lw * 5, lw * 4]);
		for (let k = 0; k < rowsPlan; k += 1) {
			const fy = 0.195 + k * 0.045;
			const a = vis(fy);
			R(env, xl, Y(fy) - ls * 0.2, pw * (0.26 + 0.2 * randomUnit(seed, k, 9)), ls * 0.4, faint, a);
			label(env, `x${1 + (x2Hash(seed, k, 5) % 3)}`, xr, Y(fy), { align: "right", alpha: a, color: faint });
		}
		dashL(env, xl, Y(0.35), xr, Y(0.35), ink, lw * 1.3, vis(0.35), [lw * 5, lw * 4]);
		dashL(env, xl, Y(0.73), xr, Y(0.73), ink, lw * 1.3, vis(0.73), [lw * 5, lw * 4]);
		label(env, "TOTAL", xl, Y(0.785), { alpha: vis(0.785), color: ink, size: ls * 1.3 });
		label(env, `${glyphCountOf(txt)} GLYPHS`, xr, Y(0.785), { align: "right", alpha: vis(0.785), color: ink, size: ls * 1.3 });
		if (bar) {
			barcode(env, x0 + pw * 0.2, Y(0.85), pw * 0.6, ph * 0.075, ink, vis(0.9), seed);
		} else {
			label(env, "* THANK YOU *", W / 2, Y(0.89), { align: "center", alpha: vis(0.9), color: ink });
		}
		const f = fitBox(txt, pw * 0.82, ph * 0.31, 1.2, 0.02, 4);
		const size = Math.min(f.size, pw * 0.36);
		mainDraw(env, { color: ink, lead: 1.2, size, text: f.text, track: 0.02, x: W / 2, y: Y(0.54) });
	});
}

/** 図書カード — a library catalogue card: red head rule, call number, punched hole. */
function drawCatalogCard(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, no, seed, sc } = env;
	const tilt = pickOf(seed, 21, [-2, 0, 1.5] as const);
	const back = chanceOf(seed, 22, 0.6);
	const cls = intOf(seed, 23, 100, 899);
	const cw = port ? W * 0.88 : Math.min(W * 0.8, H * 0.8 * 1.62);
	const ch = port ? Math.min(cw * 1.25, H * 0.62) : cw * 0.6;
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.28);
	const red = accOn(sc, paper);
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.4);
		const a = e * out;
		const r = M * 0.012;
		const nR = port ? 9 : 6;
		const g = (ch * 0.69) / nR;
		const yr = y0 + ch * (port ? 0.15 : 0.2);
		const xm = x0 + cw * 0.17;
		if (back) {
			rrect(env, x0 - M * 0.022 * e, y0 - M * 0.026 * e, cw, ch, r, mixOf(paper, sc.bg, 0.45), a);
		}
		rrect(env, x0, y0 + (1 - e) * M * 0.03, cw, ch, r, paper, a);
		const e2 = inE(env, 0.6, 0.12);
		R(env, x0, yr - lw, cw * e2, lw * 2.4, red, out);
		for (let k = 1; k <= nR; k += 1) {
			Ln(env, x0, yr + g * k, x0 + cw * inE(env, 0.6, 0.12 + k * 0.04), yr + g * k, faint, lw, out);
		}
		for (const dx of [0, lw * 4]) {
			Ln(env, xm + dx, y0, xm + dx, y0 + ch * e2, red, lw, 0.6 * out);
		}
		const la = inC(env, 0.3, 0.3) * out;
		const labels = [
			`${cls}.${x2Hash(seed, 2) % 10}`,
			isLatinText(txt) ? "Ly" : "Ji",
			pad2(no),
		];
		labels.forEach((text, i) => {
			label(env, text, x0 + cw * 0.085, yr + g * (i + 0.5), { align: "center", alpha: la, color: ink });
		});
		label(env, `CARD No. ${String(no).padStart(4, "0")}`, xm + cw * 0.03, y0 + ch * (port ? 0.08 : 0.11), { alpha: la, color: faint });
		label(env, shortOf(txt, port ? 16 : 26), xm + cw * 0.03, yr + g * (nR - 0.5), { alpha: la, color: faint });
		label(env, `${glyphCountOf(txt)} p. ; 21 cm.`, xm + cw * 0.03, yr + g * (nR + 0.5), { alpha: la, color: faint });
		disc(env, W / 2, y0 + ch * 0.925, ch * 0.032, sc.bg, a);
		const f = fitBox(txt, cw * 0.74, g * (nR - 2.5), 1.22, 0.03, port ? 4 : 3);
		const size = Math.min(f.size, ch * 0.3);
		mainDraw(env, {
			align: "left",
			color: ink,
			lead: 1.22,
			size,
			text: f.text,
			track: 0.03,
			x: xm + cw * 0.03,
			y: yr + (g * (nR - 1)) / 2 + g * 0.05,
		});
	});
}

/** 時刻表 — a printed timetable: header band, time column, lyric rows highlighted. */
function drawTimetable(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, no, seed, sc } = env;
	const hl = pickOf(seed, 31, ["bar", "tri", "band"] as const);
	const pre = intOf(seed, 32, 1, 2);
	const postPlan = intOf(seed, 33, 1, 2);
	const h0 = intOf(seed, 34, 5, 22);
	const m0 = intOf(seed, 35, 0, 20);
	const n = Array.from(txt).length;
	const per = port ? 5 : 10;
	const lines =
		n <= per
			? [txt]
			: smartSplit(txt, Math.min(port ? 4 : 3, Math.ceil(n / per)), port);
	const post = port && lines.length < 3 ? postPlan + 1 : postPlan;
	const rows = pre + lines.length + post;
	const tw = W * 0.86;
	const x0 = W * 0.07;
	const rh = Math.min((H * 0.82) / (rows + 0.6), M * 0.24);
	const hh = rh * 0.6;
	const y0 = (H - rh * rows - hh) / 2;
	const c1 = tw * (port ? 0.22 : 0.19);
	const c3 = tw * (port ? 0.11 : 0.09);
	const dim = dimOf(sc);
	const acc = accentOn(sc);
	const head = pickPlate(sc, "ink");
	const hon = onCol(sc, head);
	const e0 = inE(env, 0.45) * out;
	R(env, x0, y0, tw * e0, hh, head, 1);
	const la = inC(env, 0.3, 0.2) * out;
	label(env, "TIME", x0 + tw * 0.015, y0 + hh / 2, { alpha: la, color: hon, size: hh * 0.42 });
	label(env, `LINE ${pad2(no)}`, x0 + c1 + tw * 0.02, y0 + hh / 2, { alpha: la, color: hon, size: hh * 0.42 });
	label(env, "PF", x0 + tw - tw * 0.015, y0 + hh / 2, { alpha: la, align: "right", color: hon, size: hh * 0.42 });
	const lyW = tw - c1 - c3 - tw * 0.04;
	const size = Math.min(
		...lines.map((line) => fitSize(line, lyW, rh * 0.62, 1.3, 0.03)),
	);
	let mins = m0;
	for (let r = 0; r < rows; r += 1) {
		const y = y0 + hh + rh * r;
		const cy = y + rh / 2;
		const li = r - pre;
		const isL = li >= 0 && li < lines.length;
		const a = inC(env, 0.3, 0.08 + r * 0.05) * out;
		mins += 3 + (x2Hash(seed, r, 11) % 9);
		const tm = `${pad2((h0 + Math.floor(mins / 60)) % 24)}:${pad2(mins % 60)}`;
		Ln(env, x0, y + rh, x0 + tw * inE(env, 0.5, 0.08 + r * 0.05), y + rh, sc.sub, lw, 0.6 * out);
		if (isL && hl === "band") {
			R(env, x0, y + lw, tw * inE(env, 0.5, 0.1 + r * 0.05), rh - lw * 2, dim, 0.7 * out);
		}
		label(env, tm, x0 + tw * 0.015, cy, {
			alpha: a * (isL ? 1 : 0.7),
			color: isL ? sc.fg : sc.sub,
			size: Math.min(rh * 0.34, c1 * 0.2),
		});
		if (isL) {
			if (hl === "bar") {
				R(env, x0 - tw * 0.012, y + rh * 0.14, tw * 0.008, rh * 0.72 * inE(env, 0.4, 0.15 + r * 0.05), acc, out);
			}
			if (hl === "tri" && a > 0) {
				const s = rh * 0.13;
				const tx = x0 + c1 - s * 1.2;
				poly(env, [[tx, cy - s], [tx + s * 1.4, cy], [tx, cy + s]], acc, a);
			}
			mainDraw(env, {
				align: "left",
				color: sc.fg,
				size,
				text: lines[li] ?? "",
				track: 0.03,
				x: x0 + c1 + tw * 0.02,
				y: cy,
			});
		} else {
			R(
				env,
				x0 + c1 + tw * 0.02,
				cy - rh * 0.07,
				lyW * (0.3 + 0.4 * randomUnit(seed, r, 13)) * inE(env, 0.5, 0.1 + r * 0.05),
				rh * 0.14,
				dim,
				out,
			);
		}
		const bs = Math.min(rh * 0.44, c3 * 0.7);
		rrect(
			env,
			x0 + tw - tw * 0.015 - bs,
			cy - bs / 2,
			bs,
			bs,
			bs * 0.2,
			null,
			a * (isL ? 1 : 0.5),
			isL ? acc : sc.sub,
			lw * 1.4,
		);
		label(env, String(1 + (x2Hash(seed, r, 17) % 8)), x0 + tw - tw * 0.015 - bs / 2, cy, {
			align: "center",
			alpha: a * (isL ? 1 : 0.6),
			color: isL ? acc : sc.sub,
			size: bs * 0.6,
		});
	}
}

/** 爪見出し — thumb-index tabs down the page edge; the active tab holds the initial. */
function drawThumbIndex(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const side = pickOf(seed, 41, ["r", "r", "l"] as const);
	const nT = pickOf(seed, 42, [6, 7, 8] as const);
	const act = intOf(seed, 43, 0, 7) % nT;
	const colKind = pickOf(seed, 44, ["accent", "accent", "ink"] as const);
	const right = side === "r";
	const th = (H * 0.84) / nT;
	const tw = M * 0.1;
	const y0 = H * 0.08;
	const set = isLatinText(txt) ? "ABCDEFGH" : "あかさたなはまや";
	const dim = dimOf(sc);
	const plate = pickPlate(sc, colKind);
	const pon = onCol(sc, plate);
	const slots = slotsOf(txt);
	const first = slots.find((character) => !isSp(character) && !isPunctCh(character)) ?? "・";
	let ay = 0;
	let aw = 0;
	for (let i = 0; i < nT; i += 1) {
		const e = inE(env, 0.45, 0.04 * i) * out;
		if (e <= 0) continue;
		const on = i === act;
		const w = tw * (on ? 1.55 : 1) * e;
		const y = y0 + th * i + th * 0.08;
		const h = th * 0.84;
		const x = right ? W - w : -th;
		rrect(env, x, y, w + th, h, h * 0.28, on ? plate : dim, 1);
		label(
			env,
			on ? first : set[i % set.length] ?? "・",
			right ? W - w / 2 - (1 - e) * tw : w / 2,
			y + h / 2,
			{
				align: "center",
				alpha: e,
				color: on ? pon : sc.sub,
				size: h * (on ? 0.6 : 0.36),
			},
		);
		if (on) {
			ay = y + h / 2;
			aw = w;
		}
	}
	const availW = W * 0.9 - tw * 1.75;
	const f = fitBox(txt, availW, H * (port ? 0.5 : 0.56), 1.22, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.26);
	const align: CanvasTextAlign = right ? "left" : "right";
	const ix = right ? W * 0.07 : W * 0.93;
	const m = measure(f.text, size, 1.22, 0.03);
	const hy = Math.max(H * 0.07, H / 2 - m.h / 2 - size * 0.45);
	const e2 = inE(env, 0.6, 0.1) * out;
	const hx0 = right ? W * 0.07 : W * 0.93 - availW;
	Ln(env, hx0, hy, hx0 + availW * e2, hy, sc.sub, lw, 0.8);
	label(env, `INDEX — ${pad2(no)}`, right ? hx0 : hx0 + availW, hy - ls * 0.9, { align: right ? "left" : "right", alpha: inC(env, 0.3, 0.25) * out });
	const tx = right ? W * 0.07 + m.w + size * 0.2 : W * 0.93 - m.w - size * 0.2;
	const ex = right ? W - aw - M * 0.012 : aw + M * 0.012;
	if ((right ? ex - tx : tx - ex) > M * 0.03 && e2 > 0) {
		Ln(env, ex, ay, lerpN(ex, tx, e2), ay, plate, lw * 1.5, 0.9);
		disc(env, lerpN(ex, tx, e2), ay, lw * 3, plate, e2);
	}
	mainDraw(env, { align, color: sc.fg, lead: 1.22, size, text: f.text, track: 0.03, x: ix, y: H / 2 });
}

/** 段組 — the lyric runs down narrow newspaper columns with rules and greek. */
function drawColumns(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const rule = chanceOf(seed, 51, 0.8);
	const foot = chanceOf(seed, 52, 0.35);
	const num = chanceOf(seed, 53, 0.7);
	const n = Array.from(txt).length;
	const latin = isLatinText(txt);
	let C = n <= 7 ? 2 : port ? 2 : 3;
	let segments = smartSplit(txt, C, false);
	while (segments.length > 3) {
		const tail = segments.pop() ?? "";
		segments[segments.length - 1] = `${segments[segments.length - 1] ?? ""}${latin ? " " : ""}${tail}`;
	}
	C = segments.length;
	const narrow = (s: string): string => {
		const k = Array.from(s).length;
		if (latin) return splitL(s, 7);
		return k <= 3 ? s : evenSplit(s, Math.ceil(k / 3)).join("\n");
	};
	segments = segments.map(narrow);
	const x0 = W * 0.07;
	const aw = W * 0.86;
	const gut = W * (port ? 0.06 : 0.045);
	const colW = (aw - gut * (C - 1)) / C;
	const headY = H * 0.13;
	const footY = H * 0.9;
	const size = Math.min(
		M * 0.24,
		...segments.map((s) => fitSize(s, colW * 0.94, H * 0.5, 1.2, 0.02)),
	);
	const e0 = inE(env, 0.5) * out;
	const dim = dimOf(sc);
	const pitch = M * 0.034;
	R(env, x0, headY - M * 0.006, aw * e0, M * 0.006, sc.fg, 1);
	Ln(env, x0, headY + M * 0.007, x0 + aw * e0, headY + M * 0.007, sc.fg, lw, 1);
	label(env, `P.${pad2(env.no)}`, x0 + aw, headY - M * 0.006 - ls, { align: "right", alpha: inC(env, 0.3, 0.2) * out });
	segments.forEach((s, i) => {
		const cx = x0 + i * (colW + gut);
		const m = measure(s, size, 1.2, 0.02);
		const top = headY + M * 0.05;
		const gy0 = foot ? top : top + m.h + pitch * 1.3;
		const gy1 = foot ? footY - m.h - pitch * 1.3 : footY;
		const iy = foot ? footY - m.h / 2 : top + m.h / 2;
		const rows = Math.max(0, Math.floor((gy1 - gy0) / pitch));
		greek(env, cx, gy0, colW, rows, pitch, dim, 0.9 * out, x2Hash(seed, i, 21), inE(env, 0.6, 0.15 + i * 0.1));
		if (num) {
			label(env, pad2(i + 1), cx, headY - M * 0.006 - ls, { alpha: inC(env, 0.3, 0.15 + i * 0.08) * out, color: accentOn(sc) });
		}
		if (rule && i > 0) {
			Ln(env, cx - gut / 2, headY + M * 0.03, cx - gut / 2, lerpN(headY + M * 0.03, footY, inE(env, 0.7, 0.1 + i * 0.08)), sc.sub, lw, 0.7 * out);
		}
		mainDraw(env, { align: "left", color: sc.fg, lead: 1.2, size, text: s, track: 0.02, x: cx, y: iy });
	});
}

/** 白抜き頭文字 — the initial glyph knocked out of a solid plate, rest beside it. */
function drawInitialPlate(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, port, txt, sc } = env;
	const colKind = pickOf(env.seed, 61, ["accent", "ink", "fg"] as const);
	const shape = pickOf(env.seed, 62, ["sq", "sq", "circle", "tall"] as const);
	const al = pickOf(env.seed, 63, ["top", "base", "mid"] as const);
	const slots = slotsOf(txt);
	const init = slots[0] ?? "?";
	const rest = slots.slice(1).join("").trim() || "…";
	const plate = pickPlate(sc, colKind);
	const pon = onCol(sc, plate);
	const kx = shape === "tall" ? 0.74 : 1;
	let S: number;
	let f: { readonly size: number; readonly text: string };
	let size: number;
	let px: number;
	let py: number;
	let ix: number;
	let iy: number;
	if (!port) {
		S = Math.min(H * 0.48, W * 0.3);
		const gap = S * 0.14;
		const Sw = S * kx;
		f = fitBox(rest, W * 0.88 - Sw - gap, S, 1.2, 0.03, 3);
		size = Math.min(f.size, S * 0.5);
		const m = measure(f.text, size, 1.2, 0.03);
		const tot = Sw + gap + m.w;
		px = (W - tot) / 2 + Sw / 2;
		py = H / 2;
		ix = px + Sw / 2 + gap;
		iy = al === "top" ? py - S / 2 + m.h / 2 : al === "base" ? py + S / 2 - m.h / 2 : py;
	} else {
		S = Math.min(W * 0.46, H * 0.26);
		const gap = S * 0.16;
		const Sw = S * kx;
		f = fitBox(rest, W * 0.84, H * 0.36, 1.2, 0.03, 4);
		size = Math.min(f.size, S * 0.5);
		const m = measure(f.text, size, 1.2, 0.03);
		const tot = S + gap + m.h;
		const bx = Math.max(W * 0.08, (W - Math.max(m.w, Sw)) / 2);
		px = bx + Sw / 2;
		py = (H - tot) / 2 + S / 2;
		ix = bx;
		iy = py + S / 2 + gap + m.h / 2;
	}
	const e = oBack(clamp(env.lt / 0.42), 1.4);
	const Sw = S * kx;
	if (e > 0 && env.out > 0) {
		if (shape === "circle") {
			disc(env, px, py, (S / 2) * e, plate, env.out);
		} else {
			R(env, px - (Sw / 2) * e, py - (S / 2) * e, Sw * e, S * e, plate, env.out);
		}
	}
	const gs = Math.min(S * (shape === "circle" ? 0.6 : 0.76), fitSize(init, Sw * 0.84, S * 0.84, 1.3, 0));
	mainDraw(env, { color: pon, size: gs, text: init, x: px, y: py });
	const e2 = inE(env, 0.6, 0.2) * env.out;
	if (!port && e2 > 0) {
		const y = al === "base" ? py - S / 2 : py + S / 2;
		const m = measure(f.text, size, 1.2, 0.03);
		Ln(env, px + Sw / 2, y, px + Sw / 2 + (ix - px - Sw / 2 + m.w) * e2, y, plate, env.lw * 1.5, 1);
	}
	mainDraw(env, { align: "left", color: sc.fg, lead: 1.2, size, text: f.text, track: 0.03, x: ix, y: iy });
}

/** 段違い基線 — two halves on two baselines; one stepped rule runs through them. */
function drawSplitBaseline(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const dir = pickOf(seed, 71, [1, 1, -1] as const);
	const acc = chanceOf(seed, 72, 0.5);
	const tick = chanceOf(seed, 73, 0.6);
	const n = Array.from(txt).length;
	const latin = isLatinText(txt);
	let parts = splitL(txt, Math.ceil(n / 2)).split("\n");
	if (parts.length < 2) {
		const chars = Array.from(txt);
		const half = Math.ceil(chars.length / 2);
		parts = [chars.slice(0, half).join(""), chars.slice(half).join("")];
	}
	const A = parts[0] ?? "";
	const B = parts.slice(1).join(latin ? " " : "");
	const aw = port ? W * 0.76 : W * 0.56;
	const mh = port ? H * 0.2 : H * 0.3;
	const size = Math.min(
		fitSize(A, aw, mh, 1.3, 0.03),
		fitSize(B, aw, mh, 1.3, 0.03),
		M * 0.26,
	);
	const dy = size * (port ? 0.95 : 0.6) * dir;
	const yA = H / 2 - dy;
	const yB = H / 2 + dy;
	const mA = measure(A, size, 1.3, 0.03);
	const mB = measure(B, size, 1.3, 0.03);
	const bA = yA + size * 0.6;
	const bB = yB + size * 0.6;
	const xa = W * 0.07 + mA.w + size * 0.18;
	const xb = W * 0.93 - mB.w - size * 0.18;
	const rc = acc ? accentOn(sc) : sc.fg;
	const e = inOutCubic(clamp(env.lt / 0.7));
	if (out > 0) {
		if (env.pOut > 0) {
			polyPartial(env, [[W + 10, bB], [xb, bB], [xa, bA], [-10, bA]], out, rc, Math.max(2, size * 0.022), 1);
		} else {
			polyPartial(env, [[-10, bA], [xa, bA], [xb, bB], [W + 10, bB]], e, rc, Math.max(2, size * 0.022), 1);
		}
	}
	if (tick) {
		const a = inC(env, 0.3, 0.45) * out;
		for (let k = 0; k < 5; k += 1) {
			Ln(env, W * 0.07 + k * size * 0.5, bA, W * 0.07 + k * size * 0.5, bA + size * 0.07, rc, lw, a);
			Ln(env, W * 0.93 - k * size * 0.5, bB, W * 0.93 - k * size * 0.5, bB + size * 0.07, rc, lw, a);
		}
		label(env, `BL ${dir > 0 ? "+" : "−"}${Math.round(Math.abs(dy) * 2)}`, (xa + xb) / 2 + size * 0.12, (bA + bB) / 2 + ls * 0.9, { alpha: a });
	}
	mainDraw(env, { align: "left", color: sc.fg, size, text: A, track: 0.03, x: W * 0.07, y: yA });
	mainDraw(env, { align: "right", color: sc.fg, size, text: B, track: 0.03, x: W * 0.93, y: yB });
}

/** 版またぎ — the lyric straddles a solid plate: positive off it, reversed on it. */
function drawHalfKnock(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, sc, ctx } = env;
	const edgeKind = pickOf(env.seed, 81, ["h", "h", "v"] as const);
	const side = pickOf(env.seed, 82, [0, 1] as const);
	const colKind = pickOf(env.seed, 83, ["fg", "accent", "ink"] as const);
	const mt = mainLines(txt, W, H, 10, 5);
	const lead = 1.2;
	const lineCount = mt.split("\n").length;
	const size = Math.min(fitSize(mt, W * 0.84, H * 0.6, lead, 0.02), M * 0.34);
	const plate = pickPlate(sc, colKind);
	const pon = onCol(sc, plate);
	const q = inE(env, 0.5) * (1 - inExpoE(env.pOut));
	const horiz = edgeKind === "h";
	const edge = horiz
		? H / 2 + (Math.floor((lineCount - 1) / 2) - (lineCount - 1) / 2) * size * lead + size * 0.03
		: W / 2;
	let pr: readonly [number, number, number, number];
	let cr: readonly [number, number, number, number];
	if (horiz) {
		const y = side ? H - (H - edge) * q : edge * q;
		pr = side ? [-W, y, W * 3, H * 2] : [-W, -H, W * 3, H + y];
		cr = side ? [-W, -H, W * 3, H + y] : [-W, y, W * 3, H * 2];
	} else {
		const x = side ? W - (W - edge) * q : edge * q;
		pr = side ? [x, -H, W * 2, H * 3] : [-W, -H, W + x, H * 3];
		cr = side ? [-W, -H, W + x, H * 3] : [x, -H, W * 2, H * 3];
	}
	if (q > 0) R(env, pr[0], pr[1], pr[2], pr[3], plate, 1);
	const drawItem = (color: string): void => {
		mainDraw(env, { color, lead, size, text: mt, track: 0.02, x: W / 2, y: H / 2 });
	};
	ctx.save();
	ctx.beginPath();
	ctx.rect(cr[0], cr[1], cr[2], cr[3]);
	ctx.clip();
	drawItem(sc.fg);
	ctx.restore();
	if (q > 0) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(pr[0], pr[1], pr[2], pr[3]);
		ctx.clip();
		drawItem(pon);
		ctx.restore();
	}
	const a = inC(env, 0.3, 0.35) * env.out;
	const ls = env.ls;
	if (horiz) {
		const s = side ? 1 : -1;
		label(env, "NEGA", W * 0.05, edge + s * ls, { alpha: a * (q > 0.98 ? 1 : 0), color: pon });
		label(env, "POSI", W * 0.05, edge - s * ls, { alpha: a });
	} else {
		const s = side ? 1 : -1;
		label(env, "NEGA", edge + s * ls * 0.8, H * 0.95, { alpha: a * (q > 0.98 ? 1 : 0), align: s > 0 ? "left" : "right", color: pon });
		label(env, "POSI", edge - s * ls * 0.8, H * 0.95, { alpha: a, align: s > 0 ? "right" : "left" });
	}
}

/** 記入欄 — an application form: one comb cell per glyph, labels, a ticked box. */
function drawFormCombs(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const hd = pickOf(seed, 91, ["ink", "accent"] as const);
	const full = chanceOf(seed, 92, 0.5);
	const chk = chanceOf(seed, 93, 0.8);
	const slots = slotsOf(txt);
	const per = port ? 5 : 8;
	const rowsA =
		slots.length <= per
			? [slots.join("")]
			: evenSplit(slots.join(""), Math.ceil(slots.length / per));
	const rows = rowsA.length;
	const mxn = Math.max(...rowsA.map((row) => Array.from(row).length));
	const cell = Math.min((W * 0.8) / mxn, (H * 0.56) / (rows * 1.5), M * 0.26);
	const pitch = cell * 1.5;
	const bw = cell * mxn;
	const x0 = (W - bw) / 2;
	const y0 = H / 2 - (rows * pitch) / 2 + cell * 0.1;
	const padF = cell * 0.4;
	const fx0 = x0 - padF;
	const fy0 = y0 - padF - ls * 2.2;
	const fw = bw + padF * 2;
	const fh = rows * pitch + padF * 1.4 + ls * 2.2 + (chk ? ls * 2.6 : 0);
	const e0 = inE(env, 0.5) * out;
	const head = pickPlate(sc, hd);
	const hon = onCol(sc, head);
	const la = inC(env, 0.3, 0.25) * out;
	if (e0 > 0) {
		polyPartial(
			env,
			[[fx0, fy0], [fx0 + fw, fy0], [fx0 + fw, fy0 + fh], [fx0, fy0 + fh], [fx0, fy0]],
			e0,
			sc.sub,
			lw * 1.4,
			0.9,
		);
	}
	R(env, fx0, fy0, fw * 0.36 * e0, ls * 1.9, head, 1);
	label(env, `FORM ${pad2(no)}-A`, fx0 + ls * 0.6, fy0 + ls * 0.95, { alpha: la, color: hon });
	label(env, `${glyphCountOf(txt)} / ${mxn * rows}`, fx0 + fw - ls * 0.6, fy0 + ls * 0.95, { align: "right", alpha: la });
	rowsA.forEach((row, r) => {
		const yb = y0 + r * pitch + cell * 1.12;
		const e = inE(env, 0.5, 0.1 + r * 0.08) * out;
		Ln(env, x0, yb, x0 + bw * e, yb, sc.fg, lw * 1.6, 1);
		for (let k = 0; k <= mxn; k += 1) {
			const end = k === 0 || k === mxn;
			const hh = cell * (end || full ? 1.0 : 0.3) * e;
			Ln(env, x0 + k * cell, yb, x0 + k * cell, yb - hh, end ? sc.fg : sc.sub, end ? lw * 1.6 : lw, 1);
		}
		const chars = Array.from(row);
		chars.forEach((ch, k) => {
			if (!isSp(ch)) {
				mainDraw(env, { color: sc.fg, size: cell * 0.72, text: ch, x: x0 + (k + 0.5) * cell, y: yb - cell * 0.52 });
			}
		});
	});
	if (chk) {
		const cy = fy0 + fh - ls * 1.5;
		const bs = ls * 1.2;
		const cx = fx0 + padF;
		frameR(env, cx, cy - bs / 2, bs, bs, sc.fg, lw * 1.4, la);
		const ec = outCubic(clamp((env.lt - 0.55) / 0.25)) * out;
		if (ec > 0) {
			polyPartial(
				env,
				[[cx + bs * 0.15, cy], [cx + bs * 0.42, cy + bs * 0.3], [cx + bs * 1.05, cy - bs * 0.55]],
				ec,
				accentOn(sc),
				lw * 3,
				1,
			);
		}
		label(env, "CONFIRMED", cx + bs * 1.5, cy, { alpha: la });
		frameR(env, cx + fw * 0.5, cy - bs / 2, bs, bs, sc.sub, lw * 1.4, la);
		label(env, "VOID", cx + fw * 0.5 + bs * 1.5, cy, { alpha: la });
	}
}

/** 送り状 — a shipping label: heavy frame, FROM/TO cells, code plate, barcode. */
function drawWaybill(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, ls, seed, sc } = env;
	const code = pickOf(seed, 101, ["KX", "JZ", "TY", "OS", "NR", "HK"] as const);
	const num = intOf(seed, 102, 1, 99);
	const tilt = pickOf(seed, 103, [0, 0, -1.5, 1.5] as const);
	const flip = chanceOf(seed, 104, 0.5);
	const cw = port ? W * 0.86 : Math.min(W * 0.8, H * 0.8 * 1.5);
	const ch = port ? Math.min(H * 0.66, cw * 1.3) : H * 0.8;
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.35);
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.5);
		const la = inC(env, 0.3, 0.22) * out;
		const bl = Math.max(3, M * 0.006);
		const e2 = inE(env, 0.55, 0.12);
		R(env, x0, y0, cw, ch * e, paper, out);
		const fx = x0 + bl * 2.5;
		const fy = y0 + bl * 2.5;
		const fw = cw - bl * 5;
		const fh = ch - bl * 5;
		const y1 = fy + fh * 0.24;
		const y2 = fy + fh * 0.76;
		if (e2 > 0 && out > 0) {
			polyPartial(
				env,
				[[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh], [fx, fy]],
				e2,
				ink,
				bl,
				out,
			);
		}
		Ln(env, fx, y1, fx + fw * e2, y1, ink, bl * 0.7, out);
		Ln(env, fx + fw, y2, fx + fw - fw * e2, y2, ink, bl * 0.7, out);
		const xv = fx + fw * (flip ? 0.36 : 0.64);
		Ln(env, xv, fy, xv, fy + (y1 - fy) * e2, ink, bl * 0.7, out);
		const fromX = flip ? xv : fx;
		const fromW = flip ? fx + fw - xv : xv - fx;
		const codeX = flip ? fx : xv;
		const codeW = fw - fromW;
		label(env, "FROM", fromX + ls * 0.8, fy + ls * 1.3, { alpha: la, color: ink, size: ls * 0.9 });
		greek(env, fromX + ls * 0.8, fy + ls * 2.6, fromW * 0.6, 2, ls * 1.1, faint, la, seed, inE(env, 0.5, 0.25));
		R(env, codeX, fy, codeW, (y1 - fy) * e2, ink, out);
		const codeText = `${code}-${pad2(num)}`;
		label(env, codeText, codeX + codeW / 2, (fy + y1) / 2, {
			align: "center",
			alpha: la,
			color: paper,
			size: Math.min((y1 - fy) * 0.5, fitSize(codeText, codeW * 0.8, 1e6, 1.3, 0.06)),
		});
		label(env, "TO", fx + ls * 0.8, y1 + ls * 1.3, { alpha: la, color: ink, size: ls * 0.9 });
		barcode(env, fx + ls * 0.8, y2 + (fy + fh - y2) * 0.22, fw * 0.5, (fy + fh - y2) * 0.56, ink, la, seed, inE(env, 0.6, 0.3));
		label(env, "PCS 1/1", fx + fw - ls * 0.8, y2 + (fy + fh - y2) * 0.33, { align: "right", alpha: la, color: ink });
		label(env, `No.${String(100000 + (x2Hash(seed, 9) % 899999))}`, fx + fw - ls * 0.8, y2 + (fy + fh - y2) * 0.68, { align: "right", alpha: la, color: faint });
		const f = fitBox(txt, fw * 0.88, (y2 - y1) * 0.7, 1.2, 0.02, port ? 4 : 3);
		const size = Math.min(f.size, M * 0.26);
		mainDraw(env, { color: ink, lead: 1.2, size, text: f.text, track: 0.02, x: W / 2, y: (y1 + y2) / 2 + ls * 0.5 });
	});
}

/** 正誤表 — an errata slip: the struck-out line above, the correction below. */
function drawErrata(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const strike = pickOf(seed, 111, ["line", "double", "wave"] as const);
	const pg = intOf(seed, 112, 3, 240);
	const ln = intOf(seed, 113, 1, 24);
	const latin = isLatinText(txt);
	const labs = latin ? ["FOR", "READ"] : ["誤", "正"];
	const tw = W * 0.86;
	const x0 = W * 0.07;
	const lc = M * (latin ? 0.15 : 0.12);
	const hh = ls * 2.4;
	const h1 = H * (port ? 0.2 : 0.25);
	const h2 = H * (port ? 0.38 : 0.44);
	const th = hh + h1 + h2;
	const y0 = (H - th) / 2;
	const acc = accentOn(sc);
	const pad = M * 0.035;
	const e = inE(env, 0.6) * out;
	const la = inC(env, 0.3, 0.2) * out;
	R(env, x0, y0 + hh - M * 0.005, tw * e, M * 0.005, sc.fg, 1);
	Ln(env, x0, y0 + hh + h1, x0 + tw * e, y0 + hh + h1, sc.sub, lw, 0.8);
	R(env, x0 + tw * (1 - e), y0 + th, tw * e, M * 0.005, sc.fg, 1);
	Ln(env, x0 + lc, y0 + hh, x0 + lc, y0 + hh + (h1 + h2) * e, sc.sub, lw, 0.8);
	label(env, latin ? "ERRATA" : "正誤表", x0, y0 + hh * 0.42, { alpha: la, color: sc.fg, size: ls * 1.25 });
	label(env, `p.${pg}  l.${ln}`, x0 + tw, y0 + hh * 0.42, { align: "right", alpha: la });
	const lsz2 = latin ? lc * 0.24 : lc * 0.44;
	label(env, labs[0] ?? "", x0 + lc / 2, y0 + hh + h1 / 2, { align: "center", alpha: la, color: sc.sub, size: lsz2 });
	label(env, labs[1] ?? "", x0 + lc / 2, y0 + hh + h1 + h2 / 2, { align: "center", alpha: la, color: acc, size: lsz2 });
	const fw = fitBox(txt, tw - lc - pad * 2, h1 * 0.68, 1.2, 0.03, 2);
	const wrongX = x0 + lc + pad;
	const wrongY = y0 + hh + h1 / 2;
	mainDraw(env, { align: "left", alpha: 0.8 * la, color: sc.sub, lead: 1.2, size: fw.size, text: fw.text, track: 0.03, x: wrongX, y: wrongY });
	const glyphs = glyphPts(fw.text, wrongX, wrongY, fw.size, 1.2, 0.03, "left");
	const rowsX = new Map<number, { a: number; b: number; y: number }>();
	for (const glyph of glyphs) {
		const row = rowsX.get(glyph.li) ?? { a: 1e9, b: -1e9, y: glyph.y };
		rowsX.set(glyph.li, {
			a: Math.min(row.a, glyph.x - glyph.w / 2),
			b: Math.max(row.b, glyph.x + glyph.w / 2),
			y: row.y,
		});
	}
	const es = inOutCubic(clamp((env.lt - 0.35) / 0.4)) * out;
	if (es > 0) {
		for (const row of rowsX.values()) {
			const xa = row.a - fw.size * 0.1;
			const xb = lerpN(xa, row.b + fw.size * 0.1, es);
			const sw = Math.max(2, fw.size * 0.045);
			if (strike === "wave") {
				const pts: Pt[] = [];
				for (let x = xa; x <= xb; x += fw.size * 0.08) {
					pts.push([x, row.y + Math.sin((x - xa) / (fw.size * 0.16)) * fw.size * 0.07]);
				}
				if (pts.length > 1) polyLine(env, pts, acc, sw, 1);
			} else if (strike === "double") {
				Ln(env, xa, row.y - fw.size * 0.08, xb, row.y - fw.size * 0.08, acc, sw * 0.7);
				Ln(env, xa, row.y + fw.size * 0.08, xb, row.y + fw.size * 0.08, acc, sw * 0.7);
			} else {
				Ln(env, xa, row.y, xb, row.y, acc, sw);
			}
		}
	}
	const f = fitBox(txt, tw - lc - pad * 2, h2 * 0.78, 1.2, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.24);
	mainDraw(env, { align: "left", color: sc.fg, lead: 1.2, size, text: f.text, track: 0.03, x: x0 + lc + pad, y: y0 + hh + h1 + h2 / 2 });
}

/** タブ揃え — a word-processor ruler with tab stops; lines hang from the stops. */
function drawTabStops(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const dir = pickOf(seed, 121, [1, 1, -1] as const);
	const guide = chanceOf(seed, 122, 0.85);
	const arrow = chanceOf(seed, 123, 0.7);
	const n = Array.from(txt).length;
	const lineCount = port
		? n <= 3 ? 1 : n <= 7 ? 2 : n <= 11 ? 3 : 4
		: n <= 4 ? 1 : n <= 10 ? 2 : 3;
	const lines = smartSplit(txt, lineCount, port);
	const L = lines.length;
	const x0 = W * 0.07;
	const tw = W * 0.86;
	const ry = H * 0.1;
	const stp = W * (port ? 0.075 : 0.09);
	const acc = accentOn(sc);
	const ind = (k: number): number =>
		stp * ((dir > 0 ? k : L - 1 - k) + (L === 1 ? 1 : 0.5));
	const areaH = H * 0.66;
	const size = Math.min(
		M * 0.24,
		(areaH / L) * 0.78,
		...lines.map((line, k) => fitSize(line, tw - ind(k), 1e6, 1.3, 0.03)),
	);
	const pitch = Math.min(size * 1.4, areaH / L);
	const cy = H * 0.56;
	const e = inE(env, 0.6) * out;
	const nt = 40;
	Ln(env, x0, ry, x0 + tw * e, ry, sc.sub, lw * 1.4, 1);
	for (let k = 0; k <= nt * e; k += 1) {
		const mj = k % 5 === 0;
		Ln(env, x0 + (tw * k) / nt, ry, x0 + (tw * k) / nt, ry - M * (mj ? 0.016 : 0.008), sc.sub, lw, 1);
		if (k % 10 === 0) {
			label(env, String(k), x0 + (tw * k) / nt, ry - M * 0.03, { align: "center", alpha: out, size: ls * 0.8 });
		}
	}
	lines.forEach((line, k) => {
		const x = x0 + ind(k);
		const y = cy + (k - (L - 1) / 2) * pitch;
		const a = inE(env, 0.45, 0.15 + k * 0.1) * out;
		const s = M * 0.012;
		if (a > 0) {
			polyLine(env, [[x, ry + s * 0.4], [x, ry + s * 1.9], [x + s * 1.3, ry + s * 1.9]], acc, lw * 2.5, a);
		}
		if (guide) {
			dashL(env, x, ry + s * 2.6, x, lerpN(ry + s * 2.6, y + size * 0.55, a), sc.sub, lw, 0.7 * out, [lw * 3, lw * 4]);
		}
		if (arrow && x - x0 > size * 0.5 && a > 0) {
			const ax = lerpN(x0, x - size * 0.14, a);
			const h = size * 0.07;
			Ln(env, x0, y, ax, y, sc.sub, lw * 1.3, 0.8 * a);
			polyLine(env, [[ax - h, y - h], [ax, y], [ax - h, y + h]], sc.sub, lw * 1.3, 0.8 * a);
		}
		mainDraw(env, { align: "left", color: sc.fg, size, text: line, track: 0.03, x, y });
	});
	label(env, `TAB ×${L}`, x0 + tw, ry + ls * 1.2, { align: "right", alpha: inC(env, 0.3, 0.3) * out });
}

/** 三段表紙 — a paperback cover in three bands with cartouche and colophon mark. */
function drawTriBand(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, port, txt, out, lw, ls, no, seed, sc } = env;
	const colKind = pickOf(seed, 131, ["accent", "accent", "ink"] as const);
	const k = pickOf(seed, 132, [0.26, 0.3, 0.33] as const);
	const mark = pickOf(seed, 133, ["circle", "sq", "dia"] as const);
	const tilt = pickOf(seed, 134, [0, 0, -1.5, 1.5] as const);
	const ch = port ? Math.min(H * 0.8, W * 0.82 * 1.5) : H * 0.86;
	const cw = port ? W * 0.82 : Math.min(ch * 0.72, W * 0.8);
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	let band = mixOf(paper, ink, 0.8);
	const preferred =
		colKind === "ink"
			? [sc.ink, sc.accent, sc.accent2]
			: [sc.accent, sc.accent2, sc.ink];
	for (const color of preferred) {
		if (
			color &&
			contrastOf(color, paper) >= 1.5 &&
			contrastOf(color, sc.bg) >= 1.25
		) {
			band = color;
			break;
		}
	}
	const bon = onCol(sc, band);
	const bh = ch * k;
	tilted(env, W / 2, H / 2, tilt, () => {
		const e1 = inE(env, 0.45);
		const e2 = inE(env, 0.45, 0.07);
		const e3 = inE(env, 0.45, 0.14);
		const la = inC(env, 0.3, 0.3) * out;
		R(env, x0 + (cw / 2) * (1 - e2), y0 + bh - 1, cw * e2, ch - bh * 2 + 2, paper, out);
		R(env, x0, y0 - (1 - e1) * H * 0.2, cw, bh, band, out * e1);
		R(env, x0, y0 + ch - bh + (1 - e3) * H * 0.2, cw, bh, band, out * e3);
		const kw = cw * 0.56;
		const kh = bh * 0.44;
		const ky = y0 + bh / 2;
		rrect(env, W / 2 - kw / 2, ky - kh / 2, kw, kh, kh / 2, null, la, bon, lw * 2);
		label(env, "LYRIC  BOOKS", W / 2, ky, { align: "center", alpha: la, color: bon, size: Math.min(kh * 0.36, ls * 1.3) });
		const my = y0 + ch - bh / 2;
		const r = bh * 0.22;
		if (la > 0) {
			if (mark === "circle") {
				ringS(env, W / 2, my, r, bon, lw * 2, la);
				disc(env, W / 2, my, r * 0.35, bon, la);
			} else if (mark === "sq") {
				frameR(env, W / 2 - r, my - r, r * 2, r * 2, bon, lw * 2, la);
				R(env, W / 2 - r * 0.4, my - r * 0.4, r * 0.8, r * 0.8, bon, la);
			} else {
				polyLine(env, [[W / 2, my - r * 1.2], [W / 2 + r * 1.2, my], [W / 2, my + r * 1.2], [W / 2 - r * 1.2, my], [W / 2, my - r * 1.2]], bon, lw * 2, la);
				disc(env, W / 2, my, r * 0.3, bon, la);
			}
		}
		label(env, `No.${pad2(no)}`, x0 + cw - ls, y0 + ch - ls * 1.2, { align: "right", alpha: la, color: bon, size: ls * 0.9 });
		const mh = ch - bh * 2;
		const f = fitBox(txt, cw * 0.84, mh * 0.62, 1.22, 0.03, 4);
		const size = Math.min(f.size, cw * 0.3);
		const iy = y0 + ch / 2 - mh * 0.05;
		const m = measure(f.text, size, 1.22, 0.03);
		const ry = Math.min(y0 + ch - bh - mh * 0.09, iy + m.h / 2 + mh * 0.09);
		Ln(env, W / 2 - cw * 0.12 * e3, ry, W / 2 + cw * 0.12 * e3, ry, ink, lw * 1.5, out);
		mainDraw(env, { color: ink, lead: 1.22, size, text: f.text, track: 0.03, x: W / 2, y: iy });
	});
}

/** エアメール — an airmail envelope: striped border, stamp, postmark waves. */
function drawAirmail(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc, ctx } = env;
	const stamp = chanceOf(seed, 141, 0.85);
	const tilt = pickOf(seed, 142, [-2, 0, 2] as const);
	const tag = chanceOf(seed, 143, 0.7);
	const ew = port ? W * 0.88 : Math.min(W * 0.84, H * 0.82 * 1.5);
	const eh = port ? Math.min(H * 0.6, ew * 1.15) : ew / 1.5;
	const x0 = (W - ew) / 2;
	const y0 = (H - eh) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const c1 = accOn(sc, paper);
	const c2 =
		sc.accent2 && sc.accent2 !== c1 && contrastOf(sc.accent2, paper) >= 1.6
			? sc.accent2
			: ink;
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.45);
		const a = e * out;
		const b = M * 0.03;
		const la = inC(env, 0.3, 0.3) * out;
		R(env, x0, y0 + (1 - e) * M * 0.04, ew, eh, paper, a);
		if (
			a > 0 &&
			typeof ctx.moveTo === "function" &&
			typeof ctx.lineTo === "function" &&
			typeof ctx.fill === "function" &&
			typeof ctx.closePath === "function"
		) {
			const base = ctx.globalAlpha;
			ctx.save();
			ctx.globalAlpha = base * a;
			ctx.beginPath();
			ctx.rect(x0, y0, ew, eh);
			ctx.rect(x0 + b, y0 + b, ew - b * 2, eh - b * 2);
			ctx.clip("evenodd");
			const p = b * 2.6;
			const sh = (env.lt * b * 0.5) % p;
			const moveTo = ctx.moveTo;
			const lineTo = ctx.lineTo;
			const closePath = ctx.closePath;
			if (moveTo && lineTo && closePath && ctx.fill) {
				const fillNow: () => void = () => ctx.fill?.();
				[c1, c2].forEach((color, k) => {
					ctx.fillStyle = color;
					ctx.beginPath();
					let i = 0;
					for (
						let x = x0 - eh - p + sh + k * p * 0.5;
						x < x0 + ew + p && i < 200;
						x += p, i += 1
					) {
						moveTo.call(ctx, x, y0 + eh);
						lineTo.call(ctx, x + p * 0.27, y0 + eh);
						lineTo.call(ctx, x + p * 0.27 + eh, y0);
						lineTo.call(ctx, x + eh, y0);
						closePath.call(ctx);
					}
					fillNow.call(ctx);
				});
			}
			ctx.restore();
			ctx.globalAlpha = base;
		}
		if (stamp) {
			const sw = Math.min(eh * 0.2, ew * 0.14);
			const sh2 = sw * 1.2;
			const sx = x0 + ew - b * 2 - sw;
			const sy = y0 + b * 2;
			dashL(env, sx, sy, sx + sw, sy, ink, lw * 2, la, [lw * 2, lw * 3]);
			dashL(env, sx, sy + sh2, sx + sw, sy + sh2, ink, lw * 2, la, [lw * 2, lw * 3]);
			dashL(env, sx, sy, sx, sy + sh2, ink, lw * 2, la, [lw * 2, lw * 3]);
			dashL(env, sx + sw, sy, sx + sw, sy + sh2, ink, lw * 2, la, [lw * 2, lw * 3]);
			R(env, sx + sw * 0.14, sy + sw * 0.14, sw * 0.72, sh2 - sw * 0.28, c1, la * 0.85);
			label(env, pad2(no), sx + sw / 2, sy + sh2 / 2, { align: "center", alpha: la, color: onCol(sc, c1), size: sw * 0.34 });
			const pe = outCubic(clamp((env.lt - 0.45) / 0.3)) * out;
			const px = sx - sw * 0.1;
			const py = sy + sh2 * 0.62;
			const pr = sw * 0.46;
			if (pe > 0) {
				ringS(env, px, py, pr * (1.25 - 0.25 * pe), ink, lw * 1.5, 0.7 * pe);
				ringS(env, px, py, pr * 0.66, ink, lw, 0.7 * pe);
				for (let k = 0; k < 4; k += 1) {
					const pts: Pt[] = [];
					for (let i = 0; i <= 16; i += 1) {
						pts.push([
							px - pr * 1.2 - (i / 16) * sw * 1.5 * pe,
							py + (k - 1.5) * pr * 0.42 + Math.sin(i * 1.1) * pr * 0.09,
						]);
					}
					polyLine(env, pts, ink, lw * 1.3, 0.6 * pe);
				}
			}
		}
		if (tag) {
			const tw = Math.min(ew * 0.26, ls * 11);
			const th = ls * 1.9;
			const tx = x0 + b * 2;
			const ty = y0 + eh - b * 2 - th;
			R(env, tx, ty, tw * inE(env, 0.4, 0.25), th, c1, out);
			label(env, "PAR AVION", tx + tw / 2, ty + th / 2, { align: "center", alpha: la, color: onCol(sc, c1), size: Math.min(ls, tw * 0.1) });
		}
		const f = fitBox(txt, ew * 0.74, eh * 0.4, 1.25, 0.03, port ? 4 : 3);
		const size = Math.min(f.size, M * 0.22);
		const iy = y0 + eh * 0.55;
		const m = measure(f.text, size, 1.25, 0.03);
		const uy = iy + m.h / 2 + size * 0.22;
		const ue = inE(env, 0.6, 0.2) * out;
		Ln(env, W / 2 - (m.w / 2) * ue, uy, W / 2 + (m.w / 2) * ue, uy, ink, lw, 0.6);
		mainDraw(env, { color: ink, lead: 1.25, size, text: f.text, track: 0.03, x: W / 2, y: iy });
	});
}

/** 図版 — an empty picture box (FPO placeholder) with the lyric as its caption. */
function drawFigure(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const side = pickOf(seed, 151, ["l", "r"] as const);
	const pic = pickOf(seed, 152, ["x", "scene", "target"] as const);
	const top = chanceOf(seed, 153, 0.5);
	const dim = dimOf(sc);
	const acc = accentOn(sc);
	let bx: number;
	let by: number;
	let bw: number;
	let bh: number;
	let it: { readonly size: number; readonly text: string };
	let ix: number;
	let iy: number;
	let cxLabel: number;
	let cyLabel: number;
	let wLabel: number;
	if (!port) {
		bw = W * 0.3;
		bh = H * 0.58;
		by = (H - bh) / 2;
		bx = side === "l" ? W * 0.07 : W * 0.93 - bw;
		const gap = W * 0.04;
		const aw = W * 0.86 - bw - gap;
		const f = fitBox(txt, aw, bh * 0.7, 1.22, 0.03, 3);
		const size = Math.min(f.size, M * 0.24);
		it = { size, text: f.text };
		ix = side === "l" ? bx + bw + gap : W * 0.07;
		const m = measure(f.text, size, 1.22, 0.03);
		iy = by + bh - m.h / 2 - size * 0.05;
		cxLabel = ix;
		cyLabel = iy - m.h / 2 - size * 0.45;
		wLabel = aw;
	} else {
		bw = W * 0.86;
		bh = H * 0.3;
		bx = W * 0.07;
		by = top ? H * 0.1 : H * 0.6;
		const f = fitBox(txt, bw, H * 0.34, 1.22, 0.03, 4);
		const size = Math.min(f.size, M * 0.24);
		it = { size, text: f.text };
		ix = bx;
		const m = measure(f.text, size, 1.22, 0.03);
		iy = top ? by + bh + ls * 4 + m.h / 2 : by - ls * 2 - m.h / 2;
		cxLabel = bx;
		cyLabel = iy - m.h / 2 - ls * 1.6;
		wLabel = bw;
	}
	const e = inE(env, 0.6) * out;
	const e2 = inOutCubic(clamp((env.lt - 0.15) / 0.6)) * out;
	R(env, bx, by, bw, bh * e, dim, 0.7);
	if (e2 > 0) {
		polyPartial(
			env,
			[[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]],
			e2,
			sc.sub,
			lw * 1.5,
			1,
		);
		if (pic === "x") {
			Ln(env, bx, by, bx + bw * e2, by + bh * e2, sc.sub, lw, 0.9);
			Ln(env, bx + bw, by, bx + bw - bw * e2, by + bh * e2, sc.sub, lw, 0.9);
		} else if (pic === "scene") {
			polyPartial(
				env,
				[[bx, by + bh * 0.8], [bx + bw * 0.3, by + bh * 0.45], [bx + bw * 0.5, by + bh * 0.68], [bx + bw * 0.7, by + bh * 0.38], [bx + bw, by + bh * 0.75]],
				e2,
				sc.sub,
				lw * 1.5,
				0.9,
			);
			ringS(env, bx + bw * 0.24, by + bh * 0.24, Math.min(bw, bh) * 0.08 * e2, sc.sub, lw * 1.5, 0.9);
		} else {
			const r = Math.min(bw, bh) * 0.22;
			ringS(env, bx + bw / 2, by + bh / 2, r * e2, sc.sub, lw * 1.5, 0.9);
			Ln(env, bx + bw / 2 - r * 1.5 * e2, by + bh / 2, bx + bw / 2 + r * 1.5 * e2, by + bh / 2, sc.sub, lw, 0.9);
			Ln(env, bx + bw / 2, by + bh / 2 - r * 1.5 * e2, bx + bw / 2, by + bh / 2 + r * 1.5 * e2, sc.sub, lw, 0.9);
		}
	}
	const la = inC(env, 0.3, 0.3) * out;
	label(env, "FPO", bx + ls * 0.7, by + bh - ls, { alpha: la * 0.8, size: ls * 0.85 });
	label(env, `${Math.round(bw)} × ${Math.round(bh)}`, bx + bw - ls * 0.7, by + bh - ls, { align: "right", alpha: la * 0.8, size: ls * 0.85 });
	label(env, `FIG. ${pad2(no)}`, cxLabel, cyLabel, { alpha: la, color: acc, size: ls * 1.1 });
	Ln(env, cxLabel + ls * 6.2, cyLabel, cxLabel + ls * 6.2 + Math.max(0, wLabel - ls * 6.2) * inE(env, 0.6, 0.25), cyLabel, sc.sub, lw, 0.8 * out);
	mainDraw(env, { align: "left", color: sc.fg, lead: 1.22, size: it.size, text: it.text, track: 0.03, x: ix, y: iy });
}

/** 行番号 — a numbered listing: gutter, vertical rule, greek neighbours, live lines. */
function drawLineNumbers(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const hl = chanceOf(seed, 161, 0.65);
	const start = intOf(seed, 162, 1, 90);
	const every = pickOf(seed, 163, [1, 1, 5] as const);
	const lead = 1.5;
	const gw = M * 0.12;
	const tx = W * 0.07 + gw;
	const f = fitBox(txt, W * 0.86 - gw, H * 0.5, lead, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.2);
	const lineCount = f.text.split("\n").length;
	const pitch = size * lead;
	const yOf = (i: number): number => H / 2 + (i - (lineCount - 1) / 2) * pitch;
	const dim = dimOf(sc);
	const acc = accentOn(sc);
	const before = Math.min(3, Math.floor((yOf(0) - H * 0.08) / pitch));
	const after = Math.min(3, Math.floor((H * 0.92 - yOf(lineCount - 1)) / pitch));
	const rx = tx - gw * 0.22;
	const e = inE(env, 0.7) * out;
	Ln(env, rx, H * 0.06, rx, H * 0.06 + H * 0.88 * e, sc.sub, lw, 0.8);
	if (hl) {
		R(env, rx, yOf(0) - pitch / 2, (W - rx) * inE(env, 0.5, 0.05), lineCount * pitch, dim, 0.55 * out);
	}
	const ns = Math.min(size * 0.3, gw * 0.3);
	for (let i = -before; i < lineCount + after; i += 1) {
		const live = i >= 0 && i < lineCount;
		const num = start + before + i;
		const a = inC(env, 0.3, 0.05 + (i + before) * 0.04) * out;
		if (live || every === 1 || num % 5 === 0) {
			label(env, String(num).padStart(3, " "), rx - gw * 0.14, yOf(i), { align: "right", alpha: a * (live ? 1 : 0.7), color: live ? acc : sc.sub, size: ns });
		}
		if (!live) {
			R(
				env,
				tx,
				yOf(i) - size * 0.09,
				(W * 0.86 - gw) * (0.35 + 0.55 * randomUnit(seed, i + 9, 31)) * inE(env, 0.6, 0.05 + (i + before) * 0.04),
				size * 0.18,
				dim,
				out,
			);
		}
	}
	mainDraw(env, { align: "left", color: sc.fg, lead, size, text: f.text, track: 0.03, x: tx, y: H / 2 });
}

/** パンチカード — clipped corner, digit field, punched holes, lyric on top. */
function drawPunchCard(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const colsPlan = pickOf(seed, 171, [28, 32, 36] as const);
	const tilt = pickOf(seed, 172, [0, -1.5, 1.5] as const);
	const cw = port ? W * 0.9 : Math.min(W * 0.88, H * 0.82 * 1.9);
	const ch = port ? Math.min(H * 0.7, cw * 1.35) : cw / 1.9;
	const x0 = (W - cw) / 2;
	const y0 = (H - ch) / 2;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.3);
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.45);
		const a = e * out;
		const c = ch * 0.09;
		const dx = (1 - e) * W * 0.08;
		const la = inC(env, 0.3, 0.25) * out;
		if (a > 0) {
			poly(
				env,
				[[x0 + c - dx, y0], [x0 + cw - dx, y0], [x0 + cw - dx, y0 + ch], [x0 - dx, y0 + ch], [x0 - dx, y0 + c]],
				paper,
				a,
			);
		}
		const zy = y0 + ch * (port ? 0.34 : 0.4);
		const nR = port ? 12 : 9;
		const nC = port ? 18 : colsPlan;
		const gx = x0 + cw * 0.05;
		const gw = cw * 0.9;
		const gy = zy + ch * 0.045;
		const gh = y0 + ch * 0.95 - gy;
		const cx = gw / nC;
		const cy = gh / nR;
		Ln(env, x0 + cw * 0.05, zy, x0 + cw * 0.05 + cw * 0.9 * inE(env, 0.6, 0.15), zy, ink, lw * 1.5, out);
		label(env, `JZ ${5000 + (x2Hash(seed, 4) % 999)}`, x0 + cw * 0.95, y0 + ls * 1.3, { align: "right", alpha: la, color: faint, size: ls * 0.85 });
		const prog = clamp((env.lt - 0.2) / 0.9) * nC;
		for (let k = 0; k < nC; k += 1) {
			const ea = inC(env, 0.3, 0.1 + k * 0.012) * out;
			if (ea <= 0) continue;
			const h1 = x2Hash(seed, k, 51) % nR;
			const h2 = x2Hash(seed, k, 53) % (nR * 3);
			for (let r = 0; r < nR; r += 1) {
				const hole = k < prog && (r === h1 || r === h2);
				if (hole) {
					R(env, gx + k * cx + cx * 0.2, gy + r * cy + cy * 0.08, cx * 0.6, cy * 0.84, sc.bg, out);
				} else {
					R(env, gx + k * cx + cx * 0.36, gy + r * cy + cy * 0.34, cx * 0.28, cy * 0.32, faint, ea);
				}
			}
		}
		const zh = zy - y0;
		const f = fitBox(txt, cw * 0.84, zh * 0.74, 1.18, 0.03, port ? 4 : 2);
		const size = Math.min(f.size, M * 0.24);
		mainDraw(env, { color: ink, lead: 1.18, size, text: f.text, track: 0.03, x: W / 2 + c * 0.2, y: y0 + zh * 0.53 });
	});
}

/** 込め物 — letterspaced type with the spacing quads made visible and labelled. */
function drawSpacers(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, sc } = env;
	const lab = chanceOf(env.seed, 181, 0.75);
	const style = pickOf(env.seed, 182, ["x", "fill", "hatch"] as const);
	const track = pickOf(env.seed, 183, [0.5, 0.62, 0.75] as const);
	const n = glyphCountOf(txt);
	const L = port ? Math.ceil(n / 4) : Math.ceil(n / 5);
	const lead = 1.75;
	const mt = evenSplit(txt, L).join("\n");
	const size = Math.min(fitSize(mt, W * 0.76, H * 0.66, lead, track), M * 0.26);
	const gl = glyphPts(mt, W / 2, H / 2, size, lead, track, "center");
	const dim = dimOf(sc);
	const acc = accentOn(sc);
	let q = 0;
	for (let i = 0; i < gl.length; i += 1) {
		const a = gl[i]!;
		const b = gl[i + 1];
		const first = i === 0 || gl[i - 1]!.li !== a.li;
		const last = !b || b.li !== a.li;
		const quads: Pt[] = [];
		if (first) quads.push([a.x - a.w / 2 - size * 0.42, a.x - a.w / 2 - size * 0.06]);
		quads.push(
			last
				? [a.x + a.w / 2 + size * 0.06, a.x + a.w / 2 + size * 0.42]
				: [a.x + a.w / 2 + size * 0.05, b.x - b.w / 2 - size * 0.05],
		);
		for (const [xa, xb] of quads) {
			const e = inE(env, 0.45, 0.1 + q * 0.03) * out;
			q += 1;
			if (e <= 0 || xb - xa < size * 0.08) continue;
			const h = size * 0.9 * e;
			const ya = a.y - h / 2;
			const wq = xb - xa;
			if (style === "fill") {
				R(env, xa, ya, wq, h, dim, 1);
			} else {
				frameR(env, xa, ya, wq, h, sc.sub, lw, 0.9);
				if (style === "x") {
					Ln(env, xa, ya, xb, ya + h, sc.sub, lw, 0.7);
					Ln(env, xb, ya, xa, ya + h, sc.sub, lw, 0.7);
				} else {
					for (let k = 1; k <= 3; k += 1) {
						Ln(env, xa, ya + (h * k) / 4, xb, ya + (h * k) / 4 - Math.min(h / 4, wq * 0.6), sc.sub, lw, 0.7);
					}
				}
			}
			if (lab) {
				label(env, (wq / size).toFixed(2).replace(/^0/u, ""), (xa + xb) / 2, a.y + size * 0.66, {
					align: "center",
					alpha: e,
					color: first && quads.length > 1 && xa < a.x && q % 2 ? sc.sub : acc,
					size: Math.max(9, size * 0.12),
				});
			}
		}
	}
	mainDrawTracked(env, { color: sc.fg, lead, size, text: mt, track, x: W / 2, y: H / 2 });
}

/** 切り取り線 — a dashed cut line with travelling scissors; lyric above, stub below. */
function drawCutLine(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const pos = pickOf(seed, 191, ["low", "low", "high"] as const);
	const stub = pickOf(seed, 192, ["bar", "form"] as const);
	const dir = pickOf(seed, 193, [1, 1, -1] as const);
	const low = pos === "low";
	const yl = H * (low ? (port ? 0.72 : 0.68) : port ? 0.28 : 0.32);
	const zy0 = low ? H * 0.06 : yl;
	const zy1 = low ? yl : H * 0.94;
	const sy0 = low ? yl : H * 0.06;
	const sy1 = low ? H * 0.94 : yl;
	const scy = (sy0 + sy1) / 2;
	const sh = sy1 - sy0;
	const f = fitBox(txt, W * 0.84, (zy1 - zy0) * 0.72, 1.2, 0.03, port ? 4 : 2);
	const size = Math.min(f.size, M * 0.3);
	const e = inE(env, 0.6);
	const outDur = Math.min(0.3, env.dur / 3);
	const u = clamp(env.lt / Math.max(0.6, env.dur - outDur));
	const d = dir;
	const sx = d > 0 ? W * (0.05 + 0.9 * u) : W * (0.95 - 0.9 * u);
	const acc = accentOn(sc);
	const s = M * 0.046;
	const far = d > 0 ? W + 10 : -10;
	const near = d > 0 ? -10 : W + 10;
	dashL(env, sx, yl, lerpN(sx, far, e), yl, sc.fg, lw * 2, out, [lw * 7, lw * 6]);
	Ln(env, near, yl, sx - d * s * 1.5, yl, sc.sub, lw, 0.45 * out * e);
	const a = e * out;
	if (a > 0) {
		const op = 0.35 + 0.3 * Math.sin(env.lt * 13);
		const px = sx - d * s * 0.2;
		for (const k of [-1, 1]) {
			ringS(env, sx - d * s * 1.25, yl + k * s * 0.5, s * 0.3, sc.fg, lw * 2.4, a);
			polyLine(
				env,
				[[sx - d * s * 0.98, yl + k * s * 0.34], [px, yl], [sx + d * s * 0.95, yl - k * s * op]],
				sc.fg,
				lw * 2.4,
				a,
			);
		}
		disc(env, px, yl, lw * 2.2, acc, a);
	}
	const la = inC(env, 0.3, 0.3) * out;
	const latin = isLatinText(txt);
	label(env, latin ? "CUT HERE" : "キリトリ", d > 0 ? W * 0.93 : W * 0.07, yl + (low ? -1 : 1) * ls * 1.1, { align: d > 0 ? "right" : "left", alpha: la, size: ls * 0.9 });
	label(env, `No.${String(1 + (x2Hash(seed, 5) % 9999)).padStart(4, "0")}`, W * 0.07, scy - sh * 0.2, { alpha: la, color: acc });
	if (stub === "bar") {
		greek(env, W * 0.07, scy - sh * 0.02, W * 0.32, 2, ls * 1.2, dimOf(sc), la, seed, inE(env, 0.5, 0.3));
		barcode(env, W * 0.93 - W * 0.3, scy - sh * 0.22, W * 0.3, sh * 0.44, sc.sub, la, seed, inE(env, 0.6, 0.3));
	} else {
		["NAME", "DATE", "SIGN"].forEach((field, k) => {
			const x = W * 0.07 + k * W * 0.3;
			const w = W * 0.26;
			label(env, field, x, scy + sh * 0.02, { alpha: la, size: ls * 0.8 });
			Ln(env, x, scy + sh * 0.2, x + w * inE(env, 0.5, 0.3 + k * 0.08), scy + sh * 0.2, sc.sub, lw, out);
		});
	}
	mainDraw(env, { color: sc.fg, lead: 1.2, size, text: f.text, track: 0.03, x: W / 2, y: (zy0 + zy1) / 2 });
}

/** チェック欄 — a checklist: boxes down the left, lines ticked one after another. */
function drawChecklist(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const box = pickOf(seed, 201, ["sq", "sq", "circle"] as const);
	const pre = intOf(seed, 202, 0, 1);
	const postPlan = intOf(seed, 203, 1, 2);
	const n = Array.from(txt).length;
	const lines = smartSplit(
		txt,
		port
			? n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4
			: n <= 7 ? 1 : n <= 13 ? 2 : 3,
		port,
	);
	const L = lines.length;
	const post = L >= 3 ? 1 : postPlan;
	const rows = pre + L + post;
	const areaH = H * 0.72;
	const size = Math.min(
		M * 0.22,
		(areaH / rows) * 0.62,
		...lines.map((line) => fitSize(line, W * 0.7, 1e6, 1.3, 0.03)),
	);
	const pitch = Math.min(size * 1.55, areaH / rows);
	const bs = size * 0.62;
	const x0 = W * 0.08;
	const tx = x0 + bs * 1.7;
	const yT = H * 0.53 - (rows * pitch) / 2;
	const acc = accentOn(sc);
	const dim = dimOf(sc);
	const la = inC(env, 0.3, 0.15) * out;
	let done = pre;
	for (let r = 0; r < rows; r += 1) {
		const y = yT + (r + 0.5) * pitch;
		const li = r - pre;
		const live = li >= 0 && li < L;
		const a = inC(env, 0.3, 0.05 + r * 0.06) * out;
		const e = inE(env, 0.5, 0.05 + r * 0.06);
		Ln(env, x0, y + pitch / 2, x0 + W * 0.84 * e, y + pitch / 2, sc.sub, lw, 0.5 * out);
		const bc = live ? sc.fg : sc.sub;
		if (a > 0) {
			if (box === "circle") {
				ringS(env, x0 + bs / 2, y, bs / 2, bc, lw * 2, a);
			} else {
				frameR(env, x0, y - bs / 2, bs, bs, bc, lw * 2, a);
			}
		}
		const t0 = live ? env.inDur * 0.7 + li * 0.16 : 0.1;
		const ec = r < pre + L ? outCubic(clamp((env.lt - t0) / 0.22)) * out : 0;
		if (ec > 0) {
			polyPartial(
				env,
				[[x0 + bs * 0.12, y - bs * 0.02], [x0 + bs * 0.42, y + bs * 0.3], [x0 + bs * 1.12, y - bs * 0.62]],
				ec,
				live ? acc : sc.sub,
				Math.max(3, bs * 0.13),
				1,
			);
		}
		if (live && ec > 0.5) done += 1;
		if (live) {
			mainDraw(env, { align: "left", color: sc.fg, size, text: lines[li] ?? "", track: 0.03, x: tx, y });
		} else {
			const w = W * (0.3 + 0.3 * randomUnit(seed, r, 61));
			R(env, tx, y - size * 0.09, w * e, size * 0.18, dim, out);
			if (r < pre) {
				Ln(env, tx - size * 0.1, y, tx - size * 0.1 + (w + size * 0.2) * inE(env, 0.5, 0.3), y, sc.sub, lw * 1.5, 0.8 * out);
			}
		}
	}
	label(env, "CHECK LIST", x0, yT - ls * 1.4, { alpha: la });
	label(env, `${done} / ${rows}`, x0 + W * 0.84, yT - ls * 1.4, { align: "right", alpha: la, color: acc });
}

/** 引用線 — block-quotation setting: heavy vertical bar, ragged lines, citation. */
function drawBlockquote(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const side = pickOf(seed, 211, ["l", "l", "r"] as const);
	const bar = pickOf(seed, 212, ["solid", "solid", "double", "dots"] as const);
	const cite = chanceOf(seed, 213, 0.7);
	const colKind = pickOf(seed, 214, ["accent", "accent", "fg"] as const);
	const f = fitBox(txt, W * 0.72, H * 0.56, 1.32, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.24);
	const left = side === "l";
	const m = measure(f.text, size, 1.32, 0.03);
	const bwd = Math.max(6, size * 0.09);
	const gap = size * 0.5;
	const tot = bwd + gap + m.w;
	const bx = left ? (W - tot) / 2 : (W + tot) / 2 - bwd;
	const ix = left ? bx + bwd + gap : bx - gap;
	const iy = H / 2 - (cite ? size * 0.2 : 0);
	const y0 = iy - m.h / 2 - size * 0.18;
	const hh = m.h + size * 0.36;
	const e = inE(env, 0.55) * (1 - inExpoE(env.pOut));
	const c = colKind === "accent" ? accentOn(sc) : sc.fg;
	if (e > 0) {
		if (bar === "dots") {
			const k = Math.max(3, Math.round(hh / (bwd * 2)));
			for (let i = 0; i < k * e; i += 1) {
				R(env, bx, y0 + (hh - bwd) * (i / Math.max(1, k - 1)), bwd, bwd, c, 1);
			}
		} else {
			R(env, bx, y0, bwd * (bar === "double" ? 0.6 : 1), hh * e, c, 1);
			if (bar === "double") {
				R(env, bx + (left ? bwd * 0.9 : -bwd * 0.3 - lw), y0, Math.max(lw, bwd * 0.12), hh * e, c, 1);
			}
		}
	}
	if (cite) {
		const a = inC(env, 0.35, 0.35) * out;
		const cy = Math.min(H * 0.94, y0 + hh + size * 0.45);
		const cx = left ? ix + m.w : ix - m.w;
		label(env, `LINE ${pad2(no)}`, cx, cy, { align: left ? "right" : "left", alpha: a });
		Ln(env, cx + (left ? -1 : 1) * ls * 5.4, cy, cx + (left ? -1 : 1) * (ls * 5.4 + size * 0.6 * inE(env, 0.5, 0.35)), cy, sc.sub, lw, 0.8 * out);
	}
	mainDraw(env, { align: left ? "left" : "right", color: sc.fg, lead: 1.32, size, text: f.text, track: 0.03, x: ix, y: iy });
}

/** 台本 — screenplay page: slug line, character cue, centred dialogue, transition. */
function drawScreenplay(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const scn = intOf(seed, 221, 1, 99);
	const io = pickOf(seed, 222, ["INT.", "EXT."] as const);
	const time = pickOf(seed, 223, ["NIGHT", "DAY", "DAWN", "DUSK"] as const);
	const vo = pickOf(seed, 224, [" (V.O.)", " (O.S.)", ""] as const);
	const trans = pickOf(seed, 225, ["CUT TO:", "FADE OUT.", "DISSOLVE TO:"] as const);
	const guides = chanceOf(seed, 226, 0.7);
	const colW = W * (port ? 0.8 : 0.6);
	const f = fitBox(txt, colW * 0.96, H * 0.42, 1.32, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.2);
	const s2 = ls * 1.15;
	const iy = H * 0.55;
	const m = measure(f.text, size, 1.32, 0.03);
	const la = (k: number): number => inC(env, 0.3, 0.08 * k) * out;
	const x0 = W * 0.08;
	const x1 = W * 0.92;
	const hy = H * 0.11;
	label(env, `${scn}   ${io} LYRIC — ${time}`, x0, hy, { alpha: la(0), color: sc.fg, size: s2 });
	label(env, `${no}.`, x1, hy, { align: "right", alpha: la(0), color: sc.fg, size: s2 });
	Ln(env, x0, hy + s2 * 1.1, x0 + (x1 - x0) * inE(env, 0.6), hy + s2 * 1.1, sc.sub, lw, 0.8 * out);
	label(env, `VOICE${vo}`, W / 2, iy - m.h / 2 - s2 * 1.9, { align: "center", alpha: la(2), color: accentOn(sc), size: s2 });
	if (guides) {
		for (const k of [-1, 1]) {
			dashL(env, W / 2 + (k * colW) / 2, hy + s2 * 2.6, W / 2 + (k * colW) / 2, lerpN(hy + s2 * 2.6, H * 0.86, inE(env, 0.7, 0.1)), sc.sub, lw, 0.5 * out, [lw * 3, lw * 5]);
		}
	}
	label(env, "(CONTINUED)", x0, H * 0.9, { alpha: la(4) * 0.8, color: sc.sub, size: s2 * 0.9 });
	label(env, trans, x1, H * 0.9, { align: "right", alpha: la(5), color: sc.fg, size: s2 });
	mainDraw(env, { color: sc.fg, lead: 1.32, size, text: f.text, track: 0.03, x: W / 2, y: iy });
}

/** ちぎり札 — a pinned notice with tear-off tabs along the bottom. */
function drawTearTabs(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc, ctx } = env;
	const nT = pickOf(seed, 231, [7, 8, 9] as const);
	const g1 = intOf(seed, 232, 0, 8);
	const g2 = intOf(seed, 233, 0, 8);
	const tilt = pickOf(seed, 234, [-1.5, 0, 1.5] as const);
	const pin = chanceOf(seed, 235, 0.8);
	const fw = port ? W * 0.84 : Math.min(W * 0.62, H);
	const fh = H * 0.86;
	const x0 = (W - fw) / 2;
	const y0 = (H - fh) / 2;
	const tabH = fh * 0.25;
	const bodyH = fh - tabH;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.4);
	const latin = isLatinText(txt);
	const tw = fw / nT;
	const tabT = shortOf(txt.replace(/\s+/gu, latin ? " " : ""), latin ? 12 : 6);
	const tl = Array.from(tabT).length;
	tilted(env, W / 2, y0, tilt, () => {
		const e = inE(env, 0.5);
		const a = e * out;
		const la = inC(env, 0.3, 0.3) * out;
		R(env, x0, y0, fw, bodyH * e, paper, out);
		for (let k = 0; k < nT; k += 1) {
			const gone = k === g1 % nT || k === (g2 + 3) % nT;
			const cx = x0 + (k + 0.5) * tw;
			const ty = y0 + bodyH;
			const ea = inE(env, 0.4, 0.2 + k * 0.03) * out;
			if (ea <= 0) continue;
			if (gone) {
				R(env, cx - tw * 0.46, ty - 1, tw * 0.92, tabH * 0.05 + 1, paper, ea);
				continue;
			}
			const sway = Math.sin(env.lt * 1.4 + k * 1.9) * 1.6 * 0.7;
			const base = ctx.globalAlpha;
			ctx.save();
			ctx.translate(cx, ty);
			ctx.rotate(degrees(sway));
			ctx.translate(-cx, -ty);
			ctx.globalAlpha = base;
			R(env, cx - tw * 0.46, ty - 1, tw * 0.92, tabH * ea + 1, paper, out);
			const fsz = Math.min(tw * 0.4, (tabH * 0.84) / Math.max(1, tl * (latin ? 0.62 : 1.06)));
			label(env, tabT, cx, ty + tabH * 0.5, {
				align: "center",
				alpha: ea * la,
				color: ink,
				rot: latin ? 90 : 0,
				size: fsz,
				vertical: !latin,
			});
			ctx.restore();
			ctx.globalAlpha = base;
		}
		dashL(env, x0, y0 + bodyH, x0 + fw, y0 + bodyH, faint, lw * 1.3, la, [lw * 4, lw * 4]);
		label(env, "TAKE ONE", W / 2, y0 + bodyH - ls * 1.5, { align: "center", alpha: la, color: faint });
		if (pin && a > 0) {
			disc(env, W / 2, y0 + fh * 0.035, M * 0.013, accOn(sc, paper), a);
			disc(env, W / 2 - M * 0.004, y0 + fh * 0.035 - M * 0.004, M * 0.004, paper, a * 0.7);
		}
		const f = fitBox(txt, fw * 0.84, bodyH * 0.62, 1.2, 0.02, port ? 4 : 3);
		const size = Math.min(f.size, M * 0.26);
		mainDraw(env, { color: ink, lead: 1.2, size, text: f.text, track: 0.02, x: W / 2, y: y0 + bodyH * 0.49 });
	});
}

/** 括弧まとめ — the lines gathered by one big drawn brace pointing at a count. */
// eslint-disable-next-line opencut/prefer-object-params
function bracePts(x: number, y0: number, y1: number, d: number, r: number): Pt[] {
	const ym = (y0 + y1) / 2;
	const top: Pt[] = [];
	const N = 8;
	for (let i = 0; i <= N; i += 1) {
		const t = ((i / N) * PI) / 2;
		top.push([x + (d / 2) * Math.sin(t), y0 + r * (1 - Math.cos(t))]);
	}
	for (let i = 0; i <= N; i += 1) {
		const t = ((i / N) * PI) / 2;
		top.push([x + d / 2 + (d / 2) * (1 - Math.cos(t)), ym - r + r * Math.sin(t)]);
	}
	return top.concat(
		top
			.slice(0, -1)
			.reverse()
			.map((point): Pt => [point[0], y0 + y1 - point[1]]),
	);
}

function drawBrace(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, seed, sc, ls, no } = env;
	const pos = pickOf(seed, 241, ["r", "l", "under", "r"] as const);
	const colKind = pickOf(seed, 242, ["accent", "accent", "fg"] as const);
	const n = glyphCountOf(txt);
	const latin = isLatinText(txt);
	const c = colKind === "accent" ? accentOn(sc) : sc.fg;
	const cnt = latin ? `${txt.split(/\s+/u).length} WORDS` : `${n} 字`;
	const e = inOutCubic(clamp((env.lt - 0.12) / 0.6)) * (1 - inExpoE(env.pOut));
	const la = inC(env, 0.3, 0.55) * env.out;
	const under = pos === "under" && !port && n <= 9;
	if (under) {
		const size = Math.min(fitSize(txt, W * 0.82, H * 0.3, 1.25, 0.03), M * 0.26);
		const iy = H * 0.44;
		const m = measure(txt, size, 1.25, 0.03);
		const by = iy + m.h / 2 + size * 0.22;
		const d = size * 0.36;
		const pts = bracePts(by, W / 2 - m.w / 2, W / 2 + m.w / 2, d, d * 0.5).map(
			(point): Pt => [point[1], point[0]],
		);
		if (e > 0) polyPartial(env, pts, e, c, Math.max(2.5, size * 0.028), 1);
		label(env, cnt, W / 2, by + d + ls * 1.9, { align: "center", alpha: la, color: c, size: ls * 2.2 });
		label(env, `LINE ${pad2(no)}`, W / 2, by + d + ls * 4.2, { align: "center", alpha: la });
		mainDraw(env, { color: sc.fg, lead: 1.25, size, text: txt, track: 0.03, x: W / 2, y: iy });
		return;
	}
	const labW = ls * (latin ? 11 : 8.5);
	const f = fitBox(txt, W * 0.84 - labW - M * 0.1, H * 0.6, 1.25, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.24);
	const right = pos !== "l";
	const m = measure(f.text, size, 1.25, 0.03);
	const d = Math.min(size * 0.4, M * 0.07);
	const gap = size * 0.3;
	const tot = m.w + gap + d + gap * 0.6 + labW;
	const xs = (W - tot) / 2;
	const s = right ? 1 : -1;
	const ix = right ? xs : W - xs;
	const bx = ix + s * (m.w + gap);
	const pts = bracePts(bx, H / 2 - m.h / 2 - size * 0.1, H / 2 + m.h / 2 + size * 0.1, s * d, Math.min(d * 0.6, m.h * 0.2));
	if (e > 0) polyPartial(env, pts, e, c, Math.max(2.5, size * 0.028), 1);
	const lx = bx + s * (d + gap * 0.6);
	label(env, cnt, lx, H / 2 - ls * 1.1, { align: right ? "left" : "right", alpha: la, color: c, size: ls * 2.1 });
	label(env, `LINE ${pad2(no)}`, lx, H / 2 + ls * 1.3, { align: right ? "left" : "right", alpha: la });
	mainDraw(env, { align: right ? "left" : "right", color: sc.fg, lead: 1.25, size, text: f.text, track: 0.03, x: ix, y: H / 2 });
}

/** 成分表示 — a facts panel: heavy box, lyric heading, rows with real figures. */
function drawNutrition(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const tilt = pickOf(seed, 251, [0, 0, -1.5, 1.5] as const);
	const inv = chanceOf(seed, 252, 0.4);
	const bw = port ? W * 0.84 : Math.min(W * 0.52, H * 0.95);
	const bh = H * 0.84;
	const x0 = (W - bw) / 2;
	const y0 = (H - bh) / 2;
	const p = bw * 0.055;
	const paper = paperOf(sc);
	const ink = inv ? onCol(sc, paper) : sc.fg;
	const sub = inv ? mixOf(paper, ink, 0.6) : sc.sub;
	const chars = Array.from(txt.replace(/\s+/gu, ""));
	const nK = chars.filter(isKanjiCh).length;
	const nKa = chars.filter((character) => isHiraCh(character) || isKataCh(character)).length;
	const nL = chars.filter(isLatinCh).length;
	const rowsD: ReadonlyArray<readonly [string, string]> = [
		["GLYPHS", String(chars.length)],
		["KANJI", String(nK)],
		["KANA", String(nKa)],
		["LATIN", String(nL)],
		["LINE No.", String(no)],
		["SECONDS", env.dur.toFixed(1)],
	];
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.5);
		const bl = Math.max(4, M * 0.007);
		if (inv) R(env, x0 + (bw / 2) * (1 - e), y0, bw * e, bh, paper, out);
		if (e > 0 && out > 0) {
			polyPartial(
				env,
				[[x0, y0], [x0 + bw, y0], [x0 + bw, y0 + bh], [x0, y0 + bh], [x0, y0]],
				inOutCubic(clamp(env.lt / 0.6)),
				ink,
				bl,
				out,
			);
		}
		const zh = bh * 0.38;
		const yb = y0 + zh + p;
		const xl = x0 + p;
		const xr = x0 + bw - p;
		const iw = bw - p * 2;
		R(env, xl, yb, iw * inE(env, 0.5, 0.1), bh * 0.022, ink, out);
		const la0 = inC(env, 0.3, 0.2) * out;
		const rs = Math.min(ls * 1.25, bw * 0.045);
		label(env, "Per 1 line", xl, yb + bh * 0.022 + rs * 1.2, { alpha: la0, color: sub, size: rs * 0.85 });
		const ry0 = yb + bh * 0.022 + rs * 2.2;
		const rh = (y0 + bh - p - rs * 1.6 - ry0) / rowsD.length;
		rowsD.forEach(([k, v], i) => {
			const y = ry0 + rh * i;
			const a = inC(env, 0.3, 0.2 + i * 0.05) * out;
			const ee = inE(env, 0.5, 0.15 + i * 0.05);
			if (i === 1) {
				R(env, xl, y - bh * 0.005, iw * ee, bh * 0.01, ink, out);
			} else {
				Ln(env, xl, y, xl + iw * ee, y, ink, lw, out);
			}
			label(env, k, xl + (i > 0 && i < 4 ? rs : 0), y + rh / 2, { alpha: a, color: ink, size: rs });
			label(env, v, xr, y + rh / 2, { align: "right", alpha: a, color: ink, size: rs * 1.15 });
		});
		R(env, xl, ry0 + rh * rowsD.length - bh * 0.005, iw * inE(env, 0.5, 0.4), bh * 0.01, ink, out);
		label(env, "* DAILY VALUE NOT ESTABLISHED", xl, y0 + bh - p - rs * 0.3, { alpha: la0, color: sub, size: rs * 0.7 });
		const f = fitBox(txt, iw, zh * 0.82, 1.15, 0.01, 4);
		const size = Math.min(f.size, M * 0.26);
		mainDraw(env, { align: "left", color: ink, lead: 1.15, size, text: f.text, track: 0.01, x: xl, y: y0 + p * 0.6 + zh / 2 });
	});
}

/** 折れ角 — a book page with a dog-eared corner folding over, running head, folio. */
function drawDogEar(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const corner = pickOf(seed, 261, ["tr", "tr", "tl", "br"] as const);
	const tilt = pickOf(seed, 262, [-1.5, 0, 0, 1.5] as const);
	const stack = chanceOf(seed, 263, 0.6);
	const k = rangeOf(seed, 264, 0.11, 0.17);
	const pw = port ? W * 0.84 : Math.min(W * 0.68, H * 1.15);
	const ph = H * 0.84;
	const x0 = (W - pw) / 2;
	const y0 = (H - ph) / 2;
	const x1 = x0 + pw;
	const y1 = y0 + ph;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const faint = mixOf(paper, ink, 0.45);
	const shade = mixOf(paper, ink, 0.24);
	const mirrorX = (x: number): number => (corner.includes("l") ? x0 + x1 - x : x);
	const mirrorY = (y: number): number => (corner.includes("b") ? y0 + y1 - y : y);
	const mp = (points: readonly Pt[]): Pt[] =>
		points.map(([x, y]) => [mirrorX(x), mirrorY(y)]);
	tilted(env, W / 2, H / 2, tilt, () => {
		const e = inE(env, 0.45);
		const a = e * out;
		const fs = M * k * outCubic(clamp((env.lt - 0.3) / 0.45));
		const la = inC(env, 0.3, 0.3) * out;
		const dy = (1 - e) * M * 0.04;
		if (a > 0) {
			if (stack) R(env, x0 + M * 0.016, y0 + M * 0.016 + dy, pw, ph, mixOf(paper, sc.bg, 0.5), a);
			poly(
				env,
				mp([[x0, y0 + dy], [x1 - fs, y0 + dy], [x1, y0 + fs + dy], [x1, y1 + dy], [x0, y1 + dy]]),
				paper,
				a,
			);
			if (fs > 1) {
				poly(env, mp([[x1 - fs, y0], [x1 - fs, y0 + fs], [x1, y0 + fs]]), shade, a);
				polyLine(env, mp([[x1 - fs, y0], [x1, y0 + fs]]), faint, lw, a);
			}
		}
		const hy = y0 + ph * 0.09;
		const top = !corner.includes("b");
		label(env, shortOf(txt, port ? 14 : 22), x0 + pw * 0.08, hy - ls * 0.9, { alpha: la, color: faint, size: ls * 0.9 });
		Ln(env, x0 + pw * 0.08, hy, x0 + pw * 0.08 + pw * (top ? 0.66 : 0.84) * inE(env, 0.6, 0.15), hy, faint, lw, out);
		label(env, `— ${no} —`, W / 2, y1 - ph * 0.06, { align: "center", alpha: la, color: faint });
		const f = fitBox(txt, pw * 0.8, ph * 0.56, 1.32, 0.03, 4);
		const size = Math.min(f.size, M * 0.24);
		mainDraw(env, { color: ink, lead: 1.32, size, text: f.text, track: 0.03, x: W / 2, y: y0 + ph * 0.51 });
	});
}

/** 罫線見本 — every line of the lyric sits between differently named rules. */
const RULES: ReadonlyArray<readonly [string, string]> = [
	["thick", "4 PT"],
	["double", "DOUBLE"],
	["dotted", "DOTTED"],
	["wave", "WAVE"],
	["scotch", "SCOTCH"],
	["dashed", "DASHED"],
];

function drawRuleSpecimen(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const offset = intOf(seed, 271, 0, 5);
	const lab = chanceOf(seed, 272, 0.85);
	const accIndex = intOf(seed, 273, 0, 5);
	const align = pickOf(seed, 274, ["left", "left", "center"] as const);
	const n = Array.from(txt).length;
	const lines = smartSplit(
		txt,
		port
			? n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4
			: n <= 8 ? 1 : n <= 14 ? 2 : 3,
		port,
	);
	const L = lines.length;
	const x0 = W * 0.07;
	const tw = W * 0.86;
	const size = Math.min(
		M * 0.24,
		(H * 0.7) / (L * 1.75),
		...lines.map((line) => fitSize(line, tw, 1e6, 1.3, 0.03)),
	);
	const pitch = size * 1.75;
	const ys: number[] = [];
	for (let k = 0; k <= L; k += 1) ys.push(H / 2 + (k - L / 2) * pitch);
	if (L === 1) {
		ys.unshift(ys[0]! - pitch * 0.3);
		ys.push(ys[ys.length - 1]! + pitch * 0.3);
	}
	const labW = lab ? ls * 7 : 0;
	const t = Math.max(3, size * 0.045);
	ys.forEach((y, k) => {
		const [kind, name] = RULES[(k + offset) % RULES.length]!;
		const e = inE(env, 0.6, 0.06 * k) * (1 - inExpoE(env.pOut));
		const c = k === accIndex % ys.length ? accentOn(sc) : sc.fg;
		if (e <= 0) return;
		const full = tw - labW;
		const xa = k % 2 ? x0 + full * (1 - e) : x0;
		const xb = k % 2 ? x0 + full : x0 + full * e;
		if (kind === "thick") {
			R(env, xa, y - t / 2, xb - xa, t, c, 1);
		} else if (kind === "double") {
			Ln(env, xa, y - t * 0.45, xb, y - t * 0.45, c, t * 0.3);
			Ln(env, xa, y + t * 0.45, xb, y + t * 0.45, c, t * 0.3);
		} else if (kind === "scotch") {
			R(env, xa, y - t * 0.7, xb - xa, t * 0.8, c, 1);
			Ln(env, xa, y + t * 0.7, xb, y + t * 0.7, c, Math.max(lw, t * 0.16));
		} else if (kind === "dashed") {
			dashL(env, xa, y, xb, y, c, t * 0.4, 1, [t * 2.4, t * 1.4]);
		} else if (kind === "dotted") {
			for (let x = xa; x <= xb; x += t * 1.5) {
				R(env, x, y - t * 0.3, t * 0.6, t * 0.6, c, 1);
			}
		} else {
			const pts: Pt[] = [];
			for (let x = xa; x <= xb; x += t * 0.8) {
				pts.push([x, y + Math.sin((x - x0) / (t * 1.3)) * t * 0.55]);
			}
			if (pts.length > 1) polyLine(env, pts, c, t * 0.32, 1);
		}
		if (lab) label(env, name, x0 + tw, y, { align: "right", alpha: inC(env, 0.3, 0.25 + 0.06 * k) * out, size: ls * 0.9 });
	});
	const o0 = L === 1 ? 1 : 0;
	lines.forEach((line, i) => {
		mainDraw(env, {
			align,
			color: sc.fg,
			size,
			text: line,
			track: 0.03,
			x: align === "left" ? x0 : W / 2,
			y: (ys[i + o0]! + ys[i + o0 + 1]!) / 2,
		});
	});
}

/** レターヘッド — stationery: mark, greeked address, date line, letter, signature. */
function drawLetterhead(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, no, seed, sc } = env;
	const mark = pickOf(seed, 281, ["circle", "sq", "tri"] as const);
	const sign = chanceOf(seed, 282, 0.85);
	const s1 = intOf(seed, 283, 1, 999);
	const x0 = W * 0.08;
	const x1 = W * 0.92;
	const ty = H * 0.075;
	const ms = M * 0.075;
	const acc = accentOn(sc);
	const dim = dimOf(sc);
	const em = oBack(clamp(env.lt / 0.45), 1.6) * out;
	const cx = x0 + ms / 2;
	const cy = ty + ms / 2;
	if (em > 0) {
		if (mark === "circle") {
			disc(env, cx, cy, (ms / 2) * em, acc);
			ringS(env, cx + ms * 0.38, cy, (ms / 2) * em, sc.fg, lw * 2, 1);
		} else if (mark === "sq") {
			R(env, cx - (ms / 2) * em, cy - (ms / 2) * em, ms * em, ms * em, acc, 1);
			frameR(env, cx - ms * 0.2, cy - ms * 0.2, ms * em, ms * em, sc.fg, lw * 2, 1);
		} else {
			poly(env, [[cx - (ms / 2) * em, cy + (ms / 2) * em], [cx, cy - (ms / 2) * em], [cx + (ms / 2) * em, cy + (ms / 2) * em]], acc, 1);
			ringS(env, cx + ms * 0.34, cy + ms * 0.1, ms * 0.3 * em, sc.fg, lw * 2, 1);
		}
	}
	const e1 = inE(env, 0.55, 0.1);
	const la = inC(env, 0.3, 0.3) * out;
	R(env, x0 + ms * 1.7, cy - ms * 0.22, W * 0.2 * e1, ms * 0.16, sc.fg, 0.9 * out);
	R(env, x0 + ms * 1.7, cy + ms * 0.1, W * 0.12 * e1, ms * 0.1, dim, out);
	for (let k = 0; k < 3; k += 1) {
		const w = W * (0.16 - k * 0.03) * e1;
		R(env, x1 - w, ty + ms * (0.12 + k * 0.3), w, ms * 0.09, dim, out);
	}
	const hy = ty + ms + M * 0.03;
	Ln(env, x0, hy, x0 + (x1 - x0) * inE(env, 0.7, 0.05), hy, sc.fg, lw * 1.4, out);
	label(env, `REF. ${pad2(no)}-${String(s1).padStart(3, "0")}`, x1, hy + ls * 1.4, { align: "right", alpha: la });
	Ln(env, x0, H * 0.925, x0 + (x1 - x0) * inE(env, 0.7, 0.2), H * 0.925, sc.sub, lw, 0.7 * out);
	for (let k = 0; k < 3; k += 1) {
		R(env, W / 2 - W * 0.15 + k * W * 0.105, H * 0.945, W * 0.09 * e1, ms * 0.08, dim, out);
	}
	const top = hy + ls * 2.6;
	const bot = H * (sign ? 0.76 : 0.88);
	const f = fitBox(txt, W * 0.84, (bot - top) * 0.86, 1.32, 0.03, port ? 4 : 3);
	const size = Math.min(f.size, M * 0.22);
	if (sign) {
		const sw = M * 0.3;
		const sx = x1 - sw;
		const sy = H * 0.845;
		const es = inOutCubic(clamp((env.lt - 0.5) / 0.7));
		const pts: Pt[] = [];
		const ph = (seed % 628) / 100;
		for (let i = 0; i <= 96; i += 1) {
			const u = i / 96;
			const k = 1 - u * 0.55;
			const th = u * 34 + ph;
			pts.push([
				sx + u * sw * 0.86 + Math.cos(th) * sw * 0.04 * k,
				sy - (Math.sin(th) * 0.55 + Math.sin(u * 9 + ph * 2) * 0.45 + 0.3) * M * 0.036 * k,
			]);
		}
		pts.push([sx + sw * 0.98, sy - M * 0.02]);
		if (es > 0 && out > 0) polyPartial(env, pts, es, acc, Math.max(2.5, M * 0.004), out);
		Ln(env, sx, sy + M * 0.03, sx + sw * inE(env, 0.5, 0.35), sy + M * 0.03, sc.sub, lw, out);
		label(env, "SIGNED", sx, sy + M * 0.03 + ls * 1.1, { alpha: la, size: ls * 0.85 });
	}
	mainDraw(env, { align: "left", color: sc.fg, lead: 1.32, size, text: f.text, track: 0.03, x: x0, y: (top + bot) / 2 });
}

/** 色見本帳 — a colour fan deck: chips swing out round a rivet, lyric on the top chip. */
function drawSwatchFan(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const nb = pickOf(seed, 291, [2, 3, 3] as const);
	const dir = pickOf(seed, 292, [1, -1] as const);
	const code = intOf(seed, 293, 100, 999);
	const ang = rangeOf(seed, 294, 9, 13);
	const ch = port ? Math.min(H * 0.68, W * 0.66 * 1.75) : H * 0.82;
	const cw = port ? W * 0.66 : Math.min(W * 0.4, ch * 0.66);
	const d = dir;
	const cx = W / 2 + d * W * (port ? 0.05 : 0.09);
	const x0 = cx - cw / 2;
	const y0 = (H - ch) / 2;
	const px = cx;
	const py = y0 + ch - cw * 0.13;
	const r = cw * 0.05;
	const paper = paperOf(sc);
	const ink = onCol(sc, paper);
	const fieldH = ch * 0.68;
	const ok = (color: string | undefined): boolean =>
		!!color && contrastOf(color, paper) >= 1.35;
	const cols = [sc.accent, sc.accent2, sc.ink, sc.sub, mixOf(paper, ink, 0.6)].filter(ok);
	const field = cols[0] ?? mixOf(paper, ink, 0.8);
	const fon = onCol(sc, field);
	const e = inE(env, 0.45);
	const a = e * out;
	const ef = oBack(clamp((env.lt - 0.15) / 0.6), 1.2);
	// eslint-disable-next-line opencut/prefer-object-params
	const chip = (color: string, top: boolean): void => {
		rrect(env, x0, y0 + (1 - e) * M * 0.05, cw, ch, r, paper, a);
		rrect(env, x0 + cw * 0.05, y0 + cw * 0.05 + (1 - e) * M * 0.05, cw * 0.9, fieldH, r * 0.5, color, a);
		if (top) {
			const la = inC(env, 0.3, 0.3) * out;
			const ly = y0 + cw * 0.05 + fieldH;
			label(env, `JZ ${code} C`, x0 + cw * 0.07, ly + (py - r * 2 - ly) * 0.34, { alpha: la, color: ink, size: Math.min(ls * 1.3, cw * 0.07) });
			label(env, shortOf(txt, 14), x0 + cw * 0.07, ly + (py - r * 2 - ly) * 0.72, { alpha: la, color: mixOf(paper, ink, 0.55), size: Math.min(ls, cw * 0.055) });
		}
		disc(env, px, py, r, sc.bg, a);
		ringS(env, px, py, r * 1.5, mixOf(paper, ink, 0.5), lw * 1.5, a);
	};
	if (a > 0) {
		for (let k = nb; k >= 1; k -= 1) {
			tilted(env, px, py, -d * k * ang * ef, () => {
				chip(cols[k % Math.max(1, cols.length)] ?? field, false);
			});
		}
		chip(field, true);
	}
	const f = fitBox(txt, cw * 0.8, fieldH * 0.8, 1.18, 0.02, 5);
	const size = Math.min(f.size, cw * 0.42);
	mainDraw(env, { color: fon, lead: 1.18, size, text: f.text, track: 0.02, x: cx, y: y0 + cw * 0.05 + fieldH / 2 });
}
