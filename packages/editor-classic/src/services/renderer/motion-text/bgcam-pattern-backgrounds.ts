import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawBgcamGeometricPattern } from "./bgcam-geometric-backgrounds";
import { drawBgcamTextilePattern } from "./bgcam-textile-backgrounds";

export function drawBgcamPatternBackground(
	options: BgcamBackgroundDraw,
): boolean {
	return drawBgcamTextilePattern(options) || drawBgcamGeometricPattern(options);
}
