import {
	drawEnterBDot,
	drawEnterBLine,
	drawEnterBWhole,
	enterBDirection,
	enterBGlyphs,
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
	mixHex,
	outCubic,
	smooth,
} from "./exit-hold-geometry";
import {
	drawX2Glyph,
	drawX2Glyphs,
	x2Bounds,
	x2Hash,
	x2Hot,
	x2RandomSigned,
	x2Sub,
	type X2Draw,
} from "./x2-drawing";

/**
 * JIZURA x2entC — whole-item entrances: rigid transforms, physical arrivals,
 * optical arrivals, held poses. The line moves as one rigid body; rocut has
 * no faded/outline item copies or per-item blur/dash/gradient fills, so each
 * part renders its primary-item branch with plain fills (deviations noted
 * per part).
 */

const PI = Math.PI;
const TAU = PI * 2;

/** JIZURA `env.fx.motion` intensity is not modelled; 1 keeps the source's mid strength. */
const FX_MOTION = 1;

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

function ioCubic(value: number): number {
	return inOutCubic(value);
}

function oCubic(value: number): number {
	return outCubic(value);
}

function outExpo(value: number): number {
	const x = clamp(value);
	return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
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

function seedOf(options: X2Draw): number {
	return options.frame.cut?.seed ?? 0;
}

/** JIZURA `env.W` approximation for glyph-anim contracts. */
function screenW(options: X2Draw): number {
	return options.maxWidth / 0.86;
}

/** JIZURA `env.H` approximation for glyph-anim contracts. */
function screenH(options: X2Draw): number {
	return options.size * 4;
}

type Pt = readonly [number, number];

/** Rotate a design point about a pivot, then translate (JIZURA `rotateAbout` + move). */
// eslint-disable-next-line opencut/prefer-object-params
function rotatedPoint(
	x: number,
	y: number,
	angle: number,
	ax: number,
	ay: number,
	mx: number,
	my: number,
): Pt {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	const dx = x - ax;
	const dy = y - ay;
	return [ax + c * dx - s * dy + mx, ay + s * dx + c * dy + my];
}

interface WholeTransform {
	readonly alpha?: number;
	readonly color?: string;
	readonly moveX?: number;
	readonly moveY?: number;
	readonly rotateAnchor?: Pt;
	readonly rotation?: number;
	readonly scaleAnchor?: Pt;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly skewX?: number;
}

/**
 * Pushes a JIZURA item mutation sequence onto the canvas: design-space move,
 * then rotate/skew about the item anchor, then scale about its own anchor
 * (`rotateAbout` / `scaleFrom` / `sizeFrom` / `it.skew` + `moveLocal`).
 */
function pushWholeTransform({
	options,
	transform,
}: {
	readonly options: X2Draw;
	readonly transform: WholeTransform;
}): void {
	const { ctx } = options;
	const ax = transform.rotateAnchor?.[0] ?? options.x;
	const ay = transform.rotateAnchor?.[1] ?? options.y;
	const kx = transform.scaleX ?? 1;
	const ky = transform.scaleY ?? 1;
	ctx.translate(transform.moveX ?? 0, transform.moveY ?? 0);
	ctx.translate(ax, ay);
	if (transform.rotation) ctx.rotate(transform.rotation);
	if (transform.skewX) ctx.transform(1, 0, Math.tan(transform.skewX), 1, 0, 0);
	if (kx !== 1 || ky !== 1) {
		const bx = transform.scaleAnchor?.[0] ?? ax;
		const by = transform.scaleAnchor?.[1] ?? ay;
		ctx.translate(bx, by);
		ctx.scale(kx, ky);
		ctx.translate(-bx, -by);
	}
	ctx.translate(-ax, -ay);
}

/** Draw the whole line under a JIZURA item mutation sequence. */
function drawWholePart({
	options,
	transform,
}: {
	readonly options: X2Draw;
	readonly transform: WholeTransform;
}): void {
	const alpha = transform.alpha ?? 1;
	if (
		alpha <= 0.003 ||
		Math.abs(transform.scaleX ?? 1) < 0.004 ||
		Math.abs(transform.scaleY ?? 1) < 0.004
	) {
		return;
	}
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseFill = ctx.fillStyle;
	ctx.save();
	pushWholeTransform({ options, transform });
	ctx.globalAlpha = baseAlpha * alpha;
	if (transform.color) ctx.fillStyle = transform.color;
	options.drawGlyph(options);
	ctx.restore();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = baseFill;
}

/** Stroke the whole line under the same mutation sequence (JIZURA `OUTLINE` copies). */
function strokeWhole({
	color,
	lineWidth,
	options,
	transform,
}: {
	readonly color: string;
	readonly lineWidth: number;
	readonly options: X2Draw;
	readonly transform: WholeTransform;
}): void {
	const alpha = transform.alpha ?? 1;
	if (alpha <= 0.003) return;
	const { ctx } = options;
	const baseAlpha = ctx.globalAlpha;
	const baseStroke = ctx.strokeStyle;
	const baseWidth = ctx.lineWidth;
	ctx.save();
	pushWholeTransform({ options, transform });
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

/**
 * Motion streak copies behind the item (JIZURA `it.streak`): k = n..1 copies
 * at k*(dx,dy), each fading by 1 - k/(n+1).
 */
function streakCopies({
	a,
	drawAt,
	dx,
	dy,
	n,
}: {
	readonly a: number;
	readonly drawAt: (tx: number, ty: number, alpha: number) => void;
	readonly dx: number;
	readonly dy: number;
	readonly n: number;
}): void {
	for (let k = n; k >= 1; k -= 1) {
		const alpha = a * (1 - k / (n + 1));
		if (alpha <= 0.01) continue;
		drawAt(dx * k, dy * k, alpha);
	}
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

export function drawX2EntranceC(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.enter) {
		case "xgAfterimage":
		case "xgBlockSink":
		case "xgCoinSettle":
		case "xgColorPour":
		case "xgComet":
		case "xgCornerUnfurl":
		case "xgDoubleVision":
		case "xgFillDock":
		case "xgFocusHunt":
		case "xgGate":
		case "xgHangSign":
		case "xgHeavyDrop":
		case "xgJelly":
		case "xgKeyPoses":
		case "xgLensFringe":
		case "xgNewsSpin":
		case "xgNoseDive":
		case "xgPaperFall":
		case "xgPumpUp":
		case "xgPushBar":
		case "xgQuarterTurn":
		case "xgRatchet":
		case "xgRoughCut":
		case "xgShearUp":
		case "xgSignSpin":
		case "xgStampLift":
		case "xgStrobe":
		case "xgWallHit":
		case "xgWiper":
		case "xgZipLine":
			drawX2EntranceCPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2EntranceCPart(options: EnterBDraw): void {
	const preset = options.frame.cut?.preset.enter;
	switch (preset) {
		case "xgGate":
			drawGate(options);
			return;
		case "xgSignSpin":
			drawSignSpin(options);
			return;
		case "xgNoseDive":
			drawNoseDive(options);
			return;
		case "xgQuarterTurn":
			drawQuarterTurn(options);
			return;
		case "xgCornerUnfurl":
			drawCornerUnfurl(options);
			return;
		case "xgWiper":
			drawArcSweep(options);
			return;
		case "xgJelly":
			drawJelly(options);
			return;
		case "xgShearUp":
			drawShearUp(options);
			return;
		case "xgNewsSpin":
			drawNewsSpin(options);
			return;
		case "xgCoinSettle":
			drawCoinSettle(options);
			return;
		case "xgPumpUp":
			drawPumpUp(options);
			return;
		case "xgHeavyDrop":
			drawHeavyDrop(options);
			return;
		case "xgPushBar":
			drawPushBar(options);
			return;
		case "xgWallHit":
			drawWallHit(options);
			return;
		case "xgHangSign":
			drawHangSign(options);
			return;
		case "xgStampLift":
			drawStampLift(options);
			return;
		case "xgPaperFall":
			drawPaperFall(options);
			return;
		case "xgRatchet":
			drawRatchet(options);
			return;
		case "xgZipLine":
			drawZipLine(options);
			return;
		case "xgFocusHunt":
			drawFocusHunt(options);
			return;
		case "xgStrobe":
			drawStrobe(options);
			return;
		case "xgDoubleVision":
			drawDoubleVision(options);
			return;
		case "xgComet":
			drawComet(options);
			return;
		case "xgFillDock":
			drawFillDock(options);
			return;
		case "xgColorPour":
			drawColorPour(options);
			return;
		case "xgBlockSink":
			drawBlockSink(options);
			return;
		case "xgLensFringe":
			drawLensFringe(options);
			return;
		case "xgAfterimage":
			drawAfterimage(options);
			return;
		case "xgKeyPoses":
			drawKeyPoses(options);
			return;
		case "xgRoughCut":
			drawRoughCut(options);
			return;
		default:
			return;
	}
}

/** 片開き戸 — the whole line is a door hinged on one edge: it swings shut, rebounds once and closes. */
function drawGate(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const dir = enterBDirection(options, 11);
	const size = options.size;
	const th = 88 * Math.abs(springOf(progress, 1.6, 2.2));
	const k = Math.max(0.02, Math.cos(degrees(th)));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 8),
			color: mixHex({
				from: options.frame.palette.foreground,
				progress: (1 - k) * 0.5,
				to: options.frame.palette.background,
			}),
			scaleAnchor: [dir > 0 ? b.left : b.right, b.centerY],
			scaleX: k,
			scaleY: 1,
		},
	});
	const alpha = 1 - sstep(0.55, 0.95, progress);
	if (alpha <= 0.01) return;
	const width = Math.max(2, size * 0.035);
	const m = size * 0.12;
	const x0 = dir > 0 ? b.left - width - m : b.right + m;
	fillRect(
		options,
		x0,
		b.top - m,
		x0 + width,
		b.top - m + b.height + m * 2,
		options.frame.palette.accent,
		alpha,
	);
}

