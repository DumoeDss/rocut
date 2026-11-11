import {
	backgroundFade,
	type BgcamBackgroundDraw,
} from "./bgcam-background-utils";
import { coreDecorTextBounds } from "./core-decor-geometry";
import {
	coreDecorPlan,
	decorInOut,
	localSeconds,
	randomSigned,
	randomUnit,
} from "./core-decor-timing";
import type { CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import {
	estimatedTextWidth,
	layoutGlyphs,
	layoutUnit,
} from "./core-layout-utils";
import {
	layoutCDrawVerticalGlyphs,
	layoutCUnits,
} from "./layouts-c-utils";
import {
	clamp01,
	degrees,
	inOutCubic,
	lerp,
	mixHex,
	outCubic,
	randomUnit as ru,
	smoothNoise,
} from "./exit-hold-geometry";
import type { TypographyLayoutOptions } from "./typography-layout-types";
import type { MotionTextCanvasContext } from "./types";

/**
 * JIZURA 追加分2 和風 pack "x2waA": 15 paper-craft layouts, 10 decors and 6
 * backgrounds built on traditional Japanese objects and patterns.
 *
 * Transliteration notes (same simplifications as the other x2 ports): single
 * palette (fg/ac/sub/bg stand in for ink/accent2/dim), no per-item fonts (the
 * resolved cut font draws), `ltb` collapses to local seconds, and radial
 * gradients are approximated by stepped discs because the canvas contract has
 * no gradient ops.
 */

const PI = Math.PI;
const TAU = PI * 2;
const TICKS = 120_000;
const KNUM = "〇一二三四五六七八九";

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's cl(v, lo, hi).
function clampRange(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress: clamp01(progress) });
}

// eslint-disable-next-line opencut/prefer-object-params
function mix(from: string, to: string, progress: number): string {
	return mixHex({ from, to, progress });
}

function inCubic(value: number): number {
	return clamp01(value) ** 3;
}

function oExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

// eslint-disable-next-line opencut/prefer-object-params
function inE(t: number, d = 0.4, delay = 0): number {
	return oExpo((t - delay) / d);
}

// eslint-disable-next-line opencut/prefer-object-params
function inC(t: number, d = 0.35, delay = 0): number {
	return outCubic((t - delay) / d);
}

// eslint-disable-next-line opencut/prefer-object-params
function oBack(value: number, overshoot = 1.70158): number {
	const progress = clamp01(value) - 1;
	return 1 + (overshoot + 1) * progress ** 3 + overshoot * progress ** 2;
}

// eslint-disable-next-line opencut/prefer-object-params
function inB(t: number, d = 0.4, delay = 0, s = 1.4): number {
	const k = clamp01((t - delay) / d);
	return k <= 0 ? 0 : k >= 1 ? 1 : oBack(k, s);
}

// eslint-disable-next-line opencut/prefer-object-params
function wrap(value: number, modulus: number): number {
	return ((value % modulus) + modulus) % modulus;
}

function kanjiNum(value: number): string {
	const n = Math.max(0, value | 0);
	if (n < 10) return KNUM[n] ?? "〇";
	if (n < 20) return `十${n % 10 ? (KNUM[n % 10] ?? "") : ""}`;
	if (n < 100) {
		return `${KNUM[Math.floor(n / 10)] ?? ""}十${
			n % 10 ? (KNUM[n % 10] ?? "") : ""
		}`;
	}
	return String(n);
}

function hasLatin(text: string): boolean {
	return /[A-Za-z]/u.test(text);
}

/* ---------------------------------------------------------------- shapes */

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

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's arc-point builder.
function arcPoints(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	a0: number,
	a1: number,
	n = 20,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index <= n; index += 1) {
		const angle = lerpN(a0, a1, index / n) * degrees(1);
		points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
	}
	return points;
}

/** Canvas moved / scaled / rotated around a point (JIZURA `pose`). */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's pose(env, cx, cy, t, fn) call shape.
function pose(
	ctx: MotionTextCanvasContext,
	cx: number,
	cy: number,
	transform: { readonly dx?: number; readonly dy?: number; readonly rot?: number; readonly s?: number },
	draw: () => void,
): void {
	ctx.save();
	ctx.translate(cx + (transform.dx ?? 0), cy + (transform.dy ?? 0));
	if (transform.rot) ctx.rotate(transform.rot * degrees(1));
	if (transform.s != null) {
		ctx.scale(Math.max(0.001, transform.s), Math.max(0.001, transform.s));
	}
	ctx.translate(-cx, -cy);
	draw();
	ctx.restore();
}

/* ------------------------------------------------------- layout plumbing */

interface WaLayoutBase {
	readonly W: number;
	readonly H: number;
	readonly M: number;
	readonly lw: number;
	readonly no: number;
	readonly out: number;
	readonly port: boolean;
	readonly seed: number;
	readonly t: number;
	readonly txt: string;
}

function waLayoutBase(options: TypographyLayoutOptions): WaLayoutBase {
	const { frame, height, width } = options;
	const seed = frame.cut?.seed ?? 0;
	return {
		H: height,
		M: Math.min(width, height),
		W: width,
		lw: Math.max(1, Math.min(width, height) * 0.0016),
		no: (Math.abs(seed) % 9) + 1,
		out: frame.exitProgress,
		port: height > width * 1.08,
		seed,
		t: frame.localTime / TICKS,
		txt: (frame.cut?.text ?? "").trim() || "MOTION TEXT",
	};
}

function waLabel({
	align,
	alpha,
	color,
	options,
	size,
	text,
	x,
	y,
}: {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color: string;
	readonly options: TypographyLayoutOptions;
	readonly size: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.globalAlpha = baseAlpha * clamp(alpha ?? 1);
	ctx.fillStyle = color;
	ctx.textAlign = align ?? "center";
	options.setFontSize(Math.max(8, size));
	options.drawText({
		maxWidth: Math.max(8, size) * 8,
		size: Math.max(8, size),
		text,
		x,
		y,
	});
	ctx.globalAlpha = baseAlpha;
}

function waFitSize({
	boxHeight,
	boxWidth,
	lineGap = 1.2,
	lines,
}: {
	readonly boxHeight: number;
	readonly boxWidth: number;
	readonly lineGap?: number;
	readonly lines: readonly string[];
}): number {
	let size = boxHeight / Math.max(1, lines.length * lineGap);
	for (const line of lines) {
		const unitWidth = estimatedTextWidth({ size: 1, text: line });
		if (unitWidth > 0) size = Math.min(size, boxWidth / unitWidth);
	}
	return Math.max(10, size);
}

function waFitVertical({
	boxHeight,
	boxWidth,
	columns,
}: {
	readonly boxHeight: number;
	readonly boxWidth: number;
	readonly columns: readonly string[];
}): number {
	let size = boxWidth / Math.max(1, columns.length * 1.5);
	for (const column of columns) {
		const count = Math.max(1, layoutGlyphs(column).length);
		size = Math.min(size, boxHeight / (count * 1.06));
	}
	return Math.max(10, size);
}

function waDrawLines({
	color,
	lines,
	maxWidth,
	options,
	size,
	x,
	y,
}: {
	readonly color: string;
	readonly lines: readonly string[];
	readonly maxWidth: number;
	readonly options: TypographyLayoutOptions;
	readonly size: number;
	readonly x: number;
	readonly y: number;
}): void {
	const { ctx } = options;
	ctx.fillStyle = color;
	ctx.textAlign = "center";
	options.setFontSize(size);
	lines.forEach((line, index) => {
		options.drawText({
			maxWidth,
			size,
			text: line,
			x,
			y: y + (index - (lines.length - 1) / 2) * size * 1.2,
		});
	});
}

/* shikishi-style column split of the cut text */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's toLines(t, L) split shape.
function waColumns(text: string, count: number): string[] {
	const glyphs = layoutGlyphs(text);
	const actual = Math.min(count, glyphs.length);
	if (actual <= 1) return [text];
	return layoutCUnits({ count: actual, text });
}

const WA_LAYOUTS = new Set([
	"wzAndon",
	"wzBanzuke",
	"wzByobu",
	"wzChikkan",
	"wzFurin",
	"wzGenjiGumo",
	"wzNobori",
	"wzNoshi",
	"wzSenjafuda",
	"wzShikishi",
	"wzShogi",
	"wzSudare",
	"wzTenugui",
	"wzTorii",
	"wzUchiwa",
]);

export function drawX2WaLayout(options: TypographyLayoutOptions): boolean {
	const layout = options.frame.cut?.preset.layout;
	if (!layout || !WA_LAYOUTS.has(layout)) return false;
	switch (layout) {
		case "wzAndon":
			drawWzAndon(options);
			break;
		case "wzBanzuke":
			drawWzBanzuke(options);
			break;
		case "wzByobu":
			drawWzByobu(options);
			break;
		case "wzChikkan":
			drawWzChikkan(options);
			break;
		case "wzFurin":
			drawWzFurin(options);
			break;
		case "wzGenjiGumo":
			drawWzGenjiGumo(options);
			break;
		case "wzNobori":
			drawWzNobori(options);
			break;
		case "wzNoshi":
			drawWzNoshi(options);
			break;
		case "wzSenjafuda":
			drawWzSenjafuda(options);
			break;
		case "wzShikishi":
			drawWzShikishi(options);
			break;
		case "wzShogi":
			drawWzShogi(options);
			break;
		case "wzSudare":
			drawWzSudare(options);
			break;
		case "wzTenugui":
			drawWzTenugui(options);
			break;
		case "wzTorii":
			drawWzTorii(options);
			break;
		case "wzUchiwa":
			drawWzUchiwa(options);
			break;
	}
	return true;
}

/* ================================================================== LAYOUTS */

/** 屏風 — a zigzag folding screen that unfolds from the middle; the line runs across all panels. */
function drawWzByobu(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const n = port ? 4 : 6;
	const sw = W * (port ? 0.92 : 0.86);
	const sh = H * (port ? 0.44 : 0.6);
	const cx = W / 2;
	const cy = H / 2;
	const look = ["gold", "plain", "hills"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "plain";
	const sun = layoutUnit(seed, 2) < 0.5;
	const paper = frame.palette.background;
	const gold = look === "gold";
	const fill = gold ? mix(frame.palette.accent, paper, 0.35) : paper;
	const ink = frame.palette.foreground;
	const shade = mix(fill, ink, 0.13);
	const rim = mix(fill, ink, 0.82);
	const faint = mix(fill, ink, 0.17);
	const open =
		inOutCubic(t / 0.55) * (1 - inOutCubic(out / 0.9));
	const a = inC(t, 0.15) * (1 - clamp((out - 0.75) / 0.25));
	if (a <= 0.01) return;
	const ww = sw * lerpN(0.1, 1, open);
	const fold = M * 0.02 * lerpN(3.2, 1, open);
	const X: number[] = [];
	const T: number[] = [];
	const B: number[] = [];
	for (let j = 0; j <= n; j += 1) {
		const k = (j % 2 ? 1 : -1) * fold;
		X.push(cx - ww / 2 + (ww * j) / n);
		T.push(cy - sh / 2 - k);
		B.push(cy + sh / 2 + k);
	}
	for (let index = 0; index < n; index += 1) {
		waPoly(
			ctx,
			[
				[X[index]!, T[index]!],
				[X[index + 1]!, T[index + 1]!],
				[X[index + 1]!, B[index + 1]!],
				[X[index]!, B[index]!],
			],
			index % 2 ? shade : fill,
			a,
		);
		if (gold) {
			for (const f of [1 / 3, 2 / 3]) {
				waLine(
					ctx,
					X[index]!,
					lerpN(T[index]!, B[index]!, f),
					X[index + 1]!,
					lerpN(T[index + 1]!, B[index + 1]!, f),
					faint,
					lw * 1.5,
					a,
				);
			}
			waLine(
				ctx,
				(X[index]! + X[index + 1]!) / 2,
				(T[index]! + T[index + 1]!) / 2,
				(X[index]! + X[index + 1]!) / 2,
				(B[index]! + B[index + 1]!) / 2,
				faint,
				lw * 1.5,
				a,
			);
		}
		if (look === "hills") {
			const h0 = B[index]! - sh * (0.08 + 0.2 * ru(seed, index, 7));
			const h1 = B[index + 1]! - sh * (0.08 + 0.2 * ru(seed, index + 1, 7));
			const hm = Math.min(h0, h1) - sh * 0.07 * ru(seed, index, 9);
			waPoly(
				ctx,
				[
					[X[index]!, h0],
					[(X[index]! + X[index + 1]!) / 2, hm],
					[X[index + 1]!, h1],
					[X[index + 1]!, B[index + 1]!],
					[X[index]!, B[index]!],
				],
				faint,
				a * 1.2,
			);
		}
	}
	if (sun && !gold) {
		waDisc(
			ctx,
			lerpN(X[0]!, X[n]!, 0.82),
			cy - sh * 0.33,
			sh * 0.065 * open,
			frame.palette.accent,
			a * 0.85,
		);
	}
	for (let index = 0; index < n; index += 1) {
		waStroke(
			ctx,
			[
				[X[index]!, T[index]!],
				[X[index + 1]!, T[index + 1]!],
				[X[index + 1]!, B[index + 1]!],
				[X[index]!, B[index]!],
				[X[index]!, T[index]!],
			],
			rim,
			M * 0.007,
			a,
		);
	}
	const lines = waColumns(txt, port ? 3 : 2);
	const size = Math.min(
		waFitSize({ boxHeight: sh * 0.5, boxWidth: sw * 0.84, lines }),
		sh * 0.4,
	);
	waDrawLines({ color: ink, lines, maxWidth: sw * 0.84, options, size, x: cx, y: cy });
}

/** のぼり旗 — tall banner flags on poles; one column of the line per flag, the cloth edge flutters. */
function drawWzNobori(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt } = waLayoutBase(options);
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	const multi = layoutUnit(seed, 1) < 0.7;
	const colPick = ["accent", "ink", "paper"][Math.floor(layoutUnit(seed, 2) * 3)] ?? "ink";
	const sway = 0.7 + layoutUnit(seed, 3) * 0.6;
	const band = layoutUnit(seed, 4) < 0.6;
	const want = port ? (n > 10 && multi ? 2 : 1) : !multi ? 1 : n <= 3 ? 1 : n <= 9 ? 2 : 3;
	const parts = want === 1 ? [txt] : waColumns(txt, want);
	const nb = parts.length;
	const ltr = hasLatin(txt);
	const bh = H * 0.78;
	const y0 = H * 0.1;
	const gap = M * 0.07;
	const tk = M * 0.012;
	const bw =
		nb === 1
			? Math.min(W * 0.44, bh * 0.36)
			: Math.min((W * 0.86 - gap * (nb - 1)) / nb, bh * 0.27);
	const tot = nb * bw + (nb - 1) * gap;
	const pap = frame.palette.background;
	const cA =
		colPick === "paper"
			? pap
			: colPick === "accent"
				? frame.palette.accent
				: frame.palette.foreground;
	const cB =
		colPick === "paper"
			? frame.palette.accent
			: pap === cA
				? frame.palette.secondary
				: pap;
	const pole = mix(frame.palette.foreground, frame.palette.secondary, 0.5);
	const a = inC(t, 0.15) * (1 - inCubic(out));
	if (a <= 0.01) return;
	for (let k = 0; k < nb; k += 1) {
		const i = ltr ? k : nb - 1 - k;
		const xl = (W - tot) / 2 + i * (bw + gap) + tk;
		const xr = xl + bw - tk;
		const e = inE(t, 0.55, k * 0.09);
		const fill = k % 2 ? cB : cA;
		const on = fill === pap ? frame.palette.foreground : pap;
		const hh = bh * e;
		const points: (readonly [number, number])[] = [[xl, y0]];
		for (let s = 0; s <= 10; s += 1) {
			points.push([
				xr +
					Math.sin(t * 1.7 * sway + s * 0.75 + k * 1.3) * bw * 0.035 * 0.6 * (s / 10),
				y0 + (hh * s) / 10,
			]);
		}
		points.push([xl, y0 + hh]);
		waLine(ctx, xl - tk * 1.7, H * 0.99, xl - tk * 1.7, lerpN(H * 0.99, y0 - M * 0.045, inE(t, 0.45, k * 0.07)), pole, tk, a);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = pole;
		ctx.fillRect(xl - tk * 2.6, y0 - tk * 1.6, (bw + tk * 1.2) * e, tk * 0.8);
		ctx.restore();
		waDisc(ctx, xl - tk * 1.7, y0 - M * 0.045, tk * 1.1 * e, pole, a);
		waPoly(ctx, points, fill, a);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = fill;
		for (let s = 0; s < 6; s += 1) {
			ctx.fillRect(xl - tk * 2.6, y0 + (hh * (s + 0.5)) / 6 - tk * 0.9, tk * 2.8, tk * 1.8);
		}
		for (let s = 0; s < 3; s += 1) {
			ctx.fillRect(xl + ((bw - tk) * e * (s + 0.5)) / 3 - tk * 0.9, y0 - tk * 2.2, tk * 1.8, tk * 2.6);
		}
		ctx.restore();
		if (band) {
			ctx.save();
			ctx.globalAlpha *= a * 0.85;
			ctx.fillStyle = on;
			ctx.fillRect(xl, y0 + hh * 0.045, bw - tk * 1.6, hh * 0.012);
			ctx.fillRect(xl, y0 + hh * 0.925, bw - tk * 1.6, hh * 0.03);
			ctx.restore();
		}
		const columns = [parts[k]!];
		const size = Math.min(
			waFitVertical({ boxHeight: bh * 0.76, boxWidth: bw * 0.66, columns }),
			bw * 0.6,
		);
		layoutCDrawVerticalGlyphs({
			alpha: a,
			color: on,
			fontSize: size,
			glyphs: layoutGlyphs(parts[k]!),
			options,
			x: (xl + xr) / 2 - tk * 0.3,
			y: y0 + bh * 0.49 - (size * 1.03 * (layoutGlyphs(parts[k]!).length - 1)) / 2,
		});
	}
}

/** 千社札 — votive name stickers: tall double-framed slips slapped on one after another. */
function drawWzSenjafuda(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, W, no, out, port, seed, t, txt } = waLayoutBase(options);
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	const want = n <= 3 ? 1 : n <= 8 ? 2 : port ? 2 : 3;
	const parts = waColumns(txt, want);
	const k = parts.length;
	const ltr = hasLatin(txt);
	const sh = H * (port ? 0.6 : 0.74);
	const gap = Math.min(W, H) * 0.03;
	const sw = Math.min(sh * 0.36, (W * 0.86 - gap * (k - 1)) / k);
	const tot = k * sw + (k - 1) * gap;
	const inv = layoutUnit(seed, 3) < 0.5;
	const head = layoutUnit(seed, 4) < 0.7;
	const tilt = [-1, 1].map((d) => (layoutUnit(seed, 5 + d) - 0.5) * 8);
	const dys = [-1, 1].map((d) => (layoutUnit(seed, 7 + d) - 0.5) * 2);
	const aBase = inC(t, 0.15) * (1 - inCubic(out));
	if (aBase <= 0.01) return;
	for (let j = 0; j < k; j += 1) {
		const i = ltr ? j : k - 1 - j;
		const cx = (W - tot) / 2 + i * (sw + gap) + sw / 2;
		const cy = H / 2 + (dys[j % 2] ?? 0) * H * 0.025;
		const e = inB(t, 0.38, j * 0.14, 1.6);
		if (e <= 0) continue;
		const inverted = inv && j % 2 === 1;
		const fill = inverted ? frame.palette.foreground : frame.palette.background;
		const ink = inverted ? frame.palette.background : frame.palette.foreground;
		const acc = frame.palette.accent;
		const a = clamp(e * 2.5) * aBase;
		const x0 = cx - sw / 2;
		const y0 = cy - sh / 2;
		const bd = sw * 0.05;
		const hd = head ? sw * 0.5 : 0;
		pose(
			ctx,
			cx,
			cy,
			{ rot: tilt[j % 2] ?? 0, s: lerpN(1.35, 1, e) },
			() => {
				ctx.save();
				ctx.globalAlpha *= a;
				ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.7);
				ctx.fillRect(x0 + W * 0.008, y0 + H * 0.01, sw, sh);
				ctx.fillStyle = fill;
				ctx.fillRect(x0, y0, sw, sh);
				ctx.restore();
				waStroke(
					ctx,
					[
						[x0 + bd, y0 + bd],
						[x0 + sw - bd, y0 + bd],
						[x0 + sw - bd, y0 + sh - bd],
						[x0 + bd, y0 + sh - bd],
						[x0 + bd, y0 + bd],
					],
					ink,
					bd * 0.7,
					a,
				);
				waStroke(
					ctx,
					[
						[x0 + bd * 2.1, y0 + bd * 2.1],
						[x0 + sw - bd * 4.2 + bd * 2.1, y0 + bd * 2.1],
						[x0 + sw - bd * 4.2 + bd * 2.1, y0 + sh - bd * 4.2 + bd * 2.1],
						[x0 + bd * 2.1, y0 + sh - bd * 4.2 + bd * 2.1],
						[x0 + bd * 2.1, y0 + bd * 2.1],
					],
					ink,
					Math.max(1, bd * 0.16),
					a,
				);
				if (hd) {
					ctx.save();
					ctx.globalAlpha *= a;
					ctx.fillStyle = j === 0 ? acc : ink;
					ctx.fillRect(x0 + bd * 2.1, y0 + bd * 2.1, sw - bd * 4.2, hd);
					ctx.restore();
					waLabel({ options,
						alpha: a,
						color: j === 0 ? fill : ink,
						size: hd * 0.52,
						text: j === 0 ? kanjiNum(no) : "・",
						x: cx,
						y: y0 + bd * 2.1 + hd / 2,
					});
				}
				const columns = [parts[j]!];
				const size = Math.min(
					waFitVertical({
						boxHeight: (sh - bd * 4.2 - hd) * 0.88,
						boxWidth: sw * 0.6,
						columns,
					}),
					sw * 0.62,
				);
				layoutCDrawVerticalGlyphs({
					alpha: a,
					color: ink,
					fontSize: size,
					glyphs: layoutGlyphs(parts[j]!),
					options,
					x: cx,
					y:
						y0 +
						bd * 2.1 +
						hd +
						(sh - bd * 4.2 - hd) * 0.44 -
						(size * 1.03 * (layoutGlyphs(parts[j]!).length - 1)) / 2,
				});
			},
		);
	}
}

