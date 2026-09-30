import { drawTreatTransMaskTransition } from "./treat-trans-mask-transitions";
import { drawTreatTransSpatialTransition } from "./treat-trans-spatial-transitions";
import type { TreatTransTransitionDraw } from "./treat-trans-transition-drawing";

export function drawTreatTransTransition(
	options: TreatTransTransitionDraw,
): boolean {
	const state = {
		fillStyle: options.ctx.fillStyle,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		strokeStyle: options.ctx.strokeStyle,
	} as const;
	options.ctx.save();
	try {
		return (
			drawTreatTransMaskTransition(options) ||
			drawTreatTransSpatialTransition(options)
		);
	} finally {
		options.ctx.restore();
		options.ctx.fillStyle = state.fillStyle;
		options.ctx.globalAlpha = state.globalAlpha;
		options.ctx.lineWidth = state.lineWidth;
		options.ctx.strokeStyle = state.strokeStyle;
	}
}
