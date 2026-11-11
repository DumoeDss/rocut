import {
	drawEnterBDot,
	drawEnterBLine,
	drawEnterBRing,
	drawEnterBWhole,
	enterBDirection,
	enterBOutBack,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inCubic,
	inOutCubic,
	inOutSine,
	lerp,
	outCubic,
	smooth,
} from "./exit-hold-geometry";
import type { MotionTextCanvasContext } from "./types";
import {
	x2Bounds,
	x2Hash,
	x2Hot,
	x2Random,
	x2RandomSigned,
	x2Stagger,
	x2Sub,
	x2Unit,
	type X2Draw,
} from "./x2-drawing";

/**
 * JIZURA x2entB — mask / band entrances: clip windows in unusual shapes and
 * orders, slices sliding into register, plates and bars, outline-first
 * reveals. Each part clips the whole line to an animated window (plus the
 * pack's helper graphics); rocut has no faded/outline item copies, so every
 * part renders its main-item branch.
 */

const PI = Math.PI;
const TAU = PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

/** Smoothstep between two thresholds (JIZURA `sstep`). */
// eslint-disable-next-line opencut/prefer-object-params
function sstep(start: number, end: number, value: number): number {
	return smooth((value - start) / (end - start));
}

function oQuart(value: number): number {
	return 1 - (1 - clamp(value)) ** 4;
}

function oQuint(value: number): number {
	return 1 - (1 - clamp(value)) ** 5;
}

function ioCubic(value: number): number {
	return inOutCubic(value);
}

function oCubic(value: number): number {
	return outCubic(value);
}

/** Bounce-out easing with three decreasing rebounds (JIZURA `bounce`). */
function bounce(value: number): number {
	const x = clamp(value);
	const n1 = 7.5625;
	const d1 = 2.75;
	if (x < 1 / d1) return n1 * x * x;
	if (x < 2 / d1) return n1 * (x - 1.5 / d1) ** 2 + 0.75;
	if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) ** 2 + 0.9375;
	return n1 * (x - 2.625 / d1) ** 2 + 0.984375;
}

/** Damped spring, 1 at rest swinging through to exactly 0 (JIZURA `spring`). */
// eslint-disable-next-line opencut/prefer-object-params
function springOf(progress: number, strength: number, frequency: number): number {
	const value = clamp(progress);
	return (
		Math.exp(-strength * value) *
		Math.cos(frequency * PI * value) *
		(1 - value ** 3)
	);
}

function lineW(options: X2Draw): number {
	return Math.max(2, options.size * 0.03);
}

function seedOf(options: X2Draw): number {
	return options.frame.cut?.seed ?? 0;
}

interface Frame {
	readonly U0: number;
	readonly U1: number;
	readonly V0: number;
	readonly V1: number;
	readonly L: number;
	readonly T: number;
	readonly uc: number;
	readonly vc: number;
	readonly big: number;
}

/** (u, v) frame of the padded bounds: u runs along the line, v across it (JIZURA `uv`, horizontal branch). */
// eslint-disable-next-line opencut/prefer-object-params
function frameOf(options: X2Draw, margin: number): Frame {
	const b = x2Bounds(options, margin);
	return {
		U0: b.left,
		U1: b.right,
		V0: b.top,
		V1: b.bottom,
		L: b.width,
		T: b.height,
		uc: b.centerX,
		vc: b.centerY,
		big: options.size * 40 + b.width + b.height,
	};
}

type Pt = readonly [number, number];

/** Clip the whole line to a mask built as one or more path subpaths. */
function clipWhole({
	mask,
	options,
}: {
	readonly mask: (ctx: MotionTextCanvasContext) => boolean;
	readonly options: X2Draw;
}): void {
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	if (mask(ctx)) {
		ctx.clip();
		drawEnterBWhole({ options });
	}
	ctx.restore();
}

/**
 * One slice of a `parts` part: the line clipped to a window, plus the slice's
 * offset. `fixed` windows stay at rest while the content slides under them;
 * otherwise window and content travel together (JIZURA `parts`).
 */
