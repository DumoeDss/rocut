import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawBgcamFilmLightBackground } from "./bgcam-film-light-backgrounds";
import { drawBgcamSurfaceBackground } from "./bgcam-surface-backgrounds";

export function drawBgcamTextureBackground(
	options: BgcamBackgroundDraw,
): boolean {
	return (
		drawBgcamFilmLightBackground(options) || drawBgcamSurfaceBackground(options)
	);
}
