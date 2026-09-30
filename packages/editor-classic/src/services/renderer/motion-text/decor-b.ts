import { drawDecorBGraphic } from "./decor-b-graphic";
import { drawDecorBHud } from "./decor-b-hud";
import { drawDecorBJapanese } from "./decor-b-japanese";
import { drawDecorBNature } from "./decor-b-nature";
import { drawDecorBPrint } from "./decor-b-print";
import { drawDecorBUi } from "./decor-b-ui";
import type { CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";

const DECOR_B_IDS = new Set([
	"kamon",
	"seigaiha",
	"asanoha",
	"hanabi",
	"chochin",
	"shimenawa",
	"sensu",
	"tsukiKumo",
	"momiji",
	"namiGashira",
	"kasumi",
	"hexGrid",
	"spectrumRing",
	"dataColumns",
	"spinner",
	"headingTape",
	"glyphLock",
	"atomOrbit",
	"sonarArcs",
	"circuit",
	"swatches",
	"ruledLines",
	"registration",
	"punchHoles",
	"staple",
	"paperClip",
	"indexTabs",
	"vines",
	"cloudPuffs",
	"starField",
	"moonPhases",
	"sunRays",
	"rainRipples",
	"bubbles",
	"smoke",
	"dandelion",
	"fireflies",
	"memphis",
	"zigzagRibbon",
	"polkaPatch",
	"stripeCircle",
	"decoCorners",
	"halfCircles",
	"loopArrows",
	"starburst",
	"tally",
	"cursorClick",
	"windowChrome",
	"progressBar",
	"toggleSwitch",
	"notifBell",
	"likeCounter",
	"mediaControls",
	"volumeBars",
	"musicNotes",
]);

const BACK_DECORS = new Set([
	"asanoha",
	"kasumi",
	"rainRipples",
	"ruledLines",
	"seigaiha",
	"smoke",
	"starField",
	"sunRays",
]);

export function drawDecorB(
	options: CoreDecorDraw & { readonly layer: CoreDecorLayer },
): boolean {
	if (!DECOR_B_IDS.has(options.decor)) return false;
	const expectedLayer = BACK_DECORS.has(options.decor) ? "back" : "front";
	if (options.layer !== expectedLayer) return false;
	const draw: CoreDecorDraw = options;
	return (
		drawDecorBJapanese(draw) ||
		drawDecorBHud(draw) ||
		drawDecorBPrint(draw) ||
		drawDecorBNature(draw) ||
		drawDecorBGraphic(draw) ||
		drawDecorBUi(draw)
	);
}
