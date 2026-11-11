import { enterBOutBack } from "./enter-b-drawing";
import {
	bell,
	clamp01,
	degrees,
	frameStep,
	inCubic,
	inOutCubic,
	inOutSine,
	inQuad,
	lerp,
	mixHex,
	outCubic,
	outQuad,
	TICKS_PER_SECOND,
} from "./exit-hold-geometry";
import {
	captureLooksSource,
	isLooksPixelContext,
	type LooksPixelContext,
	type LooksPixelEffectDraw,
	type LooksScratchCanvas,
	type LooksScreenEffectDraw,
} from "./looks-screen-effect-types";
import type { MotionTextRenderFrame } from "./types";
import { x2Hash, x2Signed, x2Unit } from "./x2-drawing";

/**
 * JIZURA 追加分2 (v0.12 "x2") screen fx pack (`11p_x2_fx.js`) — 45 full-frame
 * accents (displacement, copies, light, colour, texture, framing) composited
 * over the whole frame after the text, as a transliteration of each part's
 * JIZURA definition.
 *
 * Semantic adaptations shared by every part: JIZURA fires each fx once at a
 * planned beat over `dur` 24fps frames, but rocut has no fx event timeline, so
 * the one-shot progress `k` loops on that same duration (offset per stack
 * slot, the `fxBPhase` house rhythm); the per-event amplitude `ev.amp` is not
 * modelled, so every `ampOf`/`amp1` factor is the neutral 1; the scheme's
 * `ink` and ghost pair map onto the four-colour rocut palette (`accent2` →
 * secondary per house precedent).
 */

/** Event length in JIZURA 24fps frames per part (drives the loop length). */
const X2_FX_DURATIONS: Readonly<Record<string, number>> = {
	xrAccordion: 8,
	xrBandRepeat: 7,
	xrBandZoom: 6,
	xrBlink: 9,
	xrBorderPunch: 7,
	xrCheckerInvert: 8,
	xrClockInvert: 10,
	xrColorStrobe: 6,
	xrColumnDrop: 8,
	xrCornerFold: 10,
	xrCrossFringe: 5,
	xrCrossSplit: 6,
	xrCrosshair: 10,
	xrDiagSlice: 6,
	xrDiscTurn: 8,
	xrDotWave: 9,
	xrDropBounce: 9,
	xrDropout: 5,
	xrEdgeBars: 6,
	xrExposureDip: 9,
	xrFlipTiles: 9,
	xrFourTints: 8,
	xrLampFlicker: 8,
	xrLetterSnap: 10,
	xrLongShadow: 7,
	xrLoupe: 12,
	xrMoire: 10,
	xrNested: 8,
	xrPixelSparks: 6,
	xrQuadCycle: 8,
	xrRibbonTwist: 10,
	xrScanBurst: 6,
	xrShearSnap: 7,
	xrSlotReel: 10,
	xrSpotlight: 12,
	xrStretchWave: 8,
	xrStripeMosaic: 6,
	xrSwingEcho: 7,
	xrSyncBend: 5,
	xrTapeCrease: 8,
	xrThumbRow: 12,
	xrTileLights: 8,
	xrWaist: 6,
	xrWaterMirror: 12,
	xrZebra: 8,
};

/** JIZURA scheme slots mapped onto the rocut palette. */
interface X2Scheme {
	readonly fg: string;
	readonly accent: string;
	readonly accent2: string;
	readonly ghostA: string;
	readonly ghostB: string;
	readonly bg: string;
	readonly ink: string;
}

type X2Gradient = { addColorStop(offset: number, color: string): void };

type X2PixelContext = LooksPixelContext & {
	readonly createLinearGradient?: (
		x0: number,
		y0: number,
		x1: number,
		y1: number,
	) => X2Gradient;
	readonly createRadialGradient?: (
		x0: number,
		y0: number,
		r0: number,
		x1: number,
		y1: number,
		r1: number,
	) => X2Gradient;
};

/** Per-part draw context mirroring the JIZURA fx `I` frame object. */
interface X2FxPartDraw extends LooksPixelEffectDraw {
	readonly ctx: X2PixelContext;
	readonly k: number;
	readonly s: number;
	readonly scheme: X2Scheme;
	readonly step: number;
	readonly tmp: (width: number, height: number) => LooksScratchCanvas | null;
	readonly tmp2: (width: number, height: number) => LooksScratchCanvas | null;
}

export function drawX2ScreenEffect(options: LooksScreenEffectDraw): boolean {
	if (!(options.effect in X2_FX_DURATIONS)) return false;
	options.ctx.save();
	try {
		if (!isLooksPixelContext(options.ctx)) {
			drawFallbackSignature(options);
			return true;
		}
		options.ctx.setTransform(1, 0, 0, 1, 0, 0);
		const surface = captureLooksSource({
			ctx: options.ctx,
			height: options.height,
			width: options.width,
		});
		if (!surface) {
			drawFallbackSignature(options);
			return true;
		}
		const pair = x2ScratchPairOf(options.ctx.canvas);
		const target = options.ctx.canvas;
		drawX2FxPart({
			...options,
			ctx: options.ctx,
			k: fxPhase(options),
			s: eventSeedOf(options),
			scheme: schemeOf(options.frame),
			source: surface.canvas,
			step: frameStep(options.frame),
			tmp: (width, height) =>
				scratchSlot({ height, key: "scratchA", pair, target, width }),
			tmp2: (width, height) =>
				scratchSlot({ height, key: "scratchB", pair, target, width }),
		});
		return true;
	} finally {
		options.ctx.restore();
	}
}

function drawX2FxPart(options: X2FxPartDraw): void {
	switch (options.effect) {
		case "xrShearSnap":
			drawShearSnap(options);
			return;
		case "xrColumnDrop":
			drawColumnDrop(options);
			return;
		case "xrQuadCycle":
			drawQuadCycle(options);
			return;
		case "xrFlipTiles":
			drawFlipTiles(options);
			return;
		case "xrWaist":
			drawWaist(options);
			return;
		case "xrSyncBend":
			drawSyncBend(options);
			return;
		case "xrAccordion":
			drawAccordion(options);
			return;
		case "xrDropBounce":
			drawDropBounce(options);
			return;
		case "xrDiscTurn":
			drawDiscTurn(options);
			return;
		case "xrStretchWave":
			drawStretchWave(options);
			return;
		case "xrDiagSlice":
			drawDiagSlice(options);
			return;
		case "xrBandZoom":
			drawBandZoom(options);
			return;
		case "xrRibbonTwist":
			drawRibbonTwist(options);
			return;
		case "xrSlotReel":
			drawSlotReel(options);
			return;
		case "xrCrossSplit":
			drawCrossSplit(options);
			return;
		case "xrLongShadow":
			drawLongShadow(options);
			return;
		case "xrWaterMirror":
			drawWaterMirror(options);
			return;
		case "xrSwingEcho":
			drawSwingEcho(options);
			return;
		case "xrBandRepeat":
			drawBandRepeat(options);
			return;
		case "xrNested":
			drawNested(options);
			return;
		case "xrThumbRow":
			drawThumbRow(options);
			return;
		case "xrLoupe":
			drawLoupe(options);
			return;
		case "xrEdgeBars":
			drawEdgeBars(options);
			return;
		case "xrSpotlight":
			drawSpotlight(options);
			return;
		case "xrColorStrobe":
			drawColorStrobe(options);
			return;
		case "xrExposureDip":
			drawExposureDip(options);
			return;
		case "xrTileLights":
			drawTileLights(options);
			return;
		case "xrCrosshair":
			drawCrosshair(options);
			return;
		case "xrLampFlicker":
			drawLampFlicker(options);
			return;
		case "xrZebra":
			drawZebra(options);
			return;
		case "xrCrossFringe":
			drawCrossFringe(options);
			return;
		case "xrCheckerInvert":
			drawCheckerInvert(options);
			return;
		case "xrStripeMosaic":
			drawStripeMosaic(options);
			return;
		case "xrFourTints":
			drawFourTints(options);
			return;
		case "xrClockInvert":
			drawClockInvert(options);
			return;
		case "xrScanBurst":
			drawScanBurst(options);
			return;
		case "xrDotWave":
			drawDotWave(options);
			return;
		case "xrDropout":
			drawDropout(options);
			return;
		case "xrTapeCrease":
			drawTapeCrease(options);
			return;
		case "xrMoire":
			drawMoire(options);
			return;
		case "xrPixelSparks":
			drawPixelSparks(options);
			return;
		case "xrLetterSnap":
			drawLetterSnap(options);
			return;
		case "xrBlink":
			drawBlink(options);
			return;
		case "xrBorderPunch":
			drawBorderPunch(options);
			return;
		case "xrCornerFold":
			drawCornerFold(options);
			return;
		default:
			return;
	}
}

function drawFallbackSignature(options: LooksScreenEffectDraw): void {
	const phase = fxPhase(options);
	const count = 2 + (options.effectIndex % 6);
	options.ctx.globalAlpha *= 0.24 + bell(phase) * 0.5;
	options.ctx.fillStyle =
		options.effectIndex % 2 === 0
			? options.frame.palette.accent
			: options.frame.palette.secondary;
	for (let marker = 0; marker < count; marker += 1) {
		options.ctx.fillRect(
			options.width *
				(((options.effectIndex * 0.113 + marker * 0.171 + phase * 0.29) %
					0.9) +
					0.02),
			options.height *
				(((options.effectIndex * 0.071 + marker * 0.131) % 0.85) + 0.04),
			options.width * 0.03,
			options.height * 0.014,
		);
	}
}