/** 行灯 — a box lamp with paper sides that flickers on; the line is written on the lit paper. */
function drawWzAndon(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt } = waLayoutBase(options);
	const kind = ["floor", "floor", "hang"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "floor";
	const bars = 5 + Math.floor(layoutUnit(seed, 2) * 4);
	const ww = port ? W * 0.72 : Math.min(W * 0.62, H * 1.15);
	const hh = H * (port ? 0.46 : 0.5);
	const cx = W / 2;
	const cy = H * (kind === "hang" ? 0.53 : 0.47);
	const x0 = cx - ww / 2;
	const y0 = cy - hh / 2;
	const wood = mix(frame.palette.foreground, frame.palette.secondary, 0.5);
	const k = clamp(t / 0.6);
	const step = Math.floor(t * 24);
	const lit =
		outCubic(k) *
		(k < 0.75 && ru(seed, step, 3) < 0.3 ? 0.45 : 1) *
		(0.94 + 0.06 * smoothNoise({ seed, salt: 3, value: t * 3 })) *
		(1 - inCubic(out));
	const paperC = mix(
		mix(frame.palette.background, frame.palette.foreground, 0.1),
		frame.palette.background,
		1 - lit,
	);
	const ink = frame.palette.foreground;
	const e = inE(t, 0.45);
	const a = inC(t, 0.2) * (1 - clamp((out - 0.6) / 0.4));
	if (a <= 0.01) return;
	const fw = M * 0.016;
	pose(ctx, cx, cy, { s: 0.95 + 0.05 * e, dy: (1 - e) * M * 0.025 }, () => {
		const R = Math.max(ww, hh) * 0.95;
		for (let g = 4; g >= 1; g -= 1) {
			waDisc(ctx, cx, cy, (R * g) / 4, frame.palette.accent, a * lit * 0.09);
		}
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = paperC;
		ctx.fillRect(x0, y0, ww, hh);
		ctx.restore();
		for (let g = 3; g >= 1; g -= 1) {
			waDisc(
				ctx,
				cx,
				y0 + hh * 0.8,
				(ww * 0.6 * g) / 3,
				frame.palette.accent,
				a * lit * 0.07,
			);
		}
		const rl = hh * 0.1;
		const nb = bars * (port ? 1 : 2);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = wood;
		for (const yy of [y0 + rl, y0 + hh - rl]) {
			ctx.fillRect(x0, yy - fw * 0.25, ww, fw * 0.5);
		}
		for (let index = 1; index < nb; index += 1) {
			const xx = x0 + (ww * index) / nb - fw * 0.2;
			ctx.fillRect(xx, y0, fw * 0.4, rl);
			ctx.fillRect(xx, y0 + hh - rl, fw * 0.4, rl);
		}
		ctx.fillRect(x0 - fw, y0 - fw, fw, hh + fw * 2);
		ctx.fillRect(x0 + ww, y0 - fw, fw, hh + fw * 2);
		ctx.fillRect(x0 - fw * 2.6, y0 - fw * 2.4, ww + fw * 5.2, fw * 1.8);
		ctx.fillRect(x0 - fw * 2, y0 + hh + fw * 0.4, ww + fw * 4, fw * 1.6);
		ctx.restore();
		if (kind === "hang") {
			waStroke(
				ctx,
				[
					[x0 + ww * 0.12, y0 - fw * 2.4],
					[cx, y0 - fw * 2.4 - hh * 0.2],
					[x0 + ww * 0.88, y0 - fw * 2.4],
				],
				wood,
				fw * 0.45,
				a,
			);
			waLine(ctx, cx, y0 - fw * 2.4 - hh * 0.2, cx, 0, wood, fw * 0.3, a);
		} else {
			for (const s of [-1, 1]) {
				const lx = cx + s * ww * 0.4;
				waPoly(
					ctx,
					[
						[lx - fw * 0.8, y0 + hh + fw * 2],
						[lx + fw * 0.8, y0 + hh + fw * 2],
						[lx + s * fw * 1.6 + fw * 0.7, y0 + hh * 1.2],
						[lx + s * fw * 1.6 - fw * 0.7, y0 + hh * 1.2],
					],
					wood,
					a,
				);
			}
		}
		const lines = waColumns(txt, port ? 4 : 2);
		const size = Math.min(
			waFitSize({ boxHeight: hh * 0.6, boxWidth: ww * 0.86, lines }),
			hh * 0.42,
		);
		waDrawLines({ color: ink, lines, maxWidth: ww * 0.86, options, size, x: cx, y: cy });
	});
}

/** 色紙 — a square poem card; the columns are "scatter-written" at staggered heights. */
function drawWzShikishi(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, seed, t, txt } = waLayoutBase(options);
	const S = Math.min(W * 0.88, H * 0.84);
	const cx = W / 2;
	const cy = H / 2;
	const x0 = cx - S / 2;
	const y0 = cy - S / 2;
	const flow = ["down", "up", "wave"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "down";
	const tilt = (layoutUnit(seed, 2) - 0.5) * 4;
	const deco = ["flecks", "band", "flecks"][Math.floor(layoutUnit(seed, 3) * 3)] ?? "flecks";
	const seal = layoutUnit(seed, 4) < 0.75;
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	const L = n <= 3 ? 1 : n <= 6 ? 2 : n <= 11 ? 3 : 4;
	const cols = waColumns(txt, L);
	const k = cols.length;
	let size = S * (k === 1 ? 0.27 : 0.2);
	for (const column of cols) {
		size = Math.min(
			size,
			waFitVertical({
				boxHeight: S * 0.6,
				boxWidth: (S * 0.72 * 0.82) / k,
				columns: [column],
			}),
		);
	}
	const pitch = Math.min((S * 0.74) / k, size * 1.55);
	const offs =
		flow === "up"
			? [1, 0.5, 0, 0.45]
			: flow === "wave"
				? [0.1, 1, 0.3, 0.8]
				: [0, 0.5, 1, 0.55];
	const e = inE(t, 0.5);
	const a = inC(t, 0.2) * (1 - inCubic(out));
	if (a <= 0.01) return;
	pose(ctx, cx, cy, { rot: lerpN(-5, tilt, e), dy: (1 - e) * M * 0.05, s: 0.94 + 0.06 * e }, () => {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.68);
		ctx.fillRect(x0 + M * 0.01, y0 + M * 0.014, S, S);
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(x0, y0, S, S);
		ctx.restore();
		if (deco === "band") {
			waPoly(
				ctx,
				[
					[x0, y0 + S * 0.62],
					[x0 + S, y0 + S * 0.38],
					[x0 + S, y0 + S * 0.58],
					[x0, y0 + S * 0.82],
				],
				frame.palette.accent,
				a * 0.13 * e,
			);
		}
		for (let index = 0; index < 16; index += 1) {
			const q = ru(seed, index, 1);
			const fx =
				index % 2
					? x0 + S * (0.06 + 0.4 * q * q)
					: x0 + S * (0.94 - 0.4 * q * q);
			const fy =
				index % 2
					? y0 + S * (0.05 + 0.3 * ru(seed, index, 2))
					: y0 + S * (0.95 - 0.3 * ru(seed, index, 2));
			const fs = S * (0.006 + 0.012 * ru(seed, index, 3));
			ctx.save();
			ctx.globalAlpha *= a * 0.55 * inC(t, 0.3, 0.2 + index * 0.02);
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(fx - fs / 2, fy - fs / 2, fs, fs);
			ctx.restore();
		}
		waStroke(
			ctx,
			[
				[x0 + S * 0.022, y0 + S * 0.022],
				[x0 + S * 0.978, y0 + S * 0.022],
				[x0 + S * 0.978, y0 + S * 0.978],
				[x0 + S * 0.022, y0 + S * 0.978],
				[x0 + S * 0.022, y0 + S * 0.022],
			],
			frame.palette.accent,
			Math.max(1.5, S * 0.004),
			a * 0.8,
		);
		let lastX = cx;
		let lastB = cy;
		for (let index = 0; index < k; index += 1) {
			const x = cx + ((k - 1) / 2 - index) * pitch;
			const count = Math.max(1, layoutGlyphs(cols[index]!).length);
			const mh = size * 1.03 * count;
			const top =
				k === 1
					? cy - mh / 2
					: y0 + S * 0.12 + (offs[index % 4] ?? 0) * Math.max(0, S * 0.7 - mh) * 0.75;
			layoutCDrawVerticalGlyphs({
				alpha: a,
				color: frame.palette.foreground,
				fontSize: size,
				glyphs: layoutGlyphs(cols[index]!),
				options,
				x,
				y: top,
			});
			lastX = x;
			lastB = top + mh;
		}
		if (seal) {
			const ss = Math.min(S * 0.07, size * 0.6);
			const sx = Math.max(x0 + S * 0.07, lastX - pitch * 0.5 - ss * 1.2);
			const sy = Math.min(y0 + S * 0.9 - ss, lastB - ss);
			const sa = clamp((t - 0.6) * 5);
			ctx.save();
			ctx.globalAlpha *= a * sa;
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(sx, sy, ss, ss);
			ctx.restore();
			waStroke(
				ctx,
				[
					[sx + ss * 0.2, sy + ss * 0.2],
					[sx + ss * 0.8, sy + ss * 0.2],
					[sx + ss * 0.8, sy + ss * 0.8],
					[sx + ss * 0.2, sy + ss * 0.8],
					[sx + ss * 0.2, sy + ss * 0.2],
				],
				frame.palette.background,
				ss * 0.08,
				a * sa * 0.8,
			);
		}
	});
}

