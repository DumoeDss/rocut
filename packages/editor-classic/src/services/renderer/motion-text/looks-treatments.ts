import type { TypographyTextDraw } from "./typography-layout-types";
import type { MotionTextCanvasContext, MotionTextRenderFrame } from "./types";
import { drawLooksBasicTreatment } from "./looks-treatments-basic";
import { drawLooksStyledTreatment } from "./looks-treatments-styled";

export function drawLooksTreatment(
	options: TypographyTextDraw & {
		readonly ctx: MotionTextCanvasContext;
		readonly frame: MotionTextRenderFrame;
	},
): boolean {
	return drawLooksBasicTreatment(options) || drawLooksStyledTreatment(options);
}
