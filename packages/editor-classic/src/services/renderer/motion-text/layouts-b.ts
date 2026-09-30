import { drawLayoutsBGraphic } from "./layouts-b-graphic";
import { drawLayoutsBMedia } from "./layouts-b-media";
import { drawLayoutsBMotion } from "./layouts-b-motion";
import { drawLayoutsBType } from "./layouts-b-type";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawLayoutsB(options: TypographyLayoutOptions): boolean {
	return (
		drawLayoutsBMotion(options) ||
		drawLayoutsBGraphic(options) ||
		drawLayoutsBMedia(options) ||
		drawLayoutsBType(options)
	);
}
