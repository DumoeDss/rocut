import { drawLooksOverlayEffect } from "./looks-screen-effects-overlays";
import { drawLooksPixelEffectA } from "./looks-screen-effects-pixel-a";
import { drawLooksPixelEffectB } from "./looks-screen-effects-pixel-b";
import {
	captureLooksSource,
	fillLooksEffectRect,
	isLooksPixelContext,
	looksEffectProgress,
	type LooksScreenEffectDraw,
} from "./looks-screen-effect-types";

const LOOKS_SCREEN_EFFECTS = [
	"panelWipe",
	"irisTrans",
	"doors",
	"blindsTrans",
	"rgbSplit",
	"smear",
	"vhsRoll",
	"trackingNoise",
	"mirrorFlash",
	"strobe",
	"posterize",
	"hueShift",
	"tileShift",
	"filmBurn",
	"whipBlur",
	"blackFrame",
	"whiteFrame",
	"gridRepeat",
	"waveWarp",
	"pixelDrift",
	"zoomPunch",
	"lightSweep",
	"crtOff",
	"splitSlide",
] as const;

const LOOKS_SCREEN_EFFECT_IDS = new Set<string>(LOOKS_SCREEN_EFFECTS);

export function drawLooksScreenEffect(options: LooksScreenEffectDraw): boolean {
	if (!LOOKS_SCREEN_EFFECT_IDS.has(options.effect)) return false;
	if (drawLooksOverlayEffect(options)) return true;
	if (!isLooksPixelContext(options.ctx)) {
		drawFallbackSignature(options);
		return true;
	}
	const surface = captureLooksSource({
		ctx: options.ctx,
		height: options.height,
		width: options.width,
	});
	if (!surface) {
		drawFallbackSignature(options);
		return true;
	}
	const pixelOptions = {
		...options,
		ctx: options.ctx,
		source: surface.canvas,
	};
	return (
		drawLooksPixelEffectA(pixelOptions) || drawLooksPixelEffectB(pixelOptions)
	);
}

function drawFallbackSignature(options: LooksScreenEffectDraw): void {
	const index = LOOKS_SCREEN_EFFECTS.findIndex(
		(effect) => effect === options.effect,
	);
	const progress = looksEffectProgress(options);
	const count = 2 + (index % 5);
	for (let bar = 0; bar < count; bar += 1) {
		const width = options.width * (0.035 + ((index + bar) % 7) * 0.012);
		const x =
			((progress * options.width * (0.4 + (index % 4) * 0.18) +
				bar * options.width * 0.17 +
				index * 11) %
				(options.width + width)) -
			width;
		const y = options.height * (0.08 + ((index * 3 + bar * 5) % 13) / 15);
		fillLooksEffectRect({
			alpha: 0.24 + (bar % 3) * 0.15,
			color:
				(index + bar) % 2 === 0
					? options.frame.palette.accent
					: options.frame.palette.secondary,
			height: options.height * (0.015 + ((index + bar) % 4) * 0.009),
			options,
			width,
			x,
			y,
		});
	}
}
