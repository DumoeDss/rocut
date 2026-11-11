import {
	inCubic,
	inOutCubic,
	inOutSine,
	inQuad,
	mixHex,
	outCubic,
	outQuad,
	randomSigned,
	randomUnit,
	smooth,
} from "./exit-hold-geometry";
import { drawHorrorSegment } from "./horror-frame-utils";
import {
	degrees,
	drawKineticRule,
	fitKineticText,
	kineticUnits,
	outExpo,
} from "./kinetic-layout-utils";
import { approximateTextWidth, kineticWordSegments } from "./kinetic-words";
import type { TypographyLayoutOptions } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

/**
 * JIZURA x2kineticA — kinetic typography (追加分2): word-driven layouts,
 * motion-accent decors and moving backgrounds, ported onto rocut's layout /
 * decor / background contracts. Time runs in seconds from the cut start;
 * word units come from the shared kinetic word model.
 */

const PI = Math.PI;
const TAU = PI * 2;
const SECONDS_PER_TICK = 1 / 120_000;

/** Mirror of the kinetic decor draw contract (see kinetic-decors.ts). */
export interface X2KineticDecorDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly decor: string;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

/** Mirror of the background draw contract (see bgcam-background-utils.ts). */
export interface X2KineticBackgroundDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}

interface Bounds {
	readonly x0: number;
	readonly x1: number;
	readonly y0: number;
	readonly y1: number;
}

// --- shared seeded plan picks (JIZURA rng.pick/chance/range/int) -------------

function seedOf(frame: MotionTextRenderFrame): number {
	return frame.cut?.seed ?? 0;
}

// eslint-disable-next-line opencut/prefer-object-params
function chanceOf(seed: number, salt: number): boolean {
	return randomUnit(seed, salt) < 0.5;
}

// eslint-disable-next-line opencut/prefer-object-params
function pickOf<T>(seed: number, salt: number, values: readonly T[]): T {
	return values[
		Math.min(values.length - 1, Math.floor(randomUnit(seed, salt) * values.length))
	]!;
}

// eslint-disable-next-line opencut/prefer-object-params
function rangeOf(seed: number, salt: number, from: number, to: number): number {
	return from + randomUnit(seed, salt) * (to - from);
}

// eslint-disable-next-line opencut/prefer-object-params
function intOf(seed: number, salt: number, count: number): number {
	return Math.min(count - 1, Math.floor(randomUnit(seed, salt) * count));
}

// --- source easings / springs (seconds in, like the pack) ---------------------

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

