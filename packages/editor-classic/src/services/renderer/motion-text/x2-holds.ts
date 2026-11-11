import {
	drawEnterBLine,
	enterBGlyphs,
	enterBOutBack,
	type EnterBDraw,
} from "./enter-b-drawing";
import {
	clamp01,
	degrees,
	frameStep,
	inOutCubic,
	inOutSine,
	lerp,
	mixHex,
	outCubic,
	secondsOf,
	smoothNoise,
} from "./exit-hold-geometry";
import {
	drawX2Glyphs,
	x2Bounds,
	x2Hash,
	x2IsBlank,
	x2Random,
	x2RandomSigned,
	x2Signed,
	type X2Draw,
	type X2Glyph,
} from "./x2-drawing";

/**
 * JIZURA pack `x2hold` (追加分2, v0.12) — thirty idle holds.
 *
 * Each part is a transliteration of its JIZURA definition onto the x2 drawing
 * surface: single-line horizontal runs, no beat/energy analysis (the packs'
 * time-based fallbacks), no fx.motion knob (holds run at full amount fading
 * only with the exit), and item-space box ops expressed through one whole-run
 * pass or per-glyph transforms about the same pivots.
 */
const TAU = Math.PI * 2;

function clamp(value: number): number {
	return clamp01(value);
}

/** Clamp to the reading-axis range (JIZURA `J.clamp(x, -1, 1)`). */
function clampSym(value: number): number {
	return Math.min(1, Math.max(-1, value));
}

function frac(value: number): number {
	return value - Math.floor(value);
}

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

// eslint-disable-next-line opencut/prefer-object-params
function outBackOf(value: number, overshoot = 1.70158): number {
	return enterBOutBack(value, overshoot);
}

/** Smooth 1D value noise (JIZURA `J.noise1(x, seed)`). */
// eslint-disable-next-line opencut/prefer-object-params
function noiseOf(value: number, seed: number): number {
	return smoothNoise({ seed, salt: 0, value });
}

function glyphsOf(options: X2Draw): readonly X2Glyph[] {
	return enterBGlyphs(options);
}

/** Same phase for every item of a cut (JIZURA `cphase`). */
function cutPhaseOf(options: X2Draw): number {
	return ((options.frame.cut?.seed ?? 0) % 97) / 97 * TAU;
}

/**
 * Hold amount (JIZURA `amt` × `motionK`): rocut has no fx.motion knob and
 * holds start once the enter has settled, so the amount is the exit fade.
 */
function holdAmount(options: X2Draw): number {
	return 1 - clamp01(options.frame.exitProgress);
}

/** The resting item: exactly what the frame draws without this hold. */
function drawRest(options: X2Draw): void {
	options.drawGlyph(options);
}

/** Loudness 0..1 — the pack's synthetic swell fallback (no energy analysis). */
// eslint-disable-next-line opencut/prefer-object-params
function loudOf(options: X2Draw, rate: number): number {
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	return clamp(
		0.5 +
			0.34 * Math.sin(time * rate + (seed % 7)) +
			0.3 * noiseOf(time * rate * 1.9, seed),
	);
}

