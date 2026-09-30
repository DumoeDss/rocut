import { drawCoreBackDecor } from "./core-decor-back";
import { drawCoreFrontAccentDecor } from "./core-decor-front-accents";
import { drawCoreFrontFrameDecor } from "./core-decor-front-frames";
import type { CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import { drawDecorB } from "./decor-b";
import { drawExtendedDecor } from "./extended-decors";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

interface CoreDecorsDraw {
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly layer: CoreDecorLayer;
	readonly width: number;
}

export function drawCoreDecors(options: CoreDecorsDraw): void {
	const decors = options.frame.cut?.preset.decor ?? [];
	for (const decor of decors) {
		const draw: CoreDecorDraw = { ...options, decor };
		options.ctx.save();
		const handled =
			options.layer === "back"
				? drawDecorB({ ...draw, layer: options.layer }) ||
					drawExtendedDecor({ ...draw, layer: options.layer }) ||
					drawCoreBackDecor(draw)
				: drawDecorB({ ...draw, layer: options.layer }) ||
					drawExtendedDecor({ ...draw, layer: options.layer }) ||
					drawCoreFrontFrameDecor(draw) ||
					drawCoreFrontAccentDecor(draw);
		options.ctx.restore();
		if (!handled) continue;
	}
}