function slicePart({
	mask,
	offset,
	options,
	alpha = 1,
	degrees: rotation = 0,
	fixed,
}: {
	readonly mask: (ctx: MotionTextCanvasContext) => boolean;
	readonly offset: readonly [number, number];
	readonly options: X2Draw;
	readonly alpha?: number;
	readonly degrees?: number;
	readonly fixed?: boolean;
}): void {
	if (alpha <= 0.004) return;
	const [du, dv] = offset;
	const { ctx } = options;
	ctx.save();
	if (!fixed && (du !== 0 || dv !== 0)) ctx.translate(du, dv);
	ctx.beginPath();
	if (mask(ctx)) {
		ctx.clip();
		if (fixed) {
			drawEnterBWhole({
				alpha,
				options,
				rotation: rotation ? degrees(rotation) : 0,
				translateX: du,
				translateY: dv,
			});
		} else {
			drawEnterBWhole({ alpha, options });
		}
	}
	ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params
function addRect(
	ctx: MotionTextCanvasContext,
	u0: number,
	v0: number,
	u1: number,
	v1: number,
): boolean {
	if (u1 <= u0 || v1 <= v0) return false;
	ctx.rect(u0, v0, u1 - u0, v1 - v0);
	return true;
}

// eslint-disable-next-line opencut/prefer-object-params
function addPoly(
	ctx: MotionTextCanvasContext,
	points: readonly Pt[],
): boolean {
	if (points.length < 3) return false;
	if (ctx.moveTo && ctx.lineTo) {
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
	} else {
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		const left = Math.min(...xs);
		const top = Math.min(...ys);
		ctx.rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
	}
	return true;
}

/** Circle subpath as a polygon; the context type has no guaranteed `arc`. */
// eslint-disable-next-line opencut/prefer-object-params
function addCircle(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	radius: number,
): boolean {
	if (radius <= 0.01) return false;
	const points: Pt[] = [];
	for (let index = 0; index < 28; index += 1) {
		const angle = (index / 28) * TAU;
		points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
	}
	return addPoly(ctx, points);
}

/** Oval subpath wound against the surrounding shape so the nonzero clip rule cuts it out. */
// eslint-disable-next-line opencut/prefer-object-params
function addOvalHole(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	rx: number,
	ry: number,
): boolean {
	if (rx <= 0.01 || ry <= 0.01 || !ctx.moveTo || !ctx.lineTo) return false;
	const points: Pt[] = [];
	for (let index = 28; index >= 0; index -= 1) {
		const angle = (index / 28) * TAU;
		points.push([x + Math.cos(angle) * rx, y + Math.sin(angle) * ry]);
	}
	return addPoly(ctx, points);
}

// eslint-disable-next-line opencut/prefer-object-params
function fillRect(
	options: X2Draw,
	u0: number,
	v0: number,
	u1: number,
	v1: number,
	color: string,
	alpha: number,
): void {
	if (u1 <= u0 || v1 <= v0 || alpha <= 0.004) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	ctx.save();
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.fillStyle = color;
	ctx.fillRect(u0, v0, u1 - u0, v1 - v0);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
}

/** Open polyline stroke (JIZURA `eLine`). */
// eslint-disable-next-line opencut/prefer-object-params
function strokePolyline(
	options: X2Draw,
	points: readonly Pt[],
	color: string,
	width: number,
	alpha: number,
): void {
	if (alpha <= 0.004) return;
	for (let index = 1; index < points.length; index += 1) {
		drawEnterBLine({
			alpha,
			color,
			from: points[index - 1]!,
			options,
			to: points[index]!,
			width,
		});
	}
}

/** Filled polygon (JIZURA `ePoly`); falls back to its bounding box without path ops. */
// eslint-disable-next-line opencut/prefer-object-params
function fillPolygon(
	options: X2Draw,
	points: readonly Pt[],
	color: string,
	alpha: number,
): void {
	if (alpha <= 0.004 || points.length < 3) return;
	const { ctx } = options;
	if (ctx.moveTo && ctx.lineTo && ctx.fill) {
		const baseAlpha = ctx.globalAlpha;
		ctx.save();
		ctx.globalAlpha = baseAlpha * alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.moveTo(points[0]![0], points[0]![1]);
		for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
		ctx.fill();
		ctx.restore();
		ctx.globalAlpha = baseAlpha;
	} else {
		const xs = points.map(([x]) => x);
		const ys = points.map(([, y]) => y);
		fillRect(
			options,
			Math.min(...xs),
			Math.min(...ys),
			Math.max(...xs),
			Math.max(...ys),
			color,
			alpha,
		);
	}
}

/** Arc stroke approximated with a segment polyline (JIZURA `env.arc`, degrees). */
// eslint-disable-next-line opencut/prefer-object-params
function strokeArc(
	options: X2Draw,
	x: number,
	y: number,
	radius: number,
	fromDeg: number,
	toDeg: number,
	color: string,
	width: number,
	alpha: number,
): void {
	if (alpha <= 0.004 || radius <= 1) return;
	const points: Pt[] = [];
	for (let index = 0; index <= 10; index += 1) {
		const angle = degrees(lerpN(fromDeg, toDeg, index / 10));
		points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
	}
	strokePolyline(options, points, color, width, alpha);
}

/** Anti-seam overlap between neighbouring slice windows (JIZURA `ov`). */
function overlapOf(options: X2Draw): number {
	return 1.2 / (options.frame.scale || 1);
}

export function drawX2EntranceB(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "xfChevron":
		case "xfClosingHole":
		case "xfCornerBloom":
		case "xfCrossOpen":
		case "xfDiagStrips":
		case "xfEqualizer":
		case "xfHolesMerge":
		case "xfJaws":
		case "xfOutlineLead":
		case "xfPassingWipes":
		case "xfPrintHead":
		case "xfQuadRelay":
		case "xfRingDial":
		case "xfRollerShutter":
		case "xfRovingWindow":
		case "xfScanner":
		case "xfSlantLouver":
		case "xfSpiral":
		case "xfStackStrips":
		case "xfStaircase":
		case "xfStripSort":
		case "xfSunburst":
		case "xfTapeOff":
		case "xfThreeTier":
		case "xfTraceFlood":
		case "xfTriptych":
		case "xfTwoFields":
		case "xfUnderSweep":
		case "xfWeave":
		case "xfWiper":
			drawX2EntranceBPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2EntranceBPart(options: EnterBDraw): void {
	const preset = options.frame.cut?.preset.enter;
	switch (preset) {
		case "xfCornerBloom":
			drawCornerBloom(options);
			return;
		case "xfChevron":
			drawChevron(options);
			return;
		case "xfJaws":
			drawJaws(options);
			return;
		case "xfSlantLouver":
			drawSlantLouver(options);
			return;
		case "xfHolesMerge":
			drawHolesMerge(options);
			return;
		case "xfSunburst":
			drawSunburst(options);
			return;
		case "xfTriptych":
			drawTriptych(options);
			return;
		case "xfRovingWindow":
			drawRovingWindow(options);
			return;
		case "xfStaircase":
			drawStaircase(options);
			return;
		case "xfQuadRelay":
			drawQuadRelay(options);
			return;
		case "xfWiper":
			drawWiper(options);
			return;
		case "xfSpiral":
			drawSpiral(options);
			return;
		case "xfCrossOpen":
			drawCrossOpen(options);
			return;
		case "xfClosingHole":
			drawClosingHole(options);
			return;
		case "xfWeave":
			drawWeave(options);
			return;
		case "xfPassingWipes":
			drawPassingWipes(options);
			return;
		case "xfPrintHead":
			drawPrintHead(options);
			return;
		case "xfTwoFields":
			drawTwoFields(options);
			return;
		case "xfThreeTier":
			drawThreeTier(options);
			return;
		case "xfStripSort":
			drawStripSort(options);
			return;
		case "xfEqualizer":
			drawEqualizer(options);
			return;
		case "xfDiagStrips":
			drawDiagStrips(options);
			return;
		case "xfRingDial":
			drawRingDial(options);
			return;
		case "xfStackStrips":
			drawStackStrips(options);
			return;
		case "xfUnderSweep":
			drawUnderSweep(options);
			return;
		case "xfTapeOff":
			drawTapeOff(options);
			return;
		case "xfScanner":
			drawScanner(options);
			return;
		case "xfRollerShutter":
			drawRollerShutter(options);
			return;
		case "xfOutlineLead":
			drawOutlineLead(options);
			return;
		case "xfTraceFlood":
			drawTraceFlood(options);
			return;
		default:
			return;
	}
}

/** 角から円 — a circle grows out of one corner of the line until it has swallowed the whole of it. */
function drawCornerBloom(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const eased = ioCubic(progress);
	const corner = x2Hash(seedOf(options), 301) & 3;
	const b = x2Bounds(options);
	const m = size * 0.25;
	const x = corner & 1 ? b.right + m : b.left - m;
	const y = corner & 2 ? b.top - m : b.bottom + m;
	const radius = (Math.hypot(b.width + m * 2, b.height + m * 2) + 2) * eased;
	clipWhole({
		mask: (ctx) => addCircle(ctx, x, y, radius),
		options,
	});
	const alpha = 1 - sstep(0.5, 0.92, progress);
	if (alpha <= 0.01 || radius < 1) return;
	const color = x2Hot(options);
	const a0 = corner & 1 ? (corner & 2 ? 90 : 180) : corner & 2 ? 0 : 270;
	strokeArc(options, x, y, radius, a0, a0 + 90, color, lineW(options), alpha);
	strokeArc(
		options,
		x,
		y,
		radius * 0.82,
		a0,
		a0 + 90,
		color,
		lineW(options) * 0.5,
		alpha * 0.5,
	);
}

/** 山形ワイプ — the leading edge is an arrow head: the middle uncovers first, two chevrons run ahead. */
function drawChevron(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 302);
	const eased = ioCubic(progress);
	const k = 0.6;
	const g = frameOf(options, size * 0.2);
	const hv = g.T / 2;
	const tip = (g.L + k * hv + 1) * eased;
	const u = (s: number): number => (dir > 0 ? g.U0 + s : g.U1 - s);
	clipWhole({
		mask: (ctx) =>
			eased <= 0
				? false
				: addPoly(ctx, [
						[u(-g.big), g.V0],
						[u(tip - k * hv), g.V0],
						[u(tip), g.vc],
						[u(tip - k * hv), g.V1],
						[u(-g.big), g.V1],
					]),
		options,
	});
	const fade = clamp(progress * 8) * (1 - sstep(0.72, 0.96, progress));
	const color = x2Hot(options);
	for (let j = 0; j < 2; j += 1) {
		const o = tip + size * (0.16 + 0.3 * j);
		strokePolyline(
			options,
			[
				[u(o - k * hv), g.V0],
				[u(o), g.vc],
				[u(o - k * hv), g.V1],
			],
			color,
			lineW(options) * (j ? 0.6 : 1.2),
			fade * (j ? 0.5 : 1),
		);
	}
}

/** 噛み合わせ — two saw-toothed jaws close on the line from above and below and mesh along a zigzag. */
function drawJaws(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const eased = ioCubic(progress / 0.94);
	const snap = sstep(0.8, 1, progress);
	const g = frameOf(options, size * 0.06);
	const nT = Math.min(40, Math.max(2, Math.round(g.L / (size * 0.62))));
	const tw = g.L / nT;
	const am = Math.min(g.T * 0.2, size * 0.26);
	const d = (g.T / 2 + am * 0.5) * (1 - eased);
	const z: Pt[] = [];
	for (let j = 0; j <= nT * 2; j += 1) {
		z.push([g.U0 + (j * tw) / 2, g.vc + (j % 2 ? am : -am)]);
	}
	z[0] = [z[0]![0] - g.big, z[0]![1]];
	z[z.length - 1] = [
		z[z.length - 1]![0] + g.big,
		z[z.length - 1]![1],
	];
	clipWhole({
		mask: (ctx) => {
			if (progress <= 0) return false;
			const top = addPoly(ctx, [
				[g.U0 - g.big, g.V0 - g.big],
				[g.U1 + g.big, g.V0 - g.big],
				...[...z].reverse().map((q): Pt => [q[0], q[1] - d + 0.4]),
			]);
			const bottom = addPoly(ctx, [
				...z.map((q): Pt => [q[0], q[1] + d - 0.4]),
				[g.U1 + g.big, g.V1 + g.big],
				[g.U0 - g.big, g.V1 + g.big],
			]);
			return top || bottom;
		},
		options,
	});
	const alpha = clamp(progress * 6) * (1 - snap);
	const color = x2Hot(options);
	const edge = z.slice();
	edge[0] = [g.U0, edge[0]![1]];
	edge[edge.length - 1] = [g.U1, edge[edge.length - 1]![1]];
	strokePolyline(
		options,
		edge.map((q): Pt => [q[0], q[1] - d]),
		color,
		lineW(options),
		alpha,
	);
	strokePolyline(
		options,
		edge.map((q): Pt => [q[0], q[1] + d]),
		color,
		lineW(options),
		alpha,
	);
}

/** 斜めルーバー — slanted slats drift along the line while they open one after another. */
function drawSlantLouver(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 304);
	const k = 0.75 * enterBDirection(options, 305);
	clipWhole({
		mask: (ctx) => {
			const g = frameOf(options, size * 0.2);
			const ak = Math.abs(k) * (g.T / 2);
			const lo = g.U0 - ak;
			const hi = g.U1 + ak;
			const pitch = Math.max(size * 0.46, (hi - lo) / 70);
			const drift = (1 - oCubic(progress)) * pitch * 2.5 * dir;
			let any = false;
			for (
				let j = Math.floor((lo - drift) / pitch) - 1;
				j <= Math.ceil((hi - drift) / pitch) + 1;
				j += 1
			) {
				const c = j * pitch + drift;
				const f = clamp((c - lo) / Math.max(1, hi - lo));
				const open = ioCubic(
					x2Stagger(progress, dir > 0 ? 1 - f : f, 0.45),
				);
				if (open <= 0) continue;
				const hw = pitch * 0.5 * open + 0.5;
				any =
					addPoly(ctx, [
						[c - hw - (k * g.T) / 2, g.V0],
						[c + hw - (k * g.T) / 2, g.V0],
						[c + hw + (k * g.T) / 2, g.V1],
						[c - hw + (k * g.T) / 2, g.V1],
					]) || any;
			}
			return any;
		},
		options,
	});
}