/**
 * JIZURA plays each fx once over `dur` 24fps frames at a planned beat; rocut
 * has no event timeline, so the accent loops on that same duration, offset
 * per stack slot (house precedent: `fxBPhase`).
 */
function fxPhase(options: LooksScreenEffectDraw): number {
	const duration = X2_FX_DURATIONS[options.effect] ?? 6;
	const cycle =
		options.frame.localTime / (TICKS_PER_SECOND * (duration / 24)) +
		options.effectIndex * 0.137;
	return ((cycle % 1) + 1) % 1;
}

/** JIZURA hashes the event start time (`evS`); rocut hashes cut seed + slot. */
function eventSeedOf(options: LooksScreenEffectDraw): number {
	return x2Hash(options.frame.cut?.seed ?? 0, options.effectIndex, 5519);
}

function schemeOf(frame: MotionTextRenderFrame): X2Scheme {
	const palette = frame.palette;
	return {
		accent: palette.accent,
		accent2: palette.secondary,
		bg: palette.background,
		// rocut's palette has no ghost pair; accent/secondary stand in.
		ghostA: palette.accent,
		ghostB: palette.secondary,
		fg: palette.foreground,
		ink: palette.foreground,
	};
}

// ---- colour helpers (JIZURA J.hex / J.rgba / J.lum / J.contrast) ----

