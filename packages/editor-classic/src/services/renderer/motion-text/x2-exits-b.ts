import {
	drawEnterBLine,
	drawEnterBRing,
	enterBGlyphs,
	type EnterBDraw,
	type EnterBBounds,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	drawExitHoldOutline,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	smooth,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext } from "./types";
import {
	drawX2Glyphs,
	x2Bounds,
	x2Hash,
	x2Hot,
	x2Signed,
	x2Stagger,
	x2Unit,
	type X2Draw,
} from "./x2-drawing";

const PI = Math.PI;
const TAU = Math.PI * 2;
/** Off-screen slack the source packs rely on (JIZURA `BIG`). */
const BIG = 8000;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

/** Progress confined to the a..b window (JIZURA `seg`). */
// eslint-disable-next-line opencut/prefer-object-params
function seg(value: number, start: number, end: number): number {
	return clamp((value - start) / (end - start));
}

/** Three-argument clamp (JIZURA `clamp(v, lo, hi)`). */
// eslint-disable-next-line opencut/prefer-object-params
function between(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function ioC(value: number): number {
	return inOutCubic(value);
}

function oC(value: number): number {
	return outCubic(value);
}

function iC(value: number): number {
	return clamp(value) ** 3;
}

function iQ(value: number): number {
	return clamp(value) ** 2;
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

/** Smoothstep between two bounds (JIZURA `J.smooth`). */
// eslint-disable-next-line opencut/prefer-object-params
function smoothBetween(start: number, end: number, value: number): number {
	return smooth((value - start) / (end - start));
}

function barWidth(options: X2Draw): number {
	return Math.max(3, options.size * 0.045);
}

function hot(options: X2Draw): string {
	return x2Hot(options);
}

function seedOf(options: X2Draw): number {
	return options.frame.cut?.seed ?? 0;
}

/** Same choice for every glyph of a cut (JIZURA `cutBit`). */
// eslint-disable-next-line opencut/prefer-object-params
function cutBit(options: X2Draw, salt: number): boolean {
	return (x2Hash(seedOf(options), salt, 991) & 1) === 1;
}

/** env.W stand-in for glyph-anim contracts (house approximation). */
function envWidth(options: X2Draw): number {
	return options.maxWidth / 0.86;
}

/** env.H stand-in for glyph-anim contracts (house approximation). */
function envHeight(options: X2Draw): number {
	return options.size * 4;
}

/**
 * The item box as along / cross extents: a = along the writing direction
 * (x), b = across it (y); rocut items are horizontal only (JIZURA `frame`).
 */
interface X2Frame {
	readonly a0: number;
	readonly a1: number;
	readonly ac: number;
	readonly b0: number;
	readonly b1: number;
	readonly bc: number;
	readonly len: number;
	readonly cr: number;
}

// eslint-disable-next-line opencut/prefer-object-params
function frameOf(options: X2Draw, pad: number): X2Frame {
	const box = x2Bounds(options, pad);
	return {
		a0: box.left,
		a1: box.right,
		ac: box.centerX,
		b0: box.top,
		b1: box.bottom,
		bc: box.centerY,
		len: box.width,
		cr: box.height,
	};
}

/** Append an along/cross rectangle to the current path (JIZURA `rAB`). */
// eslint-disable-next-line opencut/prefer-object-params
function pathRect(
	ctx: MotionTextCanvasContext,
	a0: number,
	b0: number,
	a1: number,
	b1: number,
): void {
	ctx.rect(a0, b0, a1 - a0, b1 - b0);
}

/** Append a polygon; test contexts without a polyline API get its bounding box. */
// eslint-disable-next-line opencut/prefer-object-params
function pathPoly(
	ctx: MotionTextCanvasContext,
	points: ReadonlyArray<readonly [number, number]>,
): void {
	if (points.length < 3) return;
	if (ctx.moveTo && ctx.lineTo) {
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		return;
	}
	const xs = points.map(([x]) => x);
	const ys = points.map(([, y]) => y);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	ctx.rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
}

/** Append a circle; test contexts without `arc` get its bounding square. */
// eslint-disable-next-line opencut/prefer-object-params
function pathCircle(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	radius: number,
	counterclockwise: boolean,
): void {
	if (ctx.arc && ctx.moveTo) {
		ctx.moveTo(x + radius, y);
		ctx.arc(x, y, radius, 0, TAU, counterclockwise);
		return;
	}
	ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
}

/** Draw the whole item inside a caller-built clip path (JIZURA `clipFn`). */
function drawItemClipped({
	options,
	build,
	alpha = 1,
	translateX = 0,
	translateY = 0,
	color,
	evenOdd = false,
}: {
	readonly options: X2Draw;
	readonly build: (ctx: MotionTextCanvasContext) => void;
	readonly alpha?: number;
	readonly translateX?: number;
	readonly translateY?: number;
	readonly color?: string;
	readonly evenOdd?: boolean;
}): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.beginPath();
	build(ctx);
	ctx.clip(evenOdd ? "evenodd" : undefined);
	ctx.translate(translateX, translateY);
	ctx.globalAlpha = baseAlpha * alpha;
	if (color) ctx.fillStyle = color;
	options.drawGlyph(options);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

/** Filled axis-aligned bar (JIZURA `eAB` with the item's own ink). */
function bar({
	options,
	color,
	x,
	y,
	width,
	height,
	alpha = 1,
}: {
	readonly options: X2Draw;
	readonly color: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly alpha?: number;
}): void {
	if (width < 0.2 || height < 0.2 || alpha <= 0.004) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(x, y, width, height);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

/** Filled polygon (JIZURA `env.poly`); the fill API is optional on test contexts. */
function fillPoly({
	options,
	color,
	points,
}: {
	readonly options: X2Draw;
	readonly color: string;
	readonly points: ReadonlyArray<readonly [number, number]>;
}): void {
	if (points.length < 3) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.beginPath();
	pathPoly(ctx, points);
	ctx.fillStyle = color;
	if (ctx.fill && ctx.moveTo && ctx.lineTo) {
		ctx.fill();
	} else {
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		ctx.fillRect(
			left,
			top,
			Math.max(...xs) - left,
			Math.max(...ys) - top,
		);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

/** Stroke a polyline as chained line segments (JIZURA `env.line`). */
function drawPolyline({
	options,
	points,
	color,
	width,
	alpha,
}: {
	readonly options: X2Draw;
	readonly points: ReadonlyArray<readonly [number, number]>;
	readonly color: string;
	readonly width: number;
	readonly alpha: number;
}): void {
	for (let index = 0; index + 1 < points.length; index += 1) {
		drawEnterBLine({
			alpha,
			color,
			from: points[index]!,
			options,
			to: points[index + 1]!,
			width,
		});
	}
}

export function drawX2ExitB(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "xiCropTurns":
		case "xiFinder":
		case "xiCounterWipe":
		case "xiTwoPass":
		case "xiCentreOut":
		case "xiDiagPinch":
		case "xiMothHoles":
		case "xiSawBite":
		case "xiRadialBlinds":
		case "xiPortholes":
		case "xiLattice":
		case "xiRings":
		case "xiSpiralTiles":
		case "xiEyelid":
		case "xiPicket":
		case "xiFields":
		case "xiDrawers":
		case "xiCounterScroll":
		case "xiPistons":
		case "xiSliceWave":
		case "xiPlateCarry":
		case "xiTwinPlates":
		case "xiRollShutter":
		case "xiRedact":
		case "xiInverseBand":
		case "xiFillDrop":
		case "xiDotted":
			drawX2ExitBPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2ExitBPart(options: EnterBDraw): void {
	if (options.frame.exitProgress >= 0.998) return;
	const preset = options.frame.cut?.preset.exit;
	switch (preset) {
		case "xiCropTurns":
			drawCropTurns(options);
			return;
		case "xiFinder":
			drawFinder(options);
			return;
		case "xiCounterWipe":
			drawCounterWipe(options);
			return;
		case "xiTwoPass":
			drawTwoPass(options);
			return;
		case "xiCentreOut":
			drawCentreOut(options);
			return;
		case "xiDiagPinch":
			drawDiagPinch(options);
			return;
		case "xiMothHoles":
			drawMothHoles(options);
			return;
		case "xiSawBite":
			drawSawBite(options);
			return;
		case "xiRadialBlinds":
			drawRadialBlinds(options);
			return;
		case "xiPortholes":
			drawPortholes(options);
			return;
		case "xiLattice":
			drawLattice(options);
			return;
		case "xiRings":
			drawRings(options);
			return;
		case "xiSpiralTiles":
			drawSpiralTiles(options);
			return;
		case "xiEyelid":
			drawEyelid(options);
			return;
		case "xiPicket":
			drawPicket(options);
			return;
		case "xiFields":
			drawFields(options);
			return;
		case "xiDrawers":
			drawDrawers(options);
			return;
		case "xiCounterScroll":
			drawCounterScroll(options);
			return;
		case "xiPistons":
			drawPistons(options);
			return;
		case "xiSliceWave":
			drawSliceWave(options);
			return;
		case "xiPlateCarry":
			drawPlateCarry(options);
			return;
		case "xiTwinPlates":
			drawTwinPlates(options);
			return;
		case "xiRollShutter":
			drawRollShutter(options);
			return;
		case "xiRedact":
			drawRedact(options);
			return;
		case "xiInverseBand":
			drawInverseBand(options);
			return;
		case "xiFillDrop":
			drawFillDrop(options);
			return;
		case "xiDotted":
			drawDotted(options);
			return;
		default:
			return;
	}
}

/** 四辺が詰まる — the crop closes one edge at a time — left, top, right, bottom, round after round, each move marked by a tick. */
function drawCropTurns(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const steps = 11;
	const stepper = progress * steps;
	const closes = [0, 0, 0, 0];
	for (let step = 0; step < steps; step += 1) {
		closes[step % 4] += ioC(seg(stepper - step, 0, 0.8));
	}
	const a0 = lerpN(frame.a0, frame.ac, closes[0]! / 3);
	const b0 = lerpN(frame.b0, frame.bc, closes[1]! / 3);
	const a1 = lerpN(frame.a1, frame.ac, closes[2]! / 3);
	const b1 = lerpN(frame.b1, frame.bc, closes[3]! / 3);
	if (a1 - a0 < 0.5 || b1 - b0 < 0.5) return;
	drawItemClipped({
		options,
		build: (ctx) => pathRect(ctx, a0, b0, a1, b1),
	});
	const stepIndex = Math.floor(stepper);
	const edge = stepIndex % 4;
	const fraction = stepper - stepIndex;
	if (fraction >= 0.86) return;
	const thickness = barWidth(options);
	const accent = hot(options);
	if (edge === 0) {
		bar({ options, color: accent, height: b1 - b0, width: thickness, x: a0 - thickness, y: b0 });
	} else if (edge === 1) {
		bar({ options, color: accent, height: thickness, width: a1 - a0, x: a0, y: b0 - thickness });
	} else if (edge === 2) {
		bar({ options, color: accent, height: b1 - b0, width: thickness, x: a1, y: b0 });
	} else {
		bar({ options, color: accent, height: thickness, width: a1 - a0, x: a0, y: b1 });
	}
}

/** 覗き窓が去る — the view narrows to a framed finder at the head of the line, pans along the text, runs off the end and shuts. */
function drawFinder(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const length = frame.len;
	const halfCross = frame.cr / 2;
	const windowLength = Math.min(
		Math.max(size * 0.95, length * 0.22),
		length * 0.55,
	);
	const open = ioC(seg(progress, 0, 0.3));
	const pan = ioC(seg(progress, 0.3, 0.78));
	const run = iC(seg(progress, 0.78, 1));
	let s0 = frame.a0 + (length - windowLength) * pan + windowLength * run;
	let s1 =
		lerpN(frame.a1, frame.a0 + windowLength, open) +
		(length - windowLength) * pan +
		windowLength * run;
	if (cutBit(options, 5)) {
		const mirror = frame.a0 + frame.a1 - s1;
		s1 = frame.a0 + frame.a1 - s0;
		s0 = mirror;
	}
	const height = halfCross * (1 - run);
	const b0 = frame.bc - height;
	const b1 = frame.bc + height;
	if (height < 0.4 || s1 - s0 < 0.4) return;
	drawItemClipped({
		options,
		build: (ctx) => pathRect(ctx, s0, b0, s1, b1),
	});
	const alpha = seg(progress, 0, 0.14) * (1 - seg(progress, 0.93, 1));
	if (alpha <= 0.01) return;
	const accent = hot(options);
	const lineWidth = Math.max(2, size * 0.028);
	const corner = Math.min(size * 0.24, (s1 - s0) * 0.3, height * 0.7);
	const gap = lineWidth * 0.5;
	for (const [ca, da] of [
		[s0 - gap, 1],
		[s1 + gap, -1],
	] as const) {
		for (const [cb, db] of [
			[b0 - gap, 1],
			[b1 + gap, -1],
		] as const) {
			drawPolyline({
				alpha,
				color: accent,
				options,
				points: [
					[ca + da * corner, cb],
					[ca, cb],
					[ca, cb + db * corner],
				],
				width: lineWidth,
			});
		}
	}
}

/** すれ違いワイプ — the upper half is wiped from the head, the lower half from the tail: two bars pass each other in the middle. */
function drawCounterWipe(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const thickness = barWidth(options);
	const e1 = ioC(seg(progress, 0, 0.84));
	const e2 = ioC(seg(progress, 0.16, 1));
	if (e1 >= 1 && e2 >= 1) return;
	const x1 = lerpN(frame.a0, frame.a1, e1);
	const x2 = lerpN(frame.a1, frame.a0, e2);
	drawItemClipped({
		options,
		build: (ctx) => {
			if (e1 < 1) pathRect(ctx, x1, frame.b0 - BIG, frame.a1 + BIG, frame.bc);
			if (e2 < 1) pathRect(ctx, frame.a0 - BIG, frame.bc, x2, frame.b1 + BIG);
		},
	});
	const accent = hot(options);
	const inner0 = frame.b0 + size * 0.16;
	const inner1 = frame.b1 - size * 0.16;
	if (e1 > 0 && e1 < 1) {
		bar({ options, color: accent, height: frame.bc - inner0, width: thickness, x: x1 - thickness, y: inner0 });
	}
	if (e2 > 0 && e2 < 1) {
		bar({ options, color: accent, height: inner1 - frame.bc, width: thickness, x: x2, y: frame.bc });
	}
}

/** 二度拭き — a bar crosses the text taking every other hairline stripe; it turns at the end and on the way back takes the rest. */
function drawTwoPass(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const stripes = Math.min(
		64,
		Math.max(4, Math.ceil(frame.cr / Math.max(3, size * 0.085))),
	);
	const pitch = frame.cr / stripes;
	const e1 = ioC(seg(progress, 0, 0.46));
	const e2 = ioC(seg(progress, 0.54, 1));
	const xa = lerpN(frame.a0, frame.a1, e1);
	const xb = lerpN(frame.a1, frame.a0, e2);
	const lim = Math.min(xa, xb);
	if (lim - frame.a0 < 0.4 && e1 >= 1) return;
	drawItemClipped({
		options,
		build: (ctx) => {
			if (e1 < 1) {
				pathRect(ctx, xa, frame.b0 - BIG, frame.a1 + BIG, frame.b1 + BIG);
			}
			if (lim > frame.a0) {
				for (let index = 0; index < stripes; index += 2) {
					pathRect(
						ctx,
						frame.a0,
						frame.b0 + index * pitch,
						lim,
						frame.b0 + (index + 1) * pitch,
					);
				}
			}
		},
	});
	const thickness = barWidth(options) * 1.3;
	const accent = hot(options);
	const position = progress < 0.5 ? xa : xb;
	const lift = oC(seg(progress, 0, 0.07)) * (1 - iC(seg(progress, 0.93, 1)));
	const half = (frame.cr / 2 - size * 0.12) * lift;
	bar({ options, color: accent, height: half * 2, width: thickness, x: position - thickness / 2, y: frame.bc - half });
}

/** 中央から拭う — a double bar appears in the middle of the line and parts: the text is wiped from its centre out to both ends. */
function drawCentreOut(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const thickness = barWidth(options);
	const parting = (frame.len / 2) * ioC(seg(progress, 0.08, 1));
	if (frame.len / 2 - parting < 0.4) return;
	drawItemClipped({
		options,
		build: (ctx) => {
			pathRect(ctx, frame.a0 - BIG, frame.b0 - BIG, frame.ac - parting, frame.b1 + BIG);
			pathRect(ctx, frame.ac + parting, frame.b0 - BIG, frame.a1 + BIG, frame.b1 + BIG);
		},
	});
	const accent = hot(options);
	const half =
		(frame.cr / 2 - size * 0.12) *
		oC(seg(progress, 0, 0.12)) *
		(1 - iC(seg(progress, 0.9, 1)));
	bar({ options, color: accent, height: half * 2, width: thickness, x: frame.ac - parting - thickness, y: frame.bc - half });
	bar({ options, color: accent, height: half * 2, width: thickness, x: frame.ac + parting, y: frame.bc - half });
}

/** 斜めに挟む — two parallel slanted edges come in from opposite corners and pinch the text into a thin diagonal sliver. */
function drawDiagPinch(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const box: EnterBBounds = x2Bounds(options, size * 0.25);
	const angle = degrees(cutBit(options, 11) ? 34 : -34);
	const d: readonly [number, number] = [Math.cos(angle), Math.sin(angle)];
	const t: readonly [number, number] = [-d[1], d[0]];
	const corners: ReadonlyArray<readonly [number, number]> = [
		[box.left, box.top],
		[box.right, box.top],
		[box.left, box.bottom],
		[box.right, box.bottom],
	];
	const projections = corners.map((corner) => corner[0] * d[0] + corner[1] * d[1]);
	const crossProjections = corners.map((corner) => corner[0] * t[0] + corner[1] * t[1]);
	const u0 = Math.min(...projections);
	const u1 = Math.max(...projections);
	const w0 = Math.min(...crossProjections);
	const w1 = Math.max(...crossProjections);
	const uc = (u0 + u1) / 2;
	const s0 = lerpN(u0, uc, ioC(seg(progress, 0, 0.86)));
	const s1 = lerpN(u1, uc, ioC(seg(progress, 0.14, 1)));
	if (s1 - s0 < 0.5) return;
	// eslint-disable-next-line opencut/prefer-object-params
	const point = (u: number, w: number): readonly [number, number] => [
		d[0] * u + t[0] * w,
		d[1] * u + t[1] * w,
	];
	drawItemClipped({
		options,
		build: (ctx) =>
			pathPoly(ctx, [
				point(s0, w0 - BIG),
				point(s0, w1 + BIG),
				point(s1, w1 + BIG),
				point(s1, w0 - BIG),
			]),
	});
	const alpha = seg(progress, 0, 0.1) * (1 - seg(progress, 0.92, 1));
	if (alpha <= 0.01) return;
	const accent = hot(options);
	const lineWidth = Math.max(2, size * 0.03);
	const ex = size * 0.12;
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	ctx.rect(box.left - ex, box.top - ex, box.width + ex * 2, box.height + ex * 2);
	ctx.clip();
	drawEnterBLine({ alpha, color: accent, from: point(s0 - lineWidth / 2, w0 - ex), options, to: point(s0 - lineWidth / 2, w1 + ex), width: lineWidth });
	drawEnterBLine({ alpha, color: accent, from: point(s1 + lineWidth / 2, w0 - ex), options, to: point(s1 + lineWidth / 2, w1 + ex), width: lineWidth });
	ctx.restore();
}

/** 虫食い穴 — round holes open here and there, small at first, then spread into each other until nothing is left. */
function drawMothHoles(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.15);
	const count = between(Math.round(frame.len / (size * 0.6)) + 3, 5, 12);
	// every point of the box is within this reach of a hole centre
	const reach = Math.hypot((frame.len / count) * 0.96, frame.cr * 0.86) + 2;
	const holes: number[] = [];
	for (let index = 0; index < count; index += 1) {
		const a =
			frame.a0 +
			frame.len *
				clamp01(
					(index + 0.5 + x2Signed(seedOf(options), index, 71) * 0.45) / count,
				);
		const b = frame.b0 + frame.cr * (0.15 + 0.7 * x2Unit(seedOf(options), index, 72));
		const phase = seg(
			progress,
			index === 0 ? 0 : x2Unit(seedOf(options), index, 73) * 0.4,
			1,
		);
		if (phase <= 0) continue;
		const startRadius = size * (0.16 + 0.2 * x2Unit(seedOf(options), index, 74));
		const radius =
			startRadius * oC(seg(phase, 0, 0.35)) +
			(reach - startRadius) * iQ(seg(phase, 0.3, 1));
		holes.push(a, b, radius);
	}
	if (!holes.length) {
		options.drawGlyph(options);
		return;
	}
	const { ctx } = options;
	ctx.save();
	// one even-odd clip per hole, so overlapping holes stay holes
	for (let index = 0; index < holes.length; index += 3) {
		const x = holes[index]!;
		const y = holes[index + 1]!;
		const radius = holes[index + 2]!;
		ctx.beginPath();
		pathRect(ctx, -BIG, -BIG, BIG * 2, BIG * 2);
		pathCircle(ctx, x, y, radius, false);
		ctx.clip("evenodd");
	}
	options.drawGlyph(options);
	ctx.restore();
}

/** 噛みちぎる — two rows of interlocking saw teeth close on the text: a first bite, a breath, then the jaws lock and the seam pulls shut. */
function drawSawBite(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.25);
	const amplitude = Math.min(size * 0.36, frame.cr * 0.4);
	const pitch = Math.max(size * 0.62, frame.len / 30);
	const half = pitch / 2;
	const gap0 = frame.cr + amplitude;
	let gf: number;
	if (progress < 0.3) gf = lerpN(1, 0.2, ioC(progress / 0.3));
	else if (progress < 0.46) gf = lerpN(0.2, 0.42, oC(seg(progress, 0.3, 0.46)));
	else gf = 0.42 * (1 - iC(seg(progress, 0.46, 0.8)));
	const gap = gap0 * gf;
	const topJaw = frame.bc - amplitude / 2 - gap / 2;
	const bottomJaw = topJaw + amplitude + gap;
	const teeth = Math.ceil((frame.len + size) / half) + 1;
	const start = frame.a0 - size * 0.5;
	const top: [number, number][] = [];
	const bottom: [number, number][] = [];
	for (let index = 0; index <= teeth; index += 1) {
		const a = start + index * half;
		top.push([a, topJaw + (index % 2 ? amplitude : 0)]);
		bottom.push([a, bottomJaw - (index % 2 ? 0 : amplitude)]);
	}
	if (gap < 0.4) return;
	drawItemClipped({
		options,
		build: (ctx) => pathPoly(ctx, [...top, ...bottom.slice(0, teeth).reverse()]),
	});
	const accent = hot(options);
	const lineWidth = Math.max(2, size * 0.03);
	const alpha = seg(progress, 0, 0.1);
	const shut = iC(seg(progress, 0.8, 1));
	const k0 = Math.floor((teeth / 2) * shut);
	const k1 = teeth - k0;
	if (alpha > 0.01 && k1 - k0 >= 1) {
		drawPolyline({ alpha, color: accent, options, points: top.slice(k0, k1 + 1), width: lineWidth });
		drawPolyline({ alpha, color: accent, options, points: bottom.slice(k0, k1 + 1), width: lineWidth });
	}
}

/** 放射ブラインド — the text is seen through a turning fan of wedges; the wedges narrow one after another until the fan is shut. */
function drawRadialBlinds(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const box = x2Bounds(options, size * 0.25);
	const count = 12;
	const radius = Math.hypot(box.width, box.height) / 2 + size * 0.2;
	const turn = (cutBit(options, 21) ? 1 : -1) * degrees(42) * ioC(progress);
	const wedges: number[] = [];
	for (let index = 0; index < count; index += 1) {
		const h =
			(PI / count) *
			(1 -
				ioC(
					x2Stagger(progress, (index % 2) * 0.62 + (index % 3) * 0.12, 0.5),
				));
		if (h > 0.002) {
			wedges.push(
				(index * TAU) / count + turn,
				h + (h > (PI / count) * 0.995 ? 0.004 : 0),
			);
		}
	}
	if (!wedges.length) return;
	drawItemClipped({
		options,
		build: (ctx) => {
			if (!(ctx.arc && ctx.moveTo)) {
				// no wedge API on test contexts: keep the whole box until shut
				pathRect(ctx, box.left, box.top, box.right, box.bottom);
				return;
			}
			for (let index = 0; index < wedges.length; index += 2) {
				ctx.moveTo(box.centerX, box.centerY);
				ctx.arc(
					box.centerX,
					box.centerY,
					radius,
					wedges[index]! - wedges[index + 1]!,
					wedges[index]! + wedges[index + 1]!,
				);
				ctx.closePath?.();
			}
		},
	});
}

/** 丸窓 — the text shrinks back into a row of portholes, each ringed for a moment; they then close from the ends towards the middle. */
function drawPortholes(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.2);
	const count = between(Math.round(frame.len / (frame.cr * 0.95)), 1, 16);
	const cell = frame.len / count;
	const startRadius = Math.hypot(cell / 2, frame.cr / 2) * 1.03;
	const endRadius = Math.min(frame.cr * 0.4, cell * 0.46);
	const accent = hot(options);
	const lineWidth = Math.max(2, size * 0.03);
	const windows: number[] = [];
	const middle = (count - 1) / 2;
	for (let index = 0; index < count; index += 1) {
		const edgeOrder = count > 1 ? 1 - Math.abs(index - middle) / middle : 0;
		const phase = x2Stagger(progress, edgeOrder, 0.3);
		const radius =
			lerpN(startRadius, endRadius, ioC(seg(phase, 0, 0.42))) *
			(1 - iC(seg(phase, 0.58, 1)));
		if (radius < 0.3) continue;
		windows.push(
			frame.a0 + (index + 0.5) * cell,
			frame.bc,
			radius,
			seg(phase, 0.2, 0.42) * (1 - seg(phase, 0.9, 1)),
		);
	}
	if (!windows.length) return;
	drawItemClipped({
		options,
		build: (ctx) => {
			for (let index = 0; index < windows.length; index += 4) {
				pathCircle(ctx, windows[index]!, windows[index + 1]!, windows[index + 2]!, false);
			}
		},
	});
	for (let index = 0; index < windows.length; index += 4) {
		const ringAlpha = windows[index + 3]!;
		if (ringAlpha > 0.01) {
			drawEnterBRing({
				alpha: ringAlpha,
				color: accent,
				options,
				radius: windows[index + 2]! + lineWidth / 2,
				width: lineWidth,
				x: windows[index]!,
				y: windows[index + 1]!,
			});
		}
	}
}

/** 網目に痩せる — the text thins to a diagonal lattice: two sets of crossing slanted lines remain, growing finer until gone. */
function drawLattice(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.2);
	const box = x2Bounds(options, size * 0.2);
	const f1 =
		lerpN(1, 0.17, ioC(seg(progress, 0, 0.4))) *
		(1 - iQ(seg(progress, 0.42, 0.9)));
	const f2 =
		lerpN(1, 0.17, ioC(seg(progress, 0.06, 0.46))) *
		(1 - iQ(seg(progress, 0.5, 1)));
	if (f1 < 0.004 && f2 < 0.004) return;
	let pitch = Math.max(Math.min(frame.cr * 0.75, size * 1.1), size * 0.55);
	const span = box.width + box.height;
	if (span / pitch > 22) pitch = span / 22;
	const corners: ReadonlyArray<readonly [number, number]> = [
		[box.left, box.top],
		[box.right, box.top],
		[box.left, box.bottom],
		[box.right, box.bottom],
	];
	const bandPolys: (readonly [number, number])[][] = [];
	for (const [slant, f] of [
		[52, f1],
		[-52, f2],
	] as const) {
		if (f < 0.004) continue;
		const d: readonly [number, number] = [
			Math.cos(degrees(slant)),
			Math.sin(degrees(slant)),
		];
		const nr: readonly [number, number] = [-d[1], d[0]];
		const offsets = corners.map(
			(corner) =>
				(corner[0] - box.centerX) * nr[0] + (corner[1] - box.centerY) * nr[1],
		);
		const low = Math.min(...offsets);
		const high = Math.max(...offsets);
		const halfWidth = (pitch / 2) * f + (f > 0.995 ? 0.4 : 0);
		for (
			let k = Math.floor(low / pitch);
			k <= Math.ceil(high / pitch);
			k += 1
		) {
			const offset = k * pitch;
			// eslint-disable-next-line opencut/prefer-object-params
			const point = (
				along: number,
				cross: number,
			): readonly [number, number] => [
				box.centerX + d[0] * along + nr[0] * cross,
				box.centerY + d[1] * along + nr[1] * cross,
			];
			bandPolys.push([
				point(-BIG, offset - halfWidth),
				point(BIG, offset - halfWidth),
				point(BIG, offset + halfWidth),
				point(-BIG, offset + halfWidth),
			]);
		}
	}
	drawItemClipped({
		options,
		build: (ctx) => {
			for (const poly of bandPolys) pathPoly(ctx, poly);
		},
	});
}

/** 波紋抜き — the text is cut into concentric rings around its centre; ring after ring thins to a hairline and goes out. */
function drawRings(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const box = x2Bounds(options, size * 0.2);
	const maxRadius = Math.hypot(box.width, box.height) / 2;
	const pitch = Math.max(size * 0.3, maxRadius / 14);
	const count = Math.max(2, Math.ceil(maxRadius / pitch));
	const inward = cutBit(options, 31);
	const rings: number[] = [];
	for (let index = 0; index < count; index += 1) {
		const order = inward ? 1 - index / (count - 1) : index / (count - 1);
		const keep = 1 - ioC(x2Stagger(progress, order, 0.55));
		if (keep < 0.01) continue;
		const middle = (index + 0.5) * pitch;
		const halfWidth = (pitch / 2) * keep + (keep > 0.995 ? 0.4 : 0);
		rings.push(Math.max(0, middle - halfWidth), middle + halfWidth);
	}
	if (!rings.length) return;
	const hasArc = Boolean(options.ctx.arc && options.ctx.moveTo);
	drawItemClipped({
		options,
		build: (ctx) => {
			if (ctx.arc && ctx.moveTo) {
				for (let index = 0; index < rings.length; index += 2) {
					ctx.moveTo(box.centerX + rings[index + 1]!, box.centerY);
					ctx.arc(box.centerX, box.centerY, rings[index + 1]!, 0, TAU, false);
					if (rings[index]! > 0.3) {
						ctx.moveTo(box.centerX + rings[index]!, box.centerY);
						ctx.arc(box.centerX, box.centerY, rings[index]!, 0, TAU, true);
					}
				}
				return;
			}
			// no arcs on test contexts: square ring stand-ins need even-odd
			for (let index = 0; index < rings.length; index += 2) {
				pathRect(
					ctx,
					box.centerX - rings[index + 1]!,
					box.centerY - rings[index + 1]!,
					box.centerX + rings[index + 1]!,
					box.centerY + rings[index + 1]!,
				);
				if (rings[index]! > 0.3) {
					pathRect(
						ctx,
						box.centerX - rings[index]!,
						box.centerY - rings[index]!,
						box.centerX + rings[index]!,
						box.centerY + rings[index]!,
					);
				}
			}
		},
		evenOdd: !hasArc,
	});
}

const SPIRAL_CACHE = new Map<string, number[]>();

/** Inward spiral walk order over an nx×ny grid (JIZURA `spiralOrder`). */
// eslint-disable-next-line opencut/prefer-object-params
function spiralOrder(nx: number, ny: number): readonly number[] {
	const key = `${nx}x${ny}`;
	const cached = SPIRAL_CACHE.get(key);
	if (cached) return cached;
	const order: number[] = new Array(nx * ny);
	let x0 = 0;
	let y0 = 0;
	let x1 = nx - 1;
	let y1 = ny - 1;
	let k = 0;
	while (x0 <= x1 && y0 <= y1) {
		for (let x = x0; x <= x1; x += 1) order[y0 * nx + x] = k++;
		for (let y = y0 + 1; y <= y1; y += 1) order[y * nx + x1] = k++;
		if (y1 > y0) for (let x = x1 - 1; x >= x0; x -= 1) order[y1 * nx + x] = k++;
		if (x1 > x0) for (let y = y1 - 1; y > y0; y -= 1) order[y * nx + x0] = k++;
		x0 += 1;
		y0 += 1;
		x1 -= 1;
		y1 -= 1;
	}
	if (SPIRAL_CACHE.size > 200) SPIRAL_CACHE.clear();
	SPIRAL_CACHE.set(key, order);
	return order;
}

/** 渦巻きタイル — the text is seen through a grid of small windows that shut one by one along a spiral, from the rim inwards. */
function drawSpiralTiles(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.15);
	const rows = between(Math.round(frame.cr / (size * 0.5)), 2, 6);
	const cell = frame.cr / rows;
	let columns = Math.max(1, Math.ceil(frame.len / cell - 0.01));
	if (columns * rows > 132) columns = Math.floor(132 / rows);
	const tileWidth = frame.len / columns;
	const total = columns * rows;
	const order = spiralOrder(columns, rows);
	const tiles: number[] = [];
	for (let y = 0; y < rows; y += 1) {
		for (let x = 0; x < columns; x += 1) {
			const keep =
				1 -
				ioC(x2Stagger(progress, total > 1 ? order[y * columns + x]! / (total - 1) : 0, 0.62));
			if (keep < 0.015) continue;
			const a = frame.a0 + x * tileWidth;
			const b = frame.b0 + y * cell;
			const ease = keep > 0.995 ? 0.4 : 0;
			if ((x + y) & 1) {
				tiles.push(
					a + (tileWidth * (1 - keep)) / 2,
					b,
					a + (tileWidth * (1 + keep)) / 2 + ease,
					b + cell + ease,
				);
			} else {
				tiles.push(
					a,
					b + (cell * (1 - keep)) / 2,
					a + tileWidth + ease,
					b + (cell * (1 + keep)) / 2 + ease,
				);
			}
		}
	}
	if (!tiles.length) return;
	drawItemClipped({
		options,
		build: (ctx) => {
			for (let index = 0; index < tiles.length; index += 4) {
				pathRect(
					ctx,
					tiles[index]!,
					tiles[index + 1]!,
					tiles[index + 2]!,
					tiles[index + 3]!,
				);
			}
		},
	});
}

/** まぶたを閉じる — two curved lids close over the text like an eye: they droop, lift once more, then shut; the lash line draws in to nothing. */
function drawEyelid(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.25);
	const reach = frame.len * 0.5 + size * 0.9;
	const halfSpan = frame.len / 2;
	const halfCross = frame.cr / 2;
	// eslint-disable-next-line opencut/prefer-object-params
	const lidY = (x: number, h: number): number => {
		const radius = (reach * reach + h * h) / (2 * h);
		return Math.sqrt(Math.max(0, radius * radius - x * x)) - (radius - h);
	};
	let startHeight = frame.cr * 0.9 + size * 0.3;
	for (let k = 0; k < 8 && lidY(halfSpan, startHeight) < halfCross; k += 1) {
		startHeight *= 1.3;
	}
	const droop = halfCross * 0.5;
	const lifted = halfCross * 0.92;
	let height: number;
	if (progress < 0.3) height = lerpN(startHeight, droop, ioC(progress / 0.3));
	else if (progress < 0.46) height = lerpN(droop, lifted, ioC(seg(progress, 0.3, 0.46)));
	else height = lifted * (1 - ioC(seg(progress, 0.46, 0.8)));
	const samples = 22;
	const shut = ioC(seg(progress, 0.8, 1));
	const accent = hot(options);
	const lineWidth = Math.max(2, size * 0.028);
	const edgeAlpha = seg(progress, 0.02, 0.14);
	if (height < 0.6) {
		const span = reach * (1 - shut);
		if (span > 1) {
			drawEnterBLine({
				alpha: edgeAlpha,
				color: accent,
				from: [frame.ac - span, frame.bc],
				options,
				to: [frame.ac + span, frame.bc],
				width: lineWidth,
			});
		}
		return;
	}
	const upper: [number, number][] = [];
	const lower: [number, number][] = [];
	for (let index = 0; index <= samples; index += 1) {
		const x = reach * ((index / samples) * 2 - 1);
		const y = lidY(x, height);
		upper.push([frame.ac + x, frame.bc - y]);
		lower.push([frame.ac + x, frame.bc + y]);
	}
	drawItemClipped({
		options,
		build: (ctx) => pathPoly(ctx, [...upper, ...lower.slice(0, samples).reverse()]),
	});
	if (edgeAlpha > 0.01) {
		drawPolyline({ alpha: edgeAlpha, color: accent, options, points: upper, width: lineWidth });
		drawPolyline({ alpha: edgeAlpha, color: accent, options, points: lower, width: lineWidth });
	}
}

