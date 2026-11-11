import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawBgcamGradientBackground } from "./bgcam-gradient-backgrounds";
import { drawBgcamPatternBackground } from "./bgcam-pattern-backgrounds";
import { drawBgcamSceneBackground } from "./bgcam-scene-backgrounds";
import { drawBgcamTextureBackground } from "./bgcam-texture-backgrounds";
import { drawHorrorBackground } from "./horror-backgrounds";
import { drawX2Background } from "./x2-backgrounds";
import { drawX2HorrorBackground } from "./x2-horror-a";
import { drawX2KineticBackground } from "./x2-kinetic-a";
import { drawX2TypoBackground } from "./x2-typo-a";
import { drawX2WaBackground } from "./x2-wa-a";
import { drawLooksBackground } from "./looks-backgrounds";

export function drawMotionTextBackground(
	options: BgcamBackgroundDraw,
): boolean {
	if (
		drawHorrorBackground(options) ||
		drawLooksBackground(options) ||
		drawBgcamGradientBackground(options) ||
		drawBgcamPatternBackground(options) ||
		drawBgcamSceneBackground(options) ||
		drawBgcamTextureBackground(options) ||
		drawX2Background(options)
	) {
		return true;
	}
	// The x2 themed background packs follow their families' void-draw contract;
	// each no-ops unless the cut's background preset is one of its own ids.
	drawX2HorrorBackground(options);
	drawX2KineticBackground(options);
	drawX2TypoBackground(options);
	drawX2WaBackground(options);
	return false;
}