function rgbOf(color: string): readonly [number, number, number] {
	const hex = color.replace("#", "");
	const full =
		hex.length === 3
			? hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!
			: hex.slice(0, 6);
	const value = Number.parseInt(full, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function isHexColor(color: string): boolean {
	return /^#[0-9a-f]{3}|^#[0-9a-f]{6}/iu.test(color);
}

/** Manhattan RGB distance 0..1 (JIZURA `cdist`). */
// eslint-disable-next-line opencut/prefer-object-params
function colorDistance(a: string, b: string): number {
	if (!isHexColor(a) || !isHexColor(b)) return 0;
	const p = rgbOf(a);
	const q = rgbOf(b);
	return (
		(Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) /
		765
	);
}

function luminanceOf(color: string): number {
	if (!isHexColor(color)) return 0.5;
	const [r, g, b] = rgbOf(color);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A scheme colour that reads as "the other colour" next to the item and the background. */
function accentForHold(options: X2Draw): string {
	const palette = options.frame.palette;
	for (const candidate of [
		palette.accent,
		palette.secondary,
		palette.foreground,
	]) {
		if (
			colorDistance(candidate, palette.foreground) > 0.16 &&
			colorDistance(candidate, palette.background) > 0.16
		) {
			return candidate;
		}
	}
	return palette.accent;
}

/**
 * One translated, rotated, scaled pass of the whole run about a design-space
 * pivot — the port of the pack's `it.x/y`, `rotateAbout`, `scaleAbout` and
 * `sizeAbout` item mutations.
 */
function drawWholeMotion({
	alpha = 1,
	angleDeg = 0,
	blurPx = 0,
	options,
	pivotX,
	pivotY,
	scaleX = 1,
	scaleY = 1,
	translateX = 0,
	translateY = 0,
}: {
	readonly alpha?: number;
	readonly angleDeg?: number;
	readonly blurPx?: number;
	readonly options: X2Draw;
	readonly pivotX: number;
	readonly pivotY: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	ctx.save();
	ctx.translate(pivotX + translateX, pivotY + translateY);
	if (angleDeg) ctx.rotate(degrees(angleDeg));
	ctx.scale(scaleX, scaleY);
	ctx.translate(-pivotX, -pivotY);
	ctx.globalAlpha *= alpha;
	if (blurPx > 0) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
	options.drawGlyph(options);
	ctx.restore();
}

/** A plain copy of the whole run (JIZURA `copyOf`): no hooks, no treatment. */
function drawPlainRunCopy({
	alpha,
	color,
	options,
	translateX = 0,
	translateY = 0,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly options: X2Draw;
	readonly translateX?: number;
	readonly translateY?: number;
}): void {
	if (alpha <= 0.003) return;
	const { ctx } = options;
	ctx.save();
	ctx.translate(translateX, translateY);
	ctx.globalAlpha *= alpha;
	ctx.textAlign = "center";
	ctx.fillStyle = color;
	ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
}

/** A plain transformed copy of one glyph (JIZURA `copyOf` at glyph level). */
function drawPlainGlyphCopy({
	alpha,
	color,
	glyph,
	options,
	rotation = 0,
	scaleX = 1,
	scaleY = 1,
	skewX = 0,
	translateX = 0,
	translateY = 0,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly glyph: X2Glyph;
	readonly options: X2Draw;
	readonly rotation?: number;
	readonly scaleX?: number;
	readonly scaleY?: number;
	readonly skewX?: number;
	readonly translateX?: number;
	readonly translateY?: number;
}): void {
	if (alpha <= 0.003 || Math.abs(scaleX) < 0.004 || Math.abs(scaleY) < 0.004) {
		return;
	}
	const { ctx } = options;
	ctx.save();
	ctx.translate(glyph.x + translateX, glyph.y + translateY);
	if (rotation) ctx.rotate(rotation);
	if (skewX) ctx.transform(1, 0, Math.tan(skewX), 1, 0, 0);
	ctx.scale(scaleX, scaleY);
	ctx.globalAlpha *= alpha;
	ctx.textAlign = "center";
	ctx.fillStyle = color;
	ctx.fillText(
		glyph.character,
		0,
		0,
		options.size * Math.max(0.76, Math.abs(scaleX)),
	);
	ctx.restore();
}

/** The whole run redrawn in one colour under a rect clip. */
function drawClippedRunCopy({
	alpha,
	color,
	height,
	left,
	options,
	top,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly height: number;
	readonly left: number;
	readonly options: X2Draw;
	readonly top: number;
	readonly width: number;
}): void {
	if (width <= 0.05 || height <= 0.05 || alpha <= 0.003) return;
	const { ctx } = options;
	ctx.save();
	ctx.beginPath();
	ctx.rect(left, top, width, height);
	ctx.clip();
	ctx.globalAlpha *= alpha;
	ctx.textAlign = "center";
	ctx.fillStyle = color;
	ctx.fillText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
}

/** The whole run stroked in one colour (faux weight). */
function strokeRun({
	color,
	lineWidth,
	options,
}: {
	readonly color: string;
	readonly lineWidth: number;
	readonly options: X2Draw;
}): void {
	if (lineWidth <= 0.05) return;
	const { ctx } = options;
	ctx.save();
	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = color;
	ctx.textAlign = "center";
	ctx.strokeText(options.text, options.x, options.y, options.maxWidth);
	ctx.restore();
}

/** A marching dash pattern walked along a rect perimeter (JIZURA `strokeDash`). */
function drawDashedRect({
	alpha,
	color,
	dashOff,
	dashOn,
	height,
	left,
	lineWidth,
	offset,
	options,
	top,
	width,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly dashOff: number;
	readonly dashOn: number;
	readonly height: number;
	readonly left: number;
	readonly lineWidth: number;
	readonly offset: number;
	readonly options: X2Draw;
	readonly top: number;
	readonly width: number;
}): void {
	const total = 2 * (width + height);
	if (total <= 0.05 || dashOn <= 0.05) return;
	const period = dashOn + dashOff;
	const start = (((offset % period) + period) % period) - period;
	const pointAt = (s: number): readonly [number, number] => {
		const v = ((s % total) + total) % total;
		if (v < width) return [left + v, top];
		if (v < width + height) return [left + width, top + v - width];
		if (v < width * 2 + height) {
			return [left + width - (v - width - height), top + height];
		}
		return [left, top + height - (v - width * 2 - height)];
	};
	for (let x = start; x < total; x += period) {
		const a = Math.max(x, 0);
		const b = Math.min(x + dashOn, total);
		if (b <= a) continue;
		drawEnterBLine({
			alpha,
			color,
			from: pointAt(a),
			options,
			to: pointAt(b),
			width: lineWidth,
		});
	}
}

export function drawX2Hold(options: EnterBDraw): boolean {
	switch (options.frame.cut?.preset.hold) {
		case "xkBeatBump":
		case "xkBigSmall":
		case "xkBlink":
		case "xkBuoy":
		case "xkCradle":
		case "xkDepthRock":
		case "xkDoubleVision":
		case "xkFocusBreath":
		case "xkHeatHaze":
		case "xkKaraoke":
		case "xkLevelFill":
		case "xkLoudArch":
		case "xkLoudWeight":
		case "xkMagnifier":
		case "xkMarchEdge":
		case "xkMetronome":
		case "xkNod":
		case "xkPairUp":
		case "xkParallax":
		case "xkReflection":
		case "xkRippleOut":
		case "xkSlideBunch":
		case "xkSpinOne":
		case "xkSplitShear":
		case "xkStairStep":
		case "xkStopMotion":
		case "xkTallBreath":
		case "xkTiltSnap":
		case "xkWallBounce":
		case "xkZigzagFlip":
			drawX2HoldPart(options);
			return true;
		default:
			return false;
	}
}

function drawX2HoldPart(options: EnterBDraw): void {
	switch (options.frame.cut?.preset.hold) {
		case "xkBeatBump":
			drawBeatBump(options);
			return;
		case "xkBigSmall":
			drawBigSmall(options);
			return;
		case "xkBlink":
			drawBlink(options);
			return;
		case "xkBuoy":
			drawBuoy(options);
			return;
		case "xkCradle":
			drawCradle(options);
			return;
		case "xkDepthRock":
			drawDepthRock(options);
			return;
		case "xkDoubleVision":
			drawDoubleVision(options);
			return;
		case "xkFocusBreath":
			drawFocusBreath(options);
			return;
		case "xkHeatHaze":
			drawHeatHaze(options);
			return;
		case "xkKaraoke":
			drawKaraoke(options);
			return;
		case "xkLevelFill":
			drawLevelFill(options);
			return;
		case "xkLoudArch":
			drawLoudArch(options);
			return;
		case "xkLoudWeight":
			drawLoudWeight(options);
			return;
		case "xkMagnifier":
			drawMagnifier(options);
			return;
		case "xkMarchEdge":
			drawMarchEdge(options);
			return;
		case "xkMetronome":
			drawMetronome(options);
			return;
		case "xkNod":
			drawNod(options);
			return;
		case "xkPairUp":
			drawPairUp(options);
			return;
		case "xkParallax":
			drawParallax(options);
			return;
		case "xkReflection":
			drawReflection(options);
			return;
		case "xkRippleOut":
			drawRippleOut(options);
			return;
		case "xkSlideBunch":
			drawSlideBunch(options);
			return;
		case "xkSpinOne":
			drawSpinOne(options);
			return;
		case "xkSplitShear":
			drawSplitShear(options);
			return;
		case "xkStairStep":
			drawStairStep(options);
			return;
		case "xkStopMotion":
			drawStopMotion(options);
			return;
		case "xkTallBreath":
			drawTallBreath(options);
			return;
		case "xkTiltSnap":
			drawTiltSnap(options);
			return;
		case "xkWallBounce":
			drawWallBounce(options);
			return;
		case "xkZigzagFlip":
			drawZigzagFlip(options);
			return;
		default:
			return;
	}
}

/** 奥行きゆれ — the line turns about its vertical axis like a card. */
function drawDepthRock(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const a =
		Math.sin(secondsOf(options.frame) * TAU / 5.2 + cutPhaseOf(options)) *
		Math.min(k, 1.4);
	const bounds = x2Bounds(options);
	const half = Math.max(1, bounds.width / 2);
	const c = 0.12 * a;
	const nar = 1 - 0.06 * a * a;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const u = clampSym((glyph.x - bounds.centerX) / half);
			const scale = 1 + c * u;
			return {
				scaleX: scale,
				scaleY: scale,
				translateX:
					half * ((u + 0.5 * c * (u * u - 1 / 3)) * nar - u),
			};
		},
	});
}

/** 視差ゆれ — glyphs sit on three depth planes that slide against each other. */
function drawParallax(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const seed = options.frame.cut?.seed ?? 0;
	const time = secondsOf(options.frame);
	const size = options.size;
	const kk = Math.min(1, k);
	const sway = Math.sin(time * TAU / 4.6 + cutPhaseOf(options));
	const bob = Math.sin(time * TAU / 6.3 + 1);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const d = (x2Hash(seed, glyph.index, 0, 711) % 3) - 1;
			if (d === 0) return undefined;
			const scale = 1 + 0.06 * d * kk;
			return {
				alpha: d < 0 ? 1 - 0.22 * kk : 1,
				scaleX: scale,
				scaleY: scale,
				translateX: sway * size * 0.075 * d * k,
				translateY: bob * size * 0.022 * d * k,
			};
		},
	});
}

