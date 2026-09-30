import { drawExtendedGeometryDecor } from "./extended-decor-geometry";
import { drawExtendedHudDecor } from "./extended-decor-hud";
import { drawExtendedOrnamentDecor } from "./extended-decor-ornaments";
import { drawExtendedParticleDecor } from "./extended-decor-particles";
import type { CoreDecorDraw, CoreDecorLayer } from "./core-decor-types";

const EXTENDED_DECORS = new Set([
	"beatRing",
	"bokeh",
	"bracketsJP",
	"brushStroke",
	"checkerStrip",
	"concentricSquares",
	"confetti",
	"constellation",
	"cropMarks",
	"crosshair",
	"crossOut",
	"dateStamp",
	"dimension",
	"glitchRects",
	"guides",
	"halftonePatch",
	"heartsStars",
	"highlightMark",
	"indexNum",
	"lightLeak",
	"lineBurst",
	"orbitDots",
	"petals",
	"plusGrid",
	"progressRing",
	"qrBlock",
	"radar",
	"rainStreaks",
	"reticle",
	"risingParticles",
	"romajiLine",
	"rulerEdge",
	"scribbleCircle",
	"scribbleUnder",
	"seal",
	"snow",
	"speedCorner",
	"spiralLine",
	"tapePieces",
	"timecodeBar",
	"triangleSpin",
	"twinkle",
	"verticalStrip",
	"watermarkKanji",
	"waveLine",
]);

const BACK_DECORS = new Set([
	"beatRing",
	"bokeh",
	"brushStroke",
	"halftonePatch",
	"lightLeak",
	"rainStreaks",
	"risingParticles",
	"snow",
	"watermarkKanji",
]);

export function drawExtendedDecor(
	options: CoreDecorDraw & { readonly layer: CoreDecorLayer },
): boolean {
	if (!EXTENDED_DECORS.has(options.decor)) return false;
	const expectedLayer = BACK_DECORS.has(options.decor) ? "back" : "front";
	if (options.layer !== expectedLayer) return false;
	const draw: CoreDecorDraw = options;
	return (
		drawExtendedHudDecor(draw) ||
		drawExtendedGeometryDecor(draw) ||
		drawExtendedParticleDecor(draw) ||
		drawExtendedOrnamentDecor(draw)
	);
}