/** 格子が通る — a picket of slits slides across the text while its slats widen: the text flickers through ever narrower gaps and is shut out. */
function drawPicket(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const pitch = Math.max(size * 0.3, frame.len / 48);
	const open =
		pitch *
		lerpN(1, 0.42, ioC(seg(progress, 0, 0.34))) *
		(1 - iQ(seg(progress, 0.36, 0.96)));
	if (open < 0.3) return;
	const slide = (cutBit(options, 41) ? 1 : -1) * pitch * 3.2 * inOutSine(progress);
	const ease = open > pitch * 0.995 ? 0.5 : 0;
	const start = frame.a0 - pitch * 5 + slide;
	drawItemClipped({
		options,
		build: (ctx) => {
			for (let a = start; a < frame.a1 + pitch; a += pitch) {
				pathRect(
					ctx,
					a + (pitch - open) / 2,
					frame.b0 - BIG,
					a + (pitch + open) / 2 + ease,
					frame.b1 + BIG,
				);
			}
		},
	});
}

/** インターレース — the text splits into its two scan-line fields: one slips out of register, then the other, and the fields run off opposite ways. */
function drawFields(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	let pitch = Math.max(2.5, size * 0.055);
	if (frame.cr / pitch > 90) pitch = frame.cr / 90;
	const lines = Math.ceil(frame.cr / pitch);
	const away = envWidth(options) + frame.len;
	const shiftB = size * 0.11 * oC(seg(progress, 0, 0.14)) + away * iC(seg(progress, 0.34, 0.9));
	const shiftA =
		-size * 0.11 * oC(seg(progress, 0.2, 0.34)) - away * iC(seg(progress, 0.42, 0.98));
	const rows =
		(parity: number) =>
		(ctx: MotionTextCanvasContext): void => {
			for (let index = parity; index < lines; index += 2) {
				pathRect(
					ctx,
					-BIG,
					frame.b0 + index * pitch,
					BIG * 2,
					frame.b0 + (index + 1) * pitch,
				);
			}
			if (!parity) {
				pathRect(ctx, -BIG, frame.b0 - BIG, BIG * 2, frame.b0);
				pathRect(ctx, -BIG, frame.b0 + lines * pitch, BIG * 2, frame.b1 + BIG);
			}
		};
	drawItemClipped({ options, build: rows(0), translateX: shiftA });
	drawItemClipped({ options, build: rows(1), translateX: shiftB });
}