/** 穴がつながる — round holes open at scattered points and grow until they merge into the whole line. */
function drawHolesMerge(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const g = frameOf(options, size * 0.2);
	const n = Math.min(7, Math.max(2, Math.round(g.L / (size * 1.2))));
	const cw = g.L / n;
	const holes = Array.from({ length: n }, (_, k) => {
		const ju = x2RandomSigned(options, k, 311) * cw * 0.28;
		const jv = x2RandomSigned(options, k, 312) * g.T * 0.28;
		const q = x2Stagger(progress, x2Random(options, k, 313), 0.4);
		return {
			q,
			r:
				(Math.hypot(cw / 2 + Math.abs(ju), g.T / 2 + Math.abs(jv)) * 1.03 + 1) *
				ioCubic(q),
			x: g.U0 + (k + 0.5) * cw + ju,
			y: g.vc + jv,
		};
	});
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const hole of holes) {
				any = addCircle(ctx, hole.x, hole.y, hole.r) || any;
			}
			return any;
		},
		options,
	});
	const color = x2Hot(options);
	for (const hole of holes) {
		if (hole.q <= 0) continue;
		drawEnterBRing({
			alpha: 1 - sstep(0.25, 0.8, hole.q),
			color,
			options,
			radius: hole.r,
			width: lineW(options) * 0.8,
			x: hole.x,
			y: hole.y,
		});
	}
}

/** 放射びらき — eight wedges fan out from the middle, turning slightly as they widen into a full disc. */
function drawSunburst(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const n = 8;
	const dir = enterBDirection(options, 321);
	const a0 = x2Unit(seedOf(options), 322) * TAU + (1 - oCubic(progress)) * 0.8 * dir;
	const ha = (PI / n) * ioCubic(progress) * 1.03;
	const g = frameOf(options, options.size * 0.2);
	const radius = Math.hypot(g.L, g.T) / 2 + 2;
	clipWhole({
		mask: (ctx) => {
			if (ha <= 0) return false;
			const r = radius / Math.cos(Math.min(ha, PI / n));
			let any = false;
			for (let k = 0; k < n; k += 1) {
				const a = a0 + (k * TAU) / n;
				any =
					addPoly(ctx, [
						[g.uc, g.vc],
						[g.uc + Math.cos(a - ha) * r, g.vc + Math.sin(a - ha) * r],
						[g.uc + Math.cos(a + ha) * r, g.vc + Math.sin(a + ha) * r],
					]) || any;
			}
			return any;
		},
		options,
	});
	const alpha = clamp(progress * 10) * (1 - sstep(0.15, 0.6, progress));
	if (alpha <= 0.01) return;
	const spokeLength = radius * oCubic(progress * 2.2);
	const color = x2Hot(options);
	for (let k = 0; k < n; k += 1) {
		const a = a0 + (k * TAU) / n;
		strokePolyline(
			options,
			[
				[g.uc, g.vc],
				[g.uc + Math.cos(a) * spokeLength, g.vc + Math.sin(a) * spokeLength],
			],
			color,
			lineW(options) * 0.6,
			alpha,
		);
	}
}