function hexRgb(color: string): [number, number, number] {
	const digits = String(color || "#000").replace("#", "");
	const expanded =
		digits.length === 3
			? Array.from(digits, (digit) => digit.repeat(2)).join("")
			: digits;
	const value = Number.parseInt(expanded.slice(0, 6), 16) || 0;
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// eslint-disable-next-line opencut/prefer-object-params
function rgbaOf(color: string, alpha: number): string {
	const [r, g, b] = hexRgb(color);
	return `rgba(${r},${g},${b},${alpha})`;
}

function lumOf(color: string): number {
	const [r, g, b] = hexRgb(color);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isDark(color: string): boolean {
	return lumOf(color) < 0.45;
}

/** WCAG contrast ratio (JIZURA `J.contrast`). */
// eslint-disable-next-line opencut/prefer-object-params
function contrastOf(a: string, b: string): number {
	const channel = (value: number) => {
		const scaled = value / 255;
		return scaled <= 0.03928
			? scaled / 12.92
			: ((scaled + 0.055) / 1.055) ** 2.4;
	};
	const luminance = (color: string) => {
		const [r, g, b] = hexRgb(color);
		return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	};
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** An accent that stays visible on the background (JIZURA `pop`). */
function popOf(scheme: X2Scheme): string {
	for (const color of [scheme.accent, scheme.accent2, scheme.fg]) {
		if (color && contrastOf(color, scheme.bg) > 1.6) return color;
	}
	return scheme.fg;
}

/**
 * Scheme tints that read on the background (JIZURA `tints`); deduplicated
 * because the ghost slots alias accent/secondary, so the palette has fewer
 * distinct tints than JIZURA schemes do.
 */
function tintsOf(scheme: X2Scheme): string[] {
	const seen = new Set<string>();
	const tints: string[] = [];
	for (const color of [
		scheme.accent,
		scheme.accent2,
		scheme.ghostA,
		scheme.ghostB,
	]) {
		if (color && contrastOf(color, scheme.bg) > 1.3 && !seen.has(color)) {
			seen.add(color);
			tints.push(color);
		}
	}
	return tints.length > 0 ? tints : [scheme.fg];
}

/** The colour used to darken a frame (JIZURA `shade`). */
function shadeOf(scheme: X2Scheme): string {
	if (isDark(scheme.bg)) return "#000000";
	if (isDark(scheme.ink)) return scheme.ink;
	if (isDark(scheme.fg)) return scheme.fg;
	return "#111111";
}

// ---- scratch canvases (JIZURA I.tmp / I.tmp2) ----

interface X2ScratchPair {
	scratchA: LooksScratchCanvas | null;
	scratchB: LooksScratchCanvas | null;
}

const x2ScratchPairs = new WeakMap<object, X2ScratchPair>();

function x2ScratchPairOf(target: LooksScratchCanvas): X2ScratchPair {
	let pair = x2ScratchPairs.get(target);
	if (!pair) {
		pair = { scratchA: null, scratchB: null };
		x2ScratchPairs.set(target, pair);
	}
	return pair;
}

function createX2Scratch({
	height,
	target,
	width,
}: {
	readonly height: number;
	readonly target: LooksScratchCanvas;
	readonly width: number;
}): LooksScratchCanvas | null {
	if (
		typeof OffscreenCanvas !== "undefined" &&
		target instanceof OffscreenCanvas
	) {
		return new OffscreenCanvas(width, height);
	}
	if ("ownerDocument" in target) {
		const canvas = target.ownerDocument.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	if (typeof OffscreenCanvas !== "undefined") {
		return new OffscreenCanvas(width, height);
	}
	return null;
}

function scratchSlot({
	height,
	key,
	pair,
	target,
	width,
}: {
	readonly height: number;
	readonly key: "scratchA" | "scratchB";
	readonly pair: X2ScratchPair;
	readonly target: LooksScratchCanvas;
	readonly width: number;
}): LooksScratchCanvas | null {
	let canvas = pair[key];
	if (!canvas) {
		canvas = createX2Scratch({ height, target, width });
		if (!canvas) return null;
		pair[key] = canvas;
	}
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	return canvas;
}

/** Fresh 2D state for a scratch canvas (JIZURA `cx2`). */
function cx2Of(canvas: LooksScratchCanvas): LooksPixelContext | null {
	// Resolve each canvas's 2D overload before joining the DOM context types.
	const context =
		"ownerDocument" in canvas
			? canvas.getContext("2d")
			: canvas.getContext("2d");
	if (!context || !isLooksPixelContext(context)) return null;
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = "source-over";
	context.filter = "none";
	context.imageSmoothingEnabled = true;
	return context;
}

/**
 * The frame's ink (|frame − bg|, greyed and boosted) recoloured into one
 * colour: on black for dark schemes, on white for light ones (JIZURA
 * `inkMask`).
 */
// eslint-disable-next-line opencut/prefer-object-params
function inkMask(
	target: LooksScratchCanvas,
	source: LooksScratchCanvas,
	scheme: X2Scheme,
	color: string,
	dark: boolean,
): LooksScratchCanvas | null {
	const x = cx2Of(target);
	if (!x) return null;
	const w = target.width;
	const h = target.height;
	x.globalCompositeOperation = "copy";
	x.drawImage(source, 0, 0, w, h);
	x.globalCompositeOperation = "difference";
	x.fillStyle = scheme.bg;
	x.fillRect(0, 0, w, h);
	x.globalCompositeOperation = "saturation";
	x.fillStyle = "#808080";
	x.fillRect(0, 0, w, h);
	// Squared: the faint background texture drops out.
	x.globalCompositeOperation = "multiply";
	x.drawImage(target, 0, 0);
	x.globalCompositeOperation = "color-dodge";
	x.fillStyle = "#a8a8a8";
	x.fillRect(0, 0, w, h);
	if (dark) {
		x.globalCompositeOperation = "multiply";
		x.fillStyle = color;
		x.fillRect(0, 0, w, h);
	} else {
		x.globalCompositeOperation = "difference";
		x.fillStyle = "#ffffff";
		x.fillRect(0, 0, w, h);
		x.globalCompositeOperation = "screen";
		x.fillStyle = color;
		x.fillRect(0, 0, w, h);
	}
	x.globalCompositeOperation = "source-over";
	return target;
}

// ---- canvas helpers mirroring the pack's compact drawing shapes ----

/** JIZURA `bgFill`: reset the frame to the background colour. */
function bgFill(options: X2FxPartDraw): void {
	if (options.compositionMode === "overlay") {
		options.ctx.clearRect(0, 0, options.width, options.height);
		return;
	}
	options.ctx.fillStyle = options.scheme.bg;
	options.ctx.fillRect(0, 0, options.width, options.height);
}

/** `strokeRect` through the path API — the base context type has none. */
// eslint-disable-next-line opencut/prefer-object-params
function strokeRectOf(
	ctx: X2PixelContext,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.stroke?.();
}

/** Scale `img` by `s` around the point (cx, cy) (JIZURA `drawScaled`). */
// eslint-disable-next-line opencut/prefer-object-params
function drawScaled(
	ctx: LooksPixelContext,
	img: LooksScratchCanvas,
	s: number,
	cx: number,
	cy: number,
	cw: number,
	ch: number,
): void {
	ctx.drawImage(
		img,
		0,
		0,
		img.width,
		img.height,
		cx - cx * s,
		cy - cy * s,
		cw * s,
		ch * s,
	);
}

function halfOf(value: number): number {
	return Math.max(2, Math.round(value / 2));
}

// ---- envelopes and easings (JIZURA helpers) ----

const TAU = Math.PI * 2;

// eslint-disable-next-line opencut/prefer-object-params
function lerpN(start: number, end: number, progress: number): number {
	return lerp({ start, end, progress });
}

function outExpo(value: number): number {
	const progress = clamp01(value);
	return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

/** Attack (0..a) → hold → release (b..1) (JIZURA `ahr`). */
// eslint-disable-next-line opencut/prefer-object-params
function ahr(
	k: number,
	a: number,
	b: number,
	inE: (value: number) => number = outCubic,
	outE: (value: number) => number = inCubic,
): number {
	if (k < a) return inE(k / a);
	if (k > b) return 1 - outE((k - b) / Math.max(1e-3, 1 - b));
	return 1;
}

/** Fast attack to 1 at a, smooth release to 0 at k = 1 (JIZURA `punch`). */
// eslint-disable-next-line opencut/prefer-object-params
function punch(k: number, a = 0.25): number {
	if (k < a) return outExpo(k / a);
	return 1 - inOutCubic((k - a) / (1 - a));
}

/**
 * Attack to 1 at a, then a damped swing through zero that dies out exactly
 * at k = 1 (JIZURA `spring`).
 */
// eslint-disable-next-line opencut/prefer-object-params
function spring(k: number, a = 0.2): number {
	if (k < a) return outCubic(k / a);
	const q = (k - a) / (1 - a);
	return Math.exp(-2.2 * q) * Math.cos(q * TAU * 1.25) * (1 - q);
}

function bounceOut(value: number): number {
	const n = 7.5625;
	const d = 2.75;
	if (value < 1 / d) return n * value * value;
	if (value < 2 / d) return n * (value -= 1.5 / d) * value + 0.75;
	if (value < 2.5 / d) return n * (value -= 2.25 / d) * value + 0.9375;
	return n * (value -= 2.625 / d) * value + 0.984375;
}

// ================= displacement =================

/** シアー戻し — the whole frame leans into a parallelogram and springs back. */
function drawShearSnap(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const sk = (x2Unit(s, 1) < 0.5 ? 1 : -1) * 0.24 * spring(k, 0.2);
	if (Math.abs(sk) < 0.0015) return;
	bgFill(options);
	if (x2Unit(s, 2) < 0.75) {
		ctx.setTransform(1, 0, sk, 1, (-sk * ch) / 2, 0);
	} else {
		ctx.setTransform(1, sk * 0.55, 0, 1, 0, (-sk * 0.55 * cw) / 2);
	}
	ctx.drawImage(source, 0, 0);
}

/** 列落ち — columns fall one after another like piano keys and rise back. */
function drawColumnDrop(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const n = 10 + (x2Hash(s, 1) % 8);
	const rev = x2Unit(s, 2) < 0.5;
	const up = x2Unit(s, 4) < 0.3 ? -1 : 1;
	bgFill(options);
	for (let i = 0; i < n; i++) {
		const x0 = Math.round((i * cw) / n);
		const x1 = Math.round(((i + 1) * cw) / n);
		const u = clamp01((k - ((rev ? n - 1 - i : i) / (n - 1)) * 0.42) / 0.58);
		const e =
			u < 0.38
				? inQuad(u / 0.38)
				: 1 - inOutCubic((u - 0.38) / 0.62);
		const dy = Math.round(
			up * ch * (0.09 + 0.15 * x2Unit(s, i, 3)) * e,
		);
		ctx.drawImage(
			source,
			x0,
			0,
			x1 - x0,
			ch,
			x0,
			dy,
			x1 - x0,
			ch,
		);
	}
}

/** 四分割めぐり — the four quadrants travel one lap around the centre, a quarter turn per beat. */
function drawQuadCycle(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const cwD = x2Unit(s, 1) < 0.5 ? 1 : 3;
	const f = k * 4;
	const j = Math.min(3, Math.floor(f));
	const fr = inOutCubic(clamp01(f - j));
	const SL: readonly (readonly [number, number])[] = [
		[0, 0],
		[1, 0],
		[1, 1],
		[0, 1],
	];
	const hw = cw / 2;
	const hh = ch / 2;
	const sh = 1 - 0.08 * bell(k);
	bgFill(options);
	for (let q = 0; q < 4; q++) {
		const A = SL[(q + j * cwD) % 4]!;
		const B = SL[(q + (j + 1) * cwD) % 4]!;
		const px = lerpN(A[0], B[0], fr) * hw;
		const py = lerpN(A[1], B[1], fr) * hh;
		ctx.drawImage(
			source,
			SL[q]![0] * hw,
			SL[q]![1] * hh,
			hw,
			hh,
			px + (hw * (1 - sh)) / 2,
			py + (hh * (1 - sh)) / 2,
			hw * sh,
			hh * sh,
		);
	}
}

/** パネル返し — split-flap board: tiles turn over to their coloured back in a diagonal wave. */
function drawFlipTiles(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const m = Math.min(cw, ch);
	const gx = Math.max(3, Math.round(cw / (m / 3.2)));
	const gy = Math.max(3, Math.round(ch / (m / 3.2)));
	const rev = x2Unit(s, 1) < 0.5;
	const back = popOf(sc);
	const back2 = mixHex({ from: back, progress: 0.35, to: sc.bg });
	// 0.55 + 0.35 × amp headroom; the amplitude is the fixed 1.
	const part = 0.55 + 0.35 * clamp01(0.7);
	for (let j = 0; j < gy; j++) {
		for (let i = 0; i < gx; i++) {
			if (x2Unit(s, i, j, 2) > part) continue;
			const x0 = Math.round((i * cw) / gx);
			const x1 = Math.round(((i + 1) * cw) / gx);
			const y0 = Math.round((j * ch) / gy);
			const y1 = Math.round(((j + 1) * ch) / gy);
			const tw = x1 - x0;
			const th = y1 - y0;
			const u = clamp01(
				(k - (((rev ? gx - 1 - i : i) + j) / (gx + gy - 2)) * 0.45) / 0.55,
			);
			if (u <= 0 || u >= 1) continue;
			const c = Math.cos(TAU * inOutCubic(u));
			const w = tw * Math.abs(c);
			const xx = x0 + (tw - w) / 2;
			ctx.fillStyle = sc.bg;
			ctx.fillRect(x0, y0, tw, th);
			if (w < 0.5) continue;
			if (c >= 0) {
				ctx.drawImage(source, x0, y0, tw, th, xx, y0, w, th);
			} else {
				ctx.fillStyle = (i + j) % 2 ? back : back2;
				ctx.fillRect(xx, y0, w, th);
			}
		}
	}
}

/** くびれ — rows squeezed towards the centre line: the frame gets a waist and springs back. */
function drawWaist(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const A = (x2Unit(s, 1) < 0.35 ? -0.2 : 0.3) * punch(k, 0.28);
	const N = 54;
	const yc = 0.5 + x2Signed(s, 2) * 0.06;
	if (Math.abs(A) < 0.003) return;
	bgFill(options);
	for (let i = 0; i < N; i++) {
		const y0 = Math.floor((i * ch) / N);
		const y1 = Math.floor(((i + 1) * ch) / N);
		const v = ((y0 + y1) / 2 / ch - yc) * 2;
		const w = cw * (1 - A * Math.exp(-(v * v) / 0.16));
		ctx.drawImage(source, 0, y0, cw, y1 - y0, (cw - w) / 2, y0, w, y1 - y0);
	}
}

/** 同期曲がり — horizontal sync flagging: the top (or bottom) of the picture bends sideways and wraps round. */
function drawSyncBend(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, step, width: cw } =
		options;
	const st = step * 7 + s;
	const top = x2Unit(s, 1) < 0.7;
	const dir = x2Unit(s, 2) < 0.5 ? 1 : -1;
	const zone = ch * 0.78;
	const N = 44;
	const A = dir * cw * 0.34 * bell(k);
	if (Math.abs(A) < 1) return;
	for (let i = 0; i < N; i++) {
		const a0 = Math.floor((i * zone) / N);
		const a1 = Math.floor(((i + 1) * zone) / N);
		const h = a1 - a0;
		const y = top ? a0 : ch - a1;
		const v = 1 - (i + 0.5) / N;
		let dx = A * v ** 1.7 + x2Signed(st, i, 3) * cw * 0.006 * v * bell(k);
		dx = ((dx % cw) + cw) % cw;
		ctx.fillStyle = sc.bg;
		ctx.fillRect(0, y, cw, h);
		ctx.drawImage(source, 0, y, cw, h, dx, y, cw, h);
		ctx.drawImage(source, 0, y, cw, h, dx - cw, y, cw, h);
	}
}

/** 蛇腹 — vertical pleats: neighbouring strips squeeze and stretch in turn, like bellows breathing once. */
function drawAccordion(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const n = 2 * (4 + (x2Hash(s, 1) % 3));
	const w0 = cw / n;
	const q =
		0.62 *
		Math.sin(k * TAU) *
		(1 - 0.35 * k) *
		(x2Unit(s, 2) < 0.5 ? 1 : -1);
	if (Math.abs(q) < 0.004) return;
	let x = 0;
	for (let i = 0; i < n; i++) {
		const wd = w0 * (1 + (i % 2 ? -q : q));
		ctx.drawImage(source, i * w0, 0, w0, ch, x, 0, wd + 0.6, ch);
		if ((i % 2 ? -q : q) < 0) {
			ctx.fillStyle = `rgba(0,0,0,${(0.42 * Math.abs(q)).toFixed(3)})`;
			ctx.fillRect(x, 0, wd + 0.6, ch);
		}
		x += wd;
	}
}

/** 着地バウンド — the frame is tossed up, falls and bounces on the bottom edge. */
function drawDropBounce(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, source } = options;
	const lift =
		k < 0.16 ? outCubic(k / 0.16) : 1 - bounceOut((k - 0.16) / 0.84);
	const o = -Math.round(ch * 0.2 * lift);
	if (!o) return;
	bgFill(options);
	ctx.drawImage(source, 0, o);
	ctx.drawImage(source, 0, o + ch);
}

/** 円盤まわし — three concentric discs of the picture turn against each other and settle. */
function drawDiscTurn(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const m = Math.min(cw, ch) / 2;
	const cx = cw / 2;
	const cy = ch / 2;
	const e = spring(k, 0.22);
	const dir = x2Unit(s, 1) < 0.5 ? 1 : -1;
	if (Math.abs(e) < 0.004) return;
	const R = [0.97, 0.66, 0.36];
	const T = [1, -1.7, 2.6];
	const lw = Math.max(1, m * 0.006);
	for (let i = 0; i < 3; i++) {
		const r = R[i]! * m;
		ctx.save();
		ctx.beginPath();
		ctx.arc?.(cx, cy, r, 0, TAU);
		ctx.clip();
		ctx.fillStyle = sc.bg;
		ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
		ctx.translate(cx, cy);
		ctx.rotate(T[i]! * dir * degrees(15) * e);
		ctx.drawImage(source, -cx, -cy);
		ctx.restore();
		ctx.globalAlpha = clamp01(Math.abs(e) * 1.5) * 0.7;
		ctx.strokeStyle = popOf(sc);
		ctx.lineWidth = lw;
		ctx.beginPath();
		ctx.arc?.(cx, cy, r - lw / 2, 0, TAU);
		ctx.stroke?.();
		ctx.globalAlpha = 1;
	}
}

/** 伸び波 — a bump of vertical stretch runs across the columns. */
function drawStretchWave(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const N = 80;
	const dir = x2Unit(s, 1) < 0.5;
	const x0 = cw * (dir ? lerpN(-0.3, 1.3, k) : lerpN(1.3, -0.3, k));
	const sig = cw * 0.1;
	const a = 0.85;
	for (let i = 0; i < N; i++) {
		const xa = Math.floor((i * cw) / N);
		const xb = Math.floor(((i + 1) * cw) / N);
		const d = ((xa + xb) / 2 - x0) / sig;
		const sy = 1 + a * Math.exp(-d * d);
		if (sy < 1.004) continue;
		ctx.drawImage(
			source,
			xa,
			0,
			xb - xa,
			ch,
			xa,
			(ch / 2) * (1 - sy),
			xb - xa,
			ch * sy,
		);
	}
}

/** 斜め裂き — the frame is cut along a diagonal; the halves slide apart along the cut and back. */
function drawDiagSlice(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const e = punch(k, 0.3);
	const th =
		(x2Unit(s, 1) < 0.5 ? 1 : -1) *
		degrees(18 + 20 * x2Unit(s, 2));
	const D = Math.hypot(cw, ch);
	const d = Math.min(cw, ch) * 0.13 * e;
	const cx = cw / 2;
	const cy = ch / 2;
	if (d < 0.5) return;
	bgFill(options);
	for (let hf = 0; hf < 2; hf++) {
		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(th);
		ctx.beginPath();
		ctx.rect(-D, hf ? 0 : -D, 2 * D, D);
		ctx.clip();
		ctx.translate(hf ? -d : d, 0);
		ctx.rotate(-th);
		ctx.drawImage(source, -cx, -cy);
		ctx.restore();
	}
	const lw = Math.max(1.5, Math.min(cw, ch) * 0.004);
	ctx.translate(cx, cy);
	ctx.rotate(th);
	ctx.globalAlpha = clamp01(e * 1.4);
	ctx.fillStyle = popOf(sc);
	ctx.fillRect(-D, -lw / 2, 2 * D, lw);
}

/** 段ズーム — horizontal bands each jump to their own magnification (parallax layers) and fall back. */
function drawBandZoom(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, width: cw } = options;
	const nb = 4 + (x2Hash(s, 1) % 3);
	const e = punch(k, 0.22);
	if (e < 0.004) return;
	for (let b = 0; b < nb; b++) {
		const y0 = Math.round((b * ch) / nb);
		const y1 = Math.round(((b + 1) * ch) / nb);
		const z = 1 + e * (0.03 + 0.2 * x2Unit(s, b, 2));
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, y0, cw, y1 - y0);
		ctx.clip();
		drawScaled(
			ctx,
			source,
			z,
			cw * (0.5 + x2Signed(s, b, 3) * 0.12),
			(y0 + y1) / 2,
			cw,
			ch,
		);
		ctx.restore();
	}
}

/** ねじれ — the picture twists like a ribbon: rows turn over (mirrored for a moment) one after another. */
function drawRibbonTwist(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const N = 40;
	const down = x2Unit(s, 1) < 0.5;
	for (let i = 0; i < N; i++) {
		const y0 = Math.floor((i * ch) / N);
		const h = Math.floor(((i + 1) * ch) / N) - y0;
		const u = clamp01((k - 0.5 * (down ? i / N : 1 - i / N)) / 0.5);
		if (u <= 0 || u >= 1) continue;
		const c = Math.cos(TAU * inOutCubic(u));
		const w = cw * Math.abs(c);
		const x = (cw - w) / 2;
		ctx.fillStyle = sc.bg;
		ctx.fillRect(0, y0, cw, h);
		if (w < 1) continue;
		if (c < 0) {
			ctx.setTransform(-1, 0, 0, 1, cw, 0);
			ctx.drawImage(source, 0, y0, cw, h, x, y0, w, h);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		} else {
			ctx.drawImage(source, 0, y0, cw, h, x, y0, w, h);
		}
		ctx.fillStyle = `rgba(0,0,0,${((1 - Math.abs(c)) * 0.22).toFixed(3)})`;
		ctx.fillRect(x, y0, w, h);
	}
}

/** リール回転 — slot machine: wide reels spin one full turn in alternate directions and stop one by one. */
function drawSlotReel(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const n = (cw >= ch ? 3 : 2) + (x2Hash(s, 1) % 2);
	const lag = 0.14;
	bgFill(options);
	for (let i = 0; i < n; i++) {
		const x0 = Math.round((i * cw) / n);
		const w = Math.round(((i + 1) * cw) / n) - x0;
		const u = clamp01((k - i * lag) / (1 - (n - 1) * lag));
		const dir = (i + (x2Hash(s, 2) % 2)) % 2 ? -1 : 1;
		const sp = bell(u) * ch * 0.035;
		for (let c = 2; c >= 0; c--) {
			const o =
				(((dir * (inOutCubic(u) * ch + (c ? (c === 1 ? sp : -sp) : 0))) %
					ch) +
					ch) %
				ch;
			ctx.globalAlpha = c ? 0.4 : 1;
			if (c && sp < 1) continue;
			ctx.drawImage(source, x0, 0, w, ch, x0, o, w, ch);
			ctx.drawImage(source, x0, 0, w, ch, x0, o - ch, w, ch);
		}
	}
	ctx.globalAlpha = 0.5 * bell(k);
	ctx.fillStyle = sc.fg;
	const lw = Math.max(1, Math.round(Math.min(cw, ch) * 0.003));
	for (let i = 1; i < n; i++) {
		ctx.fillRect(Math.round((i * cw) / n) - lw / 2, 0, lw, ch);
	}
}

/** 十字割り — the quadrants are pushed apart from the centre, leaving a cross-shaped gap. */
function drawCrossSplit(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const e = punch(k, 0.25);
	const g = Math.min(cw, ch) * 0.04 * e;
	if (g < 0.5) return;
	const xs = Math.round(cw * (0.5 + x2Signed(s, 1) * 0.1));
	const ys = Math.round(ch * (0.5 + x2Signed(s, 2) * 0.06));
	bgFill(options);
	ctx.drawImage(source, 0, 0, xs, ys, -g, -g, xs, ys);
	ctx.drawImage(source, xs, 0, cw - xs, ys, xs + g, -g, cw - xs, ys);
	ctx.drawImage(source, 0, ys, xs, ch - ys, -g, ys + g, xs, ch - ys);
	ctx.drawImage(
		source,
		xs,
		ys,
		cw - xs,
		ch - ys,
		xs + g,
		ys + g,
		cw - xs,
		ch - ys,
	);
	const lw = Math.max(1, Math.min(cw, ch) * 0.003);
	ctx.globalAlpha = clamp01(e * 1.3);
	ctx.fillStyle = popOf(sc);
	ctx.fillRect(xs - lw / 2, 0, lw, ch);
	ctx.fillRect(0, ys - lw / 2, cw, lw);
}

// ================= copies =================

/** ロングシャドウ — the ink throws a solid coloured extrusion along a diagonal, then pulls it back in. */
function drawLongShadow(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, tmp, width: cw } =
		options;
	const dark = isDark(sc.bg);
	const e = ahr(k, 0.3, 0.6, outCubic, inOutCubic);
	const L = Math.min(cw, ch) * 0.085 * e;
	if (L < 1) return;
	const hw = halfOf(cw);
	const hh = halfOf(ch);
	const scratch = tmp(hw, hh);
	if (!scratch) return;
	const shadowMask = inkMask(
		scratch,
		source,
		sc,
		x2Unit(s, 1) < 0.6 ? sc.accent : sc.accent2,
		dark,
	);
	if (!shadowMask) return;
	const ang = degrees(x2Unit(s, 2) < 0.5 ? 45 : 135);
	const n = Math.max(2, Math.min(18, Math.ceil(L / Math.max(1, cw / 700))));
	ctx.globalCompositeOperation = dark ? "lighten" : "darken";
	for (let i = n; i >= 1; i--) {
		ctx.drawImage(
			shadowMask,
			0,
			0,
			hw,
			hh,
			(Math.cos(ang) * L * i) / n,
			(Math.sin(ang) * L * i) / n,
			cw,
			ch,
		);
	}
	ctx.drawImage(source, 0, 0);
}