/** 引き出し — the text is a chest of drawers: slice after slice is tugged out a notch, waits, and is then pulled right out, alternately to either side. */
function drawDrawers(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.2);
	const count = between(Math.round(frame.cr / (size * 0.28)), 4, 9);
	const height = frame.cr / count;
	const away = envWidth(options) + frame.len;
	const pull = 0.44;
	const pace = (1 - pull) / (count - 1);
	const flip = cutBit(options, 45) ? 1 : -1;
	for (let index = 0; index < count; index += 1) {
		const phase = seg(progress, index * pace, index * pace + pull);
		const shift =
			(index % 2 ? 1 : -1) *
			flip *
			(size * 0.24 * oC(seg(phase, 0, 0.24)) + away * iC(seg(phase, 0.44, 1)));
		drawItemClipped({
			options,
			build: (ctx) =>
				pathRect(
					ctx,
					frame.a0 - BIG,
					frame.b0 + index * height,
					frame.a1 + BIG,
					frame.b0 + (index + 1) * height + (index < count - 1 ? 0.6 : 0),
				),
			translateX: shift,
		});
	}
}

/** 行違い送り — the text scrolls out of its own fixed window in strips, neighbouring strips in opposite directions, between two end rails. */
function drawCounterScroll(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.25);
	const count = between(Math.round(frame.cr / (size * 0.55)), 2, 8);
	const height = frame.cr / count;
	const distance = frame.len + 2;
	const flip = cutBit(options, 51) ? 1 : -1;
	for (let index = 0; index < count; index += 1) {
		const shift =
			(index % 2 ? 1 : -1) *
			flip *
			distance *
			ioC(x2Stagger(seg(progress, 0.06, 0.96), count > 1 ? index / (count - 1) : 0, 0.3));
		// the fixed window along the line is baked into each strip's clip
		drawItemClipped({
			options,
			build: (ctx) =>
				pathRect(
					ctx,
					frame.a0,
					frame.b0 + index * height,
					frame.a1,
					frame.b0 + (index + 1) * height + (index < count - 1 ? 0.6 : 0),
				),
			translateX: shift,
		});
	}
	const thickness = barWidth(options);
	const accent = hot(options);
	const railHalf =
		(frame.cr / 2 - size * 0.1) *
		oC(seg(progress, 0, 0.12)) *
		(1 - iC(seg(progress, 0.86, 1)));
	bar({ options, color: accent, height: railHalf * 2, width: thickness, x: frame.a0 - thickness, y: frame.bc - railHalf });
	bar({ options, color: accent, height: railHalf * 2, width: thickness, x: frame.a1, y: frame.bc - railHalf });
}