// eslint-disable-next-line opencut/prefer-object-params
function oBackP(value: number, overshoot = 1.70158): number {
	const shifted = clamp01(value) - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

/** 1 → 0, rings through 0 (JIZURA `sprg`). */
// eslint-disable-next-line opencut/prefer-object-params
function sprg(t: number, k = 7, f = 18): number {
	return t <= 0 ? 1 : Math.exp(-k * t) * Math.cos(f * t);
}

/** 0 → 1 with overshoot (JIZURA `spr`). */
// eslint-disable-next-line opencut/prefer-object-params
function spr(t: number, k = 8, f = 14): number {
	return 1 - sprg(t, k, f);
}

/** A kick that rings out (JIZURA `pls`). */
// eslint-disable-next-line opencut/prefer-object-params
function pls(t: number, k = 7, f = 16): number {
	return t <= 0 ? 0 : Math.exp(-k * t) * Math.sin(f * t);
}

/** Index of the last onset at or before `time` (JIZURA `curIdx`). */
// eslint-disable-next-line opencut/prefer-object-params
function curIdx(times: readonly number[], time: number): number {
	let found = -1;
	for (let index = 0; index < times.length; index++) {
		if (time >= times[index]!) found = index;
	}
	return found;
}

// --- word model ---------------------------------------------------------------

function hasLatin(text: string): boolean {
	return /[A-Za-z]/u.test(text);
}

function gcount(text: string): number {
	return Array.from(text.replaceAll(/\s+/gu, "")).length;
}

/** Word onsets inside the cut in seconds (JIZURA `onsets`, no beat clock). */
function onsetsOf({
	count,
	duration,
	frac,
	gap,
}: {
	readonly count: number;
	readonly duration: number;
	readonly frac: number;
	readonly gap: number;
}): number[] {
	const last = Math.max(0, Math.min(duration * frac, (count - 1) * gap));
	return Array.from(
		{ length: count },
		(_, index) => (count > 1 ? (last * index) / (count - 1) : 0),
	);
}

/** Index of the "key" word: the longest unit, `roll` picks among ties. */
// eslint-disable-next-line opencut/prefer-object-params
function keyOf(units: readonly string[], roll: number): number {
	const lengths = units.map((unit) => gcount(unit));
	const max = Math.max(...lengths);
	const ties: number[] = [];
	lengths.forEach((value, index) => {
		if (value === max) ties.push(index);
	});
	return ties[Math.abs(Math.floor(roll)) % ties.length] ?? 0;
}

// eslint-disable-next-line opencut/prefer-object-params
function partitionsOf(
	count: number,
	lines: number,
): readonly (readonly (readonly [number, number])[])[] {
	const out: (readonly [number, number])[][] = [];
	// eslint-disable-next-line opencut/prefer-object-params
	const walk = (start: number, left: number, acc: readonly (readonly [number, number])[]) => {
		if (left === 1) {
			out.push([...acc, [start, count]]);
			return;
		}
		for (let end = start + 1; end <= count - left + 1; end++) {
			walk(end, left - 1, [...acc, [start, end]]);
		}
	};
	if (lines >= 1 && lines <= count) walk(0, lines, []);
	return out;
}

interface X2FlowPosition {
	readonly a: number;
	readonly b: number;
	readonly li: number;
	readonly w: number;
	readonly x: number;
	readonly y: number;
}

interface X2Flow {
	readonly L: number;
	readonly h: number;
	readonly lw: readonly number[];
	readonly pos: readonly X2FlowPosition[];
	readonly pt: readonly (readonly [number, number])[];
	readonly size: number;
	readonly sp: number;
	readonly w: number;
	readonly ws: readonly number[];
}

/** Flow units into balanced lines; positions are block-centre relative px. */
function flowUnitsOf({
	latin,
	lead = 1.22,
	maxH,
	maxLines,
	maxSize = Number.POSITIVE_INFINITY,
	maxW,
	sp,
	units,
}: {
	readonly latin: boolean;
	readonly lead?: number;
	readonly maxH: number;
	readonly maxLines: number;
	readonly maxSize?: number;
	readonly maxW: number;
	readonly sp?: number;
	readonly units: readonly string[];
}): X2Flow {
	const spacing = sp ?? (latin ? 0.32 : 0.08);
	const ws = units.map((unit) => approximateTextWidth({ size: 1, text: unit }));
	const count = units.length;
	let best: {
		L: number;
		lw: readonly number[];
		pt: readonly (readonly [number, number])[];
		size: number;
	} | null = null;
	for (let lines = 1; lines <= Math.min(count, maxLines); lines++) {
		let bestPart:
			| { lw: readonly number[]; pt: readonly (readonly [number, number])[] }
			| null = null;
		let bestWidth = Number.POSITIVE_INFINITY;
		for (const pt of partitionsOf(count, lines).slice(0, 80)) {
			const lw = pt.map(([a, b]) => {
				let width = 0;
				for (let index = a; index < b; index++) {
					width += ws[index]! + (index > a ? spacing : 0);
				}
				return width;
			});
			const maxWidth = Math.max(...lw);
			if (maxWidth < bestWidth) {
				bestWidth = maxWidth;
				bestPart = { lw, pt };
			}
		}
		if (!bestPart) continue;
		const size = Math.min(
			maxW / bestWidth,
			maxH / (lines * lead - (lead - 1)),
			maxSize,
		);
		if (!best || size > best.size * 1.1) {
			best = { L: lines, lw: bestPart.lw, pt: bestPart.pt, size };
		}
	}
	const chosen = best ?? {
		L: 1,
		lw: [ws.reduce((sum, width) => sum + width, 0)],
		pt: [[0, count]] as const,
		size: Math.min(
			maxW,
			maxH / (1 * lead - (lead - 1)),
			maxSize,
		),
	};
	const positions: X2FlowPosition[] = [];
	chosen.pt.forEach(([a, b], li) => {
		const y = (li - (chosen.L - 1) / 2) * lead * chosen.size;
		let x = -chosen.lw[li]! * chosen.size / 2;
		for (let index = a; index < b; index++) {
			const width = ws[index]! * chosen.size;
			positions[index] = {
				a,
				b: b - 1,
				li,
				w: width,
				x: x + width / 2,
				y,
			};
			x += width + spacing * chosen.size;
		}
	});
	return {
		L: chosen.L,
		h: (chosen.L * lead - (lead - 1)) * chosen.size,
		lw: chosen.lw.map((width) => width * chosen.size),
		pos: positions,
		pt: chosen.pt,
		size: chosen.size,
		sp: spacing,
		w: Math.max(...chosen.lw) * chosen.size,
		ws,
	};
}

// --- drawing primitives (ctx-level, alpha-aware) ------------------------------

function segment({
	alpha,
	color,
	ctx,
	from,
	thickness,
	to,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly from: readonly [number, number];
	readonly thickness: number;
	readonly to: readonly [number, number];
}): void {
	drawHorrorSegment({
		alpha,
		color,
		ctx,
		thickness,
		x0: from[0],
		x1: to[0],
		y0: from[1],
		y1: to[1],
	});
}

function rect({
	alpha = 1,
	color,
	ctx,
	height,
	width,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly height: number;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (width <= 0 || height <= 0 || alpha <= 0.003) return;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

function dot({
	alpha = 1,
	color,
	ctx,
	radius,
	scaleX = 1,
	scaleY = 1,
	x,
	y,
}: {
	readonly alpha?: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly x: number;
	readonly y: number;
}): void {
	if (radius <= 0.05 || alpha <= 0.003) return;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha = baseAlpha * clamp01(alpha);
	ctx.fillStyle = color;
	if (ctx.arc && ctx.fill) {
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, TAU);
		ctx.fill();
	} else {
		ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

function arcStroke({
	a0,
	a1,
	alpha,
	centerX,
	centerY,
	color,
	ctx,
	radius,
	segments = 18,
	thickness,
}: {
	readonly a0: number;
	readonly a1: number;
	readonly alpha: number;
	readonly centerX: number;
	readonly centerY: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly radius: number;
	readonly segments?: number;
	readonly thickness: number;
}): void {
	if (radius <= 0.1 || alpha <= 0.003 || thickness <= 0.05) return;
	for (let index = 0; index < segments; index++) {
		const from = a0 + ((a1 - a0) * index) / segments;
		const to = a0 + ((a1 - a0) * (index + 1)) / segments;
		segment({
			alpha,
			color,
			ctx,
			from: [
				centerX + Math.cos(degrees(from)) * radius,
				centerY + Math.sin(degrees(from)) * radius,
			],
			thickness,
			to: [
				centerX + Math.cos(degrees(to)) * radius,
				centerY + Math.sin(degrees(to)) * radius,
			],
		});
	}
}

/** Polyline stroke; `upto` draws only the first fraction (JIZURA polyPartial). */
function polyline({
	alpha,
	color,
	ctx,
	points,
	thickness,
	upto = 1,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly points: readonly (readonly [number, number])[];
	readonly thickness: number;
	readonly upto?: number;
}): void {
	if (points.length < 2 || alpha <= 0.003 || thickness <= 0.05) return;
	const lengths: number[] = [0];
	for (let index = 1; index < points.length; index++) {
		lengths.push(
			lengths[index - 1]! +
				Math.hypot(
					points[index]![0] - points[index - 1]![0],
					points[index]![1] - points[index - 1]![1],
				),
		);
	}
	const limit = lengths.at(-1)! * clamp01(upto);
	for (let index = 1; index < points.length; index++) {
		if (lengths[index - 1]! >= limit) break;
		let to = points[index]!;
		if (lengths[index]! > limit) {
			const share =
				(limit - lengths[index - 1]!) /
				Math.max(1e-6, lengths[index]! - lengths[index - 1]!);
			to = [
				lerpN(points[index - 1]![0], to[0], share),
				lerpN(points[index - 1]![1], to[1], share),
			];
		}
		segment({
			alpha,
			color,
			ctx,
			from: points[index - 1]!,
			thickness,
			to,
		});
	}
}

function fillPolygon({
	alpha,
	color,
	ctx,
	points,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly ctx: MotionTextCanvasContext;
	readonly points: readonly (readonly [number, number])[];
}): void {
	if (points.length < 3 || alpha <= 0.003) return;
	if (ctx.moveTo && ctx.lineTo && ctx.fill && ctx.beginPath && ctx.closePath) {
		const baseAlpha = ctx.globalAlpha;
		const baseFill = ctx.fillStyle;
		ctx.save();
		ctx.globalAlpha = baseAlpha * clamp01(alpha);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
		ctx.globalAlpha = baseAlpha;
		ctx.fillStyle = baseFill;
		return;
	}
	polyline({ alpha, color, ctx, points: [...points, points[0]!], thickness: 2 });
}

// eslint-disable-next-line opencut/prefer-object-params
function rotV(x: number, y: number, angleDeg: number): [number, number] {
	const c = Math.cos(degrees(angleDeg));
	const s = Math.sin(degrees(angleDeg));
	return [x * c - y * s, x * s + y * c];
}

// --- layout text draw (JIZURA mainDraw: degrees rotation/skew) -----------------

interface X2TextSpec {
	readonly align?: CanvasTextAlign;
	readonly alpha?: number;
	readonly color?: string;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly size: number;
	readonly skew?: number;
	readonly text: string;
	readonly x: number;
	readonly y: number;
}

// eslint-disable-next-line opencut/prefer-object-params
function drawX2Text(options: TypographyLayoutOptions, spec: X2TextSpec): void {
	const {
		align = "center",
		alpha = 1,
		color = options.frame.palette.foreground,
		rotation = 0,
		scaleX = 1,
		scaleY = 1,
		size,
		skew = 0,
		text,
		x,
		y,
	} = spec;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseAlign = ctx.textAlign;
	const baseFill = ctx.fillStyle;
	options.setFontSize(size);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.textAlign = align;
	const transformed =
		rotation !== 0 || skew !== 0 || scaleX !== 1 || scaleY !== 1;
	if (transformed) {
		ctx.save();
		ctx.translate(x, y);
		if (rotation) ctx.rotate(degrees(rotation));
		if (skew) ctx.transform(1, 0, Math.tan(degrees(skew)), 1, 0, 0);
		ctx.scale(scaleX, scaleY);
		options.drawText({
			text,
			x: 0,
			y: 0,
			maxWidth: options.width * 0.9,
			size,
		});
		ctx.restore();
	} else {
		options.drawText({ text, x, y, maxWidth: options.width * 0.9, size });
	}
	ctx.globalAlpha = baseAlpha;
	ctx.textAlign = baseAlign;
	ctx.fillStyle = baseFill;
}

// ============================================================================ LAYOUTS

/** 押し出し列 — every new word rams the row from the right; the row gives way as a chain. */
function drawKzShove(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const from = pickOf(seed, 3001, ["side", "side", "diag"]);
	const hot = randomUnit(seed, 3002) < 0.65;
	const mark = randomUnit(seed, 3003) < 0.7;
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({ count: n, duration, frac: 0.45, gap: 0.36 });
	const F = flowUnitsOf({
		latin: hasLatin(frame.cut?.text ?? ""),
		maxH: H * (port ? 0.5 : 0.44),
		maxLines: tall ? 4 : 2,
		maxSize: H * (port ? 0.12 : 0.2),
		maxW: W * 0.84,
		units,
	});
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const { foreground: fg, accent: accC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const cx = W / 2;
	const cy = H / 2;
	// eslint-disable-next-line opencut/prefer-object-params
	const offOf = (a: number, j: number): number =>
		-(F.pos[a]!.x - F.pos[a]!.w / 2 + F.pos[j]!.x + F.pos[j]!.w / 2) / 2;
	for (let index = 0; index <= k; index++) {
		const p = F.pos[index]!;
		const a = p.a;
		const j = Math.min(k, p.b);
		const hit = ts[j]! + 0.13;
		const oNew = offOf(a, j);
		const oOld = j > a ? offOf(a, j - 1) : oNew;
		const d = j - index;
		const tau = lt - hit - d * 0.03;
		let x = p.x + oNew + (oOld - oNew) * sprg(tau, 8, 15);
		let y = p.y;
		let sx = 1;
		let rot = 0;
		if (index === j) {
			const f = 1 - inQuad(clamp01((lt - ts[index]!) / 0.13));
			x += W * 0.75 * f;
			if (from === "diag") y -= F.size * 1.2 * f;
			if (tau > 0) {
				sx = 1 - 0.16 * Math.exp(-tau * 13);
				x -= p.w * (1 - sx) / 2;
			}
		} else {
			rot = -3.5 * pls(tau, 8, 18) * 0.7 ** (d - 1);
		}
		const col = !hot
			? fg
			: index === k
				? accC
				: mixHex({
						from: accC,
						progress: clamp01((lt - ts[index + 1]! - 0.13) / 0.3),
						to: fg,
					});
		drawX2Text(options, {
			color: col,
			rotation: rot,
			scaleX: sx,
			size: F.size,
			text: units[index]!,
			x: cx + x,
			y: cy + y,
		});
		if (mark && index === j && j > a && tau > 0 && tau < 0.32) {
			const q = tau / 0.32;
			const e = outExpo(q);
			const jx = cx + p.x - p.w / 2 + oOld - F.size * 0.03;
			const lw = Math.max(2, u * 0.004);
			for (const s of [-1, 1]) {
				for (const m of [0, 1]) {
					const y0 = cy + y + s * F.size * (0.5 + 0.22 * e);
					const y1 = y0 + s * F.size * 0.2 * (1 - q);
					const dx = (m ? -1 : 0.4) * F.size * 0.16 * (0.4 + e);
					segment({
						alpha: (1 - q) * out,
						color: accC,
						ctx,
						from: [jx + dx * 0.5, y0],
						thickness: lw,
						to: [jx + dx, y1],
					});
				}
			}
		}
	}
}

/** コンベア — the words ride in on belts that brake to a halt; the key word hops. */
function drawKzConveyor(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const seed = seedOf(frame);
	const dir = pickOf(seed, 3101, [1, -1]);
	const rollers = randomUnit(seed, 3102) < 0.7;
	const alt = randomUnit(seed, 3103) < 0.6;
	const keyRoll = intOf(seed, 3104, 6);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const F = flowUnitsOf({
		lead: 1.75,
		latin: hasLatin(frame.cut?.text ?? ""),
		maxH: H * (port ? 0.5 : 0.42),
		maxLines: tall ? 3 : 2,
		maxSize: H * (port ? 0.11 : 0.17),
		maxW: W * 0.84,
		units,
	});
	const size = F.size;
	const T = Math.min(Math.max(duration * 0.34, 0.4), 0.95);
	const key = keyOf(units, keyRoll);
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const cx = W / 2;
	const cy = H / 2 - size * 0.12;
	const th = Math.max(3, size * 0.07);
	const e0 = outExpo(clamp01(lt / 0.3));
	const tHop = T + 0.16;
	const hq = clamp01((lt - tHop) / 0.36);
	for (let li = 0; li < F.L; li++) {
		const dirL = (alt && li % 2 ? -1 : 1) * dir;
		const s =
			dirL * W * 1.15 * (1 - outCubic(clamp01((lt - li * 0.06) / T)));
		const ly = cy + (li - (F.L - 1) / 2) * 1.75 * size;
		const by = ly + size * 0.62;
		rect({
			alpha: 0.85 * out,
			color: subC,
			ctx,
			height: th,
			width: W * e0,
			x: dirL > 0 ? W * (1 - e0) : 0,
			y: by,
		});
		const g = size * 0.8;
		const m0 = Math.ceil(W / g) + 1;
		for (let m = 0; m < Math.min(m0, 70); m++) {
			const x = (((m * g + s) % (m0 * g)) + m0 * g) % (m0 * g) - g * 0.5;
			rect({
				alpha: 0.55 * out * e0,
				color: subC,
				ctx,
				height: size * 0.09,
				width: Math.max(2, size * 0.03),
				x,
				y: by + th,
			});
		}
		if (rollers) {
			for (const rx of [0.16, 0.84]) {
				const r = size * 0.2;
				const x = W * rx;
				const y = by + th + size * 0.14 + r;
				const a = s / r;
				arcStroke({
					a0: 0,
					a1: TAU,
					alpha: 0.8 * out,
					centerX: x,
					centerY: y,
					color: subC,
					ctx,
					radius: r * e0,
					thickness: Math.max(2, size * 0.03),
				});
				for (const b of [a, a + PI / 2]) {
					segment({
						alpha: 0.8 * out,
						color: subC,
						ctx,
						from: [
							x - Math.cos(b) * r * e0,
							y - Math.sin(b) * r * e0,
						],
						thickness: Math.max(2, size * 0.03),
						to: [x + Math.cos(b) * r * e0, y + Math.sin(b) * r * e0],
					});
				}
			}
		}
		for (let index = 0; index < n; index++) {
			const p = F.pos[index]!;
			if (p.li !== li) continue;
			const tau = lt - T - li * 0.06;
			const x = cx + p.x + s;
			let y = ly;
			const rot = -dirL * 5 * pls(tau, 5.5, 13);
			let sy = 1;
			let col = fg;
			if (index === key && n > 1) {
				y -= size * 0.5 * Math.sin(PI * hq);
				if (hq >= 1) {
					sy = 1 - 0.2 * Math.exp(-(lt - tHop - 0.36) * 12);
					y += size * (1 - sy) * 0.5;
				}
				if (hq > 0.5) col = accC;
				const me = outExpo(clamp01((lt - tHop - 0.34) / 0.3));
				if (me > 0) {
					rect({
						alpha: out,
						color: accC,
						ctx,
						height: th,
						width: p.w * me,
						x: cx + p.x - (p.w / 2) * me,
						y: by,
					});
				}
			}
			if (x < -p.w || x > W + p.w) continue;
			drawX2Text(options, {
				color: col,
				rotation: rot,
				scaleY: sy,
				size,
				text: units[index]!,
				x,
				y,
			});
		}
	}
}

/** スイング打ち — each word swings in on a long rod like a wrecking ball. */
function drawKzSwingKnock(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const R0 = pickOf(seed, 3201, [0.55, 0.9, 0.9]);
	const amp = rangeOf(seed, 3202, 30, 40);
	const rod = randomUnit(seed, 3203) < 0.75;
	const accRoll = intOf(seed, 3204, 6);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.46,
		gap: 0.42,
	});
	const F = flowUnitsOf({
		lead: 1.3,
		latin: hasLatin(frame.cut?.text ?? ""),
		maxH: H * (port ? 0.46 : 0.4),
		maxLines: tall ? 4 : 2,
		maxSize: H * (port ? 0.12 : 0.19),
		maxW: W * 0.8,
		units,
	});
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const size = F.size;
	const R = H * R0;
	const fly = 0.2;
	const cx = W / 2;
	const cy = H / 2 + size * 0.1;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	for (let index = 0; index <= k; index++) {
		const p = F.pos[index]!;
		const tau = lt - ts[index]!;
		let ang =
			tau < fly
				? amp * (1 - inQuad(clamp01(tau / fly)))
				: -amp * 0.2 * pls(tau - fly, 5.5, 12);
		let dx = 0;
		if (index < k && F.pos[k]!.li === p.li) {
			const d = k - index;
			const t2 = lt - ts[k]! - fly - (d - 1) * 0.05;
			const w = pls(t2, 6, 15) * 0.72 ** (d - 1);
			ang += 7 * w;
			dx = -size * 0.08 * w;
		}
		const px = cx + p.x;
		const py = cy + p.y - R;
		const x = px + R * Math.sin(degrees(ang)) + dx;
		const y = py + R * Math.cos(degrees(ang));
		if (rod) {
			const ra =
				0.7 * (1 - clamp01((tau - fly - 0.3) / 0.35)) * out;
			const r0 = R - size * 0.58;
			if (ra > 0.01) {
				segment({
					alpha: ra,
					color: subC,
					ctx,
					from: [px + dx, py],
					thickness: Math.max(1.5, u * 0.003),
					to: [
						px + r0 * Math.sin(degrees(ang)) + dx,
						py + r0 * Math.cos(degrees(ang)),
					],
				});
				dot({
					alpha: ra,
					color: accC,
					ctx,
					radius: Math.max(3, size * 0.045),
					x: px + r0 * Math.sin(degrees(ang)) + dx,
					y: py + r0 * Math.cos(degrees(ang)),
				});
			}
		}
		drawX2Text(options, {
			color: index === accRoll % n ? accC : fg,
			rotation: -ang,
			size,
			text: units[index]!,
			x,
			y,
		});
	}
}

/** 読み点ズーム — a reading point travels word to word and the word under it swells. */
function drawKzReadLens(options: TypographyLayoutOptions): void {
	const { frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const outDur = Math.min(0.3, duration / 3);
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const seed = seedOf(frame);
	const mag = rangeOf(seed, 3301, 1.45, 1.7);
	const end = pickOf(seed, 3302, ["key", "even", "key"]);
	const dim = randomUnit(seed, 3303) < 0.6;
	const bar = randomUnit(seed, 3304) < 0.7;
	const keyRoll = intOf(seed, 3305, 6);
	const text = frame.cut?.text ?? "";
	const latin = hasLatin(text);
	const sp = latin ? 0.36 : 0.16;
	const lead = 1.62;
	const units = kineticUnits({ text, maximum: 6 });
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({ count: n, duration, frac: 0.5, gap: 0.42 });
	const F = flowUnitsOf({
		latin,
		lead,
		maxH: H * (port ? 0.5 : 0.42),
		maxLines: tall ? 4 : 2,
		maxSize: H * (port ? 0.1 : 0.16),
		maxW: W * 0.84,
		sp,
		units,
	});
	let worst = 0;
	F.pt.forEach(([a, b]) => {
		let lw = 0;
		let mw = 0;
		for (let index = a; index < b; index++) {
			lw += F.ws[index]! + (index > a ? sp : 0);
			mw = Math.max(mw, F.ws[index]!);
		}
		worst = Math.max(worst, lw + (mag - 1) * mw);
	});
	const size = Math.min(F.size, (W * 0.88) / Math.max(1e-6, worst));
	const key = keyOf(units, keyRoll);
	const k = Math.max(0, curIdx(ts, lt));
	let str = outCubic(clamp01(lt / 0.25));
	let f =
		k >= 1 ? k - 1 + inOutCubic((lt - ts[k]!) / 0.22) : 0;
	const rf = f;
	const tE = Math.max(
		ts[n - 1]! + 0.25,
		Math.min(ts[n - 1]! + 0.6, duration - outDur - 0.35),
	);
	const rel = clamp01((lt - tE) / 0.4);
	let lensMag = mag;
	if (end === "key") {
		f = lerpN(f, key, smooth(rel));
		lensMag = lerpN(mag, 1 + (mag - 1) * 0.7, smooth(rel));
	} else {
		str *= 1 - rel;
	}
	const scales = units.map(
		(_, index) =>
			1 +
			(lensMag - 1) * smooth(clamp01(1 - Math.abs(f - index))) * str,
	);
	const X: number[] = [];
	const Y: number[] = [];
	const widths: number[] = [];
	F.pt.forEach(([a, b], li) => {
		let total = 0;
		for (let index = a; index < b; index++) {
			total += F.ws[index]! * size * scales[index]! + (index > a ? sp * size : 0);
		}
		let x = -total / 2;
		for (let index = a; index < b; index++) {
			const w = F.ws[index]! * size * scales[index]!;
			X[index] = W / 2 + x + w / 2;
			widths[index] = w;
			Y[index] = H / 2 + (li - (F.L - 1) / 2) * lead * size;
			x += w + sp * size;
		}
	});
	const { foreground: fg, accent: accC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	for (let index = 0; index < n; index++) {
		const g = clamp01(1 - Math.abs(f - index)) * str;
		drawX2Text(options, {
			alpha: dim
				? lerpN(
						0.42,
						1,
						Math.max(clamp01(rf - index + 1), rel),
					)
				: 1,
			color: g > 0.5 ? accC : fg,
			size: size * scales[index]!,
			text: units[index]!,
			x: X[index]!,
			y: Y[index]! - (scales[index]! - 1) * size * 0.3,
		});
	}
	if (bar && str > 0.01) {
		const a = Math.min(n - 1, Math.floor(f));
		const b = Math.min(n - 1, a + 1);
		const fr = f - a;
		const hop = Y[a] !== Y[b] ? Math.sin(PI * fr) : 0;
		const ux = lerpN(X[a]!, X[b]!, fr);
		const uw = lerpN(widths[a]!, widths[b]!, fr) * (1 - 0.5 * hop);
		const uy = lerpN(Y[a]!, Y[b]!, fr) + size * 0.66;
		drawKineticRule({
			alpha: str * out * clamp01(lt / 0.2),
			color: accC,
			height: Math.max(3, size * 0.07),
			options,
			width: uw,
			x: ux - uw / 2,
			y: uy,
		});
	}
}

/** ゲート開き — words hinge on a spine and swing open like gates, one after another. */
function drawKzGateSwing(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const mode = pickOf(seed, 3401, ["alt", "alt", "left", "right"]);
	const up = pickOf(seed, 3402, [1, 1, -1]);
	const accRoll = intOf(seed, 3403, 6);
	const dots = randomUnit(seed, 3404) < 0.75;
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 4,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.46,
		gap: 0.4,
	});
	const ms = units.map((unit) => approximateTextWidth({ size: 1, text: unit }));
	const mm = Math.max(...ms);
	const g = 0.3;
	const lead = 1.24;
	const alt = mode === "alt" && n > 2 && mm <= 5.2 && !port;
	const size = Math.min(
		(alt ? W * 0.43 : W * 0.8) / (mm + g),
		(H * 0.72) / (n * lead),
		H * 0.2,
	);
	 
	const sideOf = (index: number): number =>
		alt ? (index % 2 ? -1 : 1) : mode === "right" ? -1 : 1;
	const spineX = alt ? W / 2 : W / 2 - sideOf(0) * ((mm + g) * size) / 2;
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	 
	const yOf = (index: number): number =>
		H / 2 + (index - (n - 1) / 2) * lead * size;
	const e = outExpo(clamp01((lt - ts[k]!) / 0.3));
	const yb = lerpN(yOf(Math.max(0, k - 1)), yOf(k), e) + size * 0.62;
	const yt = yOf(0) - size * 0.62;
	segment({
		alpha: 0.9 * out,
		color: subC,
		ctx,
		from: [spineX, yt],
		thickness: Math.max(2, u * 0.004),
		to: [spineX, lerpN(yt, yb, k === 0 ? e : 1)],
	});
	for (let index = 0; index <= k; index++) {
		const s = sideOf(index);
		const d = k - index;
		let rot = -90 * s * up * sprg(lt - ts[index]!, 5.5, 12);
		if (d > 0) {
			rot +=
				3 *
				s *
				pls(lt - ts[k]! - 0.08 - d * 0.03, 6, 15) *
				0.7 ** (d - 1);
		}
		const y = yOf(index);
		drawX2Text(options, {
			align: s > 0 ? "left" : "right",
			color: index === accRoll % n ? accC : fg,
			rotation: rot,
			size,
			text: units[index]!,
			x: spineX + s * g * size,
			y,
		});
		if (dots) {
			dot({
				alpha: out,
				color: accC,
				ctx,
				radius: size * 0.075 * oBackP(clamp01((lt - ts[index]!) / 0.25), 2),
				x: spineX,
				y,
			});
		}
	}
}

/** 階段ホップ — a staircase is built tread by tread and each word hops up a step. */
function drawKzHopSteps(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const seed = seedOf(frame);
	const dx = rangeOf(seed, 3501, 0.6, 1.05);
	const accRoll = intOf(seed, 3502, 6);
	const riser = randomUnit(seed, 3503) < 0.6;
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.48,
		gap: 0.42,
	});
	const ms = units.map((unit) => approximateTextWidth({ size: 1, text: unit }));
	const lead = 1.34;
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	ms.forEach((m, index) => {
		lo = Math.min(lo, index * dx - m / 2);
		hi = Math.max(hi, index * dx + m / 2);
	});
	const size = Math.min((W * 0.82) / (hi - lo), (H * 0.74) / (n * lead), H * 0.2);
	const dir = -1;
	 
	const xOf = (index: number): number =>
		W / 2 + (index * dx - (lo + hi) / 2) * size;
	 
	const yOf = (index: number): number =>
		H / 2 - dir * (index - (n - 1) / 2) * lead * size - size * 0.05;
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const hop = 0.27;
	const lw = Math.max(3, size * 0.06);
	const pad = size * 0.14;
	for (let index = 0; index <= Math.min(n - 1, k + 1); index++) {
		const w = ms[index]! * size;
		const tau = lt - ts[index]! - hop;
		const dip =
			tau > 0 ? size * 0.07 * Math.exp(-tau * 10) * Math.cos(tau * 19) : 0;
		const te = outExpo(
			clamp01((lt - (index ? ts[index]! - 0.1 : 0)) / 0.24),
		);
		const ty = yOf(index) + size * 0.6 + dip;
		const x0 = xOf(index) - w / 2 - pad;
		if (te > 0) {
			segment({
				alpha: 0.9 * out,
				color: subC,
				ctx,
				from: [x0, ty],
				thickness: lw,
				to: [x0 + (w + pad * 2) * te, ty],
			});
			if (riser && index > 0) {
				segment({
					alpha: 0.6 * out,
					color: subC,
					ctx,
					from: [x0, ty],
					thickness: Math.max(1.5, lw * 0.4),
					to: [x0, ty + dir * (lead * size - lw) * te],
				});
			}
		}
		if (index > k) continue;
		const q = clamp01((lt - ts[index]!) / hop);
		const sx0 = index ? xOf(index - 1) : xOf(0) - size * 2.2;
		const sy0 = index ? yOf(index - 1) : yOf(0) + dir * lead * size;
		const x = lerpN(sx0, xOf(index), q);
		let y =
			lerpN(sy0, yOf(index), q) - size * 0.85 * Math.sin(PI * q) + dip;
		let sy = 1;
		const sz = size * lerpN(0.45, 1, outQuad(clamp01(q)));
		if (tau > 0) {
			sy = 1 - 0.22 * Math.exp(-tau * 12) * Math.cos(tau * 20);
			y += size * (1 - sy) * 0.5;
		}
		if (index < k) {
			const pq = clamp01((lt - ts[index + 1]!) / 0.16);
			sy *= 1 - 0.12 * Math.sin(PI * pq);
		}
		drawX2Text(options, {
			alpha: clamp01(q * 5),
			color: index === accRoll % n ? accC : fg,
			rotation: -dir * 12 * (1 - q),
			scaleY: sy,
			size: sz,
			text: units[index]!,
			x,
			y,
		});
	}
}

/** 折り出し — a folded leaflet: each word unfolds out of the edge of the previous one. */
function drawKzFoldOut(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const mode = pickOf(seed, 3601, ["chain", "chain", "stack"]);
	const crease = randomUnit(seed, 3602) < 0.8;
	const accRoll = intOf(seed, 3603, 6);
	const text = frame.cut?.text ?? "";
	const latin = hasLatin(text);
	const units = kineticUnits({ text, maximum: port ? 6 : 5 });
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.46,
		gap: 0.38,
	});
	const stack = mode === "stack" || (port && n <= 4);
	const lead = 1.36;
	const sp = latin ? 0.42 : 0.26;
	const F = flowUnitsOf({
		latin,
		lead,
		maxH: stack ? H * 0.72 : port ? H * 0.5 : H * 0.44,
		maxLines: stack ? n : tall ? 4 : 2,
		maxSize: H * (port ? 0.13 : 0.2),
		maxW: W * 0.82,
		sp,
		units,
	});
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const size = F.size;
	const cx = W / 2;
	const cy = H / 2;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const lw = Math.max(1.5, u * 0.0025);
	for (let index = 0; index <= k; index++) {
		const p = F.pos[index]!;
		const f = Math.max(0.001, spr(lt - ts[index]!, 8.5, 13));
		const vfold = index === p.a;
		const col = index === accRoll % n ? accC : fg;
		const color = mixHex({
			from: subC,
			progress: clamp01(f * 1.2 - 0.2),
			to: col,
		});
		const ce = outExpo(clamp01((lt - ts[index]!) / 0.3)) * out;
		if (vfold) {
			drawX2Text(options, {
				color,
				scaleY: f,
				size,
				skew: -14 * (1 - Math.min(1, f)),
				text: units[index]!,
				x: cx + p.x,
				y: cy + p.y - size / 2 + (size * f) / 2,
			});
			if (crease && p.li > 0) {
				const y = cy + p.y - (lead * size) / 2;
				const hw = F.lw[p.li]! / 2;
				segment({
					alpha: 0.6 * out,
					color: subC,
					ctx,
					from: [cx - hw * ce, y],
					thickness: lw,
					to: [cx + hw * ce, y],
				});
			}
		} else {
			drawX2Text(options, {
				color,
				scaleX: f,
				size,
				text: units[index]!,
				x: cx + p.x - p.w / 2 + (p.w * f) / 2,
				y: cy + p.y,
			});
			if (crease) {
				const x = cx + p.x - p.w / 2 - (sp * size) / 2;
				segment({
					alpha: 0.6 * out,
					color: subC,
					ctx,
					from: [x, cy + p.y - size * 0.55 * ce],
					thickness: lw,
					to: [x, cy + p.y + size * 0.55 * ce],
				});
			}
		}
	}
}