/** 回転看板 — the line turns one and a half times around its upright axis, showing its dim back. */
function drawSignSpin(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const th = (1 - oCubic(progress)) * 540;
	const cosine = Math.cos(degrees(th));
	const k = Math.max(0.03, Math.abs(cosine));
	const color = mixHex({
		from: options.frame.palette.foreground,
		progress: cosine < 0 ? 0.55 : (1 - k) * 0.35,
		to: options.frame.palette.background,
	});
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			alpha: clamp(progress * 5),
			color,
			scaleX: (cosine < 0 ? -1 : 1) * k,
			scaleY: 1,
			translateX: (b.centerX - glyph.x) * (1 - k),
		}),
	});
}

/** 前のめり — slides in and brakes hard: the body pitches forward on its front bottom corner. */
function drawNoseDive(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 13);
	const distance =
		Math.min(screenW(options) * 0.45, Math.max(size * 3, b.width * 0.6)) *
		(0.7 + 0.5 * FX_MOTION);
	const e = oQuart(progress / 0.5);
	const t = (progress - 0.26) / 0.74;
	const pitch =
		t <= 0 ? 0 : t < 0.28 ? outCubic(t / 0.28) : 1 - bounce((t - 0.28) / 0.72);
	const amp = Math.min(15, Math.max(5, (size * 30) / Math.max(1, b.width)));
	const anchorX = dir > 0 ? b.right : b.left;
	const rotation = degrees(dir * amp * pitch);
	const base = {
		moveX: -dir * distance * (1 - e),
		rotateAnchor: [anchorX, b.bottom] as const,
		rotation,
	};
	if (e < 0.98) {
		streakCopies({
			a: 0.3 * (1 - e),
			drawAt: (tx, ty, alpha) =>
				drawWholePart({
					options,
					transform: { ...base, alpha, moveX: base.moveX + tx, moveY: ty },
				}),
			dx: -dir * size * 0.3 * (1 - e),
			dy: 0,
			n: 3,
		});
	}
	drawWholePart({ options, transform: { ...base, alpha: clamp(progress * 7) } });
}