/** 風鈴 — wind chimes: a glass bell with the line on the paper strip that swings below it. */
function drawWzFurin(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	const multi = layoutUnit(seed, 1) < 0.7;
	const pat = ["dots", "wave", "ring"][Math.floor(layoutUnit(seed, 2) * 3)] ?? "dots";
	const ph0 = layoutUnit(seed, 3) * 6;
	const amp = 3.5 + layoutUnit(seed, 4) * 2.5;
	const want = port ? 1 : !multi ? 1 : n <= 3 ? 1 : n <= 9 ? 2 : 3;
	const parts = want === 1 ? [txt] : waColumns(txt, want);
	const nb = parts.length;
	const ltr = hasLatin(txt);
	const r = M * 0.055;
	const gap = M * 0.1;
	const shh = H * 0.6;
	const bwMax =
		nb === 1
			? Math.min(W * 0.44, shh * 0.42)
			: Math.min((W * 0.84 - gap * (nb - 1)) / nb, shh * 0.3);
	const tot = nb * bwMax + (nb - 1) * gap;
	const glass = frame.palette.accent;
	const lineColor = frame.palette.foreground;
	const a = inC(t, 0.25) * (1 - inCubic(out));
	if (a <= 0.01) return;
	if (!port) {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = mix(frame.palette.foreground, frame.palette.secondary, 0.5);
		ctx.fillRect(0, H * 0.03, W, M * 0.014);
		ctx.restore();
	}
	for (let k = 0; k < nb; k += 1) {
		const i = ltr ? k : nb - 1 - k;
		const cx = (W - tot) / 2 + i * (bwMax + gap) + bwMax / 2;
		const yb = H * (port ? 0.07 : 0.1) + (k % 2) * H * 0.035;
		const e = inE(t, 0.5, k * 0.1);
		const columns = [parts[k]!];
		const size = Math.min(
			waFitVertical({ boxHeight: shh * 0.84, boxWidth: bwMax * 0.74, columns }),
			bwMax * 0.6,
		);
		const ph = ph0 + k * 1.9;
		const th =
			(Math.sin(t * 1.35 + ph) * amp * 0.6 +
				13 * Math.exp(-t * 1.4) * Math.cos(t * 5.2 + ph)) *
			(0.4 + 0.6 * 0.6);
		const by = yb + r * 2.05;
		const sy = by + r * 1.3;
		waLine(ctx, cx, port ? 0 : H * 0.03, cx, yb, lineColor, lw * 1.5, a);
		pose(ctx, cx, yb, { rot: th * 0.25, s: 0.6 + 0.4 * e }, () => {
			const pts: (readonly [number, number])[] = [
				...arcPoints(cx, yb + r, r, r, 180, 360, 16),
				[cx + r * 1.08, by],
				[cx - r * 1.08, by],
			];
			waPoly(ctx, pts, glass, a * 0.3);
			waStroke(ctx, pts, glass, lw * 2.4, a);
			if (pat === "dots") {
				for (let d = -1; d <= 1; d += 1) {
					waDisc(ctx, cx + d * r * 0.5, yb + r * 1.25, r * 0.11, glass, a);
				}
			} else if (pat === "wave") {
				waStroke(
					ctx,
					Array.from({ length: 13 }, (_, q) => [
						cx - r * 0.85 + q * r * 0.142,
						yb + r * 1.3 + Math.sin(q * 1.05) * r * 0.13,
					]),
					glass,
					lw * 2.4,
					a,
				);
			} else {
				waStroke(
					ctx,
					arcPoints(cx, yb + r * 1.05, r * 0.36, r * 0.36, 0, 360, 16),
					glass,
					lw * 2.4,
					a,
				);
			}
		});
		pose(ctx, cx, by, { rot: th }, () => {
			waLine(ctx, cx, by - r * 0.6, cx, sy, lineColor, lw * 1.5, a);
			waDisc(ctx, cx, by + r * 0.35, r * 0.13, lineColor, a);
			const hh = shh * e;
			ctx.save();
			ctx.globalAlpha *= a;
			ctx.fillStyle = frame.palette.background;
			ctx.fillRect(cx - size * 0.75, sy, size * 1.5, hh);
			ctx.restore();
			waStroke(
				ctx,
				[
					[cx - size * 0.75, sy],
					[cx + size * 0.75, sy],
					[cx + size * 0.75, sy + hh],
					[cx - size * 0.75, sy + hh],
					[cx - size * 0.75, sy],
				],
				frame.palette.secondary,
				lw * 1.5,
				a,
			);
			ctx.save();
			ctx.globalAlpha *= a * 0.8;
			ctx.fillStyle = frame.palette.accent;
			ctx.fillRect(cx - size * 0.75, sy + hh * 0.03, size * 1.5, hh * 0.012);
			ctx.fillRect(cx - size * 0.75, sy + hh * 0.955, size * 1.5, hh * 0.012);
			ctx.restore();
			layoutCDrawVerticalGlyphs({
				alpha: a,
				color: frame.palette.foreground,
				fontSize: size,
				glyphs: layoutGlyphs(parts[k]!),
				options,
				x: cx,
				y:
					sy +
					shh * 0.5 -
					(size * 1.03 * (layoutGlyphs(parts[k]!).length - 1)) / 2,
			});
		});
	}
}

/** 番付表 — a ranking sheet: columns shrink from right to left like a sumo banzuke, small print fills the rest. */
function drawWzBanzuke(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, no, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const pw = W * (port ? 0.9 : 0.8);
	const ph = H * (port ? 0.7 : 0.84);
	const cx = W / 2;
	const cy = H / 2;
	const x0 = cx - pw / 2;
	const y0 = cy - ph / 2;
	const ratio = 0.7 + layoutUnit(seed, 1) * 0.12;
	const tiers = 2 + Math.floor(layoutUnit(seed, 2) * 2);
	const stamp = layoutUnit(seed, 3) < 0.5;
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	const L = n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4;
	const cols = waColumns(txt, L);
	const k = cols.length;
	const T = k + Math.max(2, 6 - k);
	const ws: number[] = [];
	let sum = 0;
	for (let index = 0; index < T; index += 1) {
		const w = ratio ** index;
		ws.push(w);
		sum += w;
	}
	const hd = ph * 0.11;
	const bd = M * 0.014;
	const ux = pw - bd * 4;
	const by0 = y0 + bd * 2 + hd;
	const bh = ph - bd * 4 - hd;
	const e = inE(t, 0.45);
	const a = inC(t, 0.2) * (1 - inCubic(out));
	if (a <= 0.01) return;
	pose(ctx, cx, cy, { dy: -(1 - e) * M * 0.05 }, () => {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.7);
		ctx.fillRect(x0 + M * 0.01, y0 + M * 0.012, pw, ph);
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(x0, y0, pw, ph);
		ctx.restore();
		waStroke(
			ctx,
			[
				[x0 + bd, y0 + bd],
				[x0 + pw - bd, y0 + bd],
				[x0 + pw - bd, y0 + ph - bd],
				[x0 + bd, y0 + ph - bd],
				[x0 + bd, y0 + bd],
			],
			frame.palette.foreground,
			bd * 0.35,
			a,
		);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = frame.palette.foreground;
		ctx.fillRect(x0 + bd * 2, by0 - lw * 1.5, ux * inE(t, 0.5, 0.1), lw * 3);
		ctx.restore();
		waLabel({ options,
			alpha: a,
			color: frame.palette.foreground,
			size: hd * 0.5,
			text: `第${kanjiNum(no)}番`,
			x: cx,
			y: y0 + bd * 1.6 + hd / 2,
		});
		let xr = x0 + pw - bd * 2;
		for (let index = 0; index < T; index += 1) {
			const cw = (ux * (ws[index] ?? 1)) / sum;
			const xc = xr - cw / 2;
			const ei = inE(t, 0.45, 0.1 + index * 0.05);
			if (index > 0) {
				ctx.save();
				ctx.globalAlpha *= a;
				ctx.fillStyle = frame.palette.secondary;
				ctx.fillRect(xr - lw, by0, lw * 2, bh * ei);
				ctx.restore();
			}
			let top = by0 + bh * 0.04;
			if (index < k) {
				const size = Math.min(
					waFitVertical({
						boxHeight: bh * 0.9,
						boxWidth: cw * 0.76,
						columns: [cols[index]!],
					}),
					cw * 0.8,
				);
				const count = Math.max(1, layoutGlyphs(cols[index]!).length);
				layoutCDrawVerticalGlyphs({
					alpha: a,
					color: index === 0 ? frame.palette.accent : frame.palette.foreground,
					fontSize: size,
					glyphs: layoutGlyphs(cols[index]!),
					options,
					x: xc,
					y: top,
				});
				top += size * 1.03 * count + bh * 0.05;
			}
			const rest = by0 + bh * 0.97 - top;
			const tierCount = index < k ? 1 : tiers;
			const nbar = Math.max(2, Math.round(cw / (M * 0.02)));
			if (rest > bh * 0.1) {
				for (let tr = 0; tr < tierCount; tr += 1) {
					const ty = top + (rest * tr) / tierCount;
					const th = (rest / tierCount) * 0.86;
					if (tr > 0) {
						ctx.save();
						ctx.globalAlpha *= a;
						ctx.fillStyle = frame.palette.secondary;
						ctx.fillRect(
							xr - cw + lw * 2,
							ty - (rest / tierCount) * 0.07,
							(cw - lw * 4) * ei,
							lw * 1.4,
						);
						ctx.restore();
					}
					ctx.save();
					ctx.globalAlpha *= a * 1.5;
					ctx.fillStyle = mix(
						frame.palette.background,
						frame.palette.foreground,
						0.2,
					);
					for (let b = 0; b < nbar; b += 1) {
						ctx.fillRect(
							xr - (cw * (b + 0.5)) / nbar - (cw / nbar) * 0.2,
							ty,
							(cw / nbar) * 0.4,
							th * (0.55 + 0.45 * ru(seed, index, tr, b)) * ei,
						);
					}
					ctx.restore();
				}
			}
			xr -= cw;
		}
		if (stamp) {
			const ss = hd * 0.6;
			const sxp = x0 + bd * 3 + ss;
			const syp = y0 + bd * 1.6 + hd / 2;
			const sa = clamp((t - 0.5) * 5);
			waStroke(
				ctx,
				arcPoints(sxp, syp, ss * 0.5, ss * 0.5, 0, 360, 20),
				frame.palette.accent,
				lw * 2.5,
				a * sa,
			);
			waDisc(ctx, sxp, syp, ss * 0.22, frame.palette.accent, a * sa);
		}
	});
}

/** 手ぬぐい — a long patterned cotton cloth that unrolls; a plain panel in the middle carries the line. */
function drawWzTenugui(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const cw = W * (port ? 0.92 : 0.88);
	const ch = H * (port ? 0.36 : 0.46);
	const cx = W / 2;
	const cy = H / 2;
	const x0 = cx - cw / 2;
	const y0 = cy - ch / 2;
	const pat = ["mame", "shima", "uroko"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "mame";
	const colPick = ["ink", "accent", "paper"][Math.floor(layoutUnit(seed, 2) * 3)] ?? "ink";
	const tilt = (layoutUnit(seed, 3) - 0.5) * 5;
	const rev = layoutUnit(seed, 4) < 0.5;
	const fill =
		colPick === "paper"
			? frame.palette.background
			: colPick === "accent"
				? frame.palette.accent
				: frame.palette.foreground;
	const on =
		fill === frame.palette.background ? frame.palette.foreground : frame.palette.background;
	const pc = colPick === "paper" ? frame.palette.accent : on;
	const e = inOutCubic(t / 0.6);
	const a = inC(t, 0.15) * (1 - inCubic(out));
	if (a <= 0.01) return;
	const vw = cw * e;
	const vx0 = rev ? x0 + cw - vw : x0;
	const zone = cw * 0.17;
	const px0 = x0 + zone;
	const pw = cw - zone * 2;
	pose(ctx, cx, cy, { rot: tilt }, () => {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.72);
		ctx.fillRect(vx0 + M * 0.008, y0 + M * 0.012, vw, ch);
		ctx.fillStyle = fill;
		ctx.fillRect(vx0, y0, vw, ch);
		ctx.restore();
		// pattern field (clipped to the unrolled cloth)
		ctx.save();
		ctx.beginPath();
		ctx.rect(vx0, y0, vw, ch);
		ctx.clip();
		ctx.globalAlpha *= a * (pat === "mame" ? 0.5 : 0.75);
		ctx.fillStyle = pc;
		if (pat === "mame") {
			const d = ch * 0.085;
			const rr = d * 0.2;
			for (let row = 0, yy = y0 + d * 0.6; yy < y0 + ch && row < 40; row += 1, yy += d) {
				for (
					let c = 0, xx = x0 + d * (row % 2 ? 1.1 : 0.6);
					xx < x0 + cw && c < 120;
					c += 1, xx += d
				) {
					if (
						xx > px0 - d * 0.3 &&
						xx < px0 + pw + d * 0.3 &&
						yy > y0 + ch * 0.13 &&
						yy < y0 + ch * 0.87
					) {
						continue;
					}
					ctx.fillRect(xx - rr, yy - rr, rr * 2, rr * 2);
				}
			}
		} else if (pat === "shima") {
			for (const s of [0, 1]) {
				for (let q = 0; q < 5; q += 1) {
					const bx = (s ? x0 + cw - zone : x0) + zone * (0.12 + q * 0.17);
					ctx.fillRect(bx, y0, zone * (q % 2 ? 0.035 : 0.09), ch);
				}
			}
		} else {
			const d = ch / 8;
			const hw = d * 0.58;
			for (const s of [0, 1]) {
				for (let c = 0; c < 4; c += 1) {
					for (let rw = 0; rw < 9; rw += 1) {
						const dir = s ? -1 : 1;
						const tx = (s ? x0 + cw : x0) + dir * (c * hw + hw * 0.2);
						const ty = y0 + rw * d + (c % 2 ? d / 2 : 0) - d / 2;
						waPoly(
							ctx,
							[
								[tx, ty],
								[tx + dir * hw, ty + d / 2],
								[tx, ty + d],
							],
							pc,
							1,
						);
					}
				}
			}
		}
		ctx.restore();
		if (pat === "mame") {
			waStroke(
				ctx,
				[
					[px0, y0 + ch * 0.13],
					[px0 + pw, y0 + ch * 0.13],
					[px0 + pw, y0 + ch * 0.87],
					[px0, y0 + ch * 0.87],
					[px0, y0 + ch * 0.13],
				],
				pc,
				lw * 2,
				a * 0.6 * inC(t, 0.3, 0.35),
			);
		} else {
			for (const s of [0, 1]) {
				ctx.save();
				ctx.globalAlpha *=
					a *
					0.7 *
					((rev ? !s : s) ? inC(t, 0.2, 0.45) : inC(t, 0.2, 0.1));
				ctx.fillStyle = pc;
				ctx.fillRect(s ? px0 + pw : px0 - lw * 3, y0, lw * 3, ch);
				ctx.restore();
			}
		}
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = fill;
		for (let q = 0; q < 26; q += 1) {
			const fy = y0 + (ch * (q + 0.5)) / 26;
			const fl = M * (0.006 + 0.008 * ru(seed, q));
			const fadeEnd = rev ? clamp(e * 8 - 7) : 1;
			const fadeStart = rev ? 1 : clamp(e * 8 - 7);
			if (fadeEnd > 0.01) ctx.fillRect(x0 - fl, fy, fl, lw * 1.6);
			if (fadeStart > 0.01) ctx.fillRect(x0 + cw, fy, fl, lw * 1.6);
		}
		ctx.restore();
		if (e < 0.995) {
			const rollX = (rev ? vx0 : vx0 + vw) - ch * 0.035;
			ctx.save();
			ctx.globalAlpha *= a;
			ctx.fillStyle = mix(fill, on, 0.25);
			ctx.fillRect(rollX, y0 - ch * 0.03, ch * 0.07, ch * 1.06);
			ctx.restore();
		}
		const lines = waColumns(txt, port ? 4 : 2);
		const size = Math.min(
			waFitSize({
				boxHeight: ch * (port ? 0.7 : 0.58),
				boxWidth: pw * 0.9,
				lines,
			}),
			ch * 0.42,
		);
		waDrawLines({ color: on, lines, maxWidth: pw * 0.9, options, size, x: cx, y: cy });
	});
}

