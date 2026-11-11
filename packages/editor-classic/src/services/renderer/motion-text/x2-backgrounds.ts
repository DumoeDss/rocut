import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import {
	clamp01,
	degrees,
	inOutCubic,
	lerp,
	mixHex,
	outCubic,
	randomSigned,
	randomUnit,
	secondsOf,
	smooth,
	smoothNoise,
} from "./exit-hold-geometry";
import type {
	MotionTextCanvasContext,
	MotionTextRenderFrame,
} from "./types";
import { x2Hash } from "./x2-drawing";

/**
 * JIZURA 追加分2 pack "x2bg": 40 quiet moving backgrounds — geometric fields,
 * line fields, dot fields, soft shapes, rules and screens.
 *
 * Transliteration notes (same simplifications as the other x2 ports): plan rng
 * fields are derived deterministically from the cut seed, `env.t` is the cut's
 * local seconds, the cross-cut bg run merge behind `bgT` is not modelled (the
 * fade restarts per cut), gradients are approximated by stepped bands because
 * the canvas contract has no gradient ops, and stroked outlines are drawn as
 * segmented rotated rects (house background idiom, no `ctx.stroke`).
 */

const TAU = Math.PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors J.lerp's compact shape.
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress: clamp01(progress) });
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's wrap(v, m).
function wrap(value: number, modulus: number): number {
	return ((value % modulus) + modulus) % modulus;
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors rng.pick(roll over a list).
function pickFrom<T>(list: readonly T[], roll: number): T {
	return list[Math.min(list.length - 1, Math.floor(roll * list.length))]!;
}

/** JIZURA `J.smooth(e0, e1, v)` — smoothstep between two edges. */
// eslint-disable-next-line opencut/prefer-object-params
function smoothR(edge0: number, edge1: number, value: number): number {
	return smooth((value - edge0) / (edge1 - edge0));
}

function unitOf(options: BgcamBackgroundDraw): number {
	return Math.min(options.width, options.height);
}

/** JIZURA `LW(env, k)` — minimum visible stroke width. */
// eslint-disable-next-line opencut/prefer-object-params
function lineWidthOf(options: BgcamBackgroundDraw, k: number): number {
	return Math.max(1.5, unitOf(options) * k);
}

/** JIZURA `fadeIn(env, d)` — the background eases in over its first seconds. */
// eslint-disable-next-line opencut/prefer-object-params
function fadeIn(frame: MotionTextRenderFrame, duration = 0.6): number {
	return outCubic(secondsOf(frame) / duration);
}

function lum(color: string): number {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(color);
	if (!match?.[1]) return 0.5;
	const digits =
		match[1].length === 3
			? Array.from(match[1], (part) => part.repeat(2)).join("")
			: match[1];
	const red = Number.parseInt(digits.slice(0, 2), 16) / 255;
	const green = Number.parseInt(digits.slice(2, 4), 16) / 255;
	const blue = Number.parseInt(digits.slice(4, 6), 16) / 255;
	return 0.299 * red + 0.587 * green + 0.114 * blue;
}

/** JIZURA `lightOf(sc)` — a light colour that still shows on the scheme background. */
function lightOf(options: BgcamBackgroundDraw): string {
	const level = lum(options.frame.palette.background);
	if (level < 0.45) return options.frame.palette.foreground;
	if (level < 0.78) return "#FFFFFF";
	return mixHex({
		from: options.frame.palette.accent,
		to: "#FFFFFF",
		progress: 0.25,
	});
}

function withAlpha({
	alpha,
	ctx,
	draw,
}: {
	readonly alpha: number;
	readonly ctx: MotionTextCanvasContext;
	readonly draw: () => void;
}): void {
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp01(alpha);
	draw();
	ctx.globalAlpha = base;
}

/** A canvas context whose optional path members are present. */
type PathCtx = MotionTextCanvasContext & {
	readonly fill: NonNullable<MotionTextCanvasContext["fill"]>;
	readonly lineTo: NonNullable<MotionTextCanvasContext["lineTo"]>;
	readonly moveTo: NonNullable<MotionTextCanvasContext["moveTo"]>;
};

/** True when the context carries the optional path ops the bg pack draws with. */
function hasPathOps(ctx: MotionTextCanvasContext): ctx is PathCtx {
	return Boolean(ctx.moveTo && ctx.lineTo && ctx.fill);
}

/** Narrowed path context, or null in stripped contexts without path ops. */
function pathCtxOf(ctx: MotionTextCanvasContext): PathCtx | null {
	return hasPathOps(ctx) ? ctx : null;
}

/** JIZURA `A(color, alpha)` — a fill rect in a scheme colour at some alpha. */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's fillRect shape.
function fillRectA(
	ctx: MotionTextCanvasContext,
	x: number,
	y: number,
	w: number,
	h: number,
	color: string,
	alpha: number,
): void {
	if (alpha <= 0.004 || w <= 0 || h <= 0) return;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp01(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
	ctx.globalAlpha = base;
}

/** A stroked line as a rotated rect — the background contract has no stroke op. */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's segment shape.
function lineRect(
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
	if (length <= 0.01 || width <= 0.01 || alpha <= 0.003) return;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.translate(x0, y0);
	ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
	ctx.globalAlpha = base * clamp01(alpha);
	ctx.fillStyle = color;
	ctx.fillRect(0, -width / 2, length, width);
	ctx.restore();
	ctx.globalAlpha = base;
}

// eslint-disable-next-line opencut/prefer-object-params -- Polyline outline via rect segments.
function strokePolyline(
	ctx: MotionTextCanvasContext,
	points: readonly (readonly [number, number])[],
	color: string,
	width: number,
	alpha: number,
): void {
	for (let index = 0; index + 1 < points.length; index += 1) {
		lineRect(
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

// eslint-disable-next-line opencut/prefer-object-params -- Closed polygon outline via rect segments.
function strokePolygon(
	ctx: MotionTextCanvasContext,
	points: readonly (readonly [number, number])[],
	color: string,
	width: number,
	alpha: number,
): void {
	strokePolyline(ctx, points, color, width, alpha);
	if (points.length > 2) {
		lineRect(
			ctx,
			points.at(-1)![0],
			points.at(-1)![1],
			points[0]![0],
			points[0]![1],
			color,
			width,
			alpha,
		);
	}
}

// eslint-disable-next-line opencut/prefer-object-params -- JIZURA polyPath vertices.
function polyPoints(
	cx: number,
	cy: number,
	radius: number,
	sides: number,
	rotation: number,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index < sides; index += 1) {
		const angle = rotation + (index / sides) * TAU;
		points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
	}
	return points;
}

// eslint-disable-next-line opencut/prefer-object-params -- Ellipse outline vertices.
function ellipsePoints(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	segments = 40,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index < segments; index += 1) {
		const angle = (index / segments) * TAU;
		points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
	}
	return points;
}

// eslint-disable-next-line opencut/prefer-object-params -- Adds a vertex chain to the current path.
function addPoints(
	ctx: PathCtx,
	points: readonly (readonly [number, number])[],
): void {
	ctx.moveTo(points[0]![0], points[0]![1]);
	for (const point of points.slice(1)) ctx.lineTo(point[0], point[1]);
}

/** Polygon fill with a bounding-box fallback for stripped contexts. */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus the source pack's path shape.
function pathFillPoly(
	ctx: MotionTextCanvasContext,
	points: readonly (readonly [number, number])[],
	color: string,
	alpha: number,
): void {
	if (points.length < 3 || alpha <= 0.004) return;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp01(alpha);
	ctx.fillStyle = color;
	const p = pathCtxOf(ctx);
	if (p) {
		p.beginPath();
		addPoints(p, points);
		p.closePath?.();
		p.fill();
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
	ctx.globalAlpha = base;
}

/** JIZURA `dot` — a disc added to the current path (arc or decagon). */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's arc-point builder.
function dotPath(
	ctx: PathCtx,
	x: number,
	y: number,
	r: number,
): void {
	if (ctx.arc) {
		ctx.moveTo(x + r, y);
		ctx.arc(x, y, r, 0, TAU);
		return;
	}
	ctx.moveTo(x + r, y);
	for (let index = 1; index <= 10; index += 1) {
		const angle = (index / 10) * TAU;
		ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
	}
}

/** JIZURA `stadium` — capsule outline vertices (rounded ends sampled). */
// eslint-disable-next-line opencut/prefer-object-params
function stadiumPoints(
	x: number,
	y: number,
	w: number,
	h: number,
): (readonly [number, number])[] {
	const r = h / 2;
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index <= 8; index += 1) {
		const angle = -Math.PI / 2 + (index / 8) * Math.PI;
		points.push([x + w - r + Math.cos(angle) * r, y + r + Math.sin(angle) * r]);
	}
	for (let index = 0; index <= 8; index += 1) {
		const angle = Math.PI / 2 + (index / 8) * Math.PI;
		points.push([x + r + Math.cos(angle) * r, y + r + Math.sin(angle) * r]);
	}
	return points;
}

/** JIZURA 1-D value noise `J.noise1(x, seed)`. */
// eslint-disable-next-line opencut/prefer-object-params
function noise1(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

export function drawX2Background(options: BgcamBackgroundDraw): boolean {
	switch (options.frame.cut?.preset.bg) {
		case "xpBigPolygon":
		case "xpBigRing":
		case "xpBlinkCells":
		case "xpCapsules":
		case "xpCornerArcs":
		case "xpCropMarks":
		case "xpCurtain":
		case "xpDepthGrid":
		case "xpDialTicks":
		case "xpDotSheet":
		case "xpDriftBars":
		case "xpDriftMarks":
		case "xpFlowLines":
		case "xpFoldPlanes":
		case "xpGreekText":
		case "xpHorizonLines":
		case "xpLeanVignette":
		case "xpLissajous":
		case "xpLoadBars":
		case "xpMarchDash":
		case "xpNestTri":
		case "xpOrbits":
		case "xpPanels":
		case "xpPendulums":
		case "xpPhyllo":
		case "xpPlexus":
		case "xpPlusField":
		case "xpPosterGrad":
		case "xpRadar":
		case "xpRingDots":
		case "xpRuler":
		case "xpScanner":
		case "xpSevenSeg":
		case "xpShiftRows":
		case "xpSineWeave":
		case "xpSlitLight":
		case "xpStepBlocks":
		case "xpStringArt":
		case "xpTwinDiscs":
		case "xpWindStreaks":
			drawX2BackgroundPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2BackgroundPart(options: BgcamBackgroundDraw): void {
	const preset = options.frame.cut?.preset.bg;
	switch (preset) {
		case "xpBigPolygon":
			drawBigPolygon(options);
			return;
		case "xpBigRing":
			drawBigRing(options);
			return;
		case "xpBlinkCells":
			drawBlinkCells(options);
			return;
		case "xpCapsules":
			drawCapsules(options);
			return;
		case "xpCornerArcs":
			drawCornerArcs(options);
			return;
		case "xpCropMarks":
			drawCropMarks(options);
			return;
		case "xpCurtain":
			drawCurtain(options);
			return;
		case "xpDepthGrid":
			drawDepthGrid(options);
			return;
		case "xpDialTicks":
			drawDialTicks(options);
			return;
		case "xpDotSheet":
			drawDotSheet(options);
			return;
		case "xpDriftBars":
			drawDriftBars(options);
			return;
		case "xpDriftMarks":
			drawDriftMarks(options);
			return;
		case "xpFlowLines":
			drawFlowLines(options);
			return;
		case "xpFoldPlanes":
			drawFoldPlanes(options);
			return;
		case "xpGreekText":
			drawGreekText(options);
			return;
		case "xpHorizonLines":
			drawHorizonLines(options);
			return;
		case "xpLeanVignette":
			drawLeanVignette(options);
			return;
		case "xpLissajous":
			drawLissajous(options);
			return;
		case "xpLoadBars":
			drawLoadBars(options);
			return;
		case "xpMarchDash":
			drawMarchDash(options);
			return;
		case "xpNestTri":
			drawNestTri(options);
			return;
		case "xpOrbits":
			drawOrbits(options);
			return;
		case "xpPanels":
			drawPanels(options);
			return;
		case "xpPendulums":
			drawPendulums(options);
			return;
		case "xpPhyllo":
			drawPhyllo(options);
			return;
		case "xpPlexus":
			drawPlexus(options);
			return;
		case "xpPlusField":
			drawPlusField(options);
			return;
		case "xpPosterGrad":
			drawPosterGrad(options);
			return;
		case "xpRadar":
			drawRadar(options);
			return;
		case "xpRingDots":
			drawRingDots(options);
			return;
		case "xpRuler":
			drawRuler(options);
			return;
		case "xpScanner":
			drawScanner(options);
			return;
		case "xpSevenSeg":
			drawSevenSeg(options);
			return;
		case "xpShiftRows":
			drawShiftRows(options);
			return;
		case "xpSineWeave":
			drawSineWeave(options);
			return;
		case "xpSlitLight":
			drawSlitLight(options);
			return;
		case "xpStepBlocks":
			drawStepBlocks(options);
			return;
		case "xpStringArt":
			drawStringArt(options);
			return;
		case "xpTwinDiscs":
			drawTwinDiscs(options);
			return;
		case "xpWindStreaks":
			drawWindStreaks(options);
			return;
		default:
			return;
	}
}

/** 漂う帯 — soft bars drifting sideways at their own speeds. */
function drawDriftBars(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const vert = randomUnit(s, 601_002) < 0.7;
	const L = vert ? W : H;
	const n = 5 + Math.floor(randomUnit(s, 601_001) * 3);
	const k = 0.045 + randomUnit(s, 601_003) * 0.015;
	for (let i = 0; i < n; i += 1) {
		const w = L * (0.07 + 0.2 * randomUnit(s, i, 1));
		const v =
			(0.012 + 0.028 * randomUnit(s, i, 2)) *
			(randomUnit(s, i, 3) < 0.5 ? -1 : 1);
		const x = wrap(randomUnit(s, i, 4) * (L + w) + t * v * L, L + w) - w;
		fillRectA(
			ctx,
			vert ? x : 0,
			vert ? 0 : x,
			vert ? w : W,
			vert ? H : w,
			i === 1 ? sc.accent : sc.foreground,
			fade * (i === 1 ? k * 1.1 : k * (0.6 + 0.8 * randomUnit(s, i, 5))),
		);
	}
}

/** 回る多角形 — nested polygons counter-rotating around one side of the frame. */
function drawBigPolygon(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.8);
	const sides = pickFrom([3, 5, 6, 8], randomUnit(s, 602_001));
	const cxP = pickFrom([0.26, 0.74, 0.5], randomUnit(s, 602_002));
	const cyP = pickFrom([0.42, 0.58], randomUnit(s, 602_003));
	const spd =
		(1.5 + randomUnit(s, 602_004) * 1.7) *
		(randomUnit(s, 602_005) < 0.5 ? -1 : 1);
	const k = 0.04 + randomUnit(s, 602_006) * 0.015;
	const cx = W * cxP;
	const cy = H * cyP;
	const R = U * 0.8 * (0.86 + 0.14 * e);
	const rot = t * spd * degrees(1) + degrees(s % 60);
	pathFillPoly(
		ctx,
		polyPoints(cx, cy, R, sides, rot),
		sc.foreground,
		e * k,
	);
	pathFillPoly(
		ctx,
		polyPoints(cx, cy, R * 0.58, sides, -rot * 1.4),
		sc.foreground,
		e * k * 0.8,
	);
	strokePolygon(
		ctx,
		polyPoints(cx, cy, R * 1.24, sides, rot * 0.6),
		sc.foreground,
		lineWidthOf(options, 0.003),
		e * k * 2.2,
	);
}

/** ずれる段 — rows of blocks that shuffle sideways in alternating directions. */
function drawShiftRows(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const ar = 2.2 + randomUnit(s, 603_001) * 1.2;
	const spd = 0.05 + randomUnit(s, 603_002) * 0.05;
	const k = 0.035 + randomUnit(s, 603_003) * 0.015;
	const rh = U * 0.105;
	const bw = rh * ar;
	const rows = Math.min(24, Math.ceil(H / rh));
	for (let j = 0; j < rows; j += 1) {
		const off = wrap(
			t * bw * spd * (j % 2 ? -1 : 1) * (0.5 + randomUnit(s, j)) +
				randomUnit(s, j, 2) * bw * 2,
			bw * 2,
		);
		for (let x = off - bw * 2, c = 0; x < W && c < 14; x += bw * 2, c += 1) {
			fillRectA(ctx, x, j * rh, bw, rh, sc.foreground, fade * k);
		}
	}
}

/** ねじれ三角 — nested triangles whose twist breathes as they turn. */
function drawNestTri(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.8);
	const sides = pickFrom([3, 3, 5], randomUnit(s, 604_001));
	const cy = H * pickFrom([0.5, 0.56], randomUnit(s, 604_002));
	const k = 0.085 + randomUnit(s, 604_003) * 0.025;
	const width = lineWidthOf(options, 0.005);
	for (let i = 0; i < 8; i += 1) {
		const R =
			U *
			(0.14 + i * 0.17) *
			(1 + 0.05 * Math.sin(t * 0.5 - i * 0.6)) *
			(0.7 + 0.3 * e);
		strokePolygon(
			ctx,
			polyPoints(
				W / 2,
				cy,
				R,
				sides,
				-Math.PI / 2 + Math.sin(t * 0.22 - i * 0.38) * degrees(28),
			),
			sc.foreground,
			width,
			e * k,
		);
	}
}

/** 角の扇 — fans of arcs breathing out of two opposite corners. */
function drawCornerArcs(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.8);
	const diag = randomUnit(s, 605_001) < 0.5;
	const k = 0.045 + randomUnit(s, 605_002) * 0.015;
	const corners = diag
		? ([[0, 0], [W, H]] as const)
		: ([[W, 0], [0, H]] as const);
	for (let c = 0; c < 2; c += 1) {
		for (let i = 0; i < 5; i += 1) {
			const r =
				U *
				(0.2 + 0.19 * i) *
				(1 + 0.07 * Math.sin(t * 0.5 - i * 0.7 + c * 2.2)) *
				(0.6 + 0.4 * e);
			strokePolygon(
				ctx,
				ellipsePoints(corners[c]![0], corners[c]![1], r, r, 40),
				c === 1 && i === 1 ? sc.accent : sc.foreground,
				U * 0.085 * (1 - i * 0.1),
				e * k * (1 - i * 0.14),
			);
		}
	}
}

/** 動く仕切り — two sliding partitions reorganise the frame's lower corner. */
function drawPanels(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const flip = randomUnit(s, 606_001) < 0.5;
	const flipY = randomUnit(s, 606_002) < 0.5;
	const k = 0.03 + randomUnit(s, 606_003) * 0.012;
	ctx.save();
	if (flip) {
		ctx.translate(W, 0);
		ctx.scale(-1, 1);
	}
	if (flipY) {
		ctx.translate(0, H);
		ctx.scale(1, -1);
	}
	const s9 = s % 9;
	const x1 = W * (0.36 + 0.07 * Math.sin(t * 0.21 + s9));
	const y1 = H * (0.42 + 0.09 * Math.sin(t * 0.17 + s9 * 2));
	const x2 = x1 + (W - x1) * (0.5 + 0.18 * Math.sin(t * 0.13 + s9 * 3));
	fillRectA(ctx, x1, 0, W - x1, y1, sc.foreground, fade * k);
	fillRectA(ctx, x1, y1, x2 - x1, H - y1, sc.accent, fade * k * 1.3);
	fillRectA(ctx, x2, y1, W - x2, H - y1, sc.foreground, fade * k * 2);
	const lw = lineWidthOf(options, 0.003);
	fillRectA(ctx, x1 - lw / 2, 0, lw, H, sc.foreground, fade * 0.13);
	fillRectA(ctx, x1, y1 - lw / 2, W - x1, lw, sc.foreground, fade * 0.13);
	fillRectA(ctx, x2 - lw / 2, y1, lw, H - y1, sc.foreground, fade * 0.13);
	ctx.restore();
}

/** 回る十字 — a field of crosses slowly turning in a travelling wave. */
function drawPlusField(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const sp = U * (0.11 + randomUnit(s, 607_001) * 0.03);
	const arm = sp * 0.17;
	const k = 0.1 + randomUnit(s, 607_002) * 0.03;
	const nx = Math.min(30, Math.ceil(W / sp) + 1);
	const ny = Math.min(30, Math.ceil(H / sp) + 1);
	const ox = (W - (nx - 1) * sp) / 2;
	const oy = (H - (ny - 1) * sp) / 2;
	const width = lineWidthOf(options, 0.0035);
	for (let j = 0; j < ny; j += 1) {
		for (let i = 0; i < nx; i += 1) {
			const x = ox + i * sp;
			const y = oy + j * sp;
			const a =
				inOutCubic(0.5 + 0.5 * Math.sin(t * 0.7 - i * 0.42 - j * 0.3)) *
				(Math.PI / 2);
			const c = Math.cos(a) * arm;
			const d = Math.sin(a) * arm;
			lineRect(ctx, x - c, y - d, x + c, y + d, sc.foreground, width, fade * k);
			lineRect(ctx, x + d, y - c, x - d, y + c, sc.foreground, width, fade * k);
		}
	}
}

/** 折り重なる面 — translucent folded planes drifting on soft noise. */
function drawFoldPlanes(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame, 0.8);
	const k = 0.035 + randomUnit(s, 608_001) * 0.015;
	for (let i = 0; i < 4; i += 1) {
		const points: (readonly [number, number])[] = [];
		for (let j = 0; j < 3; j += 1) {
			const a = TAU * (randomUnit(s, i, j) * 0.25 + j / 3 + i * 0.13);
			const rd = 0.5 + 0.4 * randomUnit(s, i, j, 2);
			points.push([
				W *
					(0.5 +
						Math.cos(a) * rd +
						0.14 * noise1(t * 0.07 + j * 3.1, s + i * 7 + j)),
				H *
					(0.5 +
						Math.sin(a) * rd +
						0.14 * noise1(t * 0.06 + j * 5.3, s + i * 11 + j + 40)),
			]);
		}
		pathFillPoly(
			ctx,
			points,
			i === 2 ? sc.accent : sc.foreground,
			fade * k,
		);
		strokePolygon(
			ctx,
			points,
			sc.foreground,
			lineWidthOf(options, 0.002),
			fade * k * 1.6,
		);
	}
}

/** 流れる線 — long soft lines flowing on layered value noise. */
function drawFlowLines(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const n = 16 + Math.floor(randomUnit(s, 609_001) * 9);
	const hz = randomUnit(s, 609_002) < 0.35;
	const k = 0.13 + randomUnit(s, 609_003) * 0.03;
	const L = hz ? W : H;
	const X = hz ? H : W;
	const amp = X * 0.075;
	const ST = 26;
	const width = lineWidthOf(options, 0.0022);
	for (let i = -1; i <= n; i += 1) {
		const base = ((i + 0.5) / n) * X;
		const points: (readonly [number, number])[] = [];
		for (let q = 0; q <= ST; q += 1) {
			const u = q / ST;
			const v =
				base +
				amp *
					(noise1(u * 2.2 + t * 0.12 + i * 0.09, s) +
						0.5 * noise1(u * 5 - t * 0.2 + i * 0.05, s + 9));
			const a = u * L;
			points.push(hz ? [a, v] : [v, a]);
		}
		strokePolyline(ctx, points, sc.foreground, width, fade * k);
	}
}

/** 遠近の横線 — rules receding to a horizon that sways almost imperceptibly. */
function drawHorizonLines(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame);
	const n = 9;
	const k = 0.085 + randomUnit(s, 610_003) * 0.025;
	const spd = 0.035 + randomUnit(s, 610_002) * 0.025;
	const y0 = H * (pickFrom([0.5, 0.42, 0.6], randomUnit(s, 610_001)) + 0.04 * Math.sin(t * 0.19));
	for (let i = 0; i < n; i += 1) {
		const p = wrap(i / n + t * spd, 1);
		const d = H * 0.66 * p ** 2.3;
		const lw = Math.max(1.5, U * 0.011 * p);
		const alpha = k * Math.min(1, p * 4) * (1 - smoothR(0.8, 1, p));
		fillRectA(ctx, 0, y0 + d - lw / 2, W, lw, sc.foreground, e * alpha);
		fillRectA(ctx, 0, y0 - d - lw / 2, W, lw, sc.foreground, e * alpha);
	}
	fillRectA(
		ctx,
		W * 0.5 * (1 - e),
		y0 - 1,
		W * e,
		2,
		sc.accent,
		e * 0.22,
	);
}

/** 目盛りの輪 — dial tick rings geared at different speeds. */
function drawDialTicks(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.8);
	const cx = W * pickFrom([0.5, 0.5, 0.18, 0.82], randomUnit(s, 611_001));
	const cy = H * pickFrom([0.5, 0.5, 0.62], randomUnit(s, 611_002));
	const spd =
		(1.5 + randomUnit(s, 611_003) * 1.5) *
		(randomUnit(s, 611_004) < 0.5 ? -1 : 1);
	const k = 0.17 + randomUnit(s, 611_005) * 0.04;
	const NS = [48, 72, 120, 180];
	const RS = [0.3, 0.47, 0.7, 1.02];
	const SP = [1, -0.6, 0.35, -0.2];
	const width = lineWidthOf(options, 0.0034);
	for (let r = 0; r < 4; r += 1) {
		const N = NS[r]!;
		const R = U * RS[r]! * (0.85 + 0.15 * e);
		const rot = t * spd * SP[r]! * degrees(1);
		for (let i = 0; i < N; i += 1) {
			const a = rot + (i / N) * TAU;
			const c = Math.cos(a);
			const d = Math.sin(a);
			const len = U * (i % 6 ? 0.016 : 0.04);
			lineRect(
				ctx,
				cx + c * R,
				cy + d * R,
				cx + c * (R + len),
				cy + d * (R + len),
				sc.foreground,
				width,
				e * k,
			);
		}
	}
}

