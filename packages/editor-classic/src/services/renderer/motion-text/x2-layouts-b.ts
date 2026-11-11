import { estimatedTextWidth } from "./core-layout-utils";
import { enterBOutBack } from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inCubic,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	randomSigned,
	randomUnit,
	secondsOf,
	TICKS_PER_SECOND,
} from "./exit-hold-geometry";
import { layoutADrawFrame, layoutADrawLine } from "./layouts-a-utils";
import { x2Hash } from "./x2-drawing";
import type { TypographyLayoutOptions } from "./typography-layout-types";

/**
 * JIZURA 追加分2 layouts B (x2layB) — geometric / graphic compositions:
 * primitives, split fields, modular grids and dials.
 *
 * Faithful transliteration of `11p_x2_layB.js` into the rocut layout
 * contract. The packs' render math is kept line for line; the source's env
 * helpers (`R`, `Ln`, `label`, `sector`, `J.measure`, …) map onto local
 * helpers below. Semantic simplifications match the existing x2 port family:
 * one font per cut (mono/body roles are ignored), plan() params re-derived
 * from the cut seed, `env.lt` in seconds, and no per-glyph metrics beyond the
 * house advance heuristic (0.62 per glyph, 0.34 per space). Shapes are drawn
 * with fillRect primitives (rotated rects, scanline polygons, banded discs)
 * so they render identically in canvas and minimal contexts; clip passes fall
 * back to unclipped draws when path ops are unavailable.
 */

const PI = Math.PI;
const TAU = PI * 2;

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
	readonly sc: X2LayPalette;
}

interface LabelOptions {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly rot?: number;
	readonly size?: number;
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
function stg(env: X2LayEnv, index: number, step = 0.05, duration = 0.4): number {
	return outExpoE(clamp((env.lt - index * step) / duration));
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
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
const SMALL_KANA = "ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ";
const OPENERS = "「『（(［【〈《“‘";

function isPunctCh(character: string): boolean {
	return PUNCT_source.test(character);
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

/** Closing punctuation that rides with the glyph before it (J closeP). */
function closeP(character: string): boolean {
	return isPunctCh(character) && !OPENERS.includes(character);
}

/** J.cellsOf: glyph cells with closing punctuation merged into the previous. */
function cellsOf(text: string): string[] {
	const out: string[] = [];
	for (const character of slotsOf(text)) {
		const last = out[out.length - 1];
		if (last && !isSp(last) && closeP(character) && Array.from(last).length < 2) {
			out[out.length - 1] = last + character;
		} else {
			out.push(character);
		}
	}
	return out;
}

// eslint-disable-next-line opencut/prefer-object-params
function chunk<T>(values: readonly T[], per: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < values.length; i += per) {
		out.push(values.slice(i, i + per));
	}
	return out;
}

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

/** J.rowCells: Latin breaks between words, anything else into even runs. */
// eslint-disable-next-line opencut/prefer-object-params
function rowCells(text: string, rowCount: number): string[][] {
	const all = cellsOf(text);
	if (isLatinText(text) && all.includes(" ")) {
		return linesOf(text.replace(/\s+/gu, " "), rowCount)
			.split("\n")
			.map(cellsOf);
	}
	return chunk(all, Math.ceil(all.length / Math.max(1, Math.min(rowCount, all.length))));
}

interface PaddedRows {
	readonly flat: string[];
	readonly per: number;
	readonly rows: number;
}

function padRows(rows: readonly string[][]): PaddedRows {
	const per = Math.max(1, ...rows.map((row) => row.length));
	return {
		flat: rows.flatMap((row) => row.concat(Array.from({ length: per - row.length }, () => " "))),
		per,
		rows: rows.length,
	};
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

// eslint-disable-next-line opencut/prefer-object-params
function pickPlate(sc: X2LayPalette, kind: string): string {
	if (kind === "accent") return plateCol(sc, [sc.accent, sc.ink, sc.fg]);
	if (kind === "accent2") return plateCol(sc, [sc.accent2, sc.accent, sc.fg]);
	if (kind === "ink") return plateCol(sc, [sc.ink, sc.accent, sc.fg]);
	return plateCol(sc, [sc.fg, sc.ink]);
}

function accentOn(sc: X2LayPalette): string {
	if (contrastOf(sc.accent, sc.bg) >= 2) return sc.accent;
	if (sc.accent2 && contrastOf(sc.accent2, sc.bg) >= 2) return sc.accent2;
	return sc.fg;
}

function dimOf(sc: X2LayPalette): string {
	return mixOf(sc.bg, sc.fg, 0.17);
}

/* ---------------------------------------------------------------- drawing */

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

/** JIZURA env.loop: a closed polygon outline. */
// eslint-disable-next-line opencut/prefer-object-params
function loopLine(env: X2LayEnv, points: readonly Pt[], color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003 || points.length < 2) return;
	polyLine(env, [...points, points[0]!, points[1]!], color, thickness, alpha);
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
	const steps = Math.max(14, Math.min(72, Math.round((TAU * radius) / Math.max(3, thickness * 3))));
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

/** JIZURA sector: a pie slice / ring segment as a fan of filled quads. */
// eslint-disable-next-line opencut/prefer-object-params
function sector(env: X2LayEnv, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, color: string, alpha = 1): void {
	if (alpha <= 0.003 || a1 - a0 < 0.01 || r1 <= 0) return;
	const span = a1 - a0;
	const steps = Math.max(1, Math.ceil(Math.abs(span) / 8));
	for (let i = 1; i <= steps; i += 1) {
		const prev = degrees(a0 + (span * (i - 1)) / steps);
		const next = degrees(a0 + (span * i) / steps);
		const quad: readonly Pt[] = [
			[cx + Math.cos(prev) * r0, cy + Math.sin(prev) * r0],
			[cx + Math.cos(prev) * r1, cy + Math.sin(prev) * r1],
			[cx + Math.cos(next) * r1, cy + Math.sin(next) * r1],
			[cx + Math.cos(next) * r0, cy + Math.sin(next) * r0],
		];
		poly(env, quad, color, alpha);
	}
}

/** JIZURA arcS: a stroked arc band as short rotated-rect segments. */
// eslint-disable-next-line opencut/prefer-object-params
function arcS(env: X2LayEnv, cx: number, cy: number, radius: number, a0: number, a1: number, color: string, thickness: number, alpha = 1): void {
	if (alpha <= 0.003 || a1 - a0 < 0.01) return;
	const span = a1 - a0;
	const arcLength = Math.abs(span) * (PI / 180) * radius;
	const steps = Math.max(2, Math.min(90, Math.round(arcLength / Math.max(4, thickness))));
	let px = cx + Math.cos(degrees(a0)) * radius;
	let py = cy + Math.sin(degrees(a0)) * radius;
	for (let i = 1; i <= steps; i += 1) {
		const angle = degrees(a0 + (span * i) / steps);
		const x = cx + Math.cos(angle) * radius;
		const y = cy + Math.sin(angle) * radius;
		Ln(env, px, py, x, y, color, thickness, alpha);
		px = x;
		py = y;
	}
}

/* ------------------------------------------------------------ transforms */

// eslint-disable-next-line opencut/prefer-object-params
function rotM(cx: number, cy: number, deg: number): readonly number[] {
	const c = Math.cos(degrees(deg));
	const s = Math.sin(degrees(deg));
	return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}

// eslint-disable-next-line opencut/prefer-object-params
function xfPt(m: readonly number[], x: number, y: number): Pt {
	return [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];
}

// eslint-disable-next-line opencut/prefer-object-params
function rectPts(cx: number, cy: number, w: number, h: number, deg = 0): Pt[] {
	const m = rotM(cx, cy, deg);
	return ([
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	] as const).map((k) =>
		xfPt(m, cx + (k[0]! * w) / 2, cy + (k[1]! * h) / 2),
	);
}

// eslint-disable-next-line opencut/prefer-object-params
function ngon(cx: number, cy: number, rx: number, ry: number, n: number, deg = -90): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < n; i += 1) {
		const angle = degrees(deg + (i * 360) / n);
		out.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
	}
	return out;
}

// eslint-disable-next-line opencut/prefer-object-params
function withXf(env: X2LayEnv, m: readonly number[], fn: () => void): void {
	const ctx = env.ctx;
	ctx.save();
	ctx.transform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
	try {
		fn();
	} finally {
		ctx.restore();
	}
}

/* ----------------------------------------------------------- clip passes */

type PathFn = (ctx: TypographyLayoutOptions["ctx"]) => void;

// eslint-disable-next-line opencut/prefer-object-params
function pathCirc(ctx: TypographyLayoutOptions["ctx"], cx: number, cy: number, r: number): void {
	ctx.moveTo?.(cx + r, cy);
	ctx.arc?.(cx, cy, Math.max(0.01, r), 0, TAU);
	ctx.closePath?.();
}

// eslint-disable-next-line opencut/prefer-object-params
function pathPoly(ctx: TypographyLayoutOptions["ctx"], points: readonly Pt[]): void {
	points.forEach((point, index) => {
		if (index) ctx.lineTo?.(point[0], point[1]);
		else ctx.moveTo?.(point[0], point[1]);
	});
	ctx.closePath?.();
}

function pathSupported(ctx: TypographyLayoutOptions["ctx"]): boolean {
	return (
		typeof ctx.moveTo === "function" &&
		typeof ctx.arc === "function" &&
		typeof ctx.lineTo === "function" &&
		typeof ctx.fill === "function"
	);
}

/** JIZURA clipped: run fn clipped to a path (unclipped when paths are absent). */
// eslint-disable-next-line opencut/prefer-object-params
function clipped(env: X2LayEnv, pathFn: PathFn, fn: () => void): void {
	const ctx = env.ctx;
	if (!pathSupported(ctx)) {
		fn();
		return;
	}
	ctx.save();
	ctx.beginPath();
	pathFn(ctx);
	ctx.clip();
	try {
		fn();
	} finally {
		ctx.restore();
	}
}

/** JIZURA clippedOut: run fn outside a path via an even-odd complement. */
// eslint-disable-next-line opencut/prefer-object-params
function clippedOut(env: X2LayEnv, pathFn: PathFn, fn: () => void): void {
	const ctx = env.ctx;
	if (!pathSupported(ctx)) {
		fn();
		return;
	}
	ctx.save();
	ctx.beginPath();
	ctx.rect(-env.W * 3, -env.H * 3, env.W * 7, env.H * 7);
	pathFn(ctx);
	ctx.clip("evenodd");
	try {
		fn();
	} finally {
		ctx.restore();
	}
}

/* ------------------------------------------------------------------ text */

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
	if (rot) {
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

/** J.mainDraw with `fill:false` — an outline-only item via strokeText. */
// eslint-disable-next-line opencut/prefer-object-params
function mainDrawOutline(env: X2LayEnv, item: MainItem, strokeWidth: number): void {
	const alpha = item.alpha ?? 1;
	if (alpha <= 0.003) return;
	const lead = item.lead ?? 1.3;
	const ctx = env.ctx;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * alpha;
	ctx.strokeStyle = item.color;
	ctx.lineWidth = strokeWidth;
	ctx.textAlign = item.align ?? "center";
	env.setFontSize(item.size);
	const lines = item.text.split("\n");
	const measured = measure(item.text, item.size, lead, item.track ?? 0);
	let y = item.y - measured.h / 2 + (lead * item.size) / 2;
	for (const line of lines) {
		const lineWidth = measure(line, item.size, lead, item.track ?? 0).w;
		ctx.strokeText(line, item.x, y, Math.max(item.size * 2, lineWidth * 1.25));
		y += lead * item.size;
	}
	ctx.globalAlpha = base;
}

/* -------------------------------------------------- silhouette row tables */

const DIA: Readonly<Record<number, readonly number[]>> = {
	1: [1], 2: [2], 3: [3], 4: [1, 2, 1], 5: [1, 3, 1], 6: [1, 2, 2, 1], 7: [2, 3, 2],
	8: [1, 3, 3, 1], 9: [2, 5, 2], 10: [3, 4, 3], 11: [3, 5, 3], 12: [2, 4, 4, 2],
	13: [1, 3, 5, 3, 1], 14: [3, 4, 4, 3], 15: [1, 4, 5, 4, 1], 16: [3, 5, 5, 3],
};
const DIAW: Readonly<Record<number, readonly number[]>> = {
	...DIA, 6: [1, 4, 1], 9: [2, 5, 2], 12: [3, 6, 3], 14: [2, 5, 5, 2],
};
const TRI: Readonly<Record<number, readonly number[]>> = {
	1: [1], 2: [2], 3: [1, 2], 4: [1, 3], 5: [2, 3], 6: [1, 2, 3], 7: [3, 4],
	8: [1, 3, 4], 9: [2, 3, 4], 10: [1, 2, 3, 4], 11: [2, 4, 5], 12: [3, 4, 5],
	13: [1, 3, 4, 5], 14: [2, 3, 4, 5], 15: [1, 2, 3, 4, 5], 16: [1, 2, 3, 4, 6],
};

/** J.shapeRows: glyphs set in rows whose counts draw a diamond / triangle. */
// eslint-disable-next-line opencut/prefer-object-params
function shapeRows(text: string, table: Readonly<Record<number, readonly number[]>>, reverse: boolean): string[] | null {
	if (isLatinText(text)) return null;
	const chars = Array.from(text.replace(/\s+/gu, ""));
	const pattern = table[chars.length];
	if (!pattern) return null;
	const runs = reverse ? [...pattern].reverse() : [...pattern];
	const rows: string[][] = [];
	let k = 0;
	for (const count of runs) {
		rows.push(chars.slice(k, k + count));
		k += count;
	}
	const bad = (character: string): boolean =>
		(isPunctCh(character) && !OPENERS.includes(character)) ||
		isSmallKana(character) ||
		character === "ー";
	for (let i = 1; i < rows.length; i += 1) {
		while (rows[i]!.length > 1 && bad(rows[i]![0]!)) {
			const moved = rows[i]!.shift();
			if (moved !== undefined) rows[i - 1]!.push(moved);
		}
	}
	return rows.map((row) => row.join(""));
}

/* -------------------------------------------------------------- dispatch */

export function drawX2LayoutB(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "xbHalfDisc":
		case "xbDiagSplit":
		case "xbChevronChain":
		case "xbTwistFrames":
		case "xbDonut":
		case "xbIsoStack":
		case "xbPolyTrack":
		case "xbShapeRow":
		case "xbCompGrid":
		case "xbPrimitives":
		case "xbArcPoster":
		case "xbZiggurat":
		case "xbHoneycomb":
		case "xbShear":
		case "xbPatternPanel":
		case "xbDiamond":
		case "xbShapeLens":
		case "xbConstruct":
		case "xbGolden":
		case "xbVenn":
		case "xbSlitDisc":
		case "xbDial":
		case "xbCrosshair":
		case "xbStripeDisc":
		case "xbWedge":
		case "xbGradBars":
		case "xbGraph":
		case "xbPie":
		case "xbCircleFit":
		case "xbTriangleSet":
			drawX2LayoutBPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2LayoutBPart(options: TypographyLayoutOptions): void {
	switch (options.frame.cut?.preset.layout) {
		case "xbHalfDisc":
			drawHalfDisc(options);
			return;
		case "xbDiagSplit":
			drawDiagSplit(options);
			return;
		case "xbChevronChain":
			drawChevronChain(options);
			return;
		case "xbTwistFrames":
			drawTwistFrames(options);
			return;
		case "xbDonut":
			drawDonut(options);
			return;
		case "xbIsoStack":
			drawIsoStack(options);
			return;
		case "xbPolyTrack":
			drawPolyTrack(options);
			return;
		case "xbShapeRow":
			drawShapeRow(options);
			return;
		case "xbCompGrid":
			drawCompGrid(options);
			return;
		case "xbPrimitives":
			drawPrimitives(options);
			return;
		case "xbArcPoster":
			drawArcPoster(options);
			return;
		case "xbZiggurat":
			drawZiggurat(options);
			return;
		case "xbHoneycomb":
			drawHoneycomb(options);
			return;
		case "xbShear":
			drawShear(options);
			return;
		case "xbPatternPanel":
			drawPatternPanel(options);
			return;
		case "xbDiamond":
			drawDiamond(options);
			return;
		case "xbShapeLens":
			drawShapeLens(options);
			return;
		case "xbConstruct":
			drawConstruct(options);
			return;
		case "xbGolden":
			drawGolden(options);
			return;
		case "xbVenn":
			drawVenn(options);
			return;
		case "xbSlitDisc":
			drawSlitDisc(options);
			return;
		case "xbDial":
			drawDial(options);
			return;
		case "xbCrosshair":
			drawCrosshair(options);
			return;
		case "xbStripeDisc":
			drawStripeDisc(options);
			return;
		case "xbWedge":
			drawWedge(options);
			return;
		case "xbGradBars":
			drawGradBars(options);
			return;
		case "xbGraph":
			drawGraph(options);
			return;
		case "xbPie":
			drawPie(options);
			return;
		case "xbCircleFit":
			drawCircleFit(options);
			return;
		case "xbTriangleSet":
			drawTriangleSet(options);
			return;
		default:
			return;
	}
}

/* ==================================================================== parts */

/** 半円またぎ — a huge disc rises over one edge; the lyric reverses on it. */
function drawHalfDisc(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, sc } = env;
	const side = pickOf(env.seed, 1, ["b", "b", "t", "l", "r"] as const);
	const colKind = pickOf(env.seed, 2, ["accent", "ink", "fg"] as const);
	const off = rangeOf(env.seed, 3, -0.1, 0.1);
	const ring = chanceOf(env.seed, 4, 0.6);
	const lead = 1.2;
	const fb = fitBox(txt, W * 0.84, H * 0.5, lead, 0.02, 4);
	const size = Math.min(fb.size, M * 0.32);
	const plate = pickPlate(sc, colKind);
	const pon = onCol(sc, plate);
	const q = inE(env, 0.6) * (1 - inExpoE(env.pOut));
	const R0 = Math.max(W * 0.42, H * 0.45);
	const horiz = side === "b" || side === "t";
	const sg = side === "b" || side === "r" ? 1 : -1;
	const cx = horiz ? W / 2 + off * W : W / 2 + sg * R0 * 0.97;
	const cy = horiz ? H / 2 + sg * R0 * 0.97 : H / 2 + off * H;
	const r = R0 * q;
	disc(env, cx, cy, r, plate, 1);
	if (ring) {
		ringS(env, cx, cy, R0 * (0.6 + 0.5 * q), sc.sub, lw * 1.5, 0.6 * out * q);
		ringS(env, cx, cy, R0 * (0.5 + 0.72 * q), sc.sub, lw, 0.35 * out * q);
	}
	const drawItem = (color: string): void => {
		mainDraw(env, { color, lead, size, text: fb.text, track: 0.02, x: W / 2, y: H / 2 });
	};
	clippedOut(env, (ctx) => pathCirc(ctx, cx, cy, r), () => drawItem(sc.fg));
	if (r > 1) {
		clipped(env, (ctx) => pathCirc(ctx, cx, cy, r), () => drawItem(pon));
	}
}

/** 斜め二色 — the screen is cut diagonally; the lyric swaps colour across it. */
function drawDiagSplit(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, sc } = env;
	const ang = pickOf(env.seed, 11, [-34, -22, 22, 34, 58, -58] as const);
	const side = pickOf(env.seed, 12, [1, -1] as const);
	const colKind = pickOf(env.seed, 13, ["ink", "accent", "fg"] as const);
	const showLine = chanceOf(env.seed, 14, 0.65);
	const lead = 1.2;
	const fb = fitBox(txt, W * 0.84, H * 0.5, lead, 0.02, 4);
	const size = Math.min(fb.size, M * 0.32);
	const plate = pickPlate(sc, colKind);
	const pon = onCol(sc, plate);
	const q = inE(env, 0.55) * (1 - inExpoE(env.pOut));
	const a = degrees(ang);
	const dx = Math.cos(a);
	const dy = Math.sin(a);
	const nx = -dy * side;
	const ny = dx * side;
	const L = Math.hypot(W, H);
	const o = (1 - q) * L * 0.8;
	const c0: Pt = [W / 2 + nx * o, H / 2 + ny * o];
	const pts: readonly Pt[] = [
		[c0[0] - dx * L, c0[1] - dy * L],
		[c0[0] + dx * L, c0[1] + dy * L],
		[c0[0] + dx * L + nx * L * 2, c0[1] + dy * L + ny * L * 2],
		[c0[0] - dx * L + nx * L * 2, c0[1] - dy * L + ny * L * 2],
	];
	if (q > 0.001) poly(env, pts, plate, 1);
	if (showLine) {
		const g = M * 0.028;
		const e = inE(env, 0.6, 0.15) * out;
		Ln(env, W / 2 - nx * g - dx * L * e, H / 2 - ny * g - dy * L * e, W / 2 - nx * g + dx * L * e, H / 2 - ny * g + dy * L * e, accentOn(sc), lw * 2.5, out);
	}
	const drawItem = (color: string): void => {
		mainDraw(env, { color, lead, size, text: fb.text, track: 0.02, x: W / 2, y: H / 2 });
	};
	clippedOut(env, (ctx) => pathPoly(ctx, pts), () => drawItem(sc.fg));
	if (q > 0.001) {
		clipped(env, (ctx) => pathPoly(ctx, pts), () => drawItem(pon));
	}
}

/** 矢印つなぎ — the lyric in interlocking chevron plates like process steps. */
function drawChevronChain(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, sc } = env;
	const swap = chanceOf(env.seed, 21, 0.5);
	const second = pickOf(env.seed, 22, ["accent", "fg", "accent2"] as const);
	const tail = chanceOf(env.seed, 23, 0.7);
	const n = glyphCountOf(txt);
	const rowMode = port || n > 6;
	const K0 = port ? Math.min(4, Math.ceil(n / 4)) : n <= 3 ? 1 : n <= 10 ? 2 : 3;
	const segs = linesOf(txt, K0).split("\n");
	const K = segs.length;
	const cA = pickPlate(sc, "ink");
	const cB = pickPlate(sc, second);
	const cols = swap ? [cB, cA] : [cA, cB];
	const gap = M * 0.014;
	// eslint-disable-next-line opencut/prefer-object-params
	const fit = (w: number, h: number): number =>
		Math.min(...segs.map((s) => fitSize(s, w, h, 1.3, 0.03)));
	let hh: number;
	let t: number;
	let size = 0;
	let ws = 0;
	let wsI: number[] | null = null;
	if (rowMode) {
		hh = Math.min((H * 0.66) / K - gap, M * (K === 1 ? 0.34 : 0.26));
		t = hh * 0.4;
		size = fit(W * 0.84 - 2 * t - hh * 0.15, hh * 0.6);
		const h2 = Math.max(size * 1.7, hh * 0.5);
		if (h2 < hh) {
			hh = h2;
			t = hh * 0.4;
		}
		wsI = segs.map(
			(s) => Math.max(W * 0.34, measure(s, size, 1.3, 0.03).w + 2 * t + hh * 0.3),
		);
	} else {
		hh = M * 0.34;
		t = hh * 0.42;
		for (let k = 0; k < 2; k += 1) {
			ws = (W * 0.9 + (K - 1) * (t - gap)) / K;
			size = fit(ws - 2 * t - hh * 0.12, hh * 0.6);
			hh = Math.min(M * 0.34, Math.max(M * 0.13, size * 1.8));
			t = hh * 0.42;
		}
		ws = (W * 0.9 + (K - 1) * (t - gap)) / K;
	}
	// eslint-disable-next-line opencut/prefer-object-params
	const chev = (x0: number, yc: number, w: number): Pt[] => [
		[x0, yc - hh / 2],
		[x0 + w - t, yc - hh / 2],
		[x0 + w, yc],
		[x0 + w - t, yc + hh / 2],
		[x0, yc + hh / 2],
		[x0 + t, yc],
	];
	const stepX = rowMode ? Math.min(W * 0.05, (W * 0.92 - Math.max(...(wsI ?? [0]))) / Math.max(1, K - 1)) : 0;
	let xe = 0;
	let ye = H / 2;
	for (let i = 0; i < K; i += 1) {
		const e = stg(env, i, 0.08, 0.45);
		const dx = -(1 - e) * W * 0.45;
		const w = rowMode ? wsI?.[i] ?? ws : ws;
		const x0 = rowMode
			? (W - w) / 2 + (i - (K - 1) / 2) * stepX
			: W * 0.05 + i * (ws - t + gap);
		const yc = rowMode ? H / 2 + (i - (K - 1) / 2) * (hh + gap) : H / 2;
		const col = cols[i % 2]!;
		poly(env, chev(x0 + dx, yc, w), col, out * clamp(e * 3));
		mainDraw(env, {
			color: onCol(sc, col),
			size,
			text: segs[i] ?? "",
			track: 0.03,
			x: x0 + w / 2 + t * 0.08,
			y: yc,
		});
		xe = x0 + w;
		ye = yc;
	}
	if (tail) {
		for (let k = 1; k <= 2; k += 1) {
			const e = inE(env, 0.4, 0.2 + k * 0.08);
			const x = xe + k * gap * 2.2 - (1 - e) * t;
			if (x > W * 0.99) break;
			polyLine(env, [[x - t, ye - hh / 2], [x, ye], [x - t, ye + hh / 2]], k === 1 ? accentOn(sc) : sc.sub, lw * 3, e * out * (k === 1 ? 0.9 : 0.5));
		}
	}
}

