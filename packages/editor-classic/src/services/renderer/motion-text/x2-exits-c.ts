import {
	drawEnterBDot,
	drawEnterBLine,
	drawEnterBRing,
	drawEnterBWhole,
	enterBGlyphs,
	type EnterBDraw,
	type EnterBBounds,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	inOutCubic,
	inOutSine,
	lerp,
	mixHex,
	outCubic,
	smooth,
} from "./exit-hold-geometry";
import {
	x2Bounds,
	x2Hash,
	x2Hot,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

const PI = Math.PI;

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

function hot(options: X2Draw): string {
	return x2Hot(options);
}

function inkOf(options: X2Draw): string {
	return options.frame.palette.foreground;
}

/** Same choice for every glyph of a cut (JIZURA `cutBit`). */
// eslint-disable-next-line opencut/prefer-object-params
function cutBit(options: X2Draw, salt: number): boolean {
	return (x2Hash(options.frame.cut?.seed ?? 0, salt, 977) & 1) === 1;
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
 * The item as one mutating body (JIZURA `it`): accumulated translation,
 * rotation, skew and scale plus the item's own (unrotated) box.
 */
interface X2ItemState {
	x: number;
	y: number;
	rot: number;
	skew: number;
	sx: number;
	sy: number;
	alpha: number;
	color?: string;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

function itemState(options: X2Draw): X2ItemState {
	const box = x2Bounds(options, 0);
	return {
		x: options.x,
		y: options.y,
		rot: 0,
		skew: 0,
		sx: 1,
		sy: 1,
		alpha: 1,
		x0: box.left,
		x1: box.right,
		y0: box.top,
		y1: box.bottom,
	};
}

// eslint-disable-next-line opencut/prefer-object-params
function rot2(x: number, y: number, radians: number): readonly [number, number] {
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return [x * cos - y * sin, x * sin + y * cos];
}

/** Rotate the item about a design-space point (JIZURA `pivot`). */
// eslint-disable-next-line opencut/prefer-object-params
function pivotAt(state: X2ItemState, px: number, py: number, deg: number): void {
	if (!deg) return;
	const [dx, dy] = rot2(state.x - px, state.y - py, degrees(deg));
	state.x = px + dx;
	state.y = py + dy;
	state.x0 += dx;
	state.x1 += dx;
	state.y0 += dy;
	state.y1 += dy;
	state.rot += deg;
}

/** Uniform scale about a design-space point (JIZURA `scaleAt`). */
// eslint-disable-next-line opencut/prefer-object-params
function scaleAt(state: X2ItemState, px: number, py: number, factor: number): void {
	const k = Math.max(0, factor);
	state.x = px + (state.x - px) * k;
	state.y = py + (state.y - py) * k;
	state.x0 = px + (state.x0 - px) * k;
	state.x1 = px + (state.x1 - px) * k;
	state.y0 = py + (state.y0 - py) * k;
	state.y1 = py + (state.y1 - py) * k;
	state.sx *= k;
	state.sy *= k;
}

/** Scale along the item's own axes, keeping box fraction (u, v) in place (JIZURA `stretch`). */
// eslint-disable-next-line opencut/prefer-object-params
function stretchAt(
	state: X2ItemState,
	u: number,
	v: number,
	kx: number,
	ky: number,
): void {
	const anchorX = lerpN(state.x0, state.x1, u);
	const anchorY = lerpN(state.y0, state.y1, v);
	state.x += (anchorX - state.x) * (1 - kx);
	state.y += (anchorY - state.y) * (1 - ky);
	state.x0 = anchorX + (state.x0 - anchorX) * kx;
	state.x1 = anchorX + (state.x1 - anchorX) * kx;
	state.y0 = anchorY + (state.y0 - anchorY) * ky;
	state.y1 = anchorY + (state.y1 - anchorY) * ky;
	state.sx *= kx;
	state.sy *= ky;
}

/** The same in writing terms: a = fraction along the line (JIZURA `stretchAlong`, horizontal). */
// eslint-disable-next-line opencut/prefer-object-params
function stretchAlongAt(
	state: X2ItemState,
	along: number,
	kAlong: number,
	kCross: number,
): void {
	stretchAt(state, along, 0.5, kAlong, kCross);
}

/** Design-space point at box fraction (u, v) of the item's own frame (JIZURA `at`). */
// eslint-disable-next-line opencut/prefer-object-params
function pointAt(state: X2ItemState, u: number, v: number): readonly [number, number] {
	const [dx, dy] = rot2(
		lerpN(state.x0, state.x1, u) - state.x,
		lerpN(state.y0, state.y1, v) - state.y,
		degrees(state.rot),
	);
	return [state.x + dx, state.y + dy];
}

/** Unit vector of the writing direction in design space (JIZURA `alongV`, horizontal). */
function alongVector(state: X2ItemState): readonly [number, number] {
	return rot2(1, 0, degrees(state.rot));
}

/** Unit vector across the writing direction, pointing "up" (JIZURA `crossV`, horizontal). */
function crossVector(state: X2ItemState): readonly [number, number] {
	return rot2(0, -1, degrees(state.rot));
}

function lenAlong(state: X2ItemState): number {
	return state.x1 - state.x0;
}

/** Design-space AABB of the (rotated) item box, padded (JIZURA `dBox`). */
// eslint-disable-next-line opencut/prefer-object-params
function aabbOf(state: X2ItemState, pad: number): EnterBBounds {
	const angle = degrees(state.rot);
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const corner of [
		[state.x0, state.y0],
		[state.x1, state.y0],
		[state.x0, state.y1],
		[state.x1, state.y1],
	] as const) {
		const dx = corner[0] - state.x;
		const dy = corner[1] - state.y;
		const x = state.x + dx * cos - dy * sin;
		const y = state.y + dx * sin + dy * cos;
		left = Math.min(left, x);
		right = Math.max(right, x);
		top = Math.min(top, y);
		bottom = Math.max(bottom, y);
	}
	return {
		bottom: bottom + pad,
		centerX: (left + right) / 2,
		centerY: (top + bottom) / 2,
		height: bottom - top + pad * 2,
		left: left - pad,
		right: right + pad,
		top: top - pad,
		width: right - left + pad * 2,
	};
}

/** Travel needed to carry the box fully out of the frame sideways (JIZURA `offX`). */
// eslint-disable-next-line opencut/prefer-object-params
function offFrameX(
	options: X2Draw,
	box: EnterBBounds,
	direction: number,
	pad: number,
): number {
	return (direction > 0 ? envWidth(options) - box.left : box.right) + pad;
}

/** Travel needed to carry the box fully below the frame (JIZURA `offDown`). */
// eslint-disable-next-line opencut/prefer-object-params
function offFrameDown(options: X2Draw, box: EnterBBounds, pad: number): number {
	return envHeight(options) - box.top + pad;
}

function glyphsOf(options: X2Draw): readonly X2Glyph[] {
	return enterBGlyphs(options);
}

/** Draw the item in its current pose (JIZURA's translated/rotated/skewed/scaled draw). */
function renderItem({
	options,
	state,
	dx = 0,
	dy = 0,
	alpha = state.alpha,
	color = state.color,
}: {
	readonly options: X2Draw;
	readonly state: X2ItemState;
	readonly dx?: number;
	readonly dy?: number;
	readonly alpha?: number;
	readonly color?: string;
}): void {
	if (alpha <= 0.003) return;
	drawEnterBWhole({
		alpha,
		color,
		options,
		rotation: degrees(state.rot),
		scaleX: state.sx,
		scaleY: state.sy,
		skewX: degrees(state.skew),
		translateX: state.x - options.x + dx,
		translateY: state.y - options.y + dy,
	});
}

/** Draw the item as a stroked outline in its current pose (JIZURA `toOutline` copies). */
function renderItemOutline({
	options,
	state,
	dx = 0,
	dy = 0,
	alpha,
	color,
	lineWidth,
}: {
	readonly options: X2Draw;
	readonly state: X2ItemState;
	readonly dx?: number;
	readonly dy?: number;
	readonly alpha: number;
	readonly color: string;
	readonly lineWidth: number;
}): void {
	if (alpha <= 0.003 || lineWidth <= 0.05) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseStroke = ctx.strokeStyle;
	ctx.save();
	ctx.translate(state.x + dx, state.y + dy);
	if (state.rot) ctx.rotate(degrees(state.rot));
	if (state.skew) ctx.transform(1, 0, Math.tan(degrees(state.skew)), 1, 0, 0);
	ctx.scale(state.sx, state.sy);
	ctx.globalAlpha = baseAlpha * alpha;
	ctx.lineWidth = lineWidth / Math.max(0.05, Math.min(Math.abs(state.sx), Math.abs(state.sy)));
	ctx.strokeStyle = color;
	ctx.textAlign = "center";
	for (const glyph of glyphsOf(options)) {
		ctx.strokeText?.(glyph.character, glyph.x, glyph.y, options.size * 0.76);
	}
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.strokeStyle = baseStroke;
}

/**
 * Ghost copies trailing the item (JIZURA `it.streak` / `it.echo`); the decay
 * mirrors the echo's 0.72, stagger decay is the house stand-in.
 */
function drawStreak({
	options,
	state,
	dx,
	dy,
	count,
	alpha,
	decay = 0.7,
}: {
	readonly options: X2Draw;
	readonly state: X2ItemState;
	readonly dx: number;
	readonly dy: number;
	readonly count: number;
	readonly alpha: number;
	readonly decay?: number;
}): void {
	for (let index = 1; index <= count; index += 1) {
		renderItem({
			alpha: alpha * decay ** (index - 1),
			color: state.color,
			dx: dx * index,
			dy: dy * index,
			options,
			state,
		});
	}
}

/** Filled axis-aligned bar (JIZURA `env.rect`). */
function fillBar({
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
	if (alpha <= 0.004 || width <= 0.2 || height <= 0.2) return;
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

/** Draw the item in its current pose inside one rectangle clip. */
function renderItemClipped({
	options,
	state,
	left,
	top,
	width,
	height,
	alpha = 1,
	color,
}: {
	readonly options: X2Draw;
	readonly state: X2ItemState;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
	readonly alpha?: number;
	readonly color?: string;
}): void {
	if (alpha <= 0.003 || width <= 0.2 || height <= 0.2 || state.alpha <= 0.003) {
		return;
	}
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, width, height);
	ctx.clip();
	ctx.translate(state.x, state.y);
	if (state.rot) ctx.rotate(degrees(state.rot));
	if (state.skew) ctx.transform(1, 0, Math.tan(degrees(state.skew)), 1, 0, 0);
	ctx.scale(state.sx, state.sy);
	ctx.translate(-options.x, -options.y);
	ctx.globalAlpha = baseAlpha * alpha * state.alpha;
	if (color) ctx.fillStyle = color;
	options.drawGlyph(options);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

export function drawX2ExitC(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.exit) {
		case "xjGateSwing":
		case "xjQuarterTurn":
		case "xjNeedle":
		case "xjBigWheel":
		case "xjWiper":
		case "xjRatchet":
		case "xjYank":
		case "xjTrapdoor":
		case "xjEdgeTeeter":
		case "xjPuckHit":
		case "xjRubberSnap":
		case "xjCardToss":
		case "xjWallSplat":
		case "xjSlump":
		case "xjSpringHop":
		case "xjTug":
		case "xjFocusPull":
		case "xjDoubleVision":
		case "xjColourDrain":
		case "xjComet":
		case "xjShellChase":
		case "xjShadowStay":
		case "xjThroughFocus":
		case "xjPanSmear":
		case "xjStepFade":
		case "xjOnionSkin":
			drawX2ExitCPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2ExitCPart(options: EnterBDraw): void {
	// on-twos playback shows the last drawing a little before p = 1 (JIZURA /0.88)
	if (options.frame.exitProgress / 0.88 >= 0.998) return;
	const preset = options.frame.cut?.preset.exit;
	switch (preset) {
		case "xjGateSwing":
			drawGateSwing(options);
			return;
		case "xjQuarterTurn":
			drawQuarterTurn(options);
			return;
		case "xjNeedle":
			drawNeedle(options);
			return;
		case "xjBigWheel":
			drawBigWheel(options);
			return;
		case "xjWiper":
			drawWiper(options);
			return;
		case "xjRatchet":
			drawRatchet(options);
			return;
		case "xjYank":
			drawYank(options);
			return;
		case "xjTrapdoor":
			drawTrapdoor(options);
			return;
		case "xjEdgeTeeter":
			drawEdgeTeeter(options);
			return;
		case "xjPuckHit":
			drawPuckHit(options);
			return;
		case "xjRubberSnap":
			drawRubberSnap(options);
			return;
		case "xjCardToss":
			drawCardToss(options);
			return;
		case "xjWallSplat":
			drawWallSplat(options);
			return;
		case "xjSlump":
			drawSlump(options);
			return;
		case "xjSpringHop":
			drawSpringHop(options);
			return;
		case "xjTug":
			drawTug(options);
			return;
		case "xjFocusPull":
			drawFocusPull(options);
			return;
		case "xjDoubleVision":
			drawDoubleVision(options);
			return;
		case "xjColourDrain":
			drawColourDrain(options);
			return;
		case "xjComet":
			drawComet(options);
			return;
		case "xjShellChase":
			drawShellChase(options);
			return;
		case "xjShadowStay":
			drawShadowStay(options);
			return;
		case "xjThroughFocus":
			drawThroughFocus(options);
			return;
		case "xjPanSmear":
			drawPanSmear(options);
			return;
		case "xjStepFade":
			drawStepFade(options);
			return;
		case "xjOnionSkin":
			drawOnionSkin(options);
			return;
		default:
			return;
	}
}

/** 開き戸 — the whole line is a door hinged on one end: it opens a hair the wrong way, then swings round edge-on and is gone. */
function drawGateSwing(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const hingeEnd = cutBit(options, 1) ? 1 : 0;
	const state = itemState(options);
	const hinge0 = pointAt(state, hingeEnd, -0.12);
	const hinge1 = pointAt(state, hingeEnd, 1.12);
	const turn = seg(progress, 0.1, 1);
	const angle = inOutSine(turn) * (PI / 2);
	const swing = Math.sin(angle);
	const fold =
		Math.cos(angle) + 0.05 * Math.sin(PI * seg(progress, 0, 0.3)) * (1 - turn);
	if (fold >= 0.012) {
		stretchAlongAt(state, hingeEnd, fold, 1 + 0.14 * swing);
		state.color = mixHex({
			from: inkOf(options),
			to: options.frame.palette.background,
			progress: swing * 0.5,
		});
		state.alpha = 1 - smoothBetween(0.86, 1, turn);
	} else {
		state.alpha = 0;
	}
	renderItem({ options, state });
	const lashAlpha = Math.sqrt(Math.sin(PI * clamp01(progress)));
	if (lashAlpha > 0.01) {
		drawEnterBLine({
			alpha: lashAlpha,
			color: hot(options),
			from: hinge0,
			options,
			to: hinge1,
			width: Math.max(2, size * 0.03),
		});
	}
}

/** 直角に抜ける — the line turns a quarter turn on its centre, then shoots out along its own length. */
function drawQuarterTurn(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 2) ? 1 : -1;
	const go = cutBit(options, 3) ? 1 : -1;
	const state = itemState(options);
	const center = pointAt(state, 0.5, 0.5);
	const restLength = lenAlong(state);
	const room = envHeight(options) * 0.8;
	pivotAt(
		state,
		center[0],
		center[1],
		direction * 90 * outBack(seg(progress, 0, 0.5), 1.3),
	);
	if (restLength > room) {
		scaleAt(
			state,
			center[0],
			center[1],
			lerpN(1, room / restLength, ioC(seg(progress, 0, 0.45))),
		);
	}
	const fly = iC(seg(progress, 0.42, 1));
	const axis = alongVector(state);
	const distance =
		Math.max(envWidth(options), envHeight(options)) +
		lenAlong(state) * 0.5 +
		size;
	state.x += axis[0] * distance * fly * go;
	state.y += axis[1] * distance * fly * go;
	if (fly > 0.004) {
		const whip = Math.min(1, fly * 5);
		stretchAlongAt(state, 0.5, 1 + 0.35 * whip, 1 - 0.1 * whip);
		drawStreak({
			alpha: 0.32 * whip,
			count: 3,
			dx: -axis[0] * size * 0.5 * whip * go,
			dy: -axis[1] * size * 0.5 * whip * go,
			options,
			state,
		});
	}
	renderItem({ options, state });
}

// eslint-disable-next-line opencut/prefer-object-params
function outBack(value: number, overshoot = 1.70158): number {
	const clamped = clamp01(value) - 1;
	return 1 + (overshoot + 1) * clamped ** 3 + overshoot * clamped ** 2;
}

/** 針になって飛ぶ — the line is pressed together into one thin needle across the writing direction; the needle fires off. */
function drawNeedle(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const go = cutBit(options, 4) ? 1 : -1;
	const state = itemState(options);
	const cross = crossVector(state);
	const restCross = state.y1 - state.y0;
	const squeeze = ioC(seg(progress, 0, 0.44));
	const shoot = iC(seg(progress, 0.46, 1));
	stretchAlongAt(
		state,
		0.5,
		lerpN(1, 0.022, squeeze),
		lerpN(1, 1.55, squeeze) + 1.5 * shoot,
	);
	state.color = mixHex({
		from: inkOf(options),
		to: hot(options),
		progress: squeeze * 0.85,
	});
	const distance = envHeight(options) + restCross * 4;
	state.x += cross[0] * distance * shoot * go;
	state.y += cross[1] * distance * shoot * go;
	if (shoot > 0.004) {
		const whip = Math.min(1, shoot * 6);
		drawStreak({
			alpha: 0.4 * whip,
			count: 4,
			dx: -cross[0] * size * 0.6 * whip * go,
			dy: -cross[1] * size * 0.6 * whip * go,
			options,
			state,
		});
	}
	renderItem({ options, state });
}

/** 大きな弧で去る — the line rides the rim of a big unseen wheel: it rolls back a little, then swings away along the arc. */
function drawBigWheel(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const side = cutBit(options, 5) ? 1 : -1;
	const direction = cutBit(options, 6) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const radius = Math.max(envHeight(options) * 0.75, box.width * 0.65);
	const pivotX = box.centerX;
	const pivotY = box.centerY + side * radius;
	const travel =
		envWidth(options) / 2 +
		Math.abs(box.centerX - envWidth(options) / 2) +
		box.width / 2 +
		size;
	const sweep =
		travel < radius * 0.9 ? (Math.asin(travel / radius) * 180) / PI + 14 : 150;
	const back =
		-5 * oC(seg(progress, 0, 0.2)) * (1 - ioC(seg(progress, 0.2, 0.42)));
	pivotAt(
		state,
		pivotX,
		pivotY,
		direction * side * (back + sweep * iC(seg(progress, 0.2, 1))),
	);
	state.alpha = 1 - smoothBetween(0.9, 1, progress);
	renderItem({ options, state });
}

/** 角を軸に払う — pinned at a bottom corner, the line sweeps up like a wiper blade and shrinks into its pin; the pin pops. */
function drawWiper(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const corner = cutBit(options, 7) ? 0 : 1;
	const state = itemState(options);
	const pin = pointAt(state, corner, 1);
	pivotAt(
		state,
		pin[0],
		pin[1],
		(corner ? 1 : -1) * 112 * ioC(seg(progress, 0.06, 0.88)),
	);
	scaleAt(state, pin[0], pin[1], 1 - 0.95 * iQ(seg(progress, 0.1, 0.9)));
	if (progress > 0.9) state.alpha = 0;
	renderItem({ options, state });
	const radius =
		size * 0.085 *
		outBack(seg(progress, 0, 0.12), 2) *
		(1 - iC(seg(progress, 0.86, 1)));
	if (radius > 0.3) {
		drawEnterBDot({
			alpha: 1,
			color: hot(options),
			options,
			radius,
			x: pin[0],
			y: pin[1],
		});
	}
}

/** 歯車送り — the line is turned in clicks, like a ratchet: every click a sharp 30° and a size smaller, the last click closes it. */
function drawRatchet(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const direction = cutBit(options, 8) ? 1 : -1;
	const state = itemState(options);
	const center = pointAt(state, 0.5, 0.5);
	const clicks = 5;
	let turn = 0;
	let shrink = 0;
	for (let click = 0; click < clicks; click += 1) {
		const tick = seg(progress * clicks - click, 0.05, 0.5);
		turn += outBack(tick, 2.2);
		shrink += ioC(tick);
	}
	pivotAt(state, center[0], center[1], direction * 30 * turn);
	const scale = 1 - shrink / clicks;
	if (scale < 0.02) state.alpha = 0;
	else scaleAt(state, center[0], center[1], scale);
	renderItem({ options, state });
}

/** 糸で引き抜く — a string comes in from off-screen and catches the end of the line; two tugs, then the whole line is yanked out along it. */
function drawYank(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const dx = cutBit(options, 9) ? 1 : -1;
	const pull: readonly [number, number] = [dx * 0.8, -0.6];
	const state = itemState(options);
	const anchorU = dx > 0 ? 1 : 0;
	const hook = pointAt(state, anchorU, 0.5);
	const box = aabbOf(state, 0);
	const far = (envWidth(options) + box.width * 1.2 + size) / 0.8;
	const target: readonly [number, number] = [
		hook[0] + pull[0] * far,
		hook[1] + pull[1] * far,
	];
	const seek = oC(seg(progress, 0, 0.17));
	const jolt1 = Math.sin(PI * seg(progress, 0.2, 0.32));
	const jolt2 = Math.sin(PI * seg(progress, 0.35, 0.5));
	const haul = seg(progress, 0.55, 1);
	const heave = haul ** 1.25;
	const move = size * (0.07 * jolt1 + 0.16 * jolt2) + far * heave;
	pivotAt(
		state,
		hook[0],
		hook[1],
		-dx * (2.5 * jolt1 + 5 * jolt2 + 13 * smoothBetween(0, 0.3, haul)),
	);
	state.x += pull[0] * move;
	state.y += pull[1] * move;
	if (haul > 0.02) {
		const whip = Math.min(1, haul * 4);
		drawStreak({
			alpha: 0.3 * whip,
			count: 3,
			dx: -pull[0] * size * 0.5 * whip,
			dy: -pull[1] * size * 0.5 * whip,
			options,
			state,
		});
	}
	renderItem({ options, state });
	const stringAlpha = 1 - seg(progress, 0.9, 1);
	if (stringAlpha <= 0.01) return;
	const currentHook = pointAt(state, anchorU, 0.5);
	const sag = size * 0.35 * (1 - seg(progress, 0.14, 0.24));
	const tip: readonly [number, number] = [
		lerpN(target[0], currentHook[0], seek),
		lerpN(target[1], currentHook[1], seek),
	];
	const middle: readonly [number, number] = [
		(target[0] + tip[0]) / 2,
		(target[1] + tip[1]) / 2 + sag,
	];
	const width = Math.max(1.5, size * 0.014);
	const color = hot(options);
	drawEnterBLine({ alpha: stringAlpha, color, from: target, options, to: middle, width });
	drawEnterBLine({ alpha: stringAlpha, color, from: middle, options, to: tip, width });
	if (seek >= 1) {
		drawEnterBDot({
			alpha: stringAlpha,
			color,
			options,
			radius: width * 2.2,
			x: currentHook[0],
			y: currentHook[1],
		});
	}
}

/** 床が抜ける — a floor line appears under the line; it hops, lands with a squash, the floor swings open and it drops straight through. */
function drawTrapdoor(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const floorY = box.bottom + size * 0.1;
	const leftX = box.left - size * 0.2;
	const rightX = box.right + size * 0.2;
	const half = (rightX - leftX) / 2;
	const hop = seg(progress, 0.08, 0.36);
	const squash = Math.sin(PI * seg(progress, 0.36, 0.5));
	const crouch = Math.sin(PI * seg(progress, 0, 0.1));
	stretchAt(
		state,
		0.5,
		1,
		1 + 0.1 * squash + 0.05 * crouch,
		1 - 0.24 * squash - 0.1 * crouch,
	);
	state.y +=
		-size * 0.45 * 4 * hop * (1 - hop) +
		offFrameDown(options, box, size) * iQ(seg(progress, 0.46, 1));
	renderItem({ options, state });
	const unfold = oC(seg(progress, 0, 0.1));
	const swing = degrees(86) * outBack(seg(progress, 0.43, 0.66), 1.4);
	const flapAlpha = 1 - seg(progress, 0.84, 1);
	const width = Math.max(2, size * 0.03);
	const color = hot(options);
	if (flapAlpha > 0.01 && unfold > 0.01) {
		const tipX = Math.cos(swing) * half * unfold;
		const tipY = Math.sin(swing) * half * unfold;
		drawEnterBLine({ alpha: flapAlpha, color, from: [leftX, floorY], options, to: [leftX + tipX, floorY + tipY], width });
		drawEnterBLine({ alpha: flapAlpha, color, from: [rightX, floorY], options, to: [rightX - tipX, floorY + tipY], width });
	}
}

/** 縁から落ちる — the line slides along a ledge until more than half of it hangs over the end; it tips over the edge, slips off and falls. */
function drawEdgeTeeter(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 10) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const ledgeY = box.bottom + size * 0.08;
	const edgeX = box.centerX + direction * box.width * 0.1;
	const restX = direction > 0 ? box.left - size * 0.2 : box.right + size * 0.2;
	const tip = direction * 78 * iQ(seg(progress, 0.3, 0.8));
	const slip = box.width * 0.9 * iQ(seg(progress, 0.42, 1));
	state.x += direction * box.width * 0.24 * oC(seg(progress, 0, 0.4));
	pivotAt(state, edgeX, ledgeY, tip);
	state.x += direction * Math.cos(degrees(tip)) * slip;
	state.y +=
		direction * Math.sin(degrees(tip)) * slip +
		offFrameDown(options, box, box.width * 0.5 + size) * iQ(seg(progress, 0.55, 1));
	renderItem({ options, state });
	const reach = oC(seg(progress, 0, 0.12));
	const edgeAlpha = 1 - seg(progress, 0.8, 1);
	const width = Math.max(2, size * 0.03);
	const color = hot(options);
	if (edgeAlpha > 0.01 && reach > 0.01) {
		drawEnterBLine({ alpha: edgeAlpha, color, from: [edgeX, ledgeY], options, to: [lerpN(edgeX, restX, reach), ledgeY], width });
		drawEnterBLine({ alpha: edgeAlpha, color, from: [edgeX, ledgeY - width / 2], options, to: [edgeX, ledgeY + size * 0.22 * reach], width });
	}
}

/** 横から弾かれる — a puck slides in from the side and hits the end of the line; the line shears with the blow and is knocked clean out. */
function drawPuckHit(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 11) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const puck = size * 0.3;
	const hitAt = 0.3;
	const hitX = (direction > 0 ? box.left : box.right) - direction * puck * 0.5;
	const impact = seg(progress, hitAt, 1);
	if (impact > 0) {
		const shear = 1 - 0.14 * Math.sin(PI * seg(impact, 0, 0.22));
		stretchAt(state, direction > 0 ? 1 : 0, 0.5, shear, 1);
		state.skew += direction * 22 * seg(impact, 0, 0.05) * (1 - impact) ** 3;
		const center = pointAt(state, 0.5, 0.5);
		pivotAt(state, center[0], center[1], direction * 9 * impact);
		state.x +=
			direction * offFrameX(options, box, direction, size * 1.5) * impact ** 1.15;
		state.y -= size * 0.45 * impact;
		const whip = Math.min(1, impact * 5) * (1 - impact * 0.5);
		drawStreak({
			alpha: 0.28 * whip,
			count: 3,
			dx: -direction * size * 0.4 * whip,
			dy: 0,
			options,
			state,
		});
	}
	renderItem({ options, state });
	const px =
		progress < hitAt
			? lerpN(direction > 0 ? -puck : envWidth(options) + puck, hitX, iQ(seg(progress, 0, hitAt)))
			: hitX + direction * size * 0.35 * oC(seg(progress, hitAt, 0.62));
	const puckAlpha = 1 - seg(progress, 0.6, 0.86);
	if (puckAlpha <= 0.01) return;
	fillBar({
		color: hot(options),
		height: puck,
		options,
		width: puck,
		x: px - puck / 2,
		y: box.centerY - puck / 2,
		alpha: puckAlpha,
	});
	const flash = Math.sin(PI * seg(progress, hitAt, hitAt + 0.12));
	if (flash <= 0.02) return;
	const color = hot(options);
	const width = Math.max(1.5, size * 0.02);
	for (let lane = -1; lane <= 1; lane += 1) {
		drawEnterBLine({
			alpha: puckAlpha * flash,
			color,
			from: [hitX + direction * puck * 0.7, box.centerY + lane * puck * 0.7],
			options,
			to: [
				hitX + direction * puck * (0.7 + 0.8 * flash),
				box.centerY + lane * puck * (0.7 + 0.5 * flash),
			],
			width,
		});
	}
}

/** ゴムで弾ける — pinned at one end, the line is stretched out long and thin like a rubber band; the pin lets go and it snaps away. */
function drawRubberSnap(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const anchorEnd = cutBit(options, 12) ? 0 : 1;
	const sign = anchorEnd ? -1 : 1;
	const snapAt = 0.52;
	const state = itemState(options);
	const pin = pointAt(state, anchorEnd, 0.5);
	const wind = oC(seg(progress, 0, snapAt));
	const band = 1 + 0.36 * wind;
	const bandCross = 1 - 0.2 * wind;
	stretchAlongAt(state, anchorEnd, band, bandCross);
	if (progress > snapAt) {
		const release = seg(progress, snapAt, 1);
		const recoil =
			(lerpN(1.36, 0.5, outExpo(seg(release, 0, 0.22))) +
				0.16 * Math.sin(release * 34) * Math.exp(-5 * release)) /
			1.36;
		stretchAlongAt(
			state,
			1 - anchorEnd,
			recoil,
			lerpN(1, 1.4, oC(seg(release, 0, 0.2))),
		);
		const axis = alongVector(state);
		const distance =
			Math.max(envWidth(options), envHeight(options)) + lenAlong(state) + size;
		const escape = iQ(release);
		state.x += axis[0] * sign * distance * escape;
		state.y += axis[1] * sign * distance * escape;
		const whip = Math.min(1, release * 5);
		drawStreak({
			alpha: 0.3 * whip,
			count: 3,
			dx: -axis[0] * sign * size * 0.5 * whip,
			dy: -axis[1] * sign * size * 0.5 * whip,
			options,
			state,
		});
	} else if (progress > 0.3) {
		state.x += Math.sin(progress * 190) * size * 0.006 * wind;
	}
	renderItem({ options, state });
	const pop = seg(progress, snapAt, snapAt + 0.12);
	const radius =
		size * 0.07 * outBack(seg(progress, 0, 0.1), 2) * (1 + 1.6 * pop);
	const pinAlpha = 1 - pop;
	if (pinAlpha <= 0.01 || radius <= 0.3) return;
	if (pop > 0) {
		drawEnterBRing({
			alpha: pinAlpha,
			color: hot(options),
			options,
			radius,
			width: Math.max(1.5, size * 0.02),
			x: pin[0],
			y: pin[1],
		});
		return;
	}
	drawEnterBDot({
		alpha: pinAlpha,
		color: hot(options),
		options,
		radius,
		x: pin[0],
		y: pin[1],
	});
}

/** 放り投げる — the line is tossed like a card: up and across in an arc, flipping over and over, getting smaller, and down out of the frame. */
function drawCardToss(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 13) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const rise = clamp01(progress);
	const center = pointAt(state, 0.5, 0.5);
	const phase = PI * 3.5 * rise ** 1.15;
	const face = Math.cos(phase);
	const lift = envHeight(options) * 0.7;
	scaleAt(state, center[0], center[1], 1 - 0.42 * rise);
	pivotAt(state, center[0], center[1], direction * 22 * rise);
	stretchAlongAt(state, 0.5, 1, Math.max(0.045, Math.abs(face)));
	if (face < 0) {
		state.color = mixHex({
			from: inkOf(options),
			to: options.frame.palette.background,
			progress: 0.5,
		});
	}
	state.x += direction * envWidth(options) * 0.3 * rise;
	state.y +=
		-lift * rise +
		(lift + offFrameDown(options, box, size) * 1.15) * rise * rise;
	state.alpha = 1 - smoothBetween(0.92, 1, progress);
	renderItem({ options, state });
}

/** 壁にぶつかる — the line is thrown at the side of the frame, flattens against it, then slides down the wall and out. */
function drawWallSplat(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 14) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const distance = direction > 0 ? envWidth(options) - box.right : box.left;
	const throwIn = iQ(seg(progress, 0, 0.4));
	const squash = oC(seg(progress, 0.4, 0.5));
	const rebound = Math.sin(PI * seg(progress, 0.5, 0.66));
	const fall = seg(progress, 0.58, 1);
	state.x += direction * distance * throwIn;
	if (throwIn < 1 && throwIn > 0.01) {
		drawStreak({
			alpha: 0.3 * throwIn,
			count: 3,
			dx: -direction * size * 0.5 * throwIn,
			dy: 0,
			options,
			state,
		});
	}
	if (squash > 0) {
		const kx = 1 - 0.7 * squash + 0.1 * rebound;
		const ky = 1 + 0.3 * squash + 0.5 * fall;
		stretchAt(state, direction > 0 ? 1 : 0, 0.5, kx, ky);
	}
	state.y += offFrameDown(options, box, box.height + size) * iQ(fall);
	renderItem({ options, state });
}