/** ピストン抜け — between two rails the text is cut into upright slices that dip, then plunge out behind the rails, alternately up and down. */
function drawPistons(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.25);
	const count = between(Math.round(frame.len / (size * 0.5)), 3, 14);
	const width = frame.len / count;
	const distance = frame.cr + 2;
	for (let index = 0; index < count; index += 1) {
		const phase = x2Stagger(
			seg(progress, 0.05, 0.95),
			count > 1 ? index / (count - 1) : 0,
			0.52,
		);
		const direction = index % 2 ? 1 : -1;
		const shift =
			direction *
			(-size * 0.09 * Math.sin(PI * seg(phase, 0, 0.32)) +
				distance * iC(seg(phase, 0.26, 1)));
		// the rails' window across the line is baked into each slice's clip
		drawItemClipped({
			options,
			build: (ctx) =>
				pathRect(
					ctx,
					frame.a0 + index * width,
					frame.b0,
					frame.a0 + (index + 1) * width + (index < count - 1 ? 0.6 : 0),
					frame.b1,
				),
			translateY: shift,
		});
	}
	const thickness = barWidth(options) * 0.7;
	const accent = hot(options);
	const railHalf =
		(frame.len / 2) * oC(seg(progress, 0, 0.12)) * (1 - iC(seg(progress, 0.88, 1)));
	bar({ options, color: accent, height: thickness, width: railHalf * 2, x: frame.ac - railHalf, y: frame.b0 - thickness });
	bar({ options, color: accent, height: thickness, width: railHalf * 2, x: frame.ac - railHalf, y: frame.b1 });
}