/** 四分回転 — the line stands on end, turns a quarter and lands level with a small over-rotation. */
function drawQuarterTurn(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const dir = enterBDirection(options, 15);
	const scale = lerpN(0.5, 1, oCubic(progress));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 5),
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(dir * 90 * (1 - enterBOutBack(progress, 1.5))),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** 角から展開 — the line grows out of one of its own corners while swinging round that corner. */
function drawCornerUnfurl(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const corner = x2Hash(seedOf(options), 17) % 4;
	const ax = corner & 1 ? b.right : b.left;
	const ay = corner & 2 ? b.bottom : b.top;
	const sign = (corner & 1) ^ ((corner >> 1) & 1) ? 1 : -1;
	const scale = Math.max(0.04, enterBOutBack(progress, 1.3));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 6),
			rotateAnchor: [ax, ay],
			rotation: degrees(sign * 40 * springOf(progress, 2.8, 1.5)),
			scaleAnchor: [ax, ay],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** 弧で滑走 — the line rides in on a wide arc around a far pivot, like the tip of a wiper blade. */
function drawArcSweep(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const dir = enterBDirection(options, 19);
	const up = x2Hash(seedOf(options), 20) & 1;
	const radius = Math.max(
		Math.min(screenW(options), screenH(options)) * 0.85,
		b.width * 0.7,
	);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 6),
			rotateAnchor: [b.centerX, b.centerY + (up ? -radius : radius)],
			rotation: degrees(dir * 40 * (1 - enterBOutBack(progress, 1.2))),
		},
	});
}

/** ぷるん — the whole line pops up from the ground like jelly: width and height overshoot out of phase. */
function drawJelly(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const ph = 1.0;
	const d = Math.exp(-4 * progress) * (1 - progress ** 3);
	// Overshoot (scale > 1) is kept smaller than the dip so long lines stay on screen.
	const os = (value: number): number => (value < 0 ? value * 0.35 : value);
	const sx = Math.max(0.03, 1 - os(d * Math.cos(3 * PI * progress)));
	const sy = Math.max(
		0.03,
		1 -
			os((d * Math.cos(3 * PI * progress - ph)) / Math.cos(ph)) *
				(1 - 0.3 * sstep(0, 0.5, progress)),
	);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 8),
			scaleAnchor: [b.centerX, b.bottom],
			scaleX: sx,
			scaleY: sy,
		},
	});
}

/** 斜体起こし — the line lies sheared flat along its baseline and whips upright, leaning past vertical once. */
function drawShearUp(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 23);
	const tn =
		dir *
		Math.min(2.2, (size * 2.6) / Math.max(1, b.height)) *
		springOf(progress, 3.0, 2.3);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 5),
			moveX: -tn * (b.bottom - options.y),
			skewX: Math.atan(tn),
		},
	});
}