/** ねじれ枠 — nested frames, each turned a little further; lyric level inside. */
function drawTwistFrames(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, sc } = env;
	const th = rangeOf(env.seed, 31, 5, 10) * pickOf(env.seed, 32, [1, -1] as const);
	const frameCount: number = pickOf(env.seed, 33, [5, 6, 7] as const);
	const plateOn = chanceOf(env.seed, 34, 0.35);
	const acc = intOf(env.seed, 35, 1, 3);
	const sq = chanceOf(env.seed, 36, 0.5);
	const f = fitBox(txt, W * (port ? 0.7 : 0.6), H * (port ? 0.34 : 0.42), 1.2, 0.03, 3);
	const size = Math.min(f.size, M * 0.22);
	const m = measure(f.text, size, 1.2, 0.03);
	const bw = m.w + size * 0.9;
	let bh = m.h + size * 0.8;
	if (sq) bh = Math.max(bh, Math.min(bw, M * 0.5));
	const d = M * 0.075;
	const plate = pickPlate(sc, "ink");
	for (let k: number = frameCount; k >= 0; k -= 1) {
		const e = stg(env, k, 0.045, 0.6);
		const rot = k * th * (e + 0.1 * Math.sin(env.lt * 0.8 + k * 0.5) + env.pOut * 0.7);
		const pts = rectPts(W / 2, H / 2, (bw + k * d * 2) * (0.7 + 0.3 * e), (bh + k * d * 2) * (0.7 + 0.3 * e), rot);
		const a = out * clamp(e * 2);
		if (k === 0 && plateOn) poly(env, pts, plate, a);
		loopLine(
			env,
			pts,
			k === 0 ? sc.fg : k === acc ? accentOn(sc) : sc.sub,
			k === 0 ? lw * 3 : k === acc ? lw * 2.5 : lw * 1.5,
			a * (k === 0 || k === acc ? 1 : 0.8 - (0.5 * k) / frameCount),
		);
	}
	mainDraw(env, {
		color: plateOn ? onCol(sc, plate) : sc.fg,
		lead: 1.2,
		size,
		text: f.text,
		track: 0.03,
		x: W / 2,
		y: H / 2,
	});
}