/** 縦の呼吸 — the letters grow taller from the baseline and sink back. */
function drawTallBreath(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const u = frac(secondsOf(options.frame) / 3.8);
	const b =
		u < 0.62 ? inOutSine(u / 0.62) : 1 - inOutSine((u - 0.62) / 0.38);
	const bounds = x2Bounds(options);
	drawWholeMotion({
		options,
		pivotX: bounds.centerX,
		pivotY: bounds.bottom,
		scaleY: 1 + 0.1 * b * k,
	});
}

/** 拍で小突く — every beat nudges the line from a new side and it springs back. */
function drawBeatBump(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const time = secondsOf(options.frame);
	const since = ((time % 0.6) + 0.6) % 0.6;
	const index = Math.floor(time / 0.6);
	const v =
		Math.exp(-since * 5.5) *
		Math.cos(since * 20) *
		Math.min(1, since / 0.03);
	if (Math.abs(v) < 0.004) return drawRest(options);
	const angle = x2Random(options, index, 721) * TAU;
	const d = options.size * 0.14 * k * v;
	const bounds = x2Bounds(options);
	drawWholeMotion({
		angleDeg: x2RandomSigned(options, index, 722) * 2 * k * v,
		options,
		pivotX: bounds.centerX,
		pivotY: bounds.centerY,
		translateX: Math.cos(angle) * d,
		translateY: Math.sin(angle) * d * 0.75,
	});
}