/** へたり込む — the air goes out of the line in three puffs: it sags lower and leans further each time, lies flat, and is whisked off along the ground. */
function drawSlump(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 15) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const levels = [1, 0.68, 0.38, 0.09];
	const walk = clamp01(progress / 0.54) * 3;
	const stage = Math.min(2, Math.floor(walk));
	const step = walk - stage;
	const level =
		lerpN(levels[stage]!, levels[stage + 1]!, oC(seg(step, 0, 0.6))) +
		0.035 * Math.sin(PI * seg(step, 0.6, 1)) * (progress < 0.54 ? 1 : 0);
	stretchAt(state, 0.5, 1, 1 + 0.1 * (1 - level), level);
	state.skew += direction * 42 * (1 - level);
	state.x +=
		direction *
		(offFrameX(options, box, direction, size * 2) * iQ(seg(progress, 0.55, 0.97)) +
			size * 0.25 * (1 - level));
	state.alpha = 1 - smoothBetween(0.9, 1, progress);
	renderItem({ options, state });
}

/** ばねで跳ぶ — the line is pressed down like a spring, lets go and leaps out of the top of the frame, still bouncing in the air. */
function drawSpringHop(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const press = ioC(seg(progress, 0, 0.34));
	const leap = seg(progress, 0.37, 1);
	const ky =
		leap > 0
			? 1 - 0.5 * Math.cos(leap * 17) * Math.exp(-4.2 * leap)
			: 1 - 0.5 * press;
	stretchAt(state, 0.5, 1, 1 - 0.32 * (ky - 1), ky);
	state.y -= (box.bottom + size * 0.8) * (1 - (1 - leap) ** 2.2);
	renderItem({ options, state });
	const baseY = box.bottom + size * 0.04;
	const width = box.width * (0.5 + 0.5 * press) * (1 + 0.5 * seg(leap, 0, 0.3));
	const baseAlpha = press * (1 - seg(leap, 0.05, 0.4));
	if (baseAlpha <= 0.01) return;
	fillBar({
		color: hot(options),
		height: Math.max(2, size * 0.025),
		options,
		width,
		x: box.centerX - width / 2,
		y: baseY,
		alpha: baseAlpha,
	});
}