/** 編む波線 — sine threads braiding across each other band by band. */
function drawSineWeave(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const nb = H > W ? 5 : 3;
	const amp = (H / nb) * 0.3;
	const ST = 44;
	const k = 0.12 + randomUnit(s, 612_001) * 0.03;
	const spd = 0.25 + randomUnit(s, 612_002) * 0.2;
	const width = lineWidthOf(options, 0.0035);
	for (let b = 0; b < nb; b += 1) {
		const cy = (H * (b + 0.5)) / nb;
		const kx = TAU * (1.3 + 1.2 * randomUnit(s, b));
		const ph =
			randomUnit(s, b, 2) * TAU + t * spd * (b % 2 ? -1 : 1);
		for (let sg = -1; sg <= 1; sg += 2) {
			const points: (readonly [number, number])[] = [];
			for (let q = 0; q <= ST; q += 1) {
				const u = q / ST;
				points.push([
					u * W,
					cy +
						sg *
							amp *
							Math.sin(u * kx + ph) *
							(0.75 + 0.25 * Math.sin(u * 3.1 + t * 0.2 + b)),
				]);
			}
			strokePolyline(ctx, points, sc.foreground, width, fade * k);
		}
	}
}

/** リサージュ — two Lissajous curves drawing themselves in, phase shifted. */
function drawLissajous(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const e = fadeIn(options.frame, 1);
	const ab = pickFrom(
		[
			[3, 2],
			[5, 4],
			[3, 4],
			[5, 3],
			[2, 1],
		] as const,
		randomUnit(s, 613_001),
	);
	const N = 260;
	const k = 0.14 + randomUnit(s, 613_003) * 0.03;
	const spd = 0.08 + randomUnit(s, 613_002) * 0.06;
	const cx = W / 2;
	const cy = H / 2;
	const rx = W * 0.46;
	const ry = H * 0.44;
	const width = lineWidthOf(options, 0.0026);
	for (let c = 0; c < 2; c += 1) {
		const dl = t * spd - c * 0.35 + (s % 6);
		const points: (readonly [number, number])[] = [];
		for (let i = 0; i <= N * e; i += 1) {
			const th = (i / N) * TAU;
			points.push([
				cx + rx * Math.sin(ab[0] * th + dl),
				cy + ry * Math.sin(ab[1] * th),
			]);
		}
		strokePolyline(
			ctx,
			points,
			sc.foreground,
			width,
			e * k * (c ? 0.45 : 1),
		);
	}
}

