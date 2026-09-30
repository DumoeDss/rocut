import type { BgcamBackgroundDraw } from "./bgcam-background-utils";
import { drawBgcamAtmosphereBackground } from "./bgcam-atmosphere-backgrounds";
import { drawBgcamLandscapeBackground } from "./bgcam-landscape-backgrounds";

export function drawBgcamSceneBackground(
	options: BgcamBackgroundDraw,
): boolean {
	return (
		drawBgcamAtmosphereBackground(options) ||
		drawBgcamLandscapeBackground(options)
	);
}