/** 揺さぶられる — something pulls the line one way, then harder the other, then harder again, and the last pull takes it out of the frame. */
function drawTug(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 16) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const width = envWidth(options);
	const off = offFrameX(options, box, direction, size * 2);
	const pulls = [0, -0.045 * width, 0.08 * width, -0.13 * width];
	const times = [0, 0.17, 0.36, 0.56];
	const xAt = (q: number): number => {
		const value = clamp(q);
		if (value >= times[3]!) {
			return lerpN(
				pulls[3]!,
				off - pulls[3]!,
				seg(value, times[3]!, 0.97) ** 2.4,
			);
		}
		for (let index = 0; index < 3; index += 1) {
			if (value < times[index + 1]!) {
				return lerpN(
					pulls[index]!,
					pulls[index + 1]!,
					ioC(seg(value, times[index]!, times[index + 1]!)),
				);
			}
		}
		return pulls[3]!;
	};
	const x = xAt(progress);
	const vx = (xAt(progress + 0.008) - xAt(progress - 0.008)) / width;
	state.x += direction * x;
	state.skew += direction * between(vx * 1100, -24, 24);
	const speed = Math.min(1, Math.abs(vx) * 40);
	stretchAt(state, 0.5, 0.5, 1 + 0.12 * speed, 1 - 0.05 * speed);
	if (progress > times[3]! && speed > 0.05) {
		drawStreak({
			alpha: 0.3 * speed,
			count: 3,
			dx: -direction * size * 0.5 * speed,
			dy: 0,
			options,
			state,
		});
	}
	renderItem({ options, state });
}