/** たわむ線 — words slide down a taut line that sags and bounces under their weight. */
function drawKzSagLine(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const sag = rangeOf(seed, 3701, 0.8, 1.2);
	const clip = randomUnit(seed, 3702) < 0.75;
	const accRoll = intOf(seed, 3703, 6);
	const text = frame.cut?.text ?? "";
	const latin = hasLatin(text);
	const units = kineticUnits({ text, maximum: 5 });
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.48,
		gap: 0.42,
	});
	const ropes = port ? 3 : gcount(text) > (tall ? 6 : 10) ? 2 : 1;
	const F = flowUnitsOf({
		latin,
		lead: 2.5,
		maxH: port ? H * 0.52 : ropes > 1 ? H * 0.46 : H * 0.24,
		maxLines: ropes,
		maxSize: H * (port ? 0.1 : 0.17),
		maxW: W * 0.78,
		sp: latin ? 0.5 : 0.34,
		units,
	});
	const size = F.size;
	const S = size * 0.55 * sag;
	const slide = 0.44;
	const cx = W / 2;
	const cy = H / 2;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const gm = Math.max(...units.map((unit) => gcount(unit)));
	const e0 = outExpo(clamp01(lt / 0.4));
	for (let li = 0; li < F.L; li++) {
		const loads: { a: number; i: number; m: number }[] = [];
		for (let index = 0; index < n; index++) {
			const p = F.pos[index]!;
			if (p.li !== li || lt < ts[index]!) continue;
			const tau = lt - ts[index]!;
			const q = outCubic(clamp01(tau / slide));
			const a = lerpN(W + p.w / 2 + size * 0.2, cx + p.x, q);
			loads.push({
				a,
				i: index,
				m:
					(0.55 + (0.45 * gcount(units[index]!)) / gm) *
					(1 + 0.5 * pls(tau - slide * 0.55, 4.5, 12)),
			});
		}
		 
		const defl = (x: number): number => {
			let d = 0;
			for (const l of loads) {
				const aa = Math.min(Math.max(l.a, 0), W);
				d += l.m * (x < aa ? x * (W - aa) : aa * (W - x));
			}
			return ((d * 4) / (W * W)) * S;
		};
		const yR = cy + F.pos[F.pt[li]![0]]!.y - size * 0.78 - S * 0.5;
		const xs = [
			0,
			...loads
				.map((l) => Math.min(Math.max(l.a, 0), W))
				.sort((a, b) => a - b),
			W,
		];
		polyline({
			alpha: 0.9 * out,
			color: subC,
			ctx,
			points: xs.map((x) => [x, yR + defl(x)] as const),
			thickness: Math.max(2, u * 0.004),
			upto: e0,
		});
		for (const l of loads) {
			const ry = yR + defl(l.a);
			const sl = (defl(l.a + 4) - defl(l.a - 4)) / 8;
			if (clip) {
				rect({
					alpha: out,
					color: accC,
					ctx,
					height: size * 0.24,
					width: size * 0.08,
					x: l.a - size * 0.04,
					y: ry - size * 0.07,
				});
			}
			drawX2Text(options, {
				color: l.i === accRoll % n ? accC : fg,
				rotation: (Math.atan(sl) * 0.8) / (PI / 180),
				size,
				text: units[l.i]!,
				x: l.a,
				y: ry + size * 0.74,
			});
		}
	}
}