/** 号外スピン — the line spins in from a dot, two full turns, like a headline hitting the screen. */
function drawNewsSpin(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const dir = enterBDirection(options, 25);
	const scale = Math.max(0.03, sstep(0, 1, progress));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 4),
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(dir * 720 * (1 - oCubic(progress))),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** コイン着地 — the line rattles flat like a coin settling: tipping faster and faster, less and less. */
function drawCoinSettle(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const ph = TAU * (1.5 * progress + 4.5 * progress * progress);
	const d = (1 - progress) ** 1.3;
	const k = Math.max(0.05, 1 - 0.88 * d * (0.5 + 0.5 * Math.cos(ph)));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 7),
			color: mixHex({
				from: options.frame.palette.foreground,
				progress: (1 - k) * 0.4,
				to: options.frame.palette.background,
			}),
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(5 * d * Math.sin(ph / 2) * (1 - progress)),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: 1,
			scaleY: k,
		},
	});
}

/** 空気入れ — pumped up in three puffs: each stroke swells the line past a size, it sags, the last fills it. */
function drawPumpUp(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const levels = [0.02, 0.45, 0.75, 1];
	const x3 = progress * 3;
	const k = Math.min(2, Math.floor(x3));
	const f = x3 - k;
	let size = lerpN(
		levels[k]!,
		levels[k + 1]!,
		enterBOutBack(clamp(f / 0.5), 2.4),
	);
	if (k < 2) size -= 0.06 * sstep(0.55, 1, f);
	const puff = Math.sin(PI * clamp(f / 0.5)) * 0.07;
	const scale = Math.max(0.02, size);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 10),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale * (1 + puff),
			scaleY: scale * (1 - puff * 0.6),
		},
	});
}

/** どすん — the line falls as one heavy body, flattens on the floor and hops twice, squashing less each time. */
function drawHeavyDrop(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const distance = size * 2.6 + b.height * 0.5;
	// eslint-disable-next-line opencut/prefer-object-params
	const seg = (from: number, to: number): number =>
		clamp((progress - from) / (to - from));
	let dy = 0;
	let sy = 1;
	if (progress < 0.3) {
		const t = progress / 0.3;
		dy = -(1 - t * t) * distance;
		sy = 1 + 0.22 * t;
	} else if (progress < 0.42) {
		sy = 1 - 0.34 * Math.sin(PI * seg(0.3, 0.42));
	} else if (progress < 0.7) {
		const u = seg(0.42, 0.7);
		dy = -4 * u * (1 - u) * size * 0.55;
		sy = 1 + 0.1 * Math.sin(PI * u);
	} else if (progress < 0.78) {
		sy = 1 - 0.2 * Math.sin(PI * seg(0.7, 0.78));
	} else if (progress < 0.92) {
		const u = seg(0.78, 0.92);
		dy = -4 * u * (1 - u) * size * 0.14;
	} else {
		sy = 1 - 0.07 * Math.sin(PI * seg(0.92, 1));
	}
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 10),
			moveY: dy,
			scaleAnchor: [b.centerX, b.bottom],
			scaleX: 1 / sy ** 0.35,
			scaleY: sy,
		},
	});
	if (progress < 0.3) return;
	const t = clamp((progress - 0.3) / 0.4);
	const alpha = (1 - t) * 0.9;
	if (alpha <= 0.01) return;
	const w = b.width * (0.6 + 0.6 * oCubic(t));
	const h = Math.max(2, size * 0.035 * (1 - t));
	fillRect(
		options,
		b.centerX - w / 2,
		b.bottom + size * 0.06,
		b.centerX + w / 2,
		b.bottom + size * 0.06 + h,
		options.frame.palette.accent,
		alpha,
	);
}

/** 押し棒 — a bar shoves the line into place at a steady pace; the bar pulls away and the line relaxes. */
function drawPushBar(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 29);
	const tP = 0.6;
	const a = 0.25;
	const v = 1 / (1 - a / 2);
	const distance = Math.min(
		screenW(options) * 0.42,
		b.width * 0.35 + size * 2.4,
	);
	let off = 0;
	let sq = 1;
	let t2 = 0;
	if (progress < tP) {
		const t = progress / tP;
		const e = t < a ? (v * t * t) / (2 * a) : v * (t - a / 2);
		off = -dir * distance * (1 - e);
		sq = 1 - 0.09 * sstep(0, 0.15, t);
	} else {
		t2 = (progress - tP) / (1 - tP);
		sq = 1 - 0.09 * springOf(t2, 3.5, 3);
	}
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 8),
			moveX: off,
			scaleAnchor: [dir > 0 ? b.left : b.right, b.centerY],
			scaleX: sq,
			scaleY: 1,
		},
	});
	const alpha = progress < tP ? 1 : 1 - sstep(0.25, 0.85, t2);
	if (alpha <= 0.01) return;
	const bw = Math.max(6, size * 0.09);
	const m = size * 0.2;
	const gap = size * 0.06 + inCubic(t2) * size * 3;
	const x0 = dir > 0 ? b.left - gap - bw : b.right + gap;
	fillRect(options, x0, b.top - m, x0 + bw, b.bottom + m, options.frame.palette.accent, alpha);
}