/** 振り子の糸 — pendulum strings of random lengths, each with its own period. */
function drawPendulums(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const n = Math.min(18, Math.round(W / (U * 0.14)));
	const k = 0.15 + randomUnit(s, 614_001) * 0.04;
	const amp = 5 + randomUnit(s, 614_002) * 4;
	const width = lineWidthOf(options, 0.002);
	const dots: { r: number; x: number; y: number }[] = [];
	for (let i = 0; i < n; i += 1) {
		const x = (W * (i + 0.5 + 0.3 * randomSigned(s, i, 1))) / n;
		const L = H * (0.28 + 0.55 * randomUnit(s, i, 2)) * e;
		const a =
			amp *
			degrees(1) *
			Math.sin(t * (0.9 / Math.sqrt(0.3 + L / H)) + randomUnit(s, i, 3) * TAU);
		const ex = x + Math.sin(a) * L;
		const ey = Math.cos(a) * L;
		lineRect(ctx, x, 0, ex, ey, sc.foreground, width, e * k);
		dots.push({ r: U * (0.008 + 0.01 * randomUnit(s, i, 4)), x: ex, y: ey });
	}
	const p = pathCtxOf(ctx);
	if (p) {
		withAlpha({ alpha: e * k * 1.3, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			for (const dot of dots) dotPath(p, dot.x, dot.y, dot.r);
			p.fill();
		} });
	}
}

