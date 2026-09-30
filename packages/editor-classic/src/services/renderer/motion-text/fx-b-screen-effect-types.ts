import { signedRandom, unitRandom } from "./deterministic-random";
import {
	fillLooksEffectRect,
	type LooksPixelEffectDraw,
	type LooksScreenEffectDraw,
} from "./looks-screen-effect-types";

export const FX_B_SCREEN_EFFECTS = [
	"radialChroma",
	"bloomFlash",
	"bulge",
	"pixelSort",
	"interlace",
	"macroBlock",
	"halftone",
	"duotone",
	"ditherBit",
	"rotateSnap",
	"echoFrames",
	"kaleido",
	"bandInvert",
	"lightRays",
	"anamorphic",
	"heartbeat",
	"tvStatic",
	"dustScratches",
	"filmAdvance",
	"perspectiveTilt",
	"ripple",
	"focusLines",
	"speedLines",
	"starGlint",
	"colorBars",
	"zoomStutter",
	"negativeRing",
	"edgeDetect",
	"shatter",
	"defocus",
	"snapshot",
	"squash",
	"scanBar",
	"loopScroll",
] as const;

export const FX_B_SCREEN_EFFECT_IDS = new Set<string>(FX_B_SCREEN_EFFECTS);

export type FxBPixelEffectDraw = LooksPixelEffectDraw;
export type FxBScreenEffectDraw = LooksScreenEffectDraw;

const TICKS_PER_SECOND = 90_000;

export function fxBPhase(options: FxBScreenEffectDraw): number {
	const cycle =
		options.frame.localTime / (TICKS_PER_SECOND * 1.35) +
		options.effectIndex * 0.137;
	return ((cycle % 1) + 1) % 1;
}

export function fxBPulse(options: FxBScreenEffectDraw): number {
	return 0.18 + Math.sin(Math.PI * fxBPhase(options)) * 0.82;
}

export function fxBUnit(options: FxBScreenEffectDraw, salt: number): number {
	return unitRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function fxBSigned(options: FxBScreenEffectDraw, salt: number): number {
	return signedRandom({ seed: options.frame.cut?.seed ?? 0, salt });
}

export function fxBStep(options: FxBScreenEffectDraw, rate = 24): number {
	return Math.floor(options.frame.localTime / (TICKS_PER_SECOND / rate));
}

export function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function drawFxBScaled({
	centerX,
	centerY,
	options,
	scaleX,
	scaleY = scaleX,
}: {
	readonly centerX?: number;
	readonly centerY?: number;
	readonly options: FxBPixelEffectDraw;
	readonly scaleX: number;
	readonly scaleY?: number;
}): void {
	const cx = centerX ?? options.width / 2;
	const cy = centerY ?? options.height / 2;
	const width = options.width * scaleX;
	const height = options.height * scaleY;
	options.ctx.drawImage(
		options.source,
		cx - cx * scaleX,
		cy - cy * scaleY,
		width,
		height,
	);
}

export function fillFxBSource({
	alpha,
	color,
	height,
	options,
	width,
	x,
	y,
}: {
	readonly alpha: number;
	readonly color: string;
	readonly height: number;
	readonly options: FxBScreenEffectDraw;
	readonly width: number;
	readonly x: number;
	readonly y: number;
}): void {
	fillLooksEffectRect({ alpha, color, height, options, width, x, y });
}

export function replaceFxBFrame(
	options: FxBPixelEffectDraw,
	draw: () => void,
): void {
	options.ctx.save();
	options.ctx.setTransform(1, 0, 0, 1, 0, 0);
	options.ctx.clearRect(0, 0, options.width, options.height);
	draw();
	options.ctx.restore();
}
