import type { MotionTextSequence } from "@opencut/editor-contracts";

import { drawCoreScreenEffect } from "./core-screen-effects";
import { drawFxBScreenEffect } from "./fx-b-screen-effects";
import { drawX2HorrorFx } from "./x2-horror-b";
import { drawX2KineticFx } from "./x2-kinetic-b";
import { drawX2ScreenEffect } from "./x2-screen-effects";
import { drawX2TypoFx } from "./x2-typo-b";
import { drawX2WaFx } from "./x2-wa-b";
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
		if (
			drawX2ScreenEffect({
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
			drawX2KineticFx({
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
			drawX2TypoFx({
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
			drawX2HorrorFx({
				ctx,
				effect,
				frame,
				height,
				width,
			})
		) {
			continue;
		}
		if (
			drawX2WaFx({
				ctx,
				effect,
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