/** 水鏡 — a waterline rises from the bottom edge: below it the picture is reflected, squashed and rippling. */
function drawWaterMirror(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, source, width: cw } = options;
	const lift = ahr(k, 0.3, 0.68, outCubic, inCubic);
	const depth = ch * 0.34 * lift;
	if (depth < 2) return;
	const y0 = Math.round(ch - depth);
	const N = 22;
	const hs = depth / N;
	const sh = hs * 1.55;
	ctx.fillStyle = sc.bg;
	ctx.fillRect(0, y0, cw, ch - y0);
	for (let j = 0; j < N; j++) {
		const sy = y0 - (j + 1) * sh;
		if (sy < 0) break;
		const dx = Math.sin(j * 0.85 + k * 16) * cw * 0.0035 * (1 + j * 0.22);
		ctx.setTransform(1, 0, 0, -1, dx, y0 + (j + 1) * hs);
		ctx.drawImage(source, 0, sy, cw, sh, 0, 0, cw, hs + 0.6);
	}
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	const gradient = ctx.createLinearGradient?.(0, y0, 0, ch);
	if (gradient) {
		gradient.addColorStop(0, rgbaOf(sc.bg, 0.3));
		gradient.addColorStop(1, rgbaOf(sc.bg, 0.8));
		ctx.fillStyle = gradient;
	} else {
		ctx.fillStyle = rgbaOf(sc.bg, 0.55);
	}
	ctx.fillRect(0, y0, cw, ch - y0);
	ctx.globalAlpha = 0.7 * lift;
	ctx.fillStyle = popOf(sc);
	ctx.fillRect(0, y0 - 1, cw, Math.max(1, ch * 0.003));
}