/** ピント送り — the focus hunts: the line goes soft, nearly snaps sharp again, then the focus is pulled right away from it. */
function drawFocusPull(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const center = pointAt(state, 0.5, 0.5);
	const hunt =
		progress < 0.3
			? 0.5 * ioC(progress / 0.3)
			: progress < 0.48
				? lerpN(0.5, 0.08, ioC(seg(progress, 0.3, 0.48)))
				: lerpN(0.08, 1, iQ(seg(progress, 0.48, 1)));
	scaleAt(state, center[0], center[1], 1 + 0.1 * hunt);
	const fade = 1 - smoothBetween(0.58, 1, progress);
	// fast-preview branch: a ring of faint copies stands in for the blur disc
	const ringAlpha = fade * 0.24 * Math.min(1, hunt * 6);
	state.alpha = fade * (1 - 0.6 * Math.min(1, hunt * 3));
	if (ringAlpha > 0.01) {
		const radius = hunt * size * 0.1;
		for (let spoke = 0; spoke < 6; spoke += 1) {
			renderItem({
				alpha: ringAlpha,
				dx: Math.cos((spoke * PI) / 3) * radius,
				dy: Math.sin((spoke * PI) / 3) * radius,
				options,
				state,
			});
		}
	}
	renderItem({ options, state });
}