/** 竹簡 — bamboo slips tied with cords; each column of the line sits on its own slip, unrolled right to left. */
function drawWzChikkan(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const glyphs = layoutGlyphs(txt);
	const n = glyphs.length;
	let ex = 1 + Math.floor(layoutUnit(seed, 1) * 2);
	const roll = layoutUnit(seed, 2) < 0.6;
	const cordAccent = ["accent", "ink"][Math.floor(layoutUnit(seed, 3) * 2)] === "accent";
	const sh = H * (port ? 0.66 : 0.74);
	const cx = W / 2;
	const cy = H / 2;
	const y0 = cy - sh / 2;
	const C = frame.palette;
	let cols = [txt];
	let k = 1;
	let size = 10;
	for (
		let q = 1;
		q <= Math.min(port ? 3 : 5, Math.max(1, n));
		q += 1
	) {
		const cs = waColumns(txt, q);
		let s = Math.min(sh * 0.2, (W * 0.86) / (cs.length + 2) / 1.64);
		for (const column of cs) {
			s = Math.min(
				s,
				waFitVertical({ boxHeight: sh * 0.76, boxWidth: s * 1.2, columns: [column] }),
			);
		}
		if (s > size * 1.04) {
			size = s;
			cols = cs;
			k = cs.length;
		}
	}
	const sw = size * 1.5;
	const gp = size * 0.14;
	while (ex > 0 && (k + ex * 2) * (sw + gp) > W * 0.92) ex -= 1;
	const T = k + ex * 2;
	const bam = mix(C.background, C.secondary, 0.22);
	const ink = C.foreground;
	const node = mix(bam, ink, 0.3);
	const cord = cordAccent ? C.accent : mix(bam, ink, 0.75);
	const a = inC(t, 0.15) * (1 - inCubic(out));
	if (a <= 0.01) return;
	let xl = Number.POSITIVE_INFINITY;
	let xrr = Number.NEGATIVE_INFINITY;
	for (let q = 0; q < T; q += 1) {
		const x = cx + ((T - 1) / 2 - q) * (sw + gp);
		const e = inE(t, 0.42, q * 0.055);
		const aa = a * clamp(e * 3);
		const dx = (1 - e) * size * 1.4;
		if (aa <= 0.01) continue;
		const tone = mix(bam, ink, 0.07 * ru(seed, q, 5));
		ctx.save();
		ctx.globalAlpha *= aa;
		ctx.fillStyle = mix(C.foreground, C.background, 0.75);
		ctx.fillRect(x - sw / 2 + dx + W * 0.004, y0 + H * 0.008, sw, sh);
		ctx.fillStyle = tone;
		ctx.fillRect(x - sw / 2 + dx, y0, sw, sh);
		ctx.restore();
		for (const f of [0.1 + 0.06 * ru(seed, q, 1), 0.62 + 0.2 * ru(seed, q, 2)]) {
			ctx.save();
			ctx.globalAlpha *= aa;
			ctx.fillStyle = node;
			ctx.fillRect(x - sw / 2 + dx, y0 + sh * f, sw, lw * 1.6);
			ctx.globalAlpha *= 0.6;
			ctx.fillRect(x - sw / 2 + dx, y0 + sh * f + lw * 4, sw, lw);
			ctx.restore();
		}
		for (const f of [0.055, 0.945]) {
			ctx.save();
			ctx.globalAlpha *= aa;
			ctx.fillStyle = cord;
			ctx.fillRect(x - sw / 2 + dx - gp, y0 + sh * f - lw * 2, sw + gp * 2, lw * 4);
			ctx.restore();
			waLine(ctx, x - sw * 0.16 + dx, y0 + sh * f - sw * 0.14, x + sw * 0.16 + dx, y0 + sh * f + sw * 0.14, cord, lw * 2.5, aa);
			waLine(ctx, x + sw * 0.16 + dx, y0 + sh * f - sw * 0.14, x - sw * 0.16 + dx, y0 + sh * f + sw * 0.14, cord, lw * 2.5, aa);
		}
		xl = Math.min(xl, x - sw / 2);
		xrr = Math.max(xrr, x + sw / 2);
		const ci = q - ex;
		if (ci >= 0 && ci < k) {
			layoutCDrawVerticalGlyphs({
				alpha: aa,
				color: ink,
				fontSize: size,
				glyphs: layoutGlyphs(cols[ci]!),
				options,
				x,
				y: cy - (size * 1.03 * (layoutGlyphs(cols[ci]!).length - 1)) / 2,
			});
		}
	}
	if (roll && xl - sw * 0.9 > W * 0.02) {
		const aa = a * inC(t, 0.3, T * 0.055);
		ctx.save();
		ctx.globalAlpha *= aa;
		ctx.fillStyle = mix(bam, ink, 0.14);
		ctx.fillRect(xl - gp - sw * 0.8, y0 - sh * 0.012, sw * 0.8, sh * 1.024);
		ctx.restore();
		for (const f of [0.055, 0.945]) {
			ctx.save();
			ctx.globalAlpha *= aa;
			ctx.fillStyle = cord;
			ctx.fillRect(xl - gp - sw * 0.8, y0 + sh * f - lw * 2, sw * 0.8, lw * 4);
			ctx.restore();
		}
	}
}

/** 将棋の駒 — every glyph is a five-sided shogi piece slapped onto the board grid. */
function drawWzShogi(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const cells = layoutGlyphs(txt).length;
	const rows = port ? Math.ceil(cells / (cells <= 9 ? 3 : 4)) : cells <= 7 ? 1 : 2;
	const lineTexts = waColumns(txt, rows).map((line) => layoutGlyphs(line));
	const R = lineTexts.length;
	const maxc = Math.max(1, ...lineTexts.map((line) => line.length));
	const gc = maxc + 1;
	const gr = R + 1;
	const c = Math.min((W * 0.9) / gc, (H * 0.8) / gr, M * 0.3);
	const bx = W / 2 - (gc * c) / 2;
	const by = H / 2 - (gr * c) / 2;
	const board = mix(frame.palette.background, frame.palette.secondary, 0.3);
	const bl = mix(board, frame.palette.foreground, 0.55);
	const ink = frame.palette.foreground;
	const paper = frame.palette.background;
	const hasRed = layoutUnit(seed, 3) < 0.6;
	const redI = hasRed && cells > 1 ? Math.floor(layoutUnit(seed, 4) * cells) % cells : -1;
	const stars = layoutUnit(seed, 5) < 0.7;
	const e = inE(t, 0.4);
	const a = inC(t, 0.2) * (1 - inCubic(out));
	if (a <= 0.01) return;
	ctx.save();
	ctx.globalAlpha *= a * 0.3 * e;
	ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.7);
	ctx.fillRect(bx - c * 0.12 + M * 0.008, by - c * 0.12 + M * 0.012, gc * c + c * 0.24, gr * c + c * 0.24);
	ctx.restore();
	ctx.save();
	ctx.globalAlpha *= a;
	ctx.fillStyle = board;
	ctx.fillRect(bx - c * 0.12, by - c * 0.12, gc * c + c * 0.24, gr * c + c * 0.24);
	ctx.restore();
	for (let index = 0; index <= gc; index += 1) {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = bl;
		ctx.fillRect(bx + index * c - lw, by, lw * 2, gr * c * inE(t, 0.45, index * 0.02));
		ctx.restore();
	}
	for (let j = 0; j <= gr; j += 1) {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = bl;
		ctx.fillRect(bx, by + j * c - lw, gc * c * inE(t, 0.45, j * 0.03), lw * 2);
		ctx.restore();
	}
	if (stars) {
		for (const [i, j] of [
			[1, 1],
			[gc - 1, gr - 1],
		]) {
			waDisc(ctx, bx + i * c, by + j * c, c * 0.035, bl, a);
		}
	}
	let idx = 0;
	for (let r = 0; r < R; r += 1) {
		const line = lineTexts[r]!;
		const off = Math.floor((gc - line.length) / 2) + ((gc - line.length) % 2 ? 0.5 : 0);
		for (let q = 0; q < line.length; q += 1) {
			const x = bx + (off + q + 0.5) * c;
			const y = by + (r + 1) * c;
			const d = 0.05 + idx * 0.055;
			const ep = inB(t, 0.32, d, 1.8);
			const i = idx;
			idx += 1;
			if (ep <= 0) continue;
			const aa = clamp(ep * 3) * a;
			const w2 = c * 0.39;
			const h2 = c * 0.44;
			pose(ctx, x, y, { s: lerpN(1.7, 1, ep), rot: (ru(seed, i, 4) * 2 - 1) * 3 }, () => {
				const pts: (readonly [number, number])[] = [
					[x, y - h2],
					[x + w2 * 0.74, y - h2 * 0.58],
					[x + w2, y + h2],
					[x - w2, y + h2],
					[x - w2 * 0.74, y - h2 * 0.58],
				];
				waPoly(
					ctx,
					pointsShift(pts, c * 0.03, c * 0.045),
					mix(frame.palette.foreground, frame.palette.background, 0.65),
					aa * 0.35,
				);
				waPoly(ctx, pts, paper, aa);
				waStroke(ctx, [...pts, pts[0]!], mix(paper, ink, 0.45), lw * 2, aa);
				waLabel({ options,
					alpha: aa,
					color: i === redI ? frame.palette.accent : ink,
					size: c * 0.5,
					text: line[q]!,
					x,
					y: y + c * 0.06,
				});
			});
		}
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- Point-list shift mirrors the source shadow offset.
function pointsShift(
	points: readonly (readonly [number, number])[],
	dx: number,
	dy: number,
): (readonly [number, number])[] {
	return points.map(([x, y]) => [x + dx, y + dy] as const);
}

/** のし紙 — gift wrapping paper: a red-and-white cord runs across and ties itself into a bow above the line. */
function drawWzNoshi(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt } = waLayoutBase(options);
	const pw = W * (port ? 0.9 : 0.84);
	const ph = H * (port ? 0.56 : 0.76);
	const cx = W / 2;
	const cy = H / 2;
	const x0 = cx - pw / 2;
	const y0 = cy - ph / 2;
	const knot = ["cho", "cho", "kiri"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "cho";
	const emblem = layoutUnit(seed, 2) < 0.75;
	const ns = 3 + Math.floor(layoutUnit(seed, 3) * 3);
	const cA = frame.palette.accent;
	const cB = frame.palette.secondary;
	const ky = y0 + ph * 0.3;
	const sp = ph * 0.011;
	const e = inE(t, 0.45);
	const a = inC(t, 0.2) * (1 - inCubic(out));
	if (a <= 0.01) return;
	const e1 = inOutCubic((t - 0.1) / 0.45);
	const e2 = inB(t, 0.5, 0.42, 1.5);
	pose(ctx, cx, cy, { s: 0.95 + 0.05 * e, dy: (1 - e) * M * 0.03 }, () => {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = mix(frame.palette.foreground, frame.palette.background, 0.7);
		ctx.fillRect(x0 + M * 0.01, y0 + M * 0.014, pw, ph);
		ctx.fillStyle = frame.palette.background;
		ctx.fillRect(x0, y0, pw, ph);
		ctx.restore();
		for (let s = 0; s < ns; s += 1) {
			const yy = ky + (s - (ns - 1) / 2) * sp * 2;
			ctx.save();
			ctx.globalAlpha *= a;
			ctx.fillStyle = cB;
			ctx.fillRect(x0, yy - sp * 0.5, (pw / 2) * e1, sp);
			ctx.fillStyle = cA;
			ctx.fillRect(x0 + pw - (pw / 2) * e1, yy - sp * 0.5, (pw / 2) * e1, sp);
			ctx.restore();
		}
		if (e2 > 0) {
			const u = ph * 0.2 * e2;
			for (let s = 0; s < 3; s += 1) {
				const q = 1 - s * 0.16;
				if (knot === "kiri") {
					for (const d of [-1, 1]) {
						waStroke(
							ctx,
							sampleQuadratic(
								cx,
								ky,
								cx + d * u * 0.5 * q,
								ky - u * 0.2,
								cx + d * u * (0.75 + s * 0.12),
								ky - u * (1 - s * 0.1),
								12,
							),
							d < 0 ? cA : cB,
							sp,
							a * clamp(e2 * 3),
						);
					}
					waStroke(
						ctx,
						ellipsePoints(cx, ky, u * 0.42 * q, u * 0.3 * q, 0, 0, TAU, 20),
						s % 2 ? cA : cB,
						sp,
						a * clamp(e2 * 3),
					);
				} else {
					for (const d of [-1, 1]) {
						waStroke(
							ctx,
							sampleCubic(
								cx,
								ky,
								cx + d * u * 0.5 * q,
								ky - u * 1.25 * q,
								cx + d * u * 1.75 * q,
								ky - u * 0.75 * q,
								cx + d * u * 1.3 * q,
								ky - u * 0.05,
								16,
							).concat(
								sampleCubic(
									cx + d * u * 1.3 * q,
									ky - u * 0.05,
									cx + d * u * 0.95 * q,
									ky + u * 0.3 * q,
									cx + d * u * 0.4,
									ky + u * 0.12,
									cx,
									ky,
									16,
								),
							),
							d < 0 ? cA : cB,
							sp,
							a * clamp(e2 * 3),
						);
						waStroke(
							ctx,
							sampleQuadratic(
								cx,
								ky,
								cx + d * u * 0.25,
								ky + u * 0.6,
								cx + d * u * (0.75 + s * 0.14),
								ky + u * (0.95 - s * 0.05),
								10,
							),
							d < 0 ? cB : cA,
							sp,
							a * clamp(e2 * 3),
						);
					}
				}
			}
			ctx.save();
			ctx.globalAlpha *= a * clamp(e2 * 3);
			ctx.fillStyle = cA;
			ctx.fillRect(cx - u * 0.11, ky - u * 0.2, u * 0.22, u * 0.4);
			ctx.restore();
		}
		if (emblem) {
			const eh = ph * 0.17 * inB(t, 0.4, 0.5);
			const ew = eh * 0.34;
			const ex = x0 + pw * (port ? 0.88 : 0.91);
			const ey = y0 + ph * 0.14;
			waPoly(
				ctx,
				[
					[ex - ew / 2, ey - eh * 0.36],
					[ex, ey - eh / 2],
					[ex + ew / 2, ey - eh * 0.36],
					[ex + ew * 0.3, ey + eh / 2],
					[ex - ew * 0.3, ey + eh / 2],
				],
				cA,
				a,
			);
			ctx.save();
			ctx.globalAlpha *= a;
			ctx.fillStyle = cB === cA ? frame.palette.background : cB;
			ctx.fillRect(ex - ew * 0.09, ey - eh * 0.4, ew * 0.18, eh * 0.86);
			ctx.restore();
		}
		const lines = waColumns(txt, port ? 3 : 2);
		const size = Math.min(
			waFitSize({ boxHeight: ph * 0.42, boxWidth: pw * 0.84, lines }),
			ph * 0.3,
		);
		waDrawLines({
			color: frame.palette.foreground,
			lines,
			maxWidth: pw * 0.84,
			options,
			size,
			x: cx,
			y: y0 + ph * 0.69,
		});
	});
}

/** 源氏雲 — stepped cloud bands with round ends slide in from both sides; the line sits in the gap between them. */
function drawWzGenjiGumo(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt } = waLayoutBase(options);
	const gapH = H * (port ? 0.36 : 0.4);
	const bhh = M * 0.07;
	const colFg = layoutUnit(seed, 1) < 0.34;
	const side = ["diag", "anti", "both"][Math.floor(layoutUnit(seed, 2) * 3)] ?? "both";
	const dust = layoutUnit(seed, 3) < 0.7;
	const sd = 1 + Math.floor(layoutUnit(seed, 4) * 999_999);
	const c1 = colFg
		? mix(frame.palette.background, frame.palette.foreground, 0.2)
		: mix(frame.palette.background, frame.palette.accent, 0.72);
	const c2 = mix(c1, frame.palette.background, 0.4);
	const dustC = mix(c1, frame.palette.foreground, 0.35);
	const outK = 1 - inCubic(out);
	for (const top of [1, 0]) {
		const rows = Math.min(14, Math.ceil((H - gapH) / 2 / bhh) + 1);
		for (let r = 0; r < rows; r += 1) {
			const f = r / Math.max(1, rows - 1);
			const fromL =
				side === "both"
					? ru(sd, top, r, 1) < 0.5
					: (side === "diag") === Boolean(top);
			const len =
				W *
				clampRange(
					0.16 + 0.75 * f ** 0.8 + 0.22 * (ru(sd, top, r, 2) * 2 - 1),
					0.1,
					1.05,
				);
			const e = inE(t, 0.7, 0.03 * (rows - r)) * outK;
			const drift = Math.sin(t * 0.5 + r * 1.3 + top * 2) * W * 0.012 * 0.6;
			const ll = len * e + drift * e;
			if (ll <= 2) continue;
			const y = top
				? H / 2 - gapH / 2 - (r + 1) * bhh
				: H / 2 + gapH / 2 + r * bhh;
			const col = (r + top) % 3 === 2 ? c2 : c1;
			const bx = fromL ? -bhh : W - ll;
			const barH = bhh + 1;
			const rr = barH / 2;
			ctx.save();
			ctx.globalAlpha *= outK;
			ctx.fillStyle = col;
			ctx.fillRect(bx + rr, y, ll, barH);
			ctx.restore();
			waDisc(ctx, fromL ? bx + rr : bx + ll + rr, y + rr, rr, col, outK);
			waDisc(ctx, fromL ? bx + ll + rr : bx + rr, y + rr, rr, col, outK);
			if (dust && r < 4) {
				for (let d = 0; d < 3; d += 1) {
					const dx =
						(fromL ? ll : W - ll) +
						(fromL ? 1 : -1) * bhh * (0.4 + 1.6 * ru(sd, r, d, top));
					const ds = M * (0.004 + 0.006 * ru(sd, d, r, 9));
					ctx.save();
					ctx.globalAlpha *= 0.8 * e;
					ctx.fillStyle = dustC;
					ctx.fillRect(dx, y + bhh * ru(sd, d, r, 5), ds, ds);
					ctx.restore();
				}
			}
		}
	}
	const lines = waColumns(txt, port ? 4 : 2);
	const size = Math.min(
		waFitSize({ boxHeight: gapH * 0.72, boxWidth: W * 0.84, lines }),
		gapH * 0.5,
	);
	waDrawLines({
		color: frame.palette.foreground,
		lines,
		maxWidth: W * 0.84,
		options,
		size,
		x: W / 2,
		y: H / 2,
	});
}

