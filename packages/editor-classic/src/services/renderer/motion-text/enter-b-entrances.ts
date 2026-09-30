import { drawEnterBDigital } from "./enter-b-digital";
import type { EnterBDraw } from "./enter-b-drawing";
import { drawEnterBGraphic } from "./enter-b-graphic";
import { drawEnterBPaperLight } from "./enter-b-paper-light";
import { drawEnterBPhysics } from "./enter-b-physics";

export function drawEnterBEntrance(options: EnterBDraw): boolean {
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
			drawEnterBPhysics(options) ||
			drawEnterBPaperLight(options) ||
			drawEnterBDigital(options) ||
			drawEnterBGraphic(options)
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