/** 軌道 — tilted orbits with planets that never quite align. */
function drawOrbits(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const k = 0.15 + randomUnit(s, 615_004) * 0.04;
	const big = Math.max(W, H);
	const tilt = -28 + randomUnit(s, 615_001) * 56;
	const spd = 0.25 + randomUnit(s, 615_003) * 0.15;
	ctx.save();
	ctx.translate(W * pickFrom([0.5, 0.36, 0.64], randomUnit(s, 615_002)), H * 0.5);
	ctx.rotate(degrees(tilt) + (H > W ? degrees(90) : 0));
	const width = lineWidthOf(options, 0.002);
	const planets: { r: number; x: number; y: number }[] = [];
	for (let i = 0; i < 5; i += 1) {
		const rx = big * (0.16 + 0.13 * i) * (0.8 + 0.2 * e);
		const ry = rx * 0.36;
		const a =
			((t * spd) / (0.6 + i * 0.5)) * (i % 2 ? -1 : 1) +
			randomUnit(s, i) * TAU;
		strokePolygon(
			ctx,
			ellipsePoints(0, 0, rx, ry, 44),
			sc.foreground,
			width,
			e * k,
		);
		planets.push({
			r: U * (0.009 + 0.008 * randomUnit(s, i, 2)),
			x: Math.cos(a) * rx,
			y: Math.sin(a) * ry,
		});
	}
	const p = pathCtxOf(ctx);
	if (p) {
		withAlpha({ alpha: e * k * 0.6, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			dotPath(p, 0, 0, U * 0.035);
			p.fill();
		} });
		withAlpha({ alpha: e * 0.45, ctx: p, draw: () => {
			p.fillStyle = sc.accent;
			p.beginPath();
			for (const planet of planets) dotPath(p, planet.x, planet.y, planet.r);
			p.fill();
		} });
	}
	ctx.restore();
}

/** 流れる破線 — dashed rules marching at their own speeds and directions. */
function drawMarchDash(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const n = 9 + Math.floor(randomUnit(s, 616_001) * 5);
	const spd = 0.03 + randomUnit(s, 616_002) * 0.03;
	const k = 0.1 + randomUnit(s, 616_003) * 0.03;
	const width = lineWidthOf(options, 0.005);
	for (let i = 0; i < n; i += 1) {
		const y = (H * (i + 0.5)) / n;
		const d = U * (0.04 + 0.24 * randomUnit(s, i));
		const g = d * (0.5 + randomUnit(s, i, 2));
		const offset =
			-t *
			U *
			spd *
			(i % 2 ? -1 : 1) *
			(0.5 + 1.5 * randomUnit(s, i, 3)) +
			randomUnit(s, i, 4) * (d + g);
		const color = i === s % n ? sc.accent : sc.foreground;
		const alpha = fade * k * (0.7 + 0.7 * randomUnit(s, i, 5));
		for (let x = wrap(offset, d + g) - (d + g); x < W; x += d + g) {
			lineRect(ctx, x, y, Math.min(x + d, W), y, color, width, alpha);
		}
	}
}

/** 迫る方眼 — a perspective grid rushing at the camera in three depth layers. */
function drawDepthGrid(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const base = U * 0.1;
	const cx = W / 2;
	const cy = H / 2;
	const e = fadeIn(options.frame);
	const spd = 0.035 + randomUnit(s, 617_001) * 0.025;
	const k = 0.1 + randomUnit(s, 617_002) * 0.03;
	for (let l = 0; l < 3; l += 1) {
		const p = wrap(t * spd + l / 3, 1);
		const cell = base * 2 ** p;
		const lw = Math.max(1.2, U * 0.0016 * (1 + p));
		const nx = Math.min(16, Math.ceil(cx / cell));
		const ny = Math.min(16, Math.ceil(cy / cell));
		const alpha = e * k * Math.sin(Math.PI * p);
		for (let i = -nx; i <= nx; i += 1) {
			fillRectA(
				ctx,
				cx + (i + 0.5) * cell - lw / 2,
				0,
				lw,
				H,
				sc.foreground,
				alpha,
			);
		}
		for (let j = -ny; j <= ny; j += 1) {
			fillRectA(
				ctx,
				0,
				cy + (j + 0.5) * cell - lw / 2,
				W,
				lw,
				sc.foreground,
				alpha,
			);
		}
	}
}

/** 糸の曲線 — string-art envelopes strung between two opposing corners. */
function drawStringArt(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const e = fadeIn(options.frame, 0.9);
	const N = 22;
	const spd = 0.04 + randomUnit(s, 618_002) * 0.03;
	const fr = wrap(t * spd, 1);
	const k = 0.1 + randomUnit(s, 618_003) * 0.03;
	const corners = (
		randomUnit(s, 618_001) < 0.5
			? ([[0, 0, 1, 1], [W, H, -1, -1]] as const)
			: ([[W, 0, -1, 1], [0, H, 1, -1]] as const)
	);
	const width = lineWidthOf(options, 0.0018);
	for (let c = 0; c < 2; c += 1) {
		const [x0, y0, dx, dy] = corners[c]!;
		const Lx = W * 0.85 * e;
		const Ly = H * 0.85 * e;
		for (let i = 0; i < N; i += 1) {
			const u = (i + (c ? 1 - fr : fr)) / N;
			lineRect(
				ctx,
				x0,
				y0 + dy * Ly * (1 - u),
				x0 + dx * Lx * u,
				y0,
				sc.foreground,
				width,
				e * k,
			);
		}
	}
}

/** 波打つ点の面 — a sheet of dots waving like water seen from a bridge. */
function drawDotSheet(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const cols = 26;
	const rows = 12;
	const fade = fadeIn(options.frame);
	const k = 0.16 + randomUnit(s, 619_002) * 0.04;
	ctx.save();
	if (randomUnit(s, 619_001) < 0.3) {
		ctx.translate(0, H);
		ctx.scale(1, -1);
	}
	const p = pathCtxOf(ctx);
	if (p) {
		withAlpha({ alpha: fade * k, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			for (let j = 0; j < rows; j += 1) {
				const near = 1 - j / (rows - 1);
				const yb = H * (0.4 + 0.58 * near ** 1.7);
				const sz = 0.4 + 0.6 * near;
				for (let i = 0; i < cols; i += 1) {
					const h =
						Math.sin(i * 0.45 + t * 0.9 + j * 0.2) *
						Math.cos(j * 0.6 - t * 0.5);
					dotPath(
						p,
						W * (-0.06 + (1.12 * i) / (cols - 1)) + U * 0.02 * j,
						yb - h * U * 0.04 * sz,
						U * 0.0065 * sz * (1 + 0.45 * h),
					);
				}
			}
			p.fill();
		} });
	}
	ctx.restore();
}