/** スライスの波 — a ripple runs through the upright slices, each hopping as it passes; on the second pass every slice it reaches shoots away. */
function drawSliceWave(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const count = between(Math.round(frame.len / (size * 0.4)), 4, 12);
	const width = frame.len / count;
	const away = frame.b1 + size * 0.6 + envHeight(options) * 0.08;
	const wave = lerpN(-0.2, 1.2, seg(progress, 0, 0.42));
	const reverse = cutBit(options, 55);
	for (let index = 0; index < count; index += 1) {
		const order = ((reverse ? count - 1 - index : index) + 0.5) / count;
		const hop = Math.max(0, 1 - ((order - wave) / 0.2) ** 2);
		const shift =
			-size * 0.2 * hop - away * iQ(x2Stagger(seg(progress, 0.3, 0.98), order, 0.5));
		drawItemClipped({
			options,
			build: (ctx) =>
				pathRect(
					ctx,
					frame.a0 + index * width,
					frame.b0 - BIG,
					frame.a0 + (index + 1) * width + (index < count - 1 ? 0.6 : 0),
					frame.b1 + BIG,
				),
			translateY: shift,
		});
	}
}

/** 板で持ち去る — a plate is laid over the text from above; after a beat the plate tips, backs up and slides off sideways, and the place is empty. */
function drawPlateCarry(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.16);
	const color = hot(options);
	const cover = ioC(seg(progress, 0, 0.34));
	const front = lerpN(frame.b0, frame.b1, cover);
	const slide = seg(progress, 0.46, 1);
	const direction = cutBit(options, 61) ? 1 : -1;
	const away = envWidth(options) + frame.len;
	const shift = direction * away * slide * slide * (2.4 * slide - 1.4) * 0.999;
	const tilt = degrees(direction * 9) * iQ(slide);
	if (cover >= 1) return;
	drawItemClipped({
		options,
		build: (ctx) => pathRect(ctx, frame.a0 - BIG, front, frame.a1 + BIG, frame.b1 + BIG),
	});
	const halfLength = frame.len / 2;
	const halfCover = (front - frame.b0) / 2;
	if (halfCover <= 0.2) return;
	const plateCenterY = frame.b0 + halfCover;
	const cos = Math.cos(tilt);
	const sin = Math.sin(tilt);
	const points = (
		[
			[-halfLength, -halfCover],
			[halfLength, -halfCover],
			[halfLength, halfCover],
			[-halfLength, halfCover],
		] as const
	).map(
		([x, y]) =>
			[
				frame.ac + shift + x * cos - y * sin,
				plateCenterY + x * sin + y * cos,
			] as const,
	);
	fillPoly({ options, color, points });
}

