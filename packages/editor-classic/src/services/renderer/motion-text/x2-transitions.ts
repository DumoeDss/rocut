import {
	clamp01,
	degrees,
	inOutCubic,
	inOutSine,
	inQuad,
	mixHex,
	outCubic,
	randomSigned,
	randomUnit,
	smooth,
} from "./exit-hold-geometry";
import {
	bell,
	drawTransitionLine,
	transitionBoundary,
	type TreatTransTransitionDraw,
} from "./treat-trans-transition-drawing";

/**
 * JIZURA 追加分2 pack "x2camtr" transition group — 17 cut-to-cut handovers.
 *
 * Transliteration notes (same simplifications as the other x2 ports): plan rng
 * fields are derived deterministically from the cut seed; JIZURA's offscreen
 * canvases A/B become the `drawPrevious`/`drawCurrent` redraw callbacks (a
 * sub-rect draw becomes clip + translate/scale of the redraw); the canvas
 * contract has no gradient or filter ops, so gradient feathers are stepped
 * into bands and the pixel-column smear is an affine-stretched redraw; and
 * `tAcc` contrast picking is approximated with a luminance ratio.
 */

const TAU = Math.PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

// eslint-disable-next-line opencut/prefer-object-params -- Mirrors J.lerp's compact shape.
function lerpN(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
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

function seedOf(options: TreatTransTransitionDraw): number {
	return options.frame.cut?.seed ?? 0;
}

/** JIZURA `minD(I)` — the short frame edge. */
function minDOf(options: TreatTransTransitionDraw): number {
	return Math.min(options.width, options.height);
}

/** JIZURA `lwOf(I, k)` — a handover edge width in device px. */
// eslint-disable-next-line opencut/prefer-object-params
function lwOf(options: TreatTransTransitionDraw, k = 0.006): number {
	return Math.max(2, minDOf(options) * k);
}

/** JIZURA `prevBg(I)` — the outgoing cut's background. */
function prevBgOf(options: TreatTransTransitionDraw): string {
	return options.frame.previousPalette?.background ?? options.frame.palette.background;
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

/** JIZURA `J.contrast` approximated by the WCAG luminance ratio. */
// eslint-disable-next-line opencut/prefer-object-params
function contrast(a: string, b: string): number {
	const la = lum(a) + 0.05;
	const lb = lum(b) + 0.05;
	return la > lb ? la / lb : lb / la;
}

/** JIZURA `tAcc(I, second)` — an accent that reads against both backgrounds. */
// eslint-disable-next-line opencut/prefer-object-params
function accentOf(options: TreatTransTransitionDraw, second = false): string {
	const { palette: sc } = options.frame;
	const pb = prevBgOf(options);
	const list = second
		? [sc.secondary, sc.accent, sc.foreground]
		: [sc.accent, sc.secondary, sc.foreground];
	for (const color of list) {
		if (contrast(color, sc.background) >= 1.8 && contrast(color, pb) >= 1.4) {
			return color;
		}
	}
	return sc.foreground;
}

/** JIZURA `dim(ctx, I, a)` — a black veil at some alpha over the frame. */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operand plus a scalar.
function dim(options: TreatTransTransitionDraw, alpha: number): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * clamp01(alpha);
	ctx.fillStyle = "#000000";
	ctx.fillRect(0, 0, options.width, options.height);
	ctx.globalAlpha = base;
}

/** JIZURA `part(ctx, C, x, y, w, h, dx, dy)` — a shifted redraw of one strip. */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operands plus the source pack's part() shape.
function drawShifted(
	options: TreatTransTransitionDraw,
	x: number,
	y: number,
	w: number,
	h: number,
	dx: number,
	dy: number,
	source: () => void,
): void {
	if (w <= 0.5 || h <= 0.5) return;
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	ctx.rect(x + dx, y + dy, w, h);
	ctx.clip();
	ctx.translate(dx, dy);
	source();
	ctx.restore();
}

/**
 * A scaled sub-rect redraw — JIZURA
 * `ctx.drawImage(C, sx, sy, sw, sh, dx, dy, dw, dh)` on the redraw callbacks.
 */
function drawScaledPart({
	dx,
	dy,
	dw,
	dh,
	draw,
	options,
	sh,
	sw,
	sx,
	sy,
}: {
	readonly dx: number;
	readonly dy: number;
	readonly dw: number;
	readonly dh: number;
	readonly draw: () => void;
	readonly options: TreatTransTransitionDraw;
	readonly sh: number;
	readonly sw: number;
	readonly sx: number;
	readonly sy: number;
}): void {
	if (dw <= 0.5 || dh <= 0.5 || sw <= 0 || sh <= 0) return;
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	ctx.rect(dx, dy, dw, dh);
	ctx.clip();
	ctx.translate(dx, dy);
	ctx.scale(dw / sw, dh / sh);
	ctx.translate(-sx, -sy);
	draw();
	ctx.restore();
}

/** JIZURA `scaled(ctx, C, cw, ch, s, cx, cy)` — a full-frame scaled redraw. */
function drawScaledFull({
	cx,
	cy,
	draw,
	options,
	s,
}: {
	readonly cx: number;
	readonly cy: number;
	readonly draw: () => void;
	readonly options: TreatTransTransitionDraw;
	readonly s: number;
}): void {
	const { ctx } = options;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(s, s);
	ctx.translate(-cx, -cy);
	draw();
	ctx.restore();
}

// eslint-disable-next-line opencut/prefer-object-params -- JIZURA polyPath vertices.
function polyPts(
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

// eslint-disable-next-line opencut/prefer-object-params -- Arc chord vertices (a0..a1 around cx, cy).
function arcPts(
	cx: number,
	cy: number,
	radius: number,
	a0: number,
	a1: number,
	steps = 10,
): (readonly [number, number])[] {
	const points: (readonly [number, number])[] = [];
	for (let index = 0; index <= steps; index += 1) {
		const angle = a0 + ((a1 - a0) * index) / steps;
		points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
	}
	return points;
}

/** Clip to a set of closed polygons and redraw; false when paths are unavailable. */
function clipPolygons({
	draw,
	options,
	polygons,
}: {
	readonly draw: () => void;
	readonly options: TreatTransTransitionDraw;
	readonly polygons: readonly (readonly (readonly [number, number])[])[];
}): boolean {
	const { ctx } = options;
	if (!ctx.moveTo || !ctx.lineTo || polygons.length === 0) return false;
	ctx.save();
	ctx.beginPath();
	for (const polygon of polygons) {
		ctx.moveTo(polygon[0]![0], polygon[0]![1]);
		for (const point of polygon.slice(1)) ctx.lineTo(point[0], point[1]);
		ctx.closePath?.();
	}
	ctx.clip();
	draw();
	ctx.restore();
	return true;
}

/**
 * JIZURA `halfPlane` — everything on the `sign` side of the line through
 * (qx, qy) with normal (nx, ny). False (nothing drawn) without path ops.
 */
// eslint-disable-next-line opencut/prefer-object-params -- Canvas operands plus the source pack's half-plane shape.
function halfPlaneClip(
	options: TreatTransTransitionDraw,
	qx: number,
	qy: number,
	nx: number,
	ny: number,
	sign: number,
	span: number,
	draw: () => void,
): boolean {
	const tx = -ny;
	const ty = nx;
	return clipPolygons({
		draw,
		options,
		polygons: [
			[
				[qx + tx * span, qy + ty * span],
				[qx - tx * span, qy - ty * span],
				[qx - tx * span + nx * sign * span, qy - ty * span + ny * sign * span],
				[qx + tx * span + nx * sign * span, qy + ty * span + ny * sign * span],
			],
		],
	});
}

/** A closed outline stroke as rotated-rect segments (no `ctx.stroke` needed). */
function strokeOutline({
	alpha,
	color,
	options,
	points,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: TreatTransTransitionDraw;
	readonly points: readonly (readonly [number, number])[];
	readonly width: number;
}): void {
	for (let index = 0; index < points.length; index += 1) {
		const from = points[index]!;
		const to = points[(index + 1) % points.length]!;
		drawTransitionLine(options, {
			alpha,
			color,
			from: [from[0], from[1]],
			to: [to[0], to[1]],
			width,
		});
	}
}

export function drawX2Transition(options: TreatTransTransitionDraw): boolean {
	if (!options.frame.previousCut) return false;
	switch (options.frame.cut?.preset.trans) {
		case "xqAccordion":
		case "xqBladeRun":
		case "xqChevronPush":
		case "xqDiagSplit":
		case "xqFlipOver":
		case "xqHalftone":
		case "xqLightLeak":
		case "xqLouverTurn":
		case "xqPagePeel":
		case "xqPolyIris":
		case "xqPropeller":
		case "xqRingRipple":
		case "xqSoftSweep":
		case "xqStretchSmear":
		case "xqStripShuffle":
		case "xqWaveWipe":
		case "xqWindowZoom":
			drawX2TransitionPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2TransitionPart(options: TreatTransTransitionDraw): void {
	const preset = options.frame.cut?.preset.trans;
	switch (preset) {
		case "xqAccordion":
			drawAccordion(options);
			return;
		case "xqBladeRun":
			drawBladeRun(options);
			return;
		case "xqChevronPush":
			drawChevronPush(options);
			return;
		case "xqDiagSplit":
			drawDiagSplit(options);
			return;
		case "xqFlipOver":
			drawFlipOver(options);
			return;
		case "xqHalftone":
			drawHalftone(options);
			return;
		case "xqLightLeak":
			drawLightLeak(options);
			return;
		case "xqLouverTurn":
			drawLouverTurn(options);
			return;
		case "xqPagePeel":
			drawPagePeel(options);
			return;
		case "xqPolyIris":
			drawPolyIris(options);
			return;
		case "xqPropeller":
			drawPropeller(options);
			return;
		case "xqRingRipple":
			drawRingRipple(options);
			return;
		case "xqSoftSweep":
			drawSoftSweep(options);
			return;
		case "xqStretchSmear":
			drawStretchSmear(options);
			return;
		case "xqStripShuffle":
			drawStripShuffle(options);
			return;
		case "xqWaveWipe":
			drawWaveWipe(options);
			return;
		case "xqWindowZoom":
			drawWindowZoom(options);
			return;
		default:
			return;
	}
}

/** 斜め刃走り — the new cut runs down parallel diagonal lanes, neighbours opposed. */
function drawBladeRun(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = 5 + Math.floor(randomUnit(s, 681_001) * 4);
	const ang = pickFrom([-32, -24, 24, 32, 58, -58], randomUnit(s, 681_002));
	const mid = randomUnit(s, 681_003) < 0.5;
	const R = Math.hypot(cw, ch) + 4;
	const hb = R / n;
	const lw = lwOf(options, 0.005);
	options.drawPrevious();
	ctx.save();
	ctx.translate(cw / 2, ch / 2);
	ctx.rotate(degrees(ang));
	ctx.beginPath();
	const tips: [number, number, number][] = [];
	for (let i = 0; i < n; i += 1) {
		const o = mid
			? Math.abs(i - (n - 1) / 2) / Math.max(1, (n - 1) / 2)
			: i / Math.max(1, n - 1);
		const t = inOutCubic(clamp(p * 1.5 - o * 0.5));
		if (t <= 0) continue;
		const len = R * t;
		const y0 = -R / 2 + i * hb;
		if (i % 2) {
			ctx.rect(R / 2 - len, y0 - 0.6, len, hb + 1.2);
			tips.push([R / 2 - len - lw, y0, t]);
		} else {
			ctx.rect(-R / 2, y0 - 0.6, len, hb + 1.2);
			tips.push([-R / 2 + len, y0, t]);
		}
	}
	ctx.save();
	ctx.clip();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.drawCurrent();
	ctx.restore();
	const base = ctx.globalAlpha;
	ctx.fillStyle = accentOf(options);
	for (const [x, y, t] of tips) {
		if (t >= 1) continue;
		ctx.globalAlpha = base * Math.min(1, (1 - t) * 3);
		ctx.fillRect(x, y, lw, hb);
	}
	ctx.globalAlpha = base;
	ctx.restore();
}

/** プロペラ — several wedges open at once round the centre as the rotor turns. */
function drawPropeller(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = 3 + Math.floor(randomUnit(s, 682_001) * 3);
	const d = pickFrom([1, -1], randomUnit(s, 682_002));
	const cx = cw * (0.5 + (randomUnit(s, 682_004) - 0.5) * 0.16);
	const cy = ch * (0.5 + (randomUnit(s, 682_005) - 0.5) * 0.12);
	const e = inOutCubic(p);
	const R =
		Math.hypot(Math.max(cx, cw - cx), Math.max(cy, ch - cy)) + 4;
	const sw = (e * TAU) / n + 0.004;
	const base = degrees(randomUnit(s, 682_003) * 360) + d * e * 0.9;
	options.drawPrevious();
	const wedges: (readonly (readonly [number, number])[])[] = [];
	for (let i = 0; i < n; i += 1) {
		const a = base + (i * TAU) / n;
		wedges.push([
			[cx, cy],
			...arcPts(cx, cy, R, d > 0 ? a : a - sw, d > 0 ? a + sw : a),
		]);
	}
	if (!clipPolygons({ draw: options.drawCurrent, options, polygons: wedges })) {
		ctx.save();
		ctx.globalAlpha *= p;
		options.drawCurrent();
		ctx.restore();
	}
	const alpha = bell(p) ** 0.5;
	const width = lwOf(options, 0.005);
	for (let i = 0; i < n; i += 1) {
		const a = base + (i * TAU) / n + d * sw;
		drawTransitionLine(options, {
			alpha,
			color: accentOf(options),
			from: [cx, cy],
			to: [cx + Math.cos(a) * R, cy + Math.sin(a) * R],
			width,
		});
	}
}

/** 多角アイリス — a polygon window turns as it opens on the new cut. */
function drawPolyIris(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = pickFrom([3, 4, 4, 6], randomUnit(s, 683_001));
	const spin =
		(50 + randomUnit(s, 683_002) * 60) *
		(randomUnit(s, 683_004) < 0.5 ? -1 : 1);
	const a0 = pickFrom([0, 45, 90, 30], randomUnit(s, 683_003));
	const e =
		n === 3
			? clamp(p) ** 3 * 0.5 + inOutCubic(p) * 0.5
			: inOutCubic(p);
	const cx = cw / 2;
	const cy = ch / 2;
	const r =
		((Math.hypot(cw, ch) / 2 + 4) / Math.cos(Math.PI / n)) * e;
	const rot = degrees(a0 + spin * (1 - e));
	options.drawPrevious();
	if (r < 0.5) return;
	const window = polyPts(cx, cy, r, n, rot);
	clipPolygons({ draw: options.drawCurrent, options, polygons: [window] });
	const a = bell(p) ** 0.6;
	const lw = lwOf(options, 0.008);
	strokeOutline({
		alpha: a,
		color: accentOf(options),
		options,
		points: window,
		width: lw,
	});
	strokeOutline({
		alpha: a * 0.55,
		color: accentOf(options, true),
		options,
		points: polyPts(cx, cy, r * 1.12 + lw * 3, n, rot),
		width: Math.max(1, lw * 0.4),
	});
}

/** 同心リング — concentric bands widening outwards, the inner ones first. */
function drawRingRipple(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = 4 + Math.floor(randomUnit(s, 684_001) * 4);
	const cx = cw * pickFrom([0.5, 0.5, 0.2, 0.8], randomUnit(s, 684_002));
	const cy = ch * pickFrom([0.5, 0.5, 0.3, 0.75], randomUnit(s, 684_003));
	const inw = randomUnit(s, 684_004) < 0.3;
	const R = Math.hypot(Math.max(cx, cw - cx), Math.max(cy, ch - cy)) + 4;
	const bw = R / n;
	options.drawPrevious();
	const bands: (readonly (readonly [number, number])[])[] = [];
	const edges: [number, number][] = [];
	for (let j = 0; j < n; j += 1) {
		const o = ((inw ? n - 1 - j : j) / Math.max(1, n - 1));
		const t = inOutCubic(clamp(p * 1.6 - o * 0.6));
		if (t <= 0) continue;
		const r0 = Math.max(0, j * bw - 0.8);
		const r1 = j * bw + bw * t;
		const outer = arcPts(cx, cy, r1, 0, TAU, 40);
		bands.push(outer);
		if (r0 > 0) bands.push([...arcPts(cx, cy, r0, 0, TAU, 40)].reverse());
		if (t < 1) edges.push([r1, t]);
	}
	clipPolygons({ draw: options.drawCurrent, options, polygons: bands });
	const color = accentOf(options);
	const width = lwOf(options, 0.004);
	for (const [r, t] of edges) {
		strokeOutline({
			alpha: Math.min(1, (1 - t) * 2.5) * Math.min(1, t * 6),
			color,
			options,
			points: arcPts(cx, cy, r, 0, TAU - 0.001, 40),
			width,
		});
	}
}

/** ルーバー — the old cut is cut into slats that turn edge-on one by one. */
function drawLouverTurn(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = 7 + Math.floor(randomUnit(s, 685_001) * 6);
	const vert = randomUnit(s, 685_002) < 0.4;
	const rev = randomUnit(s, 685_003) < 0.5;
	const L = vert ? cw : ch;
	const lw = Math.max(1, lwOf(options, 0.0025));
	options.drawCurrent();
	dim(options, 0.35 * (1 - inOutCubic(p)));
	for (let i = 0; i < n; i += 1) {
		const t = inOutCubic(
			clamp((p - ((rev ? n - 1 - i : i) / n) * 0.4) / 0.6),
		);
		const f = Math.cos((t * Math.PI) / 2);
		if (f <= 0.004) continue;
		const a0 = Math.round((i * L) / n);
		const a1 = Math.round(((i + 1) * L) / n);
		const h = (a1 - a0) * f;
		const m = (a0 + a1) / 2 - h / 2;
		if (vert) {
			drawScaledPart({
				dx: m,
				dy: 0,
				dw: h,
				dh: ch,
				draw: options.drawPrevious,
				options,
				sx: a0,
				sy: 0,
				sw: a1 - a0,
				sh: ch,
			});
		} else {
			drawScaledPart({
				dx: 0,
				dy: m,
				dw: cw,
				dh: h,
				draw: options.drawPrevious,
				options,
				sx: 0,
				sy: a0,
				sw: cw,
				sh: a1 - a0,
			});
		}
		if (t > 0) {
			const base = ctx.globalAlpha;
			ctx.fillStyle = "#000000";
			ctx.globalAlpha = base * (0.55 * t);
			if (vert) ctx.fillRect(m, 0, h, ch);
			else ctx.fillRect(0, m, cw, h);
			ctx.globalAlpha = base * Math.min(1, t * 4) * f;
			ctx.fillStyle = accentOf(options);
			if (vert) ctx.fillRect(m, 0, lw, ch);
			else ctx.fillRect(0, m, cw, lw);
			ctx.globalAlpha = base;
		}
	}
}

/** 網点ワイプ — a screen of dots swells across the frame until the dots merge. */
function drawHalftone(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const cell = minDOf(options) / (6 + Math.floor(randomUnit(s, 686_001) * 4));
	const d = pickFrom(["L", "R", "U", "D", "C", "X"], randomUnit(s, 686_002));
	const cols = Math.ceil(cw / cell) + 1;
	const rows = Math.ceil(ch / (cell * 0.866)) + 1;
	options.drawPrevious();
	const dots: (readonly (readonly [number, number])[])[] = [];
	let full = true;
	for (let j = 0; j < rows; j += 1) {
		for (let i = 0; i < cols; i += 1) {
			const x = (i + (j % 2 ? 0.5 : 0)) * cell - cell * 0.25;
			const y = j * cell * 0.866;
			const fx = clamp(x / cw);
			const fy = clamp(y / ch);
			const o =
				d === "R"
					? fx
					: d === "L"
						? 1 - fx
						: d === "D"
							? fy
							: d === "U"
								? 1 - fy
								: d === "C"
									? Math.min(1, Math.hypot(fx - 0.5, fy - 0.5) * 1.42)
									: (fx + fy) / 2;
			const t = clamp((p - o * 0.55) / 0.45);
			if (t <= 0) {
				full = false;
				continue;
			}
			if (t < 1) full = false;
			const r = cell * 0.62 * inOutSine(t);
			dots.push(arcPts(x, y, r, 0, TAU, 8));
		}
	}
	if (full) {
		options.drawCurrent();
		return;
	}
	if (!clipPolygons({ draw: options.drawCurrent, options, polygons: dots })) {
		ctx.save();
		ctx.globalAlpha *= p;
		options.drawCurrent();
		ctx.restore();
	}
}

/** くの字押し — thin bands push the old cut out, the seam travelling as an arrow. */
function drawChevronPush(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const dir = pickFrom(
		["L", "L", "R", "R", "U", "D"],
		randomUnit(s, 687_001),
	);
	const n = pickFrom([14, 18, 24], randomUnit(s, 687_002));
	const inv = randomUnit(s, 687_003) < 0.35;
	const hor = dir !== "U" && dir !== "D";
	const sg = dir === "R" || dir === "D" ? 1 : -1;
	const L = hor ? ch : cw;
	const M = hor ? cw : ch;
	const lw = lwOf(options, 0.004);
	const ac = accentOf(options);
	const ba = bell(p) ** 0.6;
	for (let i = 0; i < n; i += 1) {
		const c = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
		const t = inOutCubic(clamp((p - 0.34 * (inv ? 1 - c : c)) / 0.66));
		const o = Math.round(t * M) * sg;
		const a0 = Math.round((i * L) / n);
		const a1 = Math.round(((i + 1) * L) / n);
		if (hor) {
			drawShifted(options, 0, a0, cw, a1 - a0, o, 0, options.drawPrevious);
			drawShifted(
				options,
				0,
				a0,
				cw,
				a1 - a0,
				o - sg * cw,
				0,
				options.drawCurrent,
			);
		} else {
			drawShifted(options, a0, 0, a1 - a0, ch, 0, o, options.drawPrevious);
			drawShifted(
				options,
				a0,
				0,
				a1 - a0,
				ch,
				0,
				o - sg * ch,
				options.drawCurrent,
			);
		}
		if (t > 0 && t < 1) {
			const q = sg < 0 ? M + o : o;
			const base = ctx.globalAlpha;
			ctx.globalAlpha = base * ba;
			ctx.fillStyle = ac;
			if (hor) ctx.fillRect(q - lw / 2, a0, lw, a1 - a0);
			else ctx.fillRect(a0, q - lw / 2, a1 - a0, lw);
			ctx.globalAlpha = base;
		}
	}
}

/** 斜め割り — the old cut parts along a slant, both pieces at right angles to it. */
function drawDiagSplit(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const a = degrees(
		pickFrom([28, 38, 52, -28, -38, -52, 142, 128], randomUnit(s, 688_001)),
	);
	const nx = Math.cos(a);
	const ny = Math.sin(a);
	const e = inOutCubic(p);
	const L = (cw + ch) * 2;
	const dist = (Math.abs(nx) * cw + Math.abs(ny) * ch) / 2 + 4;
	const off = e * dist;
	const lw = lwOf(options, 0.005);
	if (off < 0.5) {
		options.drawPrevious();
		return;
	}
	ctx.fillStyle = options.frame.palette.background;
	ctx.fillRect(0, 0, cw, ch);
	drawScaledFull({
		cx: cw / 2,
		cy: ch / 2,
		draw: options.drawCurrent,
		options,
		s: 1.06 - 0.06 * outCubic(p),
	});
	dim(options, 0.4 * (1 - e));
	for (const sg of [1, -1]) {
		const qx = cw / 2 + nx * off * sg;
		const qy = ch / 2 + ny * off * sg;
		halfPlaneClip(options, qx, qy, nx, ny, sg, L, () => {
			ctx.translate(nx * off * sg, ny * off * sg);
			options.drawPrevious();
		});
		drawTransitionLine(options, {
			alpha: bell(p) ** 0.5,
			color: accentOf(options, sg < 0),
			from: [qx - ny * L, qy + nx * L],
			to: [qx + ny * L, qy - nx * L],
			width: lw,
		});
	}
}

/** 蛇腹たたみ — the old cut folds up into pleats against one edge. */
function drawAccordion(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = pickFrom([6, 8, 10], randomUnit(s, 689_001));
	const dir = pickFrom(["L", "R", "L", "R", "U"], randomUnit(s, 689_002));
	const e = inOutCubic(p);
	const k = 1 - e;
	const vert = dir === "U";
	const toEnd = dir === "R";
	const L = vert ? ch : cw;
	const sh = clamp(e * 3);
	const po = (toEnd ? -1 : 1) * k * L * 0.05;
	ctx.fillStyle = options.frame.palette.background;
	ctx.fillRect(0, 0, cw, ch);
	ctx.save();
	if (vert) ctx.translate(0, po);
	else ctx.translate(po, 0);
	options.drawCurrent();
	ctx.restore();
	dim(options, 0.35 * k);
	if (k < 0.002) return;
	for (let i = 0; i < n; i += 1) {
		const s0 = Math.round((i * L) / n);
		const s1 = Math.round(((i + 1) * L) / n);
		const d0 = toEnd ? L - (L - s0) * k : s0 * k;
		const dw = (s1 - s0) * k + 0.6;
		if (vert) {
			drawScaledPart({
				dx: 0,
				dy: d0,
				dw: cw,
				dh: dw,
				draw: options.drawPrevious,
				options,
				sx: 0,
				sy: s0,
				sw: cw,
				sh: s1 - s0,
			});
		} else {
			drawScaledPart({
				dx: d0,
				dy: 0,
				dw,
				dh: ch,
				draw: options.drawPrevious,
				options,
				sx: s0,
				sy: 0,
				sw: s1 - s0,
				sh: ch,
			});
		}
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * ((i % 2 ? 0.42 : 0.1) * sh);
		ctx.fillStyle = i % 2 ? "#000000" : "#FFFFFF";
		if (vert) ctx.fillRect(0, d0, cw, dw);
		else ctx.fillRect(d0, 0, dw, ch);
		ctx.globalAlpha = base;
	}
	const lw = lwOf(options, 0.005);
	const q = toEnd ? L - L * k - lw : L * k;
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * bell(p) ** 0.6;
	ctx.fillStyle = accentOf(options);
	if (vert) ctx.fillRect(0, q, cw, lw);
	else ctx.fillRect(q, 0, lw, ch);
	ctx.globalAlpha = base;
}

/** 短冊シャッフル — strips lift, trade places like shuffled cards, come home. */
function drawStripShuffle(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const n = 4 + Math.floor(randomUnit(s, 690_001) * 4);
	const k2 = 1 + ((1 + Math.floor(randomUnit(s, 690_002) * 5)) % (n - 1));
	const m = 0.5 - 0.5 * Math.cos(TAU * p);
	const xf = smoothR(0.4, 0.6, p);
	const sh = minDOf(options) * 0.012;
	ctx.fillStyle = mixHex({
		from: mixHex({
			from: prevBgOf(options),
			to: options.frame.palette.background,
			progress: p,
		}),
		to: "#000000",
		progress: 0.55,
	});
	ctx.fillRect(0, 0, cw, ch);
	for (let pass = 0; pass < 2; pass += 1) {
		for (let i = 0; i < n; i += 1) {
			if (i % 2 !== pass) continue;
			const x0 = Math.round((i * cw) / n);
			const x1 = Math.round(((i + 1) * cw) / n);
			const w = x1 - x0;
			const tx = Math.round((((n - 1 - i + k2) % n) * cw) / n);
			const dx = Math.round((tx - x0) * m);
			const dy = Math.round((pass ? -1 : 1) * ch * 0.04 * m);
			const base = ctx.globalAlpha;
			ctx.globalAlpha = base * (0.35 * m);
			ctx.fillStyle = "#000000";
			ctx.fillRect(x0 + dx - sh, dy, w + sh * 2, ch);
			ctx.globalAlpha = base;
			if (xf < 1) {
				drawShifted(options, x0, 0, w, ch, dx, dy, options.drawPrevious);
			}
			if (xf > 0) {
				ctx.save();
				ctx.globalAlpha *= xf;
				drawShifted(options, x0, 0, w, ch, dx, dy, options.drawCurrent);
				ctx.restore();
			}
		}
	}
}

/** 窓ズーム — the new cut arrives as a small framed picture that grows to fill. */
function drawWindowZoom(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const e = inOutCubic(p);
	const scale = e;
	const cx = lerpN(cw * pickFrom([0.5, 0.5, 0.3, 0.7], randomUnit(s, 691_001)), cw / 2, e);
	const cy = lerpN(ch * pickFrom([0.5, 0.5, 0.4, 0.62], randomUnit(s, 691_002)), ch / 2, e);
	const rot = -7 + randomUnit(s, 691_003) * 14;
	ctx.fillStyle = prevBgOf(options);
	ctx.fillRect(0, 0, cw, ch);
	drawScaledFull({
		cx: cw / 2,
		cy: ch / 2,
		draw: options.drawPrevious,
		options,
		s: 1 + 0.18 * e,
	});
	dim(options, 0.45 * outCubic(p));
	if (scale < 0.004) return;
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(degrees(rot) * (1 - e));
	const w = cw * scale;
	const h = ch * scale;
	const lw = lwOf(options, 0.007) * (1 - smoothR(0.75, 1, p));
	const so = minDOf(options) * 0.02 * (1 - e);
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * (0.4 * (1 - e));
	ctx.fillStyle = "#000000";
	ctx.fillRect(-w / 2 + so, -h / 2 + so, w, h);
	ctx.globalAlpha = base;
	drawScaledPart({
		dx: -w / 2,
		dy: -h / 2,
		dw: w,
		dh: h,
		draw: options.drawCurrent,
		options,
		sx: 0,
		sy: 0,
		sw: cw,
		sh: ch,
	});
	if (lw > 0.3) {
		ctx.fillStyle = accentOf(options);
		ctx.fillRect(-w / 2 - lw / 2, -h / 2 - lw / 2, w + lw, lw);
		ctx.fillRect(-w / 2 - lw / 2, h / 2 - lw / 2, w + lw, lw);
		ctx.fillRect(-w / 2 - lw / 2, -h / 2 - lw / 2, lw, h + lw);
		ctx.fillRect(w / 2 - lw / 2, -h / 2 - lw / 2, lw, h + lw);
	}
	ctx.restore();
}

/**
 * 流しディゾルブ — a dissolve with a direction: a feathered edge crosses the
 * frame. The destination-in gradient is stepped into rotated alpha bands.
 */
function drawSoftSweep(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const a = degrees(
		pickFrom(
			[0, 180, 0, 180, 90, -90, 30, 150, -30, -150],
			randomUnit(s, 692_001),
		),
	);
	const dx = Math.cos(a);
	const dy = Math.sin(a);
	const D = Math.abs(dx) * cw + Math.abs(dy) * ch;
	const f = D * (0.3 + randomUnit(s, 692_002) * 0.2);
	const pos = -D / 2 - f + (D + f) * inOutSine(p);
	options.drawPrevious();
	const bands = 14;
	const bandWidth = D / bands;
	const base = ctx.globalAlpha;
	ctx.save();
	ctx.translate(cw / 2, ch / 2);
	ctx.rotate(a);
	for (let c = 0; c < bands; c += 1) {
		const bc = -D / 2 + bandWidth * (c + 0.5);
		const alpha = clamp((pos + f - bc) / Math.max(1e-4, f));
		if (alpha <= 0.003) continue;
		ctx.save();
		ctx.beginPath();
		ctx.rect(bc - bandWidth / 2 - 0.5, -D, bandWidth + 1, D * 2);
		ctx.clip();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = base * alpha;
		options.drawCurrent();
		ctx.restore();
	}
	ctx.restore();
	ctx.globalAlpha = base;
}

/**
 * 光漏れ — soft patches of the scheme's accents bloom across and carry the
 * dissolve. Radial gradients are stepped into stacked discs; the screen /
 * multiply composite falls back to plain over-drawing.
 */
function drawLightLeak(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const d = pickFrom([1, -1], randomUnit(s, 693_001));
	const yQ = 0.2 + randomUnit(s, 693_002) * 0.6;
	const s0 = Math.floor(randomUnit(s, 693_003) * 100) + 3;
	const md = minDOf(options);
	const x = smoothR(0.3, 0.7, p);
	options.drawPrevious();
	if (x > 0) {
		ctx.save();
		ctx.globalAlpha *= x;
		options.drawCurrent();
		ctx.restore();
	}
	const light =
		lum(options.frame.palette.background) > 0.6 && lum(prevBgOf(options)) > 0.6;
	const a = bell(p) ** 0.8;
	const { palette: sc } = options.frame;
	const cols = [
		sc.accent,
		sc.secondary,
		mixHex({
			from: sc.accent,
			to: light ? sc.secondary : "#FFFFFF",
			progress: 0.55,
		}),
	];
	const composite = ctx.globalCompositeOperation;
	if (composite) ctx.globalCompositeOperation = light ? "multiply" : "screen";
	const strength = light ? 0.45 : 1;
	const stepAlphas = [0.1, 0.18, 0.24, 0.3, 0.4];
	for (let i = 0; i < 3; i += 1) {
		const u = inOutSine(clamp(p * 1.15 - i * 0.07));
		const fx = d > 0 ? lerpN(-0.25, 1.25, u) : lerpN(1.25, -0.25, u);
		const cx = cw * fx;
		const cy =
			ch *
			Math.max(
				0.05,
				Math.min(
					0.95,
					yQ + randomSigned(s0, i, 1) * 0.3 + (u - 0.5) * 0.2 * randomSigned(s0, i, 2),
				),
			);
		const r =
			md * (0.75 + 0.45 * randomUnit(s0, i, 3)) * (0.7 + 0.5 * bell(p));
		if (!(ctx.moveTo && ctx.lineTo && ctx.fill)) continue;
		for (let j = 0; j < 5; j += 1) {
			const radius = r * (1 - j / 5);
			const base = ctx.globalAlpha;
			ctx.globalAlpha = base * a * strength * stepAlphas[j]!;
			ctx.fillStyle = cols[i]!;
			ctx.beginPath();
			if (ctx.arc) ctx.arc(cx, cy, radius, 0, TAU);
			else {
				ctx.moveTo(cx + radius, cy);
				for (let q = 1; q <= 12; q += 1) {
					const angle = (q / 12) * TAU;
					ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
				}
			}
			ctx.fill();
			ctx.globalAlpha = base;
		}
	}
	if (composite) ctx.globalCompositeOperation = "source-over";
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * a * 0.22;
	ctx.fillStyle = cols[2]!;
	ctx.fillRect(0, 0, cw, ch);
	ctx.globalAlpha = base;
}

/** ページめくり — the old cut peels off a corner, its pale back folding over. */
function drawPagePeel(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const c0x = randomUnit(s, 694_001) < 0.7 ? cw : 0;
	const c0y = randomUnit(s, 694_002) < 0.65 ? ch : 0;
	const k = 0.4 + randomUnit(s, 694_003) * 0.4;
	let dx = c0x ? -1 : 1;
	let dy = (c0y ? -1 : 1) * k;
	const dl = Math.hypot(dx, dy);
	dx /= dl;
	dy /= dl;
	const D = Math.abs(dx) * cw + Math.abs(dy) * ch;
	const t = (inOutSine(p) * 0.6 + inQuad(p) * 0.4) * (D + 2);
	const L = (cw + ch) * 2;
	const qx = c0x + dx * t;
	const qy = c0y + dy * t;
	const sw = minDOf(options) * 0.09;
	const pb = prevBgOf(options);
	const on = clamp(p * 6);
	if (!ctx.moveTo || !ctx.lineTo) {
		// stripped contexts get a plain crossfade instead of the peel
		options.drawPrevious();
		ctx.save();
		ctx.globalAlpha *= p;
		options.drawCurrent();
		ctx.restore();
		return;
	}
	options.drawPrevious();
	// the new cut where the page has already gone, with the fold's shadow on it
	halfPlaneClip(options, qx, qy, dx, dy, -1, L, () => {
		options.drawCurrent();
		ctx.save();
		ctx.translate(qx, qy);
		ctx.rotate(Math.atan2(dy, dx));
		for (let j = 0; j < 4; j += 1) {
			const base = ctx.globalAlpha;
			ctx.globalAlpha = base * (0.38 * (1 - (j + 0.5) / 4)) * on;
			ctx.fillStyle = "#000000";
			ctx.fillRect((-sw * (j + 1)) / 4, -L, sw / 4 + 0.7, L * 2);
			ctx.globalAlpha = base;
		}
		ctx.restore();
	});
	// the flap = the peeled part mirrored across the fold line
	halfPlaneClip(options, qx, qy, dx, dy, 1, L, () => {
		const kk = 2 * (c0x * dx + c0y * dy + t);
		ctx.save();
		ctx.transform(
			1 - 2 * dx * dx,
			-2 * dx * dy,
			-2 * dx * dy,
			1 - 2 * dy * dy,
			kk * dx,
			kk * dy,
		);
		let base = ctx.globalAlpha;
		ctx.globalAlpha = base * 0.16;
		ctx.fillStyle = "#000000";
		ctx.fillRect(-sw * 0.35, -sw * 0.35, cw + sw * 0.7, ch + sw * 0.7);
		ctx.globalAlpha = base;
		ctx.fillStyle = mixHex({
			from: pb,
			to: lum(pb) > 0.5 ? "#000000" : "#FFFFFF",
			progress: 0.16,
		});
		ctx.fillRect(0, 0, cw, ch);
		base = ctx.globalAlpha;
		ctx.globalAlpha = base * 0.16;
		options.drawPrevious();
		ctx.globalAlpha = base;
		ctx.restore();
		// the fold's own shading, in the fold frame, as stepped bands
		const fw = Math.max(2, Math.min(t, sw * 2.2));
		ctx.save();
		ctx.translate(qx, qy);
		ctx.rotate(Math.atan2(dy, dx));
		const stops: [string, number][] = [
			["#000000", 0.42],
			["#000000", 0.3],
			["#000000", 0.15],
			["#FFFFFF", 0.1],
			["#000000", 0.05],
			["#000000", 0],
		];
		for (let j = 0; j < stops.length; j += 1) {
			const base = ctx.globalAlpha;
			ctx.globalAlpha = base * stops[j]![1] * on;
			ctx.fillStyle = stops[j]![0];
			ctx.fillRect((fw * j) / stops.length, -L, fw / stops.length + 0.7, L * 2);
			ctx.globalAlpha = base;
		}
		ctx.restore();
	});
}

/** 波ワイプ — the edge between the cuts is a rolling wave. */
function drawWaveWipe(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const dir = pickFrom(["L", "R", "U", "U", "D"], randomUnit(s, 695_001));
	const wv = 1.1 + randomUnit(s, 695_002) * 1.1;
	const sp =
		(0.7 + randomUnit(s, 695_003) * 0.6) *
		(randomUnit(s, 695_004) < 0.5 ? -1 : 1);
	const ph = randomUnit(s, 695_005) * 6.28;
	const hor = dir === "L" || dir === "R";
	const fromEnd = dir === "L" || dir === "U";
	const Lm = hor ? cw : ch;
	const Le = hor ? ch : cw;
	const amp = minDOf(options) * 0.055;
	const X = -amp * 1.5 - 2 + (Lm + amp * 3 + 4) * inOutCubic(p);
	const N = 48;
	const wavePhase = ph + p * sp * TAU;
	// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's edge(u, o).
	const edge = (u: number, o: number): number =>
		X +
		o +
		amp * Math.sin(((u / Le) * TAU * wv) + wavePhase) +
		amp * 0.4 * Math.sin((u / Le) * TAU * (wv * 2 + 1) - wavePhase * 1.7);
	// eslint-disable-next-line opencut/prefer-object-params -- Mirrors the source pack's pt(u, v).
	const pt = (u: number, v: number): readonly [number, number] => {
		const vv = fromEnd ? Lm - v : v;
		return hor ? [vv, u] : [u, vv];
	};
	const curve = (o: number): (readonly [number, number])[] => {
		const points: (readonly [number, number])[] = [];
		for (let i = 0; i <= N; i += 1) {
			const u = (Le * i) / N;
			points.push(pt(u, edge(u, o)));
		}
		return points;
	};
	options.drawPrevious();
	const cover: (readonly [number, number])[] = [pt(-4, -amp * 4)];
	cover.push(...curve(0));
	cover.push(pt(Le + 4, -amp * 4));
	if (!clipPolygons({ draw: options.drawCurrent, options, polygons: [cover] })) {
		// stripped contexts get a straight-edge wipe instead of the wave
		const { ctx } = options;
		ctx.save();
		ctx.beginPath();
		if (hor) ctx.rect(0, 0, Math.max(0, X), ch);
		else ctx.rect(0, 0, cw, Math.max(0, X));
		ctx.clip();
		options.drawCurrent();
		ctx.restore();
	}
	const a = bell(p) ** 0.6;
	const lw = lwOf(options, 0.006);
	strokeOutline({
		alpha: a,
		color: accentOf(options),
		options,
		points: curve(0),
		width: lw,
	});
	strokeOutline({
		alpha: a * 0.6,
		color: accentOf(options, true),
		options,
		points: curve(lw * 3.5),
		width: Math.max(1, lw * 0.4),
	});
}

/**
 * 引き伸ばし — the new cut's edge is pulled across like wet paint, the picture
 * following. The 1px column smear is an affine-stretched redraw.
 */
function drawStretchSmear(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const dir = pickFrom(["R", "L", "R", "L", "D", "U"], randomUnit(s, 696_001));
	const hor = dir !== "U" && dir !== "D";
	const fromEnd = dir === "L" || dir === "U";
	const L = hor ? cw : ch;
	const xe = Math.round(L * outCubic(clamp(p / 0.62)));
	const xb = Math.min(xe, Math.round(L * inOutCubic(clamp((p - 0.14) / 0.86))));
	options.drawPrevious();
	const b0 = fromEnd ? L - xb : 0;
	const s0 = fromEnd ? L - xe : xb;
	const src = Math.max(0, Math.min(L - 1, fromEnd ? L - xb : xb - 1));
	if (xb > 0) {
		if (hor) drawShifted(options, b0, 0, xb, ch, 0, 0, options.drawCurrent);
		else drawShifted(options, 0, b0, cw, xb, 0, 0, options.drawCurrent);
	}
	if (xe - xb > 0) {
		if (hor) {
			drawScaledPart({
				dx: s0,
				dy: 0,
				dw: xe - xb,
				dh: ch,
				draw: options.drawCurrent,
				options,
				sx: src,
				sy: 0,
				sw: 1,
				sh: ch,
			});
		} else {
			drawScaledPart({
				dx: 0,
				dy: s0,
				dw: cw,
				dh: xe - xb,
				draw: options.drawCurrent,
				options,
				sx: 0,
				sy: src,
				sw: cw,
				sh: 1,
			});
		}
		// the smear thins towards its leading edge (stepped gradient)
		const e0 = fromEnd ? L - xe : xe;
		const e1 = fromEnd ? L - xb : xb;
		const base = ctx.globalAlpha;
		for (let j = 0; j < 3; j += 1) {
			ctx.globalAlpha = base * (0.3 * (1 - (j + 0.5) / 3));
			ctx.fillStyle = "#000000";
			if (hor) {
				ctx.fillRect(e0 + ((e1 - e0) * j) / 3, 0, (e1 - e0) / 3 + 0.7, ch);
			} else {
				ctx.fillRect(0, e0 + ((e1 - e0) * j) / 3, cw, (e1 - e0) / 3 + 0.7);
			}
		}
		ctx.globalAlpha = base;
	}
	if (xe < L) {
		const lw = lwOf(options, 0.005);
		const q = fromEnd ? L - xe : xe - lw;
		const base = ctx.globalAlpha;
		ctx.globalAlpha = base * Math.min(1, p * 8);
		ctx.fillStyle = accentOf(options);
		if (hor) ctx.fillRect(q, 0, lw, ch);
		else ctx.fillRect(0, q, cw, lw);
		ctx.globalAlpha = base;
	}
}

/** 裏返し — the frame turns over like a card on its middle axis. */
function drawFlipOver(options: TreatTransTransitionDraw): void {
	if (transitionBoundary(options)) return;
	const { ctx, height: ch, width: cw } = options;
	const p = clamp(options.frame.enterProgress);
	const s = seedOf(options);
	const vert = randomUnit(s, 697_001) < 0.35;
	const d = pickFrom([1, -1], randomUnit(s, 697_002));
	const ang = inOutCubic(p) * Math.PI;
	const c = Math.cos(ang);
	const sn = Math.sin(ang);
	const f = Math.abs(c);
	ctx.fillStyle = mixHex({
		from: mixHex({
			from: prevBgOf(options),
			to: options.frame.palette.background,
			progress: p,
		}),
		to: "#000000",
		progress: 0.6,
	});
	ctx.fillRect(0, 0, cw, ch);
	if (f < 0.006) return;
	// drawn in slices so the far edge is shorter than the near one
	const N = 12;
	const per = 0.16 * sn * d * (c >= 0 ? 1 : -1);
	const face = c >= 0 ? options.drawPrevious : options.drawCurrent;
	for (let i = 0; i < N; i += 1) {
		const u0 = i / N;
		const u1 = (i + 1) / N;
		const um = (u0 + u1) / 2 - 0.5;
		const k = 1 - 0.05 * sn + per * um;
		if (vert) {
			const y0 = ch / 2 + (u0 - 0.5) * ch * f;
			const h = (ch * f) / N + 0.6;
			const w = cw * k;
			drawScaledPart({
				dx: cw / 2 - w / 2,
				dy: y0,
				dw: w,
				dh: h,
				draw: face,
				options,
				sx: 0,
				sy: u0 * ch,
				sw: cw,
				sh: ch / N,
			});
		} else {
			const x0 = cw / 2 + (u0 - 0.5) * cw * f;
			const w = (cw * f) / N + 0.6;
			const h = ch * k;
			drawScaledPart({
				dx: x0,
				dy: ch / 2 - h / 2,
				dw: w,
				dh: h,
				draw: face,
				options,
				sx: u0 * cw,
				sy: 0,
				sw: cw / N,
				sh: ch,
			});
		}
	}
	const base = ctx.globalAlpha;
	ctx.globalAlpha = base * (0.5 * sn);
	ctx.fillStyle = "#000000";
	if (vert) ctx.fillRect(0, ch / 2 - (ch * f) / 2, cw, ch * f);
	else ctx.fillRect(cw / 2 - (cw * f) / 2, 0, cw * f, ch);
	ctx.globalAlpha = base;
}