/** ドーナツ図 — a thick segmented chart ring (or a gauge) turns around the lyric. */
function drawDonut(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, ls, seed, sc } = env;
	const mode = pickOf(seed, 41, ["seg", "gauge", "seg"] as const);
	const segCount = intOf(seed, 42, 3, 5);
	const a0 = rangeOf(seed, 43, 0, 360);
	const val = rangeOf(seed, 44, 0.55, 0.92);
	const dir = pickOf(seed, 45, [1, -1] as const);
	const cx = W / 2;
	const cy = H / 2;
	const Ro = M * 0.455;
	const th = M * 0.07;
	const Ri = Ro - th;
	const f = fitBox(txt, Ri * 1.5, Ri * 1.12, 1.2, 0.02, 4);
	const size = Math.min(f.size, M * 0.22);
	const e = inE(env, 0.7);
	const plate = pickPlate(sc, "ink");
	const acc = accentOn(sc);
	if (mode === "gauge") {
		sector(env, cx, cy, Ri, Ro, 0, 360, dimOf(sc), out * inC(env, 0.3));
		const a1 = -90 + 360 * val * e * (1 - 0.06 * env.pOut) + 3 * Math.sin(env.lt * 1.3);
		sector(env, cx, cy, Ri, Ro, -90, a1, acc, out);
		const er = degrees(a1);
		disc(env, cx + Math.cos(er) * (Ro - th / 2), cy + Math.sin(er) * (Ro - th / 2), th * 0.24, onCol(sc, acc), out * e);
		label(env, `${String(Math.round(val * 100 * e)).padStart(3, "0")}%`, cx, cy + Ri * 0.78, { align: "center", alpha: out * inC(env, 0.3, 0.2), size: ls * 1.2 });
	} else {
		const cols = [plate, acc, pickPlate(sc, "accent2"), sc.sub];
		const wts: number[] = [];
		let sum = 0;
		for (let i = 0; i < segCount; i += 1) {
			const w = 0.5 + randomUnit(seed, i, 21);
			wts.push(w);
			sum += w;
		}
		let a = a0 + env.lt * 5 * dir + (1 - e) * 120 * dir;
		for (let i = 0; i < segCount; i += 1) {
			const span = (wts[i]! / sum) * 360;
			const ei = stg(env, i, 0.07, 0.6);
			sector(
				env,
				cx,
				cy,
				i === 1 ? Ri - th * 0.18 : Ri,
				i === 1 ? Ro + th * 0.18 : Ro,
				a + 2,
				a + 2 + (span - 4) * ei,
				cols[i % cols.length]!,
				out * (i % cols.length === 3 ? 0.6 : 1),
			);
			a += span;
		}
	}
	const tickCount = 60;
	for (let i = 0; i < tickCount * e; i += 1) {
		const angle = degrees((i / tickCount) * 360 - 90);
		const r0 = Ro + M * 0.014;
		const r1 = r0 + M * (i % 5 ? 0.008 : 0.018);
		Ln(
			env,
			cx + Math.cos(angle) * r0,
			cy + Math.sin(angle) * r0,
			cx + Math.cos(angle) * r1,
			cy + Math.sin(angle) * r1,
			sc.sub,
			lw * 1.5,
			0.55 * out,
		);
	}
	mainDraw(env, { color: sc.fg, lead: 1.2, size, text: f.text, track: 0.02, x: cx, y: cy });
}

/** アイソメ積層 — each line lettered on the front of an extruded isometric slab. */
function drawIsoStack(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, sc } = env;
	const ang = pickOf(env.seed, 51, [13, 17, 21] as const);
	const shift = rangeOf(env.seed, 52, 0.4, 1) * pickOf(env.seed, 53, [1, -1] as const);
	const second = pickOf(env.seed, 54, ["accent", "ink", "fg"] as const);
	const deep = rangeOf(env.seed, 55, 0.55, 0.9);
	const n = glyphCountOf(txt);
	const lines = linesOf(
		txt,
		port ? (n <= 3 ? 1 : n <= 6 ? 2 : n <= 10 ? 3 : 4) : n <= 5 ? 1 : n <= 10 ? 2 : 3,
	).split("\n");
	const L = lines.length;
	const c = Math.cos(degrees(ang));
	const s = Math.sin(degrees(ang));
	let size = Math.min(M * 0.22, ...lines.map((line) => fitSize(line, (W * 0.74) / c, M, 1.3, 0.03)));
	interface Slab {
		readonly front: readonly Pt[];
		readonly p: Pt;
		readonly side: readonly Pt[];
		readonly top: readonly Pt[];
		readonly w: number;
	}
	const build = (sz: number): { bb: { cx: number; cy: number; x0: number; x1: number; y0: number; y1: number }; h: number; slabs: Slab[] } => {
		const h = sz * 1.42;
		const D = sz * deep;
		const slabs: Slab[] = [];
		const all: Pt[] = [];
		lines.forEach((line, i) => {
			const w = measure(line, sz, 1.3, 0.03).w + sz * 0.8;
			const u = (i % 2 ? 1 : -1) * sz * 0.4 * shift * (L > 1 ? 1 : 0) - w / 2;
			const p: Pt = [u * c, -u * s + (i + 1) * h];
			const q: Pt = [p[0] + w * c, p[1] - w * s];
			const dz: Pt = [-c * D, -s * D];
			const front: readonly Pt[] = [p, q, [q[0], q[1] - h], [p[0], p[1] - h]];
			const top: readonly Pt[] = [
				front[3]!,
				front[2]!,
				[front[2]![0] + dz[0], front[2]![1] + dz[1]],
				[front[3]![0] + dz[0], front[3]![1] + dz[1]],
			];
			const side: readonly Pt[] = [p, front[3]!, top[3]!, [p[0] + dz[0], p[1] + dz[1]]];
			slabs.push({ front, p, side, top, w });
			all.push(...front, ...top, ...side);
		});
		let x0 = Infinity;
		let x1 = -Infinity;
		let y0 = Infinity;
		let y1 = -Infinity;
		for (const [x, y] of all) {
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
		return { bb: { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, x1, y0, y1 }, h, slabs };
	};
	let built = build(size);
	const k = Math.min(1, (W * 0.88) / (built.bb.x1 - built.bb.x0), (H * 0.8) / (built.bb.y1 - built.bb.y0));
	if (k < 1) {
		size *= k;
		built = build(size);
	}
	const ox = W / 2 - built.bb.cx;
	const oy = H / 2 - built.bb.cy;
	const cA = pickPlate(sc, "ink");
	const cB = pickPlate(sc, second);
	for (let i = L - 1; i >= 0; i -= 1) {
		const slab = built.slabs[i]!;
		const e = stg(env, L - 1 - i, 0.09, 0.5);
		const dy = -(1 - e) * H * 0.45 + oy;
		const a = out * clamp(e * 4);
		const col = i % 2 ? cB : cA;
		const mv = (points: readonly Pt[]): Pt[] => points.map((point) => [point[0] + ox, point[1] + dy]);
		poly(env, mv(slab.side), mixOf(col, sc.bg, 0.68), a);
		poly(env, mv(slab.top), mixOf(col, sc.bg, 0.4), a);
		poly(env, mv(slab.front), col, a);
		withXf(env, [c, -s, 0, 1, slab.p[0] + ox, slab.p[1] + oy], () => {
			mainDraw(env, {
				color: onCol(sc, col),
				size,
				text: lines[i] ?? "",
				track: 0.03,
				x: slab.w / 2,
				y: -built.h / 2,
			});
		});
	}
}

/** 多角形周回 — a polygon track of small running text; the lyric sits inside. */
function drawPolyTrack(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, seed, sc } = env;
	const sides = pickOf(seed, 61, [3, 4, 6, 6] as const);
	const speed = rangeOf(seed, 62, 0.012, 0.03) * pickOf(seed, 63, [1, -1] as const);
	const flip = chanceOf(seed, 64, 0.5);
	const inner = chanceOf(seed, 65, 0.6);
	let pts: Pt[];
	let bw: number;
	let bh: number;
	let ty = H / 2;
	if (sides === 3) {
		const ry = H * 0.6;
		const rx = W * 0.53;
		const f = flip ? -1 : 1;
		const cy = H / 2 + f * ry * 0.25;
		pts = [
			[W / 2, cy - f * ry],
			[W / 2 + rx * 0.866, cy + f * ry * 0.5],
			[W / 2 - rx * 0.866, cy + f * ry * 0.5],
		];
		if (f < 0) pts = [pts[0]!, pts[2]!, pts[1]!];
		bw = rx * 0.86;
		bh = ry * 0.56;
		ty = cy + f * ry * 0.13;
	} else if (sides === 4) {
		pts = ngon(W / 2, H / 2, W * 0.47, H * 0.47, 4, -90);
		bw = W * 0.47 * 0.98;
		bh = H * 0.47 * 0.84;
	} else {
		pts = ngon(W / 2, H / 2, W * 0.47, H * 0.5, 6, 0);
		bw = W * 0.47 * 1.3;
		bh = H * 0.5 * 1.1;
	}
	const f = fitBox(txt, bw, bh, 1.2, 0.02, 4);
	const size = Math.min(f.size, M * 0.24);
	const N = pts.length;
	const segL: number[] = [];
	const cum = [0];
	let Lp = 0;
	for (let i = 0; i < N; i += 1) {
		const a = pts[i]!;
		const b = pts[(i + 1) % N]!;
		const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
		segL.push(d);
		Lp += d;
		cum.push(Lp);
	}
	const gs = M * 0.036;
	const cnt = Math.min(110, Math.floor(Lp / (gs * 1.22)));
	const pitch = Lp / cnt;
	const unit = Array.from(`${txt.replace(/\s+/gu, " ")} ◆ `);
	const e = inE(env, 0.8);
	if (inner) {
		const center: Pt = [W / 2, sides === 3 ? ty : H / 2];
		loopLine(
			env,
			pts.map((point) => [
				center[0] + (point[0] - center[0]) * 0.86,
				center[1] + (point[1] - center[1]) * 0.86,
			]),
			sc.sub,
			lw * 1.5,
			0.5 * out * e,
		);
	}
	for (let i = 0; i < cnt; i += 1) {
		const ch = unit[i % unit.length] ?? " ";
		if (ch === " ") continue;
		const a = clamp((env.lt - (i / cnt) * 0.6) / 0.12) * out;
		if (a <= 0) continue;
		const d = (((i * pitch + env.lt * speed * Lp) % Lp) + Lp) % Lp;
		let k = 0;
		while (k < N - 1 && cum[k + 1]! < d) k += 1;
		const u = (d - cum[k]!) / segL[k]!;
		const A = pts[k]!;
		const B = pts[(k + 1) % N]!;
		label(env, ch, lerpN(A[0], B[0], u), lerpN(A[1], B[1], u), {
			align: "center",
			alpha: a * (ch === "◆" ? 1 : 0.85),
			color: ch === "◆" ? accentOn(sc) : sc.fg,
			rot: Math.atan2(B[1] - A[1], B[0] - A[0]) / degrees(1),
			size: ch === "◆" ? gs * 0.6 : gs,
		});
	}
	mainDraw(env, { color: sc.fg, lead: 1.2, size, text: f.text, track: 0.02, x: W / 2, y: ty });
}

/** 図形並べ — every glyph sits in its own primitive: circle, square, triangle, diamond. */
function drawShapeRow(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const order = intOf(seed, 71, 0, 3);
	const rot = rangeOf(seed, 72, 0, 9);
	const fillKind = pickOf(seed, 73, ["mix", "mix", "solid"] as const);
	const n = glyphCountOf(txt);
	const rowsTarget = port ? Math.ceil(n / 3) : n <= 6 ? 1 : n <= 12 ? 2 : 3;
	const rowsT = rowCells(txt, rowsTarget);
	const units = (row: readonly string[]): number =>
		row.reduce((sum, cell) => sum + (isSp(cell) ? 0.4 : 1), 0);
	const maxU = Math.max(...rowsT.map(units));
	const cell = Math.min((W * 0.9) / maxU, (H * 0.78) / rowsT.length, M * 0.38);
	const r = cell * 0.46;
	const cA = pickPlate(sc, "ink");
	const cB = pickPlate(sc, "accent");
	const cC = pickPlate(sc, "accent2");
	let gi = 0;
	rowsT.forEach((row, ri) => {
		let x = W / 2 - (units(row) * cell) / 2;
		const y = H / 2 + (ri - (rowsT.length - 1) / 2) * cell;
		for (const ch of row) {
			if (isSp(ch)) {
				x += cell * 0.4;
				continue;
			}
			const i = gi;
			gi += 1;
			const kind = (i + order) % 4;
			const sty = fillKind === "solid" ? i % 2 : i % 3;
			const col = sty === 0 ? cA : sty === 1 ? (i % 2 ? cB : cC === cA ? cB : cC) : null;
			const p = oBack(clamp((env.lt - i * 0.035) / 0.32), 1.5);
			const rr = r * p;
			const cx = x + cell / 2;
			const wob = randomSigned(seed, i, 33) * rot;
			let pts: Pt[] | null = null;
			let gs = cell * 0.5;
			let gy = y;
			if (kind === 1) {
				pts = rectPts(cx, y, rr * 1.72, rr * 1.72, wob);
				gs = cell * 0.54;
			} else if (kind === 2) {
				pts = [
					[cx, y - rr * 1.22],
					[cx + rr * 1.16, y + rr * 0.86],
					[cx - rr * 1.16, y + rr * 0.86],
				];
				gs = cell * 0.42;
				gy = y + r * 0.3;
			} else if (kind === 3) {
				pts = ngon(cx, y, rr * 1.08, rr * 1.08, 4, -90);
				gs = cell * 0.42;
			}
			if (p > 0) {
				if (col) {
					if (pts) poly(env, pts, col, out);
					else disc(env, cx, y, rr, col, out);
				} else if (pts) {
					loopLine(env, pts, sc.fg, lw * 2.5, out);
				} else {
					ringS(env, cx, y, rr, sc.fg, lw * 2.5, out);
				}
			}
			mainDraw(env, {
				color: col ? onCol(sc, col) : sc.fg,
				size: Array.from(ch).length > 1 ? gs * 0.74 : gs,
				text: ch,
				x: cx,
				y: gy,
			});
			x += cell;
		}
	});
}