/** 壁当て — the line speeds in from the side, hits an unseen wall, crumples against it and springs back. */
function drawWallHit(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 31);
	const tI = 0.4;
	const distance =
		Math.min(screenW(options) * 0.45, Math.max(size * 3.5, b.width * 0.5)) *
		(0.7 + 0.5 * FX_MOTION);
	const front = dir > 0 ? b.right : b.left;
	let off = 0;
	let sq = 1;
	let t = 0;
	if (progress < tI) {
		const u = progress / tI;
		off = -dir * distance * (1 - u ** 3);
		sq = 1 + 0.18 * u * u;
		streakCopies({
			a: 0.35 * u,
			drawAt: (tx, ty, alpha) =>
				drawWholePart({
					options,
					transform: {
						alpha,
						moveX: off + tx,
						moveY: ty,
						scaleAnchor: [front, b.centerY],
						scaleX: sq,
						scaleY: 1 / sq ** 0.5,
					},
				}),
			dx: -dir * size * 0.5 * u * u,
			dy: 0,
			n: 4,
		});
	} else {
		t = (progress - tI) / (1 - tI);
		const u = clamp((t - 0.16) / 0.84);
		sq =
			t < 0.16
				? 1 - 0.36 * Math.sin((PI / 2) * (t / 0.16))
				: 1 - 0.36 * springOf(u, 3.2, 2.6);
		off = -dir * size * 0.4 * Math.sin(PI * u) * (1 - u);
	}
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 6),
			moveX: off,
			scaleAnchor: [front, b.centerY],
			scaleX: sq,
			scaleY: 1 / sq ** 0.5,
		},
	});
	if (progress < tI) return;
	const alpha = Math.exp(-t * 5) * (1 - t);
	if (alpha <= 0.01) return;
	const bw = Math.max(4, size * 0.06);
	const m = size * (0.25 + 0.5 * oCubic(t));
	const x0 = dir > 0 ? b.right + size * 0.05 : b.left - size * 0.05 - bw;
	fillRect(options, x0, b.top - m, x0 + bw, b.bottom + m, options.frame.palette.accent, alpha);
}

/** 吊り看板 — the line is let down on two chains like a hanging sign and rocks until it hangs still. */
function drawHangSign(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 33);
	const length = size * 0.9 + b.height * 0.5;
	const inset = b.width * 0.1;
	const amp = Math.min(12, Math.max(3.5, (size * 34) / Math.max(1, b.width)));
	const rotation = degrees(dir * amp * springOf(progress, 2.2, 4.4));
	const moveY = -size * 1.2 * (1 - oCubic(clamp(progress / 0.3)));
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 6),
			moveY,
			rotateAnchor: [b.centerX, b.centerY - length],
			rotation,
		},
	});
	const alpha = (1 - sstep(0.7, 0.98, progress)) * 0.75;
	if (alpha <= 0.01) return;
	const lw = Math.max(1.5, size * 0.02);
	// JIZURA pins the chain tops to design y = -20; rocut has no canvas height, so they hang from far above.
	const chainTop = b.top - size * 3;
	for (const side of [0, 1]) {
		const x = side === 0 ? b.left + inset : b.right - inset;
		const current = rotatedPoint(
			x,
			b.top,
			rotation,
			b.centerX,
			b.centerY - length,
			0,
			moveY,
		);
		drawEnterBLine({
			alpha,
			color: x2Sub(options),
			from: [x, chainTop],
			options,
			to: current,
			width: lw,
		});
		drawEnterBDot({
			alpha,
			color: options.frame.palette.accent,
			options,
			radius: lw * 1.7,
			x: current[0],
			y: current[1],
		});
	}
}

/** 判子の跳ね — the line is pressed down hard like a rubber stamp; the die lifts off and leaves the print. */
function drawStampLift(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 35);
	const tI = 0.3;
	if (progress < tI) {
		const t = inCubic(progress / tI);
		const scale = lerpN(1.45, 0.93, t);
		drawWholePart({
			options,
			transform: {
				alpha: clamp((progress / tI) * 2.5),
				rotateAnchor: [b.centerX, b.centerY],
				rotation: degrees(-dir * 7 * (1 - t)),
				scaleAnchor: [b.centerX, b.centerY],
				scaleX: scale,
				scaleY: scale,
			},
		});
		return;
	}
	const t = (progress - tI) / (1 - tI);
	const lift = clamp(t / 0.85);
	const scale = lerpN(0.93, 1, oCubic(clamp(t / 0.5)));
	drawWholePart({
		options,
		transform: {
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
	if (lift >= 1) return;
	const rise = oCubic(lift);
	strokeWhole({
		color: x2Hot(options),
		lineWidth: Math.max(1.5, size * 0.03),
		options,
		transform: {
			alpha: 0.8 * (1 - lift) ** 1.4,
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(dir * 5 * rise),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: 1 + 0.45 * rise,
			scaleY: 1 + 0.45 * rise,
		},
	});
}

/** ひらり着地 — the line sinks like a dropped sheet of paper, sliding from side to side and tilting. */
function drawPaperFall(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 37);
	const ph = progress * TAU * 1.75;
	const d = (1 - progress) ** 1.2;
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 4),
			moveX: dir * size * 0.9 * Math.sin(ph) * d,
			moveY: -size * 2.3 * (1 - Math.sin((progress * PI) / 2)),
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(
				-dir * 12 * Math.cos(ph) * d * sstep(0, 0.15, 1 - progress),
			),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: 1,
			scaleY: 1 - 0.3 * Math.abs(Math.sin(ph)) * d,
		},
	});
}