/** 鳥居 — a shrine gate is raised (pillars, tie beam, curved top beam); the line stands between its pillars or beside it. */
function drawWzTorii(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const side = ["in", "in", "side"][Math.floor(layoutUnit(seed, 1) * 3)] === "side";
	const sun = layoutUnit(seed, 2) < 0.5;
	const flip = layoutUnit(seed, 3) < 0.5;
	let gw: number;
	let gh: number;
	let cx: number;
	let y1: number;
	if (!side) {
		gw = port ? W * 0.9 : Math.min(W * 0.68, H * 1.2);
		gh = port ? H * 0.6 : H * 0.84;
		cx = W / 2;
		y1 = H / 2 + gh / 2;
	} else if (port) {
		gw = W * 0.62;
		gh = H * 0.36;
		cx = W / 2;
		y1 = H * 0.46;
	} else {
		gw = Math.min(W * 0.36, H * 0.7);
		gh = H * 0.66;
		cx = flip ? W * 0.76 : W * 0.24;
		y1 = H / 2 + gh / 2;
	}
	const y0 = y1 - gh;
	const red = frame.palette.accent;
	const cap = mix(frame.palette.foreground, red, 0.15);
	const a = inC(t, 0.15) * (1 - inCubic(out));
	if (a <= 0.01) return;
	const pwd = gw * 0.058;
	const e1 = inE(t, 0.5);
	const e2 = inE(t, 0.45, 0.18);
	const e3 = inB(t, 0.45, 0.3, 1.3);
	if (sun) {
		waDisc(ctx, cx, y0 + gh * 0.42, gw * 0.3 * inE(t, 0.7), frame.palette.secondary, a * 0.8);
	}
	ctx.save();
	ctx.globalAlpha *= a * 0.7;
	ctx.fillStyle = frame.palette.secondary;
	ctx.fillRect(cx - gw * 0.62 * e1, y1, gw * 1.24 * e1, lw * 2);
	ctx.restore();
	for (const s of [-1, 1]) {
		const xb = cx + s * gw * 0.36;
		const xt = cx + s * gw * 0.335;
		const top = lerpN(y1, y0 + gh * 0.09, e1);
		const xtt = lerpN(xb, xt, e1);
		waPoly(
			ctx,
			[
				[xb - pwd / 2, y1],
				[xb + pwd / 2, y1],
				[xtt + pwd * 0.44, top],
				[xtt - pwd * 0.44, top],
			],
			red,
			a,
		);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = cap;
		ctx.fillRect(xb - pwd * 0.75, y1 - gh * 0.045 * e1, pwd * 1.5, gh * 0.045 * e1);
		ctx.restore();
	}
	const ny = y0 + gh * 0.25;
	const nh = gh * 0.05;
	ctx.save();
	ctx.globalAlpha *= a;
	ctx.fillStyle = red;
	ctx.fillRect(cx - gw * 0.43 * e2, ny, gw * 0.86 * e2, nh);
	ctx.restore();
	if (e3 > 0) {
		const dy = -(1 - e3) * gh * 0.22;
		const th1 = gh * 0.04;
		const th2 = gh * 0.05;
		// eslint-disable-next-line opencut/prefer-object-params -- Compact per-call beam curve scalars.
		const curve = (hw: number, yy: number, up: number) =>
			Array.from({ length: 13 }, (_, index) => {
				const u = (index / 12) * 2 - 1;
				return [cx + u * hw, yy - up * u * u + dy] as const;
			});
		const topE = curve(gw * 0.5, y0 + gh * 0.035, gh * 0.035);
		const botE = curve(gw * 0.485, y0 + gh * 0.035 + th1, gh * 0.03).reverse();
		const top2 = curve(gw * 0.47, y0 + gh * 0.035 + th1, gh * 0.03);
		const bot2 = curve(gw * 0.455, y0 + gh * 0.035 + th1 + th2, gh * 0.026).reverse();
		const aa = a * clamp(e3 * 3);
		waPoly(ctx, [...top2, ...bot2], red, aa);
		waPoly(ctx, [...topE, ...botE], cap, aa);
		const postTop = y0 + gh * 0.035 + th1 + th2 * 0.8 + dy;
		const postH = ny - postTop;
		ctx.save();
		ctx.globalAlpha *= aa;
		ctx.fillStyle = cap;
		ctx.fillRect(cx - gw * 0.035, postTop, gw * 0.07, postH);
		ctx.restore();
		waStroke(
			ctx,
			[
				[cx - gw * 0.035, postTop],
				[cx + gw * 0.035, postTop],
				[cx + gw * 0.035, postTop + postH],
				[cx - gw * 0.035, postTop + postH],
				[cx - gw * 0.035, postTop],
			],
			red,
			lw * 2,
			aa,
		);
	}
	const lines = !side
		? waColumns(txt, port ? 4 : 3)
		: port
			? waColumns(txt, 4)
			: waColumns(txt, 3);
	if (!side) {
		const tb = ny + nh + gh * 0.04;
		const size = Math.min(
			waFitSize({
				boxHeight: (y1 - gh * 0.07 - tb) * 0.9,
				boxWidth: gw * 0.6,
				lines,
			}),
			gh * 0.3,
		);
		waDrawLines({
			color: frame.palette.foreground,
			lines,
			maxWidth: gw * 0.6,
			options,
			size,
			x: cx,
			y: (tb + y1 - gh * 0.07) / 2,
		});
	} else if (port) {
		const size = Math.min(
			waFitSize({ boxHeight: H * 0.34, boxWidth: W * 0.86, lines }),
			H * 0.14,
		);
		waDrawLines({
			color: frame.palette.foreground,
			lines,
			maxWidth: W * 0.86,
			options,
			size,
			x: W / 2,
			y: H * 0.71,
		});
	} else {
		const size = Math.min(
			waFitSize({ boxHeight: H * 0.6, boxWidth: W * 0.52, lines }),
			H * 0.26,
		);
		waDrawLines({
			color: frame.palette.foreground,
			lines,
			maxWidth: W * 0.52,
			options,
			size,
			x: flip ? W * 0.33 : W * 0.67,
			y: H / 2,
		});
	}
}

/** 団扇 — a round paper fan swings in on its handle and keeps fanning gently; the line is printed on its face. */
function drawWzUchiwa(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, out, port, seed, t, txt, lw } = waLayoutBase(options);
	const ry = port ? Math.min(W * 0.36, H * 0.26) : H * 0.36;
	const rx = Math.min(ry * 1.3, W * 0.45);
	const cx = W / 2;
	const fy = H / 2 - ry * 0.24;
	const pat = ["nami", "maru", "plain"][Math.floor(layoutUnit(seed, 1) * 3)] ?? "plain";
	const colAccent = layoutUnit(seed, 2) < 0.34;
	const dir = layoutUnit(seed, 3) < 0.5 ? -1 : 1;
	const nr = 13 + Math.floor(layoutUnit(seed, 4) * 7);
	const fill = colAccent ? frame.palette.accent : frame.palette.background;
	const ink = fill === frame.palette.background ? frame.palette.foreground : frame.palette.background;
	const acc = frame.palette.accent === fill ? frame.palette.foreground : frame.palette.accent;
	const wood = mix(frame.palette.foreground, frame.palette.secondary, 0.5);
	const pvx = cx;
	const pvy = fy + ry * 0.98;
	const e = inB(t, 0.6, 0, 1.2);
	const a = inC(t, 0.2) * (1 - inCubic(out));
	if (a <= 0.01) return;
	const rot =
		dir * (1 - e) * 55 +
		Math.sin(t * 2.1) * 2.4 * 0.6 * clamp(t - 0.4) +
		dir * inCubic(out) * 30;
	pose(ctx, pvx, pvy + ry * 0.55, { rot }, () => {
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = wood;
		ctx.fillRect(pvx - ry * 0.045, pvy - ry * 0.1, ry * 0.09, ry * 0.72);
		ctx.restore();
		const face = arcPoints(cx, fy, rx, ry, 0, 360, 48);
		waPoly(ctx, pointsShift(face, M * 0.008, M * 0.012), mix(frame.palette.foreground, frame.palette.background, 0.72), a * 0.28);
		waPoly(ctx, face, fill, a);
		ctx.save();
		ctx.beginPath();
		if (ctx.arc) ctx.arc(cx, fy, Math.max(rx, ry), 0, TAU);
		else ctx.rect(cx - rx, fy - ry, rx * 2, ry * 2);
		ctx.clip();
		if (pat === "nami") {
			for (let b = 0; b < 2; b += 1) {
				const pts: (readonly [number, number])[] = [];
				for (let index = 0; index <= 40; index += 1) {
					const xx = cx - rx + (rx * 2 * index) / 40;
					pts.push([
						xx,
						fy + ry * (0.56 + b * 0.16) + Math.sin(index * 0.5 + b * 2 + t * 0.8 * 0.6) * ry * 0.05,
					]);
				}
				ctx.save();
				ctx.globalAlpha *= a * (b ? 0.55 : 0.3);
				ctx.fillStyle = acc;
				ctx.beginPath();
				if (ctx.moveTo && ctx.lineTo) {
					ctx.moveTo(cx - rx, fy + ry);
					for (const point of pts) ctx.lineTo(point[0], point[1]);
					ctx.lineTo(cx + rx, fy + ry);
					ctx.closePath?.();
					ctx.fill?.();
				} else {
					ctx.fillRect(cx - rx, fy + ry * 0.5, rx * 2, ry * 0.5);
				}
				ctx.restore();
			}
		} else if (pat === "maru") {
			waDisc(ctx, cx + rx * 0.5 * dir, fy - ry * 0.45, ry * 0.42, acc, a * 0.3);
		}
		ctx.globalAlpha *= a * 0.5;
		for (let index = 0; index < nr; index += 1) {
			const th = (-78 + (156 * index) / (nr - 1)) * degrees(1);
			waLine(
				ctx,
				pvx,
				pvy,
				pvx + Math.sin(th) * rx * 0.3,
				pvy - Math.cos(th) * ry * 0.3,
				mix(fill, ink, 0.25),
				lw * 1.6,
				1,
			);
		}
		ctx.restore();
		waStroke(ctx, face, mix(fill, ink, 0.5), lw * 2.5, a);
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = wood;
		ctx.fillRect(pvx - ry * 0.045, pvy - ry * 0.02, ry * 0.09, ry * 0.1);
		ctx.restore();
		waDisc(ctx, pvx, pvy, rx * 0.26, frame.palette.background, a);
		const lines = waColumns(txt, 3);
		const size = Math.min(
			waFitSize({ boxHeight: ry * 0.86, boxWidth: rx * 1.36, lines }),
			ry * 0.56,
		);
		waDrawLines({ color: ink, lines, maxWidth: rx * 1.36, options, size, x: cx, y: fy - ry * 0.1 });
	});
}

/** 簾 — a bamboo blind covers the screen, rolls up to uncover the line and comes down again at the end. */
function drawWzSudare(options: TypographyLayoutOptions): void {
	const { ctx, frame } = options;
	const { H, M, W, port, seed, t, txt, out, lw } = waLayoutBase(options);
	const two = layoutUnit(seed, 1) < 0.34;
	const lift = H * (0.24 + layoutUnit(seed, 2) * 0.08);
	const tassel = layoutUnit(seed, 3) < 0.8;
	const top = H * 0.045;
	const pitch = M * 0.02;
	const op = inOutCubic((t - 0.08) / 0.75) * (1 - inOutCubic(out));
	const yEnd = lift + (two ? H * 0.05 : 0) + pitch * 4.5;
	const lines = waColumns(txt, port ? 4 : 2);
	const size = Math.min(
		waFitSize({
			boxHeight: (H * 0.95 - yEnd) * 0.74,
			boxWidth: W * 0.84,
			lines,
		}),
		M * 0.3,
	);
	waDrawLines({
		color: frame.palette.foreground,
		lines,
		maxWidth: W * 0.84,
		options,
		size,
		x: W / 2,
		y: (yEnd + H * 0.95) / 2,
	});
	const slat = mix(frame.palette.background, frame.palette.secondary, 0.6);
	const back = mix(frame.palette.background, slat, 0.45);
	const thr = mix(slat, frame.palette.foreground, 0.55);
	const acc = frame.palette.accent;
	const a = clamp(t / 0.1) * (1 - clamp((out - 0.92) / 0.08));
	if (a <= 0.01) return;
	const blinds: (readonly [number, number, number])[] = two
		? [
				[W * 0.015, W * 0.475, 0],
				[W * 0.51, W * 0.475, H * 0.05],
			]
		: [[W * 0.015, W * 0.97, 0]];
	for (const [x, w, dl] of blinds) {
		const yb = lerpN(H * 0.985, lift + dl, op);
		const n = Math.min(120, Math.floor((yb - top) / pitch));
		ctx.save();
		ctx.globalAlpha *= a;
		ctx.fillStyle = back;
		ctx.fillRect(x, top, w, yb - top);
		ctx.fillStyle = slat;
		for (let index = 0; index < n; index += 1) {
			ctx.fillRect(x, top + index * pitch + pitch * 0.2, w, pitch * 0.6);
		}
		ctx.fillStyle = thr;
		for (const f of [0.08, 0.36, 0.64, 0.92]) {
			ctx.fillRect(x + w * f - lw, top, lw * 2, yb - top);
		}
		const rh = pitch * lerpN(1.4, 3.6, op);
		ctx.fillStyle = mix(slat, frame.palette.foreground, 0.25);
		ctx.fillRect(x - pitch * 0.3, yb - rh * 0.4, w + pitch * 0.6, rh);
		waDisc(ctx, x - pitch * 0.3 + (w + pitch * 0.6) / 2 - rh / 2, yb - rh * 0.4 + rh / 2, rh / 2, mix(slat, frame.palette.foreground, 0.25), a);
		waDisc(ctx, x - pitch * 0.3 + (w + pitch * 0.6) / 2 + rh / 2, yb - rh * 0.4 + rh / 2, rh / 2, mix(slat, frame.palette.foreground, 0.25), a);
		ctx.fillStyle = acc;
		ctx.fillRect(x - pitch * 0.2, top - pitch * 1.3, w + pitch * 0.4, pitch * 1.6);
		if (tassel) {
			for (const f of [0.22, 0.78]) {
				const tx = x + w * f;
				const ty = yb + rh * 0.6;
				ctx.fillRect(tx - lw * 1.5, top, lw * 3, ty - top + pitch);
				waDisc(ctx, tx, ty + pitch * 1.4, pitch * 0.55, acc, a);
				ctx.fillRect(
					tx - pitch * 0.42,
					ty + pitch * 1.7,
					pitch * 0.84,
					pitch * 2.2 * (0.4 + 0.6 * op),
				);
			}
		}
		ctx.restore();
	}
}

/* ================================================================== DECOR */

interface WaDecorDraw extends CoreDecorDraw {
	readonly layer?: CoreDecorLayer;
}

const WA_BACK_DECORS = new Set(["wzRyusui", "wzTake", "wzYukiwa"]);