/** 振り子残像 — pendulum after-images: copies swing out to both sides around a pivot far below the frame. */
function drawSwingEcho(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const e = punch(k, 0.3);
	const th = degrees(3.4) * e;
	const up = x2Unit(s, 1) < 0.3;
	if (th < 0.0006) return;
	const px = cw / 2;
	const py = up ? -ch * 0.9 : ch * 1.9;
	ctx.globalCompositeOperation = isDark(sc.bg) ? "lighten" : "darken";
	for (let i = 3; i >= 1; i--) {
		for (const sg of [-1, 1]) {
			ctx.globalAlpha = clamp01(e * 2) * (0.62 - i * 0.14);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.translate(px, py);
			ctx.rotate(sg * th * i);
			ctx.drawImage(source, -px, -py);
		}
	}
}

/** 帯リピート — the middle band of the picture is stamped again and again above and below, then folds back. */
function drawBandRepeat(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, source, width: cw } = options;
	const e = punch(k, 0.3);
	const bh = Math.round(ch * 0.26);
	const y0 = Math.round(ch / 2 - bh / 2);
	const sp = bh * 0.92 * e;
	if (sp < 1) return;
	ctx.globalCompositeOperation = isDark(sc.bg) ? "lighten" : "darken";
	for (let i = 3; i >= 1; i--) {
		for (const sg of [-1, 1]) {
			ctx.globalAlpha = clamp01(e * 2.5) * (0.7 - i * 0.16);
			ctx.drawImage(source, 0, y0, cw, bh, 0, y0 + sg * sp * i, cw, bh);
		}
	}
}

/** 入れ子 — picture in picture in picture: the frame recedes into nested, framed copies of itself. */
function drawNested(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const e = punch(k, 0.3);
	const f = 1 - 0.27 * e;
	if (f > 0.997) return;
	const cx = cw * (0.5 + x2Signed(s, 1) * 0.08);
	const cy = ch * (0.5 + x2Signed(s, 2) * 0.06);
	const lw = Math.max(1, Math.min(cw, ch) * 0.004);
	ctx.strokeStyle = popOf(sc);
	ctx.lineWidth = lw;
	let z = 1;
	for (let i = 1; i <= 4; i++) {
		z *= f;
		const x = cx - cx * z;
		const y = cy - cy * z;
		ctx.globalAlpha = 1;
		ctx.drawImage(source, 0, 0, cw, ch, x, y, cw * z, ch * z);
		ctx.globalAlpha = clamp01(e * 1.5) * 0.85;
		strokeRectOf(ctx, x, y, cw * z, ch * z);
	}
}

/** サムネ列 — contact strip: a row of small framed copies of the frame pops up along one edge and drops away. */
function drawThumbRow(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const n = cw >= ch ? 5 : 4;
	const tw = (cw * 0.86) / n * 0.86;
	const th = (tw * ch) / cw;
	const gap = (cw - n * tw) / (n + 1);
	const top = x2Unit(s, 1) < 0.35;
	const yb = top ? ch * 0.045 : ch * 0.955 - th;
	const rev = x2Unit(s, 2) < 0.5;
	const lw = Math.max(1, Math.min(cw, ch) * 0.004);
	for (let i = 0; i < n; i++) {
		const o = (rev ? n - 1 - i : i) * 0.06;
		const z =
			enterBOutBack(clamp01((k - o) / 0.22), 1.6) *
			(1 - inCubic(clamp01((k - 0.66 - o * 0.5) / 0.2)));
		if (z < 0.02) continue;
		const w = tw * z;
		const h = th * z;
		const x = gap + i * (tw + gap) + (tw - w) / 2;
		const y = yb + (th - h) / 2;
		ctx.fillStyle = sc.bg;
		ctx.fillRect(x, y, w, h);
		ctx.drawImage(source, 0, 0, cw, ch, x, y, w, h);
		ctx.strokeStyle = i % 2 ? sc.fg : popOf(sc);
		ctx.lineWidth = lw;
		strokeRectOf(ctx, x, y, w, h);
	}
}

/** 虫めがね — a round magnifier glides across the frame. */
function drawLoupe(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const m = Math.min(cw, ch);
	const r =
		m *
		0.21 *
		ahr(k, 0.22, 0.75, (value) => enterBOutBack(value, 1.4), inCubic);
	if (!(r >= 1)) return;
	const dir = x2Unit(s, 1) < 0.5;
	const p = inOutSine(k);
	const x = cw * (dir ? lerpN(0.26, 0.74, p) : lerpN(0.74, 0.26, p));
	const y = ch * (0.5 + x2Signed(s, 2) * 0.05) - Math.sin(p * Math.PI) * ch * 0.03;
	const z = 1.6;
	ctx.save();
	ctx.beginPath();
	ctx.arc?.(x, y, r, 0, TAU);
	ctx.clip();
	ctx.fillStyle = sc.bg;
	ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
	ctx.drawImage(source, 0, 0, cw, ch, x - x * z, y - y * z, cw * z, ch * z);
	ctx.restore();
	const lw = Math.max(1.5, m * 0.007);
	ctx.strokeStyle = sc.fg;
	ctx.lineWidth = lw;
	ctx.beginPath();
	ctx.arc?.(x, y, r, 0, TAU);
	ctx.stroke?.();
	ctx.strokeStyle = popOf(sc);
	ctx.lineWidth = lw * 0.6;
	ctx.globalAlpha = 0.8;
	if (r > lw * 3) {
		ctx.beginPath();
		ctx.arc?.(x, y, r - lw * 1.6, -2.4, -1.5);
		ctx.stroke?.();
	}
}

// ================= light =================

/** 端フラッシュ — accent bars slam in from two opposite edges with a glow and retract. */
function drawEdgeBars(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const vert = x2Unit(s, 1) < (cw >= ch ? 0.3 : 0.55);
	const L = vert ? cw : ch;
	const M = vert ? ch : cw;
	const e =
		k < 0.14 ? outExpo(k / 0.14) : (1 - (k - 0.14) / 0.86) ** 1.6;
	const th = L * 0.06 * e;
	const col = popOf(sc);
	if (th < 0.5) return;
	// eslint-disable-next-line opencut/prefer-object-params
	const bar = (a: number, w: number) =>
		vert ? ctx.fillRect(a, 0, w, M) : ctx.fillRect(0, a, M, w);
	const gl = L * 0.2 * e;
	for (const sd of [0, 1]) {
		const gradient = vert
			? ctx.createLinearGradient?.(sd ? cw : 0, 0, sd ? cw - gl : gl, 0)
			: ctx.createLinearGradient?.(
					0,
					sd ? ch : 0,
					0,
					sd ? ch - gl : gl,
				);
		if (gradient) {
			gradient.addColorStop(0, rgbaOf(col, 0.5 * e));
			gradient.addColorStop(1, rgbaOf(col, 0));
			ctx.fillStyle = gradient;
		} else {
			ctx.fillStyle = rgbaOf(col, 0.25 * e);
		}
		ctx.globalCompositeOperation = isDark(sc.bg) ? "screen" : "multiply";
		bar(sd ? L - gl : 0, gl);
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = col;
		bar(sd ? L - th : 0, th);
		ctx.fillStyle = sc.fg;
		ctx.globalAlpha = e;
		bar(sd ? L - th * 1.45 : th * 1.3, th * 0.15);
		ctx.globalAlpha = 1;
	}
}

