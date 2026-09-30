import { drawTreatTransBasicTreatment } from "./treat-trans-basic-treatments";
import type { TreatTransTreatmentDraw } from "./treat-trans-drawing";
import { drawTreatTransEditorialTreatment } from "./treat-trans-editorial-treatments";
import { drawTreatTransGraphicTreatment } from "./treat-trans-graphic-treatments";

export function drawTreatTransTreatment(
	options: TreatTransTreatmentDraw,
): boolean {
	const state = {
		fillStyle: options.ctx.fillStyle,
		filter: options.ctx.filter,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		shadowBlur: options.ctx.shadowBlur,
		shadowColor: options.ctx.shadowColor,
		strokeStyle: options.ctx.strokeStyle,
		textAlign: options.ctx.textAlign,
	} as const;
	options.ctx.save();
	try {
		return (
			drawTreatTransBasicTreatment(options) ||
			drawTreatTransGraphicTreatment(options) ||
			drawTreatTransEditorialTreatment(options)
		);
	} finally {
		options.ctx.restore();
		options.ctx.fillStyle = state.fillStyle;
		options.ctx.filter = state.filter;
		options.ctx.globalAlpha = state.globalAlpha;
		options.ctx.lineWidth = state.lineWidth;
		options.ctx.shadowBlur = state.shadowBlur;
		options.ctx.shadowColor = state.shadowColor;
		options.ctx.strokeStyle = state.strokeStyle;
		options.ctx.textAlign = state.textAlign;
	}
}