/** 二枚板で閉じる — two plates slide in from the ends and meet over the text; each then folds away to its own edge, and the edge lines draw back. */
function drawTwinPlates(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.16);
	const color = hot(options);
	const thickness = barWidth(options);
	const meet = oC(seg(progress, 0, 0.36));
	const leftEdge = lerpN(frame.a0, frame.ac, meet);
	const rightEdge = lerpN(frame.a1, frame.ac, meet);
	if (meet >= 1) return;
	drawItemClipped({
		options,
		build: (ctx) => pathRect(ctx, leftEdge, frame.b0 - BIG, rightEdge, frame.b1 + BIG),
	});
	const fold = ioC(seg(progress, 0.46, 0.76));
	const retract = iC(seg(progress, 0.76, 1));
	const leftWidth = lerpN(leftEdge, frame.a0, retract) - frame.a0;
	bar({ options, color, height: lerpN(frame.b1, frame.b0 + thickness, fold) - frame.b0, width: leftWidth, x: frame.a0, y: frame.b0 });
	bar({
		options,
		color,
		height: frame.b1 - lerpN(frame.b0, frame.b1 - thickness, fold),
		width: frame.a1 - lerpN(rightEdge, frame.a1, retract),
		x: lerpN(rightEdge, frame.a1, retract),
		y: lerpN(frame.b0, frame.b1 - thickness, fold),
	});
}