/** 風の筋 — fine streaks of wind crossing the frame on a slight slant. */
function drawWindStreaks(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const D = Math.hypot(W, H);
	const fade = fadeIn(options.frame);
	const k = 0.17 + randomUnit(s, 620_004) * 0.04;
	const ang = -10 + randomUnit(s, 620_001) * 20;
	const dir = randomUnit(s, 620_002) < 0.5 ? -1 : 1;
	const spd = 0.05 + randomUnit(s, 620_003) * 0.04;
	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.rotate(degrees(ang));
	for (let b = 0; b < 3; b += 1) {
		const d = (b + 1) / 3;
		const width = Math.max(1.2, U * 0.0018 * (1 + d * 1.4));
		const alpha = fade * k * (0.45 + 0.55 * d);
		for (let i = 0; i < 14; i += 1) {
			const len = U * (0.05 + 0.16 * d) * (0.6 + 0.8 * randomUnit(s, b, i, 1));
			const x =
				wrap(
					randomUnit(s, b, i, 2) * (D + len) +
						dir * t * D * spd * (0.4 + d),
					D + len,
				) -
				D / 2 -
				len;
			const y =
				(randomUnit(s, b, i, 3) - 0.5) * D +
				U * 0.012 * Math.sin(t * 0.8 + i);
			lineRect(ctx, x, y, x + len, y, sc.foreground, width, alpha);
		}
	}
	ctx.restore();
}

/** 点と線の網 — a drifting node network linked by brightness-graded threads. */
function drawPlexus(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const n = Math.min(28, 20 + Math.floor(randomUnit(s, 621_001) * 7));
	const D = Math.max(W, H) * 0.24;
	const k = 0.2 + randomUnit(s, 621_002) * 0.05;
	const xs: number[] = [];
	const ys: number[] = [];
	for (let i = 0; i < n; i += 1) {
		xs.push(
			W * (randomUnit(s, i, 1) * 1.1 - 0.05) +
				U *
					0.07 *
					Math.sin(
						t * (0.15 + 0.2 * randomUnit(s, i, 3)) +
							randomUnit(s, i, 4) * TAU,
					),
		);
		ys.push(
			H * (randomUnit(s, i, 2) * 1.1 - 0.05) +
				U *
					0.07 *
					Math.cos(
						t * (0.13 + 0.2 * randomUnit(s, i, 5)) +
							randomUnit(s, i, 6) * TAU,
					),
		);
	}
	const width = lineWidthOf(options, 0.0018);
	for (let b = 0; b < 3; b += 1) {
		const alpha = fade * ((k * (b + 1)) / 3);
		for (let i = 0; i < n; i += 1) {
			for (let j = i + 1; j < n; j += 1) {
				const d = Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!);
				if (d >= D) continue;
				if (Math.min(2, Math.floor((1 - d / D) * 3)) === b) {
					lineRect(
						ctx,
						xs[i]!,
						ys[i]!,
						xs[j]!,
						ys[j]!,
						sc.foreground,
						width,
						alpha,
					);
				}
			}
		}
	}
	const p = pathCtxOf(ctx);
	if (p) {
		withAlpha({ alpha: fade * k * 1.5, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			for (let i = 0; i < n; i += 1) dotPath(p, xs[i]!, ys[i]!, U * 0.005);
			p.fill();
		} });
	}
}

/** 螺旋の点 — a phyllotaxis spiral of dots pulsing outward. */
function drawPhyllo(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const N = 380;
	const cx =
		W * pickFrom([0.5, 0.5, 0.2, 0.8], randomUnit(s, 622_001));
	const cy = H * pickFrom([0.5, 0.5, 0.7], randomUnit(s, 622_002));
	const spd =
		(1.2 + randomUnit(s, 622_003) * 1.2) *
		(randomUnit(s, 622_004) < 0.5 ? -1 : 1);
	const k = 0.13 + randomUnit(s, 622_005) * 0.03;
	const c = (Math.hypot(W, H) * 0.72) / Math.sqrt(N);
	const rot = t * spd * degrees(1);
	const GA = degrees(137.508);
	const p = pathCtxOf(ctx);
	if (!p) return;
	withAlpha({ alpha: e * k, ctx: p, draw: () => {
		p.fillStyle = sc.foreground;
		p.beginPath();
		for (let i = 1; i < N * e; i += 1) {
			const q = Math.sqrt(i);
			const r = c * q;
			const a = i * GA + rot;
			const x = cx + Math.cos(a) * r;
			const y = cy + Math.sin(a) * r;
			if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
			dotPath(p, x, y, U * 0.0095 * (0.75 + 0.45 * Math.sin(t * 0.8 - q * 0.6)));
		}
		p.fill();
	} });
}

/** 明滅タイル — tiles blinking on and off in soft noise weather. */
function drawBlinkCells(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const cell = U * (0.085 + randomUnit(s, 623_001) * 0.025);
	const gap = cell * 0.06;
	const k = 0.08 + randomUnit(s, 623_002) * 0.02;
	const nx = Math.min(28, Math.ceil(W / cell));
	const ny = Math.min(28, Math.ceil(H / cell));
	const ox = (W - nx * cell) / 2;
	const oy = (H - ny * cell) / 2;
	const buckets: [number, number][][] = [[], [], []];
	for (let j = 0; j < ny; j += 1) {
		for (let i = 0; i < nx; i += 1) {
			const v =
				noise1(
					t * 0.45 + randomUnit(s, i, j) * 60,
					(s + i * 31 + j * 17) % 9973,
				) - 0.3;
			if (v > 0) {
				buckets[Math.min(2, Math.floor(v * 6))]!.push([
					ox + i * cell + gap,
					oy + j * cell + gap,
				]);
			}
		}
	}
	for (let b = 0; b < 3; b += 1) {
		for (const [x, y] of buckets[b]!) {
			fillRectA(
				ctx,
				x,
				y,
				cell - gap * 2,
				cell - gap * 2,
				sc.foreground,
				fade * ((k * (b + 1)) / 3),
			);
		}
	}
}

/** 漂う記号 — stray marks (dots, crosses, small polys) drifting and turning. */
function drawDriftMarks(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const n = Math.min(24, 14 + Math.floor(randomUnit(s, 624_001) * 7));
	const M = U * 0.1;
	const k = 0.16 + randomUnit(s, 624_002) * 0.04;
	const width = lineWidthOf(options, 0.003);
	const dots: { r: number; x: number; y: number }[] = [];
	for (let i = 0; i < n; i += 1) {
		const r = U * (0.018 + 0.03 * randomUnit(s, i, 1));
		const x =
			wrap(
				randomUnit(s, i, 2) * (W + M * 2) +
					t * U * 0.02 * randomSigned(s, i, 3),
				W + M * 2,
			) - M;
		const y =
			wrap(
				randomUnit(s, i, 4) * (H + M * 2) +
					t * U * 0.014 * randomSigned(s, i, 5),
				H + M * 2,
			) - M;
		const a =
			t * 0.3 * (randomUnit(s, i, 6) * 2 - 1) + randomUnit(s, i, 7) * TAU;
		const ty = x2Hash(s, i, 8) % 4;
		if (ty === 0) {
			dots.push({ r, x, y });
		} else if (ty === 1) {
			const c = Math.cos(a) * r;
			const d = Math.sin(a) * r;
			lineRect(ctx, x - c, y - d, x + c, y + d, sc.foreground, width, fade * k);
			lineRect(ctx, x + d, y - c, x - d, y + c, sc.foreground, width, fade * k);
		} else {
			strokePolygon(
				ctx,
				polyPoints(x, y, r * 1.15, ty === 2 ? 3 : 4, a),
				sc.foreground,
				width,
				fade * k,
			);
		}
	}
	const p = pathCtxOf(ctx);
	if (dots.length > 0 && p) {
		withAlpha({ alpha: fade * k, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			for (const dot of dots) dotPath(p, dot.x, dot.y, dot.r);
			p.fill();
		} });
	}
}

/** 巡る点の輪 — rings of dots circling at alternating speeds. */
function drawRingDots(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const cx = W / 2;
	const cy = H * pickFrom([0.5, 0.5, 0.6], randomUnit(s, 625_003));
	const rings = Math.min(
		9,
		Math.ceil(Math.hypot(W, H) / 2 / (U * 0.135)),
	);
	const spd =
		(5 + randomUnit(s, 625_001) * 4) *
		(randomUnit(s, 625_002) < 0.5 ? -1 : 1);
	const k = 0.14 + randomUnit(s, 625_004) * 0.03;
	const p = pathCtxOf(ctx);
	if (!p) return;
	withAlpha({ alpha: e * k, ctx: p, draw: () => {
		p.fillStyle = sc.foreground;
		p.beginPath();
		for (let r = 0; r < rings; r += 1) {
			const R = U * (0.16 + 0.135 * r) * (0.8 + 0.2 * e);
			const N = 8 + r * 8;
			const rot =
				((t * spd * degrees(1)) / (1 + r * 0.6)) * (r % 2 ? -1 : 1);
			for (let i = 0; i < N; i += 1) {
				const a = rot + (i / N) * TAU;
				dotPath(
					p,
					cx + Math.cos(a) * R,
					cy + Math.sin(a) * R,
					U * (i % 4 ? 0.0055 : 0.01),
				);
			}
		}
		p.fill();
	} });
}

