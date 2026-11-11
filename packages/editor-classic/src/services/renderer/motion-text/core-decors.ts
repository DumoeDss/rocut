import { drawCoreBackDecor } from "./core-decor-back";
import { drawCoreFrontAccentDecor } from "./core-decor-front-accents";
import { drawCoreFrontFrameDecor } from "./core-decor-front-frames";
import type { CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";
import { drawDecorB } from "./decor-b";
import { drawExtendedDecor } from "./extended-decors";
import { drawX2DecorsA } from "./x2-decors-a";
import { drawX2DecorsB } from "./x2-decors-b";
import { drawX2DecorsC } from "./x2-decors-c";
import { drawX2HorrorDecor } from "./x2-horror-a";
import { drawX2KineticDecor } from "./x2-kinetic-a";
import { drawX2TypoDecor } from "./x2-typo-a";
import { drawX2WaDecor } from "./x2-wa-a";
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
		const x2Decor =
			drawX2DecorsA({ ...draw, layer: options.layer }) ||
			drawX2DecorsB({ ...draw, layer: options.layer }) ||
			drawX2DecorsC({ ...draw, layer: options.layer }) ||
			drawX2KineticDecor(draw) ||
			drawX2WaDecor({ ...draw, layer: options.layer });
		const handled =
			options.layer === "back"
				? drawDecorB({ ...draw, layer: options.layer }) ||
					drawExtendedDecor({ ...draw, layer: options.layer }) ||
					x2Decor ||
					drawCoreBackDecor(draw)
				: drawDecorB({ ...draw, layer: options.layer }) ||
					drawExtendedDecor({ ...draw, layer: options.layer }) ||
					x2Decor ||
					drawCoreFrontFrameDecor(draw) ||
					drawCoreFrontAccentDecor(draw);
		options.ctx.restore();
		if (!handled) continue;
	}
	// Themed x2 decor packs iterate the cut's decor list themselves and no-op
	// for foreign ids; running them once per layer mirrors how draw.ts drives
	// the horror decor family.
	drawX2HorrorDecor(options);
	drawX2TypoDecor(options);
}
