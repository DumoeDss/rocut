import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawLooksAtmosphereBackground } from "./looks-backgrounds-atmosphere";
import { drawLooksGraphicBackground } from "./looks-backgrounds-graphic";

export function drawLooksBackground(options: BgcamBackgroundDraw): boolean {
	return (
		drawLooksGraphicBackground(options) ||
		drawLooksAtmosphereBackground(options)
	);
}