/** メトロノーム — an inverted pendulum pivoting below the text, over on the beat. */
function drawMetronome(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const len = 0.62;
	const time = secondsOf(options.frame);
	const since = ((time % len) + len) % len;
	const index = Math.floor(time / len);
	const to = index % 2 ? 1 : -1;
	const e = inOutCubic(clamp(since / (len * 0.55)));
	const bounds = x2Bounds(options);
	drawWholeMotion({
		angleDeg: lerpN(-to, to, e) * 2.4 * k,
		options,
		pivotX: bounds.centerX,
		pivotY:
			bounds.bottom + Math.max(options.size * 1.2, bounds.height * 0.8),
	});
}

/** 波に浮かぶ — the line rides a slow swell as one rigid body, tipping with each wave. */
function drawBuoy(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const time = secondsOf(options.frame);
	const phase = cutPhaseOf(options);
	const w = TAU / 3.4;
	const size = options.size;
	const y =
		Math.sin(w * time + phase) +
		0.35 * Math.sin(w * 1.83 * time + phase * 2);
	const tip =
		Math.cos(w * time + phase - 0.5) +
		0.35 * Math.cos(w * 1.83 * time + phase * 2 - 0.5);
	const bounds = x2Bounds(options);
	drawWholeMotion({
		angleDeg: tip * 1.5 * k,
		options,
		pivotX: bounds.centerX,
		pivotY: bounds.centerY,
		translateX: Math.sin(w * 0.5 * time + phase) * size * 0.03 * k,
		translateY: y * size * 0.045 * k,
	});
}

/** ずれて直る — the line slowly slips out of true, then snaps straight with an overshoot. */
function drawTiltSnap(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const per = 2.6;
	const t = secondsOf(options.frame) / per;
	const cyc = Math.floor(t);
	const u = t - cyc;
	const seed = options.frame.cut?.seed ?? 0;
	const dir = (x2Hash(seed, 731) + cyc) % 2 ? 1 : -1;
	const v =
		u < 0.9
			? (u / 0.9) ** 1.4
			: 1 - outBackOf((u - 0.9) / 0.1, 2.4);
	const bounds = x2Bounds(options);
	drawWholeMotion({
		angleDeg: dir * 3.4 * k * v,
		options,
		pivotX: bounds.centerX,
		pivotY: bounds.centerY,
		translateY: v * options.size * 0.02 * k,
	});
}

/** コマ撮りゆれ — a sway and bob shot on threes, each pose held three frames. */
function drawStopMotion(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const seed = options.frame.cut?.seed ?? 0;
	const q = Math.floor(frameStep(options.frame) / 3);
	const size = options.size;
	const tx = noiseOf(q * 0.31, seed + 3) * size * 0.06 * k;
	const ty = noiseOf(q * 0.37, seed + 11) * size * 0.045 * k;
	const tilt = Math.sin(q * 0.42 + cutPhaseOf(options)) * 2.2 * k;
	const bounds = x2Bounds(options);
	const cx = bounds.centerX;
	const cy = bounds.centerY;
	const cos = Math.cos(degrees(tilt));
	const sin = Math.sin(degrees(tilt));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const rx = glyph.x - cx;
			const ry = glyph.y - cy;
			return {
				rotation: degrees(
					tilt + x2Signed(seed, q, glyph.index, 741) * 1.6 * k,
				),
				translateX: cx + tx + cos * rx - sin * ry - glyph.x,
				translateY:
					cy +
					ty +
					sin * rx +
					cos * ry +
					x2Signed(seed, q, glyph.index, 742) * size * 0.008 * k -
					glyph.y,
			};
		},
	});
}

/** 片寄り — the floor tilts; the glyphs slide downhill and crowd at the low end. */
function drawSlideBunch(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const t = secondsOf(options.frame) * TAU / 4.4 + cutPhaseOf(options);
	const tiltV = Math.sin(t);
	const slide = Math.sin(t - 0.9);
	const c = 0.15 * Math.min(k, 1.3) * slide;
	const bounds = x2Bounds(options);
	const half = Math.max(1, bounds.width / 2);
	const cx = bounds.centerX;
	const cy = bounds.centerY;
	const cos = Math.cos(degrees(tiltV * 3 * k));
	const sin = Math.sin(degrees(tiltV * 3 * k));
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const u = clampSym((glyph.x - cx) / half);
			const slideX = half * c * (1 - u * u);
			const rx = glyph.x - cx;
			const ry = glyph.y - cy;
			return {
				rotation: degrees(tiltV * 3 * k),
				translateX: cx + cos * rx - sin * ry + cos * slideX - glyph.x,
				translateY: cy + sin * rx + cos * ry + sin * slideX - glyph.y,
			};
		},
	});
}