/** 三連窓 — the line sits behind three panes; the middle one opens first, then the outer two. */
function drawTriptych(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const ord = [1, 0, 2];
	const g = frameOf(options, options.size * 0.2);
	const w = g.L / 3;
	const panes = ord.map((order, k) => {
		const q = x2Stagger(progress, order / 2, 0.45);
		const eased = oQuart(q);
		const c = g.U0 + (k + 0.5) * w;
		return {
			q,
			u0: c - (w / 2 + 0.5) * eased,
			u1: c + (w / 2 + 0.5) * eased,
			v0: g.vc - (g.T / 2) * eased,
			v1: g.vc + (g.T / 2) * eased,
		};
	});
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const pane of panes) {
				any = addRect(ctx, pane.u0, pane.v0, pane.u1, pane.v1) || any;
			}
			return any;
		},
		options,
	});
	const color = x2Hot(options);
	for (const pane of panes) {
		if (pane.q <= 0) continue;
		strokePolyline(
			options,
			[
				[pane.u0, pane.v0],
				[pane.u1, pane.v0],
				[pane.u1, pane.v1],
				[pane.u0, pane.v1],
				[pane.u0, pane.v0],
				[pane.u1, pane.v0],
			],
			color,
			lineW(options) * 0.8,
			1 - sstep(0.55, 1, pane.q),
		);
	}
}

/** 覗き窓 — a framed window travels along the line showing a glimpse, then stretches back and opens everything. */
function drawRovingWindow(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 331);
	const g = frameOf(options, size * 0.2);
	const w0 = Math.min(
		Math.min(Math.max(g.L * 0.28, size * 0.9), size * 2.6),
		g.L * 0.6,
	);
	const t1 = ioCubic(progress / 0.5);
	const t2 = ioCubic((progress - 0.5) / 0.5);
	let a = progress < 0.5 ? lerpN(-w0, g.L - w0, t1) : lerpN(g.L - w0, 0, t2);
	let z = progress < 0.5 ? a + w0 : g.L;
	a = Math.max(0, a);
	z = Math.min(g.L, z);
	const u0 = dir > 0 ? g.U0 + a : g.U1 - z;
	const u1 = dir > 0 ? g.U0 + z : g.U1 - a;
	clipWhole({
		mask: (ctx) => addRect(ctx, u0, g.V0, u1, g.V1),
		options,
	});
	const alpha = 1 - sstep(0.78, 1, progress);
	if (u1 - u0 < 1) return;
	strokePolyline(
		options,
		[
			[u0, g.V0],
			[u1, g.V0],
			[u1, g.V1],
			[u0, g.V1],
			[u0, g.V0],
			[u1, g.V0],
		],
		x2Hot(options),
		lineW(options),
		alpha,
	);
}

/** 階段ワイプ — the line is uncovered column by column, each a little later, so the boundary is a staircase. */
function drawStaircase(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const rev = enterBDirection(options, 341) < 0;
	const up = enterBDirection(options, 342) < 0;
	const s = 0.75;
	const g = frameOf(options, size * 0.2);
	const count = Math.min(14, Math.max(4, Math.round(g.L / (size * 0.62))));
	const w = g.L / count;
	const columns = Array.from({ length: count }, (_, k) => ({
		f: ioCubic(
			clamp(
				progress * (1 + s) - (s * (rev ? count - 1 - k : k)) / (count - 1),
			),
		),
		u0: g.U0 + k * w,
		u1: g.U0 + (k + 1) * w,
	}));
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const column of columns) {
				if (column.f <= 0) continue;
				any =
					(up
						? addRect(
								ctx,
								column.u0,
								g.V1 - g.T * column.f,
								column.u1 + 0.6,
								g.V1 + g.big,
							)
						: addRect(
								ctx,
								column.u0,
								g.V0 - g.big,
								column.u1 + 0.6,
								g.V0 + g.T * column.f,
							)) || any;
			}
			return any;
		},
		options,
	});
	const width = lineW(options);
	const color = x2Hot(options);
	for (const column of columns) {
		if (column.f <= 0 || column.f >= 1) continue;
		const v = up ? g.V1 - g.T * column.f : g.V0 + g.T * column.f;
		fillRect(
			options,
			column.u0,
			v - width / 2,
			column.u1,
			v + width / 2,
			color,
			Math.min(1, column.f * 6, (1 - column.f) * 6),
		);
	}
}

/** 四分割リレー — the four quarters are wiped one after another, the wipe turning a corner each time. */
function drawQuadRelay(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const flip = enterBDirection(options, 351) < 0;
	const g = frameOf(options, options.size * 0.2);
	const easeOf = (k: number): number =>
		ioCubic(clamp((progress - k * 0.22) / 0.34));
	const u = [g.U0, g.uc, g.U1];
	const v = [flip ? g.V1 : g.V0, g.vc, flip ? g.V0 : g.V1];
	const quarters = [
		{
			alongU: true,
			ease: easeOf(0),
			r: [u[0]!, lerpN(u[0]!, u[1]!, easeOf(0)), v[0]!, v[2]!],
		},
		{
			alongU: false,
			ease: easeOf(1),
			r: [u[1]!, u[2]!, v[0]!, lerpN(v[0]!, v[1]!, easeOf(1))],
		},
		{
			alongU: true,
			ease: easeOf(2),
			r: [u[2]!, lerpN(u[2]!, u[1]!, easeOf(2)), v[2]!, v[1]!],
		},
		{
			alongU: false,
			ease: easeOf(3),
			r: [u[1]!, u[0]!, v[2]!, lerpN(v[2]!, v[1]!, easeOf(3))],
		},
	];
	const norm = (r: readonly number[]): readonly number[] => [
		Math.min(r[0]!, r[1]!),
		Math.max(r[0]!, r[1]!),
		Math.min(r[2]!, r[3]!),
		Math.max(r[2]!, r[3]!),
	];
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const q of quarters) {
				if (q.ease <= 0) continue;
				const r = norm(q.r);
				any =
					addRect(ctx, r[0]! - 0.4, r[2]! - 0.4, r[1]! + 0.4, r[3]! + 0.4) ||
					any;
			}
			return any;
		},
		options,
	});
	const width = lineW(options) * 1.3;
	const color = x2Hot(options);
	for (const q of quarters) {
		if (q.ease <= 0 || q.ease >= 1) continue;
		const r = norm(q.r);
		if (q.alongU) {
			fillRect(options, q.r[1]! - width / 2, r[2]!, q.r[1]! + width / 2, r[3]!, color, 1);
		} else {
			fillRect(options, r[0]!, q.r[3]! - width / 2, r[1]!, q.r[3]! + width / 2, color, 1);
		}
	}
}

/** ワイパー — an arm pivoting below the line sweeps across like a windscreen wiper and leaves the lyric behind it. */
function drawWiper(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 361);
	const eased = ioCubic(progress / 0.94);
	const g = frameOf(options, size * 0.2);
	const d = g.T * 0.55 + size * 0.5;
	const pv = g.V1 + d;
	const aL = Math.atan2(-d, -g.L / 2) - 0.03;
	const aR = Math.atan2(-d, g.L / 2) + 0.03;
	const from = dir > 0 ? aL : aR;
	const to = dir > 0 ? aR : aL;
	const sweep = lerpN(from, to, eased);
	const radius = Math.hypot(g.L / 2, g.T + d) * 1.04;
	clipWhole({
		mask: (ctx) => {
			if (eased <= 0) return false;
			const n = Math.max(2, Math.ceil(Math.abs(sweep - from) / 0.05));
			const pts: Pt[] = [[g.uc, pv]];
			for (let k = 0; k <= n; k += 1) {
				const a = lerpN(from, sweep, k / n);
				pts.push([
					g.uc + Math.cos(a) * radius * 1.02,
					pv + Math.sin(a) * radius * 1.02,
				]);
			}
			return addPoly(ctx, pts);
		},
		options,
	});
	const alpha = clamp(progress * 10) * (1 - sstep(0.82, 0.98, progress));
	const color = x2Hot(options);
	strokePolyline(
		options,
		[
			[g.uc, pv],
			[g.uc + Math.cos(sweep) * radius, pv + Math.sin(sweep) * radius],
		],
		color,
		lineW(options) * 1.6,
		alpha,
	);
	drawEnterBDot({
		alpha,
		color,
		options,
		radius: lineW(options) * 2.2,
		x: g.uc,
		y: pv,
	});
}