/** 分割構成 — the screen ruled into unequal cells; some flat colour, one the lyric. */
function drawCompGrid(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc } = env;
	const vx = pickOf(seed, 81, [0, 1] as const);
	const hy = pickOf(seed, 82, [0, 1] as const);
	const fills = intOf(seed, 83, 0, 4);
	const fr = rangeOf(seed, 84, 0.24, 0.3);
	const yaP = rangeOf(seed, 85, 0.42, 0.66);
	const xaP = rangeOf(seed, 86, 0.5, 0.72);
	const fx = port ? 0.2 : fr;
	const fy = port ? fr * 0.85 : 0.22;
	const T = M * 0.011;
	const xv = vx ? W * fx : W * (1 - fx);
	const yh = hy ? H * fy : H * (1 - fy);
	const bx0 = vx ? xv : 0;
	const bx1 = vx ? W : xv;
	const by0 = hy ? yh : 0;
	const by1 = hy ? H : yh;
	const cx0 = vx ? 0 : xv;
	const cx1 = vx ? xv : W;
	const ry0 = hy ? 0 : yh;
	const ry1 = hy ? yh : H;
	const ya = lerpN(by0, by1, yaP);
	const xa = lerpN(bx0, bx1, xaP);
	const yc = [0, yh, ya, H].sort((a, b) => a - b);
	const cells: ReadonlyArray<readonly [number, number, number, number]> = [
		[cx0, yc[0]!, cx1, yc[1]!],
		[cx0, yc[1]!, cx1, yc[2]!],
		[cx0, yc[2]!, cx1, yc[3]!],
		[bx0, ry0, xa, ry1],
		[xa, ry0, bx1, ry1],
	];
	const colsAll: ReadonlyArray<string | null> = [
		accentOn(sc),
		pickPlate(sc, "ink"),
		null,
		pickPlate(sc, "accent2"),
		null,
	];
	cells.forEach((cell, i) => {
		const col = colsAll[(i + fills) % colsAll.length];
		if (!col) return;
		const e = outCubic(clamp((env.lt - 0.18 - i * 0.06) / 0.35));
		R(env, cell[0], cell[1], (cell[2] - cell[0]) * e, cell[3] - cell[1], col, out);
	});
	const fgColor = sc.fg;
	const g = (k: number): number => inE(env, 0.5, k * 0.05);
	R(env, xv - T / 2, 0, T, H * g(0), fgColor, out);
	R(env, W * (1 - g(1)), yh - T / 2, W * g(1), T, fgColor, out);
	R(env, cx0, ya - T / 2, (cx1 - cx0) * g(3), T, fgColor, out);
	R(env, xa - T / 2, ry0, T, (ry1 - ry0) * g(4), fgColor, out);
	const tx0 = Math.max(bx0 + T, W * 0.05);
	const tx1 = Math.min(bx1 - T, W * 0.95);
	const ty0 = Math.max(by0 + T, H * 0.05);
	const ty1 = Math.min(by1 - T, H * 0.95);
	const f = fitBox(txt, (tx1 - tx0) * 0.86, (ty1 - ty0) * 0.78, 1.2, 0.02, 4);
	const size = Math.min(f.size, M * 0.3);
	mainDraw(env, { color: sc.fg, lead: 1.2, size, text: f.text, track: 0.02, x: (tx0 + tx1) / 2, y: (ty0 + ty1) / 2 });
}

/** 三原形 — circle, triangle and square on one side; the lyric flush on the other. */
function drawPrimitives(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const flip = chanceOf(seed, 91, 0.4);
	const mir = chanceOf(seed, 92, 0.5);
	const rot = rangeOf(seed, 93, -24, 24);
	const bar = chanceOf(seed, 94, 0.7);
	const v = intOf(seed, 95, 0, 2);
	const ms = mir ? -1 : 1;
	const fs = flip ? -1 : 1;
	const S = port ? M * 0.3 : Math.min(M * 0.27, W * 0.15);
	const gx = port ? W / 2 + ms * W * 0.08 : ms > 0 ? W - W * 0.05 - S * 1.35 : W * 0.05 + S * 1.35;
	const gy = port ? H / 2 - fs * H * 0.2 : H / 2 - fs * H * 0.1;
	const cA = accentOn(sc);
	const cB = pickPlate(sc, "ink");
	const cC = pickPlate(sc, "accent2");
	const e1 = oBack(clamp(env.lt / 0.5), 1.4);
	const e2 = inE(env, 0.6, 0.08);
	const e3 = inE(env, 0.6, 0.16);
	const t = env.lt;
	disc(env, gx + S * 0.3 * ms, gy - S * 0.15, S * e1, [cA, cB, cA][v]!, out);
	const sq = rectPts(
		gx - S * 0.55 * ms + (1 - e2) * ms * -W * 0.3,
		gy + S * 0.55,
		S * 1.05,
		S * 1.05,
		rot * 0.4 + (1 - e2) * 60 + Math.sin(t * 0.5) * 2,
	);
	poly(env, sq, [cB, cA, cC][v]!, out * clamp(e2 * 3));
	const tc: Pt = [gx + S * 0.75 * ms, gy + S * 0.7 + (1 - e3) * H * 0.4];
	const ta = rot + t * 4;
	poly(env, ngon(tc[0], tc[1], S * 0.62, S * 0.62, 3, ta - 90), [cC === cB ? sc.fg : cC, sc.fg, cB][v]!, out * clamp(e3 * 3));
	if (bar) {
		const a = degrees(rot * 0.6 - 35 * ms);
		const L = S * 2.3 * inE(env, 0.7, 0.2);
		Ln(env, gx - Math.cos(a) * L, gy - Math.sin(a) * L, gx + Math.cos(a) * L, gy + Math.sin(a) * L, sc.fg, lw * 3, out);
	}
	ringS(env, gx - S * 0.9 * ms, gy - S * 0.75, S * 0.22 * e3, sc.fg, lw * 3, out);
	const tw = port ? W * 0.86 : W * 0.85 - S * 2.7;
	const th = port ? H * 0.3 : H * 0.5;
	const tx = port ? (mir ? W * 0.93 : W * 0.07) : mir ? W * 0.94 : W * 0.06;
	const tyc = port ? H / 2 + fs * H * 0.24 : H / 2 + fs * H * 0.12;
	const f = fitBox(txt, tw, th, 1.18, 0.02, 4);
	const size = Math.min(f.size, M * 0.24);
	const align: CanvasTextAlign = mir ? "right" : "left";
	const m = measure(f.text, size, 1.18, 0.02);
	const eb = inE(env, 0.5, 0.1);
	R(
		env,
		tx - (mir ? -size * 0.22 : size * 0.22) - lw * 2,
		tyc - (m.h / 2) * eb - size * 0.1,
		lw * 4,
		(m.h + size * 0.2) * eb,
		cA,
		out,
	);
	mainDraw(env, { align, color: sc.fg, lead: 1.18, size, text: f.text, track: 0.02, x: tx, y: tyc });
}

/** 同心弧 — concentric arcs whose weight doubles fill one corner; lyric opposite. */
function drawArcPoster(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, no, seed, sc } = env;
	const corner = intOf(seed, 101, 0, 3);
	const n = pickOf(seed, 102, [5, 6] as const);
	const a0P = rangeOf(seed, 103, 0, 360);
	const colKind = pickOf(seed, 104, ["fg", "fg", "ink", "accent"] as const);
	const accIndex = intOf(seed, 105, 0, 7);
	const rule = chanceOf(seed, 106, 0.7);
	const right = corner % 2 === 1;
	const low = corner >= 2;
	const cx = W * (right ? 0.74 : 0.26);
	const cy = H * (low ? 0.7 : 0.3);
	const tw = port ? W * 0.88 : W * 0.5;
	const th = H * (port ? 0.28 : 0.36);
	const tx = right ? W * 0.06 : W * 0.94;
	const ty0 = low ? H * 0.08 : H * 0.92 - th;
	const zx0 = right ? tx : tx - tw;
	const zx1 = zx0 + tw;
	const px = clamp(Math.min(Math.max(cx, zx0), zx1));
	const py = clamp(Math.min(Math.max(cy, ty0), ty0 + th));
	const dist = Math.hypot(px - cx, py - cy);
	const wMax = dist * 0.15;
	const rMax = dist - wMax / 2 - M * 0.03;
	const col = pickPlate(sc, colKind);
	const acc = accentOn(sc);
	for (let k = 0; k < n; k += 1) {
		const r = rMax * 1.5 ** (k - (n - 1));
		const w = wMax * 1.6 ** (k - (n - 1));
		const e = stg(env, n - 1 - k, 0.06, 0.8);
		const start = a0P + k * 53 + env.lt * (k % 2 ? -1 : 1) * (7 - k * 0.8) + (1 - e) * 90;
		const sw = (130 + 90 * randomUnit(seed, k, 51)) * e * (1 - 0.5 * env.pOut);
		arcS(env, cx, cy, r, start, start + sw, k === accIndex ? acc : col, w, out);
	}
	disc(env, cx, cy, rMax * 1.5 ** -(n - 1) * 0.3 * inE(env, 0.5), acc, out);
	const f = fitBox(txt, tw, th, 1.22, 0.03, 4);
	const size = Math.min(f.size, M * 0.2);
	const iy = ty0 + th / 2;
	const align: CanvasTextAlign = right ? "left" : "right";
	if (rule) {
		const m = measure(f.text, size, 1.22, 0.03);
		const yr = iy - m.h / 2 - size * 0.42;
		const e = inE(env, 0.5, 0.1);
		R(env, right ? tx : tx - M * 0.16 * e, yr - lw * 1.5, M * 0.16 * e, lw * 3, sc.fg, out);
		label(env, `No.${String(no).padStart(2, "0")}`, tx + (right ? 1 : -1) * M * 0.18, yr, { align: right ? "left" : "right", alpha: out * inC(env, 0.3, 0.25) });
	}
	mainDraw(env, { align, color: sc.fg, lead: 1.22, size, text: f.text, track: 0.03, x: tx, y: iy });
}

/** 段ピラミッド — a stepped pyramid of solid blocks; every step carries a line. */
function drawZiggurat(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc } = env;
	const inv = chanceOf(seed, 111, 0.35);
	const alt = chanceOf(seed, 112, 0.6);
	const colKind = pickOf(seed, 113, ["ink", "fg", "accent"] as const);
	const n = glyphCountOf(txt);
	const lines = linesOf(
		txt,
		port ? Math.min(4, Math.ceil(n / 4)) : n <= 6 ? 1 : n <= 12 ? 2 : 3,
	).split("\n");
	const L = lines.length;
	let size = Math.min(M * 0.21, (H * 0.66) / (L * 1.5 + 0.85), ...lines.map((line) => fitSize(line, W * 0.74, M, 1.3, 0.03)));
	interface Step {
		readonly h: number;
		readonly i: number;
		readonly k: "base" | "cap" | "line";
		readonly w: number;
	}
	const build = (sz: number): Step[] => {
		const inc = sz * 0.5;
		const tw = lines.map((line) => measure(line, sz, 1.3, 0.03).w + sz * 0.9);
		const w = tw.slice();
		if (!inv) {
			for (let i = 1; i < L; i += 1) w[i] = Math.max(w[i]!, w[i - 1]! + inc * 2);
		} else {
			for (let i = L - 2; i >= 0; i -= 1) w[i] = Math.max(w[i]!, w[i + 1]! + inc * 2);
		}
		const h = sz * 1.5;
		const nar = Math.min(...w);
		const wid = Math.max(...w);
		const cap: Step = { h: h * 0.42, i: -1, k: "cap", w: Math.max(sz * 0.7, nar - inc * 2.2) };
		const base: Step = { h: h * 0.28, i: -1, k: "base", w: wid + inc * 2 };
		const mid: Step[] = w.map((width, i) => ({ h, i, k: "line", w: width }));
		return inv ? [base, ...mid, cap] : [cap, ...mid, base];
	};
	let steps = build(size);
	const mw = Math.max(...steps.map((step) => step.w));
	if (mw > W * 0.92) {
		size *= (W * 0.92) / mw;
		steps = build(size);
	}
	const plate = pickPlate(sc, colKind);
	const p2 = mixOf(plate, sc.bg, 0.22);
	const acc = accentOn(sc) === plate ? sc.sub : accentOn(sc);
	let y = H / 2 - steps.reduce((sum, step) => sum + step.h, 0) / 2;
	steps.forEach((step, si) => {
		const ord = inv ? si : steps.length - 1 - si;
		const e = stg(env, ord, 0.07, 0.45);
		const col =
			step.k === "cap" ? acc : alt && step.k === "line" && step.i % 2 ? p2 : plate;
		R(env, W / 2 - (step.w / 2) * e, y, step.w * e, step.h + 0.6, col, out);
		if (step.k === "line") {
			mainDraw(env, {
				color: onCol(sc, col),
				size,
				text: lines[step.i] ?? "",
				track: 0.03,
				x: W / 2,
				y: y + step.h / 2,
			});
		}
		y += step.h;
	});
}