/** 壁で弾む — the line glides sideways and rebounds off invisible walls, flattening on each hit. */
function drawWallBounce(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const period = 1.5;
	const time = secondsOf(options.frame);
	const p = time / period;
	const tri = (Math.asin(Math.sin(Math.PI * p)) * 2) / Math.PI;
	const width = options.maxWidth / 0.86;
	const radius = Math.min(width * 0.028, options.size * 0.4) * k;
	const bounds = x2Bounds(options);
	let scaleX = 1;
	let scaleY = 1;
	let pivotX = bounds.centerX;
	if (p > 0.5) {
		const tau = frac(p - 0.5) * period;
		const q = 0.07 * k * Math.exp(-tau * 9) * Math.cos(tau * 24);
		const side = Math.floor(p - 0.5) % 2 ? -1 : 1;
		scaleX = 1 - q;
		scaleY = 1 + q * 0.5;
		pivotX = side > 0 ? bounds.right : bounds.left;
	}
	drawWholeMotion({
		options,
		pivotX,
		pivotY: bounds.centerY,
		scaleX,
		scaleY,
		translateX: tri * radius,
	});
}

/** ピントの呼吸 — the lens drifts now and then: a touch of swell and softness, then sharp again. */
function drawFocusBreath(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const per = 2.9;
	const shifted = secondsOf(options.frame) - 0.55;
	if (shifted < 0) return drawRest(options);
	const u = frac(shifted / per) / 0.42;
	if (u >= 1) return drawRest(options);
	const p = Math.sin(Math.PI * u) ** 1.5;
	const kk = Math.min(1, k);
	const bounds = x2Bounds(options);
	const scale = 1 + 0.03 * p * k;
	drawWholeMotion({
		alpha: 1 - 0.14 * p * kk,
		blurPx: Math.min(options.size * 0.04, 9) * p * kk,
		options,
		pivotX: bounds.centerX,
		pivotY: bounds.centerY,
		scaleX: scale,
		scaleY: scale,
	});
}

/** 二重像 — two faint images of the line slide out from behind it and merge back. */
function drawDoubleVision(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const kk = Math.min(1, k);
	const time = secondsOf(options.frame);
	const phase = cutPhaseOf(options);
	const open = (0.5 - 0.5 * Math.cos(time * TAU / 3.6 + phase)) ** 1.6;
	const sep = options.size * 0.085 * k * open;
	if (sep < 0.4) return drawRest(options);
	const dy = sep * 0.22 * Math.sin(time * TAU / 5.1 + phase);
	for (const side of [-1, 1]) {
		drawPlainRunCopy({
			alpha: 0.36 * kk,
			color: options.frame.palette.foreground,
			options,
			translateX: side * sep,
			translateY: side * dy,
		});
	}
	drawRest(options);
}

/** 床の映り込み — a faint mirrored image below the line that ripples like water. */
function drawReflection(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const kk = Math.min(1, k);
	const time = secondsOf(options.frame);
	const size = options.size;
	const color = options.frame.palette.foreground;
	drawRest(options);
	for (const glyph of glyphsOf(options)) {
		const phase = time * 2.6 + glyph.index * 1.3;
		drawPlainGlyphCopy({
			alpha: 0.34 * kk,
			color,
			glyph,
			options,
			scaleY: -0.72 * (1 + 0.05 * Math.sin(phase * 1.3)),
			skewX: degrees(Math.sin(phase + 1) * 5 * kk),
			translateX: Math.sin(phase) * size * 0.014 * k,
			translateY: glyph.height * 0.83,
		});
	}
}

/** 走る破線 — a dashed contour in the second colour runs round every glyph like marching ants. */
function drawMarchEdge(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const kk = Math.min(1, k);
	const time = secondsOf(options.frame);
	const size = options.size;
	const foreground = options.frame.palette.foreground;
	let col = accentForHold(options);
	if (
		luminanceOf(foreground) > 0.5 === luminanceOf(col) > 0.5 &&
		colorDistance(col, foreground) < 0.3
	) {
		col = options.frame.palette.background;
	}
	const lineWidth = Math.max(1.5, size * 0.028);
	const dash = size * 0.11;
	drawRest(options);
	for (const glyph of glyphsOf(options)) {
		drawDashedRect({
			alpha: kk,
			color: col,
			dashOff: dash * 0.8,
			dashOn: dash,
			height: glyph.height,
			left: glyph.x - glyph.width / 2,
			lineWidth,
			offset: -time * size * 0.42 * (0.4 + 0.6 * kk),
			options,
			top: glyph.y - glyph.height / 2,
			width: glyph.width,
		});
	}
}