/** 重なる円 — two big soft discs swaying around each other. */
function drawTwinDiscs(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const k = 0.04 + randomUnit(s, 626_001) * 0.015;
	const ph = randomUnit(s, 626_002) * 6;
	const R = U * 0.56 * (0.8 + 0.2 * e);
	const v = H > W;
	const a = 0.2 + 0.07 * Math.sin(t * 0.21 + ph);
	const b = 0.09 * Math.cos(t * 0.17 + ph);
	const p = pathCtxOf(ctx);
	if (!p) return;
	withAlpha({ alpha: e * k, ctx: p, draw: () => {
		p.fillStyle = sc.foreground;
		p.beginPath();
		dotPath(p, W * (0.5 - (v ? b : a)), H * (0.5 - (v ? a : b)), R);
		p.fill();
	} });
	withAlpha({ alpha: e * k * 1.3, ctx: p, draw: () => {
		p.fillStyle = sc.accent;
		p.beginPath();
		dotPath(p, W * (0.5 + (v ? b : a)), H * (0.5 + (v ? a : b)), R * 0.9);
		p.fill();
	} });
}

/**
 * 傾く周辺の影 — a vignette whose centre of gravity leans around the frame.
 * The radial gradients are approximated by stepped annuli and stacked discs
 * because the canvas contract has no gradient ops.
 */
function drawLeanVignette(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.9);
	const spd =
		(0.18 + randomUnit(s, 627_001) * 0.12) *
		(randomUnit(s, 627_002) < 0.5 ? -1 : 1);
	const kQ = 0.8 + randomUnit(s, 627_003) * 0.3;
	const a = t * spd + (s % 6);
	const cx = W * (0.5 + 0.24 * Math.cos(a));
	const cy = H * (0.5 + 0.24 * Math.sin(a));
	const R = Math.hypot(W, H) * 0.86;
	const k = kQ * e * (lum(options.frame.palette.background) < 0.45 ? 0.5 : 0.16);
	const bands = 7;
	const vPath = pathCtxOf(ctx);
	for (let j = 0; j < bands && vPath; j += 1) {
		const rOut = R * (1 - j / bands);
		const rIn = R * (1 - (j + 1) / bands);
		const mid = (rOut + rIn) / 2;
		const gPos = clamp01((mid - U * 0.3) / Math.max(1, R - U * 0.3));
		const alpha =
			gPos < 0.55
				? (gPos / 0.55) * k * 0.4
				: k * (0.4 + (0.6 * (gPos - 0.55)) / 0.45);
		if (alpha <= 0.004) continue;
		withAlpha({ alpha, ctx: vPath, draw: () => {
			vPath.fillStyle = "#000000";
			vPath.beginPath();
			const outer = ellipsePoints(cx, cy, rOut, rOut, 36);
			const inner = ellipsePoints(cx, cy, Math.max(0.1, rIn), Math.max(0.1, rIn), 36);
			addPoints(vPath, outer);
			addPoints(vPath, [...inner].reverse());
			vPath.closePath?.();
			vPath.fill();
		} });
	}
	const light = lightOf(options);
	for (let j = 4; j >= 1 && vPath; j -= 1) {
		const f = j / 4;
		const alpha = 0.07 * e * (1 - f) ** 2;
		withAlpha({ alpha, ctx: vPath, draw: () => {
			vPath.fillStyle = light;
			vPath.beginPath();
			dotPath(vPath, cx, cy, U * 0.6 * f);
			vPath.fill();
		} });
	}
}

/** 滑るカプセル — capsule rows sliding on a slant, alternating fill and outline. */
function drawCapsules(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const fade = fadeIn(options.frame);
	const k = 0.04 + randomUnit(s, 628_003) * 0.015;
	const D = Math.hypot(W, H);
	const hh = U * 0.17;
	const gapY = U * 0.27;
	const Lp = U * 1.7;
	const nl = Math.min(6, Math.ceil(D / 2 / gapY));
	const ang = pickFrom([-32, -20, 20, 32], randomUnit(s, 628_001));
	const spd = 0.02 + randomUnit(s, 628_002) * 0.015;
	const width = lineWidthOf(options, 0.003);
	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.rotate(degrees(ang));
	for (let j = -nl; j <= nl; j += 1) {
		const len = U * (0.55 + 0.75 * randomUnit(s, j + 9));
		const off = wrap(
			t * U * spd * (j % 2 ? 1 : -1) * (0.5 + 1.5 * randomUnit(s, j + 9, 2)) +
				randomUnit(s, j + 9, 3) * Lp,
			Lp,
		);
		for (let x = -D / 2 - Lp + off, c = 0; x < D / 2 && c < 5; x += Lp, c += 1) {
			const points = stadiumPoints(x, j * gapY - hh / 2, len, hh);
			if (j % 2) {
				strokePolygon(ctx, points, sc.foreground, width, fade * k * 2);
			} else {
				pathFillPoly(
					ctx,
					points,
					j === 0 ? sc.accent : sc.foreground,
					fade * k * (j === 0 ? 1.3 : 1),
				);
			}
		}
	}
	ctx.restore();
}

/**
 * ブラインドの光 — slats of light through blinds, breathing open and shut.
 * The linear gradient across each slat is stepped into nine bands.
 */
function drawSlitLight(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const ph = s % 7;
	const e = fadeIn(options.frame, 1);
	const n = 5 + Math.floor(randomUnit(s, 629_002) * 3);
	const lc = lightOf(options);
	const k = (0.07 + randomUnit(s, 629_003) * 0.025) * e;
	const sk = pickFrom([-0.5, -0.35, 0.35, 0.5], randomUnit(s, 629_001));
	const sh = U * 0.062;
	const gp = U * 0.04;
	const wd = U * 0.95;
	const tot = n * sh + (n - 1) * gp;
	const slices = 9;
	ctx.save();
	ctx.translate(
		W * (0.5 + 0.2 * Math.sin(t * 0.14 + ph)),
		H * (0.5 + 0.1 * Math.sin(t * 0.11 + ph * 2)),
	);
	ctx.transform(1, 0, sk, 1, 0, 0);
	for (let i = 0; i < n; i += 1) {
		const o = sh * (0.75 + 0.25 * Math.sin(t * 0.3 + i * 0.5));
		const y = -tot / 2 + i * (sh + gp) + (sh - o) / 2;
		for (let c = 0; c < slices; c += 1) {
			const f = (c + 0.5) / slices;
			const alpha =
				f < 0.22
					? (k * f) / 0.22
					: f < 0.7
						? k * (1 - (0.2 * (f - 0.22)) / 0.48)
						: 0.8 * k * (1 - (f - 0.7) / 0.3);
			fillRectA(
				ctx,
				-wd / 2 + (wd * c) / slices,
				y,
				wd / slices + 0.7,
				o,
				lc,
				alpha,
			);
		}
	}
	ctx.restore();
}

/** 階段グラデ — stepped poster gradient bands creeping sideways. */
function drawPosterGrad(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const L = Math.hypot(W, H);
	const n = 5 + Math.floor(randomUnit(s, 630_003) * 3);
	const ph = s % 5;
	const ang = pickFrom(
		[0, 30, 60, 90, 120, 150, 180, 210, 270, 330],
		randomUnit(s, 630_001),
	);
	const acc = randomUnit(s, 630_002) < 0.5;
	const k = 0.018 + randomUnit(s, 630_004) * 0.007;
	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.rotate(degrees(ang + 9 * Math.sin(t * 0.13 + ph)));
	const color = acc ? sc.accent : sc.foreground;
	for (let i = 1; i <= n; i += 1) {
		const x = -L / 2 + L * (i / (n + 1) + 0.035 * Math.sin(t * 0.3 + i * 1.1 + ph));
		fillRectA(ctx, x, -L / 2, L / 2 - x + 2, L, color, fade * k);
	}
	ctx.restore();
}

/** 大きな輪 — one huge ring breathing, a dashed halo, and a wandering planet. */
function drawBigRing(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const ph = s % 7;
	const e = fadeIn(options.frame, 1);
	const k = 0.05 + randomUnit(s, 631_003) * 0.015;
	const cx =
		W * (pickFrom([0.3, 0.7, 0.5], randomUnit(s, 631_001)) + 0.05 * Math.sin(t * 0.16 + ph));
	const cy =
		H * (pickFrom([0.4, 0.6, 0.5], randomUnit(s, 631_002)) + 0.05 * Math.cos(t * 0.13 + ph));
	const R = U * 0.6 * (0.8 + 0.2 * e);
	strokePolygon(
		ctx,
		ellipsePoints(cx, cy, R, R, 56),
		sc.foreground,
		U * (0.11 + 0.035 * Math.sin(t * 0.4)),
		e * k,
	);
	const R2 = R * 1.32;
	const a = t * 0.22 + ph;
	const dash = U * 0.012;
	const gap = U * 0.018;
	const step = (dash + gap) / R2;
	const start = (-t * U * 0.01) / R2;
	const width = lineWidthOf(options, 0.002);
	for (let d = start; d < TAU + start; d += step) {
		lineRect(
			ctx,
			cx + Math.cos(d) * R2,
			cy + Math.sin(d) * R2,
			cx + Math.cos(d + dash / R2) * R2,
			cy + Math.sin(d + dash / R2) * R2,
			sc.foreground,
			width,
			e * k * 2,
		);
	}
	const p = pathCtxOf(ctx);
	if (p) {
		withAlpha({ alpha: e * 0.4, ctx: p, draw: () => {
			p.fillStyle = sc.accent;
			p.beginPath();
			dotPath(p, cx + Math.cos(a) * R2, cy + Math.sin(a) * R2, U * 0.012);
			p.fill();
		} });
	}
}