/** ハニカム — glyphs in the cells of a honeycomb with empty cells around. */
function drawHoneycomb(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const accIndex = intOf(seed, 121, 0, 30);
	const extra = chanceOf(seed, 122, 0.85);
	const colKind = pickOf(seed, 123, ["ink", "fg"] as const);
	const c0 = cellsOf(txt).length;
	const pr = padRows(rowCells(txt, port ? Math.ceil(c0 / 3) : c0 <= 5 ? 1 : c0 <= 10 ? 2 : 3));
	const sl = pr.flat;
	const n = sl.length;
	const rows = pr.rows;
	const per = pr.per;
	const wu = per + (rows > 1 ? 0.5 : 0);
	const r = Math.min(
		(W * 0.88) / (wu * 1.732),
		(H * 0.8) / ((rows - 1) * 1.5 + 2),
		M * 0.19,
	);
	const cw = r * 1.732;
	const X0 = (W - wu * cw) / 2;
	const Y0 = (H - ((rows - 1) * 1.5 + 2) * r) / 2 + r;
	// eslint-disable-next-line opencut/prefer-object-params
	const pos = (ri: number, c: number): Pt => [
		X0 + (c + 0.5 + (((ri % 2) + 2) % 2) * 0.5) * cw,
		Y0 + ri * 1.5 * r,
	];
	const plate = pickPlate(sc, colKind);
	const acc = accentOn(sc) === plate ? pickPlate(sc, "fg") : accentOn(sc);
	if (extra) {
		for (let ri = -1; ri <= rows; ri += 1) {
			for (let c = -1; c <= per; c += 1) {
				const used = ri >= 0 && ri < rows && c >= 0 && c < per && ri * per + c < n && !isSp(sl[ri * per + c] ?? " ");
				if (used || randomUnit(seed, ri + 3, c + 3, 61) < 0.35) continue;
				const [x, y] = pos(ri, c);
				const e = inE(env, 0.5, 0.1 + randomUnit(seed, ri + 3, c + 3, 62) * 0.3);
				if (x < r * 0.2 || x > W - r * 0.2 || y < r * 0.2 || y > H - r * 0.2) continue;
				loopLine(env, ngon(x, y, r * 0.9 * e, r * 0.9 * e, 6, -90), sc.sub, lw * 1.5, 0.55 * out * e);
			}
		}
	}
	let gi = 0;
	for (let i = 0; i < n; i += 1) {
		const cell = sl[i]!;
		if (isSp(cell)) continue;
		const ri = Math.floor(i / per);
		const c = i % per;
		const [x, y] = pos(ri, c);
		const p = oBack(clamp((env.lt - gi * 0.03) / 0.32), 1.4);
		const col = gi === accIndex % Math.max(1, n) ? acc : plate;
		if (p > 0) poly(env, ngon(x, y, r * 0.93 * p, r * 0.93 * p, 6, -90), col, out);
		mainDraw(env, {
			color: onCol(sc, col),
			size: Array.from(cell).length > 1 ? r * 0.72 : r * 1.02,
			text: cell,
			x,
			y,
		});
		gi += 1;
	}
}

/** 平行四辺形 — each line on its own slanted slab, stacked and offset. */
function drawShear(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc } = env;
	const k = pickOf(seed, 131, [0.26, 0.36, -0.26, -0.36] as const);
	const colsIndex = intOf(seed, 132, 0, 2);
	const stag = rangeOf(seed, 133, 0.025, 0.06);
	const n = glyphCountOf(txt);
	const lines = linesOf(
		txt,
		port ? Math.min(4, Math.ceil(n / 4)) : n <= 6 ? 1 : n <= 12 ? 2 : 3,
	).split("\n");
	const L = lines.length;
	const size = Math.min(
		M * 0.23,
		(H * 0.66) / (L * 1.5),
		...lines.map((line) => fitSize(line, W * (0.7 - (L > 1 ? stag * 2 : 0)), M, 1.3, 0.03)),
	);
	const h = size * 1.5;
	const m: readonly number[] = [1, 0, -k, 1, (k * H) / 2, 0];
	const cs = [pickPlate(sc, "ink"), accentOn(sc), pickPlate(sc, "fg")];
	for (let i = 0; i < L; i += 1) {
		const w = measure(lines[i]!, size, 1.3, 0.03).w + size * 1.3;
		const sd = i % 2 ? 1 : -1;
		const xc = W / 2 + (L > 1 ? sd * W * stag : 0);
		const yc = H / 2 + (i - (L - 1) / 2) * h;
		const e = stg(env, i, 0.07, 0.5);
		const col = cs[(i + colsIndex) % 3]!;
		withXf(env, m, () => {
			R(env, xc - w / 2 + (1 - e) * sd * W, yc - h / 2, w, h + 0.6, col, out);
			if (L === 1) {
				const a2 = cs[(colsIndex + 1) % 3]!;
				const e2 = stg(env, 2, 0.07, 0.5);
				R(env, xc + w * 0.02 - (1 - e2) * W, yc - h / 2 - h * 0.2, w * 0.48, h * 0.2 + 0.6, a2, out);
				R(env, xc - w / 2 + (1 - e2) * W, yc + h / 2, w * 0.36, h * 0.2, a2, out);
			}
		});
		withXf(env, m, () => {
			mainDraw(env, {
				color: onCol(sc, col),
				size,
				text: lines[i]!,
				track: 0.03,
				x: xc,
				y: yc,
			});
		});
	}
}

/** 図形タイル — a panel of modular tiles (quarter/half discs, triangles) turning. */
function drawPatternPanel(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc } = env;
	const kind = pickOf(seed, 141, ["quarter", "half", "tri", "mix"] as const);
	const side = pickOf(seed, 142, [0, 1] as const);
	const align = pickOf(seed, 143, ["c", "c", "e"] as const);
	const tile = port ? W / 5 : H / 5;
	const cols = port ? 5 : Math.max(2, Math.round((W * 0.31) / tile));
	const rows = port ? Math.max(2, Math.round((H * 0.3) / tile)) : 5;
	const pw = cols * tile;
	const ph = rows * tile;
	const px = port ? 0 : side ? W - pw : 0;
	const py = port ? (side ? H - ph : 0) : 0;
	const cFg = [accentOn(sc), pickPlate(sc, "fg"), pickPlate(sc, "accent2")];
	const cBg: ReadonlyArray<string | null> = [pickPlate(sc, "ink"), null, dimOf(sc)];
	const kinds = ["quarter", "half", "tri"] as const;
	for (let j = 0; j < rows; j += 1) {
		for (let i = 0; i < cols; i += 1) {
			const s = seed;
			const e = outCubic(clamp((env.lt - (i + j) * 0.035) / 0.35));
			if (e <= 0) continue;
			const kindOf = kind === "mix" ? kinds[x2Hash(s, i, j, 71) % 3]! : kind;
			let turn = x2Hash(s, i, j, 72) % 4;
			if (randomUnit(s, i, j, 73) < 0.55) {
				const period = 1.4 + randomUnit(s, i, j, 74) * 1.6;
				const u = env.lt / period + randomUnit(s, i, j, 75);
				turn += Math.floor(u) + inOutCubic(clamp((u - Math.floor(u)) / 0.3));
			}
			const bg = cBg[x2Hash(s, i, j, 76) % 3];
			let fg = cFg[x2Hash(s, i, j, 77) % 3]!;
			if (fg === bg) fg = sc.bg;
			const t = tile * e;
			const hf = t / 2;
			if (bg) R(env, px + i * tile, py + j * tile, t, t, bg, out);
			const cx = px + (i + 0.5) * tile;
			const cy = py + (j + 0.5) * tile;
			const rotate = (point: Pt): Pt => {
				const angle = degrees(turn * 90);
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				return [cx + point[0] * cos - point[1] * sin, cy + point[0] * sin + point[1] * cos];
			};
			let local: Pt[] = [];
			if (kindOf === "quarter") {
				local = [[-hf, -hf]];
				for (let step = 0; step <= 3; step += 1) {
					const angle = degrees(step * 30);
					local.push([-hf + Math.cos(angle) * t, -hf + Math.sin(angle) * t]);
				}
			} else if (kindOf === "half") {
				local = [[-hf, -hf]];
				for (let step = 0; step <= 4; step += 1) {
					const angle = degrees(step * 45);
					local.push([Math.cos(angle) * hf, -hf + Math.sin(angle) * hf]);
				}
			} else {
				local = [[-hf, -hf], [hf, -hf], [-hf, hf]];
			}
			poly(env, local.map(rotate), fg, out);
		}
	}
	const ax0 = port ? W * 0.06 : side ? W * 0.05 : pw + W * 0.045;
	const ax1 = port ? W * 0.94 : side ? W - pw - W * 0.045 : W * 0.95;
	const ay0 = port ? (side ? H * 0.06 : ph + H * 0.04) : H * 0.08;
	const ay1 = port ? (side ? H - ph - H * 0.04 : H * 0.94) : H * 0.92;
	const f = fitBox(txt, (ax1 - ax0) * 0.96, (ay1 - ay0) * 0.7, 1.2, 0.02, 4);
	const size = Math.min(f.size, M * 0.26);
	const edge = align === "e" && !port;
	const textAlign: CanvasTextAlign = edge ? (side ? "right" : "left") : "center";
	mainDraw(env, {
		align: textAlign,
		color: sc.fg,
		lead: 1.2,
		size,
		text: f.text,
		track: 0.02,
		x: edge ? (side ? ax1 : ax0) : (ax0 + ax1) / 2,
		y: (ay0 + ay1) / 2,
	});
}

/** 菱形組 — rows that swell and shrink into a diamond; a diamond plate holds them. */
function drawDiamond(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, seed, sc } = env;
	const style = pickOf(seed, 151, ["plate", "plate", "outline"] as const);
	const colKind = pickOf(seed, 152, ["ink", "accent", "fg"] as const);
	const spin = pickOf(seed, 153, [1, -1] as const);
	const shapeTable = W > H * 1.2 ? DIAW : DIA;
	const rows = shapeRows(txt, shapeTable, false) ?? fitBox(txt, W * 0.5, H * 0.36, 1.3, 0.04, 3).text.split("\n");
	const Rn = rows.length;
	const lead = 1.16;
	const hw = rows.map((row) => measure(row, 100, 1.3, 0.04).w / 2);
	const b0 = (Rn * 100 * lead) / 2 + 78;
	const a0 = Math.max(
		...hw.map((w, r) => w / (1 - (Math.abs(r - (Rn - 1) / 2) * 100 * lead + 44) / b0)),
	);
	const k = Math.min((W * 0.47) / a0, (H * 0.465) / b0, M * 0.0027);
	const size = 100 * k;
	const a = a0 * k;
	const b = b0 * k;
	const cx = W / 2;
	const cy = H / 2;
	const e = oBack(clamp(env.lt / 0.5), 1.2);
	const rot = (1 - inE(env, 0.6)) * 45 * spin;
	const m = rotM(cx, cy, rot);
	const dia = (s: number): Pt[] =>
		[
			[cx, cy - b * s],
			[cx + a * s, cy],
			[cx, cy + b * s],
			[cx - a * s, cy],
		].map((point) => xfPt(m, point[0], point[1]));
	const plate = pickPlate(sc, colKind);
	const solid = style === "plate";
	const acc = accentOn(sc);
	if (e > 0) {
		if (solid) poly(env, dia(e), plate, out);
		else loopLine(env, dia(e), sc.fg, lw * 3, out);
		const g = M * 0.03;
		loopLine(
			env,
			dia(e).map((point) => [
				cx + (point[0] - cx) * (1 + g / a),
				cy + (point[1] - cy) * (1 + g / b),
			]),
			solid ? plate : acc,
			lw * 2,
			out * 0.8,
		);
		const q = inE(env, 0.5, 0.25);
		for (const d of [a + g * 2.2, -a - g * 2.2]) {
			if (cx + d > g && cx + d < W - g) disc(env, cx + d, cy, M * 0.008 * q, acc, out);
		}
	}
	rows.forEach((row, i) => {
		mainDraw(env, {
			color: solid ? onCol(sc, plate) : sc.fg,
			size,
			text: row,
			track: 0.04,
			x: cx,
			y: cy + (i - (Rn - 1) / 2) * size * lead,
		});
	});
}

/** 図形レンズ — an outline lyric revealed solid through drifting shape lenses. */
function drawShapeLens(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, seed, sc } = env;
	const ord = intOf(seed, 161, 0, 5);
	const drift = rangeOf(seed, 162, 0.5, 1);
	const szK = rangeOf(seed, 163, 0.95, 1.2);
	const rot = rangeOf(seed, 164, -20, 20);
	const fb = fitBox(txt, W * 0.88, H * 0.54, 1.15, 0.02, 3);
	const size = Math.min(fb.size, M * 0.36);
	const lead = 1.15;
	const m = measure(fb.text, size, lead, 0.02);
	const t = env.lt;
	const item = { color: sc.fg, lead, size, text: fb.text, track: 0.02, x: W / 2, y: H / 2 };
	mainDrawOutline(env, item, Math.max(2.5, size * 0.03));
	const perm = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]][ord % 6]!;
	const cols = [accentOn(sc), pickPlate(sc, "ink"), pickPlate(sc, "accent2")];
	const fxs = [0.16, 0.5, 0.84];
	const radius = Math.min(
		Math.max(Math.max(m.h * 0.6, M * 0.15) * szK, M * 0.12),
		Math.min(M * 0.3, m.w * 0.3 + M * 0.06),
	);
	for (let i = 0; i < 3; i += 1) {
		const kind = perm[i]!;
		const p = oBack(clamp((env.lt - 0.05 - i * 0.07) / 0.45), 1.3) * (1 - inCubic(env.pOut));
		if (p <= 0.01) continue;
		const x = W / 2 + (fxs[i]! - 0.5) * m.w + Math.sin(t * 0.55 + i * 2.1) * M * 0.035 * drift;
		const y = H / 2 + (i % 2 ? 1 : -1) * m.h * 0.1 + Math.cos(t * 0.45 + i * 1.3) * M * 0.025 * drift;
		const r = radius * p;
		const pts =
			kind === 1
				? ngon(x, y + r * 0.12, r * 1.25, r * 1.25, 3, -90 + rot * 0.4 + t * 3)
				: kind === 2
					? rectPts(x, y, r * 1.7, r * 1.7, rot + t * 2)
					: null;
		const col = cols[i]!;
		if (pts) poly(env, pts, col, 1);
		else disc(env, x, y, r, col, 1);
		clipped(
			env,
			(ctx) => {
				if (pts) pathPoly(ctx, pts);
				else pathCirc(ctx, x, y, r);
			},
			() => {
				mainDraw(env, { ...item, color: onCol(sc, col) });
			},
		);
	}
}