/** 陽炎 — the line shimmers as if through rising hot air: thin slices waver in a travelling ripple. */
function drawHeatHaze(options: EnterBDraw): void {
	const k = holdAmount(options);
	const size = options.size;
	const amplitude = size * 0.03 * k;
	if (k <= 0.01 || amplitude < 0.25) return drawRest(options);
	const time = secondsOf(options.frame);
	const seed = options.frame.cut?.seed ?? 0;
	const bounds = x2Bounds(options, size * 0.12);
	const n = 9;
	const sliceHeight = bounds.height / n;
	const span = bounds.width + size * 2;
	const { ctx } = options;
	for (let j = 0; j < n; j++) {
		const top = bounds.top + j * sliceHeight;
		const dx =
			(Math.sin(time * 4.2 - j * 0.85) * 0.7 +
				noiseOf(time * 1.7 + j * 0.6, seed) * 0.5) *
			amplitude;
		ctx.save();
		ctx.beginPath();
		ctx.rect(
			bounds.left - size,
			top,
			span,
			sliceHeight + (j < n - 1 ? 0.75 : 0),
		);
		ctx.clip();
		ctx.translate(dx, 0);
		options.drawGlyph(options);
		ctx.restore();
	}
}

/** 上下すれ違い — the upper and lower halves of the line glide past each other and lock back. */
function drawSplitShear(options: EnterBDraw): void {
	const k = holdAmount(options);
	const per = 2.4;
	const shifted = secondsOf(options.frame) - 0.4;
	if (k <= 0.01 || shifted < 0) return drawRest(options);
	const cyc = Math.floor(shifted / per);
	const u = (shifted - cyc * per) / 1.0;
	if (u >= 1) return drawRest(options);
	const seed = options.frame.cut?.seed ?? 0;
	const dir = (x2Hash(seed, 751) + cyc) % 2 ? 1 : -1;
	const v =
		u < 0.3
			? outCubic(u / 0.3)
			: u < 0.7
				? 1
				: 1 - inOutCubic((u - 0.7) / 0.3);
	const d = dir * options.size * 0.055 * k * v;
	if (Math.abs(d) < 0.3) return drawRest(options);
	const bounds = x2Bounds(options);
	const span = bounds.width + options.size * 2;
	const { ctx } = options;
	for (const [top, bottom, dx] of [
		[bounds.top - options.size, bounds.centerY, d],
		[bounds.centerY, bounds.bottom + options.size, -d],
	] as const) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(bounds.left - options.size, top, span, bottom - top + 0.75);
		ctx.clip();
		ctx.translate(dx, 0);
		options.drawGlyph(options);
		ctx.restore();
	}
}

/** 音量の水位 — the second colour stands in the glyphs like a liquid whose level follows the loudness. */
function drawLevelFill(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const kk = Math.min(1, k);
	const level = (0.12 + 0.8 * loudOf(options, 1.3)) * kk;
	if (level < 0.02) return drawRest(options);
	const palette = options.frame.palette;
	const accent = accentForHold(options);
	const bounds = x2Bounds(options);
	const top = bounds.bottom - level * bounds.height;
	drawRest(options);
	drawClippedRunCopy({
		alpha: 1,
		color: mixHex({
			from: palette.foreground,
			progress: 0.9,
			to: accent,
		}),
		height: bounds.bottom - top + options.size,
		left: bounds.left - options.size,
		options,
		top,
		width: bounds.width + options.size * 2,
	});
}

/** 音圧で太る — the strokes put on weight with the loudness and take it off again. */
function drawLoudWeight(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const add = Math.min(
		options.size * 0.08,
		options.size * 0.065 * loudOf(options, 2.1) * k,
	);
	if (add < 0.3) return drawRest(options);
	drawRest(options);
	strokeRun({
		color: options.frame.palette.foreground,
		lineWidth: add,
		options,
	});
}

/** 音圧アーチ — the baseline bows upward with the loudness, flat when quiet. */
function drawLoudArch(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const level = loudOf(options, 1.7);
	const glyphs = glyphsOf(options);
	const bounds = x2Bounds(options);
	if (glyphs.length < 2) {
		const scale = 1 + 0.04 * level * k;
		drawWholeMotion({
			options,
			pivotX: bounds.centerX,
			pivotY: bounds.centerY,
			scaleX: scale,
			scaleY: scale,
		});
		return;
	}
	const arch = options.size * 0.26 * level * Math.min(k, 1.3);
	const half = Math.max(1, bounds.width / 2);
	const slope = Math.min(0.35, (2 * arch) / half);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const u = clampSym((glyph.x - bounds.centerX) / half);
			return {
				rotation: degrees(Math.atan(slope * u)),
				translateY: -arch * (0.5 - u * u),
			};
		},
	});
}

/** 虫めがね — an invisible lens travels along the line; glyphs under it swell and push neighbours aside. */
function drawMagnifier(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const glyphs = glyphsOf(options);
	const total = glyphs.length;
	const kk = Math.min(k, 1.2);
	const size = options.size;
	const per = 1.6 + total * 0.3;
	const pos =
		(total + 1) * (0.5 - 0.5 * Math.cos((secondsOf(options.frame) * TAU) / per)) -
		1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const d = glyph.index - pos;
			const swell = Math.exp((-d * d) / 1.3);
			const push =
				Math.tanh(d / 1.1) *
				(1 - Math.exp(-d * d * 4)) *
				size *
				0.2 *
				kk *
				clamp(1.6 - Math.abs(d) * 0.12);
			if (swell < 0.01 && Math.abs(push) < 0.2) return undefined;
			const scale = 1 + 0.24 * kk * swell;
			return {
				scaleX: scale,
				scaleY: scale,
				translateX: push,
				translateY: -(scale - 1) * glyph.height * 0.3,
			};
		},
	});
}