/** ゴム発射 — a rubber band under the block is drawn back with each word and fires it up. */
function drawKzSlingshot(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const deep = rangeOf(seed, 3801, 0.6, 1);
	const accRoll = intOf(seed, 3802, 6);
	const posts = randomUnit(seed, 3803) < 0.8;
	const hot = randomUnit(seed, 3804) < 0.5;
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.5,
		gap: 0.44,
	});
	const F = flowUnitsOf({
		latin: hasLatin(frame.cut?.text ?? ""),
		maxH: H * 0.5,
		maxLines: tall ? 4 : 3,
		maxSize: H * (port ? 0.12 : 0.18),
		maxW: W * 0.84,
		units,
	});
	const size = F.size;
	const bx = W / 2;
	const by = H * 0.43;
	const band = H * 0.87;
	const half = Math.max(F.w / 2 + size * 0.2, W * 0.24);
	const pd = 0.17;
	const pull = size * deep;
	const { foreground: fg, accent: accC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const e0 = outExpo(clamp01(lt / 0.35));
	const k = curIdx(ts, lt);
	let ax = bx;
	let ay = band;
	for (let index = 0; index <= k; index++) {
		const p = F.pos[index]!;
		const tau = lt - ts[index]!;
		const tx = bx + p.x;
		const ty = by + p.y;
		const q = outCubic(clamp01(tau / pd));
		const ry = band - size * 0.6 + pull * q;
		const f = tau < pd ? 0 : spr(tau - pd, 9, 12);
		const st = tau < pd ? 1 - 0.25 * q : 1 + 0.3 * Math.exp(-(tau - pd) * 9);
		drawX2Text(options, {
			alpha: clamp01(tau / 0.05),
			color: (hot ? index === k : index === accRoll % n) ? accC : fg,
			scaleY: st,
			size,
			text: units[index]!,
			x: tx,
			y: lerpN(ry, ty, f),
		});
		if (index === k) {
			ax = tx;
			ay =
				tau < pd
					? band + pull * q
					: band - size * 0.4 * pls(tau - pd, 8, 34);
		}
	}
	const x0 = bx - half * e0;
	const x1 = bx + half * e0;
	const lw = Math.max(2.5, u * 0.005);
	polyline({
		alpha: 0.95 * out,
		color: accC,
		ctx,
		points: [
			[x0, band],
			[Math.min(Math.max(ax, x0), x1), ay],
			[x1, band],
		],
		thickness: lw,
	});
	if (posts) {
		for (const x of [x0, x1]) {
			segment({
				alpha: out,
				color: fg,
				ctx,
				from: [x, band - u * 0.03 * e0],
				thickness: lw * 1.3,
				to: [x, band + u * 0.045 * e0],
			});
		}
	}
}

/** 割り込み — the line stands closed; the key word drops in and wedges the others apart. */
function drawKzWedge(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const how = pickOf(seed, 3901, ["drop", "drop", "rise", "inflate"]);
	const keyRoll = intOf(seed, 3902, 6);
	const marks = randomUnit(seed, 3903) < 0.6;
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const F = flowUnitsOf({
		latin: hasLatin(frame.cut?.text ?? ""),
		maxH: H * (port ? 0.5 : 0.44),
		maxLines: tall ? 4 : 2,
		maxSize: H * (port ? 0.12 : 0.2),
		maxW: W * 0.84,
		units,
	});
	let key = keyOf(units, keyRoll);
	let kv = -1;
	units.forEach((unit, index) => {
		const p = F.pos[index]!;
		if (p.a === p.b) return;
		const v =
			gcount(unit) +
			(index > p.a && index < p.b ? 0.5 : 0) +
			((index + keyRoll) % n) * 0.01;
		if (v > kv) {
			kv = v;
			key = index;
		}
	});
	const size = F.size;
	const kp = F.pos[key]!;
	const tK = Math.min(Math.max(duration * 0.3, 0.3), 0.9);
	const fall = how === "inflate" ? 0 : 0.17;
	const hit = tK + fall;
	const open = spr(lt - hit, 7.5, 14);
	const kick = pls(lt - hit, 7, 16);
	const cx = W / 2;
	const cy = H / 2;
	const { foreground: fg, accent: accC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const nextP = key < kp.b ? F.pos[key + 1] : null;
	const prevP = key > kp.a ? F.pos[key - 1] : null;
	const gapPx = nextP
		? nextP.x - nextP.w / 2 - (kp.x + kp.w / 2)
		: prevP
			? kp.x - kp.w / 2 - (prevP.x + prevP.w / 2)
			: 0;
	const half = (kp.w + gapPx) / 2;
	let mn = Number.POSITIVE_INFINITY;
	let mx = Number.NEGATIVE_INFINITY;
	for (let index = kp.a; index <= kp.b; index++) {
		if (index === key) continue;
		const p = F.pos[index]!;
		const x = p.x + (index < key ? half : -half);
		mn = Math.min(mn, x - p.w / 2);
		mx = Math.max(mx, x + p.w / 2);
	}
	const corr = mn < mx ? -(mn + mx) / 2 : 0;
	for (let index = 0; index < n; index++) {
		if (index === key) continue;
		const p = F.pos[index]!;
		let x = p.x;
		let y = p.y;
		let rot = 0;
		if (p.li === kp.li) {
			const s = index < key ? 1 : -1;
			x += (s * half + corr) * (1 - open);
			rot = -s * 4 * kick;
		} else {
			y += Math.sign(p.li - kp.li) * size * 0.1 * kick;
		}
		drawX2Text(options, {
			color: fg,
			rotation: rot,
			size,
			text: units[index]!,
			x: cx + x,
			y: cy + y,
		});
	}
	const tau = lt - tK;
	if (tau >= 0) {
		let y = kp.y;
		let sy = 1;
		let sz = size;
		if (how === "inflate") {
			sz = size * Math.max(0.02, spr(tau, 8, 13));
		} else {
			y += (how === "rise" ? 1 : -1) * H * 0.62 * (1 - inQuad(clamp01(tau / fall)));
			if (lt > hit) {
				sy = 1 - 0.2 * Math.exp(-(lt - hit) * 12) * Math.cos((lt - hit) * 18);
			}
		}
		drawX2Text(options, {
			color: accC,
			scaleY: sy,
			size: sz,
			text: units[key]!,
			x: cx + kp.x,
			y: cy + y,
		});
		const t2 = lt - hit;
		if (marks && t2 > 0 && t2 < 0.35) {
			const q = t2 / 0.35;
			const e = outExpo(q);
			const lw = Math.max(2, u * 0.004);
			for (const s of [-1, 1]) {
				for (const v of [-1, 1]) {
					const x0 = cx + kp.x + s * (kp.w / 2 + size * 0.1 * e);
					const y0 = cy + kp.y + v * size * (0.56 + 0.2 * e);
					segment({
						alpha: (1 - q) * out,
						color: accC,
						ctx,
						from: [x0, y0],
						thickness: lw,
						to: [
							x0 + s * size * 0.16 * (1 - q),
							y0 + v * size * 0.16 * (1 - q),
						],
					});
				}
			}
		}
	}
}

/** 傾く盤 — a tray tips one way then the other; the lines slide to the walls and thud. */
function drawKzTiltTray(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const seed = seedOf(frame);
	const thRaw = rangeOf(seed, 4001, 4, 6.5);
	const sgn = pickOf(seed, 4002, [1, -1]);
	const frameKind = pickOf(seed, 4003, ["tray", "tray", "floor"]);
	const accRoll = intOf(seed, 4004, 6);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const F = flowUnitsOf({
		latin: hasLatin(frame.cut?.text ?? ""),
		lead: 1.3,
		maxH: H * 0.5,
		maxLines: tall ? 5 : 3,
		maxSize: H * (port ? 0.11 : 0.17),
		maxW: W * (port ? 0.62 : 0.56),
		units,
	});
	const size = F.size;
	const TW = W * 0.84;
	const TH = Math.max(F.h + size * 0.7, H * 0.26);
	const T = Math.min(Math.max(duration * 0.52, 0.5), 1.6);
	const th = thRaw * sgn;
	const tilt = lerpN(
		lerpN(-th, th, inOutCubic((lt - 0.1 * T) / (0.22 * T))),
		0,
		lt > 0.62 * T ? spr(lt - 0.62 * T, 5, 8) : 0,
	);
	 
	const sAt = (l: number): number => {
		const t1 = 0.16 * T + l * 0.045;
		const d1 = 0.26 * T;
		const t2 = 0.66 * T + l * 0.045;
		let s = -1;
		if (lt >= t1) {
			const q = (lt - t1) / d1;
			const t3 = lt - t1 - d1;
			s =
				q < 1
					? -1 + 2 * inQuad(clamp01(q))
					: 1 - 0.13 * Math.exp(-t3 * 9) * Math.abs(Math.sin(t3 * 17));
		}
		if (lt >= t2) s *= sprg(lt - t2, 5.5, 9);
		return s * sgn;
	};
	const cx = W / 2;
	const cy = H / 2;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const e0 = outExpo(clamp01(lt / 0.35));
	const lw = Math.max(2.5, Math.min(W, H) * 0.005);
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(degrees(tilt));
	const hw = TW / 2;
	const hh = TH / 2;
	const wall = frameKind === "tray" ? TH * e0 : TH * 0.3 * e0;
	polyline({
		alpha: 0.9 * out * e0,
		color: subC,
		ctx,
		points: [
			[-hw, hh - wall],
			[-hw, hh],
			[hw, hh],
			[hw, hh - wall],
		],
		thickness: lw,
	});
	ctx.restore();
	for (let index = 0; index < n; index++) {
		const p = F.pos[index]!;
		const R = Math.max(0, (TW - F.lw[p.li]!) / 2 - size * 0.22);
		const [x, y] = rotV(sAt(p.li) * R + p.x, p.y, tilt);
		drawX2Text(options, {
			color: n > 1 && index === accRoll % n ? accC : fg,
			rotation: tilt,
			size,
			text: units[index]!,
			x: cx + x,
			y: cy + y,
		});
	}
}

/** 主役リレー — one word holds the stage; the old one shrinks into a running line above. */
function drawKzRelay(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const acc = randomUnit(seed, 4101) < 0.7;
	const rule = randomUnit(seed, 4102) < 0.7;
	const al = pickOf(seed, 4103, ["center", "center", "left"]);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.5,
		gap: 0.46,
	});
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const capY = H * (port ? 0.33 : 0.25);
	const bigY = H * (port ? 0.56 : 0.6);
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const big = units.map((unit) =>
		Math.min(
			fitKineticText({
				height: H * 0.36,
				text: unit,
				width: W * 0.84,
			}),
			H * (port ? 0.24 : 0.36),
			W * 0.56,
		),
	);
	const Fc =
		n > 1
			? flowUnitsOf({
					latin: hasLatin(frame.cut?.text ?? ""),
					maxH: H * 0.15,
					maxLines: 2,
					maxSize: H * (port ? 0.055 : 0.1),
					maxW: W * 0.8,
					units: units.slice(0, n - 1),
				})
			: null;
	const left = al === "left" && Fc;
	const ox = left ? W * 0.1 + Fc!.w / 2 : W / 2;
	for (let index = 0; index <= k; index++) {
		if (index < k && Fc) {
			const q = outExpo(clamp01((lt - ts[index + 1]!) / 0.34));
			const p = Fc.pos[index]!;
			const size = Math.exp(
				lerpN(Math.log(big[index]!), Math.log(Fc.size), q),
			);
			const x = lerpN(
				left
					? W * 0.1 + approximateTextWidth({ size: big[index]!, text: units[index]! }) / 2
					: W / 2,
				ox + p.x,
				q,
			);
			drawX2Text(options, {
				color: acc ? mixHex({ from: accC, progress: q, to: fg }) : fg,
				size,
				text: units[index]!,
				x,
				y: lerpN(bigY, capY + p.y, q),
			});
		} else {
			const q = clamp01((lt - ts[index]!) / 0.22);
			const bw = approximateTextWidth({ size: big[index]!, text: units[index]! });
			drawX2Text(options, {
				alpha: index ? clamp01(q * 4) : 1,
				color: acc ? accC : fg,
				size: big[index]! * (index ? lerpN(1.6, 1, outExpo(q)) : 1),
				text: units[index]!,
				x: left ? W * 0.1 + bw / 2 : W / 2,
				y: bigY,
			});
		}
	}
	if (rule && Fc && k > 0) {
		const y = capY + Fc.h / 2 + Fc.size * 0.45;
		const w =
			Fc.w *
			lerpN(
				(k - 1) / (n - 1),
				k / (n - 1),
				outExpo(clamp01((lt - ts[k]!) / 0.35)),
			);
		segment({
			alpha: 0.85 * out,
			color: subC,
			ctx,
			from: [ox - Fc.w / 2, y],
			thickness: Math.max(2, u * 0.003),
			to: [ox - Fc.w / 2 + w, y],
		});
	}
}