/** スポット — everything goes dim except a round pool of light that travels across the frame. */
function drawSpotlight(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const a = ahr(k, 0.2, 0.72);
	if (a < 0.01) return;
	const r = Math.min(cw, ch) * 0.3;
	const dir = x2Unit(s, 1) < 0.5;
	const p = inOutSine(k);
	const x = cw * (dir ? lerpN(0.2, 0.8, p) : lerpN(0.8, 0.2, p));
	const y = ch * (0.5 + x2Signed(s, 2) * 0.06);
	const col = shadeOf(sc);
	const gradient = ctx.createRadialGradient?.(x, y, r * 0.7, x, y, r * 1.3);
	if (!gradient) return;
	gradient.addColorStop(0, rgbaOf(col, 0));
	gradient.addColorStop(
		1,
		rgbaOf(col, (isDark(sc.bg) ? 0.8 : 0.6) * a),
	);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, cw, ch);
}

/** 色ストロボ — three hard flashes, each in a different scheme colour. */
function drawColorStrobe(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const cols = tintsOf(sc);
	const seg = Math.min(2, Math.floor(k * 3));
	const fr = k * 3 - seg;
	const a = (1 - 0.55 * fr) * (1 - k * k * k);
	const col = cols[(seg + (x2Hash(s, 1) % cols.length)) % cols.length]!;
	if (a < 0.01) return;
	ctx.globalAlpha = 0.95 * a;
	ctx.globalCompositeOperation = isDark(sc.bg) ? "multiply" : "screen";
	ctx.fillStyle = col;
	ctx.fillRect(0, 0, cw, ch);
	ctx.globalAlpha = 0.22 * a;
	ctx.globalCompositeOperation = "source-over";
	ctx.fillRect(0, 0, cw, ch);
}

/** 露出落ち — the exposure sags, then recovers slightly too bright before settling. */
function drawExposureDip(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, width: cw } = options;
	const dark = isDark(sc.bg);
	const d =
		k < 0.28
			? outCubic(k / 0.28)
			: 1 - inOutCubic(clamp01((k - 0.28) / 0.34));
	const o = k > 0.55 ? bell((k - 0.55) / 0.45) : 0;
	if (d > 0.005) {
		ctx.fillStyle = rgbaOf(shadeOf(sc), (dark ? 0.86 : 0.7) * d);
		ctx.fillRect(0, 0, cw, ch);
	}
	if (o > 0.005) {
		if (dark) {
			ctx.globalCompositeOperation = "screen";
			ctx.fillStyle = rgbaOf(sc.fg, 0.13 * o);
		} else {
			ctx.fillStyle = `rgba(255,255,255,${(0.4 * o).toFixed(3)})`;
		}
		ctx.fillRect(0, 0, cw, ch);
	}
}

/** タイル点灯 — cells of a coarse grid light up one after another in a diagonal run. */
function drawTileLights(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const m = Math.min(cw, ch);
	const gx = Math.max(3, Math.round(cw / (m / 4.5)));
	const gy = Math.max(3, Math.round(ch / (m / 4.5)));
	const dark = isDark(sc.bg);
	const cols = tintsOf(sc);
	const rev = x2Unit(s, 1) < 0.5;
	const gp = Math.max(1, Math.round(m * 0.004));
	ctx.globalCompositeOperation = dark ? "screen" : "multiply";
	for (let j = 0; j < gy; j++) {
		for (let i = 0; i < gx; i++) {
			if (x2Unit(s, i, j, 2) > 0.62) continue;
			const u = clamp01(
				(k - (((rev ? gx - 1 - i : i) + j) / (gx + gy - 2)) * 0.62) / 0.38,
			);
			if (u <= 0 || u >= 1) continue;
			const x0 = Math.round((i * cw) / gx);
			const x1 = Math.round(((i + 1) * cw) / gx);
			const y0 = Math.round((j * ch) / gy);
			const y1 = Math.round(((j + 1) * ch) / gy);
			ctx.globalAlpha = Math.min(
				1,
				(u < 0.2 ? 1 : 1 - outQuad((u - 0.2) / 0.8)) * 0.62,
			);
			ctx.fillStyle = cols[x2Hash(s, i, j, 3) % cols.length]!;
			ctx.fillRect(
				x0 + gp,
				y0 + gp,
				x1 - x0 - 2 * gp,
				y1 - y0 - 2 * gp,
			);
		}
	}
}

/** 照準ロック — two hairlines sweep in from the edges, lock on a point with a reticle flash and let go. */
function drawCrosshair(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const m = Math.min(cw, ch);
	const col = popOf(sc);
	const tx = Math.round(cw * (0.5 + x2Signed(s, 1) * 0.16));
	const ty = Math.round(ch * (0.5 + x2Signed(s, 2) * 0.12));
	const lw = Math.max(1, Math.round(m * 0.004));
	const p = outExpo(clamp01(k / 0.42));
	const fade = k > 0.62 ? 1 - inQuad((k - 0.62) / 0.38) : 1;
	const x = lerpN(x2Unit(s, 3) < 0.5 ? 0 : cw, tx, p);
	const y = lerpN(x2Unit(s, 4) < 0.5 ? 0 : ch, ty, p);
	ctx.globalAlpha = fade * clamp01(k * 12);
	ctx.fillStyle = col;
	ctx.fillRect(x - lw / 2, 0, lw, ch);
	ctx.fillRect(0, y - lw / 2, cw, lw);
	if (k > 0.38) {
		const q = (k - 0.38) / 0.62;
		const r = m * 0.045 * (1 + 1.6 * outCubic(q));
		const t = r * 0.45;
		ctx.globalAlpha = 1 - inQuad(q);
		ctx.strokeStyle = sc.fg;
		ctx.lineWidth = lw * 1.5;
		ctx.beginPath();
		for (const [sx, sy] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		] as const) {
			ctx.moveTo?.(tx + sx * r, ty + sy * (r - t));
			ctx.lineTo?.(tx + sx * r, ty + sy * r);
			ctx.lineTo?.(tx + sx * (r - t), ty + sy * r);
		}
		ctx.stroke?.();
		if (q < 0.25) {
			ctx.globalCompositeOperation = "difference";
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(tx - r, ty - r, 2 * r, 2 * r);
		}
	}
}

/** 明滅 — lamp on its way out: irregular dimming steps. */
function drawLampFlicker(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, step, width: cw } = options;
	const v = x2Unit(step, s, 1);
	const lvl =
		k < 0.12 ? 0.8 : v < 0.3 ? 0.78 : v < 0.55 ? 0.42 : v < 0.75 ? 0.14 : 0;
	const a = Math.min(0.88, lvl * (1 - k) ** 0.6);
	if (a < 0.01) return;
	ctx.fillStyle = rgbaOf(shadeOf(sc), a);
	ctx.fillRect(0, 0, cw, ch);
}

/** ゼブラ — exposure warning: moving diagonal stripes cut through the ink only. */
function drawZebra(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const e = ahr(k, 0.22, 0.7);
	const D = Math.hypot(cw, ch) / 2 + 2;
	const p = Math.max(6, Math.min(cw, ch) / 26);
	const duty = 0.5 * e;
	if (duty < 0.02) return;
	ctx.globalCompositeOperation = isDark(sc.bg) ? "multiply" : "screen";
	ctx.fillStyle = sc.bg;
	ctx.translate(cw / 2, ch / 2);
	ctx.rotate(degrees(x2Unit(s, 1) < 0.5 ? 45 : -45));
	const o = (k * 3 * p) % p;
	ctx.beginPath();
	for (let x = -D + o - p, i = 0; x < D && i < 400; x += p, i++) {
		ctx.rect(x, -D, p * duty, 2 * D);
	}
	ctx.fill?.();
}

// ================= colour =================

/** 十字色ズレ — the ink splits into two scheme-tinted copies: one stretched tall, one stretched wide. */
function drawCrossFringe(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, tmp, tmp2, width: cw } =
		options;
	const dark = isDark(sc.bg);
	const d = 0.1 * punch(k, 0.2);
	if (d < 0.002) return;
	const hw = halfOf(cw);
	const hh = halfOf(ch);
	const sw = x2Unit(s, 1) < 0.5;
	const scratchA = tmp(hw, hh);
	const scratchB = tmp2(hw, hh);
	if (!scratchA || !scratchB) return;
	const tallMask = inkMask(
		scratchA,
		source,
		sc,
		sw ? sc.ghostB : sc.ghostA,
		dark,
	);
	const wideMask = inkMask(
		scratchB,
		source,
		sc,
		sw ? sc.ghostA : sc.ghostB,
		dark,
	);
	if (!tallMask || !wideMask) return;
	ctx.globalCompositeOperation = dark ? "screen" : "multiply";
	ctx.globalAlpha = 0.95;
	ctx.drawImage(
		tallMask,
		0,
		0,
		hw,
		hh,
		0,
		(-ch * d * 1.6) / 2,
		cw,
		ch * (1 + d * 1.6),
	);
	ctx.drawImage(
		wideMask,
		0,
		0,
		hw,
		hh,
		(-cw * d) / 2,
		0,
		cw * (1 + d),
		ch,
	);
}