/** 順にうなずく — one glyph after another bows forward from its foot and straightens up. */
function drawNod(options: EnterBDraw): void {
	const k = holdAmount(options);
	const len = 0.5;
	const time = secondsOf(options.frame);
	const since = ((time % len) + len) % len;
	const u = since / Math.min(len * 0.95, 0.6);
	if (k <= 0.01 || u >= 1) return drawRest(options);
	const glyphs = glyphsOf(options).filter(
		(glyph) => !x2IsBlank(glyph.character),
	);
	if (glyphs.length === 0) return drawRest(options);
	const index = Math.floor(time / len);
	const picked =
		glyphs[((index % glyphs.length) + glyphs.length) % glyphs.length]!;
	const h =
		u < 0.35
			? outCubic(u / 0.35)
			: Math.cos(((u - 0.35) / 0.65) * Math.PI * 1.5) *
				Math.exp(-(u - 0.35) * 3.2);
	const tiltDeg = 17 * k * h;
	const tilt = degrees(tiltDeg);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (glyph.index !== picked.index) return undefined;
			const half = glyph.height * 0.5;
			return {
				rotation: degrees(tiltDeg),
				translateX: half * Math.sin(tilt),
				translateY: half * (1 - Math.cos(tilt)),
			};
		},
	});
}

/** カラオケ塗り — the second colour wipes through the line, stays, and drains the same way. */
function drawKaraoke(options: EnterBDraw): void {
	const k = holdAmount(options);
	const glyphs = glyphsOf(options);
	const per = Math.min(4, Math.max(2.2, 1.5 + glyphs.length * 0.16));
	const shifted = secondsOf(options.frame) - 0.25;
	if (k <= 0.01 || shifted < 0) return drawRest(options);
	const u = frac(shifted / per);
	const fill = inOutSine(clamp(u / 0.5));
	const drain = inOutSine(clamp((u - 0.62) / 0.38));
	if (fill - drain < 0.004) return drawRest(options);
	const kk = Math.min(1, k);
	const size = options.size;
	const bounds = x2Bounds(options, size * 0.2);
	drawRest(options);
	drawClippedRunCopy({
		alpha: kk,
		color: accentForHold(options),
		height: bounds.height + size * 2,
		left: bounds.left + bounds.width * drain,
		options,
		top: bounds.top - size,
		width: bounds.width * (fill - drain),
	});
}

/** 寄り添う — neighbours lean together two by two, then pair up the other way. */
function drawPairUp(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const per = 1.5;
	const t = secondsOf(options.frame) / per;
	const cyc = Math.floor(t);
	const e = inOutCubic(clamp((t - cyc) / 0.4));
	const size = options.size;
	const glyphs = glyphsOf(options);
	const total = glyphs.length;
	// eslint-disable-next-line opencut/prefer-object-params
	const side = (ci: number, n: number, par: number): number =>
		((ci - par) % 2 + 2) % 2 === 0
			? ci + 1 < n
				? 1
				: 0
			: ci - 1 >= par
				? -1
				: 0;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const v = lerpN(
				side(glyph.index, total, (cyc + 1) % 2),
				side(glyph.index, total, cyc % 2),
				e,
			);
			if (v === 0) return undefined;
			return {
				rotation: degrees(v * 5 * k),
				translateX: v * size * 0.06 * k,
			};
		},
	});
}

/** 波紋 — a drop lands on one glyph; a ring travels outward both ways, lifting glyphs as it passes. */
function drawRippleOut(options: EnterBDraw): void {
	const k = holdAmount(options);
	const per = 2.3;
	const shifted = secondsOf(options.frame) - 0.3;
	if (k <= 0.01 || shifted < 0) return drawRest(options);
	const cyc = Math.floor(shifted / per);
	const since = shifted - cyc * per;
	const glyphs = glyphsOf(options);
	const origin = x2Random(options, cyc, 761);
	const span = Math.max(3, Math.min(glyphs.length, 16)) * 0.075;
	const size = options.size;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const d = Math.abs(glyph.order - origin);
			const tau = since - d * span * 2.2;
			if (tau <= 0) return undefined;
			const y = (Math.exp(-tau * 3) * Math.sin(tau * 12)) / (1 + d * 1.4);
			if (Math.abs(y) < 0.004) return undefined;
			const scale = 1 + 0.06 * y * k;
			return {
				scaleX: scale,
				scaleY: scale,
				translateY: -y * size * 0.17 * k,
			};
		},
	});
}

/** 互い違い拍 — odd glyphs sit high, even ones low, and on every beat they trade places with a snap. */
function drawZigzagFlip(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const len = 0.55;
	const time = secondsOf(options.frame);
	const since = ((time % len) + len) % len;
	const index = Math.floor(time / len);
	const to = index % 2 ? 1 : -1;
	const v =
		lerpN(-to, to, outBackOf(clamp(since / 0.16), 2.4)) *
		options.size *
		0.042 *
		k;
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			translateY: (glyph.index % 2 ? 1 : -1) * v,
		}),
	});
}