export function drawX2WaDecor(options: WaDecorDraw): void {
	const decor = options.decor;
	if (!decor.startsWith("wz") || decor.startsWith("wzBg")) return;
	if (options.layer === "back" && !WA_BACK_DECORS.has(decor)) return;
	if (options.layer === "front" && WA_BACK_DECORS.has(decor)) return;
	options.ctx.save();
	try {
		switch (decor) {
			case "wzChidori":
				drawWzChidoriDecor(options);
				break;
			case "wzKazaguruma":
				drawWzKazagurumaDecor(options);
				break;
			case "wzMizuhiki":
				drawWzMizuhikiDecor(options);
				break;
			case "wzRyusui":
				drawWzRyusuiDecor(options);
				break;
			case "wzShippo":
				drawWzShippoDecor(options);
				break;
			case "wzTake":
				drawWzTakeDecor(options);
				break;
			case "wzUme":
				drawWzUmeDecor(options);
				break;
			case "wzUroko":
				drawWzUrokoDecor(options);
				break;
			case "wzYagasuri":
				drawWzYagasuriDecor(options);
				break;
			case "wzYukiwa":
				drawWzYukiwaDecor(options);
				break;
			default:
				break;
		}
	} finally {
		options.ctx.restore();
	}
}

interface WaDecorState {
	readonly alpha: number;
	readonly bounds: {
		readonly cx: number;
		readonly cy: number;
		readonly height: number;
		readonly width: number;
		readonly x0: number;
		readonly x1: number;
		readonly y0: number;
		readonly y1: number;
	};
	readonly mo: number;
	readonly n: number;
	readonly phase: number;
	readonly plan: ReturnType<typeof coreDecorPlan>;
	readonly seed: number;
	readonly t: number;
	readonly u: number;
	readonly v: number;
}

function waDecorState(draw: WaDecorDraw): WaDecorState {
	const bounds = coreDecorTextBounds(draw);
	const plan = coreDecorPlan(draw);
	return {
		alpha: decorInOut(draw.frame),
		bounds: {
			cx: (bounds.x0 + bounds.x1) / 2,
			cy: (bounds.y0 + bounds.y1) / 2,
			height: bounds.height,
			width: bounds.width,
			x0: bounds.x0,
			x1: bounds.x1,
			y0: bounds.y0,
			y1: bounds.y1,
		},
		mo: 0.6,
		n: Math.min(3, Math.max(1, plan.count)),
		phase: draw.frame.sequenceTime / TICKS,
		plan,
		seed: plan.seed,
		t: localSeconds(draw.frame),
		u: Math.min(draw.width, draw.height) / 1080,
		v: plan.from,
	};
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source packs' delayed entrance ease.
function ein(t: number, d = 0.4, delay = 0, ease = oExpo): number {
	return ease((t - delay) / d);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source packs' delayed entrance ease.
function eback(t: number, d = 0.4, delay = 0, s = 1.6): number {
	return inB(t, d, delay, s);
}

// eslint-disable-next-line opencut/prefer-object-params -- The draw frame and the derived decor state are distinct operands.
function decorColor(draw: WaDecorDraw, state: WaDecorState): string {
	return state.plan.accent ? draw.frame.palette.accent : draw.frame.palette.foreground;
}

function decorAccent(draw: WaDecorDraw): string {
	return draw.frame.palette.accent;
}

/** 七宝 — a window (round, band or panel) of interlocking circles that wipes open; the knots pulse. */
function drawWzShippoDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, phase, t, u } = state;
	if (o <= 0.004) return;
	const r = 30 * u * (state.plan.big ? 1.3 : 1);
	const shape = state.v % 3;
	const w0 =
		shape === 0 ? r * 6.2 : shape === 1 ? clamp(bb.width * 0.8) : r * 8;
	const h0 = shape === 0 ? r * 6.2 : shape === 1 ? r * 3 : r * 4.4;
	const spot = waSpotFit(draw, bb, w0, h0, 26 * u);
	if (!spot) return;
	const w = w0 * spot.k;
	const h = h0 * spot.k;
	const x0 = spot.x;
	const y0 = spot.y;
	const e = ein(t, 0.6, 0, inOutCubic);
	const c = decorColor(draw, state);
	const ac = state.plan.accent ? draw.frame.palette.foreground : decorAccent(draw);
	const ox = wrap(phase * 7 * u * mo, 2 * r) - 2 * r;
	const ni = Math.min(60, Math.ceil(w / r) + 3);
	const nj = Math.min(40, Math.ceil(h / r) + 3);
	const outline = () => {
		ctx.beginPath();
		if (shape === 0) {
			if (ctx.arc) ctx.arc(x0 + w / 2, y0 + h / 2, (w / 2) * e, 0, TAU);
			else ctx.rect(x0, y0, w * e, h);
		} else if (ctx.rect) {
			ctx.rect(
				state.plan.right ? x0 + w * (1 - e) : x0,
				y0,
				w * e,
				h,
			);
		}
	};
	outline();
	ctx.save();
	ctx.clip();
	for (let j = -1; j < nj; j += 1) {
		for (let i = -2; i < ni; i += 1) {
			if ((i + j) & 1) continue;
			const x = x0 + i * r + ox;
			const y = y0 + j * r;
			waStroke(ctx, arcPoints(x, y, r, r, 0, 360, 24), c, 2 * u, 0.85 * o);
		}
	}
	for (let j = -1; j < nj; j += 1) {
		for (let i = -2; i < ni; i += 1) {
			if ((i + j) & 1) continue;
			const x = x0 + i * r + ox;
			const y = y0 + j * r;
			const d = r * 0.17 * (1 + 0.35 * Math.sin(phase * 2.2 + (i + j) * 0.7));
			waDisc(ctx, x, y, d, ac, o);
		}
	}
	ctx.restore();
	outline();
	waStroke(ctx, arcPoints(x0 + w / 2, y0 + h / 2, Math.max(0.1, (w / 2) * e), Math.max(0.1, (w / 2) * e), 0, 360, 28), c, 3 * u, o);
}

/** 矢絣 — strips of arrow-feather chevrons beside the lyric (above / below it when the sides are full), scrolling in opposite directions. */
function drawWzYagasuriDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const m = Math.min(draw.width, draw.height) * 0.05 * 0.7;
	const sw = 46 * u * (plan.big ? 1.3 : 1);
	const gap = 14 * u;
	const g0 = 30 * u;
	let horiz = false;
	let plus = plan.right;
	const fr = [
		draw.width - m - bb.x1 - g0,
		bb.x0 - g0 - m,
		draw.height - m - bb.y1 - g0,
		bb.y0 - g0 - m,
	];
	if ((plus ? fr[0]! : fr[1]!) < sw) plus = !plus;
	let free = plus ? fr[0]! : fr[1]!;
	if (free < sw) {
		horiz = true;
		plus = plan.low;
		if ((plus ? fr[2]! : fr[3]!) < sw) plus = !plus;
		free = plus ? fr[2]! : fr[3]!;
		if (free < sw) return;
	}
	const count = Math.max(1, Math.min(n, Math.floor((free + gap) / (sw + gap))));
	const h = horiz
		? clamp(bb.width * 1.02)
		: clamp(bb.height * 1.25);
	const mid = clamp(horiz ? bb.cx : bb.cy);
	const c = decorColor(draw, state);
	const ph = sw * 0.8;
	const e0 = horiz ? (plus ? bb.y1 : bb.y0) : plus ? bb.x1 : bb.x0;
	for (let k = 0; k < count; k += 1) {
		const ec = e0 + (plus ? 1 : -1) * (g0 + sw / 2 + k * (sw + gap));
		const e = ein(t, 0.55, k * 0.09);
		const hh = h * e;
		const dir = k % 2 ? -1 : 1;
		if (hh < 2) continue;
		ctx.save();
		if (horiz) {
			ctx.translate(mid, ec);
			ctx.rotate(-PI / 2);
		} else {
			ctx.translate(ec, mid);
		}
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * o;
		ctx.fillStyle = c;
		ctx.fillRect(-sw / 2 - 3 * u, -hh / 2, 2 * u, hh);
		ctx.fillRect(-sw / 2 + sw + u, -hh / 2, 2 * u, hh);
		ctx.globalAlpha = baseAlpha;
		ctx.save();
		ctx.beginPath();
		ctx.rect(-sw / 2, -hh / 2, sw, hh);
		ctx.clip();
		const off = wrap(phase * 22 * u * mo * dir, ph * 2);
		const sl = dir * sw * 0.5;
		const gp = 1.5 * u;
		for (
			let r = 0, y = -h / 2 - ph * 6 + off;
			r < 80 && y < h / 2 + ph * 2;
			r += 1, y += ph * 2
		) {
			waPoly(
				ctx,
				[
					[-sw / 2, y],
					[-gp, y + sl],
					[-gp, y + sl + ph],
					[-sw / 2, y + ph],
				],
				k === 1 && !plan.accent ? decorAccent(draw) : c,
				0.85 * o,
			);
			waPoly(
				ctx,
				[
					[sw / 2, y],
					[gp, y + sl],
					[gp, y + sl + ph],
					[sw / 2, y + ph],
				],
				k === 1 && !plan.accent ? decorAccent(draw) : c,
				0.85 * o,
			);
		}
		ctx.restore();
		ctx.restore();
	}
}

/** 鱗 — rows of scale triangles under (or over) the lyric that pop up one by one and shimmer. */
function drawWzUrokoDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const m = Math.min(draw.width, draw.height) * 0.05 * 0.7;
	const b = 42 * u * (plan.big ? 1.3 : 1);
	const th = b * 0.82;
	const g0 = 24 * u;
	const roomB = draw.height - m - bb.y1 - g0;
	const roomT = bb.y0 - g0 - m;
	let low = plan.low;
	if ((low ? roomB : roomT) < th) low = !low;
	const room = low ? roomB : roomT;
	if (room < th) return;
	const rows = Math.max(1, Math.min(n, Math.floor(room / th)));
	const wd = clamp(bb.width);
	const count = Math.min(48, Math.floor(wd / b));
	const x0 = clamp(bb.cx - (count * b) / 2);
	const c = decorColor(draw, state);
	const ac = plan.accent ? draw.frame.palette.foreground : decorAccent(draw);
	for (let r = 0; r < rows; r += 1) {
		const cnt = count - (r % 2);
		const yb = low ? bb.y1 + g0 + (r + 1) * th : bb.y0 - g0 - r * th;
		for (let index = 0; index < cnt; index += 1) {
			const idx = plan.right ? cnt - 1 - index : index;
			const e = eback(t, 0.3, idx * 0.022 + r * 0.1) * o;
			if (e <= 0) continue;
			const cx = x0 + (index + 0.5 + (r % 2) * 0.5) * b;
			const cyy = yb - th / 3;
			const hw = (b / 2) * e;
			const baseAlpha = ctx.globalAlpha;
			ctx.globalAlpha =
				baseAlpha * Math.min(1, o * (0.62 + 0.38 * Math.sin(phase * 3 * (0.4 + mo) - idx * 0.5 - r)));
			ctx.fillStyle = r % 2 ? ac : c;
			waPoly(
				ctx,
				[
					[cx, cyy - ((th * 2) / 3) * e],
					[cx + hw, cyy + (th / 3) * e],
					[cx - hw, cyy + (th / 3) * e],
				],
				r % 2 ? ac : c,
				1,
			);
			ctx.globalAlpha = baseAlpha;
		}
	}
}

/** 水引 — a red-and-white cord knot (three interlocked loops and two tails) tying itself beside the lyric. */
function drawWzMizuhikiDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const s0 = 112 * u * (plan.big ? 1.25 : 1);
	const spot = waSpotFit(draw, bb, s0 * 3.1, s0 * 2.1, 26 * u);
	if (!spot) return;
	const s = s0 * spot.k;
	const cx = spot.x + s * 1.55;
	const cy = spot.y + s * 1.1 + Math.sin(phase * 1.4) * 3 * u * 0.6;
	const cA = decorAccent(draw);
	const cB =
		draw.frame.palette.foreground === cA
			? draw.frame.palette.secondary
			: draw.frame.palette.foreground;
	const e1 = ein(t, 0.7, 0, inOutCubic);
	const e2 = ein(t, 0.5, 0.35);
	for (let k = 0; k < 3; k += 1) {
		const q = 1 - k * 0.17;
		for (const d of [-1, 1]) {
			const stroke = d < 0 ? cA : cB;
			waStroke(
				ctx,
				ellipsePoints(
					cx + d * s * 0.47,
					cy + s * 0.1,
					s * 0.5 * q,
					s * 0.37 * q,
					d * 0.42,
					d < 0 ? 0 : 180,
					(d < 0 ? 0 : 180) + TAU * e1,
					24,
				),
				stroke,
				4.2 * u * Math.max(0.7, spot.k),
				o,
			);
			if (e2 > 0) {
				waStroke(
					ctx,
					sampleQuadratic(
						cx + d * s * 0.2,
						cy + s * 0.42,
						cx + d * s * (0.9 + k * 0.05),
						cy + s * (0.75 - k * 0.1),
						cx + d * lerpN(0.2, 1.4 + k * 0.05, e2) * s,
						cy + lerpN(0.42, -0.15 - k * 0.14, e2 * e2) * s,
						12,
					),
					stroke,
					4.2 * u * Math.max(0.7, spot.k),
					o,
				);
			}
		}
		waStroke(
			ctx,
			ellipsePoints(
				cx,
				cy - s * 0.3,
				s * 0.52 * q,
				s * 0.42 * q,
				0,
				90,
				90 + TAU * e1,
				24,
			),
			k % 2 ? cA : cB,
			4.2 * u * Math.max(0.7, spot.k),
			o,
		);
	}
}

/** 流水 — bundles of staggered parallel water lines flowing behind the lower edge of the lyric, each ending in a curl. */
function drawWzRyusuiDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const L = 3 + n;
	const xa = Math.max(-20 * u, bb.x0 - 200 * u);
	const xb = Math.min(draw.width + 20 * u, bb.x1 + 200 * u);
	const len = xb - xa;
	const sp = 26 * u * (plan.big ? 1.3 : 1);
	const sub = draw.frame.palette.secondary;
	const y0 = (plan.low ? bb.y1 : bb.y0) - ((L - 1) * sp) / 2;
	const lam = 150 * u;
	const A = 15 * u;
	const ph = phase * 0.9 * (0.3 + mo) * (plan.right ? -1 : 1);
	for (let index = 0; index < L; index += 1) {
		const s0 = xa + len * 0.28 * randomUnit({ seed: plan.seed, salt: index * 7 + 1 });
		const s1 = xb - len * 0.28 * randomUnit({ seed: plan.seed, salt: index * 7 + 2 });
		const e = ein(t, 0.8, index * 0.07, inOutCubic);
		const xe = lerpN(s0, s1, e);
		if (xe - s0 < 4) continue;
		const yy = (x: number) =>
			y0 +
			index * sp +
			A * Math.sin(x / lam + ph + index * 0.25) +
			A * 0.4 * Math.sin((x / lam) * 2.3 - ph * 0.7);
		const pts: (readonly [number, number])[] = [[s0, yy(s0)]];
		for (let x = s0 + 14 * u, g = 0; x < xe && g < 400; x += 14 * u, g += 1) {
			pts.push([x, yy(x)]);
		}
		const ex = xe;
		const ey = yy(xe);
		pts.push([ex, ey]);
		if (index % 2 === 0) {
			const cr = 16 * u * e;
			for (let a = 0; a <= 16; a += 1) {
				const an = (a / 16) * 4.6;
				const rr = cr * (1 - a / 22);
				pts.push([
					ex + Math.sin(an) * rr,
					ey - cr + Math.cos(an) * rr + (cr - rr) * 0.4,
				]);
			}
		}
		waStroke(
			ctx,
			pts,
			index === 1 ? decorAccent(draw) : sub,
			(index % 2 ? 2.6 : 3.8) * u,
			(index === 1 ? 0.8 : 0.55) * o,
		);
	}
}