/** 行送り — the lyric is fed out of a slot line by line in jerky steps. */
function drawKzLineFeed(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const outDur = Math.min(0.3, duration / 3);
	const seed = seedOf(frame);
	const al = pickOf(seed, 4201, ["left", "left", "center"]);
	const paper = randomUnit(seed, 4202) < 0.6;
	const accRoll = intOf(seed, 4203, 6);
	const steps = pickOf(seed, 4204, [2, 3, 3]);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: H > W * 1.08 ? 6 : 4,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({ count: n, duration, frac: 0.5, gap: 0.42 });
	const ms = units.map((unit) => approximateTextWidth({ size: 1, text: unit }));
	const mm = Math.max(...ms);
	const lead = 1.3;
	const size = Math.min((W * 0.76) / mm, (H * 0.6) / (n * lead), H * 0.19);
	const bh = n * lead * size;
	const bw = mm * size;
	const pad = size * 0.3;
	const slotY = Math.min(H * 0.9, H / 2 + bh / 2 + size * 0.7);
	const Yf = H / 2 - bh / 2;
	 
	const Yk = (k: number): number => slotY - size * 0.1 - (k + 1) * lead * size;
	const k = curIdx(ts, lt);
	 
	const stepE = (q: number): number => {
		const c = clamp01(q);
		const a = Math.floor(c * steps);
		return c >= 1 ? 1 : (a + outExpo(c * steps - a)) / steps;
	};
	const tE = Math.max(
		ts[n - 1]! + 0.3,
		Math.min(ts[n - 1]! + 0.6, duration - outDur - 0.4),
	);
	const ge = clamp01((lt - tE) / 0.45);
	let Y = k < 0 ? slotY : lerpN(k > 0 ? Yk(k - 1) : slotY, Yk(k), stepE((lt - ts[k]!) / 0.3));
	Y = lerpN(Y, Yf, ge);
	const { foreground: fg, accent: accC, secondary: subC, background: bg } =
		frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const e0 = outExpo(clamp01(lt / 0.3));
	const sa = (1 - ge) * out;
	const x0 = W / 2 - bw / 2;
	ctx.save();
	if (sa > 0.01) {
		ctx.beginPath();
		ctx.rect(-W, -H, W * 3, H + slotY);
		ctx.clip();
	}
	if (paper && k >= 0) {
		rect({
			alpha: 0.3 * out,
			color: subC,
			ctx,
			height: Math.min(slotY, Y + bh + pad * 0.5) - Y + pad * 0.5,
			width: bw + pad * 2,
			x: x0 - pad,
			y: Y - pad * 0.5,
		});
	}
	for (let index = 0; index <= k; index++) {
		drawX2Text(options, {
			align: al === "left" ? "left" : "center",
			color: index === accRoll % n ? accC : fg,
			size,
			text: units[index]!,
			x: al === "left" ? x0 : W / 2,
			y: Y + (index + 0.5) * lead * size,
		});
	}
	ctx.restore();
	if (sa > 0.01) {
		const sw = (bw + pad * 4.4) * e0;
		const sh = Math.max(5, size * 0.13);
		const busy = k >= 0 && lt - ts[k]! < 0.3;
		rect({
			alpha: sa,
			color: subC,
			ctx,
			height: sh,
			width: sw,
			x: W / 2 - sw / 2,
			y: slotY,
		});
		dot({
			alpha: sa * e0,
			color: busy && Math.floor(lt * 24) % 2 ? bg : accC,
			ctx,
			radius: sh * 0.28,
			x: W / 2 + sw / 2 - sh * 1.6,
			y: slotY + sh / 2,
		});
	}
}

/** 放物線 — every word is lobbed from a corner along a spinning arc and bounces in. */
function drawKzLob(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const from = pickOf(seed, 4301, ["bl", "br", "alt"]);
	const spin = pickOf(seed, 4302, [180, 270, 360]);
	const trail = randomUnit(seed, 4303) < 0.8;
	const accRoll = intOf(seed, 4304, 6);
	const units = kineticUnits({
		text: frame.cut?.text ?? "",
		maximum: port ? 6 : 5,
	});
	if (units.length === 0) return;
	const n = units.length;
	const ts = onsetsOf({
		count: n,
		duration: (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK,
		frac: 0.48,
		gap: 0.42,
	});
	const F = flowUnitsOf({
		latin: hasLatin(frame.cut?.text ?? ""),
		lead: 1.3,
		maxH: H * (port ? 0.5 : 0.46),
		maxLines: tall ? 4 : 3,
		maxSize: H * (port ? 0.12 : 0.19),
		maxW: W * 0.82,
		units,
	});
	const k = curIdx(ts, lt);
	if (k < 0) return;
	const size = F.size;
	const d = 0.42;
	const cx = W / 2;
	const cy = H * 0.47;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	for (let index = 0; index <= k; index++) {
		const p = F.pos[index]!;
		const sd = from === "bl" ? -1 : from === "br" ? 1 : index % 2 ? 1 : -1;
		const Lx = W * (sd < 0 ? 0.05 : 0.95);
		const Ly = H * 0.98;
		const tx = cx + p.x;
		const ty = cy + p.y;
		const hop = Math.max(H * 0.2, (Ly - ty) * 0.55);
		 
		const path = (q: number): [number, number] => [
			lerpN(Lx, tx, q),
			lerpN(Ly, ty, q) - hop * 4 * q * (1 - q),
		];
		const tau = lt - ts[index]!;
		const q = clamp01(tau / d);
		const [x, y] = path(q);
		const t2 = tau - d;
		if (trail) {
			for (let j = 1; j <= 11; j++) {
				const qq = j / 12;
				if (qq > q) break;
				const a =
					0.6 * (1 - clamp01((tau - qq * d) / 0.55)) * out;
				if (a < 0.02) continue;
				const [dxp, dyp] = path(qq);
				dot({
					alpha: a,
					color: subC,
					ctx,
					radius: Math.max(2, u * 0.0045),
					x: dxp,
					y: dyp,
				});
			}
		}
		if (tau < 0.3) {
			arcStroke({
				a0: 0,
				a1: TAU,
				alpha: (1 - tau / 0.3) * out,
				centerX: Lx,
				centerY: Ly,
				color: accC,
				ctx,
				radius: u * (0.015 + 0.06 * outExpo(clamp01(tau / 0.3))),
				thickness: Math.max(2, u * 0.004),
			});
		}
		drawX2Text(options, {
			color: index === accRoll % n ? accC : fg,
			rotation:
				-sd * spin * (1 - outCubic(clamp01(q))) +
				(t2 > 0 ? sd * 5 * pls(t2, 8, 17) : 0),
			size: size * lerpN(0.3, 1, outQuad(clamp01(q))),
			text: units[index]!,
			x,
			y: y + (t2 > 0 ? size * 0.14 * pls(t2, 9, 21) : 0),
		});
	}
}

/** 尺取り歩き — the line crawls into place like an inchworm: bunch up, stretch, repeat. */
function drawKzInchworm(options: TypographyLayoutOptions): void {
	const { ctx, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const port = H > W * 1.08;
	const tall = W < H * 1.45;
	const u = Math.min(W, H);
	const seed = seedOf(frame);
	const cyc = pickOf(seed, 4401, [2, 3, 3]);
	const dir = pickOf(seed, 4402, [1, 1, -1]);
	const accRoll = intOf(seed, 4403, 6);
	const track = randomUnit(seed, 4404) < 0.6;
	const text = frame.cut?.text ?? "";
	const latin = hasLatin(text);
	let units: readonly string[] = kineticUnits({ text, maximum: port ? 6 : 5 });
	if (units.length === 0) return;
	const gm = !latin && units.length < 3 && gcount(text) <= 8;
	if (gm) {
		units = Array.from(text.replaceAll(/\s+/gu, ""));
	}
	const n = units.length;
	const F = flowUnitsOf({
		latin,
		lead: 1.7,
		maxH: H * (port ? 0.5 : 0.4),
		maxLines: gm ? 1 : tall ? 4 : 2,
		maxSize: H * (port ? 0.11 : 0.17),
		maxW: W * 0.74,
		sp: latin ? 0.55 : gm ? 0.26 : 0.4,
		units,
	});
	const size = F.size;
	const T = Math.min(Math.max(duration * 0.5, 0.5), 1.5);
	const cmin = 0.08;
	const cx = W / 2;
	const cy = H / 2;
	const { foreground: fg, accent: accC, secondary: subC } = frame.palette;
	const out = 1 - inCubic(frame.exitProgress);
	const ph = clamp01(lt / T) * cyc;
	const cycle = Math.min(cyc - 1, Math.floor(ph));
	const fr = lt >= T ? 1 : ph - cycle;
	const cc =
		fr < 0.5
			? lerpN(1, cmin, inOutSine(clamp01(fr / 0.5)))
			: lerpN(cmin, 1, inOutSine(clamp01((fr - 0.5) / 0.5)));
	const pf = fr < 0.5 ? 0 : inOutSine(clamp01((fr - 0.5) / 0.5));
	const arch = (1 - cc) / (1 - cmin);
	F.pt.forEach(([a, b], li) => {
		const dirL = (li % 2 ? -1 : 1) * dir;
		const m = b - a;
		const gaps: number[] = [];
		let S = 0;
		for (let index = a; index < b - 1; index++) {
			const g =
				F.pos[index + 1]!.x -
				F.pos[index + 1]!.w / 2 -
				F.pos[index]!.x -
				F.pos[index]!.w / 2;
			gaps.push(g);
			S += g * (1 - cmin);
		}
		if (m === 1) S = size * 0.6;
		const off = -dirL * S * (cyc - cycle - pf) * (lt >= T ? 0 : 1);
		const xs: number[] = [];
		if (dirL > 0) {
			xs[b - 1] = F.pos[b - 1]!.x + off;
			for (let index = b - 2; index >= a; index--) {
				xs[index] =
					xs[index + 1]! -
					F.pos[index + 1]!.w / 2 -
					gaps[index - a]! * cc -
					F.pos[index]!.w / 2;
			}
		} else {
			xs[a] = F.pos[a]!.x + off;
			for (let index = a + 1; index < b; index++) {
				xs[index] =
					xs[index - 1]! +
					F.pos[index - 1]!.w / 2 +
					gaps[index - 1 - a]! * cc +
					F.pos[index]!.w / 2;
			}
		}
		const yl = cy + F.pos[a]!.y;
		if (track) {
			const e = outExpo(clamp01(lt / 0.4));
			const y = yl + size * 0.64;
			segment({
				alpha: 0.7 * out,
				color: subC,
				ctx,
				from: [cx - (F.w / 2) * e - size * 0.3, y],
				thickness: Math.max(1.5, u * 0.003),
				to: [cx + (F.w / 2) * e + size * 0.3, y],
			});
		}
		for (let index = a; index < b; index++) {
			const s = m > 1 ? (index - a) / (m - 1) : 0.5;
			const lift =
				m > 1 ? Math.sin(PI * (0.12 + 0.76 * s)) : Math.sin(PI * fr);
			drawX2Text(options, {
				color: index === accRoll % n ? accC : fg,
				rotation: m > 1 ? -16 * arch * Math.cos(PI * s) : 0,
				size,
				text: units[index]!,
				x: cx + xs[index]!,
				y: yl - size * 0.42 * arch * lift,
			});
		}
	});
}

export function drawX2KineticLayout(options: TypographyLayoutOptions): boolean {
	switch (options.frame.cut?.preset.layout) {
		case "kzConveyor":
			drawKzConveyor(options);
			return true;
		case "kzFoldOut":
			drawKzFoldOut(options);
			return true;
		case "kzGateSwing":
			drawKzGateSwing(options);
			return true;
		case "kzHopSteps":
			drawKzHopSteps(options);
			return true;
		case "kzInchworm":
			drawKzInchworm(options);
			return true;
		case "kzLineFeed":
			drawKzLineFeed(options);
			return true;
		case "kzLob":
			drawKzLob(options);
			return true;
		case "kzReadLens":
			drawKzReadLens(options);
			return true;
		case "kzRelay":
			drawKzRelay(options);
			return true;
		case "kzSagLine":
			drawKzSagLine(options);
			return true;
		case "kzShove":
			drawKzShove(options);
			return true;
		case "kzSlingshot":
			drawKzSlingshot(options);
			return true;
		case "kzSwingKnock":
			drawKzSwingKnock(options);
			return true;
		case "kzTiltTray":
			drawKzTiltTray(options);
			return true;
		case "kzWedge":
			drawKzWedge(options);
			return true;
		default:
			return false;
	}
}

// ============================================================================ DECOR

/** Approximate lyric box, as the kinetic decor family does (kinetic-decors.ts). */
function textBoundsOf({
	frame,
	height,
	width,
}: {
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}): Bounds {
	const characters = Array.from(frame.cut?.text ?? "");
	const size = Math.min(
		height * 0.22,
		width / Math.max(4, characters.length * 0.72),
	);
	const textWidth = Math.min(
		width * 0.86,
		Math.max(size, characters.length * size * 0.62),
	);
	const textHeight = size * 1.25;
	return {
		x0: width / 2 - textWidth / 2,
		x1: width / 2 + textWidth / 2,
		y0: height / 2 - textHeight / 2,
		y1: height / 2 + textHeight / 2,
	};
}

/** Decor word clock in seconds (JIZURA `wordTimes`, no beat lock). */
function wordTimesOf(frame: MotionTextRenderFrame): number[] {
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	let n = Math.max(
		1,
		Math.min(
			6,
			kineticWordSegments({ text: frame.cut?.text ?? "" }).length || 1,
		),
	);
	if (n < 2 && duration > 1.2) n = 2;
	const last = Math.max(0, Math.min(duration * 0.5, (n - 1) * 0.38));
	return Array.from(
		{ length: n },
		(_, index) => (n > 1 ? (last * index) / (n - 1) : 0),
	);
}

interface DecorAxis {
	 
	readonly at: (t: number, d: number) => [number, number];
	readonly dirX: number;
	readonly dirY: number;
	readonly len: number;
	readonly nrmX: number;
	readonly nrmY: number;
	readonly room: number;
	readonly s: number;
	readonly v: boolean;
}

/** Reading axis of the lyric box (JIZURA `axis`). */
function axisOf({
	bounds,
	height,
	prefer,
	width,
}: {
	readonly bounds: Bounds;
	readonly height: number;
	readonly prefer: number;
	readonly width: number;
}): DecorAxis {
	const u = Math.min(width, height);
	const v = bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.3;
	const roomA = v ? width - bounds.x1 : bounds.y0;
	const roomB = v ? bounds.x0 : height - bounds.y1;
	let s = prefer;
	if (
		(s < 0 ? roomA : roomB) < u * 0.13 &&
		(s < 0 ? roomB : roomA) > (s < 0 ? roomA : roomB)
	) {
		s = -s;
	}
	const room = s < 0 ? roomA : roomB;
	// eslint-disable-next-line opencut/prefer-object-params
	const at = (t: number, d: number): [number, number] =>
		v
			? [s < 0 ? bounds.x1 + d : bounds.x0 - d, lerpN(bounds.y0, bounds.y1, t)]
			: [lerpN(bounds.x0, bounds.x1, t), s < 0 ? bounds.y0 - d : bounds.y1 + d];
	return {
		at,
		dirX: v ? 0 : 1,
		dirY: v ? 1 : 0,
		len: v ? bounds.y1 - bounds.y0 : bounds.x1 - bounds.x0,
		nrmX: v ? (s < 0 ? 1 : -1) : 0,
		nrmY: v ? 0 : s < 0 ? -1 : 1,
		room,
		s,
		v,
	};
}

/** 着地の火花 — a fan of ticks kicks out from under each word as it lands. */
function drawKzImpactTicks(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.1)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const n = ts.length;
	const A = axisOf({ bounds, height: H, prefer: chanceOf(seed, 5101) ? 1 : -1, width: W });
	const col = frame.palette.accent;
	const N = 5 + intOf(seed, 5102, 3);
	const lw = Math.max(2, u * 0.0065);
	const base = Math.atan2(A.nrmY, A.nrmX) / (PI / 180);
	for (let j = 0; j < n; j++) {
		const tau = lt - ts[j]! - 0.04;
		if (tau < 0 || tau > 0.5) continue;
		const q = tau / 0.5;
		const e = outExpo(q);
		const [x, y] = A.at((j + 0.5) / n, u * 0.02);
		for (let m = 0; m < N; m++) {
			const a =
				(base +
					lerpN(-72, 72, (m + 0.5) / N) +
					randomSigned(seed, j, m) * 7) *
				(PI / 180);
			const r0 =
				u *
				(0.016 +
					(0.065 + 0.04 * randomUnit(seed, m, j, 2)) * e);
			const len =
				u * 0.06 * (1 - q) * (0.6 + 0.6 * randomUnit(seed, m, j, 3));
			segment({
				alpha: (1 - q * q) * o,
				color: col,
				ctx,
				from: [x + Math.cos(a) * r0, y + Math.sin(a) * r0],
				thickness: lw,
				to: [x + Math.cos(a) * (r0 + len), y + Math.sin(a) * (r0 + len)],
			});
		}
		const hw = u * 0.07 * e;
		segment({
			alpha: (1 - q) * o,
			color: col,
			ctx,
			from: [x - A.dirX * hw, y - A.dirY * hw],
			thickness: lw,
			to: [x + A.dirX * hw, y + A.dirY * hw],
		});
	}
}

/** 読み玉 — a ball hops along the lyric, landing on each word on its beat. */
function drawKzBounceDot(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.15)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const n = ts.length;
	const A = axisOf({ bounds, height: H, prefer: chanceOf(seed, 5201) ? -1 : 1, width: W });
	const col = frame.palette.accent;
	const sub = frame.palette.secondary;
	const r = u * 0.019;
	const gap = u * 0.024;
	const hopH = Math.min(u * 0.075, Math.max(u * 0.02, A.room - gap - r * 3));
	let k = 0;
	for (let j = 0; j < n; j++) {
		if (lt >= ts[j]! - Math.min(0.3, j ? (ts[j]! - ts[j - 1]!) * 0.8 : 0.3)) {
			k = j;
		}
	}
	const hd = k ? Math.min(0.3, (ts[k]! - ts[k - 1]!) * 0.8) : 0.22;
	const q = clamp01((lt - (ts[k]! - hd)) / hd);
	const t0 = k ? (k - 0.5) / n : 0.5 / n;
	const t1 = (k + 0.5) / n;
	let h = k ? hopH * 4 * q * (1 - q) : hopH * 2.4 * (1 - q) * (1 - q);
	const tl = lt - ts[k]!;
	const last = k === n - 1;
	if (q >= 1 && last) {
		h = hopH * 0.45 * Math.abs(Math.sin(tl * 6.5)) * Math.exp(-tl * 1.3);
	}
	const sq = q >= 1 ? 0.35 * Math.exp(-tl * 14) : 0;
	const [x, y] = A.at(lerpN(t0, t1, k ? q : 1), gap + r + h);
	for (let j = 0; j <= k; j++) {
		const tj = lt - ts[j]!;
		if (tj < 0) continue;
		const [mx, my] = A.at((j + 0.5) / n, gap * 0.45);
		const hw = u * 0.016 * oBackP(clamp01(tj / 0.2), 2.5);
		segment({
			alpha: o * (j === k ? 1 : 0.6),
			color: j === k ? col : sub,
			ctx,
			from: [mx - A.dirX * hw, my - A.dirY * hw],
			thickness: Math.max(2, u * 0.004),
			to: [mx + A.dirX * hw, my + A.dirY * hw],
		});
	}
	ctx.save();
	ctx.translate(x - A.nrmX * r * sq, y - A.nrmY * r * sq);
	ctx.scale(A.v ? 1 - sq : 1 + sq * 0.7, A.v ? 1 + sq * 0.7 : 1 - sq);
	dot({ alpha: o, color: col, ctx, radius: r, x: 0, y: 0 });
	ctx.restore();
}

