import { drawEnterADigitalFamily } from "./enter-a-digital";
import type { EnterADraw } from "./enter-a-drawing";
import { drawEnterAGlyphFamily } from "./enter-a-glyph";
import { drawEnterAMaskFamily } from "./enter-a-masks";
import { drawEnterAMotionFamily } from "./enter-a-motion";

export function drawEnterAEntrance(options: EnterADraw): boolean {
	const { ctx } = options;
	const state = {
		fillStyle: ctx.fillStyle,
		filter: ctx.filter,
		globalAlpha: ctx.globalAlpha,
		globalCompositeOperation: ctx.globalCompositeOperation,
		imageSmoothingEnabled: ctx.imageSmoothingEnabled,
		lineWidth: ctx.lineWidth,
		shadowBlur: ctx.shadowBlur,
		shadowColor: ctx.shadowColor,
		strokeStyle: ctx.strokeStyle,
		textAlign: ctx.textAlign,
		textBaseline: ctx.textBaseline,
	};
	ctx.save();
	try {
		return (
			drawEnterAGlyphFamily(options) ||
			drawEnterAMaskFamily(options) ||
			drawEnterAMotionFamily(options) ||
			drawEnterADigitalFamily(options)
		);
	} finally {
		ctx.restore();
		ctx.fillStyle = state.fillStyle;
		ctx.filter = state.filter;
		ctx.globalAlpha = state.globalAlpha;
		ctx.lineWidth = state.lineWidth;
		ctx.shadowBlur = state.shadowBlur;
		ctx.shadowColor = state.shadowColor;
		ctx.strokeStyle = state.strokeStyle;
		ctx.textAlign = state.textAlign;
		ctx.textBaseline = state.textBaseline;
		if (state.globalCompositeOperation !== undefined) {
			ctx.globalCompositeOperation = state.globalCompositeOperation;
		}
		if (state.imageSmoothingEnabled !== undefined) {
			ctx.imageSmoothingEnabled = state.imageSmoothingEnabled;
		}
	}
}
