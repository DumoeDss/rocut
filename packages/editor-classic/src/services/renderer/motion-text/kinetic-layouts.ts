import { drawKineticGraphicLayout } from "./kinetic-graphic-layouts";
import { drawKineticStageLayout } from "./kinetic-stage-layouts";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawKineticLayout(options: TypographyLayoutOptions): boolean {
	return drawKineticStageLayout(options) || drawKineticGraphicLayout(options);
}
