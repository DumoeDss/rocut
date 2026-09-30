import { drawLayoutsAEditorial } from "./layouts-a-editorial";
import { drawLayoutsAFrames } from "./layouts-a-frames";
import { drawLayoutsAScene } from "./layouts-a-scene";
import { drawLayoutsAUi } from "./layouts-a-ui";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawLayoutsA(options: TypographyLayoutOptions): boolean {
	return (
		drawLayoutsAEditorial(options) ||
		drawLayoutsAFrames(options) ||
		drawLayoutsAScene(options) ||
		drawLayoutsAUi(options)
	);
}