/** ラチェット — the line is cranked in click by click: four short jerks, each stopping dead with a tiny kick. */
function drawRatchet(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 39);
	const n = 4;
	const x4 = progress * n;
	const k = Math.min(n - 1, Math.floor(x4));
	const f = x4 - k;
	const e = (k + enterBOutBack(clamp(f / 0.4), 2.6)) / n;
	const distance =
		Math.min(screenW(options) * 0.4, size * 2.6) * (0.7 + 0.5 * FX_MOTION);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * n * 2.5),
			moveX: -dir * distance * (1 - e),
			rotateAnchor: [b.centerX, b.centerY],
			rotation: degrees(
				dir * 2.4 * Math.exp(-f * 7) * Math.sin(f * 18) * (1 - f),
			),
		},
	});
}

/** 滑車 — the line rides down a slanted wire on a pulley, is stopped short and swings forward under it. */
function drawZipLine(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 41);
	const tS = 0.55;
	const slope = 0.42;
	const hang = size * 0.7;
	const distance = Math.max(size * 3, screenW(options) * 0.42);
	const e = clamp(progress / tS) ** 1.6;
	const t = (progress - tS) / (1 - tS);
	const amp = Math.min(13, Math.max(4, (size * 40) / Math.max(1, b.width)));
	const angle =
		progress < tS
			? dir * amp * sstep(0, 0.4, progress / tS)
			: dir * amp * Math.cos(PI * 2.4 * t) * (1 - t) ** 1.4;
	const ox = -dir * distance * (1 - e);
	const oy = -slope * distance * (1 - e);
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 6),
			moveX: ox,
			moveY: oy,
			rotateAnchor: [b.centerX, b.top - hang],
			rotation: degrees(angle),
		},
	});
	const alpha = (1 - sstep(0.72, 0.98, progress)) * 0.8;
	if (alpha <= 0.01) return;
	const lw = Math.max(1.5, size * 0.02);
	const far = Math.max(screenW(options), screenH(options)) * 1.5;
	const px = b.centerX;
	const py = b.top - hang;
	drawEnterBLine({
		alpha,
		color: x2Sub(options),
		from: [px - dir * far, py - slope * far],
		options,
		to: [px + dir * size * 0.5, py + slope * size * 0.5],
		width: lw,
	});
	const attach = rotatedPoint(
		b.centerX,
		b.top,
		degrees(angle),
		px,
		py,
		ox,
		oy,
	);
	drawEnterBLine({
		alpha,
		color: x2Sub(options),
		from: [px + ox, py + oy],
		options,
		to: attach,
		width: lw,
	});
	drawEnterBDot({
		alpha,
		color: options.frame.palette.accent,
		options,
		radius: lw * 2.4,
		x: px + ox,
		y: py + oy,
	});
}

/** ピント迷い — autofocus hunting: the blurred line snaps sharp, slips out once more and locks. */
function drawFocusHunt(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const focus =
		progress < 0.45
			? 1 - ioCubic(progress / 0.45)
			: progress < 0.85
				? 0.42 * Math.sin((PI * (progress - 0.45)) / 0.4)
				: 0;
	// Blur is not modelled; the pack's own no-filter echo fallback stands in.
	const echoScale = 1 + 0.035 * focus;
	const echoAlpha = 0.35 * focus;
	if (echoAlpha > 0.01) {
		for (let k = 3; k >= 1; k -= 1) {
			drawEnterBWhole({
				alpha: echoAlpha * 0.7 ** (k - 1),
				options,
				scaleX: echoScale ** k,
				scaleY: echoScale ** k,
			});
		}
	}
	const scale = 1 + 0.08 * focus;
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 3) ** 0.7 * (1 - 0.35 * focus),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** ストロボ — three flash exposures: the line caught large and off to the side, closer, then on its mark. */
function drawStrobe(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 45);
	const x3 = progress * 3;
	const k = Math.min(2, Math.floor(x3));
	const f = x3 - k;
	const poses: readonly (readonly [number, number, number])[] = [
		[1.3, 0.34, -0.2],
		[1.13, -0.16, 0.09],
		[1, 0, 0],
	];
	const pose = poses[k]!;
	drawWholePart({
		options,
		transform: {
			alpha:
				k < 2 ? 0.9 * Math.exp(-f * 3.2) * clamp(progress * 25) : 1,
			color: mixHex({
				from: options.frame.palette.foreground,
				progress: k < 2 ? 0.5 : 0.9 * Math.exp(-f * 5) * (1 - f),
				to: x2Hot(options),
			}),
			moveX: dir * size * pose[1],
			moveY: size * pose[2],
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: pose[0],
			scaleY: pose[0],
		},
	});
}