/** チェック反転 — negative squares swell out of a chequered grid, swap phase and shrink away. */
function drawCheckerInvert(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, width: cw } = options;
	const c = Math.min(cw, ch) / (4 + (x2Hash(s, 1) % 2));
	const nx = Math.ceil((cw / c / 2)) * 2 + 1;
	const ny = Math.ceil((ch / c / 2)) * 2 + 1;
	const e = k < 0.5 ? ahr(k * 2, 0.5, 0.82) : ahr((k - 0.5) * 2, 0.18, 0.5);
	const ph = k < 0.5 ? 0 : 1;
	const sd = c * e;
	if (sd < 0.5) return;
	const ox = (cw - nx * c) / 2;
	const oy = (ch - ny * c) / 2;
	ctx.globalCompositeOperation = "difference";
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) {
			if ((i + j + ph) % 2 === 0) {
				ctx.rect(
					ox + i * c + (c - sd) / 2,
					oy + j * c + (c - sd) / 2,
					sd,
					sd,
				);
			}
		}
	}
	ctx.fill?.();
}

/** 縞モザイク — resolution collapses along one axis only: the picture turns into flat bars and resolves again. */
function drawStripeMosaic(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, source, tmp, width: cw } = options;
	const e = punch(k, 0.3);
	const rows = x2Unit(s, 1) < 0.3;
	const L = rows ? ch : cw;
	// 40 + 50 × amp headroom at the fixed amplitude 1.
	const n = Math.max(6, Math.round(lerpN(L / 3, L / 75, outCubic(e))));
	if (e < 0.02) return;
	const w = rows ? halfOf(cw) : n;
	const h = rows ? n : halfOf(ch);
	const scratch = tmp(w, h);
	if (!scratch) return;
	const x = cx2Of(scratch);
	if (!x) return;
	x.globalCompositeOperation = "copy";
	x.drawImage(source, 0, 0, w, h);
	x.globalCompositeOperation = "source-over";
	ctx.imageSmoothingEnabled = false;
	ctx.globalAlpha = clamp01(e * 3);
	ctx.drawImage(scratch, 0, 0, w, h, 0, 0, cw, ch);
}

/** 四色パネル — four quadrants, four scheme tints, trading places every two frames. */
function drawFourTints(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const a = ahr(k, 0.12, 0.7);
	const rot = Math.floor(k * 4) + (x2Hash(s, 1) % 4);
	if (a < 0.01) return;
	const base = tintsOf(sc);
	const cols = [0, 1, 2, 3].map((i) =>
		i < base.length
			? base[i]!
			: mixHex({
					from: base[i % base.length]!,
					progress: 0.5,
					to: sc.fg,
				}),
	);
	const xs = Math.round(cw / 2);
	const ys = Math.round(ch / 2);
	const Q: readonly (readonly [number, number, number, number])[] = [
		[0, 0, xs, ys],
		[xs, 0, cw - xs, ys],
		[xs, ys, cw - xs, ch - ys],
		[0, ys, xs, ch - ys],
	];
	for (let q = 0; q < 4; q++) {
		const [qx, qy, qw, qh] = Q[q]!;
		ctx.fillStyle = cols[(q + rot) % 4]!;
		ctx.globalCompositeOperation = isDark(sc.bg) ? "multiply" : "screen";
		ctx.globalAlpha = 0.95 * a;
		ctx.fillRect(qx, qy, qw, qh);
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 0.2 * a;
		ctx.fillRect(qx, qy, qw, qh);
	}
}

/** 時計反転 — a clock hand sweeps round and leaves the picture negative behind it; a second sweep puts it right. */
function drawClockInvert(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const cx = cw / 2;
	const cy = ch / 2;
	const R = Math.hypot(cw, ch);
	const a0 = -Math.PI / 2 + ((x2Hash(s, 1) % 4) * Math.PI) / 2;
	const ccw = x2Unit(s, 2) < 0.5;
	const b = k < 0.5 ? 0 : inOutCubic((k - 0.5) * 2);
	const f = k < 0.5 ? inOutCubic(k * 2) : 1;
	if (f - b < 0.002) return;
	const sg = ccw ? -1 : 1;
	const A = a0 + sg * TAU * b;
	const B = a0 + sg * TAU * f;
	ctx.globalCompositeOperation = "difference";
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.moveTo?.(cx, cy);
	ctx.arc?.(cx, cy, R, A, B, ccw);
	ctx.closePath?.();
	ctx.fill?.();
	ctx.globalCompositeOperation = "source-over";
	ctx.strokeStyle = popOf(sc);
	ctx.lineWidth = Math.max(1.5, Math.min(cw, ch) * 0.005);
	const hand = k < 0.5 ? B : A;
	ctx.beginPath();
	ctx.moveTo?.(cx, cy);
	ctx.lineTo?.(cx + Math.cos(hand) * R, cy + Math.sin(hand) * R);
	ctx.stroke?.();
}

// ================= texture =================

/** 走査線バースト — fine scan lines burst open into thick bars that cut through the picture while scrolling. */
function drawScanBurst(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const a = (1 - k) ** 0.9;
	if (a < 0.01) return;
	const p = lerpN(Math.max(4, ch / 150), ch / 8, inQuad(k));
	const th = p * 0.5 * (0.35 + 0.65 * a);
	const o =
		(((k * ch * 0.35 * (x2Unit(s, 1) < 0.5 ? 1 : -1)) % p) + p) % p;
	ctx.globalAlpha = Math.min(1, a * 1.6);
	ctx.fillStyle = sc.bg;
	ctx.beginPath();
	for (let y = o - p, i = 0; y < ch && i < 600; y += p, i++) {
		ctx.rect(0, y, cw, th);
	}
	ctx.fill?.();
	ctx.globalAlpha = 0.5 * a;
	ctx.fillStyle = popOf(sc);
	ctx.beginPath();
	const hl = Math.max(1, ch * 0.0015);
	if (p > ch / 40) {
		for (let y = o - p, i = 0; y < ch && i < 80; y += p, i++) {
			ctx.rect(0, y + th, cw, hl);
		}
	}
	ctx.fill?.();
}

/** ドット波 — a ring of printed dots rolls out from one corner across the frame. */
function drawDotWave(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const m = Math.min(cw, ch);
	const p = m / 19;
	const cn = x2Hash(s, 1) % 4;
	const ox = cn & 1 ? cw : 0;
	const oy = cn & 2 ? ch : 0;
	const D = Math.hypot(cw, ch);
	const band = D * 0.2;
	const R = lerpN(-band, D + band, outQuad(k));
	const rm = p * 0.47;
	ctx.fillStyle = popOf(sc);
	ctx.beginPath();
	const nx = Math.ceil(cw / p) + 1;
	const ny = Math.ceil(ch / p) + 1;
	for (let j = 0; j < ny; j++) {
		for (let i = 0; i < nx; i++) {
			const x = (i + (j % 2) * 0.5) * p;
			const y = j * p;
			const d = Math.abs(Math.hypot(x - ox, y - oy) - R) / band;
			if (d >= 1) continue;
			const r = rm * Math.cos((d * Math.PI) / 2);
			if (r < 0.4) continue;
			ctx.moveTo?.(x + r, y);
			ctx.arc?.(x, y, r, 0, TAU);
		}
	}
	ctx.fill?.();
}

/** 欠落 — signal dropout: grid-aligned rectangles of the picture go missing, fewer every frame. */
function drawDropout(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, step, width: cw } = options;
	const st = step * 29 + s;
	const B = Math.max(4, Math.round(Math.min(cw, ch) / 10));
	const n = Math.round((4 + (x2Hash(s, 1) % 4)) * (1 - k));
	const nx = Math.ceil(cw / B);
	const ny = Math.ceil(ch / B);
	const lw = Math.max(1, Math.round(B * 0.05));
	for (let i = 0; i < n; i++) {
		const gw = 1 + (x2Hash(st, i, 2) % 4);
		const gh = 1 + (x2Hash(st, i, 3) % 2);
		const x =
			(x2Hash(st, i, 4) % Math.max(1, nx - gw + 1)) * B;
		const y = Math.round(ny * (0.2 + 0.6 * x2Unit(st, i, 5)) - gh / 2) * B;
		ctx.fillStyle = sc.bg;
		ctx.fillRect(x, y, gw * B, gh * B);
		ctx.fillStyle = x2Unit(st, i, 6) < 0.5 ? sc.ghostA : sc.ghostB;
		ctx.globalAlpha = 0.8;
		if (x2Unit(st, i, 7) < 0.5) {
			ctx.fillRect(x, y, lw, gh * B);
		} else {
			ctx.fillRect(x, y + gh * B - lw, gw * B, lw);
		}
		ctx.globalAlpha = 1;
	}
}

/** テープ折れ — a crease travels through the tape: a squeezed, side-slipped band with a bright fold line. */
function drawTapeCrease(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, source, width: cw } = options;
	const amt = bell(k) ** 0.6;
	const up = x2Unit(s, 1) < 0.5;
	const dir = x2Unit(s, 2) < 0.5 ? 1 : -1;
	const y0 = ch * (up ? lerpN(0.8, 0.2, k) : lerpN(0.2, 0.8, k));
	const hb = ch * 0.05 * amt;
	if (hb < 1) return;
	const M = 12;
	const sq = 1.8;
	ctx.fillStyle = sc.bg;
	ctx.fillRect(0, y0 - hb, cw, 2 * hb);
	for (let j = 0; j < M; j++) {
		const v = j / M;
		const tri = 1 - Math.abs(2 * (v + 0.5 / M) - 1);
		ctx.drawImage(
			source,
			0,
			y0 - sq * hb + 2 * sq * hb * v,
			cw,
			(2 * sq * hb) / M,
			dir * cw * 0.04 * amt * tri,
			y0 - hb + 2 * hb * v,
			cw,
			(2 * hb) / M + 0.6,
		);
	}
	const lw = Math.max(1, ch * 0.003);
	ctx.fillStyle = isDark(sc.bg)
		? `rgba(255,255,255,${(0.6 * amt).toFixed(3)})`
		: rgbaOf(shadeOf(sc), 0.45 * amt);
	ctx.fillRect(0, y0 - lw / 2, cw, lw);
	ctx.fillStyle = `rgba(0,0,0,${(0.3 * amt).toFixed(3)})`;
	ctx.fillRect(0, y0 + lw / 2, cw, hb * 0.5);
}