/** 走る下線 — an underline shoots forward one word at a time, arrow first. */
function drawKzUnderRun(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.25)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const n = ts.length;
	const A = axisOf({ bounds, height: H, prefer: chanceOf(seed, 5301) ? 1 : -1, width: W });
	const col = frame.palette.accent;
	const sub = frame.palette.secondary;
	const k = Math.max(0, curIdx(ts, lt));
	const f = lerpN(k / n, (k + 1) / n, spr(lt - ts[k]!, 9, 15));
	const d = u * 0.035;
	const lw = Math.max(3, u * 0.007);
	const p0 = A.at(0, d);
	const pe = A.at(1, d);
	const p1 = A.at(Math.min(Math.max(f, 0), 1.03), d);
	const ah = u * 0.018;
	segment({
		alpha: 0.45 * o,
		color: sub,
		ctx,
		from: p0,
		thickness: Math.max(1.5, u * 0.002),
		to: pe,
	});
	for (let j = 1; j < n; j++) {
		const [x, y] = A.at(j / n, d);
		segment({
			alpha: 0.6 * o,
			color: sub,
			ctx,
			from: [x - A.nrmX * ah * 0.4, y - A.nrmY * ah * 0.4],
			thickness: Math.max(1.5, u * 0.002),
			to: [x + A.nrmX * ah * 0.4, y + A.nrmY * ah * 0.4],
		});
	}
	segment({ alpha: o, color: col, ctx, from: p0, thickness: lw, to: p1 });
	const tip: [number, number] = [
		p1[0] + A.dirX * ah * 1.3,
		p1[1] + A.dirY * ah * 1.3,
	];
	fillPolygon({
		alpha: o,
		color: col,
		ctx,
		points: [
			tip,
			[p1[0] + A.nrmX * ah * 0.8, p1[1] + A.nrmY * ah * 0.8],
			[p1[0] - A.nrmX * ah * 0.8, p1[1] - A.nrmY * ah * 0.8],
		],
	});
}

/** 揺れマーク — cartoon shake marks: nested arcs at both ends jump outwards per word. */
function drawKzWobbleArcs(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.2)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const k = Math.max(0, curIdx(ts, lt));
	const tau = lt - ts[k]!;
	const accent = randomUnit(seed, 5401) < 0.7;
	const col = accent ? frame.palette.accent : frame.palette.secondary;
	const v = bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.3;
	const cx = (bounds.x0 + bounds.x1) / 2;
	const cy = (bounds.y0 + bounds.y1) / 2;
	const span = v ? bounds.x1 - bounds.x0 : bounds.y1 - bounds.y0;
	const R = Math.max(u * 0.13, span * 0.85);
	const N = 2 + Math.min(2, intOf(seed, 5402, 3));
	const step = Math.floor(lt * 24);
	for (let m = 0; m < N; m++) {
		const kick = Math.exp(-Math.max(0, tau - m * 0.04) * 6);
		const d =
			u * (0.034 + 0.036 * m) +
			u * 0.04 * kick * (tau >= m * 0.04 ? 1 : 0);
		const half = (30 - m * 5) * (0.75 + 0.25 * kick);
		const a = (0.4 + 0.6 * kick) * o * (1 - m * 0.18);
		const lw = Math.max(2.5, u * (0.009 - m * 0.002));
		const wob = randomSigned(seed, step, m) * 2.5 * kick;
		for (const s of [-1, 1]) {
			if (v) {
				const y = s < 0 ? bounds.y0 - d : bounds.y1 + d;
				if (y < H * 0.02 || y > H * 0.98) continue;
				arcStroke({
					a0: 90 * s - half + wob,
					a1: 90 * s + half + wob,
					alpha: a,
					centerX: cx,
					centerY: y - s * R,
					color: col,
					ctx,
					radius: R,
					thickness: lw,
				});
			} else {
				const x = s < 0 ? bounds.x0 - d : bounds.x1 + d;
				if (x < W * 0.02 || x > W * 0.98) continue;
				arcStroke({
					a0: (s < 0 ? 180 : 0) - half + wob,
					a1: (s < 0 ? 180 : 0) + half + wob,
					alpha: a,
					centerX: x - s * R,
					centerY: cy,
					color: col,
					ctx,
					radius: R,
					thickness: lw,
				});
			}
		}
	}
}

/** 行進する破線 — a dashed frame whose dashes march round the lyric and lurch per word. */
function drawKzMarchFrame(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const pad = u * 0.045;
	const e = outExpo(clamp01(lt / 0.4));
	const x0 = Math.max(W * 0.025, bounds.x0 - pad * (2 - e));
	const y0 = Math.max(H * 0.025, bounds.y0 - pad * (2 - e));
	const x1 = Math.min(W * 0.975, bounds.x1 + pad * (2 - e));
	const y1 = Math.min(H * 0.975, bounds.y1 + pad * (2 - e));
	const dash = u * 0.022;
	const per = dash * 2;
	let ph = lt * u * 0.02;
	for (const t of ts) {
		if (lt > t) ph += per * 2.5 * (1 - Math.exp(-(lt - t) * 5));
	}
	ph *= chanceOf(seed, 5501) ? -1 : 1;
	const r = Math.min(u * 0.02, (x1 - x0) / 2, (y1 - y0) / 2);
	const straight = x1 - x0 - 2 * r;
	const side = y1 - y0 - 2 * r;
	const corner = (PI * r) / 2;
	const edge = straight + side + 2 * corner;
	// Perimeter spans, walked clockwise from (x0 + r, y0): straight edges carry
	// a unit direction, corner arcs carry their centre and start angle.
	const spans = [
		{ len: straight, type: "line" as const, x: x0 + r, y: y0, dx: 1, dy: 0 },
		{ len: corner, type: "arc" as const, x: x1 - r, y: y0 + r, a0: -PI / 2 },
		{ len: side, type: "line" as const, x: x1, y: y0 + r, dx: 0, dy: 1 },
		{ len: corner, type: "arc" as const, x: x1 - r, y: y1 - r, a0: 0 },
		{ len: straight, type: "line" as const, x: x1 - r, y: y1, dx: -1, dy: 0 },
		{ len: corner, type: "arc" as const, x: x0 + r, y: y1 - r, a0: PI / 2 },
		{ len: side, type: "line" as const, x: x0, y: y1 - r, dx: 0, dy: -1 },
		{ len: corner, type: "arc" as const, x: x0 + r, y: y0 + r, a0: PI },
	];
	// Point at arc length s along the rounded rect perimeter.
	 
	const perim = (s: number): [number, number] => {
		const q = (((s % edge) + edge) % edge) + 1e-6;
		let acc = 0;
		for (const span of spans) {
			if (q < acc + span.len) {
				const reach = q - acc;
				if (span.type === "line") {
					return [span.x + span.dx * reach, span.y + span.dy * reach];
				}
				const a = span.a0 + reach / Math.max(1e-6, r);
				return [span.x + Math.cos(a) * r, span.y + Math.sin(a) * r];
			}
			acc += span.len;
		}
		return [x0 + r, y0];
	};
	const sub = frame.palette.secondary;
	// eslint-disable-next-line opencut/prefer-object-params
	const drawDashes = (color: string, thickness: number, length: number, alpha: number, offset: number): void => {
		const step = Math.max(1, dash / 2);
		const stepCount = Math.ceil(edge / step) + 2;
		for (let index = 0; index < stepCount; index++) {
			const s0 = index * step - offset;
			if (s0 + step <= 0) continue;
			const frac = (((s0 % per) + per) % per) + 1e-6;
			if (frac >= length) continue;
			segment({
				alpha,
				color,
				ctx,
				from: perim(s0),
				thickness,
				to: perim(s0 + Math.min(step, length - frac)),
			});
		}
	};
	drawDashes(sub, Math.max(2, u * 0.004), dash, 0.8 * o, ph);
	const accentPhase = (((-ph * 2) % edge) + edge) % edge;
	segment({
		alpha: o,
		color: frame.palette.accent,
		ctx,
		from: perim(accentPhase),
		thickness: Math.max(3, u * 0.007),
		to: perim(accentPhase + dash * 3),
	});
}