/** カーテンのひだ — curtain folds swaying, with a light falloff at the top. */
function drawCurtain(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const n = 7 + Math.floor(randomUnit(s, 632_001) * 5);
	const ph = s % 9;
	const k = (0.07 + randomUnit(s, 632_002) * 0.02) * fadeIn(options.frame);
	const stops: { at: number; alpha: number }[] = [];
	let prev = 0;
	for (let i = 0; i <= n; i += 1) {
		const p = clamp((i + 0.3 * Math.sin(t * 0.45 + i * 1.3 + ph)) / n);
		if (i > 0) stops.push({ at: clamp((prev + p) / 2), alpha: 0 });
		const at = Math.max(prev, p);
		stops.push({
			at,
			alpha: k * (0.6 + 0.4 * Math.sin(i * 2.1 + ph)),
		});
		prev = at;
	}
	const bands = n * 2 + 2;
	for (let b = 0; b < bands; b += 1) {
		const f = (b + 0.5) / bands;
		let alpha: number | null = null;
		for (let i = 0; i + 1 < stops.length; i += 1) {
			const low = stops[i]!;
			const high = stops[i + 1]!;
			if (f >= low.at && f <= high.at) {
				const span = Math.max(1e-4, high.at - low.at);
				alpha = lerpN(low.alpha, high.alpha, (f - low.at) / span);
				break;
			}
		}
		if (alpha === null) continue;
		fillRectA(
			ctx,
			(W * b) / bands,
			0,
			W / bands + 0.7,
			H,
			sc.foreground,
			alpha,
		);
	}
	for (let b = 0; b < 5; b += 1) {
		const mid = H * 0.36 * ((b + 0.5) / 5);
		fillRectA(
			ctx,
			0,
			(H * 0.36 * b) / 5,
			W,
			H * 0.36 / 5 + 0.7,
			sc.background,
			0.6 * Math.max(0, 1 - mid / H / 0.35),
		);
	}
}

/** 定規の目盛り — ruler scales creeping along two edges, a pointer sweeping. */
function drawRuler(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame);
	const s = options.frame.cut?.seed ?? 1;
	const top = randomUnit(s, 633_001) < 0.4;
	const right = randomUnit(s, 633_002) < 0.5;
	const k = 0.24 + randomUnit(s, 633_003) * 0.06;
	const spQ = 0.32 + randomUnit(s, 633_004) * 0.08;
	const sp = U * spQ;
	const per = sp * 10;
	const off = wrap(t * U * 0.02, per);
	const y0 = H * (top ? 0.085 : 0.915);
	const dy = top ? 1 : -1;
	const x0 = W * (right ? 0.945 : 0.055);
	const dx = right ? -1 : 1;
	const width = lineWidthOf(options, 0.0018);
	const tick = (i: number): number =>
		U * (i % 10 === 0 ? 0.042 : i % 5 === 0 ? 0.028 : 0.015);
	for (let i = 0, x = off - per; x < W && i < 260; i += 1, x += sp) {
		lineRect(ctx, x, y0, x, y0 + dy * tick(i) * e, sc.foreground, width, e * k);
	}
	for (let i = 0, y = -off; y < H && i < 260; i += 1, y += sp) {
		lineRect(ctx, x0, y, x0 + dx * tick(i) * e, y, sc.foreground, width, e * k);
	}
	lineRect(ctx, 0, y0, W, y0, sc.foreground, width, e * k);
	lineRect(ctx, x0, 0, x0, H, sc.foreground, width, e * k);
	const px = W * (0.5 + 0.3 * Math.sin(t * 0.3));
	const ps = U * 0.014;
	pathFillPoly(
		ctx,
		[
			[px, y0 - dy * ps * 0.3],
			[px - ps, y0 - dy * ps * 1.9],
			[px + ps, y0 - dy * ps * 1.9],
		],
		sc.accent,
		e * 0.5,
	);
}

/** ダミー組版 — greeked text columns scrolling past like lo-fi filler type. */
function drawGreekText(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const lh = U * 0.037;
	const bh = U * 0.012;
	const cols = W > H ? 3 : 2;
	const gut = W * 0.04;
	const cw = (W * 0.86 - gut * (cols - 1)) / cols;
	const fade = fadeIn(options.frame);
	const spd = 0.01 + randomUnit(s, 634_001) * 0.008;
	const k = 0.055 + randomUnit(s, 634_002) * 0.015;
	const sc0 = t * U * spd;
	const r0 = Math.floor(sc0 / lh);
	const oy = -(sc0 - r0 * lh);
	const rows = Math.min(70, Math.ceil(H / lh) + 1);
	for (let c = 0; c < cols; c += 1) {
		for (let j = 0; j < rows; j += 1) {
			const id = r0 + j + c * 11;
			const m = wrap(id, 7);
			if (m === 6) continue;
			const len =
				m === 5
					? 0.25 + 0.5 * randomUnit(s, id, c)
					: 0.86 + 0.14 * randomUnit(s, id, c);
			const ind = m === 0 ? cw * 0.06 : 0;
			fillRectA(
				ctx,
				W * 0.07 + c * (cw + gut) + ind,
				oy + j * lh,
				cw * len - ind,
				bh,
				sc.foreground,
				fade * k,
			);
		}
	}
}

/** 巨大7セグ — a giant seven-segment counter ticking frame by frame. */
const SEGMENTS = [
	0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f,
] as const;

/** Hexagon point list for one seven-segment bar (JIZURA `segPath`). */
// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's segment geometry.
function segmentPoints(
	x: number,
	y: number,
	w: number,
	h: number,
	i: number,
): (readonly [number, number])[] {
	const th = w * 0.17;
	const g = th * 0.14;
	const hl = w - th;
	const vl = h / 2 - th / 2;
	const q = th / 2;
	// eslint-disable-next-line opencut/prefer-object-params -- Horizontal bar around its centre.
	const hz = (sx: number, sy: number): (readonly [number, number])[] => [
		[sx + g, sy],
		[sx + q + g, sy - q],
		[sx + hl - q - g, sy - q],
		[sx + hl - g, sy],
		[sx + hl - q - g, sy + q],
		[sx + q + g, sy + q],
	];
	// eslint-disable-next-line opencut/prefer-object-params -- Vertical bar around its centre.
	const vt = (sx: number, sy: number): (readonly [number, number])[] => [
		[sx, sy + g],
		[sx + q, sy + q + g],
		[sx + q, sy + vl - q - g],
		[sx, sy + vl - g],
		[sx - q, sy + vl - q - g],
		[sx - q, sy + q + g],
	];
	const L = x + q;
	const R = x + w - q;
	const T = y + q;
	const M = y + h / 2;
	const B = y + h - q;
	if (i === 0) return hz(L, T);
	if (i === 1) return vt(R, T);
	if (i === 2) return vt(R, M);
	if (i === 3) return hz(L, B);
	if (i === 4) return vt(L, M);
	if (i === 5) return vt(L, T);
	return hz(L, M);
}

function drawSevenSeg(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const fade = fadeIn(options.frame);
	const rate = 0.6 + randomUnit(s, 635_001) * 0.5;
	const k = 0.07 + randomUnit(s, 635_002) * 0.02;
	const tt = t * rate;
	const n0 = Math.floor(tt);
	const m = smoothR(0, 0.22, tt - n0);
	const nd = W > H * 1.2 ? 3 : 2;
	const gap = 0.24;
	const dw = Math.min(
		(W * 0.84) / (nd + (nd - 1) * gap),
		(H * 0.66) / 1.85,
	);
	const dh = dw * 1.85;
	const x0 = (W - dw * (nd + (nd - 1) * gap)) / 2;
	const y0 = (H - dh) / 2;
	ctx.save();
	ctx.translate(W / 2, H / 2);
	ctx.transform(1, 0, -0.07, 1, 0, 0);
	ctx.translate(-W / 2, -H / 2);
	const cur = (s % 500) + n0;
	const prv = cur - 1;
	const buckets: { on: number; points: (readonly [number, number])[] }[][] = [
		[],
		[],
		[],
	];
	for (let d = 0; d < nd; d += 1) {
		const p10 = 10 ** (nd - 1 - d);
		const a = SEGMENTS[Math.floor(cur / p10) % 10]!;
		const b = SEGMENTS[Math.floor(prv / p10) % 10]!;
		for (let i = 0; i < 7; i += 1) {
			const on = (a >> i) & 1;
			const was = (b >> i) & 1;
			buckets[on && was ? 2 : !on && !was ? 0 : 1]!.push({
				on,
				points: segmentPoints(x0 + d * dw * (1 + gap), y0, dw, dh, i),
			});
		}
	}
	for (let q = 0; q < 3; q += 1) {
		const list = buckets[q]!;
		if (list.length === 0) continue;
		for (let z = 0; z < 2; z += 1) {
			// mixed bucket: rising and falling segments use opposite fades
			const matching = q === 1 ? list.filter((entry) => entry.on === z) : z === 0 ? list : [];
			if (matching.length === 0) continue;
			const v = q === 2 ? 1 : q === 0 ? 0 : z ? m : 1 - m;
			for (const entry of matching) {
				pathFillPoly(
					ctx,
					entry.points,
					sc.foreground,
					fade * k * (0.22 + 0.78 * v),
				);
			}
		}
	}
	ctx.restore();
}

