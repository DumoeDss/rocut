import { drawExitHoldEffectExit } from "./exit-hold-effect-exits";
import type { ExitHoldDraw } from "./exit-hold-geometry";
import { drawExitHoldMaskExit } from "./exit-hold-mask-exits";
import { drawExitHoldMotionExit } from "./exit-hold-motion-exits";
import { drawExitHoldShapeExit } from "./exit-hold-shape-exits";

export function drawExitHoldExit(options: ExitHoldDraw): boolean {
	const state = {
		fillStyle: options.ctx.fillStyle,
		filter: options.ctx.filter,
		globalAlpha: options.ctx.globalAlpha,
		lineWidth: options.ctx.lineWidth,
		strokeStyle: options.ctx.strokeStyle,
		textAlign: options.ctx.textAlign,
	} as const;
	options.ctx.save();
	try {
		return (
			drawExitHoldMaskExit(options) ||
			drawExitHoldMotionExit(options) ||
			drawExitHoldShapeExit(options) ||
			drawExitHoldEffectExit(options)
		);
	} finally {
		options.ctx.restore();
		options.ctx.fillStyle = state.fillStyle;
		options.ctx.filter = state.filter;
		options.ctx.globalAlpha = state.globalAlpha;
		options.ctx.lineWidth = state.lineWidth;
		options.ctx.strokeStyle = state.strokeStyle;
		options.ctx.textAlign = state.textAlign;
	}
}
