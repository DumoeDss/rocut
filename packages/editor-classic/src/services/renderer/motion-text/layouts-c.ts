import { drawLayoutsCEditorial } from "./layouts-c-editorial";
import { drawLayoutsCJapanese } from "./layouts-c-japanese";
import { drawLayoutsCMedia } from "./layouts-c-media";
import { drawLayoutsCObjects } from "./layouts-c-objects";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawLayoutsC(options: TypographyLayoutOptions): boolean {
	return (
		drawLayoutsCEditorial(options) ||
		drawLayoutsCMedia(options) ||
		drawLayoutsCJapanese(options) ||
		drawLayoutsCObjects(options)
	);
}