/** 二重像に割れる — the image doubles across the line, each of the two doubles again along it; the four thin images drift apart and fade. */
function drawDoubleVision(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const crossSpread = size * 0.46 * oC(seg(progress, 0, 0.7));
	const alongSpread = size * 0.3 * oC(seg(progress, 0.28, 1));
	const echoAlpha =
		lerpN(1, 0.5, seg(progress, 0, 0.3)) * (1 - iQ(seg(progress, 0.4, 1)));
	const center = pointAt(state, 0.5, 0.5);
	scaleAt(state, center[0], center[1], 1 + 0.05 * progress);
	state.x += alongSpread;
	state.y -= crossSpread;
	state.alpha = echoAlpha;
	renderItem({ options, state });
	if (echoAlpha <= 0.004) return;
	renderItem({ alpha: echoAlpha, dy: crossSpread * 2, options, state });
	if (alongSpread > 0.3) {
		renderItem({ alpha: echoAlpha, dx: -alongSpread * 2, options, state });
		renderItem({
			alpha: echoAlpha,
			dx: -alongSpread * 2,
			dy: crossSpread * 2,
			options,
			state,
		});
	}
}

/** 色が抜ける — the colour drains out of the line from one end to the other, leaving a pale print of it; the print then fades. */
function drawColourDrain(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const ink = inkOf(options);
	const background = options.frame.palette.background;
	const box = aabbOf(state, size * 0.3);
	const reverse = cutBit(options, 17);
	const pale = mixHex({ from: ink, to: background, progress: 0.8 });
	const band = size * 0.45;
	const bands = 3;
	const sweep = ioC(seg(progress, 0, 0.62));
	const edge = reverse
		? lerpN(box.right + band * bands, box.left, sweep)
		: lerpN(box.left - band * bands, box.right, sweep);
	const sign = reverse ? 1 : -1;
	// eslint-disable-next-line opencut/prefer-object-params
	const bandSpan = (from: number, to: number): readonly [number, number] => [
		Math.min(edge + sign * from, edge + sign * to),
		Math.max(edge + sign * from, edge + sign * to),
	];
	const fade = 1 - ioC(seg(progress, 0.5, 1));
	const [mainLo, mainHi] = bandSpan(0, -BIG * 2);
	if (sweep < 1) {
		renderItemClipped({
			height: BIG * 3,
			left: mainLo,
			options,
			state,
			top: -BIG,
			width: mainHi - mainLo,
		});
	}
	if (fade <= 0.004) return;
	for (let index = 0; index <= bands; index += 1) {
		const [lo, hi] = bandSpan(
			index * band,
			index === bands ? BIG * 2 : (index + 1) * band,
		);
		renderItemClipped({
			alpha: fade,
			color: mixHex({
				from: ink,
				to: pale,
				progress: (index + 1) / (bands + 1),
			}),
			height: BIG * 3,
			left: lo,
			options,
			state,
			top: -BIG,
			width: hi - lo,
		});
	}
}