/** シャッター — a slatted shutter rolls down over the text; when it is down, the slats thin out one after another and behind them there is nothing. */
function drawRollShutter(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.16);
	const color = hot(options);
	const count = between(Math.ceil(frame.cr / (size * 0.17)), 3, 40);
	const pitch = frame.cr / count;
	const slat = pitch * 0.84;
	const cover = oC(seg(progress, 0, 0.4));
	const front = frame.b0 + frame.cr * cover;
	const fade = seg(progress, 0.5, 1);
	if (cover >= 1) return;
	drawItemClipped({
		options,
		build: (ctx) => pathRect(ctx, frame.a0 - BIG, front, frame.a1 + BIG, frame.b1 + BIG),
	});
	for (let index = 0; index < count; index += 1) {
		const top = frame.b0 + index * pitch;
		if (top >= front) break;
		const height = slat * (1 - ioC(x2Stagger(fade, count > 1 ? index / (count - 1) : 0, 0.5)));
		const center = top + slat / 2;
		const y0 = center - height / 2;
		bar({ options, color, height: Math.min(front, center + height / 2) - y0, width: frame.a1 - frame.a0, x: frame.a0, y: y0 });
	}
}

/** 黒塗り — the text is redacted: solid bars in its own colour slam down piece by piece, then each bar flattens to a rule and is drawn back. */
function drawRedact(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const seed = seedOf(options);
	const glyphs = enterBGlyphs(options);
	const count = glyphs.length;
	if (count === 0) return;
	const parts = count <= 3 ? 1 : count <= 8 ? 2 : 3;
	const cuts = [0];
	for (let part = 1; part < parts; part += 1) {
		cuts.push(
			between(
				Math.round(
					(count * part) / parts + x2Signed(seed, 0, part, 81) * count * 0.12,
				),
				cuts[cuts.length - 1]! + 1,
				count - 1,
			),
		);
	}
	cuts.push(count);
	interface Segment {
		readonly a0: number;
		readonly a1: number;
		readonly b0: number;
		readonly b1: number;
		readonly on: number;
		readonly kb: number;
		readonly ka: number;
	}
	const segments: Segment[] = [];
	const segmentOf = new Map<number, Segment>();
	for (let part = 0; part < cuts.length - 1; part += 1) {
		if (cuts[part + 1]! <= cuts[part]!) continue;
		const roll = x2Unit(seed, 0, part, 82);
		let a0 = Number.POSITIVE_INFINITY;
		let a1 = Number.NEGATIVE_INFINITY;
		let b0 = Number.POSITIVE_INFINITY;
		let b1 = Number.NEGATIVE_INFINITY;
		for (const glyph of glyphs.slice(cuts[part], cuts[part + 1])) {
			a0 = Math.min(a0, glyph.x - glyph.width / 2);
			a1 = Math.max(a1, glyph.x + glyph.width / 2);
			b0 = Math.min(b0, glyph.y - size / 2);
			b1 = Math.max(b1, glyph.y + size / 2);
		}
		const on = seg(progress, roll * 0.3, roll * 0.3 + 0.1);
		const flatten = seg(progress, 0.56 + roll * 0.2, 0.8 + roll * 0.2);
		const segment: Segment = {
			a0,
			a1,
			b0,
			b1,
			on,
			kb: outExpo(on) * lerpN(1, 0.07, ioC(seg(flatten, 0, 0.5))),
			ka: 1 - iC(seg(flatten, 0.4, 1)),
		};
		segments.push(segment);
		for (const glyph of glyphs.slice(cuts[part], cuts[part + 1])) {
			segmentOf.set(glyph.index, segment);
		}
	}
	if (!segments.length) return;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const segment = segmentOf.get(glyph.index);
			return segment && segment.on >= 0.55 ? null : undefined;
		},
	});
	const color = options.frame.palette.foreground;
	const padAlong = size * 0.07;
	const padCross = size * 0.03;
	for (const segment of segments) {
		if (segment.kb <= 0.002 || segment.ka <= 0.002) continue;
		const center = (segment.b0 + segment.b1) / 2;
		const halfHeight = ((segment.b1 - segment.b0) / 2 + padCross) * segment.kb;
		const left = segment.a0 - padAlong;
		const right = left + (segment.a1 - segment.a0 + padAlong * 2) * segment.ka;
		bar({
			options,
			color,
			height: halfHeight * 2,
			width: right - left,
			x: left,
			y: center - halfHeight,
		});
	}
}