/** 渦巻き窓 — a thin spiral slit winds outwards from the middle, then thickens until its turns touch. */
function drawSpiral(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const dir = enterBDirection(options, 371);
	const th0 = x2Unit(seedOf(options), 372) * TAU;
	const turns = 3;
	const eL = oCubic(progress / 0.7);
	const eW = ioCubic((progress - 0.3) / 0.7);
	const g = frameOf(options, options.size * 0.2);
	const reachable = Math.min(3.2, Math.max(1, g.L / g.T));
	const Rm = Math.hypot(g.L / 2 / reachable, g.T / 2) + 1;
	const pitch = Rm / turns;
	const tm = TAU * turns * eL;
	const hw = pitch * lerpN(0.15, 1.02, eW);
	// eslint-disable-next-line opencut/prefer-object-params
	const at = (th: number, r: number): Pt => [
		g.uc + Math.cos(th0 + dir * th) * r * reachable,
		g.vc + Math.sin(th0 + dir * th) * r,
	];
	clipWhole({
		mask: (ctx) => {
			if (tm <= 0.02) return false;
			const n = Math.max(3, Math.ceil(tm / 0.17));
			const outer: Pt[] = [];
			const inner: Pt[] = [];
			for (let k = 0; k <= n; k += 1) {
				const th = (tm * k) / n;
				const r = (pitch * th) / TAU;
				outer.push(at(th, r + hw));
				inner.push(at(th, Math.max(0, r - hw)));
			}
			return addPoly(ctx, [...outer, ...inner.reverse()]);
		},
		options,
	});
	const alpha = 1 - sstep(0.35, 0.8, progress);
	if (alpha <= 0.01 || tm <= 0.05) return;
	const n = Math.max(3, Math.ceil(tm / 0.17));
	const pts: Pt[] = [];
	for (let k = 0; k <= n; k += 1) {
		const th = (tm * k) / n;
		pts.push(at(th, (pitch * th) / TAU));
	}
	strokePolyline(options, pts, x2Hot(options), lineW(options) * 0.7, alpha);
}

/** 十字びらき — a slit along the line and a column across it widen together, the four corners close last. */
function drawCrossOpen(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const e1 = ioCubic(progress);
	const e2 = ioCubic(progress * 1.15 - 0.15);
	const g = frameOf(options, options.size * 0.2);
	const hu = (g.L / 2 + 0.5) * e2;
	const hv = (g.T / 2 + 0.5) * e1;
	clipWhole({
		mask: (ctx) =>
			addRect(ctx, g.U0 - 1, g.vc - hv, g.U1 + 1, g.vc + hv) ||
			addRect(ctx, g.uc - hu, g.V0 - 1, g.uc + hu, g.V1 + 1),
		options,
	});
	const alpha = clamp(progress * 8) * (1 - sstep(0.7, 0.95, progress));
	if (alpha <= 0.01) return;
	const width = lineW(options);
	const color = x2Hot(options);
	const arm = options.size * 0.22;
	for (const su of [-1, 1]) {
		for (const sv of [-1, 1]) {
			const u = g.uc + su * hu;
			const v = g.vc + sv * hv;
			fillRect(
				options,
				Math.min(u, u + su * arm),
				v - width / 2,
				Math.max(u, u + su * arm),
				v + width / 2,
				color,
				alpha,
			);
			fillRect(
				options,
				u - width / 2,
				Math.min(v, v + sv * arm),
				u + width / 2,
				Math.max(v, v + sv * arm),
				color,
				alpha,
			);
		}
	}
}

/** 閉じる穴 — the line is revealed from its outer edge inwards: a blind spot over it shrinks to a point and is gone. */
function drawClosingHole(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const eased = 0.5 * oCubic(progress) + 0.5 * ioCubic(progress);
	const b = x2Bounds(options);
	const rx = (b.width / 2) * 1.42 + 2;
	const ry = (b.height / 2) * 1.42 + 2;
	const holeRx = rx * (1 - eased);
	const holeRy = ry * (1 - eased);
	const big = size * 40 + b.width + b.height;
	clipWhole({
		mask: (ctx) => {
			if (progress <= 0) return false;
			const whole = addRect(
				ctx,
				b.centerX - big,
				b.centerY - big,
				b.centerX + big,
				b.centerY + big,
			);
			if (holeRx > 0.3 && holeRy > 0.3) {
				addOvalHole(ctx, b.centerX, b.centerY, holeRx, holeRy);
			}
			return whole;
		},
		options,
	});
	const alpha = clamp(progress * 3.5) * (1 - sstep(0.75, 1, progress));
	if (alpha <= 0.01 || holeRx < 1 || holeRy < 1) return;
	const points: Pt[] = [];
	for (let index = 0; index <= 24; index += 1) {
		const angle = (index / 24) * TAU;
		points.push([
			b.centerX + Math.cos(angle) * holeRx,
			b.centerY + Math.sin(angle) * holeRy,
		]);
	}
	strokePolyline(
		options,
		[...points, points[0]!],
		x2Hot(options),
		lineW(options) * 0.8,
		alpha,
	);
}

/** 織り目 — stripes along and across the line run in from alternate sides, weave a plaid, then thicken to solid. */
function drawWeave(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const x1 = ioCubic(progress / 0.55);
	const x2 = ioCubic((progress - 0.1) / 0.55);
	const d = lerpN(0.42, 1, ioCubic((progress - 0.5) / 0.5));
	const g = frameOf(options, size * 0.2);
	const nH = Math.min(12, Math.max(3, Math.round(g.T / (size * 0.34))));
	const ph = g.T / nH;
	const nV = Math.min(44, Math.max(3, Math.round(g.L / (size * 0.34))));
	const pw = g.L / nV;
	clipWhole({
		mask: (ctx) => {
			let any = false;
			if (x1 > 0) {
				for (let j = 0; j < nH; j += 1) {
					const c = g.V0 + (j + 0.5) * ph;
					const hw = (ph * d) / 2 + 0.4;
					any =
						(j % 2
							? addRect(ctx, g.U1 - g.L * x1, c - hw, g.U1 + 1, c + hw)
							: addRect(ctx, g.U0 - 1, c - hw, g.U0 + g.L * x1, c + hw)) ||
						any;
				}
			}
			if (x2 > 0) {
				for (let k = 0; k < nV; k += 1) {
					const c = g.U0 + (k + 0.5) * pw;
					const hw = (pw * d) / 2 + 0.4;
					any =
						(k % 2
							? addRect(ctx, c - hw, g.V1 - g.T * x2, c + hw, g.V1 + 1)
							: addRect(ctx, c - hw, g.V0 - 1, c + hw, g.V0 + g.T * x2)) ||
						any;
				}
			}
			return any;
		},
		options,
	});
}