/** 尾を引いて飛ぶ — the line dips, then climbs away on a curve, shrinking, with a tail of its own earlier positions strung out behind it. */
function drawComet(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 18) ? 1 : -1;
	const accent = hot(options);
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const away = offFrameX(options, box, direction, size * 2);
	const center = pointAt(state, 0.5, 0.5);
	// eslint-disable-next-line opencut/prefer-object-params
	const pose = (item: X2ItemState, at: number): void => {
		const u = clamp01(at);
		scaleAt(item, center[0], center[1], 1 - 0.5 * u);
		pivotAt(item, center[0], center[1], -direction * 10 * smoothBetween(0.1, 0.7, u));
		item.x += direction * away * u ** 2.5;
		item.y +=
			-envHeight(options) * 0.42 * u ** 1.7 +
			size * 0.3 * Math.sin(PI * Math.min(1, u * 2.4)) * (1 - u);
	};
	pose(state, progress);
	const trailAlpha = 0.55 * Math.min(1, progress * 5);
	if (trailAlpha > 0.01) {
		for (let index = 4; index >= 1; index -= 1) {
			const ghost = itemState(options);
			pose(ghost, progress - index * 0.055 * (0.4 + 0.6 * progress));
			renderItem({
				alpha: trailAlpha * 0.7 ** (index - 1),
				color: mixHex({ from: inkOf(options), to: accent, progress: index / 5 }),
				options,
				state: ghost,
			});
		}
	}
	state.alpha = 1 - smoothBetween(0.9, 1, progress);
	renderItem({ options, state });
}

