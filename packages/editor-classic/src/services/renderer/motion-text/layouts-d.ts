import { drawLayoutsDEffects } from "./layouts-d-effects";
import { drawLayoutsDGames } from "./layouts-d-games";
import { drawLayoutsDObjects } from "./layouts-d-objects";
import { drawLayoutsDSpatial } from "./layouts-d-spatial";
import type { TypographyLayoutOptions } from "./typography-layout-types";

export function drawLayoutsD(options: TypographyLayoutOptions): boolean {
	return (
		drawLayoutsDSpatial(options) ||
		drawLayoutsDObjects(options) ||
		drawLayoutsDGames(options) ||
		drawLayoutsDEffects(options)
	);
}