/** 見当マーク — print register marks wandering and turning over the frame. */
function drawCropMarks(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame);
	const sp = U * (0.32 + randomUnit(s, 636_001) * 0.08);
	const r = U * 0.02;
	const arm = U * 0.038 * e;
	const ox = wrap(t * U * 0.012, sp) - sp / 2;
	const oy = wrap(t * U * 0.007, sp) - sp / 2;
	const k = 0.19 + randomUnit(s, 636_002) * 0.04;
	const width = lineWidthOf(options, 0.002);
	const dots: { x: number; y: number }[] = [];
	for (let y = oy, j = 0; y < H + sp && j < 12; y += sp, j += 1) {
		for (let x = ox, i = 0; x < W + sp && i < 12; x += sp, i += 1) {
			const a = t * 0.25 * ((i + j) % 2 ? 1 : -1);
			const c = Math.cos(a) * arm;
			const d = Math.sin(a) * arm;
			dots.push({ x, y });
			lineRect(ctx, x - c, y - d, x + c, y + d, sc.foreground, width, e * k);
			lineRect(ctx, x + d, y - c, x - d, y + c, sc.foreground, width, e * k);
		}
	}
	const p = pathCtxOf(ctx);
	if (dots.length > 0 && p) {
		withAlpha({ alpha: e * k, ctx: p, draw: () => {
			p.fillStyle = sc.foreground;
			p.beginPath();
			for (const dot of dots) dotPath(p, dot.x, dot.y, r);
			p.fill();
		} });
	}
	const m = U * 0.05;
	const l = U * 0.05 * e;
	for (const [cx, cy, sx, sy] of [
		[m, m, 1, 1],
		[W - m, m, -1, 1],
		[m, H - m, 1, -1],
		[W - m, H - m, -1, -1],
	] as const) {
		lineRect(ctx, cx, cy - sy * l * 0.2, cx, cy + sy * l, sc.foreground, width, e * k);
		lineRect(ctx, cx - sx * l * 0.2, cy, cx + sx * l, cy, sc.foreground, width, e * k);
	}
}

/** スキャナーの光 — a scanner beam breathing across the frame (stepped gradient). */
function drawScanner(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame);
	const hz = H > W;
	const L = hz ? H : W;
	const X = hz ? W : H;
	const lc = lightOf(options);
	const k = (0.1 + randomUnit(s, 637_002) * 0.03) * e;
	const spd = 0.35 + randomUnit(s, 637_001) * 0.2;
	const x = L * (0.5 - 0.56 * Math.cos(t * spd + (s % 6)));
	const bw = U * 0.11;
	ctx.save();
	if (hz) {
		ctx.transform(0, 1, 1, 0, 0, 0);
	}
	fillRectA(ctx, 0, 0, Math.max(0, x), X, sc.foreground, 0.035 * e);
	const slices = 12;
	for (let c = 0; c < slices; c += 1) {
		const f = (c + 0.5) / slices;
		const alpha = f < 0.5 ? (k * f) / 0.5 : k * (1 - (f - 0.5) / 0.5);
		fillRectA(
			ctx,
			x - bw + (2 * bw * c) / slices,
			0,
			(2 * bw) / slices + 0.7,
			X,
			lc,
			alpha,
		);
	}
	const lw = lineWidthOf(options, 0.0015);
	fillRectA(ctx, x - lw / 2, 0, lw, X, lc, k * 2.2);
	ctx.restore();
}

/** 階段ブロック — two stepped bar charts marching through each other. */
function drawStepBlocks(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const cell = U * 0.11;
	const per = 5 + Math.floor(randomUnit(s, 638_001) * 4);
	const spd = 0.45 + randomUnit(s, 638_002) * 0.25;
	const k = 0.04 + randomUnit(s, 638_003) * 0.015;
	const e = fadeIn(options.frame, 0.8);
	const fr = t * spd;
	const fl = Math.floor(fr);
	const sh = wrap((fl + inOutCubic(clamp((fr - fl) * 2.2))) * cell, cell * per);
	const n = Math.min(40, Math.ceil(W / cell) + per + 1);
	for (let i = 0; i < n; i += 1) {
		const h = cell * 0.6 * (1 + (i % per)) * e;
		fillRectA(ctx, i * cell + sh - cell * per, H - h, cell + 0.5, h, sc.foreground, e * k);
	}
	for (let i = 0; i < n; i += 1) {
		const h = cell * 0.6 * (1 + (per - 1 - (i % per))) * e;
		fillRectA(ctx, i * cell - sh, 0, cell + 0.5, h, sc.accent, e * k * 1.1);
	}
}

/** レーダー — a radar sweep with fading trail, rings and blinking contacts. */
function drawRadar(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const e = fadeIn(options.frame, 0.8);
	const cx = W * pickFrom([0.5, 0.5, 0.25, 0.75], randomUnit(s, 639_001));
	const cy = H * pickFrom([0.5, 0.56], randomUnit(s, 639_002));
	const R = Math.hypot(W, H);
	const k = 0.09 + randomUnit(s, 639_005) * 0.02;
	const spd =
		(0.45 + randomUnit(s, 639_003) * 0.25) *
		(randomUnit(s, 639_004) < 0.5 ? -1 : 1);
	const dir = spd < 0 ? -1 : 1;
	const ang = t * spd;
	const NS = 18;
	const da = degrees(4.5);
	for (let i = 0; i < NS; i += 1) {
		const a0 = ang - dir * i * da;
		const a1 = ang - dir * (i + 1.04) * da;
		pathFillPoly(
			ctx,
			[
				[cx, cy],
				[cx + Math.cos(a0) * R, cy + Math.sin(a0) * R],
				[cx + Math.cos(a1) * R, cy + Math.sin(a1) * R],
			],
			sc.foreground,
			e * k * (1 - i / NS) ** 1.6,
		);
	}
	const width = lineWidthOf(options, 0.0018);
	for (let i = 1; i <= 5; i += 1) {
		strokePolygon(
			ctx,
			ellipsePoints(cx, cy, U * 0.2 * i * (0.8 + 0.2 * e), U * 0.2 * i * (0.8 + 0.2 * e), 44),
			sc.foreground,
			width,
			e * k * 1.3,
		);
	}
	lineRect(ctx, 0, cy, W, cy, sc.foreground, width, e * k * 1.3);
	lineRect(ctx, cx, 0, cx, H, sc.foreground, width, e * k * 1.3);
	const p = pathCtxOf(ctx);
	if (!p) return;
	for (let i = 0; i < 6; i += 1) {
		const a = randomUnit(s, i, 1) * TAU;
		const r = U * (0.15 + 0.6 * randomUnit(s, i, 2));
		const age = wrap(dir * (ang - a), TAU) / TAU;
		withAlpha({ alpha: 0.5 * (1 - age) ** 3, ctx: p, draw: () => {
			p.fillStyle = sc.accent;
			p.beginPath();
			dotPath(p, cx + Math.cos(a) * r, cy + Math.sin(a) * r, U * 0.009);
			p.fill();
		} });
	}
}

/** 進む横棒 — progress bars filling and restarting at their own paces. */
function drawLoadBars(options: BgcamBackgroundDraw): void {
	const { ctx, height: H, width: W } = options;
	const sc = options.frame.palette;
	const s = options.frame.cut?.seed ?? 1;
	const t = secondsOf(options.frame);
	const U = unitOf(options);
	const n = 6 + Math.floor(randomUnit(s, 640_001) * 3);
	const k = 0.07 + randomUnit(s, 640_002) * 0.02;
	const bh = U * 0.02;
	const e = fadeIn(options.frame);
	const lw = lineWidthOf(options, 0.0018);
	for (let i = 0; i < n; i += 1) {
		const w = W * (0.3 + 0.55 * randomUnit(s, i, 1));
		const x = randomUnit(s, i, 2) < 0.5 ? W * 0.06 : W * 0.94 - w;
		const y = (H * (i + 0.5 + 0.25 * randomSigned(s, i, 3))) / n - bh / 2;
		const p = wrap(t * (0.05 + 0.07 * randomUnit(s, i, 4)) + randomUnit(s, i, 5), 1);
		const pe = inOutCubic(clamp(p / 0.82));
		const visible =
			e * smoothR(0, 0.04, p) * (1 - smoothR(0.9, 1, p));
		lineRect(ctx, x, y, x + w, y, sc.foreground, lw, visible * k * 1.5);
		lineRect(ctx, x, y + bh, x + w, y + bh, sc.foreground, lw, visible * k * 1.5);
		lineRect(ctx, x, y, x, y + bh, sc.foreground, lw, visible * k * 1.5);
		lineRect(ctx, x + w, y, x + w, y + bh, sc.foreground, lw, visible * k * 1.5);
		const hot = i === s % n;
		fillRectA(
			ctx,
			x,
			y,
			w * pe,
			bh,
			hot ? sc.accent : sc.foreground,
			visible * (hot ? k * 2.4 : k),
		);
		fillRectA(ctx, x, y + bh * 1.8, w * 0.12, bh * 0.3, sc.foreground, visible * k * 1.5);
	}
}