/** 抜け殻が追う — the solid body of the line slips out sideways and leaves its empty outline standing; the shell shivers, then is sucked out after it. */
function drawShellChase(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 19) ? 1 : -1;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const away = offFrameX(options, box, direction, size * 2);
	const haul = seg(progress, 0.42, 0.96);
	const gone = iC(haul);
	const slide = seg(progress, 0, 0.48);
	state.x +=
		Math.sin(progress * 140) * size * 0.012 * seg(progress, 0.2, 0.4) * (1 - haul) +
		direction * away * gone;
	if (haul > 0) {
		const whip = Math.min(1, haul * 2.5);
		stretchAt(state, 0.5, 0.5, 1 + 0.45 * whip, 1 - 0.1 * whip);
		state.skew -= direction * 10 * Math.min(1, haul * 3);
	}
	state.alpha = 1 - smoothBetween(0.9, 1, progress);
	renderItem({ options, state });
	if (slide < 1) {
		const ghost = itemState(options);
		ghost.x += direction * away * iC(slide);
		ghost.skew += -direction * 14 * Math.sin(PI * Math.min(1, slide * 1.4));
		renderItemOutline({
			alpha: 1,
			color: inkOf(options),
			lineWidth: Math.max(1.5, size * 0.02) * Math.min(1, progress * 8),
			options,
			state: ghost,
		});
	}
}

