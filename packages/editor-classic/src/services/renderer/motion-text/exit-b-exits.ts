import type { ExitHoldDraw } from "./exit-hold-geometry";
import { drawExitBGraphicExit } from "./exit-b-graphic-exits";
import { drawExitBMotionExit } from "./exit-b-motion-exits";
import { drawExitBPaperExit } from "./exit-b-paper-exits";

export function drawExitBExit(options: ExitHoldDraw): boolean {
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
			drawExitBPaperExit(options) ||
			drawExitBMotionExit(options) ||
			drawExitBGraphicExit(options)
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
