import type { MotionTextSequence } from "@opencut/editor-contracts";

import { drawCoreScreenEffect } from "./core-screen-effects";
import { drawFxBScreenEffect } from "./fx-b-screen-effects";
import { drawHorrorScreenEffect } from "./horror-screen-effects";
import { drawLooksScreenEffect } from "./looks-screen-effects";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";

export function drawScreenEffects({
	compositionMode,
	ctx,
	frame,
	height,
	width,
}: {
	readonly compositionMode: MotionTextSequence["compositionMode"];
	readonly ctx: MotionTextCanvasContext;
	readonly frame: MotionTextRenderFrame;
	readonly height: number;
	readonly width: number;
}): void {
	for (const [effectIndex, effect] of (frame.cut?.preset.fx ?? []).entries()) {
		if (
			drawCoreScreenEffect({
				compositionMode,
				ctx,
				effect,
				effectIndex,
				frame,
				height,
				width,
			})
		) {
			continue;
		}
		if (
			drawLooksScreenEffect({
				compositionMode,
				ctx,
				effect,
				effectIndex,
				frame,
				height,
				width,
			})
		) {
			continue;
		}
		if (
			drawFxBScreenEffect({
				compositionMode,
				ctx,
				effect,
				effectIndex,
				frame,
				height,
				width,
			})
		) {
			continue;
		}
		drawHorrorScreenEffect({ ctx, effect, frame, height, width });
	}
}