/** すれ違いワイプ — the upper half is wiped from one end, the lower from the other; the bars pass mid-line. */
function drawPassingWipes(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const dir = enterBDirection(options, 381);
	const eased = ioCubic(progress);
	const g = frameOf(options, options.size * 0.2);
	const a = dir > 0 ? g.U0 + g.L * eased : g.U1 - g.L * eased;
	const z = dir > 0 ? g.U1 - g.L * eased : g.U0 + g.L * eased;
	clipWhole({
		mask: (ctx) => {
			if (eased <= 0) return false;
			const top = addRect(
				ctx,
				dir > 0 ? g.U0 - g.big : a,
				g.V0 - g.big,
				dir > 0 ? a : g.U1 + g.big,
				g.vc + 0.4,
			);
			const bottom = addRect(
				ctx,
				dir > 0 ? z : g.U0 - g.big,
				g.vc,
				dir > 0 ? g.U1 + g.big : z,
				g.V1 + g.big,
			);
			return top || bottom;
		},
		options,
	});
	const width = Math.max(4, options.size * 0.07) / 2;
	const color = x2Hot(options);
	const alpha = clamp(progress * 12);
	fillRect(options, a - width, g.V0, a + width, g.vc, color, alpha);
	fillRect(options, z - width, g.vc, z + width, g.V1, color, alpha);
}

/** 印字ヘッド — a print head shuttles back and forth, laying the line down one thin row at a time. */
function drawPrintHead(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const first = enterBDirection(options, 391);
	const g = frameOf(options, size * 0.2);
	const count = Math.min(8, Math.max(3, Math.round(g.T / (size * 0.36))));
	const h = g.T / count;
	const rows = Array.from({ length: count }, (_, k) => {
		const q = clamp(progress * count - k);
		const eased = inOutSine(q);
		const d = (k % 2 ? -1 : 1) * first;
		return {
			q,
			d,
			edge: d > 0 ? g.U0 + g.L * eased : g.U1 - g.L * eased,
			v0: g.V0 + k * h,
			v1: g.V0 + (k + 1) * h,
		};
	});
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const row of rows) {
				if (row.q <= 0) continue;
				any =
					addRect(
						ctx,
						row.d > 0 ? g.U0 - 1 : row.edge,
						row.v0 - 0.4,
						row.d > 0 ? row.edge : g.U1 + 1,
						row.v1 + 0.4,
					) || any;
			}
			return any;
		},
		options,
	});
	const color = x2Hot(options);
	const hw = size * 0.11;
	for (const row of rows) {
		if (row.q <= 0 || row.q >= 1) continue;
		fillRect(
			options,
			row.edge - hw,
			row.v0 - size * 0.04,
			row.edge + hw,
			row.v1 + size * 0.04,
			color,
			1,
		);
	}
}

/** 二版合わせ — the line splits into two hairline fields; one slides in from each side and they interleave. */
function drawTwoFields(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 401);
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const d = size * 1.4 + g.L * 0.18;
	const hr = Math.max(size * 0.075, 3, g.T / 120);
	const n = Math.ceil(g.T / hr);
	const field =
		(f: number) =>
		(ctx: MotionTextCanvasContext): boolean => {
			let any = false;
			for (let k = f; k < n; k += 2) {
				any =
					addRect(
						ctx,
						g.U0 - g.big,
						g.V0 + k * hr - (k < 2 ? g.big : 0),
						g.U1 + g.big,
						g.V0 + (k + 1) * hr + ov * 0.5 + (k >= n - 2 ? g.big : 0),
					) || any;
			}
			return any;
		};
	slicePart({
		fixed: true,
		mask: field(0),
		offset: [-dir * d * (1 - oQuart(progress / 0.66)), 0],
		options,
		alpha: clamp(progress * 6),
	});
	slicePart({
		fixed: true,
		mask: field(1),
		offset: [dir * d * (1 - oQuart((progress - 0.3) / 0.7)), 0],
		options,
		alpha: clamp((progress - 0.3) * 6),
	});
}

/** 三段ずれ — three tiers arrive one after another from the same side and spring back and forth into line. */
function drawThreeTier(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 411);
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const d = size * 1.7;
	for (let k = 0; k < 3; k += 1) {
		const q = x2Stagger(progress, k / 2, 0.3);
		slicePart({
			mask: (ctx) =>
				addRect(
					ctx,
					g.U0 - g.big,
					k ? g.V0 + (k * g.T) / 3 : g.V0 - g.big,
					g.U1 + g.big,
					k < 2
						? g.V0 + ((k + 1) * g.T) / 3 + ov
						: g.V1 + g.big,
				),
			offset: [dir * d * springOf(q, 3.4, 2.5), 0],
			options,
			alpha: clamp(q * 5),
		});
	}
}

/** 帯の並べ替え — vertical strips stand in the wrong order; they hop over each other into place. */
function drawStripSort(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const seed = seedOf(options);
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const count = Math.min(7, Math.max(3, Math.round(g.L / (size * 0.95))));
	const w = g.L / count;
	const sh = 1 + (x2Hash(seed, 421) % (count - 1));
	const slot = Array.from({ length: count }, (_, k) => (k + sh) % count);
	const sw = x2Hash(seed, 422) % (count - 1);
	[slot[sw], slot[sw + 1]] = [slot[sw + 1]!, slot[sw]!];
	for (let k = 0; k < count; k += 1) {
		const q = x2Stagger(progress, k / (count - 1), 0.4);
		const eased = ioCubic(q);
		slicePart({
			mask: (ctx) =>
				addRect(
					ctx,
					g.U0 + k * w - (k ? 0 : g.big),
					g.V0 - g.big,
					g.U0 + (k + 1) * w + (k < count - 1 ? ov : g.big),
					g.V1 + g.big,
				),
			offset: [
				(slot[k]! - k) * w * (1 - eased),
				-Math.sin(PI * q) * size * 0.5 * (k % 2 ? 1 : -1),
			],
			options,
			alpha: clamp(progress * 7),
		});
	}
}

/** イコライザ — columns shoot up from behind a floor line to different beats, overshoot and settle. */
function drawEqualizer(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const count = Math.min(14, Math.max(4, Math.round(g.L / (size * 0.5))));
	const w = g.L / count;
	for (let k = 0; k < count; k += 1) {
		const q = x2Stagger(progress, x2Random(options, k, 431), 0.5);
		if (q <= 0) continue;
		slicePart({
			fixed: true,
			mask: (ctx) =>
				addRect(
					ctx,
					g.U0 + k * w - (k ? 0 : g.big),
					g.V0 - g.big,
					g.U0 + (k + 1) * w + (k < count - 1 ? ov : g.big),
					g.V1,
				),
			offset: [0, (g.T + size * 0.1) * (1 - enterBOutBack(q, 1.5))],
			options,
		});
	}
	const width = lineW(options);
	const hl = (g.L / 2) * oQuart(progress / 0.2);
	fillRect(
		options,
		g.uc - hl,
		g.V1 - width / 2,
		g.uc + hl,
		g.V1 + width / 2,
		x2Hot(options),
		1 - sstep(0.8, 1, progress),
	);
}

