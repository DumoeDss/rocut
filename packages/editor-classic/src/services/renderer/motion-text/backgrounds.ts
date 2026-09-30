import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawBgcamGradientBackground } from "./bgcam-gradient-backgrounds";
import { drawBgcamPatternBackground } from "./bgcam-pattern-backgrounds";
import { drawBgcamSceneBackground } from "./bgcam-scene-backgrounds";
import { drawBgcamTextureBackground } from "./bgcam-texture-backgrounds";
import { drawHorrorBackground } from "./horror-backgrounds";
import { drawLooksBackground } from "./looks-backgrounds";

export function drawMotionTextBackground(
	options: BgcamBackgroundDraw,
): boolean {
	return (
		drawHorrorBackground(options) ||
		drawLooksBackground(options) ||
		drawBgcamGradientBackground(options) ||
		drawBgcamPatternBackground(options) ||
		drawBgcamSceneBackground(options) ||
		drawBgcamTextureBackground(options)
	);
}