/** 雪輪 — notched snow-ring crests that bloom around the lyric and turn slowly. */
function drawWzYukiwaDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const count = 2 + n;
	const m = Math.min(draw.width, draw.height) * 0.05;
	const c = decorColor(draw, state);
	for (let k = 0; k < count; k += 1) {
		const R =
			(46 + 60 * randomUnit({ seed: plan.seed, salt: k * 5 + 1 })) *
			u *
			(plan.big ? 1.3 : 1);
		const a =
			((k / count + 0.5) * TAU + (randomSigned({ seed: plan.seed, salt: k * 5 + 2 }) * 0.3));
		const e = eback(t, 0.5, k * 0.1, 1.3);
		if (e <= 0) continue;
		const x = Math.min(
			Math.max(m + R, bb.cx + Math.cos(a) * (bb.width / 2 + R * 1.05)),
			draw.width - m - R,
		);
		const y =
			Math.min(
				Math.max(m + R, bb.cy + Math.sin(a) * (bb.height / 2 + R * 1.05)),
				draw.height - m - R,
			) + Math.sin(phase * 0.9 + k * 2) * 6 * u * mo;
		const rot = (k % 2 ? -1 : 1) * phase * 0.16 * (0.3 + mo) + k;
		const ring = yukiwaPoints(x, y, R * e, rot);
		waPoly(ctx, ring, c, 0.12 * o);
		waStroke(ctx, ring, c, 2.2 * u, 0.6 * o);
		const spokes: (readonly [number, number])[] = [];
		for (let index = 0; index < 6; index += 1) {
			const an = rot + (index / 6) * TAU;
			spokes.push([
				x + Math.cos(an) * R * 0.2 * e,
				y + Math.sin(an) * R * 0.2 * e,
			]);
			spokes.push([
				x + Math.cos(an) * R * 0.62 * e,
				y + Math.sin(an) * R * 0.62 * e,
			]);
		}
		waStroke(ctx, spokes, k === 0 ? decorAccent(draw) : c, 2 * u, 0.5 * o);
		waDisc(ctx, x, y, R * 0.1 * e, k === 0 ? decorAccent(draw) : c, 0.5 * o);
	}
}

/** 千鳥 — a flock of plump plover silhouettes flapping along an arc over the lyric. */
function drawWzChidoriDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const m = Math.min(draw.width, draw.height) * 0.035;
	const count = 2 + n;
	const sz = 44 * u * (plan.big ? 1.25 : 1);
	const need = sz * 2.9;
	let up = !plan.low;
	if ((up ? bb.y0 - m : draw.height - m - bb.y1) < need) up = !up;
	if ((up ? bb.y0 - m : draw.height - m - bb.y1) < need) return;
	const yb = up ? bb.y0 - sz * 1.1 : bb.y1 + sz * 1.9;
	const xa = Math.max(m + sz, bb.x0 - 60 * u);
	const xb = Math.min(draw.width - m - sz, bb.x1 + 60 * u);
	const dir = plan.right ? 1 : -1;
	const c = decorColor(draw, state);
	for (let k = 0; k < count; k += 1) {
		const f = wrap((k + 0.5) / count + phase * 0.03 * (0.3 + mo), 1);
		const e =
			eback(t, 0.4, k * 0.08) * o * clamp(Math.sin(f * PI) * 4);
		if (e <= 0.01) continue;
		const x = dir > 0 ? lerpN(xa, xb, f) : lerpN(xb, xa, f);
		const y =
			yb -
			Math.sin(f * PI) * sz * 0.6 * (up ? 1 : -0.5) +
			Math.sin(phase * 2.3 + k * 1.7) * 5 * u * mo;
		const s = sz * (0.8 + 0.4 * randomUnit({ seed: plan.seed, salt: k * 3 + 1 })) * e;
		const fl = 1 + 0.3 * Math.sin(phase * 7 * (0.4 + mo) + k * 2.1);
		ctx.save();
		ctx.translate(x, y);
		ctx.scale(dir * s, s);
		ctx.rotate(-0.15 + 0.1 * Math.sin(phase * 1.6 + k));
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * Math.min(1, e);
		const body = k === 1 ? decorAccent(draw) : c;
		waDisc(ctx, 0, 0, 0.5, body, 1);
		waPoly(
			ctx,
			[
				[0.4, -0.16],
				[0.92, -0.02],
				[0.4, 0.14],
			],
			body,
			1,
		);
		waPoly(
			ctx,
			[
				[-0.05, -0.3],
				[-0.5, -1.15 * fl],
				[0.32, -0.4],
			],
			body,
			1,
		);
		waPoly(
			ctx,
			[
				[-0.28, -0.25],
				[-1.2, -0.62 * fl],
				[-0.38, 0.12],
			],
			body,
			1,
		);
		waPoly(
			ctx,
			[
				[-0.36, 0.1],
				[-0.98, 0.42],
				[-0.25, 0.42],
			],
			body,
			1,
		);
		waDisc(ctx, 0.2, -0.12, 0.08, draw.frame.palette.background, 1);
		ctx.restore();
	}
}

/** 梅の枝 — an angular plum branch grows out of a corner and its five-petal blossoms open one by one. */
function drawWzUmeDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const S = 400 * u * (plan.big ? 1.25 : 1);
	const cb = waCornerBox(draw, bb, S, u);
	if (!cb) return;
	// eslint-disable-next-line opencut/prefer-object-params -- Compact branch-coordinate mapper.
	const X = (ux: number, uy: number): readonly [number, number] => [
		cb.x + cb.sx * ux * cb.w,
		cb.y + cb.sy * uy * cb.h,
	];
	const k = Math.min(cb.w, cb.h) / (400 * u);
	const br = draw.frame.palette.secondary;
	const c = decorAccent(draw);
	const paths: (readonly (readonly [number, number])[])[] = [
		[
			[0, 0.1],
			[0.3, 0.2],
			[0.5, 0.42],
			[0.78, 0.5],
			[0.93, 0.74],
		],
		[
			[0.3, 0.2],
			[0.44, 0.06],
			[0.66, 0.1],
		],
		[
			[0.5, 0.42],
			[0.42, 0.66],
			[0.52, 0.88],
		],
		[
			[0.78, 0.5],
			[0.95, 0.4],
		],
	];
	paths.forEach((pa, pi) => {
		const e =
			ein(t, 0.7, pi ? 0.25 + pi * 0.1 : 0, inOutCubic) * (pa.length - 1);
		if (e <= 0) return;
		for (let index = 0; index < pa.length - 1; index += 1) {
			const f = clamp(e - index);
			if (f <= 0) break;
			const a = X(pa[index]![0], pa[index]![1]);
			const b = X(pa[index + 1]![0], pa[index + 1]![1]);
			waLine(
				ctx,
				a[0],
				a[1],
				lerpN(a[0], b[0], f),
				lerpN(a[1], b[1], f),
				br,
				Math.max(1.5, (pi ? 7 : 13) * u * Math.max(0.5, k) * (1 - index * 0.2)),
				0.95 * o,
			);
		}
	});
	const fl: (readonly [number, number, number])[] = [
		[0.93, 0.74, 1],
		[0.66, 0.1, 0.9],
		[0.52, 0.88, 0.85],
		[0.5, 0.42, 0.75],
		[0.3, 0.2, 0.6],
		[0.95, 0.4, 0.7],
		[0.78, 0.5, 0.5],
		[0.42, 0.66, 0.45],
		[0.44, 0.06, 0.4],
	];
	fl.forEach((f, index) => {
		const e = eback(t, 0.4, 0.55 + index * 0.08) * o;
		if (e <= 0) return;
		const q = X(f[0], f[1]);
		const R = 34 * u * Math.max(0.6, k) * f[2] * e;
		const rot = index * 1.3 + Math.sin(phase * 1.2 + index) * 0.12 * 0.6;
		if (f[2] < 0.55) {
			waDisc(ctx, q[0], q[1], R * 0.75, c, o);
			return;
		}
		for (let j = 0; j < 5; j += 1) {
			const an = rot + (j / 5) * TAU;
			waDisc(
				ctx,
				q[0] + Math.cos(an) * R * 0.62,
				q[1] + Math.sin(an) * R * 0.62,
				R * 0.56,
				c,
				o,
			);
		}
		for (let j = 0; j < 5; j += 1) {
			const an = rot + ((j + 0.5) / 5) * TAU;
			waDisc(
				ctx,
				q[0] + Math.cos(an) * R * 0.34,
				q[1] + Math.sin(an) * R * 0.34,
				R * 0.07,
				draw.frame.palette.background,
				o,
			);
		}
		waDisc(ctx, q[0], q[1], R * 0.13, draw.frame.palette.background, o);
	});
}

/** 竹 — bamboo stalks grow up joint by joint in the margin beside the lyric; leaves sway at the joints. */
function drawWzTakeDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, bounds: bb, mo, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const g0 = 26 * u;
	const freeR = draw.width - bb.x1 - g0;
	const freeL = bb.x0 - g0;
	let right = plan.right;
	if (
		(right ? freeR : freeL) < 80 * u &&
		(right ? freeL : freeR) >= 80 * u
	) {
		right = !right;
	}
	const free = right ? freeR : freeL;
	const tight = free < 80 * u;
	const al = tight ? 0.26 : 0.9;
	const count = tight
		? Math.min(n, 2)
		: Math.max(1, Math.min(n, Math.floor((free - 20 * u) / (64 * u))));
	const c = decorColor(draw, state);
	const lc = plan.accent ? draw.frame.palette.foreground : decorAccent(draw);
	const dir = right ? -1 : 1;
	for (let k = 0; k < count; k += 1) {
		const x = (right ? draw.width : 0) + dir * (38 * u + k * 64 * u);
		const sw = (28 - k * 5) * u * (plan.big ? 1.25 : 1);
		const top =
			draw.height *
			(0.07 + 0.13 * k + 0.05 * randomUnit({ seed: plan.seed, salt: k * 4 + 1 }));
		const seg = (150 + 30 * randomUnit({ seed: plan.seed, salt: k * 4 + 2 })) * u;
		const full = draw.height - top;
		const hh = full * ein(t, 0.9, k * 0.12);
		const yTop = draw.height - hh;
		const baseAlpha = ctx.globalAlpha;
		ctx.globalAlpha = baseAlpha * al * o;
		ctx.fillStyle = c;
		for (
			let j = 0, y = draw.height + seg * 0.3 * randomUnit({ seed: plan.seed, salt: k * 4 + 3 });
			j < 20 && y > yTop;
			j += 1, y -= seg
		) {
			const y1 = Math.max(yTop, y - seg + 5 * u);
			if (y - y1 > 1) ctx.fillRect(x - sw / 2, y1, sw, y - y1);
			if (y - seg > yTop) {
				ctx.fillRect(x - sw * 0.62, y - seg - u, sw * 1.24, 5 * u);
			}
			if (
				j % 2 === k % 2 &&
				y - seg > yTop + 10 * u &&
				y - seg < draw.height - 40 * u
			) {
				const ly = y - seg + 2 * u;
				const le = clamp((hh - (draw.height - ly)) / (60 * u));
				const ll =
					(tight ? 90 * u : Math.min(120 * u, free - (38 + k * 64 + 4) * u)) * le;
				if (ll < 20 * u) continue;
				ctx.fillStyle = lc;
				for (let q = 0; q < 3; q += 1) {
					const an =
						(dir > 0 ? 0 : PI) +
						dir * (-0.3 + q * 0.45) +
						Math.sin(phase * 1.5 + k + q + j) * 0.07 * mo;
					const ca = Math.cos(an);
					const sa = Math.sin(an);
					const l2 = ll * (1 - q * 0.14);
					const wv = l2 * 0.15;
					waPoly(
						ctx,
						[
							[x, ly],
							[
								x + ca * l2 * 0.5 - sa * wv,
								ly + sa * l2 * 0.5 + ca * wv,
							],
							[x + ca * l2, ly + sa * l2],
							[
								x + ca * l2 * 0.5 + sa * wv,
								ly + sa * l2 * 0.5 - ca * wv,
							],
						],
						lc,
						1,
					);
				}
				ctx.fillStyle = c;
			}
		}
		ctx.globalAlpha = baseAlpha;
	}
}

/** 風車 — paper pinwheels on sticks that pop up beside the lyric and keep spinning. */
function drawWzKazagurumaDecor(draw: WaDecorDraw): void {
	const { ctx } = draw;
	const state = waDecorState(draw);
	const { alpha: o, n, phase, plan, t, u } = state;
	if (o <= 0.004) return;
	const s0 = 66 * u * (plan.big ? 1.25 : 1);
	const bounds = coreDecorTextBounds(draw);
	const bb = {
		cx: (bounds.x0 + bounds.x1) / 2,
		cy: (bounds.y0 + bounds.y1) / 2,
		height: bounds.height,
		width: bounds.width,
		x0: bounds.x0,
		x1: bounds.x1,
		y0: bounds.y0,
		y1: bounds.y1,
	};
	const spot = waSpotFit(draw, bb, n * s0 * 2.3, s0 * 3.5, 24 * u);
	if (!spot) return;
	const s = s0 * spot.k;
	const cA = decorAccent(draw);
	const cB =
		draw.frame.palette.foreground === cA
			? draw.frame.palette.secondary
			: draw.frame.palette.foreground;
	for (let k = 0; k < n; k += 1) {
		const cx = spot.x + s * 1.15 + k * s * 2.3;
		const cy = spot.y + s * (1.1 + (k % 2) * 0.35);
		const e = eback(t, 0.45, k * 0.12);
		if (e <= 0) continue;
		waLine(
			ctx,
			cx,
			cy,
			cx,
			cy + s * (2.3 - (k % 2) * 0.35) * ein(t, 0.4, k * 0.12),
			draw.frame.palette.secondary,
			4 * u * Math.max(0.7, spot.k),
			o,
		);
		const rot =
			(k % 2 ? -1 : 1) * (phase * 3.4 * (0.25 + 0.6) + (1 - ein(t, 1.2, k * 0.12)) * 5) + k;
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(rot);
		ctx.scale(e, e);
		for (let b = 0; b < 4; b += 1) {
			ctx.rotate(PI / 2);
			const blade = (b + k) % 2 ? cA : cB;
			waPoly(
				ctx,
				[
					[0, 0],
					[s, 0],
					[s * 0.5, s * 0.5],
				],
				blade,
				o,
			);
			waPoly(
				ctx,
				[
					[0, 0],
					[s * 0.5, s * 0.5],
					[0, s * 0.5],
				],
				blade,
				o * 0.55,
			);
		}
		waDisc(ctx, 0, 0, s * 0.13, draw.frame.palette.background, o);
		waDisc(ctx, 0, 0, s * 0.07, cA, o);
		ctx.restore();
	}
}

/* decor spot placement (JIZURA spot / spotFit / cornerBox) */

interface WaSpot {
	readonly x: number;
	readonly y: number;
	readonly ok: boolean;
}