/** 拍の針 — a small metronome in a corner; its arm swings across once per word. */
function drawKzMetronome(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const right = !chanceOf(seed, 5601);
	const low = chanceOf(seed, 5602);
	const Lr = u * 0.18;
	const mx = W * 0.05;
	const my = H * 0.05;
	const cand: readonly [boolean, boolean][] = [
		[right, low],
		[!right, low],
		[right, !low],
		[!right, !low],
	];
	let spot: [number, number] | null = null;
	for (const [r, l] of cand) {
		const x = r ? W - mx - (Lr * 1.5) / 2 : mx + (Lr * 1.5) / 2;
		const y = l ? H - my - (Lr * 1.2) / 2 : my + (Lr * 1.2) / 2;
		if (
			x + (Lr * 1.5) / 2 < bounds.x0 ||
			x - (Lr * 1.5) / 2 > bounds.x1 ||
			y + (Lr * 1.2) / 2 < bounds.y0 ||
			y - (Lr * 1.2) / 2 > bounds.y1
		) {
			spot = [x, y];
			break;
		}
	}
	if (!spot) return;
	const ts = wordTimesOf(frame);
	const k = Math.max(0, curIdx(ts, lt));
	const A0 = 30;
	const sub = frame.palette.secondary;
	const col = frame.palette.accent;
	const fg = frame.palette.foreground;
	const lw = Math.max(2.5, u * 0.006);
	 
	const tg = (j: number): number => (j % 2 ? 1 : -1) * A0;
	const tau = lt - ts[k]!;
	const ang =
		k === 0
			? tg(0) * oBackP(clamp01(lt / 0.3), 1.6)
			: lerpN(tg(k - 1), tg(k), inOutCubic(tau / 0.2)) +
				(tau > 0.2 ? tg(k) * 0.12 * pls(tau - 0.2, 7, 22) : 0);
	const px = spot[0];
	const py = spot[1] + Lr * 0.5;
	const e = outExpo(clamp01(lt / 0.35));
	arcStroke({
		a0: -90 - A0 - 4,
		a1: -90 + A0 + 4,
		alpha: 0.7 * o,
		centerX: px,
		centerY: py,
		color: sub,
		ctx,
		radius: Lr * e,
		thickness: Math.max(1.5, u * 0.0025),
	});
	for (let m = -2; m <= 2; m++) {
		const a = (-90 + (m * A0) / 2) * (PI / 180);
		const r0 = Lr * (m % 2 ? 0.95 : 0.9) * e;
		segment({
			alpha: 0.7 * o,
			color: sub,
			ctx,
			from: [px + Math.cos(a) * r0, py + Math.sin(a) * r0],
			thickness: Math.max(1.5, u * 0.0025),
			to: [px + Math.cos(a) * Lr * e, py + Math.sin(a) * Lr * e],
		});
	}
	const a = degrees(-90 + ang);
	const ex = px + Math.cos(a) * Lr * 0.9 * e;
	const ey = py + Math.sin(a) * Lr * 0.9 * e;
	segment({
		alpha: o,
		color: fg,
		ctx,
		from: [px, py],
		thickness: lw,
		to: [ex, ey],
	});
	dot({
		alpha: o,
		color: col,
		ctx,
		radius: u * 0.018 * e,
		x: lerpN(px, ex, 0.62),
		y: lerpN(py, ey, 0.62),
	});
	dot({ alpha: o, color: fg, ctx, radius: u * 0.007, x: px, y: py });
	segment({
		alpha: 0.8 * o,
		color: sub,
		ctx,
		from: [px - Lr * 0.3 * e, py + u * 0.012],
		thickness: lw,
		to: [px + Lr * 0.3 * e, py + u * 0.012],
	});
}

/** ばね支え — coil springs brace the lyric against the frame edges and jiggle per word. */
function drawKzSpringCoils(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const k = Math.max(0, curIdx(ts, lt));
	const jig = pls(lt - ts[k]!, 6, 26);
	const sub = frame.palette.secondary;
	const col = frame.palette.accent;
	const horiz = bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.3;
	const gap = u * 0.03;
	const lw = Math.max(2, u * 0.004);
	const N = 7 + 2 * Math.min(2, intOf(seed, 5701, 3));
	const amp = u * 0.022;
	const e = outExpo(clamp01(lt / 0.4));
	const c = horiz
		? Math.min(Math.max((bounds.y0 + bounds.y1) / 2, H * 0.08), H * 0.92)
		: Math.min(Math.max((bounds.x0 + bounds.x1) / 2, W * 0.08), W * 0.92);
	for (const s of [-1, 1]) {
		const wall = horiz ? (s < 0 ? W * 0.03 : W * 0.97) : s < 0 ? H * 0.03 : H * 0.97;
		const inner0 =
			(horiz ? (s < 0 ? bounds.x0 : bounds.x1) : s < 0 ? bounds.y0 : bounds.y1) +
			s * gap;
		const inner = lerpN(wall, inner0, e) + s * u * 0.018 * jig * (s < 0 ? 1 : -1);
		if ((inner - wall) * -s < u * 0.04) continue;
		// eslint-disable-next-line opencut/prefer-object-params
		const pt = (a: number, b: number): [number, number] =>
			horiz ? [a, b] : [b, a];
		const L = inner - wall;
		const pts: (readonly [number, number])[] = [
			pt(wall, c),
			pt(wall + L * 0.06, c),
		];
		for (let m = 0; m < N; m++) {
			pts.push(
				pt(
					wall + L * (0.08 + (0.84 * (m + 0.5)) / N),
					c +
						(m % 2 ? 1 : -1) *
							amp *
							Math.min(
								1.5,
								Math.max(0.7, (u * 0.3) / Math.abs(L) + 0.5),
							),
				),
			);
		}
		pts.push(pt(wall + L * 0.94, c), pt(inner, c));
		polyline({ alpha: 0.9 * o, color: sub, ctx, points: pts, thickness: lw });
		const ph = u * 0.035;
		segment({
			alpha: o,
			color: col,
			ctx,
			from: pt(inner, c - ph),
			thickness: lw * 1.6,
			to: pt(inner, c + ph),
		});
		segment({
			alpha: 0.9 * o,
			color: sub,
			ctx,
			from: pt(wall, c - ph * 1.3),
			thickness: lw * 1.6,
			to: pt(wall, c + ph * 1.3),
		});
	}
}

/** 流れる山形 — a lane of chevrons marches in the reading direction. */
function drawKzChevronRun(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const n = ts.length;
	const A = axisOf({ bounds, height: H, prefer: chanceOf(seed, 5801) ? 1 : -1, width: W });
	const k = Math.max(0, curIdx(ts, lt));
	const g = u * 0.036;
	const M = Math.max(3, Math.min(40, Math.floor(A.len / g)));
	const sz = u * 0.015;
	const lw = Math.max(2, u * 0.005);
	const d = u * 0.05;
	let ph = lt * 0.55;
	for (const t of ts) {
		if (lt > t) ph += 1.2 * (1 - Math.exp(-(lt - t) * 6));
	}
	const head =
		lerpN(k / n, (k + 1) / n, 0.5) +
		(k ? -(1 / n) * sprg(lt - ts[k]!, 8, 12) : 0);
	const col = frame.palette.accent;
	const sub = frame.palette.secondary;
	for (let m = 0; m < M; m++) {
		const t = (m + (ph % 1)) / M;
		const edge = clamp01(Math.min(t, 1 - t) * 7);
		const hot = Math.exp(-(((t - head) * n * 1.3) ** 2));
		const [x, y] = A.at(t, d);
		const a = (0.3 + 0.7 * hot) * edge * o;
		if (a < 0.02) continue;
		const tip: [number, number] = [x + A.dirX * sz * 0.6, y + A.dirY * sz * 0.6];
		const b0: [number, number] = [x - A.dirX * sz * 0.6, y - A.dirY * sz * 0.6];
		const color = hot > 0.5 ? col : sub;
		segment({
			alpha: a,
			color,
			ctx,
			from: [b0[0] + A.nrmX * sz, b0[1] + A.nrmY * sz],
			thickness: lw,
			to: tip,
		});
		segment({
			alpha: a,
			color,
			ctx,
			from: [b0[0] - A.nrmX * sz, b0[1] - A.nrmY * sz],
			thickness: lw,
			to: tip,
		});
	}
}

/** 巻き風 — looping wind curls whip off the lyric each time a word arrives. */
function drawKzWhooshCurls(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const duration = (frame.cut?.duration ?? 120_000) * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.1)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const n = ts.length;
	const col = randomUnit(seed, 5901) < 0.7 ? frame.palette.accent : frame.palette.secondary;
	const lw = Math.max(2.5, u * 0.006);
	const life = 0.8;
	const events: [number, number][] = ts.map((t, j) => [t, j]);
	for (let m = 1, t = ts[n - 1]! + 0.9; m <= 6 && t < duration - 0.4; m++, t += 0.9) {
		events.push([t, n + m]);
	}
	const low = chanceOf(seed, 5902);
	const bk = chanceOf(seed, 5903) ? 1 : -1;
	for (const [t0, j] of events) {
		const tau = lt - t0 - 0.03;
		if (tau < 0 || tau > life) continue;
		const q = tau / life;
		const side = (j + (low ? 1 : 0)) % 2 ? 1 : -1;
		const A = axisOf({ bounds, height: H, prefer: side, width: W });
		const late = j >= n;
		const f = late ? randomUnit(seed, j, 1) : (j + 0.5) / n;
		const [ox, oy] = A.at(f, u * 0.035);
		const sc0 =
			u * (0.032 + 0.012 * randomUnit(seed, j, 2)) * (late ? 0.8 : 1);
		const pts: (readonly [number, number])[] = [];
		for (let s = 0; s <= 40; s++) {
			const th = lerpN(-1.4, 7.7, s / 40);
			const a = th - 1.9 * Math.sin(th);
			const b = 1 - 1.9 * Math.cos(th) + 0.9;
			pts.push([
				ox +
					(A.dirX * a * bk + A.nrmX * b * 0.55) * sc0 +
					A.dirX * bk * sc0 * 2 * q,
				oy +
					(A.dirY * a * bk + A.nrmY * b * 0.55) * sc0 +
					A.dirY * bk * sc0 * 2 * q,
			]);
		}
		const hd = Math.round(40 * outCubic(clamp01(q * 1.7)));
		const tl = Math.round(40 * inCubic(clamp01(q * 1.25 - 0.25)));
		if (hd - tl >= 1) {
			polyline({
				alpha: (late ? 0.55 : 0.9) * o,
				color: col,
				ctx,
				points: pts.slice(tl, hd + 1),
				thickness: lw,
			});
		}
	}
}

/** 押しピストン — piston rods come in from the frame edges and tap the lyric. */
function drawKzPushRods(options: X2KineticDecorDraw): void {
	const { ctx, decor: _decor, frame, height: H, width: W } = options;
	const lt = frame.localTime * SECONDS_PER_TICK;
	const o = outCubic(clamp01(lt / 0.3)) * (1 - inCubic(frame.exitProgress));
	if (o <= 0.01) return;
	const u = Math.min(W, H);
	const bounds = textBoundsOf({ frame, height: H, width: W });
	const seed = seedOf(frame);
	const ts = wordTimesOf(frame);
	const sub = frame.palette.secondary;
	const col = frame.palette.accent;
	const e = outExpo(clamp01(lt / 0.4));
	const vRoll = intOf(seed, 6001, 2);
	const horiz =
		!(bounds.y1 - bounds.y0 > (bounds.x1 - bounds.x0) * 1.3) !==
		!!(
			vRoll % 2 &&
			Math.min(bounds.x0, W - bounds.x1) > u * 0.16 &&
			Math.min(bounds.y0, H - bounds.y1) > u * 0.16
		);
	const th = Math.max(4, u * 0.012);
	const rest = u * 0.06;
	const span = horiz ? bounds.y1 - bounds.y0 : bounds.x1 - bounds.x0;
	const hp = Math.min(Math.max(span * 0.3, u * 0.03), u * 0.09);
	const c = horiz
		? Math.min(Math.max((bounds.y0 + bounds.y1) / 2, H * 0.08), H * 0.92)
		: Math.min(Math.max((bounds.x0 + bounds.x1) / 2, W * 0.08), W * 0.92);
	for (const s of [-1, 1]) {
		let push = 0;
		ts.forEach((t, j) => {
			if (j && (j % 2 ? 1 : -1) !== s) return;
			const tau = lt - t + 0.05;
			if (tau > 0) {
				push = Math.max(
					push,
					tau < 0.05 ? tau / 0.05 : Math.exp(-(tau - 0.05) * 6),
				);
			}
		});
		const edge = horiz ? (s < 0 ? 0 : W) : s < 0 ? 0 : H;
		const tgt =
			(horiz ? (s < 0 ? bounds.x0 : bounds.x1) : s < 0 ? bounds.y0 : bounds.y1) +
			s * (u * 0.014 + rest * (1 - push));
		if ((tgt - edge) * -s < u * 0.03) continue;
		const tip = lerpN(edge, tgt, e);
		const a = Math.min(edge, tip);
		const b = Math.abs(tip - edge);
		if (horiz) {
			rect({ alpha: 0.9 * o, color: sub, ctx, height: th, width: b, x: a, y: c - th / 2 });
			rect({
				alpha: o,
				color: col,
				ctx,
				height: hp * 2,
				width: th,
				x: tip - (s < 0 ? th : 0),
				y: c - hp,
			});
		} else {
			rect({ alpha: 0.9 * o, color: sub, ctx, height: b, width: th, x: c - th / 2, y: a });
			rect({
				alpha: o,
				color: col,
				ctx,
				height: th,
				width: hp * 2,
				x: c - hp,
				y: tip - (s < 0 ? th : 0),
			});
		}
	}
}

export function drawX2KineticDecor(options: X2KineticDecorDraw): void {
	switch (options.decor) {
		case "kzBounceDot":
			drawKzBounceDot(options);
			return;
		case "kzChevronRun":
			drawKzChevronRun(options);
			return;
		case "kzImpactTicks":
			drawKzImpactTicks(options);
			return;
		case "kzMarchFrame":
			drawKzMarchFrame(options);
			return;
		case "kzMetronome":
			drawKzMetronome(options);
			return;
		case "kzPushRods":
			drawKzPushRods(options);
			return;
		case "kzSpringCoils":
			drawKzSpringCoils(options);
			return;
		case "kzUnderRun":
			drawKzUnderRun(options);
			return;
		case "kzWhooshCurls":
			drawKzWhooshCurls(options);
			return;
		case "kzWobbleArcs":
			drawKzWobbleArcs(options);
			return;
		default:
			return;
	}
}

// ============================================================================ BACKGROUNDS

/** 幅取り — plan-style seed for a background run (JIZURA `bs(rng)`). */
function bgSeedOf(frame: MotionTextRenderFrame): number {
	return (Math.abs(seedOf(frame)) % 999_983) + 1;
}

/** Fade-in over the first `over` seconds of the cut (JIZURA `fadeIn`). */
// eslint-disable-next-line opencut/prefer-object-params
function bgFade(frame: MotionTextRenderFrame, over = 0.8): number {
	return outCubic(clamp01((frame.localTime * SECONDS_PER_TICK) / over));
}