/** 影だけ残る — the line lifts off the page and its shadow parts from it; the line flies out of the top, the shadow stays a moment longer and fades. */
function drawShadowStay(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const box = aabbOf(state, 0);
	const center = pointAt(state, 0.5, 0.5);
	const rise = oC(seg(progress, 0, 0.32));
	const lift = iC(seg(progress, 0.26, 0.74));
	const shadowColor = mixHex({
		from: options.frame.palette.background,
		to: inkOf(options),
		progress: 0.34,
	});
	const shadowAlpha = seg(progress, 0, 0.1) * (1 - ioC(seg(progress, 0.66, 1)));
	if (shadowAlpha > 0.004) {
		const shadow = itemState(options);
		shadow.x += size * 0.05 * rise;
		shadow.y += size * 0.1 * rise;
		scaleAt(shadow, center[0], center[1] + size * 0.1 * rise, 1 + 0.05 * lift);
		renderItem({ alpha: shadowAlpha, color: shadowColor, options, state: shadow });
	}
	scaleAt(state, center[0], center[1], 1 + 0.09 * rise + 0.45 * lift);
	state.x -= size * 0.03 * rise;
	state.y -=
		size * 0.22 * rise + (box.bottom + box.height * 0.8 + size) * lift;
	renderItem({ options, state });
}

/** 焦点を越える — as through a lens: the image shrinks to a point at the focus, comes out the other side upside-down, large and soft, and dissolves. */
function drawThroughFocus(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const state = itemState(options);
	const center = pointAt(state, 0.5, 0.5);
	const focusAt = 0.44;
	if (progress < focusAt) {
		scaleAt(state, center[0], center[1], 1 - iC(progress / focusAt));
		renderItem({ options, state });
		return;
	}
	const fade = seg(progress, focusAt, 1);
	const bloom = oC(fade);
	pivotAt(state, center[0], center[1], 180);
	scaleAt(state, center[0], center[1], 1.25 * bloom);
	// the fillAlpha 0.45 + stroke emphasis of the source is approximated by drawing paler
	renderItem({ alpha: 0.7 * (1 - fade) ** 1.3 * 0.45, options, state });
}

/** 流れて滲む — the camera pans off: the line smears out both ways along itself into a flat band of light and thins away. */
function drawPanSmear(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const smear = size * 0.42 * oC(seg(progress, 0, 0.85));
	const stretch = iQ(progress);
	const echoAlpha = 0.55 * seg(progress, 0, 0.14);
	stretchAlongAt(state, 0.5, 1 + 0.3 * stretch, 1 - 0.45 * stretch);
	drawStreak({ alpha: echoAlpha, count: 3, decay: 0.72, dx: smear * 1.25, dy: 0, options, state });
	drawStreak({ alpha: echoAlpha * 0.8, count: 3, decay: 0.72, dx: -smear * 1.25, dy: 0, options, state });
	state.alpha = 1 - ioC(seg(progress, 0.22, 1));
	renderItem({ options, state });
}

/** コマ落ちフェード — no in-betweens: the line drops through four held exposures, each paler and a notch lower, and the fifth frame is empty. */
function drawStepFade(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const state = itemState(options);
	const thresholds = [0.07, 0.29, 0.51, 0.73, 0.92];
	let step = 0;
	while (step < 5 && progress >= thresholds[step]!) step += 1;
	if (step === 0) {
		renderItem({ options, state });
		return;
	}
	if (step >= 5) return;
	const center = pointAt(state, 0.5, 0.5);
	state.alpha = [1, 0.66, 0.4, 0.2, 0.08][step]!;
	state.color = mixHex({
		from: inkOf(options),
		to: options.frame.palette.background,
		progress: [0, 0.12, 0.26, 0.4, 0.5][step]!,
	});
	scaleAt(state, center[0], center[1], 1 - 0.014 * step);
	state.y += size * 0.04 * step;
	renderItem({ options, state });
}

/** 残像コマ送り — the line leaves in four held poses, each a jump further along and a little more askew; the poses it has left stay as thin outlines for a beat. */
function drawOnionSkin(options: EnterBDraw): void {
	const progress = options.frame.exitProgress / 0.88;
	const size = options.size;
	const direction = cutBit(options, 20) ? 1 : -1;
	const up = cutBit(options, 21) ? -1 : 1;
	const state = itemState(options);
	const center = pointAt(state, 0.5, 0.5);
	const stride = Math.max(size * 0.9, envWidth(options) * 0.07);
	const offsets = [0, 1, 2.3, 3.9];
	const tilts = [0, -5, 4, -9];
	const scales = [1, 0.95, 0.89, 0.82];
	// eslint-disable-next-line opencut/prefer-object-params
	const pose = (item: X2ItemState, index: number): void => {
		pivotAt(item, center[0], center[1], direction * tilts[index]!);
		scaleAt(item, center[0], center[1], scales[index]!);
		item.x += direction * stride * offsets[index]!;
		item.y += up * stride * 0.32 * offsets[index]!;
	};
	const step =
		progress < 0.1 ? 0
		: progress < 0.3 ? 1
		: progress < 0.5 ? 2
		: progress < 0.7 ? 3
		: 4;
	if (step === 0) {
		renderItem({ options, state });
		return;
	}
	const fade = step === 4 ? 1 - seg(progress, 0.7, 0.98) : 1;
	const lineWidth = Math.max(1.5, size * 0.016);
	for (let past = Math.max(0, step - 2); past < step; past += 1) {
		const ghost = itemState(options);
		pose(ghost, past);
		renderItemOutline({
			alpha: (past === step - 1 ? 0.75 : 0.35) * fade,
			color: past === step - 1 ? hot(options) : inkOf(options),
			lineWidth,
			options,
			state: ghost,
		});
	}
	if (step === 4) return;
	pose(state, step);
	renderItem({ options, state });
}