/** 一字くるり — every so often a single glyph turns one full turn on the spot and settles. */
function drawSpinOne(options: EnterBDraw): void {
	const k = holdAmount(options);
	const per = 1.5;
	const shifted = secondsOf(options.frame) - 0.35;
	if (k <= 0.01 || shifted < 0) return drawRest(options);
	const cyc = Math.floor(shifted / per);
	const u = (shifted - cyc * per) / 0.8;
	if (u >= 1) return drawRest(options);
	const glyphs = glyphsOf(options).filter(
		(glyph) => !x2IsBlank(glyph.character),
	);
	if (glyphs.length === 0) return drawRest(options);
	const seed = options.frame.cut?.seed ?? 0;
	const pick = x2Hash(seed, cyc, 771);
	const picked = glyphs[pick % glyphs.length]!;
	const dir = x2Hash(seed, cyc, 772) & 1 ? 1 : -1;
	const rot = dir * 360 * inOutCubic(u);
	const scale = 1 + 0.12 * Math.sin(Math.PI * u) * Math.min(1, k);
	drawX2Glyphs({
		options,
		resolve: (glyph) =>
			glyph.index === picked.index
				? { rotation: degrees(rot), scaleX: scale, scaleY: scale }
				: undefined,
	});
}

/** まばたき — the line blinks like an eye: shut to a slit in a quick ripple and open again. */
function drawBlink(options: EnterBDraw): void {
	const k = holdAmount(options);
	const per = 2.5;
	const shifted = secondsOf(options.frame) - 0.7;
	if (k <= 0.01 || shifted < 0) return drawRest(options);
	const cyc = Math.floor(shifted / per);
	const tau = shifted - cyc * per;
	if (tau > 0.75) return drawRest(options);
	const twice = x2Random(options, cyc, 781) < 0.4;
	const kk = Math.min(1, k);
	const shutSpan = 0.2;
	const shutOf = (x: number): number =>
		x > 0 && x < shutSpan
			? Math.sin((Math.PI * x) / shutSpan) ** 0.8
			: 0;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const x = tau - glyph.order * 0.09;
			const c = Math.max(shutOf(x), twice ? shutOf(x - 0.3) : 0);
			if (c <= 0) return undefined;
			return { scaleY: 1 - 0.62 * kk * c };
		},
	});
}

/** 階段送り — the glyphs stand on a three-step staircase that walks along the line, one glyph per tick. */
function drawStairStep(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const q = frameStep(options.frame) / 9;
	const b = Math.floor(q);
	const e = clamp(((q - b) * 9) / 2);
	const step = options.size * 0.05 * k;
	// eslint-disable-next-line opencut/prefer-object-params
	const level = (ci: number, base: number): number =>
		(((ci - base) % 3) + 3) % 3 - 1;
	drawX2Glyphs({
		options,
		resolve: (glyph) => ({
			translateY: -lerpN(
				level(glyph.index, b - 1),
				level(glyph.index, b),
				e,
			) * step,
		}),
	});
}

/** 大小交代 — every other glyph grows while its neighbours shrink, standing on the baseline, then they trade. */
function drawBigSmall(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const v =
		clampSym(
			Math.sin(secondsOf(options.frame) * TAU / 3.2 + cutPhaseOf(options)) *
				1.7,
		) *
		0.1 *
		Math.min(k, 1.3);
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			const scale = 1 + (glyph.index % 2 ? v : -v);
			return {
				scaleX: scale,
				scaleY: scale,
				translateY: -(scale - 1) * glyph.height * 0.36,
			};
		},
	});
}

/** 振り子玉 — Newton's cradle: the end glyph swings out and back, the knock runs through the row. */
function drawCradle(options: EnterBDraw): void {
	const k = holdAmount(options);
	if (k <= 0.01) return drawRest(options);
	const half = 0.62;
	const t = secondsOf(options.frame) / half;
	const hc = Math.floor(t);
	const u = t - hc;
	const end = hc % 2 ? -1 : 1;
	const sw = Math.sin(Math.PI * u);
	const tiltDeg = 13 * k * sw;
	const tilt = degrees(tiltDeg);
	const arm = options.size * 1.25;
	const glyphs = glyphsOf(options);
	const visible = glyphs.filter(
		(glyph) => !x2IsBlank(glyph.character),
	);
	const first = visible[0]?.index ?? 0;
	const last = visible.at(-1)?.index ?? 0;
	const knock = Math.exp(-u * 14) * options.size * 0.012 * k;
	drawX2Glyphs({
		options,
		resolve: (glyph) => {
			if (first === last) {
				return { rotation: degrees(end * sw * 3 * k) };
			}
			if (glyph.index === (end > 0 ? last : first)) {
				const out = end * arm * Math.sin(tilt);
				const up = -arm * (1 - Math.cos(tilt));
				return {
					rotation: degrees(-end * tiltDeg),
					translateX: out,
					translateY: up,
				};
			}
			return { translateX: end * knock };
		},
	});
}