/** 斜め構成 — everything hangs on one angle: bars, a wedge and a ring. */
function drawConstruct(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const ang = pickOf(seed, 171, [-16, -12, 12, 16] as const);
	const colKind = pickOf(seed, 172, ["ink", "fg", "accent"] as const);
	const wedge = chanceOf(seed, 173, 0.8);
	const circ = chanceOf(seed, 174, 0.65);
	const keyP = intOf(seed, 175, 0, 2);
	const n = glyphCountOf(txt);
	const lines = linesOf(
		txt,
		port ? Math.min(4, Math.ceil(n / 4)) : n <= 7 ? 1 : n <= 14 ? 2 : 3,
	).split("\n");
	const L = lines.length;
	const size = Math.min(
		M * 0.24,
		H * 0.5 / (L * 1.34),
		...lines.map((line) => fitSize(line, W * (port ? 0.76 : 0.7), M, 1.3, 0.02)),
	);
	const h = size * 1.34;
	const ws = lines.map((line) => measure(line, size, 1.3, 0.02).w);
	const mw = Math.max(...ws);
	const xL = W / 2 - mw / 2;
	const key = L > 1 ? keyP % L : 0;
	const plate = pickPlate(sc, colKind);
	const acc = accentOn(sc) === plate ? pickPlate(sc, "fg") : accentOn(sc);
	const yTop = H / 2 - (L * h) / 2;
	const yBot = H / 2 + (L * h) / 2;
	withXf(env, rotM(W / 2, H / 2, ang), () => {
		const e0 = inE(env, 0.5);
		const e1 = inE(env, 0.55, 0.1);
		const e2 = inE(env, 0.6, 0.18);
		R(env, xL - size * 0.62, H / 2 - H * 1.5 * e1, size * 0.16, H * 3 * e1, sc.fg, out);
		const kx1 = xL + ws[key]! + size * 0.4;
		R(env, -W, yTop + key * h + h * 0.02, (kx1 + W) * e0, h * 0.96, plate, out);
		if (wedge) {
			const ty = yBot + size * 0.3;
			const tx = xL + mw * 0.15 + (1 - e2) * W;
			poly(env, [[tx, ty + size * 0.12], [W * 1.6 + (1 - e2) * W, ty - size * 0.05], [W * 1.6 + (1 - e2) * W, ty + size * 1.5]], acc, out);
		}
		if (circ) {
			ringS(env, xL + mw + size * 0.2, yTop - size * 0.75, size * 0.55 * oBack(clamp((env.lt - 0.2) / 0.4), 1.5), sc.fg, lw * 5, out);
		}
		lines.forEach((line, i) => {
			mainDraw(env, {
				align: "left",
				color: i === key ? onCol(sc, plate) : sc.fg,
				size,
				text: line,
				track: 0.02,
				x: xL,
				y: yTop + (i + 0.5) * h,
			});
		});
	});
}

/** 黄金分割 — golden-ratio squares spiral away from the lyric's square. */
function drawGolden(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, lw, seed, sc } = env;
	const fhP = chanceOf(seed, 181, 0.5);
	const fvP = chanceOf(seed, 182, 0.5);
	const fill = pickOf(seed, 183, [1, 2, 3] as const);
	const spiral = chanceOf(seed, 184, 0.85);
	const Wc = env.port ? H : W;
	const Hc = env.port ? W : H;
	const PHI = 1.618034;
	const s0 = Math.min(Hc * 0.86, (Wc * 0.9) / PHI);
	const fh = fhP ? -1 : 1;
	const fv = fvP ? -1 : 1;
	const tx = fhP ? Wc : 0;
	const ty = fvP ? Hc : 0;
	const m: readonly number[] = env.port ? [0, fh, fv, 0, ty, tx] : [fh, 0, 0, fv, tx, ty];
	interface Square {
		readonly a: number;
		readonly cx: number;
		readonly cy: number;
		readonly s: number;
		readonly x: number;
		readonly y: number;
	}
	const sq: Square[] = [];
	let x = (Wc - s0 * PHI) / 2;
	let y = (Hc - s0) / 2;
	let w = s0 * PHI;
	let h = s0;
	for (let k = 0; k < 7; k += 1) {
		const d = k % 4;
		if (d === 0) {
			sq.push({ a: 180, cx: x + h, cy: y + h, s: h, x, y });
			x += h;
			w -= h;
		} else if (d === 1) {
			sq.push({ a: 270, cx: x, cy: y + w, s: w, x, y });
			y += w;
			h -= w;
		} else if (d === 2) {
			sq.push({ a: 0, cx: x + w - h, cy: y, s: h, x: x + w - h, y });
			w -= h;
		} else {
			sq.push({ a: 90, cx: x + w, cy: y + h - w, s: w, x, y: y + h - w });
			h -= w;
		}
	}
	const e = inE(env, 1.0);
	const acc = accentOn(sc);
	withXf(env, m, () => {
		sq.forEach((q, k) => {
			const a = env.out * clamp((env.lt - k * 0.06) / 0.25);
			if (a <= 0) return;
			if (k === fill) R(env, q.x, q.y, q.s, q.s, acc, a);
			else if (k === fill + 2) R(env, q.x, q.y, q.s, q.s, pickPlate(sc, "ink"), a);
			layoutADrawFrame({
				alpha: a * 0.75,
				color: sc.sub,
				ctx: env.ctx,
				height: q.s,
				left: q.x,
				thickness: lw * 1.5,
				top: q.y,
				width: q.s,
			});
		});
		if (spiral) {
			sq.forEach((q, k) => {
				const f = clamp(e * 7 - k);
				if (f > 0) arcS(env, q.cx, q.cy, q.s, q.a, q.a + 90 * f, sc.fg, lw * 2.5, env.out);
			});
		}
	});
	const c = xfPt(m, sq[0]!.x + s0 / 2, sq[0]!.y + s0 / 2);
	const f = fitBox(txt, s0 * 0.86, s0 * 0.6, 1.22, 0.03, 4);
	const size = Math.min(f.size, M * 0.24);
	mainDraw(env, { color: sc.fg, lead: 1.22, size, text: f.text, track: 0.03, x: c[0], y: c[1] });
}

/** ベン図 — two overlapping discs, one half of the lyric in each. */
function drawVenn(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const swap = chanceOf(seed, 191, 0.5);
	const second = pickOf(seed, 192, ["accent", "accent", "fg"] as const);
	const ol = chanceOf(seed, 193, 0.5);
	const l2 = linesOf(txt, 2).split("\n");
	const g2 = l2.map((line) => glyphCountOf(line));
	let parts = l2.length >= 2 ? [l2[0]!, l2.slice(1).join(isLatinText(txt) ? " " : "")] : [txt];
	if (!isLatinText(txt) && (l2.length !== 2 || Math.min(...g2) / Math.max(...g2, 1) < 0.3)) {
		const chars = Array.from(txt.replace(/\s+/gu, ""));
		let c = Math.round(chars.length / 2);
		while (c < chars.length - 1 && (closeP(chars[c] ?? "") || isSmallKana(chars[c] ?? "") || chars[c] === "ー")) c += 1;
		parts = c > 0 && c < chars.length ? [chars.slice(0, c).join(""), chars.slice(c).join("")] : [txt];
	}
	const two = parts.length === 2;
	const Rr = port ? Math.min(W * 0.42, H * 0.26) : Math.min(H * 0.42, W * 0.26);
	const d = Rr * 0.74;
	const cx = W / 2;
	const cy = H / 2;
	const c1: Pt = port ? [cx, cy - d] : [cx - d, cy];
	const c2: Pt = port ? [cx, cy + d] : [cx + d, cy];
	let colA = pickPlate(sc, "ink");
	let colB = pickPlate(sc, second);
	if (colA === colB) colB = pickPlate(sc, "fg");
	if (swap) {
		const t = colA;
		colA = colB;
		colB = t;
	}
	const e1 = oBack(clamp(env.lt / 0.5), 1.3);
	const e2 = oBack(clamp((env.lt - 0.1) / 0.5), 1.3);
	disc(env, c1[0], c1[1], Rr * e1, colA, out);
	if (two) {
		disc(env, c2[0], c2[1], Rr * e2, colB, out);
		const lens = mixOf(colA, colB, 0.5);
		if (e2 > 0) {
			clipped(env, (ctx) => pathCirc(ctx, c1[0], c1[1], Rr * e1), () => {
				disc(env, c2[0], c2[1], Rr * e2, contrastOf(lens, colA) > 1.15 ? lens : sc.bg, out);
			});
		}
	} else {
		ringS(env, c2[0], c2[1], Rr * e2, sc.fg, lw * 3, out);
	}
	if (ol) {
		ringS(env, c1[0], c1[1], Rr * e1 + M * 0.018, sc.sub, lw * 1.5, 0.6 * out);
		if (two) ringS(env, c2[0], c2[1], Rr * e2 + M * 0.018, sc.sub, lw * 1.5, 0.6 * out);
	}
	const lead = 1.18;
	const track = 0.02;
	const bw = Rr * 1.2;
	const bh = Rr * 1.0;
	const size = Math.min(M * 0.2, ...parts.map((p) => fitBox(p, bw, bh, lead, track, 3).size));
	const fs = parts.map((p) => {
		for (let lineCount = 1; lineCount <= 3; lineCount += 1) {
			const t = linesOf(p, lineCount);
			if (fitSize(t, bw, bh, lead, track) >= size * 0.995) return t;
		}
		return fitBox(p, bw, bh, lead, track, 3).text;
	});
	parts.forEach((part, i) => {
		const c = i ? c2 : c1;
		const sh = two ? Rr * 0.26 * (i ? 1 : -1) : 0;
		mainDraw(env, {
			color: onCol(sc, i ? colB : colA),
			lead,
			size,
			text: fs[i] ?? part,
			track,
			x: c[0] + (port ? 0 : sh),
			y: c[1] + (port ? sh : 0),
		});
	});
}

/** 割れ円 — a disc cut in two, the halves sliding apart around the lyric. */
function drawSlitDisc(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, seed, sc } = env;
	const dir = pickOf(seed, 201, [1, -1] as const);
	const colsIndex = intOf(seed, 202, 0, 2);
	const shift = rangeOf(seed, 203, 0.22, 0.5);
	const rule = chanceOf(seed, 204, 0.6);
	const lead = 1.15;
	const track = 0.03;
	const fb = fitBox(txt, W * 0.88, H * (port ? 0.22 : 0.3), lead, track, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.26);
	const m = measure(fb.text, size, lead, track);
	const gap = m.h + size * 0.5;
	const Rr = Math.max(M * 0.16, Math.min(M * 0.42, H * 0.47 - gap / 2, W * 0.36));
	const eR = inE(env, 0.4);
	const eG = inOutCubic(clamp((env.lt - 0.08) / 0.5)) * (1 - 0.6 * inCubic(env.pOut));
	const g = (gap / 2) * eG;
	const sh = Rr * shift * dir * eG;
	const cx = W / 2;
	const cy = H / 2;
	const pal: ReadonlyArray<readonly [string, string]> = [
		[accentOn(sc), pickPlate(sc, "ink")],
		[pickPlate(sc, "ink"), accentOn(sc)],
		[pickPlate(sc, "fg"), accentOn(sc)],
	];
	const [p0, p1] = pal[colsIndex % 3]!;
	sector(env, cx - sh, cy - g, 0, Rr * eR, 180, 360, p0, out);
	sector(env, cx + sh, cy + g, 0, Rr * eR, 0, 180, p1, out);
	if (rule) {
		const k = Rr * 1.35 * eG;
		Ln(env, cx - sh - k, cy - g, cx - sh + k, cy - g, sc.sub, lw * 1.5, 0.7 * out);
		Ln(env, cx + sh - k, cy + g, cx + sh + k, cy + g, sc.sub, lw * 1.5, 0.7 * out);
	}
	mainDraw(env, { color: sc.fg, lead, size, text: fb.text, track, x: W / 2, y: H / 2 });
}

