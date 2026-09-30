import { drawCardCoreLayout } from "./core-layout-cards";
import { drawGraphicCoreLayout } from "./core-layout-graphics";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawCoreLayout(options: TypographyLayoutOptions): boolean {
	return drawGraphicCoreLayout(options) || drawCardCoreLayout(options);
}