/** 加速する筋 — streaks that surge at every cut and coast in between. */
function drawKzKickStreaks(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const lt = frame.localTime * SECONDS_PER_TICK;
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const idx = Math.abs(seedOf(frame)) % 5;
	const ang = pickOf(s, 6101, [0, 0, 180, -18, 162, 90]);
	const n = 12 + intOf(s, 6102, 7);
	const k = 0.07 + randomUnit(s, 6103) * 0.03;
	const { foreground: fg, accent: accent } = frame.palette;
	const D = Math.hypot(W, H);
	const trav = t * 0.05 + 0.3 * (idx + 1 - Math.exp(-lt * 5));
	const speed = Math.exp(-lt * 5);
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	ctx.translate(W / 2, H / 2);
	ctx.rotate(degrees(ang));
	for (let index = 0; index < n; index++) {
		const dep = 0.5 + randomUnit(s, index, 1);
		const len = D * (0.08 + 0.2 * randomUnit(s, index, 2)) * (1 + 0.8 * speed);
		const th = Math.max(
			2,
			u * (0.004 + 0.02 * randomUnit(s, index, 3) * randomUnit(s, index, 6)),
		);
		const x =
			(((randomUnit(s, index, 4) * (D + len) + trav * dep * D) % (D + len)) +
				(D + len)) %
				(D + len) -
			len -
			D / 2;
		const y = (randomUnit(s, index, 5) - 0.5) * D;
		const baseAlpha = ctx.globalAlpha;
		ctx.fillStyle =
			index % 6 === 2 ? accent : fg;
		ctx.globalAlpha =
			baseAlpha *
			clamp01(index % 6 === 2 ? k * 1.3 : k * (0.6 + 0.7 * randomUnit(s, index, 7)));
		ctx.fillRect(x, y - th / 2, len, th);
		ctx.globalAlpha = baseAlpha;
	}
	ctx.restore();
}

/** 転がる四角 — a huge square tumbles corner over corner along the floor. */
function drawKzRollSquare(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const k = 0.04 + randomUnit(s, 6201) * 0.015;
	const dir = pickOf(s, 6202, [1, -1]);
	const per = 2.6 + randomUnit(s, 6203);
	const sizeK = 0.5 + randomUnit(s, 6204) * 0.16;
	const two = randomUnit(s, 6205) < 0.6;
	const fg = frame.palette.foreground;
	const fl = H * 0.9;
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	rect({ alpha: k * 1.6, color: fg, ctx, height: Math.max(2, u * 0.003), width: W, x: 0, y: fl });
	// eslint-disable-next-line opencut/prefer-object-params
	const roll = (S: number, rollPer: number, d: number, ph: number, fillA: number, accent: boolean) => {
		const tt = t / rollPer + ph;
		const st = Math.floor(tt);
		const fr = clamp01((tt - st) / 0.82);
		const a = 90 * fr ** 2.3;
		const span = Math.ceil((W + S * 2) / S) * S;
		const px = (((st + 2 + Math.floor(ph * 2)) * S) % span + span) % span - S;
		ctx.save();
		ctx.translate(d > 0 ? px : W - px, fl);
		ctx.rotate(degrees(a * d));
		const x0 = d > 0 ? -S : 0;
		const color = accent ? frame.palette.accent : fg;
		rect({ alpha: fillA, color, ctx, height: S, width: S, x: x0, y: -S });
		const lw = Math.max(2, u * 0.003);
		for (const [ex, ey, ew, eh] of [
			[x0, -S, S, lw],
			[x0, 0, S, lw],
			[x0, -S, lw, S],
			[x0 + S - lw, -S, lw, S],
		] as const) {
			rect({ alpha: fillA * 2.2, color: fg, ctx, height: eh, width: ew, x: ex, y: ey });
		}
		for (const [ex, ey, ew, eh] of [
			[x0 + S * 0.2, -S * 0.8, S * 0.6, lw],
			[x0 + S * 0.2, -S * 0.2, S * 0.6, lw],
			[x0 + S * 0.2, -S * 0.8, lw, S * 0.6],
			[x0 + S * 0.8 - lw, -S * 0.8, lw, S * 0.6],
		] as const) {
			rect({ alpha: fillA * 2.2, color: fg, ctx, height: eh, width: ew, x: ex, y: ey });
		}
		ctx.restore();
	};
	if (two) roll(u * 0.26, per * 0.55, -dir, (s % 97) / 97, k * 0.9, true);
	roll(u * sizeK, per, dir, (s % 53) / 53, k, false);
	ctx.restore();
}

/** 弾む円 — a few big soft discs bounce slowly across the floor, squashing as they land. */
function drawKzBounceDiscs(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const k = 0.045 + randomUnit(s, 6301) * 0.015;
	const n = 3 + intOf(s, 6302, 2);
	const dir = pickOf(s, 6303, [1, -1]);
	const fg = frame.palette.foreground;
	const fl = H * 0.97;
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	for (let index = 0; index < n; index++) {
		const r = u * (0.1 + 0.16 * randomUnit(s, index, 1));
		const Tb = 1.7 + 1.3 * randomUnit(s, index, 2) + (r / u) * 2;
		const f = (((t / Tb + randomUnit(s, index, 3)) % 1) + 1) % 1;
		const hgt = H * (0.35 + 0.4 * randomUnit(s, index, 4));
		const vx = (0.03 + 0.03 * randomUnit(s, index, 5)) * dir * (index % 2 ? 1 : -0.7);
		const x =
			(((randomUnit(s, index, 6) * (W + r * 2) + t * vx * W) % (W + r * 2)) +
				(W + r * 2)) %
				(W + r * 2) -
			r;
		const h = hgt * 4 * f * (1 - f);
		const near = Math.exp(-Math.min(f, 1 - f) * Tb * 14);
		const sq = 0.16 * near;
		dot({
			alpha: k * 0.7 * (1 - (h / hgt) * 0.8),
			color: fg,
			ctx,
			radius: r,
			scaleX: 1.1 - (0.5 * h) / hgt,
			scaleY: 0.07,
			x,
			y: fl,
		});
		dot({
			alpha: index === 1 ? k * 1.1 : k,
			color: index === 1 ? frame.palette.accent : fg,
			ctx,
			radius: r,
			scaleX: 1 + sq * 0.7,
			scaleY: 1 - sq,
			x,
			y: fl - r * (1 - sq) - h,
		});
	}
	ctx.restore();
}

/** 揺れる地平 — the lower half of the frame is a plane that rocks like a see-saw. */
function drawKzRockHorizon(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const amp = 3.5 + randomUnit(s, 6401) * 3;
	const per = 5 + randomUnit(s, 6402) * 3;
	const y = pickOf(s, 6403, [0.64, 0.7, 0.74]);
	const k = 0.045 + randomUnit(s, 6404) * 0.015;
	const ball = randomUnit(s, 6405) < 0.75;
	const fg = frame.palette.foreground;
	const w = TAU / per;
	const ph = (s % 100 / 100) * TAU;
	const a = amp * Math.sin(t * w + ph);
	const D = Math.hypot(W, H);
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	ctx.translate(W / 2, H * y);
	ctx.rotate(degrees(a));
	rect({ alpha: k, color: fg, ctx, height: D, width: D * 2, x: -D, y: 0 });
	rect({ alpha: k * 2.2, color: fg, ctx, height: Math.max(2, u * 0.003), width: D * 2, x: -D, y: 0 });
	rect({ alpha: k * 1.2, color: fg, ctx, height: Math.max(1.5, u * 0.0015), width: D * 2, x: -D, y: u * 0.03 });
	if (ball) {
		const r = u * 0.055;
		const sx = -W * 0.36 * Math.cos(t * w + ph);
		dot({ alpha: k * 1.5, color: frame.palette.accent, ctx, radius: r, x: sx, y: -r });
		const ra = sx / r;
		segment({
			alpha: 0.5,
			color: frame.palette.background,
			ctx,
			from: [sx, -r],
			thickness: Math.max(2, u * 0.003),
			to: [sx + Math.cos(ra) * r, -r + Math.sin(ra) * r],
		});
	}
	fillPolygon({
		alpha: k * 1.6,
		color: fg,
		ctx,
		points: [
			[0, 0],
			[-u * 0.05, u * 0.085],
			[u * 0.05, u * 0.085],
		],
	});
	ctx.restore();
}

/** 噛み合う歯車 — huge meshing gears turn slowly at the corners. */
function drawKzBigGears(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const k = 0.035 + randomUnit(s, 6501) * 0.015;
	const flip = randomUnit(s, 6502) < 0.5;
	const spd = (3 + randomUnit(s, 6503) * 3) * pickOf(s, 6504, [1, -1]);
	const nA = pickOf(s, 6505, [16, 18, 22]);
	const ang = -50 + randomUnit(s, 6506) * 30;
	const fg = frame.palette.foreground;
	const nB = Math.round(nA * 0.6);
	const nC = Math.round(nA * 0.42);
	// eslint-disable-next-line opencut/prefer-object-params
	const gear = (x: number, gy: number, R: number, teeth: number, th: number, fillA: number, color: string) => {
		const st = TAU / teeth;
		const m = ((R * PI) / teeth) * 0.55;
		for (let index = 0; index < teeth; index++) {
			const a = th + index * st;
			const pts: (readonly [number, number])[] = [
				[a - st * 0.18, R + m],
				[a + st * 0.18, R + m],
				[a + st * 0.32, R - m],
				[a + st * 0.68, R - m],
			].map(([q, r]) => [x + Math.cos(q) * r, gy + Math.sin(q) * r] as const);
			fillPolygon({ alpha: fillA, color, ctx, points: pts });
		}
		arcStroke({
			a0: 0,
			a1: TAU,
			alpha: fillA * 2.2,
			centerX: x,
			centerY: gy,
			color: fg,
			ctx,
			radius: R * 0.72,
			thickness: Math.max(2, u * 0.003),
		});
		dot({ alpha: fillA, color, ctx, radius: R * 0.3, x, y: gy });
		for (let index = 0; index < 4; index++) {
			const a = th + (index * TAU) / 4;
			segment({
				alpha: fillA * 2.2,
				color: fg,
				ctx,
				from: [x + Math.cos(a) * R * 0.3, gy + Math.sin(a) * R * 0.3],
				thickness: Math.max(2, u * 0.003),
				to: [x + Math.cos(a) * R * 0.72, gy + Math.sin(a) * R * 0.72],
			});
		}
	};
	// eslint-disable-next-line opencut/prefer-object-params
	const mesh = (x: number, y: number, R: number, teeth: number, th: number, R2: number, teeth2: number, phi: number): [number, number, number] => [
		x + Math.cos(phi) * (R + R2),
		y + Math.sin(phi) * (R + R2),
		phi + PI + PI / teeth2 - ((th - phi) * teeth) / teeth2,
	];
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	if (flip) {
		ctx.translate(W, 0);
		ctx.scale(-1, 1);
	}
	const RA = u * 0.5;
	const RB = (RA * nB) / nA;
	const RC = (RA * nC) / nA;
	const ax = W * 0.1;
	const ay = H * 0.9;
	const thA = t * spd * (PI / 180);
	gear(ax, ay, RA, nA, thA, k, fg);
	const phi = degrees(ang);
	const [bx, by, thB] = mesh(ax, ay, RA, nA, thA, RB, nB, phi);
	gear(bx, by, RB, nB, thB, k * 1.15, fg);
	const [cx2, cy2, thC] = mesh(bx, by, RB, nB, thB, RC, nC, phi - 1.15);
	gear(cx2, cy2, RC, nC, thC, k * 0.9, fg);
	ctx.restore();
}

/** 疎密の波 — parallel lines carry a compression wave: they bunch up and spread out. */
function drawKzSqueezeLines(options: X2KineticBackgroundDraw): void {
	const { ctx, frame, height: H, width: W } = options;
	const s = bgSeedOf(frame);
	const u = Math.min(W, H);
	const t = frame.sequenceTime * SECONDS_PER_TICK;
	const vert = randomUnit(s, 6601) < 0.7;
	const n = 30 + intOf(s, 6602, 11);
	const per = (4.5 + randomUnit(s, 6603) * 2.5) * pickOf(s, 6604, [1, -1]);
	const lamK = 0.55 + randomUnit(s, 6605) * 0.3;
	const k = 0.1 + randomUnit(s, 6606) * 0.04;
	const fg = frame.palette.foreground;
	const accent = frame.palette.accent;
	const L = vert ? W : H;
	const lam = L * lamK;
	const amp = (lam / TAU) * 0.78;
	const lw = Math.max(2, u * 0.0035);
	const t2 = t / per;
	ctx.save();
	ctx.globalAlpha = bgFade(frame);
	for (let index = -4; index < n + 4; index++) {
		const x0 = ((index + 0.5) / n) * L;
		const x = x0 + amp * Math.sin(TAU * (x0 / lam - t2));
		const dens = 1 - 0.78 * Math.cos(TAU * (x0 / lam - t2));
		const accentLine = index % 9 === 4;
		rect({
			alpha: accentLine ? k * 1.3 : k * (0.55 + 0.25 * dens),
			color: accentLine ? accent : fg,
			ctx,
			height: vert ? H : lw,
			width: vert ? lw : W,
			x: vert ? x - lw / 2 : 0,
			y: vert ? 0 : x - lw / 2,
		});
	}
	ctx.restore();
}

export function drawX2KineticBackground(options: X2KineticBackgroundDraw): void {
	const { ctx } = options;
	ctx.save();
	try {
		switch (options.frame.cut?.preset.bg) {
			case "kzBigGears":
				drawKzBigGears(options);
				return;
			case "kzBounceDiscs":
				drawKzBounceDiscs(options);
				return;
			case "kzKickStreaks":
				drawKzKickStreaks(options);
				return;
			case "kzRockHorizon":
				drawKzRockHorizon(options);
				return;
			case "kzRollSquare":
				drawKzRollSquare(options);
				return;
			case "kzSqueezeLines":
				drawKzSqueezeLines(options);
				return;
			default:
				return;
		}
	} finally {
		ctx.restore();
	}
}