/** 斜め帯合わせ — slanted strips slide along their own slant, alternately down and up, into register. */
function drawDiagStrips(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const k = 0.6 * enterBDirection(options, 441);
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const ak = Math.abs(k) * (g.T / 2);
	const lo = g.U0 - ak;
	const hi = g.U1 + ak;
	const count = Math.min(7, Math.max(3, Math.round((hi - lo) / (size * 1.15))));
	const sw = (hi - lo) / count;
	const nrm = Math.hypot(k, 1);
	const d = g.T + size * 1.4;
	for (let j = 0; j < count; j += 1) {
		const q = x2Stagger(progress, j / (count - 1), 0.42);
		const eased = oQuint(q);
		const sg = j % 2 ? 1 : -1;
		slicePart({
			mask: (ctx) => {
				const a = j ? lo + j * sw : lo - g.big;
				const z =
					j < count - 1 ? lo + (j + 1) * sw + ov : hi + g.big;
				const y = g.big;
				return addPoly(ctx, [
					[a - k * y, g.vc - y],
					[z - k * y, g.vc - y],
					[z + k * y, g.vc + y],
					[a + k * y, g.vc + y],
				]);
			},
			offset: [
				((sg * k) / nrm) * d * (1 - eased),
				(sg / nrm) * d * (1 - eased),
			],
			options,
			alpha: clamp(q * 4),
		});
	}
}

/** ダイヤル合わせ — concentric rings turned out of place rotate back like a combination lock, inner ring first. */
function drawRingDial(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const n = 4;
	const dir = enterBDirection(options, 451);
	const b = x2Bounds(options);
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const Rm = Math.hypot(b.width, b.height) / 2 + size * 0.15;
	for (let j = 0; j < n; j += 1) {
		const q = x2Stagger(progress, j / (n - 1), 0.4);
		slicePart({
			fixed: true,
			degrees:
				dir * (j % 2 ? -1 : 1) * (52 - 9 * j) * (1 - oQuint(q)),
			mask: (ctx) => {
				const r1 = j < n - 1 ? (Rm * (j + 1)) / n + ov : g.big;
				const r0 = (Rm * j) / n;
				const outer = addCircle(ctx, b.centerX, b.centerY, r1);
				if (j) addOvalHole(ctx, b.centerX, b.centerY, r0, r0);
				return outer;
			},
			offset: [0, 0],
			options,
			alpha: clamp(q * 4),
		});
	}
	const alpha = 0.5 * clamp(progress * 8) * (1 - sstep(0.6, 0.95, progress));
	if (alpha <= 0.01) return;
	for (let j = 1; j < n; j += 1) {
		drawEnterBRing({
			alpha,
			color: x2Hot(options),
			options,
			radius: (Rm * j) / n,
			width: lineW(options) * 0.5,
			x: b.centerX,
			y: b.centerY,
		});
	}
}

/** 積み帯 — the line is built like a wall: the lowest strip drops in and bounces, then the next lands on top. */
function drawStackStrips(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const g = frameOf(options, size * 0.2);
	const ov = overlapOf(options);
	const n = 4;
	const h = g.T / n;
	for (let k = 0; k < n; k += 1) {
		const q = x2Stagger(progress, (n - 1 - k) / (n - 1), 0.5);
		slicePart({
			mask: (ctx) =>
				addRect(
					ctx,
					g.U0 - g.big,
					k ? g.V0 + k * h : g.V0 - g.big,
					g.U1 + g.big,
					k < n - 1 ? g.V0 + (k + 1) * h + ov : g.V1 + g.big,
				),
			offset: [0, -(g.T + size * 0.9) * (1 - bounce(q))],
			options,
			alpha: clamp(q * 8),
		});
	}
}

/** 下線が掃く — an underline is drawn, lifts through the line uncovering what it passed, retracts as an overline. */
function drawUnderSweep(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const dir = enterBDirection(options, 501);
	const grow = oQuart(progress / 0.2);
	const lift = ioCubic((progress - 0.12) / 0.7);
	const away = inCubic(clamp((progress - 0.82) / 0.18));
	const g = frameOf(options, options.size * 0.2);
	const barV = lerpN(g.V1, g.V0, lift);
	clipWhole({
		mask: (ctx) =>
			lift > 0
				? addRect(ctx, g.U0 - g.big, barV, g.U1 + g.big, g.V1 + g.big)
				: false,
		options,
	});
	const width = Math.max(3, options.size * 0.055);
	const s0 = g.L * away;
	const s1 = g.L * grow;
	if (s1 - s0 < 0.5) return;
	fillRect(
		options,
		dir > 0 ? g.U0 + s0 : g.U1 - s1,
		barV - width / 2,
		dir > 0 ? g.U0 + s1 : g.U1 - s0,
		barV + width / 2,
		x2Hot(options),
		1,
	);
}

/** テープ剥がし — three strips of tape are slapped over the line, then peeled away one by one. */
function drawTapeOff(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const first = enterBDirection(options, 511);
	const g = frameOf(options, size * 0.14);
	const ex = size * 0.07;
	const tapes = Array.from({ length: 3 }, (_, k) => {
		const lay = oQuart(clamp((progress - k * 0.05) / 0.18));
		const off = ioCubic(clamp((progress - 0.3 - k * 0.13) / 0.42));
		return {
			d: (k % 2 ? -1 : 1) * first,
			lay,
			off,
			s0: (g.L + ex * 2) * off,
			s1: (g.L + ex * 2) * lay,
			v0: g.V0 + (k * g.T) / 3,
			v1: g.V0 + ((k + 1) * g.T) / 3,
			tilt: x2RandomSigned(options, k, 512) * ex * 0.7,
		};
	});
	const u =
		(d: number) =>
		(s: number): number =>
			d > 0 ? g.U0 - ex + s : g.U1 + ex - s;
	clipWhole({
		mask: (ctx) => {
			let any = false;
			for (const tape of tapes) {
				if (tape.lay <= 0) continue;
				const e = tape.lay >= 1 ? g.big : (g.L + ex * 2) * tape.lay - 2;
				const to = u(tape.d);
				const x0 = Math.min(to(-g.big), to(e));
				const x1 = Math.max(to(-g.big), to(e));
				any =
					addRect(
						ctx,
						x0,
						tape.v0 - (tape.v0 === g.V0 ? g.big : 0.4),
						x1,
						tape.v1 + (tape.v1 >= g.V1 - 0.01 ? g.big : 0.4),
					) || any;
			}
			return any;
		},
		options,
	});
	const colors = [x2Hot(options), x2Sub(options), x2Hot(options)];
	for (let k = 0; k < 3; k += 1) {
		const tape = tapes[k]!;
		if (tape.s1 - tape.s0 < 0.5) continue;
		const to = u(tape.d);
		const tv = (s: number): number =>
			tape.tilt * (s / (g.L / 2 + ex) - 1);
		fillPolygon(
			options,
			[
				[to(tape.s0), tape.v0 - ex + tv(tape.s0)],
				[to(tape.s1), tape.v0 - ex + tv(tape.s1)],
				[to(tape.s1), tape.v1 + ex + tv(tape.s1)],
				[to(tape.s0), tape.v1 + ex + tv(tape.s0)],
			],
			colors[k]!,
			1,
		);
	}
}