/** 二重視 — two half-strength copies of the line drift across each other and fuse into one sharp line. */
function drawDoubleVision(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const d = size * 0.8 * (1 - progress) ** 1.5 * Math.cos(2.5 * PI * progress);
	const baseAlpha = clamp(progress * 4);
	const copyAlpha = 0.55 * (1 - sstep(0.7, 1, progress)) * baseAlpha;
	if (copyAlpha > 0.01) {
		drawEnterBWhole({ alpha: copyAlpha, options, translateX: -2 * d });
	}
	drawEnterBWhole({
		alpha: baseAlpha * lerpN(0.55, 1, sstep(0.6, 1, progress)),
		options,
		translateX: d,
	});
}

/** 尾引き着地 — the line drops in ahead of a long trail of afterimages, which then catches up with it. */
function drawComet(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	// Horizontal branch: the comet always falls in from above (JIZURA dir = -1).
	const dir = -1;
	const e = outExpo(clamp(progress / 0.35));
	const distance = size * 3 * (0.7 + 0.5 * FX_MOTION);
	const trailLength =
		size * 2.4 * clamp(progress / 0.12) * (1 - oCubic((progress - 0.25) / 0.75));
	const moveY = dir * distance * (1 - e);
	const alpha = clamp(progress * 8);
	if (trailLength > 0.5) {
		streakCopies({
			a: 0.55,
			drawAt: (tx, ty, streakAlpha) =>
				drawEnterBWhole({ alpha: streakAlpha, options, translateY: moveY + ty }),
			dx: 0,
			dy: (dir * trailLength) / 8,
			n: 8,
		});
	}
	drawEnterBWhole({ alpha, options, translateY: moveY });
}

/** 塗り合わせ — a hairline outline waits in place; the solid fill slides in off-register and docks into it. */
function drawFillDock(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 51);
	const q = clamp((progress - 0.22) / 0.78);
	const k = 1 - enterBOutBack(q, 1.6);
	const ox = dir * size * 0.5 * k;
	const oy = size * 0.32 * k;
	const outlineAlpha = clamp(progress * 7) * (1 - sstep(0.8, 1, progress));
	if (outlineAlpha > 0.01) {
		strokeWhole({
			color: options.frame.palette.foreground,
			lineWidth: Math.max(1.2, size * 0.022),
			options,
			transform: { alpha: outlineAlpha, moveX: -ox, moveY: -oy },
		});
	}
	drawEnterBWhole({
		alpha: clamp(q * 5) * lerpN(0.8, 1, q),
		options,
		translateX: ox,
		translateY: oy,
	});
}

/** 色替わり — the line pops up in the accent colour, then its own colour pours down behind a thin band. */
function drawColorPour(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const accent = x2Hot(options);
	const band = x2Sub(options);
	const scale = lerpN(0.8, 1, enterBOutBack(clamp(progress / 0.3), 2));
	const k = ioCubic((progress - 0.22) / 0.72) * 1.12;
	// The vertical gradient pour collapses to a tint sweep through the row's
	// centre (single-line text): accent → band → own colour as the band passes.
	const amount = clamp((clamp(k) - 0.5) / 0.12);
	const color =
		amount <= 0
			? accent
			: amount >= 1
				? options.frame.palette.foreground
				: amount < 0.5
					? mixHex({ from: accent, progress: amount * 2, to: band })
					: mixHex({
							from: band,
							progress: (amount - 0.5) * 2,
							to: options.frame.palette.foreground,
						});
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 8),
			color,
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** 厚み沈み — the line arrives as a long extruded block; the depth sinks back into the page. */
function drawBlockSink(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const size = options.size;
	const dir = enterBDirection(options, 55);
	const length =
		size * 1.3 * (1 - oQuart(progress)) * clamp(progress * 5 + 0.25);
	const alpha = clamp(progress * 6);
	if (length < 0.5) {
		drawEnterBWhole({ alpha, options });
		return;
	}
	const dx = dir * length * 0.72;
	const dy = length * 0.7;
	const layers = Math.min(
		26,
		Math.max(1, Math.ceil(length / Math.max(1.5, size * 0.035))),
	);
	const depthColor = mixHex({
		from: x2Hot(options),
		progress: 0.3,
		to: options.frame.palette.background,
	});
	const layerAlpha = clamp(length / (size * 0.18));
	for (const glyph of enterBGlyphs(options)) {
		for (let k = layers; k >= 1; k -= 1) {
			drawX2Glyph({
				glyph,
				options,
				transform: {
					alpha: alpha * layerAlpha * (1 - ((k - 1) / layers) * 0.85),
					color: depthColor,
					translateX: (dx * k) / layers,
					translateY: (dy * k) / layers,
				},
			});
		}
		drawX2Glyph({ glyph, options, transform: { alpha } });
	}
}