/** 文字盤 — glyphs as dial numerals; a hand sweeps and lights each in turn. */
function drawDial(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, seed, sc } = env;
	const ticks = pickOf(seed, 211, [60, 48, 72] as const);
	const hub = chanceOf(seed, 212, 0.6);
	const inner = chanceOf(seed, 213, 0.6);
	const sl = slotsOf(txt);
	const N = sl.length;
	const cx = W / 2;
	const cy = H / 2;
	const gs = Math.min(M * 0.15, ((TAU * M * 0.33) / N) * 0.72);
	const Rg = M * 0.44 - gs * 0.82;
	const Ro = Rg + gs * 0.82;
	const e = inE(env, 0.7);
	const acc = accentOn(sc);
	ringS(env, cx, cy, Ro * (0.8 + 0.2 * e), sc.fg, lw * 2.5, out * e);
	if (inner) ringS(env, cx, cy, (Rg - gs * 0.8) * e, sc.sub, lw * 1.5, 0.6 * out);
	for (let i = 0; i < ticks * e; i += 1) {
		const a = degrees((i / ticks) * 360 - 90);
		const r1 = Ro + M * (i % (ticks / 12) ? 0.011 : 0.024);
		Ln(
			env,
			cx + Math.cos(a) * (Ro + M * 0.004),
			cy + Math.sin(a) * (Ro + M * 0.004),
			cx + Math.cos(a) * r1,
			cy + Math.sin(a) * r1,
			sc.sub,
			lw * 2,
			0.8 * out,
		);
	}
	const hold = Math.max(0.05, env.dur - env.inDur * 2);
	const pr = inOutSine(clamp((env.lt - env.inDur * 0.8) / hold));
	const pos = pr * (N - 1);
	const cur = Math.round(pos);
	const ha = degrees(-90 + (pos * 360) / N);
	const hl = (Rg - gs * 0.72) * e;
	const hw = M * 0.012;
	const ca = Math.cos(ha);
	const sa = Math.sin(ha);
	poly(env, [
		[cx - sa * hw - ca * hw * 2, cy + ca * hw - sa * hw * 2],
		[cx + ca * hl, cy + sa * hl],
		[cx + sa * hw - ca * hw * 2, cy - ca * hw - sa * hw * 2],
	], acc, out);
	disc(env, cx, cy, M * 0.022 * e, sc.fg, out);
	if (hub) ringS(env, cx, cy, M * 0.04 * e, sc.fg, lw * 2, out);
	poly(env, [
		[cx - M * 0.012, cy - Ro - M * 0.045],
		[cx + M * 0.012, cy - Ro - M * 0.045],
		[cx, cy - Ro - M * 0.027],
	], acc, out * e);
	sl.forEach((ch, i) => {
		if (isSp(ch)) return;
		const a = degrees(-90 + (i * 360) / N);
		mainDraw(env, {
			color: i === cur && env.lt > env.inDur ? acc : sc.fg,
			size: gs,
			text: ch,
			x: cx + Math.cos(a) * Rg,
			y: cy + Math.sin(a) * Rg,
		});
	});
}

/** 照準 — full-bleed hairlines crossing off-centre with rings, ticks and marks. */
function drawCrosshair(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const qx = pickOf(seed, 221, [0, 1] as const);
	const qy = pickOf(seed, 222, [0, 1] as const);
	const fr = rangeOf(seed, 223, 0.22, 0.3);
	const pulse = chanceOf(seed, 224, 0.75);
	const marks = chanceOf(seed, 225, 0.7);
	const fxr = port ? fr * 0.9 : fr;
	const fyr = port ? fr * 0.8 : fr * 1.05;
	const px = W * (qx ? 1 - fxr : fxr);
	const py = H * (qy ? 1 - fyr : fyr);
	const gp = M * 0.05;
	const x0 = qx ? W * 0.05 : px + gp;
	const x1 = qx ? px - gp : W * 0.95;
	const y0 = qy ? H * 0.06 : py + gp;
	const y1 = qy ? py - gp : H * 0.94;
	const e = inE(env, 0.7);
	const acc = accentOn(sc);
	Ln(env, px - px * e, py, px + (W - px) * e, py, sc.fg, lw * 2, 0.85 * out);
	Ln(env, px, py - py * e, px, py + (H - py) * e, sc.fg, lw * 2, 0.85 * out);
	const st = M * 0.04;
	const kx = Math.ceil(W / st);
	const ky = Math.ceil(H / st);
	for (let i = -kx; i <= kx; i += 1) {
		const x = px + i * st;
		if (!i || x < 0 || x > W || Math.abs(i) > kx * e) continue;
		const t = M * (i % 5 ? 0.007 : 0.016);
		Ln(env, x, py - t, x, py + t, sc.sub, lw * 1.5, 0.7 * out);
	}
	for (let i = -ky; i <= ky; i += 1) {
		const y = py + i * st;
		if (!i || y < 0 || y > H || Math.abs(i) > ky * e) continue;
		const t = M * (i % 5 ? 0.007 : 0.016);
		Ln(env, px - t, y, px + t, y, sc.sub, lw * 1.5, 0.7 * out);
	}
	ringS(env, px, py, M * 0.034 * e, sc.fg, lw * 2.5, out);
	ringS(env, px, py, M * 0.085 * e, acc, lw * 2, out);
	disc(env, px, py, M * 0.009 * e, acc, out);
	if (pulse) {
		const f = (env.lt * 0.55) % 1;
		ringS(env, px, py, M * (0.085 + 0.2 * f), acc, lw * 1.5, (1 - f) * 0.6 * out * e);
	}
	const sx = qx ? 1 : -1;
	const sy = qy ? 1 : -1;
	const la = out * inC(env, 0.3, 0.3);
	label(env, `X ${(px / W).toFixed(3)}`, px + sx * M * 0.11, py + sy * ls * 1.5, { align: qx ? "left" : "right", alpha: la });
	label(env, `Y ${(py / H).toFixed(3)}`, px + sx * M * 0.11, py + sy * ls * 3.1, { align: qx ? "left" : "right", alpha: la });
	const f = fitBox(txt, (x1 - x0) * 0.9, (y1 - y0) * 0.72, 1.2, 0.02, 4);
	const size = Math.min(f.size, M * 0.26);
	const ix = (x0 + x1) / 2;
	const iy = (y0 + y1) / 2;
	if (marks) {
		const m = measure(f.text, size, 1.2, 0.02);
		const bx = m.w / 2 + size * 0.35;
		const by = m.h / 2 + size * 0.3;
		const k = size * 0.32 * inE(env, 0.5, 0.2);
		for (const c of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		] as const) {
			polyLine(
				env,
				[
					[ix + c[0]! * bx, iy + c[1]! * (by - k)],
					[ix + c[0]! * bx, iy + c[1]! * by],
					[ix + c[0]! * (bx - k), iy + c[1]! * by],
				],
				acc,
				lw * 2.5,
				out,
			);
		}
	}
	mainDraw(env, { color: sc.fg, lead: 1.2, size, text: f.text, track: 0.02, x: ix, y: iy });
}

/** 縞の円 — a disc of bands thinning as they drift; the lyric fills the widest gap. */
function drawStripeDisc(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc, ctx } = env;
	const colKind = pickOf(seed, 231, ["accent", "accent", "ink", "fg"] as const);
	const pos = pickOf(seed, 232, [0.08, 0.18, 0.28] as const);
	const off = rangeOf(seed, 233, -0.06, 0.06);
	const bandCount = pickOf(seed, 234, [5, 6, 7] as const);
	const up = chanceOf(seed, 235, 0.25);
	const lead = 1.15;
	const track = 0.03;
	const fb = fitBox(txt, W * 0.88, H * (port ? 0.2 : 0.26), lead, track, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.24);
	const m = measure(fb.text, size, lead, track);
	const Rr = M * 0.43;
	const cx = W / 2 + off * W;
	const cy = H / 2;
	const dir = up ? -1 : 1;
	const ty = cy + dir * Rr * pos;
	const gh = m.h / 2 + size * 0.24;
	const e = inE(env, 0.6);
	const col = pickPlate(sc, colKind);
	const rr = Rr * e;
	if (rr > 0.5) {
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * out;
		ctx.fillStyle = col;
		const step = Math.max(1.5, rr / 60);
		// eslint-disable-next-line opencut/prefer-object-params
		const spans = (y0: number, y1: number): void => {
			const top = Math.max(y0, cy - rr);
			const bottom = Math.min(y1, cy + rr);
			for (let y = top; y <= bottom; y += step) {
				const halfWidth = rr * Math.sqrt(Math.max(0, 1 - ((y - cy) / rr) ** 2));
				if (halfWidth > 0.1) {
					ctx.fillRect(cx - halfWidth, y - step / 2, halfWidth * 2, step + 0.65);
				}
			}
		};
		if (dir > 0) {
			spans(cy - rr, ty - gh);
		} else {
			spans(ty + gh, cy + rr);
		}
		const ya = dir > 0 ? ty + gh : ty - gh;
		const len = dir > 0 ? cy + rr - ya : ya - (cy - rr);
		const ph = (env.lt * 0.22) % 1;
		if (len > 2) {
			for (let k = 0; k < bandCount; k += 1) {
				const u = (k + ph) / bandCount;
				const bandH = (len / bandCount) * (0.78 * (1 - u) + 0.06) * clamp(u * bandCount);
				const offset = u * len + (len / bandCount) * 0.2;
				spans(dir > 0 ? ya + offset : ya - offset - bandH, dir > 0 ? ya + offset + bandH : ya - offset);
			}
		}
		ctx.globalAlpha = base;
	}
	mainDraw(env, { color: sc.fg, lead, size, text: fb.text, track, x: W / 2, y: ty });
}

/** くさび — a long thin wedge opens from one side; the lines ride its edges. */
function drawWedge(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, ls, no, seed, sc } = env;
	const dir = pickOf(seed, 241, [1, -1] as const);
	const th = pickOf(seed, 242, [4.5, 6, 7.5] as const);
	const colKind = pickOf(seed, 243, ["accent", "accent", "ink"] as const);
	const dot = chanceOf(seed, 244, 0.7);
	const n = glyphCountOf(txt);
	const lines = linesOf(txt, (port ? n <= 3 : n <= 5) ? 1 : 2).split("\n");
	if (lines.length > 2) {
		lines[1] = lines.slice(1).join("");
		lines.length = 2;
	}
	const L2 = lines.length > 1;
	const thRad = degrees(th);
	const c = Math.cos(thRad);
	const s = Math.sin(thRad);
	const d = dir;
	const Lw = W * 0.86;
	const ax = d > 0 ? W * 0.07 : W * 0.93;
	const ay = H / 2;
	const size = Math.min(M * 0.2, H * 0.2, ...lines.map((line) => fitSize(line, Lw * 0.8, M, 1.3, 0.03)));
	const e = inE(env, 0.6) * (1 - inCubic(env.pOut));
	const col = pickPlate(sc, colKind);
	const far = (Lw / c) * e;
	if (e > 0.001) {
		poly(env, [[ax, ay], [ax + d * c * far, ay - s * far], [ax + d * c * far, ay + s * far]], col, 1);
	}
	if (dot) disc(env, ax - d * M * 0.022, ay, M * 0.009 * inE(env, 0.4, 0.2), sc.fg, out);
	const t = (Lw * 0.55) / c;
	lines.forEach((line, i) => {
		const sg = i ? 1 : -1;
		const ex = ax + d * c * t;
		const ey = ay + sg * s * t;
		const nx = -s * d;
		const ny = sg * c;
		const offset = size * 0.64;
		mainDraw(env, {
			color: sc.fg,
			rot: sg * d * th,
			size,
			text: line,
			track: 0.03,
			x: ex + nx * offset,
			y: ey + ny * offset,
		});
	});
	if (!L2) {
		const ex = ax + d * c * t;
		const ey = ay + s * t + c * ls * 1.6;
		label(env, `No.${String(no).padStart(2, "0")}  ${th.toFixed(1)}°`, ex, ey, { align: "center", alpha: out * inC(env, 0.3, 0.3), rot: d * th });
	}
}

/** 漸増ストライプ — full-bleed bars growing step by step; one bar is the lyric. */
function drawGradBars(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, seed, sc } = env;
	const flip = chanceOf(seed, 251, 0.5);
	const colKind = pickOf(seed, 252, ["fg", "ink", "accent"] as const);
	const accIndex = intOf(seed, 253, 0, 4);
	const align = pickOf(seed, 254, ["left", "left", "center", "right"] as const);
	const lead = 1.15;
	const track = 0.03;
	const fb = fitBox(txt, W * 0.88, H * (port ? 0.24 : 0.3), lead, track, port ? 3 : 2);
	const size = Math.min(fb.size, M * 0.24);
	const ix = align === "left" ? W * 0.06 : align === "right" ? W * 0.94 : W / 2;
	const ty = H / 2 + (flip ? -1 : 1) * H * 0.12;
	const m = measure(fb.text, size, lead, track);
	const col = pickPlate(sc, colKind);
	const acc = accentOn(sc) === col ? pickPlate(sc, "fg") : accentOn(sc);
	const t0 = Math.min(size * 0.4, M * 0.07);
	const sg = flip ? -1 : 1;
	let y = ty - sg * (m.h / 2 + size * 0.32);
	for (let k = 0; k < 9; k += 1) {
		const th = t0 * 0.68 ** k;
		if (th < 1.2) break;
		const e = stg(env, k, 0.045, 0.5);
		const yy = sg > 0 ? y - th : y;
		if (yy > H || yy + th < 0) break;
		R(env, k % 2 ? W * (1 - e) : 0, yy, W * e, th, k === accIndex ? acc : col, out);
		y -= sg * th * 2;
	}
	y = ty + sg * (m.h / 2 + size * 0.32);
	for (let j = 0; j < 4; j += 1) {
		const th = t0 * 1.6 ** (j + 1);
		const e = stg(env, j + 1, 0.06, 0.5);
		const yy = sg > 0 ? y : y - th;
		if (yy > H || yy + th < 0) break;
		R(env, j % 2 ? 0 : W * (1 - e), yy, W * e, th, col, out);
		y += sg * (th + t0 * 0.6 * 1.3 ** j);
	}
	mainDraw(env, { align, color: sc.fg, lead, size, text: fb.text, track, x: ix, y: ty });
}