/** スキャナ — a light bar passes down leaving a hairline outline, then comes back up and fills it in. */
function drawScanner(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const down = ioCubic(progress / 0.46);
	const up = ioCubic((progress - 0.52) / 0.48);
	const g = frameOf(options, size * 0.2);
	const barV = progress < 0.5 ? lerpN(g.V0, g.V1, down) : lerpN(g.V1, g.V0, up);
	// The scanned region keeps only a hairline outline (JIZURA draws it as a pre pass behind the fill).
	{
		const { ctx } = options;
		ctx.save();
		ctx.beginPath();
		if (addRect(ctx, g.U0 - g.big, g.V0 - g.big, g.U1 + g.big, barV)) {
			ctx.clip();
			strokeWhole(
				options,
				options.frame.palette.foreground,
				Math.max(1.2, size * 0.02),
				0.8,
			);
		}
		ctx.restore();
	}
	clipWhole({
		mask: (ctx) =>
			up > 0
				? addRect(ctx, g.U0 - g.big, barV, g.U1 + g.big, g.V1 + g.big)
				: false,
		options,
	});
	const alpha = clamp(progress * 14) * (1 - sstep(0.9, 1, progress));
	const color = x2Hot(options);
	const width = lineW(options);
	const tail = size * 0.22 * (progress < 0.5 ? -1 : 1);
	fillRect(
		options,
		g.U0 - size * 0.2,
		barV - width / 2,
		g.U1 + size * 0.2,
		barV + width / 2,
		color,
		alpha,
	);
	fillRect(
		options,
		g.U0 - size * 0.2,
		Math.min(barV, barV + tail),
		g.U1 + size * 0.2,
		Math.max(barV, barV + tail),
		color,
		alpha * 0.18,
	);
}

/** Whole-line outline stroke behind the fill (JIZURA `OUTLINE` copies). */
// eslint-disable-next-line opencut/prefer-object-params
function strokeWhole(options: X2Draw, color: string, lineWidth: number, alpha: number): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseStroke = ctx.strokeStyle;
	const baseWidth = ctx.lineWidth;
	ctx.save();
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth;
	ctx.textAlign = "center";
	ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.strokeStyle = baseStroke;
	ctx.lineWidth = baseWidth;
}

/** 巻き上げ — a slatted shutter rattles down over the line, then rolls up and uncovers it from the bottom. */
function drawRollerShutter(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const drop = oCubic(progress / 0.2);
	const rise = ioCubic((progress - 0.3) / 0.7);
	const g = frameOf(options, size * 0.2);
	const edge = progress < 0.3 ? lerpN(g.V0, g.V1, drop) : lerpN(g.V1, g.V0, rise);
	clipWhole({
		mask: (ctx) =>
			progress < 0.3
				? addRect(ctx, g.U0, g.V0, g.U1, edge - 2)
				: addRect(ctx, g.U0 - g.big, g.V0 - g.big, g.U1 + g.big, g.V1 + g.big),
		options,
	});
	const v = edge;
	const m = size * 0.1;
	if (v - g.V0 < 0.5) return;
	const color = x2Hot(options);
	const bg = options.frame.palette.background;
	const pitch = Math.max(size * 0.2, g.T / 14);
	const t = Math.max(1.5, size * 0.018);
	fillRect(options, g.U0 - m, g.V0 - 1, g.U1 + m, v, color, 1);
	for (let j = 1; j < 16; j += 1) {
		const y = v - j * pitch;
		if (y <= g.V0) break;
		fillRect(options, g.U0 - m, y - t / 2, g.U1 + m, y + t / 2, bg, 0.4);
	}
	fillRect(
		options,
		g.U0 - m * 1.6,
		v - Math.min(v - g.V0, size * 0.09),
		g.U1 + m * 1.6,
		v,
		options.frame.palette.foreground,
		1,
	);
}

/** 輪郭が先行 — two wipes chase each other: the first leaves only outlines, the second fills them in. */
function drawOutlineLead(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const dir = enterBDirection(options, 601);
	const e1 = ioCubic(progress / 0.7);
	const e2 = ioCubic((progress - 0.3) / 0.7);
	const g = frameOf(options, options.size * 0.2);
	// eslint-disable-next-line opencut/prefer-object-params
	const span = (a: number, z: number): readonly [number, number] => [
		dir > 0 ? g.U0 + a : g.U1 - z,
		dir > 0 ? g.U0 + z : g.U1 - a,
	];
	if (e1 > 0 && e2 < 1) {
		const s2 = span(g.L * e2 - 0.5, e1 >= 1 ? g.big : g.L * e1);
		const { ctx } = options;
		ctx.save();
		ctx.beginPath();
		if (addRect(ctx, s2[0], g.V0 - g.big, s2[1], g.V1 + g.big)) {
			ctx.clip();
			strokeWhole(
				options,
				options.frame.palette.foreground,
				Math.max(1.2, options.size * 0.024),
				1,
			);
		}
		ctx.restore();
	}
	clipWhole({
		mask: (ctx) => {
			if (e2 <= 0) return false;
			const s = span(-g.big, g.L * e2);
			return addRect(ctx, s[0], g.V0 - g.big, s[1], g.V1 + g.big);
		},
		options,
	});
	const width = Math.max(3, options.size * 0.05) / 2;
	const color = x2Hot(options);
	if (e1 > 0 && e1 < 1) {
		const u = dir > 0 ? g.U0 + g.L * e1 : g.U1 - g.L * e1;
		fillRect(options, u - width * 0.5, g.V0, u + width * 0.5, g.V1, color, 0.7);
	}
	if (e2 > 0 && e2 < 1) {
		const u = dir > 0 ? g.U0 + g.L * e2 : g.U1 - g.L * e2;
		fillRect(options, u - width, g.V0, u + width, g.V1, color, 1);
	}
}

/** なぞって流す — the outlines are traced on, then a slanted flood of colour runs through and fills them. */
function drawTraceFlood(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 611);
	const k = 0.5;
	const flood = ioCubic((progress - 0.46) / 0.54);
	const outlineAlpha = 1 - sstep(0.84, 1, progress);
	const g = frameOf(options, size * 0.2);
	const hv = g.T / 2;
	const s = -k * hv + (g.L + 2 * k * hv + 1) * flood;
	const u = (value: number): number => (dir > 0 ? g.U0 + value : g.U1 - value);
	if (outlineAlpha > 0.01) {
		// JIZURA traces the outline as a growing dash; rocut has no dash, so it rides a fade instead.
		strokeWhole(
			options,
			options.frame.palette.foreground,
			Math.max(1.2, size * 0.022),
			outlineAlpha,
		);
	}
	clipWhole({
		mask: (ctx) => {
			if (flood <= 0) return false;
			return addPoly(ctx, [
				[u(-g.big), g.V0],
				[u(s + k * hv), g.V0],
				[u(s - k * hv), g.V1],
				[u(-g.big), g.V1],
			]);
		},
		options,
	});
	if (flood <= 0 || flood >= 1) return;
	const w = size * 0.09;
	fillPolygon(
		options,
		[
			[u(s + k * hv), g.V0],
			[u(s + k * hv + w), g.V0],
			[u(s - k * hv + w), g.V1],
			[u(s - k * hv), g.V1],
		],
		x2Hot(options),
		Math.min(1, flood * 8, (1 - flood) * 8),
	);
}