/** 色収差 — lens fringing: two coloured copies sit larger around the line and shrink onto it. */
function drawLensFringe(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const k = (1 - progress) ** 2;
	// ghostA/ghostB are not in rocut's palette; accent and secondary stand in.
	const colors = [options.frame.palette.accent, options.frame.palette.secondary];
	const copyAlpha = 0.75 * Math.min(1, k * 3) * clamp(progress * 6);
	if (copyAlpha > 0.01) {
		for (let j = 0; j < 2; j += 1) {
			const scale = 1 + (j ? 0.16 : 0.32) * k;
			drawEnterBWhole({
				alpha: copyAlpha,
				color: colors[j],
				options,
				scaleX: scale,
				scaleY: scale,
			});
		}
	}
	const scale = 1 + 0.05 * k;
	drawWholePart({
		options,
		transform: {
			alpha: clamp(progress * 3),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** 残像焼き — one bright flash of the line, then a faint after-image slowly burns in to full strength. */
function drawAfterimage(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const hot = x2Hot(options);
	const tF = 0.1;
	if (progress < tF) {
		drawWholePart({
			options,
			transform: {
				alpha: clamp(progress / 0.03),
				color: mixHex({
					from: options.frame.palette.foreground,
					progress: 0.85,
					to: hot,
				}),
				scaleAnchor: [b.centerX, b.centerY],
				scaleX: 1.05,
				scaleY: 1.05,
			},
		});
		return;
	}
	const drop = sstep(tF, tF + 0.1, progress);
	const rise = inOutSine(clamp((progress - 0.28) / 0.72));
	const scale = 1 + 0.05 * (1 - drop);
	drawWholePart({
		options,
		transform: {
			alpha: lerpN(lerpN(1, 0.14, drop), 1, rise),
			color: mixHex({
				from: options.frame.palette.foreground,
				progress: 0.85 * (1 - drop),
				to: hot,
			}),
			scaleAnchor: [b.centerX, b.centerY],
			scaleX: scale,
			scaleY: scale,
		},
	});
}

/** キーポーズ — three held drawings and the rest pose: far and tilted, big and leaning, almost there, home. */
function drawKeyPoses(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const dir = enterBDirection(options, 61);
	// [until progress, dx, dy, rot, scale]
	const poses: readonly (readonly number[])[] = [
		[0.26, -1.0, 0.45, -13, 0.7],
		[0.52, 0.34, -0.3, 8, 1.1],
		[0.74, -0.14, 0.08, -3.5, 0.95],
		[1, 0, 0, 0, 1],
	];
	let k = 0;
	while (k < 3 && progress >= poses[k]![0]!) k += 1;
	const start = k ? poses[k - 1]![0]! : 0;
	const f = (progress - start) / (poses[k]![0]! - start);
	const pose = poses[k]!;
	const previous = k ? poses[k - 1] : null;
	const settle = k === 3 ? 0.06 * (1 - oCubic(clamp(f / 0.6))) : 0;
	const scale = pose[4]! + settle;
	const base = {
		moveX: dir * size * pose[1]!,
		moveY: size * pose[2]!,
		rotateAnchor: [b.centerX, b.centerY] as const,
		rotation: degrees(dir * pose[3]!),
		scaleAnchor: [b.centerX, b.centerY] as const,
		scaleX: scale,
		scaleY: scale,
	};
	if (previous && f < 0.22) {
		streakCopies({
			a: 0.4,
			drawAt: (tx, ty, alpha) =>
				drawWholePart({
					options,
					transform: {
						...base,
						alpha,
						moveX: base.moveX + tx,
						moveY: base.moveY + ty,
					},
				}),
			dx: (dir * size * (previous[1]! - pose[1]!)) / 4,
			dy: (size * (previous[2]! - pose[2]!)) / 4,
			n: 3,
		});
	}
	drawWholePart({
		options,
		transform: { ...base, alpha: clamp(progress * 20) },
	});
}

/** ラフから清書 — a shaky pencil outline on threes, a half-inked drawing, then the clean final line. */
function drawRoughCut(options: EnterBDraw): void {
	const progress = options.frame.enterProgress;
	const b = x2Bounds(options);
	const size = options.size;
	const k = Math.min(5, Math.floor(progress * 6));
	if (k >= 5) {
		drawEnterBWhole({ options });
		return;
	}
	const w = [1, 0.85, 0.7, 0.4, 0.22][k]!;
	const color = options.frame.palette.foreground;
	const pencil = mixHex({ from: color, progress: 0.5, to: x2Sub(options) });
	const jitter = (salt: number): number =>
		x2RandomSigned(options, k, salt);
	const base = {
		moveX: jitter(73) * size * 0.05 * w,
		moveY: jitter(74) * size * 0.05 * w,
		rotateAnchor: [b.centerX, b.centerY] as const,
		rotation: degrees(jitter(71) * 3 * w),
		scaleAnchor: [b.centerX, b.centerY] as const,
		scaleX: 1 + jitter(72) * 0.045 * w,
		scaleY: 1 + jitter(72) * 0.045 * w,
		skewX: degrees(jitter(75) * 5 * w),
	};
	const alpha = clamp(progress * 14);
	if (k < 3) {
		// JIZURA dashes the first pass; rocut has no dash, so the pencil pass draws solid.
		strokeWhole({
			color: pencil,
			lineWidth: Math.max(1, size * (0.014 + 0.006 * k)),
			options,
			transform: { ...base, alpha },
		});
		return;
	}
	drawWholePart({
		options,
		transform: { ...base, alpha: alpha * (k === 3 ? 0.45 : 0.8) },
	});
	strokeWhole({
		color,
		lineWidth: Math.max(1, size * 0.02),
		options,
		transform: { ...base, alpha },
	});
}