/** 折れ線グラフ — each glyph a data-point label over a rising or falling polyline. */
function drawGraph(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const trend = pickOf(seed, 261, [1, 1, -1, 0] as const);
	const amp = rangeOf(seed, 262, 0.5, 1);
	const area = chanceOf(seed, 263, 0.5);
	const drop = chanceOf(seed, 264, 0.7);
	const N0 = cellsOf(txt).length;
	const pr = padRows(rowCells(txt, port ? (N0 > 10 ? 3 : N0 > 5 ? 2 : 1) : N0 > 9 ? 2 : 1));
	const cells = pr.flat;
	const RN = pr.rows;
	const per = pr.per;
	const x0 = W * 0.09;
	const x1 = W * 0.94;
	const RH = Math.min((H * 0.84) / RN, M * 0.62);
	const top = H / 2 - (RH * RN) / 2;
	const cw = (x1 - x0) / per;
	const gs = Math.min(M * 0.2, cw * 0.84, RH * 0.33);
	const acc = accentOn(sc);
	const e = inE(env, 0.9);
	let lab = 0;
	for (let r = 0; r < RN; r += 1) {
		const yb = top + r * RH + RH * 0.9;
		const row = cells.slice(r * per, (r + 1) * per);
		const pts: Array<readonly [number, number, string, number]> = [];
		Ln(env, x0, yb, x0 + (x1 - x0) * e, yb, sc.fg, lw * 2.5, out);
		Ln(env, x0, yb, x0, yb - RH * 0.82 * e, sc.fg, lw * 2.5, out);
		poly(env, [[x1 + M * 0.014, yb], [x1, yb - M * 0.008], [x1, yb + M * 0.008]], sc.fg, out * clamp(e * 4 - 3));
		row.forEach((ch, c) => {
			if (isSp(ch)) return;
			const i = r * per + c;
			const x = x0 + (c + 0.6) * cw;
			const u = per > 1 ? c / (per - 1) : 0.5;
			const v =
				(trend > 0 ? u : trend < 0 ? 1 - u : 0.5) * 0.62 +
				0.38 * randomUnit(seed, i, 81) * amp;
			const y = yb - RH * (0.1 + 0.36 * v);
			Ln(env, x, yb, x, yb + M * 0.012, sc.fg, lw * 2, out * e);
			lab += 1;
			label(env, String(lab).padStart(2, "0"), x, yb + M * 0.012 + ls * 0.9, { align: "center", alpha: 0.8 * out * clamp((env.lt - 0.1 - c * 0.03) / 0.2), size: ls * 0.85 });
			pts.push([x, y, ch, i]);
		});
		if (area && pts.length > 1) {
			const k = Math.max(2, Math.ceil(pts.length * e));
			poly(
				env,
				[
					[pts[0]![0], yb],
					...pts.slice(0, k).map((p) => [p[0], p[1]] as Pt),
					[pts[k - 1]![0], yb],
				],
				acc,
				0.16 * out,
			);
		}
		polyPartial(env, pts.map((p): Pt => [p[0], p[1]]), e, acc, lw * 3.5, out);
		pts.forEach((p, j) => {
			const a = clamp(e * pts.length - j) * 2;
			if (drop) Ln(env, p[0], p[1], p[0], yb, sc.sub, lw * 1.2, 0.5 * out * a);
			disc(env, p[0], p[1], gs * 0.085 * a, sc.fg, out);
			disc(env, p[0], p[1], gs * 0.045 * a, sc.bg, out);
			mainDraw(env, {
				color: sc.fg,
				size: Array.from(p[2]).length > 1 ? gs * 0.74 : gs,
				text: p[2],
				x: p[0],
				y: p[1] - gs * 0.78,
			});
		});
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

/** 円グラフ — a pie whose slices are the lyric lines, with leaders to each. */
function drawPie(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, port, txt, out, lw, ls, seed, sc } = env;
	const a0 = rangeOf(seed, 271, -150, -60);
	const side = pickOf(seed, 272, [0, 1] as const);
	const rest = rangeOf(seed, 273, 0.14, 0.3);
	const ex = intOf(seed, 274, 0, 3);
	const hole = chanceOf(seed, 275, 0.3);
	const Rp = port ? Math.min(W * 0.3, H * 0.15) : Math.min(H * 0.3, W * 0.15);
	const pcx = port ? W / 2 : side ? W * 0.95 - Rp * 1.2 : W * 0.05 + Rp * 1.2;
	const pcy = port ? (side ? H * 0.94 - Rp * 1.15 : H * 0.06 + Rp * 1.15) : H / 2;
	const zx0 = port ? W * 0.08 : side ? W * 0.06 : pcx + Rp * 1.45;
	const zx1 = port ? W * 0.94 : side ? pcx - Rp * 1.45 : W * 0.94;
	const zy0 = port ? (side ? H * 0.08 : pcy + Rp * 1.4) : H * 0.14;
	const zy1 = port ? (side ? pcy - Rp * 1.4 : H * 0.92) : H * 0.86;
	const fb = fitBox(txt, (zx1 - zx0) * 0.84, (zy1 - zy0) * 0.82, 1.5, 0.03, 4);
	const lines = fb.text.split("\n");
	const L = lines.length;
	const size = Math.min(M * 0.2, fb.size);
	const chip = size * 0.3;
	const pitch = Math.min(size * 1.5, (zy1 - zy0) / L);
	const mw = Math.max(...lines.map((line) => measure(line, size, 1.3, 0.03).w));
	const bx = (zx0 + zx1) / 2 - (mw + chip + size * 0.35) / 2;
	const tx = bx + chip + size * 0.35;
	const cyT = (zy0 + zy1) / 2;
	const cnt = lines.map((line) => Math.max(1, glyphCountOf(line)));
	const tot = cnt.reduce((sum, value) => sum + value, 0) / (1 - rest);
	const c1 = accentOn(sc);
	const c2 = pickPlate(sc, "ink");
	let c3 = pickPlate(sc, "accent2");
	if (c3 === c1 || c3 === c2) c3 = pickPlate(sc, "fg");
	const cols = [c1, c2, c3, sc.sub];
	const e = inE(env, 0.9);
	const lim = a0 + 360 * e;
	let a = a0;
	for (let i = 0; i <= L; i += 1) {
		const sp = ((i < L ? cnt[i]! : tot - cnt.reduce((x, y) => x + y, 0)) / tot) * 360;
		const a1 = Math.min(a + sp, lim);
		const mid = degrees(a + sp / 2);
		const col = i < L ? cols[i % 4]! : dimOf(sc);
		const exo = i < L && i === ex % L ? Rp * 0.09 : 0;
		const ox = Math.cos(mid) * exo;
		const oy = Math.sin(mid) * exo;
		sector(env, pcx + ox, pcy + oy, hole ? Rp * 0.42 : 0, Rp, a + 0.6, a1 - 0.6, col, out);
		if (i < L) {
			const y = cyT + (i - (L - 1) / 2) * pitch;
			const el = inE(env, 0.5, 0.25 + i * 0.08);
			const p0: Pt = [pcx + ox + Math.cos(mid) * Rp * 0.72, pcy + oy + Math.sin(mid) * Rp * 0.72];
			const p1: Pt = [pcx + ox + Math.cos(mid) * Rp * 1.14, pcy + oy + Math.sin(mid) * Rp * 1.14];
			const p2: Pt = [bx - size * 0.18, y];
			if (Math.cos(mid) * (p2[0] - pcx) + Math.sin(mid) * (p2[1] - pcy) > Rp * 0.3) {
				polyPartial(env, [p0, p1, p2], el, sc.sub, lw * 1.6, 0.8 * out);
			}
			disc(env, p0[0], p0[1], M * 0.006 * el, onCol(sc, col), out);
			R(env, bx, y - chip / 2, chip * el, chip, col, out);
			label(env, `${Math.round((cnt[i]! / tot) * 100)}%`, p1[0] + (Math.cos(mid) >= 0 ? ls * 0.4 : -ls * 0.4), p1[1] - ls * 0.9, {
				align: Math.cos(mid) >= 0 ? "left" : "right",
				alpha: out * clamp((env.lt - 0.5 - i * 0.08) / 0.2),
				size: ls * 0.9,
			});
			mainDraw(env, { align: "left", color: sc.fg, size, text: lines[i] ?? "", track: 0.03, x: tx, y });
		}
		a += sp;
	}
}

/** 円形組 — every line sized to its chord, so the block of type becomes a disc. */
function drawCircleFit(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, seed, sc } = env;
	const style = pickOf(seed, 281, ["plate", "plate", "ring"] as const);
	const colKind = pickOf(seed, 282, ["ink", "accent", "fg"] as const);
	const orb = chanceOf(seed, 283, 0.6);
	const n = glyphCountOf(txt);
	const lines = linesOf(txt, n <= 3 ? 1 : n <= 7 ? 2 : n <= 12 ? 3 : 4).split("\n");
	const L = lines.length;
	const Rr = M * 0.44;
	const Ri = Rr * 0.9;
	const ld = 1.1;
	const u = lines.map((line) => Math.max(0.2, measure(line, 100, 1.3, 0.02).w / 100));
	let sz = lines.map(() => (Ri * 1.5) / L);
	let ys: number[] = [];
	const relayout = (): void => {
		const tot = sz.reduce((sum, value) => sum + value * ld, 0);
		let y = -tot / 2;
		ys = [];
		for (const s of sz) {
			ys.push(y + (s * ld) / 2);
			y += s * ld;
		}
	};
	for (let k = 0; k < 14; k += 1) {
		relayout();
		sz = sz.map((s, i) => {
			const far = Math.abs(ys[i] ?? 0) + s * 0.46;
			const chord = 2 * Math.sqrt(Math.max(Ri * Ri * 0.01, Ri * Ri - far * far));
			return s * 0.45 + 0.55 * Math.min(Ri * 0.95, (chord * 0.95) / (u[i] ?? 1));
		});
	}
	relayout();
	sz = sz.map((s, i) => {
		const far = Math.abs(ys[i] ?? 0) + s * 0.46;
		const chord = 2 * Math.sqrt(Math.max(Ri * Ri * 0.01, Ri * Ri - far * far));
		return Math.min(s, (chord * 0.97) / (u[i] ?? 1));
	});
	relayout();
	const cx = W / 2;
	const cy = H / 2;
	const e = oBack(clamp(env.lt / 0.5), 1.2);
	const plate = pickPlate(sc, colKind);
	const solid = style === "plate";
	const acc = accentOn(sc);
	if (solid) disc(env, cx, cy, Rr * e, plate, out);
	else ringS(env, cx, cy, Rr * e, sc.fg, lw * 4, out);
	ringS(env, cx, cy, (Rr + M * 0.022) * e, solid ? plate : acc, lw * 1.6, 0.7 * out);
	if (orb) {
		const a = env.lt * 0.5 - 1.2;
		disc(env, cx + Math.cos(a) * (Rr + M * 0.022), cy + Math.sin(a) * (Rr + M * 0.022), M * 0.011 * e, acc === plate ? sc.fg : acc, out);
	}
	lines.forEach((line, i) => {
		mainDraw(env, {
			color: solid ? onCol(sc, plate) : sc.fg,
			size: sz[i] ?? 0,
			text: line,
			track: 0.02,
			x: cx,
			y: cy + (ys[i] ?? 0),
		});
	});
}

/** 三角組 — rows of one, two, three… glyphs build a triangle of type on a plate. */
function drawTriangleSet(options: TypographyLayoutOptions): void {
	const env = baseOf(options);
	const { W, H, M, txt, out, lw, seed, sc } = env;
	const inv = chanceOf(seed, 291, 0.4);
	const style = pickOf(seed, 292, ["plate", "plate", "outline"] as const);
	const colKind = pickOf(seed, 293, ["ink", "accent", "fg"] as const);
	const fallbackRows = (): string[] =>
		linesOf(txt, txt.split(/\s+/u).length >= 3 ? 3 : 2).split("\n");
	const rows = shapeRows(txt, TRI, inv) ?? fallbackRows();
	const Rn = rows.length;
	const ld = 116;
	const sg = inv ? -1 : 1;
	const hw = rows.map((row) => measure(row, 100, 1.3, 0.04).w / 2);
	const yr = (i: number): number => ((inv ? Rn - 1 - i : i) - (Rn - 1) / 2) * ld;
	const yB = (Rn * ld) / 2 + 26;
	let yA = 0;
	let Ht = 1;
	let hb = 1;
	let k = 0;
	for (const A of [92, 140, 200, 270, 350]) {
		const ya = -((Rn * ld) / 2) - A;
		const ht = yB - ya;
		const h2 = Math.max(...hw.map((w, i) => ((w + 24) * ht) / (yr(i) - 46 - ya)));
		const kk = Math.min((W * 0.465) / h2, (H * 0.9) / ht, M * 0.0026);
		if (kk > k * 1.03) {
			k = kk;
			yA = ya;
			Ht = ht;
			hb = h2;
		}
	}
	const size = 100 * k;
	const cx = W / 2;
	const mid = (yA + yB) / 2;
	const Y = (y: number): number => H / 2 + sg * (y - mid) * k;
	const e = oBack(clamp(env.lt / 0.5), 1.15);
	const plate = pickPlate(sc, colKind);
	const solid = style === "plate";
	const acc = accentOn(sc);
	// eslint-disable-next-line opencut/prefer-object-params
	const tri = (s: number, g: number): Pt[] => [
		[cx, Y(mid) + sg * ((yA - mid) * k - g * 2) * s],
		[cx + (hb * k + g * 1.8) * s, Y(mid) + sg * ((yB - mid) * k + g) * s],
		[cx - (hb * k + g * 1.8) * s, Y(mid) + sg * ((yB - mid) * k + g) * s],
	];
	if (e > 0) {
		if (solid) poly(env, tri(e, 0), plate, out);
		else loopLine(env, tri(e, 0), sc.fg, lw * 3, out);
		const g = Math.min(M * 0.022, (H * 0.96 - Ht * k) / 6);
		if (g > 2) loopLine(env, tri(e, g), solid ? plate : acc, lw * 2, 0.8 * out);
	}
	rows.forEach((row, i) => {
		mainDraw(env, {
			color: solid ? onCol(sc, plate) : sc.fg,
			size,
			text: row,
			track: 0.04,
			x: cx,
			y: Y(yr(i)),
		});
	});
}