// eslint-disable-next-line opencut/prefer-object-params -- Box test mirrors the source rect-overlap check.
function waHit(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	bb: WaDecorState["bounds"],
	pad: number,
): boolean {
	return !(x1 < bb.x0 - pad || x0 > bb.x1 + pad || y1 < bb.y0 - pad || y0 > bb.y1 + pad);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's spot(env, bb, w, h, p, gap) shape.
function waSpot(
	draw: WaDecorDraw,
	bb: WaDecorState["bounds"],
	w: number,
	h: number,
	gap: number,
): WaSpot {
	const { width: W, height: H } = draw;
	const m = Math.min(W, H) * 0.05 * 0.7;
	const plan = coreDecorPlan(draw);
	const sx = plan.right ? 1 : -1;
	const sy = plan.low ? 1 : -1;
	const near: (readonly [number, number])[] = [];
	const corner: (readonly [number, number])[] = [];
	for (const [a, b] of [
		[sx, sy],
		[-sx, sy],
		[sx, -sy],
		[-sx, -sy],
	] as const) {
		near.push([
			a > 0 ? bb.x1 + gap : bb.x0 - gap - w,
			clamp(bb.cy - h / 2),
		]);
		near.push([
			clamp(a > 0 ? bb.x1 - w : bb.x0),
			b > 0 ? bb.y1 + gap : bb.y0 - gap - h,
		]);
		corner.push([a > 0 ? W - m - w : m, b > 0 ? H - m - h : m]);
	}
	const all = plan.corner ? [...corner, ...near] : [...near, ...corner];
	for (const [x, y] of all) {
		if (x < m - 1 || y < m - 1 || x + w > W - m + 1 || y + h > H - m + 1) {
			continue;
		}
		if (!waHit(x, y, x + w, y + h, bb, gap * 0.4)) {
			return { ok: true, x, y };
		}
	}
	return { ok: false, x: 0, y: 0 };
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's spotFit(env, bb, w, h, p, gap) shape.
function waSpotFit(
	draw: WaDecorDraw,
	bb: WaDecorState["bounds"],
	w: number,
	h: number,
	gap: number,
): { readonly k: number; readonly x: number; readonly y: number } | null {
	for (const k of [1, 0.78, 0.6, 0.46]) {
		const spot = waSpot(draw, bb, w * k, h * k, gap * k);
		if (spot.ok) return { k, x: spot.x, y: spot.y };
	}
	return null;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's cornerBox(env, bb, p, S, u) shape.
function waCornerBox(
	draw: WaDecorDraw,
	bb: WaDecorState["bounds"],
	S: number,
	u: number,
): {
	readonly h: number;
	readonly sx: number;
	readonly sy: number;
	readonly w: number;
	readonly x: number;
	readonly y: number;
} | null {
	const { width: W, height: H } = draw;
	const plan = coreDecorPlan(draw);
	let best: {
		ax: number;
		ay: number;
		l: boolean;
		r: boolean;
		sc: number;
	} | null = null;
	for (const [r, l] of [
		[plan.right, plan.low],
		[!plan.right, plan.low],
		[plan.right, !plan.low],
		[!plan.right, !plan.low],
	] as const) {
		const ax = (r ? W - bb.x1 : bb.x0) - 22 * u;
		const ay = (l ? H - bb.y1 : bb.y0) - 22 * u;
		const sc = Math.max(ax, ay);
		if (!best || (sc > best.sc * 1.6 && best.sc < 150 * u)) {
			best = { ax, ay, l, r, sc };
		}
	}
	if (!best || best.sc < 90 * u) return null;
	const byX = best.ax >= best.ay;
	return {
		h: byX ? Math.min(S, H * 0.5) : Math.min(S, best.ay),
		sx: best.r ? -1 : 1,
		sy: best.l ? -1 : 1,
		w: byX ? Math.min(S, best.ax) : Math.min(S, W * 0.5),
		x: best.r ? W : 0,
		y: best.l ? H : 0,
	};
}

/* curve sampling helpers (the canvas contract has no bezier/ellipse ops) */

// eslint-disable-next-line opencut/prefer-object-params -- Sample counts pair with the curve geometry.
function sampleQuadratic(
	x0: number,
	y0: number,
	cx: number,
	cy: number,
	x1: number,
	y1: number,
	n: number,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index <= n; index += 1) {
		const t = index / n;
		const u = 1 - t;
		points.push([
			u * u * x0 + 2 * u * t * cx + t * t * x1,
			u * u * y0 + 2 * u * t * cy + t * t * y1,
		]);
	}
	return points;
}

// eslint-disable-next-line opencut/prefer-object-params -- Sample counts pair with the curve geometry.
function sampleCubic(
	x0: number,
	y0: number,
	c1x: number,
	c1y: number,
	c2x: number,
	c2y: number,
	x1: number,
	y1: number,
	n: number,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index <= n; index += 1) {
		const t = index / n;
		const u = 1 - t;
		points.push([
			u ** 3 * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * x1,
			u ** 3 * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y1,
		]);
	}
	return points;
}

// eslint-disable-next-line opencut/prefer-object-params -- Ellipse sampling mirrors the source arc calls.
function ellipsePoints(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	rot: number,
	a0: number,
	a1: number,
	n: number,
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

/** 雪輪 ring path: six notches cut into a circle (JIZURA `yukiwaPath`). */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's yukiwaPath(ctx, x, y, R, rot) shape.
function yukiwaPoints(
	x: number,
	y: number,
	R: number,
	rot: number,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	const N = 84;
	for (let index = 0; index <= N; index += 1) {
		const th = (index / N) * TAU;
		const u = (th / (TAU / 6)) % 1;
		const d = Math.min(u, 1 - u) * (TAU / 6);
		const r = R * (1 - 0.17 * Math.exp(-((d / 0.075) * (d / 0.075))));
		points.push([x + Math.cos(th + rot) * r, y + Math.sin(th + rot) * r]);
	}
	return points;
}

/* ================================================================== BACKGROUND */

export function drawX2WaBackground(options: BgcamBackgroundDraw): void {
	switch (options.frame.cut?.preset.bg) {
		case "wzBgRyusui":
			drawWzBgRyusui(options);
			break;
		case "wzBgSayagata":
			drawWzBgSayagata(options);
			break;
		case "wzBgShippo":
			drawWzBgShippo(options);
			break;
		case "wzBgTatewaku":
			drawWzBgTatewaku(options);
			break;
		case "wzBgYagasuri":
			drawWzBgYagasuri(options);
			break;
		case "wzBgYukiwa":
			drawWzBgYukiwa(options);
			break;
		default:
			break;
	}
}

type WaBackgroundDraw = BgcamBackgroundDraw;

function waBgState(options: WaBackgroundDraw): {
	readonly e: number;
	readonly fg: string;
	readonly palette: BgcamBackgroundDraw["frame"]["palette"];
	readonly seed: number;
	readonly t: number;
	readonly u: number;
} {
	const cut = options.frame.cut;
	return {
		e: backgroundFade(options.frame),
		fg: options.frame.palette.foreground,
		palette: options.frame.palette,
		seed: cut?.seed ?? 1,
		t: options.frame.sequenceTime / TICKS,
		u: Math.min(options.width, options.height),
	};
}

/** 七宝つなぎ — a drifting field of interlocking circles; the knots swell in a slow travelling wave. */
function drawWzBgShippo(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, palette, seed, t, u } = waBgState(options);
	const r = u * (0.065 + ru(seed, 601) * 0.025);
	const k = 0.07 + ru(seed, 602) * 0.025;
	const dx = ru(seed, 603) < 0.5 ? -1 : 1;
	const acc = ru(seed, 604) < 0.4;
	const ox = wrap(t * r * 0.1 * dx, 2 * r) - 2 * r;
	const oy = wrap(t * r * 0.06, 2 * r) - 2 * r;
	const ni = Math.min(90, Math.ceil(options.width / r) + 5);
	const nj = Math.min(90, Math.ceil(options.height / r) + 5);
	for (let j = 0; j < nj; j += 1) {
		for (let index = 0; index < ni; index += 1) {
			if ((index + j) & 1) continue;
			const x = ox + index * r;
			const y = oy + j * r;
			waStroke(ctx, arcPoints(x, y, r, r, 0, 360, 24), fg, Math.max(1.2, r * 0.035), k * e);
		}
	}
	for (let j = 0; j < nj; j += 1) {
		for (let index = 0; index < ni; index += 1) {
			if ((index + j) & 1) continue;
			const x = ox + index * r;
			const y = oy + j * r;
			const d =
				r * (0.1 + 0.12 * (0.5 + 0.5 * Math.sin(t * 0.9 - (x + y * 0.6) / (r * 5)))) * e;
			waDisc(ctx, x, y, d, acc ? palette.accent : fg, k * 1.2 * e);
		}
	}
}

/** 紗綾形 — linked-manji key fret set on the diagonal; the lattice slides along itself and the line weight breathes. */
function drawWzBgSayagata(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, seed, t, u } = waBgState(options);
	const q = u * (0.015 + ru(seed, 611) * 0.005);
	const k = 0.06 + ru(seed, 612) * 0.02;
	const dir = ru(seed, 613) < 0.5 ? -1 : 1;
	const rotPick = ru(seed, 614) < 0.67 ? 45 : 0;
	const ax = 6 * q;
	const ay = -4 * q;
	const bx = 4 * q;
	const by = 6 * q;
	const f = wrap(t * 0.03 * dir, 1);
	const ox = f * ax;
	const oy = f * ay;
	const rad = Math.hypot(options.width, options.height) / 2 + q * 4;
	const N = Math.min(34, Math.ceil(rad / (q * 7.2)) + 2);
	const ra = rotPick * degrees(1);
	const cr = Math.cos(ra);
	const sr = Math.sin(ra);
	const pad = q * 5;
	ctx.save();
	ctx.translate(options.width / 2, options.height / 2);
	ctx.rotate(ra);
	for (let index = -N; index <= N; index += 1) {
		for (let j = -N; j <= N; j += 1) {
			const cx = ox + index * ax + j * bx;
			const cy = oy + index * ay + j * by;
			if (
				Math.abs(cx * cr - cy * sr) > options.width / 2 + pad ||
				Math.abs(cx * sr + cy * cr) > options.height / 2 + pad
			) {
				continue;
			}
			let ux = 0;
			let uy = -1;
			for (let a = 0; a < 4; a += 1) {
				const vx = -uy;
				const vy = ux;
				waStroke(
					ctx,
					[
						[cx, cy],
						[cx + ux * 2 * q, cy + uy * 2 * q],
						[cx + (ux * 2 + vx * 3) * q, cy + (uy * 2 + vy * 3) * q],
					],
					fg,
					q * (0.3 + 0.07 * Math.sin(t * 0.7)),
					k * e,
				);
				ux = vx;
				uy = vy;
			}
		}
	}
	ctx.restore();
}

/** 立涌 — rising-steam lines: mirrored wavy verticals whose swellings climb slowly and breathe. */
function drawWzBgTatewaku(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, seed, t, u } = waBgState(options);
	const d = u * (0.1 + ru(seed, 621) * 0.04);
	const k = 0.09 + ru(seed, 622) * 0.025;
	const dots = ru(seed, 623) < 0.65;
	const dir = ru(seed, 624) < 0.5 ? -1 : 1;
	const Am = d * 0.25 * (0.82 + 0.18 * Math.sin(t * 0.6)) * e;
	const kk = TAU / (d * 2.8);
	const ph = t * 0.4 * dir;
	const n = Math.min(60, Math.ceil(options.width / d) + 2);
	const st = Math.max(8, options.height / 48);
	for (let index = 0; index < n; index += 1) {
		const s = index % 2 ? -1 : 1;
		const x0 = (index - 0.5) * d;
		const points: (readonly [number, number])[] = [];
		for (let y = -st, g = 0; y <= options.height + st && g < 80; y += st, g += 1) {
			points.push([x0 + s * Am * Math.sin(y * kk + ph), y]);
		}
		waStroke(ctx, points, fg, Math.max(1.5, d * 0.03), k * e);
	}
	if (dots) {
		for (let index = 0; index < n; index += 1) {
			const s = index % 2 ? -1 : 1;
			const x = index * d;
			const y0 = ((s > 0 ? -PI / 2 : PI / 2) - ph) / kk;
			const per = TAU / kk;
			for (
				let y = wrap(y0, per) - per, g = 0;
				y < options.height + per && g < 30;
				y += per, g += 1
			) {
				const r = d * 0.085 * (0.8 + 0.2 * Math.sin(t * 0.9 + index + g));
				waDisc(ctx, x, y, r, fg, k * 0.7 * e);
			}
		}
	}
}

/** 流水紋 — bundles of staggered parallel water lines sliding sideways at different speeds. */
function drawWzBgRyusui(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, palette, seed, t, u } = waBgState(options);
	const n = 6 + (Math.floor(ru(seed, 631) * 4) % 4);
	const k = 0.085 + ru(seed, 632) * 0.025;
	const dir = ru(seed, 633) < 0.5 ? -1 : 1;
	const acc = ru(seed, 634) < 0.4;
	const dy = u * 0.02;
	for (let b = 0; b < n; b += 1) {
		const m = 3 + (Math.floor(ru(seed, b, 41) * 3) % 3);
		const base =
			(options.height * (b + 0.5)) / n +
			(ru(seed, b, 42) * 2 - 1) * options.height * 0.04 -
			((m - 1) * dy) / 2;
		const lam = u * (0.2 + 0.14 * ru(seed, b, 43));
		const Am = u * (0.02 + 0.02 * ru(seed, b, 44));
		const len = options.width * (0.55 + 0.4 * ru(seed, b, 45));
		const v = options.width * (0.012 + 0.018 * ru(seed, b, 46)) * dir;
		const span = options.width + len + u * 0.3;
		const x0 = wrap(ru(seed, b, 47) * span + t * v, span) - len - u * 0.15;
		const color = acc && b === 1 ? palette.accent : fg;
		for (let j = 0; j < m; j += 1) {
			const xs = x0 + len * 0.3 * ru(seed, b, j, 48);
			const xe = x0 + len * (1 - 0.3 * ru(seed, b, j, 49));
			const a = Math.max(xs, -20);
			const z = Math.min(xe * e + xs * (1 - e), options.width + 20);
			if (z - a < 10) continue;
			const points: (readonly [number, number])[] = [];
			for (let x = a, g = 0; g < 140; x += 22, g += 1) {
				const xx = Math.min(x, z);
				points.push([
					xx,
					base +
						j * dy +
						Am * Math.sin(xx / lam + b * 1.7 + t * 0.35) +
						Am * 0.35 * Math.sin((xx / lam) * 2.1 - t * 0.2),
				]);
				if (xx >= z) break;
			}
			waStroke(
				ctx,
				points,
				color,
				Math.max(1.5, u * (0.003 + 0.002 * ru(seed, b, 50))),
				k * (0.7 + 0.5 * ru(seed, b, 51)) * e,
			);
		}
	}
}

/** 雪輪散らし — scattered snow-ring crests, some filled and some outlined, sinking and turning very slowly. */
function drawWzBgYukiwa(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, palette, seed, t, u } = waBgState(options);
	const n = Math.min(16, 10 + (Math.floor(ru(seed, 651) * 5) % 5));
	const k = 0.065 + ru(seed, 652) * 0.02;
	const acc = ru(seed, 653) < 0.5;
	const lw = Math.max(1.5, u * 0.0042);
	for (let index = 0; index < n; index += 1) {
		const R =
			u *
			(0.06 + 0.12 * ru(seed, index, 61) * ru(seed, index, 62)) *
			(0.8 + 0.2 * outCubic(wrap(t * 0.8 - index * 0.03, 2) / 0.8));
		const span = options.height + R * 2.4;
		const x =
			options.width * ((index + 0.5) / n + 0.3 * (ru(seed, index, 63) * 2 - 1)) +
			Math.sin(t * 0.25 + index * 1.9) *
				u *
				0.02;
		const xx = wrap(x, options.width + R * 2) - R;
		const y =
			wrap(ru(seed, index, 64) * span + t * u * (0.006 + 0.01 * ru(seed, index, 65)), span) -
			R * 1.2;
		const rot = (index % 2 ? -1 : 1) * t * 0.06 + index;
		const col = acc && index % 4 === 1 ? palette.accent : fg;
		const ring = yukiwaPoints(xx, y, R, rot);
		if (index % 3 === 0) {
			waPoly(ctx, ring, col, k * 0.8 * e);
		} else {
			waStroke(ctx, ring, col, lw, k * 1.5 * e);
		}
		if (R > u * 0.085) {
			const spokes: (readonly [number, number])[] = [];
			for (let j = 0; j < 6; j += 1) {
				const an = rot + (j / 6) * TAU;
				spokes.push([
					xx + Math.cos(an) * R * 0.18,
					y + Math.sin(an) * R * 0.18,
				]);
				spokes.push([
					xx + Math.cos(an) * R * 0.6,
					y + Math.sin(an) * R * 0.6,
				]);
			}
			waStroke(ctx, spokes, col, lw, k * 1.4 * e);
		}
	}
}

/** 矢絣 — columns of arrow-feather chevrons; neighbouring columns slide up and down against each other. */
function drawWzBgYagasuri(options: WaBackgroundDraw): void {
	const { ctx } = options;
	const { e, fg, palette, seed, t, u } = waBgState(options);
	const d = u * (0.085 + ru(seed, 671) * 0.035);
	const k = 0.045 + ru(seed, 672) * 0.015;
	const spd = 0.008 + ru(seed, 673) * 0.008;
	const acc = ru(seed, 674) < 0.35;
	const ph = d * 0.85;
	const nc = Math.min(40, Math.ceil(options.width / d) + 1);
	const x00 = (options.width - nc * d) / 2;
	for (let pass = 0; pass < 2; pass += 1) {
		const color = pass && acc ? palette.accent : fg;
		for (let c = pass; c < nc; c += 2) {
			const dir = c % 2 ? -1 : 1;
			const x0 = x00 + c * d;
			const xc = x0 + d / 2;
			const sl = dir * d * 0.5;
			const off = wrap(dir * t * u * spd, ph * 2) + (1 - e) * dir * ph;
			for (
				let y = -ph * 4 + off, g = 0;
				y < options.height + ph * 2 && g < 60;
				y += ph * 2, g += 1
			) {
				waPoly(
					ctx,
					[
						[x0 + 1, y],
						[xc - 1, y + sl],
						[xc - 1, y + sl + ph],
						[x0 + 1, y + ph],
					],
					color,
					(pass ? k * 0.9 : k) * e,
				);
				waPoly(
					ctx,
					[
						[x0 + d - 1, y],
						[xc + 1, y + sl],
						[xc + 1, y + sl + ph],
						[x0 + d - 1, y + ph],
					],
					color,
					(pass ? k * 0.9 : k) * e,
				);
			}
		}
	}
}