/** 反転帯 — a band in the text's colour opens behind the line so it flips to the background colour; the band then closes in and takes the text with it. */
function drawInverseBand(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.14);
	const color = options.frame.palette.foreground;
	const inverted = options.frame.palette.background;
	const open = outExpo(seg(progress, 0, 0.26));
	const close = ioC(seg(progress, 0.38, 1));
	const a0 = lerpN(frame.a0, frame.ac, close);
	const a1 = lerpN(frame.a1, frame.ac, close);
	const halfBand = (frame.cr / 2) * open;
	const b0 = frame.bc - halfBand;
	const b1 = frame.bc + halfBand;
	const covered = seg(progress, 0, 0.26) < 1;
	if (covered && a1 - a0 >= 0.4 && halfBand >= 0.2) {
		options.drawGlyph(options);
		bar({ options, color, height: b1 - b0, width: a1 - a0, x: a0, y: b0 });
		drawItemClipped({
			options,
			build: (ctx) => pathRect(ctx, a0, b0, a1, b1),
			color: inverted,
		});
	} else if (covered) {
		options.drawGlyph(options);
	}
}

/** 塗りが落ちる — the solid fill lets go of its outline and drops out through a slot under the line; the empty outline is then un-drawn. */
function drawFillDrop(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const fade = 1 - smoothBetween(0.92, 1, progress);
	const undraw = seg(progress, 0.38, 0.97);
	const box = x2Bounds(options, size * 0.12);
	const fall = seg(progress, 0, 0.56);
	const drop =
		(box.height + size * 0.3) *
		(iQ(fall) * 1.02 - 0.02 * Math.sin(PI * seg(fall, 0, 0.3)));
	// the main item becomes its own outline; the dash un-draw is approximated by fading
	const lineWidth = size * 0.022 * Math.min(1, progress * 10);
	const outlineAlpha = fade * (1 - inOutSine(undraw));
	for (const glyph of enterBGlyphs(options)) {
		drawExitHoldOutline({
			alpha: outlineAlpha,
			color: options.frame.palette.foreground,
			glyph,
			lineWidth,
			options,
		});
	}
	if (fall < 1) {
		drawItemClipped({
			options,
			build: (ctx) => pathRect(ctx, -BIG, -BIG, BIG * 2, BIG + box.bottom),
			translateY: drop,
		});
	}
	const lineAlpha = seg(progress, 0.02, 0.12) * (1 - seg(progress, 0.5, 0.62));
	if (lineAlpha > 0.01) {
		bar({
			options,
			color: hot(options),
			height: Math.max(2, size * 0.03),
			width: box.width,
			x: box.left,
			y: box.bottom,
			alpha: lineAlpha,
		});
	}
}

/** 点線にほどける — the fill is wiped off, leaving the bare outline; the outline breaks into dashes, the dashes shorten to dots, and the dots go out. */
function drawDotted(options: EnterBDraw): void {
	const progress = options.frame.exitProgress;
	const size = options.size;
	const frame = frameOf(options, size * 0.3);
	const lineWidth = size * 0.024 * Math.min(1, progress * 10);
	const unit = Math.max(5, size * 0.1);
	const on = unit * (1 - ioC(seg(progress, 0.3, 0.96)));
	if (on < 0.05) return;
	const fade = 1 - smoothBetween(0.9, 1, progress);
	// the stroke-dash shrink is approximated by fading the outline with the on-ratio
	const outlineAlpha = fade * Math.max(0.15, on / unit);
	for (const glyph of enterBGlyphs(options)) {
		drawExitHoldOutline({
			alpha: outlineAlpha,
			color: options.frame.palette.foreground,
			glyph,
			lineWidth,
			options,
		});
	}
	const wipe = ioC(seg(progress, 0, 0.4));
	if (wipe >= 1) return;
	const reverse = cutBit(options, 65);
	const edge = reverse
		? lerpN(frame.a1, frame.a0, wipe)
		: lerpN(frame.a0, frame.a1, wipe);
	drawItemClipped({
		options,
		build: (ctx) =>
			reverse
				? pathRect(ctx, frame.a0 - BIG, frame.b0 - BIG, edge, frame.b1 + BIG)
				: pathRect(ctx, edge, frame.b0 - BIG, frame.a1 + BIG, frame.b1 + BIG),
	});
}