/** モアレ — two sets of concentric rings drift apart and interfere. */
function drawMoire(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const m = Math.min(cw, ch);
	const g = m / 24;
	const e = ahr(k, 0.25, 0.6, outCubic, inOutCubic);
	const al = 0.2 * e;
	if (al < 0.01) return;
	const R = Math.hypot(cw, ch) * 0.56;
	const n = Math.min(60, Math.ceil(R / g));
	const ang = x2Unit(s, 1) * TAU + k * 0.9;
	const sep = m * (0.03 + 0.1 * k);
	ctx.strokeStyle = rgbaOf(sc.fg, al);
	ctx.lineWidth = g * 0.32;
	for (const sg of [-1, 1]) {
		const cx = cw / 2 + Math.cos(ang) * sep * sg;
		const cy = ch / 2 + Math.sin(ang) * sep * sg;
		ctx.beginPath();
		for (let i = 1; i <= n; i++) {
			ctx.moveTo?.(cx + i * g, cy);
			ctx.arc?.(cx, cy, i * g, 0, TAU);
		}
		ctx.stroke?.();
	}
}

/** 画素はじけ — stray pixels: small grid-snapped squares in scheme colours pop all over the frame. */
function drawPixelSparks(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, step, width: cw } = options;
	const st = step * 17 + s;
	const q = Math.max(2, Math.round(Math.min(cw, ch) * 0.016));
	const n = Math.round(54 * bell(k) ** 0.7);
	const cols = [...tintsOf(sc), sc.fg];
	for (let i = 0; i < n; i++) {
		const z = q * (1 + (x2Hash(st, i, 1) % 3));
		const x = Math.floor((x2Unit(st, i, 2) * cw) / q) * q;
		const y = Math.floor((x2Unit(st, i, 3) * ch) / q) * q;
		ctx.fillStyle = cols[x2Hash(st, i, 4) % cols.length]!;
		if (x2Unit(st, i, 5) < 0.3) {
			ctx.fillRect(x, y, z * (2 + (x2Hash(st, i, 6) % 4)), q);
		} else {
			ctx.fillRect(x, y, z, z);
		}
	}
}

// ================= framing =================

/** 帯スナップ — cinema bars snap shut to a wide frame with a little overshoot, then open again. */
function drawLetterSnap(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, width: cw } = options;
	const e =
		k < 0.22
			? enterBOutBack(k / 0.22, 2.2)
			: k > 0.7
				? 1 - inCubic((k - 0.7) / 0.3)
				: 1;
	const hb = ch * (cw >= ch ? 0.125 : 0.075) * e;
	if (hb < 0.5) return;
	const darkest = [sc.ink, sc.fg, sc.bg].reduce((p, c) =>
		lumOf(c) < lumOf(p) ? c : p,
	);
	const col =
		contrastOf(darkest, sc.bg) > 1.25
			? darkest
			: mixHex({ from: sc.bg, progress: 0.2, to: sc.fg });
	const lw = Math.max(1, ch * 0.003);
	ctx.fillStyle = col;
	ctx.fillRect(0, 0, cw, hb);
	ctx.fillRect(0, ch - hb, cw, hb);
	ctx.fillStyle = popOf(sc);
	ctx.globalAlpha = clamp01(e);
	ctx.fillRect(0, hb, cw, lw);
	ctx.fillRect(0, ch - hb - lw, cw, lw);
}

/** まばたき — eyelids: the frame closes to a slit like a blinking eye and opens again. */
function drawBlink(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, width: cw } = options;
	const b = 4 / 9;
	const c = k < b ? inQuad(k / b) : 1 - outQuad((k - b) / (1 - b));
	if (c < 0.003) return;
	const rx = cw * 0.8 * (1 - c) ** 0.22;
	const ry = ch * 0.86 * (1 - c);
	const cx = cw / 2;
	const cy = ch / 2;
	ctx.fillStyle =
		lumOf(sc.bg) < 0.08
			? mixHex({ from: sc.bg, progress: 0.1, to: sc.fg })
			: shadeOf(sc);
	ctx.beginPath();
	ctx.rect(0, 0, cw, ch);
	if (ry > 0.5) {
		// MotionTextCanvasContext has no ellipse: a circle under vertical scale.
		ctx.save();
		ctx.translate(cx, cy);
		ctx.scale(1, ry / rx);
		ctx.moveTo?.(rx, 0);
		ctx.arc?.(0, 0, rx, 0, TAU);
		ctx.restore();
	}
	ctx.fill?.("evenodd");
	if (ry > 1) {
		ctx.globalAlpha = clamp01(c * 2);
		ctx.strokeStyle = popOf(sc);
		ctx.lineWidth = Math.max(1.5, ch * 0.005);
		ctx.beginPath();
		ctx.save();
		ctx.translate(cx, cy);
		ctx.scale(1, ry / rx);
		ctx.arc?.(0, 0, rx, 0, TAU);
		ctx.restore();
		ctx.stroke?.();
	}
}

/** 枠パンチ — a thick coloured border punches in while the picture steps back inside it. */
function drawBorderPunch(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, scheme: sc, source, width: cw } = options;
	const e =
		k < 0.2
			? enterBOutBack(k / 0.2, 2)
			: 1 - inOutCubic((k - 0.2) / 0.8);
	const t = Math.min(cw, ch) * 0.055 * e;
	if (t < 0.5) return;
	const z = 1 - 0.07 * e;
	bgFill(options);
	drawScaled(ctx, source, z, cw / 2, ch / 2, cw, ch);
	ctx.fillStyle = popOf(sc);
	ctx.fillRect(0, 0, cw, t);
	ctx.fillRect(0, ch - t, cw, t);
	ctx.fillRect(0, t, t, ch - 2 * t);
	ctx.fillRect(cw - t, t, t, ch - 2 * t);
	const lw = Math.max(1, Math.min(cw, ch) * 0.003);
	const o = t * 1.35;
	ctx.globalAlpha = clamp01(e);
	ctx.strokeStyle = sc.fg;
	ctx.lineWidth = lw;
	strokeRectOf(ctx, o, o, cw - 2 * o, ch - 2 * o);
}

/** 角折れ — one corner of the picture is dog-eared: the flap folds over, shows its back and flattens again. */
function drawCornerFold(options: X2FxPartDraw): void {
	const { ctx, height: ch, k, s, scheme: sc, width: cw } = options;
	const cn = x2Hash(s, 1) % 4;
	const f = Math.min(cw, ch) * 0.4 * ahr(k, 0.3, 0.62, outCubic, inOutCubic);
	if (f < 1) return;
	ctx.setTransform(
		cn & 1 ? -1 : 1,
		0,
		0,
		cn & 2 ? -1 : 1,
		cn & 1 ? cw : 0,
		cn & 2 ? ch : 0,
	);
	// eslint-disable-next-line opencut/prefer-object-params
	const tri = (
		x0: number,
		y0: number,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
	) => {
		ctx.beginPath();
		ctx.moveTo?.(x0, y0);
		ctx.lineTo?.(x1, y1);
		ctx.lineTo?.(x2, y2);
		ctx.closePath?.();
		ctx.fill?.();
	};
	const shadow = ctx.createLinearGradient?.(f / 2, f / 2, f * 0.68, f * 0.68);
	if (shadow) {
		shadow.addColorStop(0, "rgba(0,0,0,0.34)");
		shadow.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = shadow;
	} else {
		ctx.fillStyle = "rgba(0,0,0,0.17)";
	}
	// The shadow the flap casts on the page.
	tri(f * 1.25, 0, 0, f * 1.25, f * 1.25, f * 1.25);
	// What is under the lifted corner.
	ctx.fillStyle = popOf(sc);
	tri(0, 0, f, 0, 0, f);
	// The back of the flap.
	ctx.fillStyle = mixHex({
		from: sc.bg,
		progress: isDark(sc.bg) ? 0.24 : 0.1,
		to: sc.fg,
	});
	tri(f, 0, 0, f, f, f);
	const gloss = ctx.createLinearGradient?.(f / 2, f / 2, f, f);
	if (gloss) {
		gloss.addColorStop(0, "rgba(0,0,0,0.28)");
		gloss.addColorStop(0.5, "rgba(0,0,0,0)");
		gloss.addColorStop(1, "rgba(255,255,255,0.1)");
		ctx.fillStyle = gloss;
	} else {
		ctx.fillStyle = "rgba(0,0,0,0.1)";
	}
	tri(f, 0, 0, f, f, f);
	ctx.strokeStyle = sc.fg;
	ctx.globalAlpha = 0.6;
	ctx.lineWidth = Math.max(1, Math.min(cw, ch) * 0.003);
	ctx.beginPath();
	ctx.moveTo?.(f, 0);
	ctx.lineTo?.(0, f);
	ctx.stroke?.();
}
