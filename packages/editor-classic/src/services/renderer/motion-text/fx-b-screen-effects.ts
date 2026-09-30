import { drawFxBGraphicEffect } from "./fx-b-screen-effects-graphic";
import { drawFxBFrameEffect } from "./fx-b-screen-effects-frame";
import { drawFxBOpticalEffect } from "./fx-b-screen-effects-optical";
import { drawFxBSignalEffect } from "./fx-b-screen-effects-signal";
import {
	FX_B_SCREEN_EFFECT_IDS,
	FX_B_SCREEN_EFFECTS,
	fxBPhase,
	type FxBScreenEffectDraw,
} from "./fx-b-screen-effect-types";
import {
	captureLooksSource,
	isLooksPixelContext,
} from "./looks-screen-effect-types";

export function drawFxBScreenEffect(options: FxBScreenEffectDraw): boolean {
	if (!FX_B_SCREEN_EFFECT_IDS.has(options.effect)) return false;
	options.ctx.save();
	try {
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
			drawFxBOpticalEffect(pixelOptions) ||
			drawFxBFrameEffect(pixelOptions) ||
			drawFxBSignalEffect(pixelOptions) ||
			drawFxBGraphicEffect(pixelOptions)
		);
	} finally {
		options.ctx.restore();
	}
}

function drawFallbackSignature(options: FxBScreenEffectDraw): void {
	const index = FX_B_SCREEN_EFFECTS.findIndex(
		(effect) => effect === options.effect,
	);
	const phase = fxBPhase(options);
	const count = 2 + (index % 7);
	options.ctx.globalAlpha *= 0.28 + phase * 0.52;
	options.ctx.fillStyle =
		index % 2 === 0
			? options.frame.palette.accent
			: options.frame.palette.secondary;
	for (let marker = 0; marker < count; marker += 1) {
		const width = options.width * (0.018 + ((index + marker) % 9) * 0.006);
		const height =
			options.height * (0.008 + ((index * 3 + marker) % 7) * 0.004);
		const x =
			options.width *
			(((index * 0.071 + marker * 0.137 + phase * 0.31) % 0.92) + 0.01);
		const y =
			options.height *
			(((index * 0.113 + marker * 0.083 + phase * 0.23) % 0.86) + 0.03);
		options.ctx.fillRect(x, y, width, height);
	}
	options.ctx.translate(
		options.width * (0.001 + (index % 5) * 0.001) * phase,
		options.height * (0.001 + (index % 3) * 0.001) * (1 - phase),
	);
	options.ctx.rotate((index + 1) * 0.002 * (0.4 + phase));
	options.ctx.scale(
		1 + ((index % 6) + 1) * 0.001 * phase,
		1 - ((index % 4) + 1) * 0.0008 * phase,
	);
}
